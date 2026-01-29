import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// VS Code Git 拡張機能の API 型定義
interface GitExtension {
    getAPI(version: number): GitAPI;
}

interface GitAPI {
    repositories: Repository[];
    onDidOpenRepository: vscode.Event<Repository>;
}

interface Repository {
    rootUri: vscode.Uri;
    show(ref: string, path: string): Promise<string>;
    diff(cached?: boolean): Promise<string>;
    apply(patch: string, reverse?: boolean): Promise<void>;
    add(paths: string[]): Promise<void>;
    commit(message: string): Promise<void>;
    log(options?: { maxEntries?: number; path?: string }): Promise<Commit[]>;
    state: RepositoryState;
    inputBox: InputBox;
}

interface RepositoryState {
    HEAD: Ref | undefined;
    workingTreeChanges: Change[];
    indexChanges: Change[];
}

interface Ref {
    commit?: string;
    name?: string;
}

interface Change {
    uri: vscode.Uri;
    status: number;
}

interface InputBox {
    value: string;
}

interface Commit {
    hash: string;
    message: string;
    parents: string[];
    authorDate?: Date;
    authorName?: string;
    authorEmail?: string;
    commitDate?: Date;
}

/**
 * VS Code Git 拡張機能のラッパーサービス
 */
export class GitService {
    private gitAPI: GitAPI | undefined;

    /**
     * Git API を初期化
     */
    async initialize(): Promise<boolean> {
        try {
            const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
            if (!gitExtension) {
                vscode.window.showErrorMessage('Git extension is not installed');
                return false;
            }

            if (!gitExtension.isActive) {
                await gitExtension.activate();
            }

            this.gitAPI = gitExtension.exports.getAPI(1);
            return true;
        } catch (error) {
            console.error('Failed to initialize Git API:', error);
            return false;
        }
    }

    /**
     * 現在のワークスペースのリポジトリを取得
     */
    getRepository(workspaceUri?: vscode.Uri): Repository | undefined {
        if (!this.gitAPI) {
            return undefined;
        }

        if (workspaceUri) {
            return this.gitAPI.repositories.find(repo =>
                workspaceUri.fsPath.startsWith(repo.rootUri.fsPath)
            );
        }

        return this.gitAPI.repositories[0];
    }

    /**
     * 特定のリビジョンにおけるファイルの内容を取得
     * @param ref コミットハッシュまたはリビジョン（HEAD, HEAD~1 など）
     * @param filePath ファイルの相対パス
     */
    async getFileContent(ref: string, filePath: string, workspaceUri?: vscode.Uri): Promise<string | undefined> {
        const repo = this.getRepository(workspaceUri);
        if (!repo) {
            console.error('[GitService] No repository found');
            return undefined;
        }

        try {
            console.log(`[GitService] Getting file content for ${ref}:${filePath}`);
            const content = await repo.show(ref, filePath);
            console.log(`[GitService] Content length: ${content?.length}`);
            return content;
        } catch (error) {
            // ファイルがまだコミットされていない場合は空文字を返す
            console.error(`[GitService] Failed to get file content for ${ref}:${filePath}:`, error);
            return '';
        }
    }

