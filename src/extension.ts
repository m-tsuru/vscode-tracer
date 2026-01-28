import * as vscode from "vscode";
import { getWebviewContent } from "./localHistoryUi/ui";

/**
 * VS Code のエディタ設定を取得して Monaco Editor 互換の形式で返す
 */
function getEditorConfig() {
    const editorConfig = vscode.workspace.getConfiguration('editor');

    return {
        fontSize: editorConfig.get<number>('fontSize', 14),
        fontFamily: editorConfig.get<string>('fontFamily', 'Menlo, Monaco, "Courier New", monospace'),
        fontLigatures: editorConfig.get<boolean | string>('fontLigatures', false),
        lineHeight: editorConfig.get<number>('lineHeight', 0),
        tabSize: editorConfig.get<number>('tabSize', 4),
        insertSpaces: editorConfig.get<boolean>('insertSpaces', true),
        wordWrap: editorConfig.get<string>('wordWrap', 'off'),
        minimap: editorConfig.get<object>('minimap', { enabled: true }),
        renderWhitespace: editorConfig.get<string>('renderWhitespace', 'selection'),
        cursorStyle: editorConfig.get<string>('cursorStyle', 'line'),
        cursorBlinking: editorConfig.get<string>('cursorBlinking', 'blink'),
        smoothScrolling: editorConfig.get<boolean>('smoothScrolling', false),
        mouseWheelZoom: editorConfig.get<boolean>('mouseWheelZoom', false),
        lineNumbers: editorConfig.get<string>('lineNumbers', 'on'),
        renderLineHighlight: editorConfig.get<string>('renderLineHighlight', 'line'),
        scrollBeyondLastLine: editorConfig.get<boolean>('scrollBeyondLastLine', true),
        bracketPairColorization: editorConfig.get<object>('bracketPairColorization', { enabled: true }),
        guides: editorConfig.get<object>('guides', { indentation: true }),
        letterSpacing: editorConfig.get<number>('letterSpacing', 0),
        lineDecorationsWidth: editorConfig.get<number>('lineDecorationsWidth', 10),
        roundedSelection: editorConfig.get<boolean>('roundedSelection', true),
        scrollbar: editorConfig.get<object>('scrollbar', {}),
        stickyScroll: editorConfig.get<object>('stickyScroll', { enabled: true }),
    };
}

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

            // Webview からのメッセージを受信
            panel.webview.onDidReceiveMessage(
                (message) => {
                    switch (message.command) {
                    case 'requestEditorConfig':
                        // エディタ設定を送信
                        panel.webview.postMessage({
                            command: 'setEditorConfig',
                            config: getEditorConfig()
                        });
                        break;
                    case 'showDiff':
                        // TODO: 差分表示の処理
                        break;
                    case 'commitDiff':
                        // TODO: コミット処理
                        break;
                    }
                },
                undefined,
                context.subscriptions
            );

            // 設定変更を監視して自動更新
            const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('editor')) {
                    panel.webview.postMessage({
                        command: 'setEditorConfig',
                        config: getEditorConfig()
                    });
                }
            });

            // パネルが閉じられたらリスナーを解除
            panel.onDidDispose(() => {
                configChangeListener.dispose();
            }, null, context.subscriptions);
        },
    );

    context.subscriptions.push(disposable);
}
export function deactivate() {}
