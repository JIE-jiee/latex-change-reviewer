import * as vscode from 'vscode';
import { ReviewController } from './reviewController';
import { TrackingController } from './trackingController';
import { CommentController } from './commentController';

export function activate(context: vscode.ExtensionContext): void {
  let review: ReviewController;
  let comments: CommentController | undefined;
  const tracking = new TrackingController(document => review.writable(document));
  const hooks = {
    beforeAction: (editor: vscode.TextEditor) => tracking.beforeAction(editor),
    edit: (editor: vscode.TextEditor, range: vscode.Range, text: string) => tracking.edit(editor, range, text),
    onReviewChanged: () => comments?.refresh()
  };
  review = new ReviewController(context, hooks);
  comments = new CommentController({ ...hooks, isReviewEnabled: () => review.isEnabled() });
  context.subscriptions.push(tracking, review, comments);
}

export function deactivate(): void {}
