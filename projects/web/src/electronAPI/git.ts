/**
 * Git Worktree API Bridge
 *
 * Client-side API for git worktree operations.
 * Communicates with Electron main process via openadeAPI.
 */

import type {
    BranchInfo as HostBranchInfo,
    CheckGhCliResponse as HostCheckGhCliResponse,
    CommitWorkTreeParams,
    CommitWorkTreeResponse,
    DeleteBranchParams,
    DeleteWorkTreeParams,
    DeleteWorkTreeResponse,
    GetChangedFilesParams,
    GetChangedFilesResponse,
    GetCommitFilePatchParams,
    GetCommitFilesParams,
    GetCommitFilesResponse,
    GetFileAtTreeishParams,
    GetFileAtTreeishResponse,
    GetFilePairParams,
    GetFilePairResponse as HostGetFilePairResponse,
    GetFilePatchResponse as HostGetFilePatchResponse,
    GetGitLogParams,
    GetGitLogResponse,
    GetMergeBaseParams,
    GetMergeBaseResponse,
    GetOrCreateWorkTreeParams,
    GetOrCreateWorkTreeResponse,
    GetWorktreeFilePatchParams,
    GitFileInfo as HostGitFileInfo,
    GitStatusParams as HostGitStatusParams,
    GitStatusResponse as HostGitStatusResponse,
    GitSummaryResponse as HostGitSummaryResponse,
    InitGitParams as HostInitGitParams,
    InitGitResponse as HostInitGitResponse,
    IsBranchMergedParams,
    IsGitDirectoryParams as HostIsGitDirectoryParams,
    IsGitDirectoryResponse as HostIsGitDirectoryResponse,
    IsGitInstalledResponse,
    ListBranchesParams,
    ListBranchesResponse,
    ListFilesParams,
    ListFilesResponse,
    ListWorkTreesParams,
    ListWorkTreesResponse,
    ResolvePathParams as HostResolvePathParams,
    ResolvePathResponse as HostResolvePathResponse,
    UncommittedChangesStats as HostUncommittedChangesStats,
    WorkTreeDiffPatchParams,
    WorkTreeDiffPatchResponse,
    WorkTreeInfo as HostWorkTreeInfo,
} from "../../../electron/src/modules/code/gitBridgeTypes"

// ============================================================================
// Type Definitions
// ============================================================================

export type IsGitDirectoryParams = HostIsGitDirectoryParams
export type IsGitDirectoryResponse = HostIsGitDirectoryResponse
export type CheckGhCliResponse = HostCheckGhCliResponse
export type GitStatusParams = HostGitStatusParams
export type GitFileInfo = HostGitFileInfo
export type GitSummaryResponse = HostGitSummaryResponse
export type GitStatusResponse = HostGitStatusResponse
export type UncommittedChangesStats = HostUncommittedChangesStats
export type WorkTreeInfo = HostWorkTreeInfo
export type BranchInfo = HostBranchInfo
export type ResolvePathParams = HostResolvePathParams
export type ResolvePathResponse = HostResolvePathResponse
export type InitGitParams = HostInitGitParams
export type InitGitResponse = HostInitGitResponse
export type GetFilePairResponse = HostGetFilePairResponse
export type GetFilePatchResponse = HostGetFilePatchResponse

// ============================================================================
// API Check
// ============================================================================

import { isCodeModuleAvailable } from "./capabilities"
import { localRuntimeClient } from "../runtime/localRuntimeClient"

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

    return localRuntimeClient.request<IsGitInstalledResponse>("git/installed/read")
}

/**
 * Check if a directory is within a git repository and get repo info
 */
export async function isGitDirectory(params: IsGitDirectoryParams): Promise<IsGitDirectoryResponse> {
    if (!window.openadeAPI) {
        console.warn("[GitAPI] Not running in Electron")
        return { isGitDirectory: false, error: "Not running in Electron" }
    }

    return localRuntimeClient.request<IsGitDirectoryResponse>("git/directory/read", params)
}

/**
 * Check if gh CLI is installed and authenticated (lightweight, no caching)
 */
export async function checkGhCli(): Promise<CheckGhCliResponse> {
    if (!window.openadeAPI) {
        console.warn("[GitAPI] Not running in Electron")
        return { hasGhCli: false }
    }

    return localRuntimeClient.request<CheckGhCliResponse>("git/gh/read")
}

/**
 * Get or create a worktree for the given repository
 */
async function getOrCreateWorkTree(params: GetOrCreateWorkTreeParams): Promise<GetOrCreateWorkTreeResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<GetOrCreateWorkTreeResponse>("git/worktree/getOrCreate", params)
}

/**
 * Generate a diff patch for a worktree compared to a specific commit
 * Diffs against the working tree (includes uncommitted changes)
 */