    /**
     * パッチをステージングエリアに適用（ワークツリーは変更しない）
     * git apply --cached を直接実行
     * @param patch Unified Diff 形式のパッチ
     */
    async applyPatchToIndex(patch: string, workspaceUri?: vscode.Uri): Promise<boolean> {
        const repo = this.getRepository(workspaceUri);
        if (!repo) {
            console.error('[GitService] No repository found');
            return false;
        }

        // 一時ファイルにパッチを書き出す
        const tempDir = os.tmpdir();
        const tempPatchFile = path.join(tempDir, `vscode-tracer-patch-${Date.now()}.patch`);

        try {
            // パッチを一時ファイルに書き出し
            await fs.promises.writeFile(tempPatchFile, patch, 'utf-8');
            console.log('[GitService] Patch file written to:', tempPatchFile);
            console.log('[GitService] Patch content:\n', patch);

            // git apply --cached を直接実行
            const repoPath = repo.rootUri.fsPath;
            console.log('[GitService] Repository path:', repoPath);

            const { stdout, stderr } = await execFileAsync('git', ['apply', '--cached', tempPatchFile], {
                cwd: repoPath
            });

            if (stdout) {console.log('[GitService] stdout:', stdout);}
            if (stderr) {console.log('[GitService] stderr:', stderr);}

            return true;
        } catch (error: unknown) {
            console.error('[GitService] Failed to apply patch:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to apply patch: ${errorMessage}`);
            return false;
        } finally {
            // 一時ファイルを削除
            try {
                await fs.promises.unlink(tempPatchFile);
            } catch {
                // 削除に失敗しても無視
            }
        }
    }

    /**
     * ファイルをステージングエリアに追加
     */
    async stageFiles(paths: string[], workspaceUri?: vscode.Uri): Promise<boolean> {
        const repo = this.getRepository(workspaceUri);
        if (!repo) {
            return false;
        }

        try {
            await repo.add(paths);
            return true;
        } catch (error) {
            console.error('Failed to stage files:', error);
            return false;
        }
    }

    /**
     * コミットを実行
     */
    async commit(message: string, workspaceUri?: vscode.Uri): Promise<boolean> {
        const repo = this.getRepository(workspaceUri);
        if (!repo) {
            return false;
        }

        try {
            await repo.commit(message);
            return true;
        } catch (error) {
            console.error('Failed to commit:', error);
            return false;
        }
    }

    /**
     * 日時を指定してコミットを実行
     * @param message コミットメッセージ
     * @param date コミット日時
     */
    async commitWithDate(message: string, date: Date, workspaceUri?: vscode.Uri): Promise<boolean> {
        const repo = this.getRepository(workspaceUri);
        if (!repo) {
            console.error('[GitService] No repository found');
            return false;
        }

        try {
            const repoPath = repo.rootUri.fsPath;
            const dateString = date.toISOString();

            console.log('[GitService] Committing with date:', dateString);

            // git commit --date オプションを使用
            // GIT_AUTHOR_DATE と GIT_COMMITTER_DATE の両方を設定
            const { stdout, stderr } = await execFileAsync('git', [
                'commit',
                '-m', message,
                '--date', dateString
            ], {
                cwd: repoPath,
                env: {
                    ...process.env,
                    GIT_AUTHOR_DATE: dateString,
                    GIT_COMMITTER_DATE: dateString
                }
            });

            if (stdout) {console.log('[GitService] commit stdout:', stdout);}
            if (stderr) {console.log('[GitService] commit stderr:', stderr);}

            return true;
        } catch (error: unknown) {
            console.error('[GitService] Failed to commit with date:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to commit: ${errorMessage}`);
            return false;
        }
    }

    /**
     * 現在の HEAD コミットハッシュを取得
     */
    getHeadCommit(workspaceUri?: vscode.Uri): string | undefined {
        const repo = this.getRepository(workspaceUri);
        return repo?.state.HEAD?.commit;
    }

    /**
     * HEAD コミットの詳細情報を取得（コミット日時含む）
     */
    async getHeadCommitInfo(workspaceUri?: vscode.Uri): Promise<{ hash: string; commitDate: Date | undefined } | undefined> {
        const repo = this.getRepository(workspaceUri);
        if (!repo) {
            return undefined;
        }

        try {
            const commits = await repo.log({ maxEntries: 1 });
            console.log('[GitService] log result:', commits);
            if (commits.length > 0) {
                const commit = commits[0];
                console.log('[GitService] commit object:', commit);
                console.log('[GitService] commitDate:', commit.commitDate);
                console.log('[GitService] authorDate:', commit.authorDate);
                return {
                    hash: commit.hash,
                    // commitDate がない場合は authorDate を使用
                    commitDate: commit.commitDate || commit.authorDate
                };
            }
        } catch (error) {
            console.error('Failed to get HEAD commit info:', error);
        }
        return undefined;
    }
}

export const gitService = new GitService();
