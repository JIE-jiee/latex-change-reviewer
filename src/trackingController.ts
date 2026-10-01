import * as vscode from 'vscode';
import { trackEdit, makeRevision, mergeChanges, SourceEdit } from './changeTransforms';
import { parseChanges } from './parser';
import { f, explainReason } from './featureStrings';
import { LatexChange } from './changeTypes';

interface Recording {
  document: vscode.TextDocument;
  snapshot: string;
  baseline?: string;
  version: number;
  timer?: ReturnType<typeof setTimeout>;
  paused?: string;
  busy: boolean;
  session?: { start: number; end: number };
  cursor?: number;
  pending?: SourceEdit;
  current?: LatexChange;
  pendingInput?: string;
}

/** Recording stays in memory and is scoped to each open document. */
export class TrackingController implements vscode.Disposable {
  private readonly states = new Map<string, Recording>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly status = vscode.window.createStatusBarItem('latexReview.tracking', vscode.StatusBarAlignment.Left, 91);
  private internal = new Set<string>();
  private composing = false;
  private hooksAvailable = false;
  private warned = false;
  private readonly diffs = new Map<string, string>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly writable: (document: vscode.TextDocument) => Promise<boolean>) {
    this.status.command = 'latexReview.toggleTracking';
    this.status.name = 'LaTeX Review: Track changes';
    this.disposables.push(this.status,
      vscode.commands.registerCommand('latexReview.toggleTracking', () => this.toggle()),
      vscode.commands.registerCommand('latexReview.showTrackingDiff', () => this.showDiff()),
      vscode.commands.registerCommand('latexReview.showPendingInput', () => this.showPendingInput()),
      vscode.commands.registerCommand('latexReview.markAddition', () => this.mark('addition')),
      vscode.commands.registerCommand('latexReview.markDeletion', () => this.mark('deletion')),
      vscode.commands.registerCommand('latexReview.replaceWithRevision', () => this.mark('replace')),
      vscode.commands.registerCommand('latexReview.mergeSelectedChanges', () => this.merge()),
      vscode.commands.registerCommand('latexReview.trackingDeleteLeft', () => this.nativeAction('left')),
      vscode.commands.registerCommand('latexReview.trackingDeleteRight', () => this.nativeAction('right')),
      vscode.commands.registerCommand('latexReview.trackingPaste', () => this.nativeAction('paste')),
      vscode.commands.registerCommand('latexReview.trackingCut', () => this.nativeAction('cut')),
      vscode.workspace.registerTextDocumentContentProvider('latex-review-snapshot', {
        provideTextDocumentContent: uri => this.diffs.get(uri.toString()) ?? ''
      }),
      vscode.workspace.onDidChangeTextDocument(event => this.changed(event)),
      vscode.window.onDidChangeActiveTextEditor(() => {
        for (const state of this.states.values()) { void this.flush(state.document); state.session = undefined; }
        this.render();
      }),
      vscode.window.onDidChangeTextEditorSelection(event => {
        const state = this.states.get(event.textEditor.document.uri.toString());
        if (state && event.kind !== undefined && event.kind !== vscode.TextEditorSelectionChangeKind.Command) {
          if (state.baseline !== undefined && event.kind === vscode.TextEditorSelectionChangeKind.Mouse) void this.flush(state.document);
          if (event.kind === vscode.TextEditorSelectionChangeKind.Mouse) state.session = undefined;
          if (event.kind === vscode.TextEditorSelectionChangeKind.Keyboard && state.baseline === undefined &&
            state.cursor !== event.textEditor.document.offsetAt(event.textEditor.selection.active)) state.session = undefined;
        }
      }),
      vscode.workspace.onWillSaveTextDocument(event => {
        if (this.states.has(event.document.uri.toString())) event.waitUntil(this.flush(event.document).then(ok => {
          if (!ok) void vscode.window.showWarningMessage(f('trackingPaused'));
          return [];
        }));
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        const state = this.states.get(document.uri.toString());
        if (state?.timer) clearTimeout(state.timer);
        if (state?.paused || state?.baseline !== undefined) void vscode.window.showWarningMessage(f('trackingPaused'));
        this.states.delete(document.uri.toString()); this.render();
      }),
      vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('latexReview')) this.render(); })
    );
    // Composition stays native. Ordinary supported input is converted before
    // editing so that its text and revision wrapper share the same undo step.
    try {
      const start = vscode.commands.registerCommand('compositionStart', async (args: unknown) => {
        this.composing = true;
        for (const state of this.states.values()) if (state.timer) clearTimeout(state.timer);
        await vscode.commands.executeCommand('default:compositionStart', args);
      });
      this.disposables.push(start);
      const end = vscode.commands.registerCommand('compositionEnd', async (args: unknown) => {
        this.composing = false;
        for (const state of this.states.values()) if (state.baseline !== undefined) await this.flush(state.document);
        await vscode.commands.executeCommand('default:compositionEnd', args);
      });
      this.disposables.push(end); this.hooksAvailable = true;
      this.disposables.push(vscode.commands.registerCommand('type', (args: { text: string }) => {
        const editor = vscode.window.activeTextEditor;
        const state = editor && this.states.get(editor.document.uri.toString());
        if (!editor || !state || state.paused || this.composing) return vscode.commands.executeCommand('default:type', args);
        return this.enqueue(editor, () => this.recordNative(editor, args.text));
      }), vscode.commands.registerCommand('paste', (args: { text: string }) => {
        const editor = vscode.window.activeTextEditor;
        const state = editor && this.states.get(editor.document.uri.toString());
        if (!editor || !state || state.paused || this.composing) return vscode.commands.executeCommand('default:paste', args);
        return this.enqueue(editor, () => this.recordNative(editor, args.text, undefined, true));
      }), vscode.commands.registerCommand('cut', (args: unknown) => {
        const editor = vscode.window.activeTextEditor;
        const state = editor && this.states.get(editor.document.uri.toString());
        if (!editor || !state || state.paused || this.composing) return vscode.commands.executeCommand('default:cut', args);
        if (editor.selection.isEmpty) {
          this.pause(state, 'Cutting whole lines is not supported.');
          return vscode.commands.executeCommand('default:cut', args);
        }
        return this.enqueue(editor, () => this.recordNative(editor, '', undefined, true));
      }));
    } catch { this.hooksAvailable = false; }
    this.render();
  }

  private supported(document: vscode.TextDocument): boolean {
    return document.languageId === 'latex' || /\.tex$/i.test(document.uri.path);
  }

  private enqueue(editor: vscode.TextEditor, action: () => Promise<unknown>): Promise<void> {
    const key = editor.document.uri.toString();
    const promise = (this.queues.get(key) ?? Promise.resolve()).then(async () => { await action(); });
    this.queues.set(key, promise.catch(() => undefined));
    return promise;
  }

  private async nativeAction(kind: 'left' | 'right' | 'paste' | 'cut'): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const state = editor && this.states.get(editor.document.uri.toString());
    const fallback = kind === 'left' ? 'deleteLeft' : kind === 'right' ? 'deleteRight'
      : kind === 'paste' ? 'editor.action.clipboardPasteAction' : 'editor.action.clipboardCutAction';
    if (!editor || !state || state.paused || this.composing) { await vscode.commands.executeCommand(fallback); return; }
    await this.enqueue(editor, async () => {
      if (editor.selections.length !== 1) {
        state.baseline = editor.document.getText();
        this.pause(state, 'Multiple cursors cannot be recorded.');
        await vscode.commands.executeCommand(fallback);
        return;
      }
      let start = editor.document.offsetAt(editor.selection.start), end = editor.document.offsetAt(editor.selection.end);
      const source = editor.document.getText();
      let inserted = '';
      if (kind === 'paste') inserted = await vscode.env.clipboard.readText();
      if (kind === 'cut') {
        if (start === end) { this.pause(state, 'Cutting whole lines is not supported.'); await vscode.commands.executeCommand(fallback); return; }
        await vscode.env.clipboard.writeText(source.slice(start, end));
      }
      if (start === end && (kind === 'left' || kind === 'right')) {
        if (kind === 'left') {
          const units = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(source.slice(0, start))];
          start = units.at(-1)?.index ?? start;
        } else {
          // The old text is retained in a deleted macro; Delete continues after it.
          const deleted = state.session && parseChanges(source).changes.find(item => item.start === start && item.start === state.session!.start && item.type === 'deleted');
          if (deleted) start = end = deleted.end;
          const unit = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(source.slice(end))[Symbol.iterator]().next().value;
          end += unit?.segment.length ?? 0;
        }
      }
      if (start === end && !inserted) return;
      await this.recordNative(editor, inserted, { start, end }, kind === 'paste' || kind === 'cut');
    });
  }

  private async recordNative(editor: vscode.TextEditor, text: string, offsets?: { start: number; end: number }, separate = false): Promise<void> {
    const document = editor.document;
    const state = this.states.get(document.uri.toString());
    if (!state || state.paused) return;
    const version = document.version, source = document.getText();
    const edit = { start: offsets?.start ?? document.offsetAt(editor.selection.start), end: offsets?.end ?? document.offsetAt(editor.selection.end), text };
    if (editor.selections.length !== 1) {
      state.baseline = source; this.pause(state, 'Multiple cursors cannot be recorded.');
      await vscode.commands.executeCommand('default:type', { text }); return;
    }
    const known = state.session && state.current;
    const body = known && source.slice(known.args[0].start, known.args[0].end);
    const plainBranch = known && known.type !== 'deleted' && !known.children.length &&
      edit.start >= known.args[0].start && edit.end <= known.args[0].end &&
      !/[\\{}$%]/.test(body ?? '') && !/[\\{}$%]/.test(text) && !/\r?\n\s*\r?\n/.test(text);
    const changedBody = plainBranch ? body!.slice(0, edit.start - known.args[0].start) + text + body!.slice(edit.end - known.args[0].start) : undefined;
    const oldBody = known?.type === 'replaced' ? source.slice(known.args[1].start, known.args[1].end) : undefined;
    const fast = plainBranch && changedBody !== '' && changedBody !== oldBody && !/\r?\n\s*\r?\n/.test(changedBody ?? '');
    const result = fast ? { edit: { start: edit.start, end: edit.start + text.length, text }, cursor: edit.start + text.length }
      : trackEdit(source, edit, vscode.workspace.getConfiguration('latexReview', document.uri).get<string>('authorId', '') || undefined, state.session);
    if ('reason' in result) {
      state.baseline = source;
      // Keep the user's actual requested edit, then stop recording this file.
      this.internal.add(document.uri.toString());
      try { await editor.edit(builder => builder.replace(new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), text)); }
      finally { this.internal.delete(document.uri.toString()); }
      state.baseline = source; this.pause(state, result.reason); return;
    }
    const after = source.slice(0, edit.start) + text + source.slice(edit.end);
    const final = after.slice(0, result.edit.start) + result.edit.text + after.slice(result.edit.end);
    let start = 0, oldEnd = source.length, newEnd = final.length;
    while (start < oldEnd && start < newEnd && source[start] === final[start]) start++;
    while (oldEnd > start && newEnd > start && source[oldEnd - 1] === final[newEnd - 1]) { oldEnd--; newEnd--; }
    if (!await this.writable(document) || document.version !== version || document.isClosed) {
      state.pendingInput = text;
      state.baseline = source; this.pause(state, 'The document changed before the input could be recorded.'); return;
    }
    const key = document.uri.toString(); this.internal.add(key);
    state.busy = true;
    try {
      const ok = await editor.edit(builder => builder.replace(new vscode.Range(document.positionAt(start), document.positionAt(oldEnd)), final.slice(start, newEnd)),
        { undoStopBefore: separate || !state.session, undoStopAfter: separate });
      if (!ok) { state.pendingInput = text; this.pause(state, 'The editor could not record the input.'); return; }
      const position = document.positionAt(result.cursor);
      editor.selection = new vscode.Selection(position, position);
      state.cursor = result.cursor;
      state.snapshot = document.getText(); state.version = document.version;
      const delta = text.length - (edit.end - edit.start);
      const created = fast && known ? { ...known, end: known.end + delta,
        args: known.args.map((arg, index) => index === 0 ? { ...arg, end: arg.end + delta } : { start: arg.start + delta, end: arg.end + delta }) }
        : parseChanges(state.snapshot).changes.find(item => result.cursor >= item.start && result.cursor <= item.end);
      state.current = created;
      state.session = created && { start: created.start, end: created.end };
      this.render();
    } finally { state.busy = false; this.internal.delete(key); }
  }

  async beforeAction(editor: vscode.TextEditor): Promise<boolean> {
    if (this.composing) return false;
    const result = await this.flush(editor.document);
    const state = this.states.get(editor.document.uri.toString());
    if (state) state.session = undefined;
    return result;
  }

  async edit(editor: vscode.TextEditor, range: vscode.Range, text: string): Promise<boolean> {
    const version = editor.document.version;
    if (!await this.beforeAction(editor) || !await this.writable(editor.document) || editor.document.version !== version) return false;
    const key = editor.document.uri.toString();
    this.internal.add(key);
    try {
      return await editor.edit(builder => builder.replace(range, text), { undoStopBefore: true, undoStopAfter: true });
    } finally { this.internal.delete(key); }
  }

  private async toggle(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.supported(editor.document) || !await this.writable(editor.document)) {
      void vscode.window.showWarningMessage(f('unsupportedTracking')); return;
    }
    const key = editor.document.uri.toString();
    await this.queues.get(key);
    const state = this.states.get(key);
    if (state) {
      if (state.paused || await this.flush(editor.document)) this.states.delete(key);
    } else {
      if (!this.hooksAvailable) { void vscode.window.showWarningMessage(f('trackingExperimentalWarning')); return; }
      if (!this.warned) { this.warned = true; void vscode.window.showWarningMessage(f('trackingExperimentalWarning')); }
      this.states.set(key, { document: editor.document, snapshot: editor.document.getText(), version: editor.document.version, busy: false });
    }
    this.render();
  }

  private changed(event: vscode.TextDocumentChangeEvent): void {
    const key = event.document.uri.toString();
    const state = this.states.get(key);
    if (!state || !event.contentChanges.length) return;
    if (this.internal.has(key) || event.reason !== undefined) {
      if (state.timer) clearTimeout(state.timer);
      state.baseline = undefined; state.snapshot = event.document.getText(); state.version = event.document.version;
      state.pending = undefined;
      if (event.reason !== undefined) state.session = undefined;
      this.render(); return;
    }
    if (state.paused) return;
    if (!this.composing) {
      state.baseline ??= state.snapshot;
      this.pause(state, 'This edit did not come from a supported input command; it was kept without a revision.'); return;
    }
    if (state.busy || event.contentChanges.length !== 1 ||
      vscode.window.activeTextEditor?.document !== event.document ||
      vscode.window.activeTextEditor.selections.length !== 1) {
      this.pause(state, 'Multiple edits or a competing editor change cannot be recorded safely.'); return;
    }
    state.baseline ??= state.snapshot;
    const change = event.contentChanges[0];
    const edit = { start: change.rangeOffset, end: change.rangeOffset + change.rangeLength, text: change.text };
    if (!state.pending) state.pending = edit;
    else {
      const pending = state.pending;
      const delta = pending.text.length - (pending.end - pending.start);
      const map = (offset: number, ending: boolean): number => offset <= pending.start ? offset
        : offset >= pending.start + pending.text.length ? offset - delta : ending ? pending.end : pending.start;
      const start = Math.min(pending.start, map(edit.start, false));
      const end = Math.max(pending.end, map(edit.end, true));
      const totalDelta = event.document.getText().length - state.baseline.length;
      state.pending = { start, end, text: event.document.getText().slice(start, end + totalDelta) };
    }
    state.snapshot = event.document.getText(); state.version = event.document.version;
    this.schedule(state); this.render();
  }

  private schedule(state: Recording): void {
    if (state.timer) clearTimeout(state.timer);
    if (!this.composing) state.timer = setTimeout(() => { state.timer = undefined; void this.flush(state.document); }, 500);
  }

  async flush(document: vscode.TextDocument, inQueue = false): Promise<boolean> {
    if (!inQueue) await this.queues.get(document.uri.toString());
    const state = this.states.get(document.uri.toString());
    if (!state) return true;
    if (state.paused || state.busy || this.composing) return false;
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined;
    if (state.baseline === undefined) return true;
    const before = state.baseline, after = document.getText();
    if (before === after) { state.baseline = undefined; state.pending = undefined; return true; }
    const pending = state.pending;
    if (!pending || before.slice(0, pending.start) + pending.text + before.slice(pending.end) !== after) {
      this.pause(state, 'The pending edit no longer matches its snapshot.'); return false;
    }
    const result = trackEdit(before, pending,
      vscode.workspace.getConfiguration('latexReview', document.uri).get<string>('authorId', '') || undefined, state.session);
    if ('reason' in result) { this.pause(state, result.reason); return false; }
    const editor = vscode.window.visibleTextEditors.find(item => item.document === document);
    if (!editor || document.version !== state.version || !await this.writable(document) || document.version !== state.version) {
      this.pause(state, 'The document changed before recording completed.'); return false;
    }
    state.busy = true;
    const key = document.uri.toString(); this.internal.add(key);
    try {
      const range = new vscode.Range(document.positionAt(result.edit.start), document.positionAt(result.edit.end));
      const ok = await editor.edit(builder => builder.replace(range, result.edit.text), { undoStopBefore: false, undoStopAfter: false });
      if (!ok) { this.pause(state, 'The editor could not apply the revision.'); return false; }
      const position = document.positionAt(result.cursor);
      editor.selection = new vscode.Selection(position, position);
      state.cursor = result.cursor;
      state.baseline = undefined; state.snapshot = document.getText(); state.version = document.version;
      state.pending = undefined;
      const created = parseChanges(state.snapshot).changes.find(change => result.cursor >= change.start && result.cursor <= change.end);
      state.current = created;
      state.session = created && { start: created.start, end: created.end };
      return true;
    } finally { this.internal.delete(key); state.busy = false; this.render(); }
  }

  private pause(state: Recording, reason: string): void {
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined; state.paused = reason;
    this.render();
    void vscode.window.showWarningMessage(`${f('trackingPaused')}: ${explainReason(reason)}`, ...[
      f('trackingDiff'), ...(state.pendingInput ? [f('pendingInput')] : []), f('trackingUndo'), f('resumeTracking')
    ]).then(async choice => {
      if (choice === f('trackingDiff')) await this.showDiff(state.document);
      if (choice === f('pendingInput')) await this.showPendingInput(state.document);
      if (choice === f('trackingUndo')) await vscode.commands.executeCommand('undo');
      if (choice === f('resumeTracking')) { state.paused = undefined; state.baseline = undefined; state.pending = undefined; state.session = undefined; state.current = undefined; state.snapshot = state.document.getText(); state.version = state.document.version; this.render(); }
    });
  }

  private async showDiff(document = vscode.window.activeTextEditor?.document): Promise<void> {
    if (!document) return;
    const state = this.states.get(document.uri.toString()); if (!state) return;
    const uri = vscode.Uri.parse(`latex-review-snapshot:/${encodeURIComponent(document.uri.toString())}/${document.version}.tex`);
    this.diffs.set(uri.toString(), state.baseline ?? state.snapshot);
    await vscode.commands.executeCommand('vscode.diff', uri, document.uri, f('trackingDiff'));
  }

  private async showPendingInput(document = vscode.window.activeTextEditor?.document): Promise<void> {
    const state = document && this.states.get(document.uri.toString());
    if (!state?.pendingInput) return;
    const uri = vscode.Uri.parse(`latex-review-snapshot:/pending-input/${encodeURIComponent(document!.uri.toString())}/${document!.version}.txt`);
    this.diffs.set(uri.toString(), state.pendingInput);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false });
  }

  private async mark(kind: 'addition' | 'deletion' | 'replace'): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.supported(editor.document) || !await this.beforeAction(editor)) return;
    const document = editor.document, version = document.version;
    const start = document.offsetAt(editor.selection.start), end = document.offsetAt(editor.selection.end);
    const original = document.getText().slice(start, end);
    if (!original || parseChanges(document.getText()).changes.some(change => start < change.end && end > change.start)) {
      void vscode.window.showWarningMessage(f('unsafeSelection')); return;
    }
    const validation = trackEdit(document.getText(), { start, end, text: original });
    if ('reason' in validation) { void vscode.window.showWarningMessage(`${f('unsafeSelection')} ${explainReason(validation.reason)}`); return; }
    const proposed = kind === 'replace' ? await vscode.window.showInputBox({ prompt: f('replacePrompt'), value: original }) : undefined;
    if (kind === 'replace' && proposed === undefined) return;
    if (document.version !== version || document.isClosed) return;
    const author = vscode.workspace.getConfiguration('latexReview', document.uri).get<string>('authorId', '') || undefined;
    if (author && !/^[A-Za-z0-9_-]+$/.test(author)) {
      void vscode.window.showWarningMessage(f('invalidAuthor')); return;
    }
    const text = makeRevision(kind === 'addition' ? '' : original, kind === 'deletion' ? '' : proposed ?? original, author);
    await this.edit(editor, new vscode.Range(document.positionAt(start), document.positionAt(end)), text);
  }

  private async merge(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !await this.beforeAction(editor)) return;
    const source = editor.document.getText();
    const start = editor.document.offsetAt(editor.selection.start), end = editor.document.offsetAt(editor.selection.end);
    const result: SourceEdit | { reason: string } = mergeChanges(source, parseChanges(source).changes.filter(item => item.start >= start && item.end <= end));
    if ('reason' in result) { void vscode.window.showWarningMessage(`${f('mergeFailed')} ${explainReason(result.reason)}`); return; }
    await this.edit(editor, new vscode.Range(editor.document.positionAt(result.start), editor.document.positionAt(result.end)), result.text);
  }

  private render(): void {
    const document = vscode.window.activeTextEditor?.document;
    const state = document && this.states.get(document.uri.toString());
    void vscode.commands.executeCommand('setContext', 'latexReview.tracking', !!state && !state.paused);
    void vscode.commands.executeCommand('setContext', 'latexReview.trackingPaused', !!state?.paused);
    if (!document || !this.supported(document)) { this.status.hide(); return; }
    this.status.text = `$(edit) ${f(state?.paused ? 'trackingPaused' : state ? 'trackingOn' : 'trackingOff')}`;
    this.status.backgroundColor = state?.paused ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    this.status.tooltip = state?.paused ? explainReason(state.paused) : f('trackingExperimentalWarning'); this.status.show();
  }

  dispose(): void {
    for (const state of this.states.values()) if (state.timer) clearTimeout(state.timer);
    this.states.clear(); this.diffs.clear();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
