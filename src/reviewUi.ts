import * as vscode from 'vscode';
import { LatexChange } from './changeTypes';
import type { ReviewTarget } from './reviewController';
import { t } from './i18n';

export function decisionHint(change: LatexChange, decision: 'accept' | 'reject'): string {
  const suffix = change.type[0].toUpperCase() + change.type.slice(1);
  return t(`${decision}${suffix}`);
}

interface ReviewViewState {
  editor?: vscode.TextEditor;
  supported: boolean;
  enabled: boolean;
  busy: boolean;
  writable: boolean;
  pending: boolean;
  current?: LatexChange;
  target?: ReviewTarget;
  previous?: ReviewTarget;
  next?: ReviewTarget;
  index: number;
  count: number;
  issues: number;
}

function gutterArrow(fill: string): vscode.Uri {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="${fill}" d="M3 2h3l7 6-7 6H3l7-6z"/></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml,${encodeURIComponent(svg)}`);
}

/** Native, fixed-position controls; all editing remains in ReviewController. */
export class ReviewUi implements vscode.Disposable {
  private readonly items = new Map<string, vscode.StatusBarItem>();
  private readonly frame = vscode.window.createTextEditorDecorationType({
    border: '2px solid', borderColor: new vscode.ThemeColor('focusBorder'),
    overviewRulerColor: new vscode.ThemeColor('focusBorder'),
    overviewRulerLane: vscode.OverviewRulerLane.Left
  });
  private readonly marker = vscode.window.createTextEditorDecorationType({
    gutterIconSize: 'contain',
    // Monochrome marker adapts to dark/light themes, including high contrast.
    light: { gutterIconPath: gutterArrow('#000000') },
    dark: { gutterIconPath: gutterArrow('#ffffff') }
  });
  private readonly newText = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
    border: '1px solid', borderColor: new vscode.ThemeColor('diffEditor.insertedTextBorder')
  });
  private readonly oldText = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'),
    border: '1px solid', borderColor: new vscode.ThemeColor('diffEditor.removedTextBorder')
  });

  constructor() {
    ['toggle', 'previous', 'accept', 'reject', 'next', 'current', 'remaining'].forEach((name, index) => {
      const item = vscode.window.createStatusBarItem(`latexReview.${name}`, vscode.StatusBarAlignment.Left, 90 - index);
      item.name = `LaTeX Review: ${name}`;
      this.items.set(name, item);
    });
  }

  private range(editor: vscode.TextEditor, change: { start: number; end: number }): vscode.Range {
    return new vscode.Range(editor.document.positionAt(change.start), editor.document.positionAt(change.end));
  }

  private button(name: string, text: string, tooltip: string, command?: string | vscode.Command): void {
    const item = this.items.get(name)!;
    item.text = text; item.tooltip = tooltip; item.command = command;
    item.color = command ? undefined : new vscode.ThemeColor('disabledForeground');
    item.show();
  }

  render(state: ReviewViewState): void {
    for (const item of this.items.values()) item.hide();
    this.decorate(state);
    if (!state.supported) return;
    this.button('toggle', `$(checklist) ${t(state.enabled ? 'reviewOn' : 'reviewOff')}`,
      t(state.enabled ? 'disableReview' : 'enableReview'), state.busy ? undefined : 'latexReview.toggleReview');
    if (!state.enabled) return;

    const canAct = !!state.current && !!state.target && state.writable && !state.busy && !state.pending;
    const noActionHint = state.busy ? t('busy') : state.pending ? t('waiting') : !state.current ? t('noCurrent') : t('readonly');
    const locate: vscode.Command = { title: t('locateCurrent'), command: 'latexReview.locateCurrent', arguments: state.target ? [state.target] : [] };
    const toolbar = vscode.workspace.getConfiguration('latexReview', state.editor?.document.uri).get('showReviewToolbar', true);
    if (toolbar) {
      this.button('previous', `$(arrow-left) ${t('previous')}`, state.previous ? t('previous') : t('end'),
        !state.busy && state.previous ? { title: t('previous'), command: 'latexReview.previousChange', arguments: state.target ? [state.target] : [] } : undefined);
      this.button('accept', `$(check) ${t('accept')}`, canAct ? decisionHint(state.current!, 'accept') : noActionHint,
        canAct ? { title: t('accept'), command: 'latexReview.acceptCurrent', arguments: [state.target] } : undefined);
      this.button('reject', `$(close) ${t('reject')}`, canAct ? decisionHint(state.current!, 'reject') : noActionHint,
        canAct ? { title: t('reject'), command: 'latexReview.rejectCurrent', arguments: [state.target] } : undefined);
      this.button('next', `${t('next')} $(arrow-right)`, state.next ? t('next') : t('end'),
        !state.busy && state.next ? { title: t('next'), command: 'latexReview.nextChange', arguments: state.target ? [state.target] : [] } : undefined);
    }
    if (state.current) this.button('current', `$(target) ${t('currentInfo', t(state.current.type), state.index, state.count)}`,
      `${state.editor?.document.fileName}\n${t('locateCurrent')}`, state.busy ? undefined : locate);
    const countText = state.pending ? t('waiting') : state.issues ? t('errors', state.count, state.issues)
      : state.count ? t('remaining', state.count) : t('clean');
    this.button('remaining', `$(list-unordered) ${countText}`, t('locateCurrent'),
      !state.busy && state.count ? locate : undefined);
  }

  private decorate(state: ReviewViewState): void {
    for (const editor of vscode.window.visibleTextEditors) {
      const enabled = state.enabled && !state.pending && editor === state.editor && !!state.current &&
        vscode.workspace.getConfiguration('latexReview', editor.document.uri).get('highlightChanges', true);
      const change = enabled ? state.current : undefined;
      editor.setDecorations(this.frame, change ? [this.range(editor, change)] : []);
      const start = change ? editor.document.positionAt(change.start) : undefined;
      editor.setDecorations(this.marker, start ? [new vscode.Range(start, start)] : []);
      const newArg = change?.type === 'deleted' ? undefined : change?.args[0];
      const oldArg = change?.type === 'replaced' ? change.args[1] : change?.type === 'deleted' ? change.args[0] : undefined;
      const options = (argument: { start: number; end: number } | undefined, key: string): vscode.DecorationOptions[] =>
        argument ? [{ range: this.range(editor, argument), hoverMessage: t(key), renderOptions: {
          before: { contentText: `[${t(key)}] `, fontWeight: 'bold', color: new vscode.ThemeColor('editor.foreground'),
            backgroundColor: new vscode.ThemeColor('editor.background'), margin: '0 0.35em 0 0' }
        } }] : [];
      editor.setDecorations(this.newText, options(newArg, 'newText'));
      editor.setDecorations(this.oldText, options(oldArg, 'oldText'));
    }
  }

  dispose(): void {
    for (const item of this.items.values()) item.dispose();
    this.frame.dispose(); this.marker.dispose(); this.newText.dispose(); this.oldText.dispose();
  }
}
