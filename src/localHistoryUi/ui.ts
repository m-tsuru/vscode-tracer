import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'localHistoryUi', 'resources', 'index.html');
    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

    const toolkitUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode-elements', 'elements', 'dist', 'bundled.js')
    );
    const monacoBaseUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'monaco-editor')
    );
    const monacoLoaderUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'monaco-editor', 'min', 'vs', 'loader.js')
    );
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'src', 'localHistoryUi', 'resources', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'src', 'localHistoryUi', 'resources', 'style.css')
    );
    const codiconsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
    );

    html = html.replace(/\${toolkitUri}/g, toolkitUri.toString());
    html = html.replace(/\${scriptUri}/g, scriptUri.toString());
    html = html.replace(/\${styleUri}/g, styleUri.toString());
    html = html.replace(/\${codiconsUri}/g, codiconsUri.toString());
    html = html.replace(/\${cspSource}/g, webview.cspSource);
    html = html.replace(/\${monacoBaseUri}/g, monacoBaseUri.toString());
    html = html.replace(/\${monacoLoaderUri}/g, monacoLoaderUri.toString());

    return html;
}
