import * as vscode from 'vscode';
import { access, constants } from 'node:fs/promises';
import { LatexChange, ParseResult } from './changeTypes';
import { parseChanges, replacementText } from './parser';
import { adjacentChange, currentChange, nextAfterEdit } from './navigation';
import { t } from './i18n';
import { decisionHint, ReviewUi } from './reviewUi';

interface Snapshot extends ParseResult { version: number }
export interface ReviewTarget { uri: string; version: number; start: number; end: number; source: string }

export class ReviewController implements vscode.Disposable, vscode.CodeLensProvider {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private readonly ui = new ReviewUi();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('latexReview');
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private enabled: boolean;
  private busy = false;
  private disposed = false;
  private updateSequence = 0;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.enabled = context.workspaceState.get('latexReview.enabled', false);
    this.disposables.push(this.changed, this.ui, this.diagnostics,
      vscode.languages.registerCodeLensProvider([{ language: 'latex' }, { pattern: '**/*.tex' }], this),
      vscode.commands.registerCommand('latexReview.acceptCurrent', (target?: ReviewTarget) => this.apply('accept', target)),
      vscode.commands.registerCommand('latexReview.rejectCurrent', (target?: ReviewTarget) => this.apply('reject', target)),
      vscode.commands.registerCommand('latexReview.nextChange', (target?: ReviewTarget) => this.navigate(1, target)),
      vscode.commands.registerCommand('latexReview.previousChange', (target?: ReviewTarget) => this.navigate(-1, target)),
      vscode.commands.registerCommand('latexReview.locateCurrent', (target?: ReviewTarget) => this.locate(target)),
      vscode.commands.registerCommand('latexReview.refresh', () => { this.snapshots.clear(); this.refresh(); }),
      vscode.commands.registerCommand('latexReview.toggleReview', () => this.toggle()),
      vscode.commands.registerCommand('latexReview.selectLanguage', () => this.selectLanguage()),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
      vscode.window.onDidChangeTextEditorSelection(() => { void this.updateUI(); }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('latexReview')) this.refresh();
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        const key = document.uri.toString();
        this.snapshots.delete(key); this.diagnostics.delete(document.uri);
        const timer = this.timers.get(key); if (timer) clearTimeout(timer);
        this.timers.delete(key);
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (!this.enabled || !this.supported(event.document) || !event.contentChanges.length) return;
        const key = event.document.uri.toString();
        const timer = this.timers.get(key); if (timer) clearTimeout(timer);
        this.timers.delete(key);
        // Never expose cached cursor-context as actionable while text is changing.
        void vscode.commands.executeCommand('setContext', 'latexReview.hasCurrent', false);
        if (this.busy || event.reason !== undefined) this.refresh();
        else this.timers.set(key, setTimeout(() => { this.timers.delete(key); this.refresh(); }, 200));
      })
    );
    this.refresh();
  }

  private supported(document: vscode.TextDocument): boolean {
    return document.languageId === 'latex' || /\.tex$/i.test(document.uri.path);
  }

  private snapshot(document: vscode.TextDocument): Snapshot {
    const key = document.uri.toString();
    let result = this.snapshots.get(key);
    if (!result || result.version !== document.version) {
      result = { ...parseChanges(document.getText()), version: document.version };
      this.snapshots.set(key, result);
    }
    return result;
  }

  private range(document: vscode.TextDocument, change: { start: number; end: number }): vscode.Range {
    return new vscode.Range(document.positionAt(change.start), document.positionAt(change.end));
  }

  private target(document: vscode.TextDocument, change: LatexChange): ReviewTarget {
    return { uri: document.uri.toString(), version: document.version, start: change.start,
      end: change.end, source: document.getText(this.range(document, change)) };
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (!this.enabled || !this.supported(document)) return [];
    const version = document.version;
    const writable = await this.writable(document);
    if (!this.enabled || document.isClosed || version !== document.version) return [];
    const changes = this.snapshot(document).changes.filter(change => !change.blocked);
    const lines = new Map<number, number>();
    changes.forEach(change => {
      const line = document.positionAt(change.start).line;
      lines.set(line, (lines.get(line) ?? 0) + 1);
    });
    const indexes = new Map<number, number>();
    return changes.flatMap(change => {
      const position = document.positionAt(change.start);
      const index = (indexes.get(position.line) ?? 0) + 1;
      indexes.set(position.line, index);
      const prefix = (lines.get(position.line) ?? 0) > 1 ? `[${index}] ` : '';
      const range = new vscode.Range(position, position);
      const target = this.target(document, change);
      return [
        ...(writable ? [
        new vscode.CodeLens(range, { title: `${prefix}✓ ${t('accept')}`, tooltip: decisionHint(change, 'accept'), command: 'latexReview.acceptCurrent', arguments: [target] }),
        new vscode.CodeLens(range, { title: `${prefix}✕ ${t('reject')}`, tooltip: decisionHint(change, 'reject'), command: 'latexReview.rejectCurrent', arguments: [target] }),
        ] : []),
        new vscode.CodeLens(range, { title: `${prefix}${t('next')} →`, command: 'latexReview.nextChange', arguments: [target] })
      ];
    });
  }

  private async writable(document: vscode.TextDocument): Promise<boolean> {
    if (document.isClosed) return false;
    if (document.uri.scheme === 'untitled') return true;
    if (vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) !== true) return false;
    try {
      const stat = await vscode.workspace.fs.stat(document.uri);
      if ((stat.permissions ?? 0) & vscode.FilePermission.Readonly) return false;
      if (document.uri.scheme === 'file') await access(document.uri.fsPath, constants.W_OK);
      return true;
    } catch { return false; }
  }

  private refresh(): void {
    if (this.disposed) return;
    if (!this.enabled) this.diagnostics.clear();
    else {
      for (const editor of vscode.window.visibleTextEditors) {
        const document = editor.document;
        if (!this.supported(document)) continue;
        const result = this.snapshot(document);
        this.diagnostics.set(document.uri, result.issues.map(issue => {
          const diagnostic = new vscode.Diagnostic(this.range(document, issue), t('parseError'), vscode.DiagnosticSeverity.Warning);
          diagnostic.source = 'LaTeX Review'; diagnostic.code = issue.message;
          return diagnostic;
        }));
      }
    }
    this.changed.fire();
    void this.updateUI();
  }

  private async updateUI(): Promise<void> {
    const sequence = ++this.updateSequence;
    const editor = vscode.window.activeTextEditor;
    const supported = !!editor && this.supported(editor.document);
    const enabled = this.enabled;
    const pending = supported && this.timers.has(editor!.document.uri.toString());
    const result = enabled && supported ? (pending ? this.snapshots.get(editor!.document.uri.toString()) : this.snapshot(editor!.document)) : undefined;
    const current = result && !pending ? currentChange(result.changes.filter(change => !change.blocked), editor!.document.offsetAt(editor!.selection.active)) : undefined;
    const writable = supported ? await this.writable(editor!.document) : false;
    if (this.disposed || sequence !== this.updateSequence) return;
    await Promise.all([
      vscode.commands.executeCommand('setContext', 'latexReview.supported', supported),
      vscode.commands.executeCommand('setContext', 'latexReview.enabled', enabled),
      vscode.commands.executeCommand('setContext', 'latexReview.hasCurrent', !!current),
      vscode.commands.executeCommand('setContext', 'latexReview.writable', writable),
      vscode.commands.executeCommand('setContext', 'latexReview.busy', this.busy)
    ]);
    if (this.disposed || sequence !== this.updateSequence) return;
    const changes = result?.changes.filter(change => !change.blocked) ?? [];
    const offset = editor ? editor.document.offsetAt(editor.selection.active) : 0;
    const previous = !pending ? adjacentChange(changes, offset, -1) : undefined;
    const next = !pending ? adjacentChange(changes, offset, 1) : undefined;
    this.ui.render({ editor, supported, enabled, busy: this.busy, writable, pending: !!pending,
      current, target: current && editor ? this.target(editor.document, current) : undefined,
      previous: previous && editor ? this.target(editor.document, previous) : undefined,
      next: next && editor ? this.target(editor.document, next) : undefined,
      index: current ? changes.indexOf(current) + 1 : 0, count: changes.length, issues: result?.issues.length ?? 0 });
  }

  private async toggle(): Promise<void> {
    if (this.busy) return;
    this.enabled = !this.enabled;
    await this.context.workspaceState.update('latexReview.enabled', this.enabled);
    this.refresh();
    if (this.enabled) await this.locate();
  }

  private async selectLanguage(): Promise<void> {
    const items = [
      { label: t('languageAuto'), value: 'auto' }, { label: '简体中文', value: 'zh-CN' },
      { label: 'English', value: 'en' }, { label: '日本語', value: 'ja' }
    ];
    const selected = await vscode.window.showQuickPick(items, { title: t('languageTitle') });
    if (selected) {
      const configuration = vscode.workspace.getConfiguration('latexReview');
      const scope = configuration.inspect<string>('uiLanguage')?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      await configuration.update('uiLanguage', selected.value, scope);
    }
  }

  private validatedTarget(document: vscode.TextDocument, target: ReviewTarget): LatexChange | undefined {
    if (document.version !== target.version || document.uri.toString() !== target.uri) return undefined;
    const change = this.snapshot(document).changes.find(item => !item.blocked && item.start === target.start && item.end === target.end);
    return change && document.getText(this.range(document, change)) === target.source ? change : undefined;
  }

  private async resolveEditor(target?: ReviewTarget): Promise<vscode.TextEditor | undefined> {
    if (!target) return vscode.window.activeTextEditor;
    const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === target.uri);
    if (!document || !this.validatedTarget(document, target)) {
      void vscode.window.showInformationMessage(t('stale')); this.refresh(); return undefined;
    }
    const visible = vscode.window.visibleTextEditors.find(item => item.document === document);
    if (!visible) { void vscode.window.showInformationMessage(t('stale')); return undefined; }
    if (vscode.window.activeTextEditor === visible) return visible;
    return vscode.window.showTextDocument(document, { viewColumn: visible.viewColumn, preserveFocus: false });
  }

  private reveal(editor: vscode.TextEditor, change: LatexChange): void {
    const position = editor.document.positionAt(change.start);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(this.range(editor.document, change), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    void this.updateUI();
  }

  private async locate(target?: ReviewTarget): Promise<void> {
    if (!this.enabled || this.busy) return;
    const editor = await this.resolveEditor(target);
    if (!editor || !this.supported(editor.document)) return;
    const changes = this.snapshot(editor.document).changes.filter(change => !change.blocked);
    const offset = editor.document.offsetAt(editor.selection.active);
    const change = target ? this.validatedTarget(editor.document, target) : currentChange(changes, offset)
      ?? changes.find(item => item.start >= offset) ?? changes[0];
    if (change) this.reveal(editor, change);
  }

  private async navigate(direction: 1 | -1, target?: ReviewTarget): Promise<void> {
    if (!this.enabled || this.busy) return;
    const editor = await this.resolveEditor(target);
    if (!editor || !this.supported(editor.document)) return;
    if (target && !this.validatedTarget(editor.document, target)) { this.refresh(); return; }
    const offset = target?.start ?? editor.document.offsetAt(editor.selection.active);
    const next = adjacentChange(this.snapshot(editor.document).changes.filter(change => !change.blocked), offset, direction);
    if (next) this.reveal(editor, next);
    else void vscode.window.showInformationMessage(t('end'));
  }

  private async apply(decision: 'accept' | 'reject', target?: ReviewTarget): Promise<void> {
    if (!this.enabled || this.busy) return;
    this.busy = true;
    void vscode.commands.executeCommand('setContext', 'latexReview.busy', true);
    try {
      const editor = await this.resolveEditor(target);
      if (!editor || !this.supported(editor.document)) return;
      const document = editor.document;
      const change = target ? this.validatedTarget(document, target)
        : currentChange(this.snapshot(document).changes.filter(change => !change.blocked), document.offsetAt(editor.selection.active));
      if (!change) { void vscode.window.showInformationMessage(t(target ? 'stale' : 'noCurrent')); return; }
      const version = document.version;
      if (!await this.writable(document)) { void vscode.window.showWarningMessage(t('readonly')); return; }
      if (document.version !== version || !this.enabled || document.isClosed) {
        void vscode.window.showInformationMessage(t('stale')); return;
      }
      const text = document.getText();
      const replacement = replacementText(text, change, decision);
      const boundary = text.slice(0, change.start) + replacement;
      const glue = /\\[A-Za-z]+$/.test(boundary) && /^[A-Za-z]/.test(text.slice(change.end));
      const success = await editor.edit(builder => builder.replace(this.range(document, change), replacement),
        { undoStopBefore: true, undoStopAfter: true });
      if (!success) { void vscode.window.showWarningMessage(t('readonly')); return; }
      if (glue) void vscode.window.showWarningMessage(t('glue'));
      const updated = this.snapshot(document);
      if (vscode.workspace.getConfiguration('latexReview', document.uri).get('autoGoToNext', true)) {
        const next = nextAfterEdit(updated.changes.filter(item => !item.blocked), change.start);
        if (next) this.reveal(editor, next);
        else editor.selection = new vscode.Selection(document.positionAt(change.start), document.positionAt(change.start));
      }
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.snapshots.clear();
    for (const disposable of this.disposables) disposable.dispose();
    for (const name of ['supported', 'enabled', 'hasCurrent', 'writable', 'busy']) {
      void vscode.commands.executeCommand('setContext', `latexReview.${name}`, false);
    }
  }
}
