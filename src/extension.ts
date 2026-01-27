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

    // FileFocus: エディタでファイルにフォーカスが当たった時
    const fileFocusDisposable = vscode.window.onDidChangeActiveTextEditor(async (e) => {
        console.log('[vscode-tracer] onDidChangeActiveTextEditor triggered', e?.document.fileName);
        await trackEvent.handleFileFocus(e);
    });

    // FileSave: エディタでファイルが保存された時
    const fileSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
        console.log('[vscode-tracer] onDidSaveTextDocument triggered', document.fileName);
        await trackEvent.handleFileSave(document);
    });

    // FileCreate: ファイルが作成された時
    const fileCreateDisposable = vscode.workspace.onDidCreateFiles(async (e) => {
        console.log('[vscode-tracer] onDidCreateFiles triggered');
        for (const file of e.files) {
            await trackEvent.handleFileCreate(file);
        }
    });

    // FileDelete: ファイルが削除された時
    const fileDeleteDisposable = vscode.workspace.onDidDeleteFiles(async (e) => {
        console.log('[vscode-tracer] onDidDeleteFiles triggered');
        for (const file of e.files) {
            await trackEvent.handleFileDelete(file);
        }
    });

    // CodeAllEditorClose: 全エディタが閉じられた時
    const allEditorCloseDisposable = vscode.window.onDidChangeVisibleTextEditors(async (editors) => {
        console.log('[vscode-tracer] onDidChangeVisibleTextEditors triggered, count:', editors.length);
        if (editors.length === 0) {
            await trackEvent.handleCodeAllEditorClose();
        }
    });

    // CodeFocusOut: VS Code からフォーカスが外れた時
    const focusOutDisposable = vscode.window.onDidChangeWindowState(async (state) => {
        console.log('[vscode-tracer] onDidChangeWindowState triggered, focused:', state.focused);
        if (!state.focused) {
            await trackEvent.handleCodeFocusOut();
        }
    });

    // ユーザーアクティビティ（テキスト変更）でタイマーをリセット
    const textChangeDisposable = vscode.workspace.onDidChangeTextDocument(async (e) => {
        // 一時的なドキュメントや空の変更は無視
        if (e.contentChanges.length > 0) {
            await trackEvent.handleUserActivity();
        }
    });

    context.subscriptions.push(
        disposable,
        fileFocusDisposable,
        fileSaveDisposable,
        fileCreateDisposable,
        fileDeleteDisposable,
        allEditorCloseDisposable,
        focusOutDisposable,
        textChangeDisposable,
        { dispose: () => trackEvent.dispose() }
    );
}

// This method is called when your extension is deactivated
export function deactivate() {
    trackEvent.dispose();
}
