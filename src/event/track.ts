import * as vscode from "vscode";
import * as writeEvent from "./write";
import { write } from "fs";

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

export async function handleFileFocus(e: vscode.TextEditor | undefined): Promise<writeEvent.EventTrack | undefined> {
    console.log('[vscode-tracer] handleFileFocus called', e?.document.fileName);
    if (!e) {
        console.log('[vscode-tracer] No editor provided');
        return;
    }

    // ファイルのパス, ワークスペースの取得
    const d = e.document;
    const uri = d.uri;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

    // Git リモート URL の取得
    const gitInfo = await getGitRepository(uri);

    const event: writeEvent.EventTrack = {
        timestamp: new Date(),
        event: writeEvent.EventType.FileFocus,
        filePath: uri.fsPath,
        workSpaceFolder: workspaceFolder?.uri.fsPath,
        vscodeLocalHistoryId: null,
        includingCommitId: null,
        remoteUrl: gitInfo.remoteUrl || null,
    };

    await writeEvent.writeEvent(event);
    return event;
}
