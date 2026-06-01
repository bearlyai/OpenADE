import type {
    OpenADETaskChangesReadResult,
    OpenADETaskDiffContextLines,
    OpenADETaskDiffReadResult,
    OpenADETaskFilePairReadResult,
    OpenADETaskGitCommitFilesResult,
    OpenADETaskGitFileAtTreeishResult,
    OpenADETaskGitLogResult,
} from "../../../../openade-module/src"

export interface IsGitInstalledResponse {
    installed: boolean
    version?: string
}

export interface GetOrCreateWorkTreeParams {
    repoDir: string
    id: string
    sourceTreeish?: string
}

export interface GetOrCreateWorkTreeResponse {
    worktreeDir: string
    matchingDir: string
    created: boolean
}

export interface WorkTreeDiffPatchParams {
    repoDir: string
    workTreeId: string
    compareToCommit: string
}

export interface WorkTreeDiffPatchResponse {
    patch: string
}

export interface GetMergeBaseParams {
    repoDir: string
    workTreeId: string
    targetBranch: string
}

export interface GetMergeBaseResponse {
    mergeBaseCommit: string
}

export interface GitStatusParams {
    repoDir: string
    workTreeId?: string
}

export interface UncommittedChangesStats {
    filesChanged: number
    insertions: number
    deletions: number
}

export interface GitFileInfo {
    path: string
    binary: boolean
    status?: "added" | "deleted" | "modified" | "renamed"
}

export interface GitSummaryResponse {
    branch: string | null
    headCommit: string
    ahead: number | null
    hasChanges: boolean
    staged: {
        files: GitFileInfo[]
        stats: UncommittedChangesStats
    }
    unstaged: {
        files: GitFileInfo[]
        stats: UncommittedChangesStats
    }
    untracked: GitFileInfo[]
}

export interface GitStatusResponse extends GitSummaryResponse {
    staged: {
        files: GitFileInfo[]
        patch: string
        stats: UncommittedChangesStats
    }
    unstaged: {
        files: GitFileInfo[]
        patch: string
        stats: UncommittedChangesStats
    }
}

export interface ListFilesParams {
    repoDir: string
    workTreeId?: string
    query?: string
    limit?: number
}

export interface ListFilesResponse {
    files: string[]
    truncated: boolean
}

export interface DeleteWorkTreeParams {
    repoDir: string
    id: string
}

export interface DeleteWorkTreeResponse {
    deleted: boolean
    error?: string
}

export interface IsBranchMergedParams {
    repoDir: string
    branchName: string
    targetBranch: string
}

export interface DeleteBranchParams {
    repoDir: string
    branchName: string
}

export interface ListWorkTreesParams {
    repoDir: string
}

export interface WorkTreeInfo {
    id: string
    path: string
    branch: string
    head: string
}

export interface ListWorkTreesResponse {
    worktrees: WorkTreeInfo[]
}

export interface CommitWorkTreeParams {
    repoDir: string
    workTreeId: string
    message: string
}

export interface CommitWorkTreeResponse {
    committed: boolean
    sha?: string
    error?: string
}

export type CommitWorkingTreeStatus = "committed" | "nothing_to_commit" | "failed"

export interface CommitWorkingTreeParams {
    workDir: string
    message: string
}

export interface CommitWorkingTreeResponse {
    committed: boolean
    status: CommitWorkingTreeStatus
    sha?: string
    error?: string
}

export interface ListBranchesParams {
    repoDir: string
    includeRemote?: boolean
}

export interface BranchInfo {
    name: string
    isDefault: boolean
    isRemote: boolean
}

export interface ListBranchesResponse {
    branches: BranchInfo[]
    defaultBranch: string
}

export interface CheckGhCliResponse {
    hasGhCli: boolean
}

export interface IsGitDirectoryParams {
    directory: string
}

export type IsGitDirectoryResponse =
    | {
          isGitDirectory: true
          repoRoot: string
          relativePath: string
          mainBranch: string
          hasGhCli: boolean
      }
    | {
          isGitDirectory: false
          error?: string
      }

export interface ResolvePathParams {
    path: string
}

export interface ResolvePathResponse {
    resolvedPath: string
    exists: boolean
    isDirectory: boolean
}

export interface InitGitParams {
    directory: string
}

export interface InitGitResponse {
    success: boolean
    error?: string
}

export interface GetChangedFilesParams {
    workDir: string
    fromTreeish: string
    toTreeish: string
}

export type GetChangedFilesResponse = Pick<OpenADETaskChangesReadResult, "files" | "fromTreeish" | "toTreeish">

export interface GetFileAtTreeishParams {
    workDir: string
    treeish: string
    filePath: string
}

export type GetFileAtTreeishResponse = Pick<OpenADETaskGitFileAtTreeishResult, "content" | "exists" | "tooLarge">

export interface GetFilePairParams {
    workDir: string
    fromTreeish: string
    toTreeish: string
    filePath: string
    oldPath?: string
}

export type GetFilePairResponse = Pick<OpenADETaskFilePairReadResult, "before" | "after" | "tooLarge">

export interface GetWorktreeFilePatchParams {
    workDir: string
    fromTreeish: string
    filePath: string
    oldPath?: string
    contextLines: OpenADETaskDiffContextLines
    allowTruncation?: boolean
}

export interface GetCommitFilePatchParams {
    workDir: string
    commit: string
    filePath: string
    oldPath?: string
    contextLines: OpenADETaskDiffContextLines
    allowTruncation?: boolean
}

export type GetFilePatchResponse = Pick<OpenADETaskDiffReadResult, "patch" | "truncated" | "heavy" | "stats">

export interface GetGitLogParams {
    workDir: string
    ref?: string
    limit?: number
    skip?: number
}

export type GetGitLogResponse = Pick<OpenADETaskGitLogResult, "commits" | "hasMore">

export interface GetCommitFilesParams {
    workDir: string
    commit: string
}

export type GetCommitFilesResponse = Pick<OpenADETaskGitCommitFilesResult, "files">
