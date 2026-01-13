export enum EventType {
    FileCreate = "fileCreate", // エクスプローラなどでファイルを作成した時
    FileFocus = "fileFocus", // エディタでファイルにフォーカスが当たった時
    FileFocusTimeOut = "fileFocusTimeOut", // エディタでファイルにフォーカスが当たったまま、設定で定められた時間操作がなかった時
    FileSave = "fileSave", // エディタでファイルが保存された時
    FileDelete = "fileDelete", // エクスプローラなどでファイルが削除された時
    FileAutoCreateLocalHistory = "fileAutoCreateLocalHistory", // Local History が自動でバックアップを作成した時
    CodeAllEditorClose = "codeAllEditorClose", // Visual Studio Code でエディタが一つも開かれていない状態になった時
    CodeFocusOut = "codeFocusOut", // Visual Studio Code からフォーカスが外れた時
}

export interface EventTrack {
    timestamp: Date
    event: EventType
    filePath?: string | null
    remoteUrl?: string | null // リポジトリの GitHub URL など
    workSpaceFolder?: string | null // ワークスペースフォルダのパス（remoteUrl が存在しない場合）
    vscodeLocalHistoryId?: string | null // 保存時にのみ生成される
    includingCommitId?: string | null // このイベントが含む編集がコミットされたタイミングで書き込み
}

export async function writeEvent(event: EventTrack) {
    console.log('[vscode-tracer] writeEvent called:', JSON.stringify(event, null, 2));
}
