import * as vscode from "vscode";
import * as path from "path";
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

            // 最初のエディタ参照を保持（リフレッシュ時にも使用）
            let initialEditor = activeEditor;

            // 履歴データを取得する関数
            async function loadHistoryData() {
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

                // HEAD のコミット日時以降の履歴エントリをフィルタリング
                // headCommitDate が undefined の場合は全ての履歴を表示
                let filteredEntries = headCommitDate
                    ? allHistoryEntries.filter(entry => entry.timestamp.getTime() >= headCommitDate.getTime())
                    : allHistoryEntries;

                // 現在のエディタの内容を仮想エントリとして常に追加
                // （まだ entries.json に書き込まれていない最新の編集を反映）
                // 最初に保持したエディタか、現在見つかるエディタを使用
                const currentEditor = vscode.window.visibleTextEditors.find(
                    editor => editor.document.uri.fsPath === currentFileUri.fsPath
                ) || initialEditor;

                console.log('[Tracer] Current editor found:', !!currentEditor, 'URI matches:', currentEditor?.document.uri.fsPath === currentFileUri.fsPath);

                if (currentEditor && currentEditor.document.uri.fsPath === currentFileUri.fsPath) {
                    const virtualEntry: LocalHistoryEntry = {
                        uri: currentFileUri,
                        originalPath: diffService.toRelativePath(currentFileUri.fsPath),
                        timestamp: new Date(),
                        source: 'Current Change',
                        historyFilePath: currentFileUri.fsPath
                    };
                    filteredEntries = [virtualEntry, ...filteredEntries];
                    console.log('[Tracer] Added virtual entry for current editor content');
                }

                console.log('[Tracer] Filtered history entries count:', filteredEntries.length);

                return { allHistoryEntries, filteredEntries, headInfo, headCommitDate };
            }

            // 初回読み込み
            let { filteredEntries: historyEntries, headInfo, headCommitDate } = await loadHistoryData();

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

            // 履歴データを Webview 送信用に変換する関数
            function convertHistoryData(entries: LocalHistoryEntry[]) {
                return entries.map((entry, index) => ({
                    id: index,
                    timestamp: entry.timestamp.toISOString(),
                    source: entry.source,
                    uri: entry.uri.toString(),
                    historyFileName: path.basename(entry.historyFilePath),
                }));
            }

            // 履歴データを Webview に送信する関数
            async function sendHistoryData() {
                const relativePath = diffService.toRelativePath(currentFileUri.fsPath);
                const headContent = await gitService.getFileContent('HEAD', relativePath, currentFileUri);
                const historyData = convertHistoryData(historyEntries);

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

                        // 履歴データを送信
                        await sendHistoryData();
                        break;

                    case 'refresh':
                        // 履歴データを再読み込み
                        {
                            console.log('[Tracer] Refreshing history data...');
                            const result = await loadHistoryData();
                            historyEntries = result.filteredEntries;
                            headInfo = result.headInfo;
                            headCommitDate = result.headCommitDate;
                            console.log('[Tracer] Loaded', historyEntries.length, 'history entries');

                            // 選択状態をリセット
                            selectedEntries = [];

                            // 履歴データを再送信
                            await sendHistoryData();
                            console.log('[Tracer] History data sent to webview');

                            vscode.window.showInformationMessage('History refreshed');
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
                            let modifiedContent: string | undefined;
                            const historyEntry = historyEntries[historyIndex];

                            if (historyEntry.source === 'Current Change') {
                                // 仮想エントリの場合、エディタから直接内容を取得
                                const currentEditor = vscode.window.visibleTextEditors.find(
                                    editor => editor.document.uri.fsPath === currentFileUri.fsPath
                                ) || initialEditor;
                                modifiedContent = currentEditor?.document.getText();
                                console.log('[Tracer] Retrieved content from current editor, length:', modifiedContent?.length);
                            } else {
                                // 通常の履歴エントリ
                                modifiedContent = await localHistoryService.getHistoryContent(historyEntry);
                            }

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
                            let historyContent: string | undefined;
                            const selectedEntry = selectedEntries[0];

                            if (selectedEntry.source === 'Current Change') {
                                // 仮想エントリの場合、エディタから直接内容を取得
                                const currentEditor = vscode.window.visibleTextEditors.find(
                                    editor => editor.document.uri.fsPath === currentFileUri.fsPath
                                ) || initialEditor;
                                historyContent = currentEditor?.document.getText();
                                console.log('[Tracer] Retrieved content from current editor for staging, length:', historyContent?.length);
                            } else {
                                // 通常の履歴エントリ
                                historyContent = await localHistoryService.getHistoryContent(selectedEntry);
                            }

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
                                if (entry.source === 'Current Change') {
                                    // 仮想エントリの場合、現在のファイルを表示
                                    await vscode.window.showTextDocument(currentFileUri, { preview: true });
                                } else {
                                    // 通常の履歴エントリ
                                    const doc = await vscode.workspace.openTextDocument(entry.uri);
                                    await vscode.window.showTextDocument(doc, { preview: true });
                                }
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
