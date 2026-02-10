/**
 * Git Worktree API Bridge
 *
 * Client-side API for git worktree operations.
 * Communicates with Electron main process via openadeAPI.
 */

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/electron/src/modules/code/git.ts
// ============================================================================

interface IsGitInstalledResponse {
    installed: boolean
    version?: string
}

interface IsGitDirParams {
    repoDir: string
}

interface IsGitDirResponse {
    isGitRepo: boolean
    mainBranch?: string
    error?: string
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

interface GetOrCreateWorkTreeParams {
    repoDir: string
    id: string
    sourceTreeish?: string
}

interface GetOrCreateWorkTreeResponse {
    worktreeDir: string
    matchingDir: string
    created: boolean
}

interface WorkTreeDiffPatchParams {
    repoDir: string
    workTreeId: string
    compareToCommit: string // Commit SHA to diff against (e.g., merge-base)
}

interface WorkTreeDiffPatchResponse {
    patch: string
}

interface GetMergeBaseParams {
    repoDir: string
    workTreeId: string
    targetBranch: string // Branch to find merge-base with (e.g., "main")
}

interface GetMergeBaseResponse {
    mergeBaseCommit: string
}

export interface GitStatusParams {
    repoDir: string
    workTreeId?: string // Optional - if not provided, checks the main repo directly
}

export interface UncommittedChangesStats {
    filesChanged: number
    insertions: number
    deletions: number
}

/** File info returned from git status with binary detection */
export interface GitFileInfo {
    path: string
    binary: boolean
}

export interface GitStatusResponse {
    // Git ref info
    branch: string | null // Current branch name (null if detached HEAD)
    headCommit: string // Short SHA of HEAD commit

    // Remote tracking
    ahead: number | null // Commits ahead of upstream (null if no upstream)

    // Working tree status
    hasChanges: boolean
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
    untracked: GitFileInfo[]
}

interface ListFilesParams {
    repoDir: string
    workTreeId?: string
    query?: string
    limit?: number
}

interface ListFilesResponse {
    files: string[]
    truncated: boolean
}

interface DeleteWorkTreeParams {
    repoDir: string
    id: string
}

interface DeleteWorkTreeResponse {
    deleted: boolean
    error?: string
}

interface ListWorkTreesParams {
    repoDir: string
}

interface WorkTreeInfo {
    id: string
    path: string
    branch: string
    head: string
}

interface ListWorkTreesResponse {
    worktrees: WorkTreeInfo[]
}

interface CommitWorkTreeParams {
    repoDir: string
    workTreeId: string
    message: string
}

interface CommitWorkTreeResponse {
    committed: boolean
    sha?: string
    error?: string
}

interface ListBranchesParams {
    repoDir: string
    includeRemote?: boolean
}

export interface BranchInfo {
    name: string
    isDefault: boolean
    isRemote: boolean
}

interface ListBranchesResponse {
    branches: BranchInfo[]
    defaultBranch: string
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

interface GetChangedFilesParams {
    workDir: string
    fromTreeish: string
    toTreeish: string
}

export interface ChangedFileInfo {
    path: string
    status: "added" | "deleted" | "modified" | "renamed"
    oldPath?: string
    binary?: boolean
}

interface GetChangedFilesResponse {
    files: ChangedFileInfo[]
    fromTreeish: string
    toTreeish: string
}

interface GetFileAtTreeishParams {
    workDir: string
    treeish: string
    filePath: string
}

interface GetFileAtTreeishResponse {
    content: string
    exists: boolean
    tooLarge?: boolean
}

interface GetFilePairParams {
    workDir: string
    fromTreeish: string
    toTreeish: string
    filePath: string
    oldPath?: string
}

export interface GetFilePairResponse {
    before: string
    after: string
    tooLarge?: boolean
}

// ============================================================================
// API Check
// ============================================================================

import { isCodeModuleAvailable } from "./capabilities"

// ============================================================================
// Git API Functions
// ============================================================================

/**
 * Check if git is installed on the system
 */
async function isGitInstalled(): Promise<IsGitInstalledResponse> {
    if (!window.openadeAPI) {
        console.warn("[GitAPI] Not running in Electron")
        return { installed: false }
    }

    return (await window.openadeAPI.git.isGitInstalled()) as IsGitInstalledResponse
}

/**
 * Check if a directory is a git repository (legacy - use isGitDirectory instead)
 */
async function isGitDir(params: IsGitDirParams): Promise<IsGitDirResponse> {
    if (!window.openadeAPI) {
        console.warn("[GitAPI] Not running in Electron")
        return { isGitRepo: false, error: "Not running in Electron" }
    }

    return (await window.openadeAPI.git.isGitDir(params)) as IsGitDirResponse
}

/**
 * Check if a directory is within a git repository and get repo info
 * Preferred over isGitDir as it handles subdirectories and returns more info
 */
export async function isGitDirectory(params: IsGitDirectoryParams): Promise<IsGitDirectoryResponse> {
    if (!window.openadeAPI) {
        console.warn("[GitAPI] Not running in Electron")
        return { isGitDirectory: false, error: "Not running in Electron" }
    }

    return (await window.openadeAPI.git.isGitDirectory(params)) as IsGitDirectoryResponse
}

/**
 * Get or create a worktree for the given repository
 */
async function getOrCreateWorkTree(params: GetOrCreateWorkTreeParams): Promise<GetOrCreateWorkTreeResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.git.getOrCreateWorkTree(params)) as GetOrCreateWorkTreeResponse
}

