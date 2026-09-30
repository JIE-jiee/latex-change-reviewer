import * as vscode from 'vscode';
import { ReviewController } from './reviewController';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(new ReviewController(context));
}

export function deactivate(): void {}
