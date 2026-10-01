import * as vscode from 'vscode';
import { LatexChange, LatexComment, OffsetRange, ParseResult } from './changeTypes';
import { parseChanges } from './parser';
import { makeHighlight, makeStandaloneComment, removeComment, setComment, unescapeCommentText } from './comments';
import { f } from './featureStrings';
import { trackEdit } from './changeTransforms';

export interface CommentControllerHooks {
  isReviewEnabled: () => boolean;
  beforeAction: (editor: vscode.TextEditor) => Promise<boolean>;
  edit: (editor: vscode.TextEditor, range: vscode.Range, text: string) => Promise<boolean>;
}

interface CommentTarget {
  uri: string;
  version: number;
  start: number;
  end: number;
  source: string;
  kind: LatexComment['kind'];
}

interface RevisionTarget {
  uri: string;
  version: number;
  start: number;
  end: number;
  source: string;
  kind: 'revision';
}

type ActionTarget = CommentTarget | RevisionTarget;

const languageSelectors: vscode.DocumentSelector = [{ language: 'latex' }, { pattern: '**/*.tex' }];

function range(document: vscode.TextDocument, offsets: OffsetRange): vscode.Range {
  return new vscode.Range(document.positionAt(offsets.start), document.positionAt(offsets.end));
}

function commentIdentity(target: CommentTarget): string {
  return `${target.uri}:${target.version}:${target.start}:${target.end}:${target.kind}`;
}

function flattenChanges(changes: LatexChange[]): LatexChange[] {
  return changes.flatMap(change => [change, ...flattenChanges(change.children)]);
}

class DraftPrompt {
  thread?: vscode.CommentThread;
  comment?: Comment;
  settled = false;
  constructor(
    readonly key: string,
    readonly uri: string,
    readonly resolve: (value: string | undefined) => void
  ) {}
}

class Comment implements vscode.Comment {
  readonly author = { name: f('commentAuthor') };
  readonly contextValue = 'latexReviewComment';
  readonly mode = vscode.CommentMode.Editing;
  constructor(readonly parent: DraftPrompt, public body: string, readonly savedBody: string) {}
}

export class CommentController implements vscode.Disposable, vscode.CodeLensProvider, vscode.HoverProvider {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly native: vscode.CommentController;
  private readonly threads = new Map<string, vscode.CommentThread>();
  private readonly targets = new WeakMap<vscode.CommentThread, CommentTarget>();
  private readonly drafts = new Map<string, string>();
  private readonly promptThreads = new Map<vscode.CommentThread, DraftPrompt>();
  private readonly refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly lensChanged = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.lensChanged.event;
  private sequence = 0;
  private disposed = false;