async function workTreeDiffPatch(params: WorkTreeDiffPatchParams): Promise<WorkTreeDiffPatchResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<WorkTreeDiffPatchResponse>("git/worktree/diffPatch", params)
}

/**
 * Get the merge-base commit between the worktree's HEAD and a target branch
 */
async function getMergeBase(params: GetMergeBaseParams): Promise<GetMergeBaseResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<GetMergeBaseResponse>("git/mergeBase/read", params)
}

/**
 * Get git status including current branch, HEAD commit, and working tree changes
 */
export async function getGitStatus(params: GitStatusParams): Promise<GitStatusResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<GitStatusResponse>("git/status/read", params)
}

/**
 * Get lightweight git summary for branch/head/status/file lists without patch payloads
 */
export async function getGitSummary(params: GitStatusParams): Promise<GitSummaryResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<GitSummaryResponse>("git/summary/read", params)
}

/**
 * List files in a repository or worktree with optional fuzzy search
 */
async function listFiles(params: ListFilesParams): Promise<ListFilesResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<ListFilesResponse>("git/file/list", params)
}

/**
 * Delete a worktree
 */
async function deleteWorkTree(params: DeleteWorkTreeParams): Promise<DeleteWorkTreeResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<DeleteWorkTreeResponse>("git/worktree/delete", params)
}

async function isBranchMerged(params: IsBranchMergedParams): Promise<boolean> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<boolean>("git/branch/merged/read", params)
}

async function deleteBranch(params: DeleteBranchParams): Promise<void> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    await localRuntimeClient.request<void>("git/branch/delete", params)
}

/**
 * List all worktrees for a repository
 */
async function listWorkTrees(params: ListWorkTreesParams): Promise<ListWorkTreesResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<ListWorkTreesResponse>("git/worktree/list", params)
}

/**
 * Commit changes in a worktree
 */
async function commitWorkTree(params: CommitWorkTreeParams): Promise<CommitWorkTreeResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<CommitWorkTreeResponse>("git/worktree/commit", params)
}

/**
 * List branches in a repository
 */
async function listBranches(params: ListBranchesParams): Promise<ListBranchesResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<ListBranchesResponse>("git/branch/list", params)
}

/**
 * Resolve a path, expanding ~ and environment variables
 */
export async function resolvePath(params: ResolvePathParams): Promise<ResolvePathResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<ResolvePathResponse>("git/path/resolve", params)
}

/**
 * Initialize a git repository with a default .gitignore
 */
export async function initGit(params: InitGitParams): Promise<InitGitResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<InitGitResponse>("git/repo/init", params)
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

    return localRuntimeClient.request<GetChangedFilesResponse>("git/changedFiles/read", params)
}

/**
 * Get file content at a specific treeish
 */
async function getFileAtTreeish(params: GetFileAtTreeishParams): Promise<GetFileAtTreeishResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<GetFileAtTreeishResponse>("git/fileAtTreeish/read", params)
}

/**
 * Get both before and after content for a file between two treeishes
 */
async function getFilePair(params: GetFilePairParams): Promise<GetFilePairResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<GetFilePairResponse>("git/filePair/read", params)
}

async function getWorktreeFilePatch(params: GetWorktreeFilePatchParams): Promise<GetFilePatchResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<GetFilePatchResponse>("git/worktree/filePatch/read", params)
}

async function getCommitFilePatch(params: GetCommitFilePatchParams): Promise<GetFilePatchResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<GetFilePatchResponse>("git/commit/filePatch/read", params)
}

async function getLog(params: GetGitLogParams): Promise<GetGitLogResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<GetGitLogResponse>("git/log/read", params)
}

async function getCommitFiles(params: GetCommitFilesParams): Promise<GetCommitFilesResponse> {
    if (!window.openadeAPI) {
        throw new Error("Not running in Electron")
    }

    return localRuntimeClient.request<GetCommitFilesResponse>("git/commit/files/read", params)
}

/**
 * Git API namespace for convenient imports
 */
export const gitApi = {
    isGitInstalled,
    isGitDirectory,
    checkGhCli,
    getOrCreateWorkTree,
    workTreeDiffPatch,
    getMergeBase,
    getGitSummary,
    getGitStatus,
    listFiles,
    deleteWorkTree,
    isBranchMerged,
    deleteBranch,
    listWorkTrees,
    commitWorkTree,
    listBranches,
    resolvePath,
    initGit,
    getLog,
    getCommitFiles,
    getChangedFiles,
    getFileAtTreeish,
    getFilePair,
    getWorktreeFilePatch,
    getCommitFilePatch,
    isAvailable: isGitApiAvailable,
}
