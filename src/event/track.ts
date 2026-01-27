import * as vscode from "vscode";
import * as writeEvent from "./write";

// フォーカスタイムアウト用のタイマー管理
let focusTimeoutTimer: NodeJS.Timeout | undefined;
let currentFocusedUri: vscode.Uri | undefined;

async function getTracerConfigValue() {
    const config = vscode.workspace.getConfiguration('vscode-tracer');
    return {
        FileFocusTimeOut: config.get<number>('fileFocusTimeOut', 6000),
    };
}

async function getGitRepository(uri: vscode.Uri) {
    try {
        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
        if (!gitExtension) {
            console.log('[vscode-tracer] Git extension not found');
            return {};
        }

        const gitApi = gitExtension.getAPI(1);
        if (!gitApi) {
            console.log('[vscode-tracer] Git API not available');
            return {};
        }

        const repository = gitApi.getRepository(uri);
        if (!repository) {
            console.log('[vscode-tracer] No Git repository found for URI:', uri.fsPath);
            return {};
        }

        return {
            remoteUrl: repository.state.remotes?.find((r: any) => r.name === 'origin')?.fetchUrl
                        || repository.state.remotes?.[0]?.fetchUrl || null,
            includingCommitId: repository.state.HEAD?.commit || null,
        };
    } catch (error) {
        console.error("[vscode-tracer] Failed to get Git information:", error);
        return {};
    }
}

// ヘルパー関数: イベントを作成
async function createEvent(
    eventType: writeEvent.EventType,
    uri?: vscode.Uri,
    additionalData?: Partial<writeEvent.EventTrack>
): Promise<writeEvent.EventTrack> {
    const workspaceFolder = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    const gitInfo = uri ? await getGitRepository(uri) : {};

    return {
        timestamp: new Date(),
        event: eventType,
        filePath: uri?.fsPath || null,
        workSpaceFolder: workspaceFolder?.uri.fsPath || null,
        vscodeLocalHistoryId: null,
        includingCommitId: gitInfo.includingCommitId || null,
        remoteUrl: gitInfo.remoteUrl || null,
        ...additionalData,
    };
}

// フォーカスタイムアウトタイマーをリセット
function resetFocusTimeoutTimer() {
    if (focusTimeoutTimer) {
        clearTimeout(focusTimeoutTimer);
        focusTimeoutTimer = undefined;
    }
}

// フォーカスタイムアウトタイマーを開始
async function startFocusTimeoutTimer(uri: vscode.Uri) {
    resetFocusTimeoutTimer();
    currentFocusedUri = uri;

    const config = await getTracerConfigValue();
    focusTimeoutTimer = setTimeout(async () => {
        if (currentFocusedUri) {
            await handleFileFocusTimeOut(currentFocusedUri);
        }
    }, config.FileFocusTimeOut);
}

// FileFocus: エディタでファイルにフォーカスが当たった時
export async function handleFileFocus(e: vscode.TextEditor | undefined): Promise<writeEvent.EventTrack | undefined> {
    console.log('[vscode-tracer] handleFileFocus called', e?.document.fileName);
    if (!e) {
        console.log('[vscode-tracer] No editor provided');
        resetFocusTimeoutTimer();
        return;
    }

    const uri = e.document.uri;
    const event = await createEvent(writeEvent.EventType.FileFocus, uri);

    await writeEvent.writeEvent(event);

    // フォーカスタイムアウトタイマーを開始
    await startFocusTimeoutTimer(uri);

    return event;
}

// FileFocusTimeOut: エディタでファイルにフォーカスが当たったまま、設定で定められた時間操作がなかった時
export async function handleFileFocusTimeOut(uri: vscode.Uri): Promise<writeEvent.EventTrack | undefined> {
    console.log('[vscode-tracer] handleFileFocusTimeOut called', uri.fsPath);

    const event = await createEvent(writeEvent.EventType.FileFocusTimeOut, uri);

    await writeEvent.writeEvent(event);
    return event;
}

// FileCreate: エクスプローラなどでファイルを作成した時
export async function handleFileCreate(uri: vscode.Uri): Promise<writeEvent.EventTrack | undefined> {
    console.log('[vscode-tracer] handleFileCreate called', uri.fsPath);

    const event = await createEvent(writeEvent.EventType.FileCreate, uri);

    await writeEvent.writeEvent(event);
    return event;
}

// FileSave: エディタでファイルが保存された時
export async function handleFileSave(document: vscode.TextDocument): Promise<writeEvent.EventTrack | undefined> {
    console.log('[vscode-tracer] handleFileSave called', document.fileName);

    const uri = document.uri;
    const event = await createEvent(writeEvent.EventType.FileSave, uri);

    await writeEvent.writeEvent(event);

    // 保存時はタイマーをリセットして再開始
    await startFocusTimeoutTimer(uri);

    return event;
}

// FileDelete: エクスプローラなどでファイルが削除された時
export async function handleFileDelete(uri: vscode.Uri): Promise<writeEvent.EventTrack | undefined> {
    console.log('[vscode-tracer] handleFileDelete called', uri.fsPath);

    const event = await createEvent(writeEvent.EventType.FileDelete, uri);

    await writeEvent.writeEvent(event);
    return event;
}

// FileAutoCreateLocalHistory: Local History が自動でバックアップを作成した時
export async function handleFileAutoCreateLocalHistory(
    uri: vscode.Uri,
    localHistoryId: string
): Promise<writeEvent.EventTrack | undefined> {
    console.log('[vscode-tracer] handleFileAutoCreateLocalHistory called', uri.fsPath, localHistoryId);

    const event = await createEvent(writeEvent.EventType.FileAutoCreateLocalHistory, uri, {
        vscodeLocalHistoryId: localHistoryId,
    });

    await writeEvent.writeEvent(event);
    return event;
}

// CodeAllEditorClose: Visual Studio Code でエディタが一つも開かれていない状態になった時
export async function handleCodeAllEditorClose(): Promise<writeEvent.EventTrack | undefined> {
    console.log('[vscode-tracer] handleCodeAllEditorClose called');

    resetFocusTimeoutTimer();

    const event = await createEvent(writeEvent.EventType.CodeAllEditorClose);

    await writeEvent.writeEvent(event);
    return event;
}

// CodeFocusOut: Visual Studio Code からフォーカスが外れた時
export async function handleCodeFocusOut(): Promise<writeEvent.EventTrack | undefined> {
    console.log('[vscode-tracer] handleCodeFocusOut called');

    resetFocusTimeoutTimer();

    const event = await createEvent(writeEvent.EventType.CodeFocusOut, currentFocusedUri);

    await writeEvent.writeEvent(event);
    return event;
}

// ユーザーアクティビティがあった時にタイマーをリセット（テキスト変更など）
export async function handleUserActivity(): Promise<void> {
    if (currentFocusedUri) {
        await startFocusTimeoutTimer(currentFocusedUri);
    }
}

// クリーンアップ用
export function dispose(): void {
    resetFocusTimeoutTimer();
}