  constructor(private readonly hooks: CommentControllerHooks) {
    this.native = vscode.comments.createCommentController('latexReview.comments', f('commentAnchor'));
    this.native.options = { prompt: f('commentPrompt'), placeHolder: f('commentPrompt') };
    this.disposables.push(this.native, this.lensChanged,
      vscode.languages.registerCodeLensProvider(languageSelectors, this),
      vscode.languages.registerHoverProvider(languageSelectors, this),
      vscode.commands.registerCommand('latexReview.addComment', (target?: ActionTarget) => this.add(target)),
      vscode.commands.registerCommand('latexReview.editComment', (target?: ActionTarget | vscode.CommentThread) => this.editComment(target)),
      vscode.commands.registerCommand('latexReview.removeComment', (target?: ActionTarget | vscode.CommentThread) => this.remove(target)),
      vscode.commands.registerCommand('latexReview.nextComment', () => this.next()),
      vscode.commands.registerCommand('latexReview.saveComment', (comment?: vscode.Comment) => this.savePrompt(comment)),
      vscode.commands.registerCommand('latexReview.cancelComment', (comment?: vscode.Comment) => this.cancelPrompt(comment)),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
      vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.textEditor === vscode.window.activeTextEditor) this.updateCommentContexts(event.textEditor);
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('latexReview')) this.refresh();
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (!this.supported(event.document)) return;
        const key = event.document.uri.toString();
        const pending = this.refreshTimers.get(key);
        if (pending) clearTimeout(pending);
        this.refreshTimers.delete(key);
        if (event.reason !== undefined) this.refresh();
        else this.refreshTimers.set(key, setTimeout(() => { this.refreshTimers.delete(key); this.refresh(); }, 180));
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        const key = document.uri.toString();
        const timer = this.refreshTimers.get(key);
        if (timer) clearTimeout(timer);
        this.refreshTimers.delete(key);
        this.clearDocument(key);
      })
    );
    this.refresh();
  }

  private updateCommentContexts(editor = vscode.window.activeTextEditor): void {
    const document = editor?.document;
    const supported = !!document && this.supported(document) && !document.isClosed;
    const comments = supported ? parseChanges(document!.getText()).comments : [];
    const hasComment = !!editor && comments.some(comment => {
      const start = document!.offsetAt(editor.selection.start);
      const end = document!.offsetAt(editor.selection.end);
      return editor.selection.isEmpty
        ? start >= comment.start && start <= comment.end
        : start < comment.end && comment.start < end;
    });
    void vscode.commands.executeCommand('setContext', 'latexReview.hasComment', hasComment);
    void vscode.commands.executeCommand('setContext', 'latexReview.hasComments', comments.length > 0);
  }

  private supported(document: vscode.TextDocument): boolean {
    return document.languageId === 'latex' || /\.tex$/i.test(document.uri.path);
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.ProviderResult<vscode.CodeLens[]> {
    if (!this.hooks.isReviewEnabled() || !this.supported(document) || document.isClosed) return [];
    const version = document.version;
    const parsed = parseChanges(document.getText());
    if (document.isClosed || version !== document.version || !this.hooks.isReviewEnabled()) return [];
    return parsed.comments.map(comment => {
      const target = this.target(document, comment);
      const at = document.positionAt(comment.start);
      const lensRange = new vscode.Range(at, at);
      return new vscode.CodeLens(lensRange, {
        title: `✎ ${f('editComment')}`, command: 'latexReview.editComment', arguments: [target]
      });
    });
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
    if (!this.hooks.isReviewEnabled() || !this.supported(document)) return undefined;
    const source = document.getText();
    const parsed = parseChanges(source);
    const offset = document.offsetAt(position);
    const comment = parsed.comments.find(item => offset >= item.contentRange.start && offset <= item.contentRange.end
      || item.anchorRange.start <= offset && offset <= item.anchorRange.end);
    if (!comment) return undefined;
    const plain = unescapeCommentText(source.slice(comment.contentRange.start, comment.contentRange.end));
    if (!plain) return undefined;
    const target = this.target(document, comment);
    const markdown = new vscode.MarkdownString();
    markdown.appendText(plain);
    markdown.appendMarkdown('\n\n');
    markdown.appendMarkdown(`[${f('editComment')}](command:latexReview.editComment?${encodeURIComponent(JSON.stringify([target]))}) · `);
    markdown.appendMarkdown(`[${f('removeComment')}](command:latexReview.removeComment?${encodeURIComponent(JSON.stringify([target]))})`);
    markdown.isTrusted = { enabledCommands: ['latexReview.editComment', 'latexReview.removeComment'] };
    return new vscode.Hover(markdown, range(document, comment.anchorRange));
  }

  private target(document: vscode.TextDocument, comment: LatexComment): CommentTarget {
    return { uri: document.uri.toString(), version: document.version, start: comment.start, end: comment.end,
      source: document.getText(range(document, comment)), kind: comment.kind };
  }

  private revisionTarget(document: vscode.TextDocument, change: LatexChange): RevisionTarget {
    return { uri: document.uri.toString(), version: document.version, start: change.start, end: change.end,
      source: document.getText(range(document, change)), kind: 'revision' };
  }

  private parseTarget(document: vscode.TextDocument, target: ActionTarget): { parsed: ParseResult; source: string } | undefined {
    if (document.uri.toString() !== target.uri || document.version !== target.version || document.isClosed) return undefined;
    const source = document.getText();
    if (target.start < 0 || target.end < target.start || source.slice(target.start, target.end) !== target.source) return undefined;
    return { parsed: parseChanges(source), source };
  }

  private async currentTarget(target?: ActionTarget): Promise<{ editor: vscode.TextEditor; source: string; parsed: ParseResult; target?: ActionTarget } | undefined> {
    const editor = target
      ? vscode.window.visibleTextEditors.find(item => item.document.uri.toString() === target.uri)
        ?? (vscode.window.activeTextEditor?.document.uri.toString() === target.uri ? vscode.window.activeTextEditor : undefined)
      : vscode.window.activeTextEditor;
    if (!editor || !this.supported(editor.document)) return undefined;
    let resolved = target;
    if (!resolved) {
      const selection = editor.selection;
      if (!selection.isEmpty) {
        const start = editor.document.offsetAt(selection.start);
        const end = editor.document.offsetAt(selection.end);
        resolved = { uri: editor.document.uri.toString(), version: editor.document.version, start, end,
          source: editor.document.getText(selection), kind: 'highlight' };
      }
    }
    const source = editor.document.getText();
    if (resolved) {
      const data = this.parseTarget(editor.document, resolved);
      if (!data) {
        void vscode.window.showInformationMessage(f('staleComment'));
        return undefined;
      }
      return { editor, source: data.source, parsed: data.parsed, target: resolved };
    }
    return { editor, source, parsed: parseChanges(source) };
  }

  private async add(target?: ActionTarget): Promise<void> {
    if (!this.hooks.isReviewEnabled()) return;
    if (target instanceof vscode.Uri) target = undefined;
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.supported(editor.document)) return;
    const document = editor.document;
    const sourceVersion = document.version;
    const source = document.getText();
    const parsed = parseChanges(source);
    if (target && !this.parseTarget(document, target)) { void vscode.window.showInformationMessage(f('staleComment')); return; }
    if (!target) {
      const start = document.offsetAt(editor.selection.start), end = document.offsetAt(editor.selection.end);
      const existing = parsed.comments.find(comment => start >= comment.start && end <= comment.end);
      if (existing) {
        await this.promptAndWrite(editor, source, parsed, this.target(document, existing), existing, true);
        return;
      }
    }
    if (!target && !editor.selection.isEmpty) {
      const selectedStart = document.offsetAt(editor.selection.start);
      const selectedEnd = document.offsetAt(editor.selection.end);
      const enclosing = flattenChanges(parsed.changes).find(change => selectedStart >= change.start && selectedEnd <= change.end);
      if (enclosing) target = this.revisionTarget(document, enclosing);
      else if (flattenChanges(parsed.changes).some(change => selectedStart < change.end && change.start < selectedEnd)
        || parsed.comments.some(comment => selectedStart < comment.end && comment.start < selectedEnd)) {
        void vscode.window.showWarningMessage(f('unsafeSelection'));
        return;
      } else {
        if ('reason' in trackEdit(source, { start: selectedStart, end: selectedEnd, text: source.slice(selectedStart, selectedEnd) })) {
          void vscode.window.showWarningMessage(f('unsafeSelection')); return;
        }
        target = { uri: document.uri.toString(), version: sourceVersion, start: selectedStart, end: selectedEnd,
          source: source.slice(selectedStart, selectedEnd), kind: 'highlight' };
      }
    } else if (!target) {
      const caret = document.offsetAt(editor.selection.active);
      const enclosing = flattenChanges(parsed.changes).find(change => caret >= change.start && caret <= change.end);
      if (enclosing) target = this.revisionTarget(document, enclosing);
    }

    if (target?.kind === 'revision') {
      const change = flattenChanges(parsed.changes).find(item => item.start === target!.start && item.end === target!.end);
      if (!change) { void vscode.window.showInformationMessage(f('staleComment')); return; }
      const existing = change.comment ?? parsed.comments.find(comment => comment.kind === 'attached' && comment.start === change.start && comment.end === change.end);
      if (existing) {
        const ref = this.target(document, existing);
        await this.promptAndWrite(editor, source, parsed, ref, change, true);
      } else {
        await this.promptAndWrite(editor, source, parsed, this.revisionTarget(document, change), change, true);
      }
      return;
    }

    if (target) {
      const comment = this.findComment(parsed, target);
      if (comment) { await this.promptAndWrite(editor, source, parsed, target, comment, true); return; }
    }

    if (target && target.kind === 'highlight') {
      const draftKey = `new:${target.uri}:${target.start}:${target.end}`;
      const plain = await this.prompt(draftKey, f('commentPrompt'), editor);
      if (plain === undefined) return;
      if (!plain.trim()) { void vscode.window.showWarningMessage(f('emptyComment')); return; }
      let fresh = this.parseTarget(document, target);
      if (!fresh) { void vscode.window.showInformationMessage(f('staleComment')); return; }
      if (!(await this.hooks.beforeAction(editor))) return;
      fresh = this.parseTarget(document, target);
      if (!fresh || vscode.window.activeTextEditor?.document.uri.toString() !== target.uri) {
        void vscode.window.showInformationMessage(f('staleComment')); return;
      }
      const authorId = this.authorId();
      const replacement = makeHighlight(fresh.source.slice(target.start, target.end), plain, authorId);
      const ok = await this.hooks.edit(editor, new vscode.Range(document.positionAt(target.start), document.positionAt(target.end)), replacement);
      if (ok) { this.drafts.delete(draftKey); this.refresh(); }
      return;
    }

    const caret = document.offsetAt(editor.selection.active);
    if ('reason' in trackEdit(source, { start: caret, end: caret, text: 'x' })) {
      void vscode.window.showWarningMessage(f('unsafeSelection')); return;
    }
    const selectionStart = document.offsetAt(editor.selection.start);
    const selectionEnd = document.offsetAt(editor.selection.end);
    if (document.version !== sourceVersion) { void vscode.window.showInformationMessage(f('staleComment')); return; }
    const draftKey = `new:${document.uri.toString()}:${caret}`;
    const plain = await this.prompt(draftKey, f('commentPrompt'), editor);
    if (plain === undefined) return;
    if (!plain.trim()) { void vscode.window.showWarningMessage(f('emptyComment')); return; }
    if (document.version !== sourceVersion || document.offsetAt(editor.selection.active) !== caret
      || document.offsetAt(editor.selection.start) !== selectionStart || document.offsetAt(editor.selection.end) !== selectionEnd
      || vscode.window.activeTextEditor?.document.uri.toString() !== document.uri.toString()) {
      void vscode.window.showInformationMessage(f('staleComment')); return;
    }
    if (!(await this.hooks.beforeAction(editor))) return;
    if (document.version !== sourceVersion || document.offsetAt(editor.selection.active) !== caret
      || document.offsetAt(editor.selection.start) !== selectionStart || document.offsetAt(editor.selection.end) !== selectionEnd
      || vscode.window.activeTextEditor?.document.uri.toString() !== document.uri.toString()) {
      void vscode.window.showInformationMessage(f('staleComment')); return;
    }
    const insertion = makeStandaloneComment(plain, this.authorId());
    const ok = await this.hooks.edit(editor, new vscode.Range(document.positionAt(caret), document.positionAt(caret)), insertion);
    if (ok) { this.drafts.delete(draftKey); this.refresh(); }
  }

  private async promptAndWrite(editor: vscode.TextEditor, source: string, _parsed: ParseResult,
    ref: CommentTarget | RevisionTarget, object: LatexComment | LatexChange, _editing: boolean): Promise<void> {
    const content = 'kind' in object
      ? unescapeCommentText(source.slice(object.contentRange.start, object.contentRange.end))
      : object.comment ? unescapeCommentText(source.slice(object.comment.contentRange.start, object.comment.contentRange.end)) : '';
    const key = `edit:${ref.uri}:${ref.start}:${ref.end}`;
    const plain = await this.prompt(key, f('commentPrompt'), editor, content);
    if (plain === undefined) return;
    if (!plain.trim()) { void vscode.window.showWarningMessage(f('emptyComment')); return; }
    const data = this.parseTarget(editor.document, ref);
    if (!data) { void vscode.window.showInformationMessage(f('staleComment')); return; }
    const fresh = ref.kind === 'revision' ? undefined : this.findComment(data.parsed, ref);
    let targetObject: LatexComment | LatexChange | undefined;
    if (fresh) targetObject = fresh;
    else if (ref.kind === 'revision') targetObject = flattenChanges(data.parsed.changes).find(change => change.start === ref.start && change.end === ref.end);
    if (!targetObject) { void vscode.window.showInformationMessage(f('staleComment')); return; }
    if (!(await this.hooks.beforeAction(editor))) return;
    const latest = this.parseTarget(editor.document, ref);
    if (!latest) { void vscode.window.showInformationMessage(f('staleComment')); return; }
    const latestObject = ref.kind === 'revision'
      ? flattenChanges(latest.parsed.changes).find(change => change.start === ref.start && change.end === ref.end)
      : this.findComment(latest.parsed, ref);
    if (!latestObject) { void vscode.window.showInformationMessage(f('staleComment')); return; }
    let replacement: ReturnType<typeof setComment>;
    try { replacement = setComment(latest.source, latestObject, plain); }
    catch { void vscode.window.showWarningMessage(f('staleComment')); return; }
    const ok = await this.hooks.edit(editor,
      new vscode.Range(editor.document.positionAt(replacement.start), editor.document.positionAt(replacement.end)), replacement.text);
    if (ok) { this.drafts.delete(key); this.refresh(); }
  }

  private async editComment(argument?: ActionTarget | vscode.CommentThread): Promise<void> {
    const target = this.resolveArgument(argument) ?? this.atCursorComment();
    if (!target || target.kind === 'revision') return;
    const current = await this.currentTarget(target);
    if (!current) return;
    const comment = this.findComment(current.parsed, target);
    if (!comment) { void vscode.window.showInformationMessage(f('staleComment')); return; }
    await this.promptAndWrite(current.editor, current.source, current.parsed, target, comment, true);
  }

  private async remove(argument?: ActionTarget | vscode.CommentThread): Promise<void> {
    let target = this.resolveArgument(argument);
    const cursorTarget = !target ? this.atCursorComment() : undefined;
    target ??= cursorTarget;
    if (!target || target.kind === 'revision') return;
    const current = await this.currentTarget(target);
    if (!current) return;
    const comment = this.findComment(current.parsed, target);
    if (!comment) { void vscode.window.showInformationMessage(f('staleComment')); return; }
    if (!(await this.hooks.beforeAction(current.editor))) return;
    const latest = this.parseTarget(current.editor.document, target);
    if (!latest) { void vscode.window.showInformationMessage(f('staleComment')); return; }
    const latestComment = this.findComment(latest.parsed, target);
    if (!latestComment) { void vscode.window.showInformationMessage(f('staleComment')); return; }
    let targetObject: LatexComment | LatexChange = latestComment;
    if (latestComment.kind === 'attached') {
      targetObject = flattenChanges(latest.parsed.changes).find(change => change.start === latestComment.start && change.end === latestComment.end)
        ?? latestComment;
    }
    let replacement: ReturnType<typeof removeComment>;
    try { replacement = removeComment(latest.source, targetObject); }
    catch { void vscode.window.showWarningMessage(f('staleComment')); return; }
    if (replacement.start === 0 && replacement.end === 0 && !replacement.text) {
      void vscode.window.showWarningMessage(f('staleComment')); return;
    }
    const ok = await this.hooks.edit(current.editor,
      new vscode.Range(current.editor.document.positionAt(replacement.start), current.editor.document.positionAt(replacement.end)), replacement.text);
    if (ok) { this.drafts.delete(`edit:${target.uri}:${target.start}:${target.end}`); this.refresh(); }
  }

  private findComment(parsed: ParseResult, target: CommentTarget): LatexComment | undefined {
    return parsed.comments.find(item => item.kind === target.kind && item.start === target.start && item.end === target.end);
  }

  private atCursorComment(): CommentTarget | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.supported(editor.document)) return undefined;
    const document = editor.document;
    const offset = document.offsetAt(editor.selection.active);
    const comment = parseChanges(document.getText()).comments.find(item =>
      (item.start <= offset && offset <= item.end) || (item.anchorRange.start <= offset && offset <= item.anchorRange.end));
    return comment ? this.target(document, comment) : undefined;
  }

  private resolveArgument(argument?: ActionTarget | vscode.CommentThread): ActionTarget | undefined {
    if (!argument) return undefined;
    if ('uri' in argument && 'start' in argument) return argument;
    return this.targets.get(argument);
  }

  private authorId(): string | undefined {
    const value = vscode.workspace.getConfiguration('latexReview').get<string>('authorId', '').trim();
    return /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
  }

  private async prompt(key: string, placeHolder: string, editor: vscode.TextEditor, initial = ''): Promise<string | undefined> {
    const value = this.drafts.get(key) ?? initial;
    const document = editor.document;
    const promptRange = editor.selection;
    return new Promise(resolve => {
      const draft = new DraftPrompt(key, document.uri.toString(), resolve);
      const comment = new Comment(draft, value, initial);
      draft.comment = comment;
      const thread = this.native.createCommentThread(document.uri, promptRange, [comment]);
      draft.thread = thread;
      thread.canReply = false;
      thread.contextValue = 'latexReviewDraftComment';
      thread.label = placeHolder;
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      this.promptThreads.set(thread, draft);
    });
  }

  private savePrompt(comment?: vscode.Comment): void {
    if (!comment || !('parent' in comment) || !(comment.parent instanceof DraftPrompt)) return;
    const draft = comment.parent;
    if (draft.settled || !draft.thread || this.promptThreads.get(draft.thread) !== draft) return;
    const value = typeof comment.body === 'string' ? comment.body : comment.body.value;
    this.drafts.set(draft.key, value);
    this.finishPrompt(draft, value);
  }

  private cancelPrompt(comment?: vscode.Comment): void {
    if (!comment || !('parent' in comment) || !(comment.parent instanceof DraftPrompt)) return;
    const draft = comment.parent;
    if (draft.settled || !draft.thread || this.promptThreads.get(draft.thread) !== draft) return;
    const value = typeof comment.body === 'string' ? comment.body : comment.body.value;
    this.drafts.set(draft.key, value);
    this.finishPrompt(draft, undefined);
  }

  private finishPrompt(draft: DraftPrompt, value: string | undefined): void {
    if (draft.settled) return;
    draft.settled = true;
    if (draft.thread) this.promptThreads.delete(draft.thread);
    draft.thread?.dispose();
    draft.resolve(value);
  }

  private async next(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.supported(editor.document) || !this.hooks.isReviewEnabled()) return;
    const comments = parseChanges(editor.document.getText()).comments;
    const offset = editor.document.offsetAt(editor.selection.active);
    const next = comments.find(comment => comment.start > offset);
    if (!next) { void vscode.window.showInformationMessage(f('end')); return; }
    const start = editor.document.positionAt(next.anchorRange.start);
    const end = editor.document.positionAt(next.anchorRange.end);
    editor.selection = new vscode.Selection(start, end);
    editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  refresh(): void {
    if (this.disposed) return;
    this.updateCommentContexts();
    this.sequence++;
    const enabled = this.hooks.isReviewEnabled();
    const wanted = new Map<string, { document: vscode.TextDocument; comment: LatexComment; target: CommentTarget; text: string; parsed: ParseResult }>();
    if (enabled) {
      for (const editor of vscode.window.visibleTextEditors) {
        const document = editor.document;
        if (!this.supported(document)) continue;
        const version = document.version;
        const source = document.getText();
        const parsed = parseChanges(source);
        if (version !== document.version || document.isClosed) continue;
        for (const comment of parsed.comments) {
          const target = this.target(document, comment);
          wanted.set(commentIdentity(target), { document, comment, target, parsed, text: unescapeCommentText(source.slice(comment.contentRange.start, comment.contentRange.end)) });
        }
      }
    }
    for (const [key, thread] of this.threads) {
      if (!wanted.has(key)) { thread.dispose(); this.threads.delete(key); }
    }
    for (const [key, item] of wanted) {
      const existing = this.threads.get(key);
      const positionRange = range(item.document, item.comment.anchorRange);
      const body = new vscode.MarkdownString();
      body.appendText(item.text);
      const author = item.comment.owner?.authorId ?? item.parsed.changes.flatMap(change => flattenChanges([change]))
        .find(change => change.start === item.comment.start && change.end === item.comment.end)?.authorId;
      const message: vscode.Comment = {
        body, mode: vscode.CommentMode.Preview,
        author: { name: author || f('commentAuthor') }, contextValue: 'latexReviewComment'
      };
      if (existing) {
        if (existing.comments.some(comment => comment.mode === vscode.CommentMode.Editing)) continue;
        existing.range = positionRange;
        existing.comments = [message];
      } else {
        const thread = this.native.createCommentThread(item.document.uri, positionRange, [message]);
        thread.canReply = false;
        thread.contextValue = 'latexReviewComment';
        thread.label = f('commentAnchor');
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
        this.targets.set(thread, item.target);
        this.threads.set(key, thread);
      }
    }
    this.lensChanged.fire();
  }

  private clearDocument(uri: string): void {
    for (const draft of this.promptThreads.values()) {
      if (draft.uri === uri) this.finishPrompt(draft, undefined);
    }
    for (const [key, thread] of this.threads) {
      if (key.startsWith(`${uri}:`)) { thread.dispose(); this.threads.delete(key); }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const thread of this.threads.values()) thread.dispose();
    this.threads.clear();
    for (const draft of this.promptThreads.values()) this.finishPrompt(draft, undefined);
    this.promptThreads.clear();
    this.drafts.clear();
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
