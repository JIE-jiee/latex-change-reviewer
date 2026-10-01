import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const toggleTracking = 'latexReview.toggleTracking';
const acceptCurrent = 'latexReview.acceptCurrent';

async function openLatex(source: string): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument({ language: 'latex', content: source });
  return vscode.window.showTextDocument(document, { preview: false });
}

async function waitForRecording(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 750));
}

function setCursor(editor: vscode.TextEditor, offset: number): void {
  const position = editor.document.positionAt(offset);
  editor.selection = new vscode.Selection(position, position);
}

async function ensureReviewEnabled(editor: vscode.TextEditor): Promise<void> {
  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
    'vscode.executeCodeLensProvider', editor.document.uri, 1000
  );
  if (!lenses?.length) await vscode.commands.executeCommand('latexReview.toggleReview');
}

export async function runRecordingTests(): Promise<void> {
  // Native typing should be recorded as a single undoable edit with its revision wrapper.
  let editor = await openLatex('');
  await vscode.commands.executeCommand(toggleTracking);
  await vscode.commands.executeCommand('type', { text: 'typed text' });
  await waitForRecording();
  const recorded = editor.document.getText();
  assert.match(recorded, /^\\added(?:\[[^\]]*\])?\{typed text\}$/,
    `Typing should become an added revision in its original undo step. Actual: ${JSON.stringify(recorded)}`);
  await vscode.commands.executeCommand('undo');
  assert.equal(editor.document.getText(), '', 'One undo should remove both the wrapper and typed text.');
  await vscode.commands.executeCommand('redo');
  assert.equal(editor.document.getText(), recorded, 'One redo should restore the recorded revision.');
  await vscode.commands.executeCommand(toggleTracking);

  // Continued typing inside a generated added branch remains one revision and one undo step.
  editor = await openLatex('');
  await vscode.commands.executeCommand(toggleTracking);
  await vscode.commands.executeCommand('type', { text: 'hello' });
  await waitForRecording();
  assert.equal(editor.document.getText(), String.raw`\added{hello}`);
  await vscode.commands.executeCommand('type', { text: ' world' });
  await waitForRecording();
  const continued = String.raw`\added{hello world}`;
  assert.equal(editor.document.getText(), continued,
    'Typing at the generated wrapper cursor should update its body rather than nest a revision.');
  await vscode.commands.executeCommand('undo');
  assert.equal(editor.document.getText(), '', 'One undo should remove the entire continued typing process.');
  await vscode.commands.executeCommand(toggleTracking);

  // Backspacing across a generated deletion keeps source order; typing at it turns it into a replacement.
  editor = await openLatex('ABCD');
  setCursor(editor, editor.document.getText().length);
  await vscode.commands.executeCommand(toggleTracking);
  await vscode.commands.executeCommand('latexReview.trackingDeleteLeft');
  await waitForRecording();
  assert.equal(editor.document.getText(), String.raw`ABC\deleted{D}`);
  await vscode.commands.executeCommand('latexReview.trackingDeleteLeft');
  await waitForRecording();
  assert.equal(editor.document.getText(), String.raw`AB\deleted{CD}`,
    'A second backspace should merge the older deleted character before the previous one.');
  await vscode.commands.executeCommand('type', { text: 'x' });
  await waitForRecording();
  const replacedDeletion = String.raw`AB\replaced{x}{CD}`;
  assert.equal(editor.document.getText(), replacedDeletion,
    'Typing at a generated deletion should replace its old text.');
  await vscode.commands.executeCommand(toggleTracking);

  // Editing an existing replacement's new branch leaves the original branch intact.
  editor = await openLatex(String.raw`\replaced{new}{old}`);
  const newBodyEnd = editor.document.getText().indexOf('{new}') + 4;
  setCursor(editor, newBodyEnd);
  await vscode.commands.executeCommand(toggleTracking);
  await vscode.commands.executeCommand('type', { text: 'er' });
  await waitForRecording();
  assert.equal(editor.document.getText(), String.raw`\replaced{newer}{old}`);
  await vscode.commands.executeCommand(toggleTracking);

  // The dedicated paste route reads the system clipboard and restores its original value afterward.
  editor = await openLatex('');
  const originalClipboard = await vscode.env.clipboard.readText();
  try {
    await vscode.env.clipboard.writeText('pasted text');
    await vscode.commands.executeCommand(toggleTracking);
    await vscode.commands.executeCommand('latexReview.trackingPaste');
    await waitForRecording();
    assert.equal(editor.document.getText(), String.raw`\added{pasted text}`);
  } finally {
    await vscode.env.clipboard.writeText(originalClipboard);
    await vscode.commands.executeCommand(toggleTracking);
  }

  // Unsupported paragraph-spanning edits remain visible and pause later automatic recording.
  editor = await openLatex('one\n\ntwo');
  editor.selection = new vscode.Selection(editor.document.positionAt(1), editor.document.positionAt(7));
  await vscode.commands.executeCommand(toggleTracking);
  await vscode.commands.executeCommand('type', { text: 'x' });
  await waitForRecording();
  assert.equal(editor.document.getText(), 'oxo', "The user's paragraph-spanning edit should remain in the document.");
  setCursor(editor, editor.document.getText().length);
  await vscode.commands.executeCommand('type', { text: '!' });
  await waitForRecording();
  assert.equal(editor.document.getText(), 'oxo!', 'A paused recorder should keep subsequent native text unwrapped.');
  await vscode.commands.executeCommand(toggleTracking);

  // During composition the raw text remains untouched until compositionEnd.
  editor = await openLatex('');
  await vscode.commands.executeCommand(toggleTracking);
  await vscode.commands.executeCommand('compositionStart', {});
  await vscode.commands.executeCommand('type', { text: 'かな' });
  await waitForRecording();
  assert.equal(editor.document.getText(), 'かな', 'Composition text must not be wrapped before compositionEnd.');
  await vscode.commands.executeCommand('compositionEnd', {});
  await waitForRecording();
  assert.match(editor.document.getText(), /^\\added(?:\[[^\]]*\])?\{かな\}$/,
    'Composition text should be recorded after compositionEnd.');
  await vscode.commands.executeCommand(toggleTracking);

  // Review edits made while tracking is active are internal edits, not new recorded revisions.
  editor = await openLatex(String.raw`\added{reviewed} `);
  await ensureReviewEnabled(editor);
  await vscode.commands.executeCommand(toggleTracking);
  await vscode.commands.executeCommand(acceptCurrent);
  assert.equal(editor.document.getText(), 'reviewed ');
  await waitForRecording();
  assert.equal(editor.document.getText(), 'reviewed ', 'Accepting a review change must not be recorded again.');
  await vscode.commands.executeCommand(toggleTracking);

  // Accepting a revision with attached metadata removes the metadata with the wrapper.
  editor = await openLatex(String.raw`\added[id=alice, comment={review note}]{kept}`);
  setCursor(editor, 0);
  await ensureReviewEnabled(editor);
  const attachedLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', editor.document.uri, 1000);
  const attachedAccept = attachedLenses.find(item => item.command?.command === acceptCurrent)?.command;
  assert.ok(attachedAccept);
  await vscode.commands.executeCommand(acceptCurrent, ...(attachedAccept.arguments ?? []));
  assert.equal(editor.document.getText(), 'kept');
  assert.doesNotMatch(editor.document.getText(), /comment=/);

  // Right-click commands supply a URI, which must still resolve the cursor target.
  editor = await openLatex(String.raw`\added[comment={note}]{kept}`);
  setCursor(editor, 2);
  await vscode.commands.executeCommand('latexReview.removeComment', editor.document.uri);
  assert.equal(editor.document.getText(), String.raw`\added[]{kept}`);
  await vscode.commands.executeCommand('undo');
  assert.equal(editor.document.getText(), String.raw`\added[comment={note}]{kept}`);
  await vscode.commands.executeCommand(acceptCurrent, editor.document.uri);
  assert.equal(editor.document.getText(), 'kept');

  // Large plain documents retain a single revision during rapid successive input.
  const large = ('A complete paragraph of ordinary text.\n').repeat(4000);
  editor = await openLatex(large);
  setCursor(editor, large.length);
  await vscode.commands.executeCommand(toggleTracking);
  const began = Date.now();
  for (const letter of 'rapid continuous input') await vscode.commands.executeCommand('type', { text: letter });
  assert.equal(editor.document.getText(), large + String.raw`\added{rapid continuous input}`);
  console.log(`Recording benchmark: ${large.length} source characters, 22 input commands, ${Date.now() - began} ms.`);
  await vscode.commands.executeCommand('undo');
  assert.equal(editor.document.getText(), large);
  await vscode.commands.executeCommand(toggleTracking);

  // If writability changes after recording starts, preserve the input for recovery.
  const fileEvents = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  let readonly = false;
  const provider = vscode.workspace.registerFileSystemProvider('recording-race', {
    onDidChangeFile: fileEvents.event,
    watch: () => new vscode.Disposable(() => undefined),
    stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 4,
      permissions: readonly ? vscode.FilePermission.Readonly : undefined }),
    readFile: () => Buffer.from('base'), readDirectory: () => [],
    createDirectory: () => undefined, writeFile: () => undefined,
    delete: () => undefined, rename: () => undefined
  });
  try {
    editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.parse('recording-race:/test.tex')));
    setCursor(editor, 4);
    await vscode.commands.executeCommand(toggleTracking);
    readonly = true;
    await vscode.commands.executeCommand('type', { text: 'recover this input' });
    assert.equal(editor.document.getText(), 'base', 'A newly read-only file must not be modified.');
    await vscode.commands.executeCommand('latexReview.showPendingInput');
    assert.equal(vscode.window.activeTextEditor?.document.getText(), 'recover this input',
      'Input that could not be written must remain available in a read-only recovery view.');
  } finally { provider.dispose(); fileEvents.dispose(); }
}
