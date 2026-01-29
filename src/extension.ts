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
            const allHistoryEntries = await localHistoryService.getHistoryForFile(currentFileUri);

            // HEAD コミット情報を取得
            const headInfo = await gitService.getHeadCommitInfo(currentFileUri);
            const headCommitDate = headInfo?.commitDate;

            // デバッグログ
            console.log('[Tracer] HEAD commit info:', headInfo);
            console.log('[Tracer] HEAD commit date:', headCommitDate?.toISOString());
            console.log('[Tracer] All history entries count:', allHistoryEntries.length);
            if (allHistoryEntries.length > 0) {
                console.log('[Tracer] Latest history entry date:', allHistoryEntries[0].timestamp.toISOString());
            }

            // HEAD のコミット日時より新しい履歴エントリのみをフィルタリング
            // headCommitDate が undefined の場合は全ての履歴を表示
            const historyEntries = headCommitDate
                ? allHistoryEntries.filter(entry => entry.timestamp.getTime() > headCommitDate.getTime())
                : allHistoryEntries;

            console.log('[Tracer] Filtered history entries count:', historyEntries.length);

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

                        // HEAD コミットのファイル内容を取得
                        {
                            const relativePath = diffService.toRelativePath(currentFileUri.fsPath);
                            const headContent = await gitService.getFileContent('HEAD', relativePath, currentFileUri);

                            // 履歴データを送信
                            panel.webview.postMessage({
                                command: 'setHistoryData',
                                data: historyData,
                                fileName: fileName,
                                filePath: relativePath,
                                head: headInfo?.hash || 'HEAD',
                                headCommitDate: headCommitDate?.toISOString() || null,
                                headContent: headContent || '',
                                language: getLanguageId(fileName)
                            });
                        }
                        break;

                    case 'requestDiff':
                        // HEAD と履歴エントリの差分を要求
                        // diff 元 (original): 常に HEAD (Git の最新コミット)
                        // diff 先 (modified): 選択した履歴エントリ
                        {
                            const { historyIndex } = message;
                            const relativePath = diffService.toRelativePath(currentFileUri.fsPath);

                            console.log('[Tracer] requestDiff received, historyIndex:', historyIndex);

                            // original: HEAD (Git の最新コミット時点のファイル内容)
                            const originalContent = await gitService.getFileContent('HEAD', relativePath, currentFileUri);

                            // modified: 履歴エントリの内容
                            const modifiedContent = await localHistoryService.getHistoryContent(historyEntries[historyIndex]);

                            console.log('[Tracer] originalContent (HEAD) length:', originalContent?.length);
                            console.log('[Tracer] modifiedContent (history) length:', modifiedContent?.length);

                            if (originalContent !== undefined && modifiedContent !== undefined) {
                                const stats = diffService.calculateDiffStats(
                                    diffService.createUnifiedDiff(originalContent, modifiedContent, fileName)
                                );

                                panel.webview.postMessage({
                                    command: 'setDiff',
                                    original: originalContent,
                                    modified: modifiedContent,
                                    filename: fileName,
                                    language: getLanguageId(fileName),
                                    stats: stats
                                });
                            } else {
                                console.error('[Tracer] Failed to get content:', { originalContent: !!originalContent, modifiedContent: !!modifiedContent });
                            }
                        }
                        break;

                    case 'selectEntries':
                        // 選択された履歴エントリを更新
                        selectedEntries = message.indices.map((i: number) => historyEntries[i]);
                        console.log('[Tracer] Selected entries:', selectedEntries.length);
                        break;

                    case 'stageDiff':
                        // 選択された差分をステージング
                        {
                            console.log('[Tracer] stageDiff called, selectedEntries:', selectedEntries.length);

                            if (selectedEntries.length === 0) {
                                vscode.window.showWarningMessage('Please select history entries first');
                                return;
                            }

                            // 選択された履歴エントリの内容を取得
                            const historyContent = await localHistoryService.getHistoryContent(selectedEntries[0]);
                            if (historyContent === undefined) {
                                vscode.window.showErrorMessage('Failed to read history content');
                                return;
                            }

                            // HEAD の内容を取得
                            const relativePath = diffService.toRelativePath(currentFileUri.fsPath);
                            const headContent = await gitService.getFileContent('HEAD', relativePath, currentFileUri) || '';

                            // 統計情報を計算
                            const patch = diffService.createUnifiedDiff(headContent, historyContent, relativePath);
                            const stats = diffService.calculateDiffStats(patch);

                            console.log('[Tracer] Staging - HEAD length:', headContent.length, ', History length:', historyContent.length);
                            console.log('[Tracer] Generated patch:\n', patch);

                            // パッチを適用
                            const success = await gitService.applyPatchToIndex(patch, currentFileUri);
                            if (success) {
                                // 選択された履歴エントリの最も古い日時を取得
                                const oldestEntry = selectedEntries.reduce((oldest, entry) =>
                                    entry.timestamp < oldest.timestamp ? entry : oldest
                                );
                                const commitDate = oldestEntry.timestamp;

                                // コミットメッセージを入力
                                const commitMessage = await vscode.window.showInputBox({
                                    prompt: `コミットメッセージを入力 (コミット日時: ${commitDate.toLocaleString()})`,
                                    placeHolder: 'Commit message...',
                                    value: `[Tracer] Restore from local history (${commitDate.toLocaleString()})`
                                });

                                if (commitMessage) {
                                    // 日時指定でコミット
                                    const commitSuccess = await gitService.commitWithDate(commitMessage, commitDate, currentFileUri);
                                    if (commitSuccess) {
                                        vscode.window.showInformationMessage(
                                            `Committed: +${stats.additions} -${stats.deletions} (date: ${commitDate.toLocaleString()})`
                                        );
                                        // 履歴リストを更新するためにパネルをリフレッシュ
                                        // TODO: 履歴の再読み込み
                                    }
                                } else {
                                    vscode.window.showInformationMessage(
                                        `Staged changes: +${stats.additions} -${stats.deletions} (not committed)`
                                    );
                                }
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
