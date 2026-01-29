// @ts-nocheck

const vscode = acquireVsCodeApi();
let diffEditor = null;
let editorConfig = {};

/**
 * CSS色（rgb, rgba, hex）を Monaco Editor 互換の #RRGGBBAA 形式に変換
 * @param {string | undefined} cssColor
 * @returns {string | undefined}
 */
function convertToMonacoColor(cssColor) {
    if (!cssColor) {return undefined;}

    // 既に # 形式の場合
    if (cssColor.startsWith('#')) {
        // #RGB → #RRGGBB
        if (cssColor.length === 4) {
            const r = cssColor[1], g = cssColor[2], b = cssColor[3];
            return `#${r}${r}${g}${g}${b}${b}`;
        }
        // #RGBA → #RRGGBBAA
        if (cssColor.length === 5) {
            const r = cssColor[1], g = cssColor[2], b = cssColor[3], a = cssColor[4];
            return `#${r}${r}${g}${g}${b}${b}${a}${a}`;
        }
        return cssColor; // #RRGGBB or #RRGGBBAA
    }

    // rgba(r, g, b, a) 形式
    const rgbaMatch = cssColor.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
    if (rgbaMatch) {
        const r = parseInt(rgbaMatch[1], 10);
        const g = parseInt(rgbaMatch[2], 10);
        const b = parseInt(rgbaMatch[3], 10);
        const a = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;

        const toHex = (n) => Math.round(n).toString(16).padStart(2, '0');
        const alphaHex = toHex(a * 255);

        return `#${toHex(r)}${toHex(g)}${toHex(b)}${alphaHex}`;
    }

    return cssColor;
}

/**
 * Monaco Editor を初期化
 */
function initializeMonaco() {
    // VS Code のテーマに合わせた設定
    const isDarkTheme = document.body.classList.contains('vscode-dark') ||
                        document.body.getAttribute('data-vscode-theme-kind') === 'vscode-dark' ||
                        getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim().startsWith('#1') ||
                        getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim().startsWith('#2');

    // VS Code CSS変数からテーマカラーを取得
    const style = getComputedStyle(document.body);

    // 色を取得して Monaco 形式に変換するヘルパー関数
    const getColor = (varName) => {
        const raw = style.getPropertyValue(varName).trim();
        return convertToMonacoColor(raw);
    };

    const colors = {};

    // エディタ基本色
    const editorBg = getColor('--vscode-editor-background');
    const editorFg = getColor('--vscode-editor-foreground');
    if (editorBg) {colors['editor.background'] = editorBg;}
    if (editorFg) {colors['editor.foreground'] = editorFg;}

    // 行番号
    const lineNumFg = getColor('--vscode-editorLineNumber-foreground');
    const lineNumActiveFg = getColor('--vscode-editorLineNumber-activeForeground');
    if (lineNumFg) {colors['editorLineNumber.foreground'] = lineNumFg;}
    if (lineNumActiveFg) {colors['editorLineNumber.activeForeground'] = lineNumActiveFg;}

    // 選択・ハイライト
    const selectionBg = getColor('--vscode-editor-selectionBackground');
    const lineHighlightBg = getColor('--vscode-editor-lineHighlightBackground');
    const cursorFg = getColor('--vscode-editorCursor-foreground');
    if (selectionBg) {colors['editor.selectionBackground'] = selectionBg;}
    if (lineHighlightBg) {colors['editor.lineHighlightBackground'] = lineHighlightBg;}
    if (cursorFg) {colors['editorCursor.foreground'] = cursorFg;}

    // Diff エディタの色（Monaco Editor の正しいキー名を使用）
    const insertedTextBg = getColor('--vscode-diffEditor-insertedTextBackground');
    const removedTextBg = getColor('--vscode-diffEditor-removedTextBackground');
    const insertedLineBg = getColor('--vscode-diffEditor-insertedLineBackground');
    const removedLineBg = getColor('--vscode-diffEditor-removedLineBackground');
    const diagonalFill = getColor('--vscode-diffEditor-diagonalFill');
    const insertedTextBorder = getColor('--vscode-diffEditor-insertedTextBorder');
    const removedTextBorder = getColor('--vscode-diffEditor-removedTextBorder');

    // フォールバック色（VS Code のデフォルトに近い色）
    const defaultInsertedBg = isDarkTheme ? '#9bb95533' : '#9ccc2c33';
    const defaultRemovedBg = isDarkTheme ? '#ff000033' : '#ff000033';

    // テキストのハイライト（インライン差分）
    colors['diffEditor.insertedTextBackground'] = insertedTextBg || defaultInsertedBg;
    colors['diffEditor.removedTextBackground'] = removedTextBg || defaultRemovedBg;
    if (insertedTextBorder) {colors['diffEditor.insertedTextBorder'] = insertedTextBorder;}
    if (removedTextBorder) {colors['diffEditor.removedTextBorder'] = removedTextBorder;}

    // 行全体の背景色
    colors['diffEditor.insertedLineBackground'] = insertedLineBg || insertedTextBg || defaultInsertedBg;
    colors['diffEditor.removedLineBackground'] = removedLineBg || removedTextBg || defaultRemovedBg;

    if (diagonalFill) {colors['diffEditor.diagonalFill'] = diagonalFill;}

    // Diff エディタのガター（行番号横のインジケータ）
    const addedGutterBg = getColor('--vscode-diffEditorGutter-insertedLineBackground');
    const removedGutterBg = getColor('--vscode-diffEditorGutter-removedLineBackground');
    if (addedGutterBg) {colors['diffEditorGutter.insertedLineBackground'] = addedGutterBg;}
    if (removedGutterBg) {colors['diffEditorGutter.removedLineBackground'] = removedGutterBg;}

    // デバッグ: 設定されている色を出力
    console.log('Monaco theme colors:', colors);
    console.log('isDarkTheme:', isDarkTheme);

    monaco.editor.defineTheme('vscode-tracer-theme', {
        base: isDarkTheme ? 'vs-dark' : 'vs',
        inherit: true,
        rules: [],
        colors: colors
    });

    monaco.editor.setTheme('vscode-tracer-theme');

    // 初期設定を要求
    vscode.postMessage({ command: 'requestEditorConfig' });
}

