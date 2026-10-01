import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runRecordingTests } from './recordingIntegration';

const extensionId = `${process.env.REVIEW_PUBLISHER ?? 'local-latex-tools'}.latex-change-reviewer`;
const acceptCommand = 'latexReview.acceptCurrent';
const rejectCommand = 'latexReview.rejectCurrent';
const toggleCommand = 'latexReview.toggleReview';

async function activateExtension(): Promise<void> {
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, `Extension ${extensionId} must be installed or loaded for this test run.`);
  await extension.activate();
}

async function openLatex(source: string): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument({ language: 'latex', content: source });
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  // Older hosts can resolve showTextDocument before active-editor state reaches the extension host.
  for (let attempt = 0; attempt < 50 && vscode.window.activeTextEditor?.document !== document; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(vscode.window.activeTextEditor?.document, document, 'The test document must be active before cursor commands.');
  return editor;
}

async function codeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
  return vscode.commands.executeCommand<vscode.CodeLens[]>(
    'vscode.executeCodeLensProvider', document.uri, 1000
  );
}

function actionableLenses(lenses: vscode.CodeLens[]): vscode.CodeLens[] {
  return lenses.filter(lens => lens.command?.command === acceptCommand || lens.command?.command === rejectCommand);
}

async function runDevelopmentTests(): Promise<void> {
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, 'Development-host extension is unavailable.');
  assert.equal((await codeLenses((await openLatex(String.raw`\added{x}`)).document)).length, 3,
    'Enabling review should expose one three-action CodeLens group.');
}

