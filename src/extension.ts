// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as trackEvent from './event/track';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscode-tracer" is now active!');

    const disposable = vscode.commands.registerCommand('vscode-tracer.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from tracer!');
    });
    const fileFocusDisposable = vscode.window.onDidChangeActiveTextEditor(async (e) => {
        console.log('[vscode-tracer] onDidChangeActiveTextEditor triggered', e?.document.fileName);
        await trackEvent.handleFileFocus(e);
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(fileFocusDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