/**
 * Diff Editor を作成または更新する
 * @param {object} config
 */
function createOrUpdateDiffEditor(config = {}) {
    const container = document.getElementById('diff-editor');

    const options = {
        automaticLayout: true,
        readOnly: true,
        // Diff Editor 固有のオプション
        renderSideBySide: true,
        enableSplitViewResizing: true,
        ignoreTrimWhitespace: false,
        renderIndicators: true,
        renderMarginRevertIcon: true,
        originalEditable: false,
        diffWordWrap: 'off',
        // 共通エディタオプション
        fontSize: config.fontSize || 14,
        fontFamily: config.fontFamily || 'Menlo, Monaco, "Courier New", monospace',
        fontLigatures: config.fontLigatures || false,
        lineHeight: config.lineHeight || 0,
        tabSize: config.tabSize || 4,
        insertSpaces: config.insertSpaces !== false,
        wordWrap: config.wordWrap || 'off',
        minimap: config.minimap || { enabled: false },
        renderWhitespace: config.renderWhitespace || 'selection',
        cursorStyle: config.cursorStyle || 'line',
        cursorBlinking: config.cursorBlinking || 'blink',
        smoothScrolling: config.smoothScrolling || false,
        mouseWheelZoom: config.mouseWheelZoom || false,
        lineNumbers: config.lineNumbers || 'on',
        renderLineHighlight: config.renderLineHighlight || 'line',
        scrollBeyondLastLine: config.scrollBeyondLastLine !== false,
        bracketPairColorization: config.bracketPairColorization || { enabled: true },
        guides: config.guides || { indentation: true },
    };

    if (diffEditor) {
        // 既存のエディタの設定を更新
        diffEditor.updateOptions(options);
    } else {
        // 新規作成
        diffEditor = monaco.editor.createDiffEditor(container, options);

        // 初期表示用の空モデル（後で setHistoryData で更新される）
        const originalModel = monaco.editor.createModel('', 'plaintext');
        const modifiedModel = monaco.editor.createModel('', 'plaintext');

        diffEditor.setModel({
            original: originalModel,
            modified: modifiedModel,
        });
    }
}

// 拡張機能からのメッセージを受信
window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message.command) {
    case 'setEditorConfig':
        editorConfig = message.config || {};
        createOrUpdateDiffEditor(editorConfig);
        break;

    case 'setHistoryData':
        renderHistoryList(message.data, message.fileName, message.filePath, message.head, message.headCommitDate);
        // HEAD の内容を diff エディタに表示
        if (message.headContent !== undefined && diffEditor) {
            const language = message.language || 'plaintext';
            const originalModel = monaco.editor.createModel(message.headContent, language);
            const modifiedModel = monaco.editor.createModel(message.headContent, language);
            diffEditor.setModel({
                original: originalModel,
                modified: modifiedModel,
            });
            document.getElementById('diff-filename').textContent = message.fileName || '-';
        }
        break;

    case 'setDiff':
        if (diffEditor) {
            const language = message.language || 'plaintext';
            const originalModel = monaco.editor.createModel(message.original, language);
            const modifiedModel = monaco.editor.createModel(message.modified, language);

            diffEditor.setModel({
                original: originalModel,
                modified: modifiedModel,
            });

            if (message.filename) {
                document.getElementById('diff-filename').textContent = message.filename;
            }

            // Diff 統計を更新
            if (message.stats) {
                updateDiffStats(message.stats.additions, message.stats.deletions);
            }
        }
        break;
    }
});