async function runBehaviorTests(): Promise<void> {
  const config = vscode.workspace.getConfiguration('latexReview');
  await config.update('autoGoToNext', true, vscode.ConfigurationTarget.Global);
  await config.update('highlightChanges', false, vscode.ConfigurationTarget.Global);
  await config.update('uiLanguage', 'en', vscode.ConfigurationTarget.Global);

  // One edit per review action must remain independently undoable and redoable.
  let editor = await openLatex(String.raw`\replaced{NEW}{OLD} \added{ADD}`);
  let lenses = await codeLenses(editor.document);
  const firstAccept = lenses.find(lens => lens.command?.command === acceptCommand);
  assert.ok(firstAccept?.command);
  await vscode.commands.executeCommand(firstAccept.command.command, ...(firstAccept.command.arguments ?? []));
  assert.equal(editor.document.getText(), String.raw`NEW \added{ADD}`);
  await vscode.commands.executeCommand(rejectCommand);
  assert.equal(editor.document.getText(), 'NEW ');
  await vscode.commands.executeCommand('undo');
  assert.equal(editor.document.getText(), String.raw`NEW \added{ADD}`);
  await vscode.commands.executeCommand('undo');
  assert.equal(editor.document.getText(), String.raw`\replaced{NEW}{OLD} \added{ADD}`);
  await vscode.commands.executeCommand('redo');
  await vscode.commands.executeCommand('redo');
  assert.equal(editor.document.getText(), 'NEW ');

  // A CodeLens remains bound to its own change even when the cursor is elsewhere.
  editor = await openLatex(String.raw`\added{FIRST} -- \added{SECOND}`);
  lenses = actionableLenses(await codeLenses(editor.document));
  assert.equal(lenses.length, 4);
  const first = lenses.find(lens => lens.command?.command === acceptCommand);
  assert.ok(first?.command);
  editor.selection = new vscode.Selection(editor.document.positionAt(editor.document.getText().lastIndexOf('SECOND')),
    editor.document.positionAt(editor.document.getText().lastIndexOf('SECOND')));
  await vscode.commands.executeCommand(first.command.command, ...(first.command.arguments ?? []));
  assert.equal(editor.document.getText(), String.raw`FIRST -- \added{SECOND}`);

  // Reusing a lens after its document version changed must not perform another edit.
  editor = await openLatex(String.raw`\added{ONCE}`);
  const staleLens = actionableLenses(await codeLenses(editor.document))
    .find(lens => lens.command?.command === acceptCommand);
  assert.ok(staleLens?.command);
  await vscode.commands.executeCommand(staleLens.command.command, ...(staleLens.command.arguments ?? []));
  assert.equal(editor.document.getText(), 'ONCE');
  await vscode.commands.executeCommand(staleLens.command.command, ...(staleLens.command.arguments ?? []));
  assert.equal(editor.document.getText(), 'ONCE');

  // Editing after lens creation invalidates its captured version and range.
  editor = await openLatex(String.raw`\added{SAFE}`);
  const outdatedLens = actionableLenses(await codeLenses(editor.document))
    .find(lens => lens.command?.command === acceptCommand);
  assert.ok(outdatedLens?.command);
  await editor.edit(builder => builder.insert(new vscode.Position(0, 0), 'prefix '));
  const changedText = editor.document.getText();
  await vscode.commands.executeCommand(outdatedLens.command.command, ...(outdatedLens.command.arguments ?? []));
  assert.equal(editor.document.getText(), changedText);

  // Accepting an outer change reveals and jumps to a nested change in the retained branch.
  editor = await openLatex(String.raw`\replaced{new \added{inner}}{old}`);
  lenses = actionableLenses(await codeLenses(editor.document));
  assert.equal(lenses.length, 2, 'Only the outer change should initially be actionable.');
  const outerAccept = lenses.find(lens => lens.command?.command === acceptCommand);
  assert.ok(outerAccept?.command);
  await vscode.commands.executeCommand(outerAccept.command.command, ...(outerAccept.command.arguments ?? []));
  assert.equal(editor.document.getText(), String.raw`new \added{inner}`);
  assert.equal(actionableLenses(await codeLenses(editor.document)).length, 2);
  assert.equal(editor.document.offsetAt(editor.selection.active), 4,
    'Auto-next should place the cursor at the newly exposed nested change.');

  // Multiple changes on one line have numbered button groups.
  editor = await openLatex(String.raw`\added{one} \deleted{two}`);
  const sameLine = actionableLenses(await codeLenses(editor.document));
  assert.equal(sameLine.length, 4);
  assert.ok(sameLine.some(lens => lens.command?.title.startsWith('[1]')));
  assert.ok(sameLine.some(lens => lens.command?.title.startsWith('[2]')));

  // Navigation is source-ordered and never wraps at either boundary.
  editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
  await vscode.commands.executeCommand('latexReview.nextChange');
  const lastPosition = editor.document.offsetAt(editor.selection.active);
  assert.equal(lastPosition, editor.document.getText().indexOf('\\deleted'));
  await vscode.commands.executeCommand('latexReview.nextChange');
  assert.equal(editor.document.offsetAt(editor.selection.active), lastPosition);
  await vscode.commands.executeCommand('latexReview.previousChange');
  assert.equal(editor.document.offsetAt(editor.selection.active), 0);

  // Malformed nested markup blocks the outer edit and produces a visible diagnostic.
  editor = await openLatex(String.raw`\added{\replaced{new}}`);
  await vscode.commands.executeCommand('latexReview.refresh');
  assert.equal(actionableLenses(await codeLenses(editor.document)).length, 0);
  assert.ok(vscode.languages.getDiagnostics(editor.document.uri).length > 0);
  await vscode.commands.executeCommand(acceptCommand);
  assert.equal(editor.document.getText(), String.raw`\added{\replaced{new}}`);

  // A file switch does not redirect a captured CodeLens to the wrong buffer.
  const boundEditor = await openLatex(String.raw`\added{bound}`);
  const boundLens = actionableLenses(await codeLenses(boundEditor.document))[0];
  const other = await openLatex(String.raw`\added{other}`);
  await vscode.window.showTextDocument(boundEditor.document, { viewColumn: vscode.ViewColumn.One, preview: false });
  await vscode.window.showTextDocument(other.document, { viewColumn: vscode.ViewColumn.Two, preview: false });
  await vscode.commands.executeCommand(boundLens.command!.command, ...(boundLens.command!.arguments ?? []));
  assert.equal(boundEditor.document.getText(), 'bound');
  assert.equal(other.document.getText(), String.raw`\added{other}`);

  // Real read-only file attributes also prevent editable CodeLens actions.
  const readonlyPath = path.resolve(__dirname, '../../.cache/readonly-fixture.tex');
  fs.writeFileSync(readonlyPath, String.raw`\added{read only file}`);
  fs.chmodSync(readonlyPath, 0o444);
  try {
    const readonly = await vscode.workspace.openTextDocument(vscode.Uri.file(readonlyPath));
    editor = await vscode.window.showTextDocument(readonly, { preview: false });
    assert.equal(actionableLenses(await codeLenses(readonly)).length, 0);
    await vscode.commands.executeCommand(acceptCommand);
    assert.equal(readonly.getText(), String.raw`\added{read only file}`);
  } finally { fs.chmodSync(readonlyPath, 0o666); }

  // Dynamic CodeLens labels switch immediately among English, Chinese and Japanese.
  const languageCases = [
    { language: 'en', label: '✓ Accept' },
    { language: 'zh-CN', label: '✓ 接受' },
    { language: 'ja', label: '✓ 承認' }
  ];
  editor = await openLatex(String.raw`\added{language}`);
  for (const item of languageCases) {
    await config.update('uiLanguage', item.language, vscode.ConfigurationTarget.Global);
    const current = actionableLenses(await codeLenses(editor.document));
    assert.ok(current.some(lens => lens.command?.title.includes(item.label)),
      `Expected CodeLens label ${item.label} for language ${item.language}.`);
  }
  await config.update('uiLanguage', 'en', vscode.ConfigurationTarget.Global);

  // Turning review off removes lenses and commands leave the document unchanged.
  await vscode.commands.executeCommand(toggleCommand);

  editor = await openLatex(String.raw`\added{untouched}`);
  assert.equal((await codeLenses(editor.document)).length, 0);
  await vscode.commands.executeCommand(acceptCommand);
  assert.equal(editor.document.getText(), String.raw`\added{untouched}`);
  await vscode.commands.executeCommand(toggleCommand);


  assert.equal(editor.document.offsetAt(editor.selection.active), 0,
    'Enabling review locates the first available change.');
  editor = await openLatex(String.raw`prefix \added{located}`);
  await vscode.commands.executeCommand('latexReview.locateCurrent');
  assert.equal(editor.document.offsetAt(editor.selection.active), 7);
  const locateTarget = actionableLenses(await codeLenses(editor.document))[0].command!.arguments![0];
  editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
  await vscode.commands.executeCommand('latexReview.locateCurrent', locateTarget);
  assert.equal(editor.document.offsetAt(editor.selection.active), 7,
    'A captured locator returns to its own target.');

  // A non-LaTeX document must never receive review lenses.
  const plain = await vscode.workspace.openTextDocument({ language: 'plaintext', content: String.raw`\added{plain}` });
  await vscode.window.showTextDocument(plain, { preview: false });
  assert.equal((await codeLenses(plain)).length, 0);

  // A custom read-only filesystem provider exposes a supported LaTeX document that cannot be edited.
  const readonlyProvider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent: () => String.raw`\added{read only}`
  };
  const registration = vscode.workspace.registerTextDocumentContentProvider('reviewer-readonly', readonlyProvider);
  try {
    const uri = vscode.Uri.parse('reviewer-readonly:/readonly.tex');
    let readonlyDocument = await vscode.workspace.openTextDocument(uri);
    readonlyDocument = await vscode.languages.setTextDocumentLanguage(readonlyDocument, 'latex');
    editor = await vscode.window.showTextDocument(readonlyDocument, { preview: false });
    const before = editor.document.getText();
    await vscode.commands.executeCommand(acceptCommand);
    assert.equal(editor.document.getText(), before);
  } finally {
    registration.dispose();
  }
}

export async function run(): Promise<void> {
  await activateExtension();
  const initial = await openLatex(String.raw`\added{initial}`);
  if (!(await codeLenses(initial.document)).length) await vscode.commands.executeCommand(toggleCommand);
  await new Promise(resolve => setTimeout(resolve, 50));
  if (process.env.REVIEW_PACKAGED !== '1') {
    await runDevelopmentTests();
  }
  await runBehaviorTests();
  await runRecordingTests();
  console.log('LaTeX Change Reviewer integration checks passed.');
}
