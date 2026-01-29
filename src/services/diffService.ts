import * as vscode from 'vscode';
import * as path from 'path';
import { createPatch, applyPatch } from 'diff';
import { gitService } from './gitService';
import { LocalHistoryEntry, localHistoryService } from './localHistoryService';

/**
 * Diff の統計情報
 */
export interface DiffStats {
    additions: number;
    deletions: number;
}

/**
 * Diff 生成・適用サービス
 */
export class DiffService {
    /**
     * 2つのテキストから Unified Diff を生成
     * @param oldContent 古い内容
     * @param newContent 新しい内容
     * @param filePath ファイルパス（パッチのヘッダーに使用）
     */
    createUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
        const oldFileName = `a/${filePath}`;
        const newFileName = `b/${filePath}`;

        return createPatch(filePath, oldContent, newContent, oldFileName, newFileName);
    }

    /**
     * 2つの履歴エントリ間の差分を生成
     * @param oldEntry 古い履歴エントリ
     * @param newEntry 新しい履歴エントリ
     */
    async createDiffBetweenEntries(
        oldEntry: LocalHistoryEntry,
        newEntry: LocalHistoryEntry
    ): Promise<{ patch: string; stats: DiffStats } | undefined> {
        const oldContent = await localHistoryService.getHistoryContent(oldEntry);
        const newContent = await localHistoryService.getHistoryContent(newEntry);

        if (oldContent === undefined || newContent === undefined) {
            return undefined;
        }

        const patch = this.createUnifiedDiff(oldContent, newContent, newEntry.originalPath);
        const stats = this.calculateDiffStats(patch);

        return { patch, stats };
    }

    /**
     * 履歴エントリと現在のファイルの差分を生成
     * @param entry 履歴エントリ
     * @param currentFileUri 現在のファイルのURI
     */
    async createDiffWithCurrent(
        entry: LocalHistoryEntry,
        currentFileUri: vscode.Uri
    ): Promise<{ patch: string; stats: DiffStats } | undefined> {
        const oldContent = await localHistoryService.getHistoryContent(entry);
        const currentContent = await localHistoryService.getCurrentContent(currentFileUri);

        if (oldContent === undefined || currentContent === undefined) {
            return undefined;
        }

        const patch = this.createUnifiedDiff(oldContent, currentContent, entry.originalPath);
        const stats = this.calculateDiffStats(patch);

        return { patch, stats };
    }

    /**
     * パッチから追加・削除行数を計算
     */
    calculateDiffStats(patch: string): DiffStats {
        const lines = patch.split('\n');
        let additions = 0;
        let deletions = 0;

        for (const line of lines) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
                additions++;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                deletions++;
            }
        }

        return { additions, deletions };
    }

    /**
     * パッチをステージングエリアに適用
     * git apply --cached を使用して、ワークツリーは変更せずにインデックスのみ変更
     * @param patch Unified Diff 形式のパッチ
     * @param workspaceUri ワークスペースのURI
     */
    async applyPatchToStaging(patch: string, workspaceUri?: vscode.Uri): Promise<boolean> {
        return await gitService.applyPatchToIndex(patch, workspaceUri);
    }

    /**
     * 複数の履歴エントリを選択して、それらの変更をマージした差分を生成
     * @param entries 選択された履歴エントリ（時系列順）
     * @param currentFileUri 現在のファイルのURI
     */
    async createMergedDiff(
        entries: LocalHistoryEntry[],
        currentFileUri: vscode.Uri
    ): Promise<{ patch: string; stats: DiffStats } | undefined> {
        if (entries.length === 0) {
            return undefined;
        }

        // 最も古いエントリと現在のファイルの差分を生成
        const sortedEntries = [...entries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const oldestEntry = sortedEntries[0];

        return await this.createDiffWithCurrent(oldestEntry, currentFileUri);
    }

    /**
     * テキストにパッチを適用（プレビュー用）
     */
    applyPatchToText(originalText: string, patch: string): string | false {
        return applyPatch(originalText, patch);
    }

    /**
     * ワークスペースのルートパスを取得
     */
    getWorkspaceRoot(): string | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        return workspaceFolders[0].uri.fsPath;
    }

    /**
     * ファイルパスをワークスペース相対パスに変換
     */
    toRelativePath(absolutePath: string): string {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) {
            return absolutePath;
        }
        return path.relative(workspaceRoot, absolutePath);
    }
}

export const diffService = new DiffService();
