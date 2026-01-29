import * as vscode from "vscode";
import { getWebviewContent } from "./localHistoryUi/ui";
import { gitService, localHistoryService, diffService, LocalHistoryEntry } from "./services";

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

/**
 * ファイルの言語IDを取得（Monaco Editor用）
 */
function getLanguageId(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const languageMap: Record<string, string> = {
        'ts': 'typescript',
        'tsx': 'typescriptreact',
        'js': 'javascript',
        'jsx': 'javascriptreact',
        'json': 'json',
        'md': 'markdown',
        'html': 'html',
        'css': 'css',
        'scss': 'scss',
        'less': 'less',
        'py': 'python',
        'rb': 'ruby',
        'java': 'java',
        'go': 'go',
        'rs': 'rust',
        'c': 'c',
        'cpp': 'cpp',
        'h': 'c',
        'hpp': 'cpp',
        'sh': 'shell',
        'yaml': 'yaml',
        'yml': 'yaml',
        'xml': 'xml',
        'sql': 'sql',
    };
    return languageMap[ext] || 'plaintext';
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscode-tracer" is now active!');

    // Git サービスを初期化
    await gitService.initialize();

    const disposable = vscode.commands.registerCommand(
        "vscode-tracer.openHistoryView",
        async () => {
            // アクティブなエディタからファイルURIを取得
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showWarningMessage('Please open a file first');
                return;
            }

            const currentFileUri = activeEditor.document.uri;
            const fileName = currentFileUri.fsPath.split('/').pop() || 'Unknown';

            // ローカル履歴を取得
            const historyEntries = await localHistoryService.getHistoryForFile(currentFileUri);

            const panel = vscode.window.createWebviewPanel(
                'diffViewer',
                `Tracer: ${fileName}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(context.extensionUri, 'node_modules'),
                        vscode.Uri.joinPath(context.extensionUri, 'src'),
                        vscode.Uri.joinPath(context.extensionUri, 'media')
                    ]
                }
            );

            panel.webview.html = getWebviewContent(context, panel.webview);

            // 履歴データを Webview に送信するための変換
            const historyData = historyEntries.map((entry, index) => ({
                id: index,
                timestamp: entry.timestamp.toISOString(),
                source: entry.source,
                uri: entry.uri.toString(),
            }));

            // 選択された履歴エントリを追跡
            let selectedEntries: LocalHistoryEntry[] = [];

            // Webview からのメッセージを受信
            panel.webview.onDidReceiveMessage(
                async (message) => {
                    switch (message.command) {
                    case 'requestEditorConfig':
                        // エディタ設定を送信
                        panel.webview.postMessage({
                            command: 'setEditorConfig',
                            config: getEditorConfig()
                        });
                        // 履歴データも送信
                        panel.webview.postMessage({
                            command: 'setHistoryData',
                            data: historyData,
                            fileName: fileName,
                            filePath: diffService.toRelativePath(currentFileUri.fsPath),
                            head: gitService.getHeadCommit(currentFileUri) || 'HEAD'
                        });
                        break;

                    case 'requestDiff':
                        // 2つの履歴エントリ間の差分を要求
                        {
                            const { oldIndex, newIndex } = message;
                            let oldContent: string | undefined;
                            let newContent: string | undefined;

                            if (oldIndex === -1) {
                                // 現在のファイルと比較
                                newContent = await localHistoryService.getCurrentContent(currentFileUri);
                            } else {
                                newContent = await localHistoryService.getHistoryContent(historyEntries[newIndex]);
                            }

                            if (newIndex === -1) {
                                oldContent = await localHistoryService.getCurrentContent(currentFileUri);
                            } else {
                                oldContent = await localHistoryService.getHistoryContent(historyEntries[oldIndex]);
                            }

                            if (oldContent !== undefined && newContent !== undefined) {
                                const stats = diffService.calculateDiffStats(
                                    diffService.createUnifiedDiff(oldContent, newContent, fileName)
                                );

                                panel.webview.postMessage({
                                    command: 'setDiff',
                                    original: oldContent,
                                    modified: newContent,
                                    filename: fileName,
                                    language: getLanguageId(fileName),
                                    stats: stats
                                });
                            }
                        }
                        break;

                    case 'selectEntries':
                        // 選択された履歴エントリを更新
                        selectedEntries = message.indices.map((i: number) => historyEntries[i]);
                        break;

                    case 'stageDiff':
                        // 選択された差分をステージング
                        {
                            if (selectedEntries.length === 0) {
                                vscode.window.showWarningMessage('Please select history entries first');
                                return;
                            }

                            const result = await diffService.createMergedDiff(selectedEntries, currentFileUri);
                            if (!result) {
                                vscode.window.showErrorMessage('Failed to create diff');
                                return;
                            }

                            const success = await diffService.applyPatchToStaging(result.patch, currentFileUri);
                            if (success) {
                                vscode.window.showInformationMessage(
                                    `Staged changes: +${result.stats.additions} -${result.stats.deletions}`
                                );
                            }
                        }
                        break;

                    case 'openInEditor':
                        // 履歴ファイルをエディタで開く
                        {
                            const entry = historyEntries[message.index];
                            if (entry) {
                                const doc = await vscode.workspace.openTextDocument(entry.uri);
                                await vscode.window.showTextDocument(doc, { preview: true });
                            }
                        }
                        break;

                    case 'openCurrentFile':
                        // 現在のファイルをエディタで開く
                        {
                            await vscode.window.showTextDocument(currentFileUri, { preview: true });
                        }
                        break;

                    case 'showVSCodeDiff':
                        // VS Code 標準の Diff エディタで開く
                        {
                            const { oldIndex, newIndex } = message;
                            let leftUri: vscode.Uri;
                            let rightUri: vscode.Uri;
                            let leftLabel: string;
                            let rightLabel: string;

                            if (oldIndex === -1) {
                                leftUri = currentFileUri;
                                leftLabel = 'Current';
                            } else {
                                leftUri = historyEntries[oldIndex].uri;
                                leftLabel = historyEntries[oldIndex].timestamp.toLocaleString();
                            }

                            if (newIndex === -1) {
                                rightUri = currentFileUri;
                                rightLabel = 'Current';
                            } else {
                                rightUri = historyEntries[newIndex].uri;
                                rightLabel = historyEntries[newIndex].timestamp.toLocaleString();
                            }

                            await vscode.commands.executeCommand(
                                'vscode.diff',
                                leftUri,
                                rightUri,
                                `${fileName}: ${leftLabel} ↔ ${rightLabel}`
                            );
                        }
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