// 履歴データと選択状態
let historyData = [];
let selectedIndices = new Set();
let currentFileName = '';
let currentFilePath = '';
let headCommit = '';
let headCommitDate = null;
let diffSizes = {}; // index => { additions, deletions }

/**
 * 履歴リストをレンダリング
 */
function renderHistoryList(data, fileName, filePath, head, commitDate) {
    historyData = data || [];
    currentFileName = fileName || '';
    currentFilePath = filePath || '';
    headCommit = head || 'HEAD';
    headCommitDate = commitDate ? new Date(commitDate) : null;

    const tableBody = document.getElementById('history-table-body');
    const panelTitle = document.getElementById('panel-title');

    if (panelTitle) {
        panelTitle.textContent = `履歴: ${currentFileName}`;
    }

    if (!tableBody) {return;}

    // HEAD を初期選択状態にする
    selectedIndices.clear();
    selectedIndices.add(-1);

    // HEADのコミット日時をフォーマット
    const headDateStr = headCommitDate ? formatDate(headCommitDate) : '現在';

    // 先頭行: 現在のコミット HEAD（常に選択状態、無効化）
    let html = `
        <vscode-table-row data-index="-1" selected>
            <vscode-table-cell>
                <vscode-checkbox class="row-checkbox" data-index="-1" checked disabled></vscode-checkbox>
            </vscode-table-cell>
            <vscode-table-cell><strong>HEAD</strong> (${headCommit.substring(0, 7)})</vscode-table-cell>
            <vscode-table-cell>${headDateStr}</vscode-table-cell>
            <vscode-table-cell>&ndash;</vscode-table-cell>
            <vscode-table-cell>
                <vscode-button appearance="icon" aria-label="Open" data-action="open" data-index="-1">
                    <vscode-icon name="eye"></vscode-icon>
                </vscode-button>
            </vscode-table-cell>
        </vscode-table-row>
    `;

    // CREATE DATE 順（古い順=昇順）でソート
    // HEAD を起点として、古い履歴から新しい履歴の順に表示
    const sortedHistoryData = [...historyData].sort((a, b) => {
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    sortedHistoryData.forEach((entry, sortedIndex) => {
        // 元のインデックスを取得（extension.ts との通信に使用）
        const originalIndex = historyData.indexOf(entry);
        const date = new Date(entry.timestamp);
        const formattedDate = formatDate(date);
        const diffSize = diffSizes[originalIndex];
        const diffSizeStr = diffSize ? `<span class="additions">+${diffSize.additions}</span> <span class="deletions">-${diffSize.deletions}</span>` : '&ndash;';

        html += `
            <vscode-table-row data-index="${originalIndex}">
                <vscode-table-cell>
                    <vscode-checkbox class="row-checkbox" data-index="${originalIndex}"></vscode-checkbox>
                </vscode-table-cell>
                <vscode-table-cell>${entry.source}</vscode-table-cell>
                <vscode-table-cell>${formattedDate}</vscode-table-cell>
                <vscode-table-cell>${diffSizeStr}</vscode-table-cell>
                <vscode-table-cell>
                    <vscode-button appearance="icon" aria-label="Open" data-action="open" data-index="${originalIndex}">
                        <vscode-icon name="eye"></vscode-icon>
                    </vscode-button>
                </vscode-table-cell>
            </vscode-table-row>
        `;
    });

    tableBody.innerHTML = html;

    // イベントリスナーを設定
    setupHistoryListeners();
}

/**
 * 日付を YYYY/MM/DD HH:MM:SS 形式でフォーマット
 */
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 履歴リストのイベントリスナーを設定
 */
function setupHistoryListeners() {
    const tableBody = document.getElementById('history-table-body');
    if (!tableBody) {return;}

    // 履歴エントリのチェックボックス（HEAD以外）
    // ラジオボタンのように1つだけ選択可能
    tableBody.querySelectorAll('.row-checkbox:not([disabled])').forEach((checkbox) => {
        const handleCheckboxChange = () => {
            const index = parseInt(checkbox.dataset.index, 10);
            const isChecked = checkbox.checked || checkbox.hasAttribute('checked');
            console.log('[Tracer] Checkbox changed:', index, 'checked:', isChecked);

            if (isChecked) {
                // 他の履歴エントリの選択を解除（HEADは除く）
                selectedIndices.forEach((i) => {
                    if (i !== -1 && i !== index) {
                        selectedIndices.delete(i);
                        // UIも更新
                        const otherCheckbox = tableBody.querySelector(`.row-checkbox[data-index="${i}"]`);
                        if (otherCheckbox) {
                            otherCheckbox.checked = false;
                            otherCheckbox.removeAttribute('checked');
                        }
                    }
                });
                selectedIndices.add(index);
            } else {
                selectedIndices.delete(index);
            }

            console.log('[Tracer] selectedIndices after:', Array.from(selectedIndices));
            updateSelectionUI();
            requestDiffForSelection();
        };

        // vscode-elements のカスタムイベント
        checkbox.addEventListener('vsc-change', handleCheckboxChange);
        // フォールバック: 標準の change イベント
        checkbox.addEventListener('change', handleCheckboxChange);
        // フォールバック: click イベント
        checkbox.addEventListener('click', (e) => {
            // click 後に状態が更新されるのを待つ
            setTimeout(handleCheckboxChange, 0);
        });
    });

    // アクションボタンクリック
    tableBody.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const action = btn.dataset.action;
            const index = parseInt(btn.dataset.index, 10);

            if (action === 'open') {
                if (index === -1) {
                    // HEAD は現在のファイルを開く
                    vscode.postMessage({ command: 'openCurrentFile' });
                } else {
                    vscode.postMessage({ command: 'openInEditor', index });
                }
            }
        });
    });
}

