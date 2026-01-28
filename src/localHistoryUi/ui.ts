import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'localHistoryUi', 'resources', 'index.html');
    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

    const toolkitUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'vscode-elements', 'dist', 'vscode-elements.js')
    );
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'src', 'localHistoryUi', 'resources', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'src', 'localHistoryUi', 'resources', 'style.css')
    );

    html = html.replace('${toolkitUri}', toolkitUri.toString());
    html = html.replace('${scriptUri}', scriptUri.toString());
    html = html.replace('${styleUri}', styleUri.toString());
    html = html.replace('${cspSource}', webview.cspSource);

    return html;
}