/**
 * Generate a diff patch for a worktree compared to a specific commit
 * Diffs against the working tree (includes uncommitted changes)
 */
async function workTreeDiffPatch(params: WorkTreeDiffPatchParams): Promise<WorkTreeDiffPatchResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.git.workTreeDiffPatch(params)) as WorkTreeDiffPatchResponse
}

/**
 * Get the merge-base commit between the worktree's HEAD and a target branch
 */
async function getMergeBase(params: GetMergeBaseParams): Promise<GetMergeBaseResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.git.getMergeBase(params)) as GetMergeBaseResponse
}

/**
 * Get git status including current branch, HEAD commit, and working tree changes
 */
export async function getGitStatus(params: GitStatusParams): Promise<GitStatusResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.git.getGitStatus(params)) as GitStatusResponse
}

/**
 * List files in a repository or worktree with optional fuzzy search
 */
async function listFiles(params: ListFilesParams): Promise<ListFilesResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.git.listFiles(params)) as ListFilesResponse
}

/**
 * Delete a worktree
 */
async function deleteWorkTree(params: DeleteWorkTreeParams): Promise<DeleteWorkTreeResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.git.deleteWorkTree(params)) as DeleteWorkTreeResponse
}

/**
 * List all worktrees for a repository
 */
async function listWorkTrees(params: ListWorkTreesParams): Promise<ListWorkTreesResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.git.listWorkTrees(params)) as ListWorkTreesResponse
}

/**
 * Commit changes in a worktree
 */
async function commitWorkTree(params: CommitWorkTreeParams): Promise<CommitWorkTreeResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.git.commitWorkTree(params)) as CommitWorkTreeResponse
}

/**
 * List branches in a repository
 */
async function listBranches(params: ListBranchesParams): Promise<ListBranchesResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.git.listBranches(params)) as ListBranchesResponse
}

/**
 * Resolve a path, expanding ~ and environment variables
 */
export async function resolvePath(params: ResolvePathParams): Promise<ResolvePathResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.git.resolvePath(params)) as ResolvePathResponse
}

/**
 * Initialize a git repository with a default .gitignore
 */
export async function initGit(params: InitGitParams): Promise<InitGitResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.git.initGit(params)) as InitGitResponse
}

/**
 * Check if Git API is available (running in Electron)
 */
export function isGitApiAvailable(): boolean {
    return isCodeModuleAvailable()
}

/**
 * Get list of files changed between two treeishes
 */
async function getChangedFiles(params: GetChangedFilesParams): Promise<GetChangedFilesResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.git.getChangedFiles(params)) as GetChangedFilesResponse
}

/**
 * Get file content at a specific treeish
 */
async function getFileAtTreeish(params: GetFileAtTreeishParams): Promise<GetFileAtTreeishResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.git.getFileAtTreeish(params)) as GetFileAtTreeishResponse
}

/**
 * Get both before and after content for a file between two treeishes
 */
async function getFilePair(params: GetFilePairParams): Promise<GetFilePairResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return (await window.openadeAPI.git.getFilePair(params)) as GetFilePairResponse
}

/**
 * Git API namespace for convenient imports
 */
export const gitApi = {
    isGitInstalled,
    isGitDir,
    isGitDirectory,
    getOrCreateWorkTree,
    workTreeDiffPatch,
    getMergeBase,
    getGitStatus,
    listFiles,
    deleteWorkTree,
    listWorkTrees,
    commitWorkTree,
    listBranches,
    resolvePath,
    initGit,
    getChangedFiles,
    getFileAtTreeish,
    getFilePair,
    isAvailable: isGitApiAvailable,
}