/**
 * 選択状態のUIを更新
 */
function updateSelectionUI() {
    const rows = document.querySelectorAll('vscode-table-row');
    rows.forEach((row) => {
        const index = parseInt(row.dataset.index, 10);
        if (selectedIndices.has(index)) {
            row.setAttribute('selected', '');
        } else {
            row.removeAttribute('selected');
        }
    });

    // ステージボタンの有効/無効（HEAD + 履歴エントリ1つが選択されている時に有効）
    const stageBtn = document.getElementById('stage-btn');
    if (stageBtn) {
        // HEAD以外の選択があるかチェック
        const hasHistorySelection = Array.from(selectedIndices).some(i => i >= 0);
        stageBtn.disabled = !hasHistorySelection;
    }

    // 選択されたインデックスを拡張機能に通知
    vscode.postMessage({
        command: 'selectEntries',
        indices: Array.from(selectedIndices).filter(i => i >= 0) // -1（現在のファイル）は除外
    });
}

/**
 * 選択に基づいて差分を要求
 * diff 元: 常に HEAD (Git の最新コミット)
 * diff 先: 選択した履歴エントリ
 */
function requestDiffForSelection() {
    // HEAD 以外の選択されたインデックスを取得
    const historyIndex = Array.from(selectedIndices).find(i => i >= 0);
    console.log('[Tracer] requestDiffForSelection, historyIndex:', historyIndex);

    if (historyIndex === undefined) {
        // 履歴エントリが選択されていない → diff なし
        console.log('[Tracer] No history entry selected, no diff');
        return;
    }

    // HEAD (original) vs 履歴エントリ (modified)
    console.log('[Tracer] Requesting diff: HEAD vs history entry', historyIndex);
    vscode.postMessage({
        command: 'requestDiff',
        historyIndex: historyIndex
    });
}

/**
 * Diff統計を更新
 */
function updateDiffStats(additions, deletions) {
    const statsEl = document.getElementById('diff-stats');
    if (statsEl) {
        statsEl.innerHTML = `
            <span class="additions">+${additions}</span>
            <span class="deletions">-${deletions}</span>
        `;
    }
}

// ステージボタン
document.getElementById('stage-btn')?.addEventListener('click', () => {
    vscode.postMessage({ command: 'stageDiff' });
});

// VS Code Diff で開くボタン
document.getElementById('open-vscode-diff-btn')?.addEventListener('click', () => {
    const indices = Array.from(selectedIndices).sort((a, b) => a - b);
    if (indices.length >= 2) {
        const oldIndex = indices[indices.length - 1];
        const newIndex = indices[0];
        vscode.postMessage({
            command: 'showVSCodeDiff',
            oldIndex,
            newIndex
        });
    } else if (indices.length === 1 && indices[0] !== -1) {
        vscode.postMessage({
            command: 'showVSCodeDiff',
            oldIndex: indices[0],
            newIndex: -1
        });
    }
});

// リサイザーのドラッグ処理
(function setupResizer() {
    const resizer = document.getElementById('resizer');
    const historyPanel = document.querySelector('.history-panel');

    if (!resizer || !historyPanel) {return;}

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = historyPanel.offsetHeight;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) {return;}

        const deltaY = e.clientY - startY;
        const newHeight = Math.max(80, Math.min(startHeight + deltaY, window.innerHeight - 100));
        historyPanel.style.height = `${newHeight}px`;

        // Monaco Editor のレイアウトを更新
        if (diffEditor) {
            diffEditor.layout();
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
})();

// Monaco Editor の初期化（require を使用）
require(['vs/editor/editor.main'], function () {
    initializeMonaco();
});
