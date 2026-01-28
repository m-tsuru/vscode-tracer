import * as vscode from "vscode";
import { getWebviewContent } from "./localHistoryUi/ui";

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscode-tracer" is now active!');
    const disposable = vscode.commands.registerCommand(
        "vscode-tracer.openHistoryView",
        () => {
            const panel = vscode.window.createWebviewPanel(
                'diffViewer',
                'Diff Viewer',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    // Webview内のリソース読み込みを許可するフォルダを指定
                    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
                }
            );

            panel.webview.html = getWebviewContent(context, panel.webview);
        },
    );

    context.subscriptions.push(disposable);
}
export function deactivate() {}
