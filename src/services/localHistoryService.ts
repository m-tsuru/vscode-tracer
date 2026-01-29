import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * ローカル履歴のエントリ
 */
export interface LocalHistoryEntry {
    /** 履歴ファイルのURI */
    uri: vscode.Uri;
    /** 元のファイルパス（相対パス） */
    originalPath: string;
    /** 履歴が作成された日時 */
    timestamp: Date;
    /** ソース（'auto', 'manual' など） */
    source: string;
    /** 履歴ファイルの絶対パス */
    historyFilePath: string;
}

/**
 * VS Code のローカル履歴を読み取るサービス
 *
 * ローカル履歴は以下の場所に保存されています:
 * - macOS: ~/Library/Application Support/Code/User/History/
 * - Windows: %APPDATA%\Code\User\History\
 * - Linux: ~/.config/Code/User/History/
 *
 * 各ファイルのハッシュディレクトリ内に entries.json があり、
 * そこに履歴エントリの情報が格納されています。
 */
export class LocalHistoryService {
    private historyBasePath: string;

    constructor() {
        this.historyBasePath = this.getHistoryBasePath();
    }

    /**
     * OS に応じたローカル履歴のベースパスを取得
     */
    private getHistoryBasePath(): string {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';

        switch (process.platform) {
        case 'darwin':
            return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'History');
        case 'win32':
            return path.join(process.env.APPDATA || '', 'Code', 'User', 'History');
        default: // Linux
            return path.join(homeDir, '.config', 'Code', 'User', 'History');
        }
    }

    /**
     * 特定のファイルのローカル履歴エントリを取得
     * @param fileUri 対象ファイルのURI
     * @param forceReload 強制的に最新データを読み込む（デフォルト: true）
     */
    async getHistoryForFile(fileUri: vscode.Uri, forceReload: boolean = true): Promise<LocalHistoryEntry[]> {
        const entries: LocalHistoryEntry[] = [];

        console.log('[LocalHistoryService] Reading history for:', fileUri.fsPath);
        console.log('[LocalHistoryService] History base path:', this.historyBasePath);

        try {
            // History ディレクトリ内のすべてのサブディレクトリをスキャン
            const historyDirs = await fs.promises.readdir(this.historyBasePath, { withFileTypes: true });
            console.log('[LocalHistoryService] Found', historyDirs.length, 'history directories');

            for (const dir of historyDirs) {
                if (!dir.isDirectory()) {continue;}

                const entriesJsonPath = path.join(this.historyBasePath, dir.name, 'entries.json');

                try {
                    // ファイルの統計情報を取得（最終更新日時確認用）
                    const stats = await fs.promises.stat(entriesJsonPath);
                    console.log(`[LocalHistoryService] Reading ${entriesJsonPath} (modified: ${stats.mtime.toISOString()})`);

                    const entriesContent = await fs.promises.readFile(entriesJsonPath, 'utf-8');
                    const entriesData = JSON.parse(entriesContent);

                    // このディレクトリが対象ファイルの履歴かどうかを確認
                    if (entriesData.resource && this.matchesFile(entriesData.resource, fileUri)) {
                        console.log('[LocalHistoryService] Matched file! Resource:', entriesData.resource);
                        console.log('[LocalHistoryService] Raw entries count:', entriesData.entries?.length || 0);

                        // 各履歴エントリを処理
                        if (entriesData.entries && Array.isArray(entriesData.entries)) {
                            console.log('[LocalHistoryService] Processing entries:');
                            for (const entry of entriesData.entries) {
                                const historyFilePath = path.join(
                                    this.historyBasePath,
                                    dir.name,
                                    entry.id
                                );

                                const timestamp = new Date(entry.timestamp);
                                console.log(`  - Entry ID: ${entry.id}, Timestamp: ${timestamp.toISOString()}, Source: ${entry.source || 'auto'}`);

                                entries.push({
                                    uri: vscode.Uri.file(historyFilePath),
                                    originalPath: this.extractRelativePath(entriesData.resource, fileUri),
                                    timestamp: timestamp,
                                    source: entry.source || 'Auto Save',
                                    historyFilePath
                                });
                            }
                        }
                    }
                } catch (err) {
                    // entries.json が存在しないか読み取れない場合はスキップ
                    continue;
                }
            }
        } catch (error) {
            console.error('[LocalHistoryService] Failed to read local history:', error);
        }

        console.log('[LocalHistoryService] Total entries found:', entries.length);

        // 日時の降順でソート（新しい順）
        return entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }

    /**
     * 履歴のリソースパスが対象ファイルと一致するか確認
     */
    private matchesFile(resourcePath: string, fileUri: vscode.Uri): boolean {
        // リソースパスは file:///path/to/file の形式
        try {
            const resourceUri = vscode.Uri.parse(resourcePath);
            return resourceUri.fsPath === fileUri.fsPath;
        } catch {
            return false;
        }
    }

    /**
     * リソースパスからワークスペース相対パスを抽出
     */
    private extractRelativePath(resourcePath: string, fileUri: vscode.Uri): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return fileUri.fsPath;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        if (fileUri.fsPath.startsWith(workspaceRoot)) {
            return path.relative(workspaceRoot, fileUri.fsPath);
        }

        return fileUri.fsPath;
    }

    /**
     * 履歴エントリのファイル内容を取得
     */
    async getHistoryContent(entry: LocalHistoryEntry): Promise<string | undefined> {
        try {
            return await fs.promises.readFile(entry.historyFilePath, 'utf-8');
        } catch (error) {
            console.error('Failed to read history file:', error);
            return undefined;
        }
    }

    /**
     * 現在のファイル内容を取得
     */
    async getCurrentContent(fileUri: vscode.Uri): Promise<string | undefined> {
        try {
            const document = await vscode.workspace.openTextDocument(fileUri);
            return document.getText();
        } catch (error) {
            console.error('Failed to read current file:', error);
            return undefined;
        }
    }

    /**
     * 履歴ベースパスが存在するか確認
     */
    async isAvailable(): Promise<boolean> {
        try {
            await fs.promises.access(this.historyBasePath);
            return true;
        } catch {
            return false;
        }
    }
}

export const localHistoryService = new LocalHistoryService();
