/**
 * Git Worktree API Bridge
 *
 * Client-side API for git worktree operations.
 * Communicates with Electron main process via openadeAPI.
 */

import type {
    OpenADETaskChangesReadResult,
    OpenADETaskDiffContextLines,
    OpenADETaskDiffReadResult,
    OpenADETaskFilePairReadResult,
    OpenADETaskGitCommitFilesResult,
    OpenADETaskGitFileAtTreeishResult,
    OpenADETaskGitLogResult,
} from "../../../openade-module/src"

// ============================================================================
// Type Definitions
// Product-equivalent git payloads derive from OpenADE DTOs; only bridge params stay local.
// ============================================================================

interface IsGitInstalledResponse {
    installed: boolean
    version?: string
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

export interface CheckGhCliResponse {
    hasGhCli: boolean
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
    status?: "added" | "deleted" | "modified" | "renamed"
}

export interface GitSummaryResponse {
    // Git ref info
    branch: string | null // Current branch name (null if detached HEAD)
    headCommit: string // Short SHA of HEAD commit

    // Remote tracking
    ahead: number | null // Commits ahead of upstream (null if no upstream)

    // Working tree status
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

interface IsBranchMergedParams {
    repoDir: string
    branchName: string
    targetBranch: string
}

interface DeleteBranchParams {
    repoDir: string
    branchName: string
}

interface ListWorkTreesParams {
    repoDir: string
}

export interface WorkTreeInfo {
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

type GetChangedFilesResponse = Pick<OpenADETaskChangesReadResult, "files" | "fromTreeish" | "toTreeish">

interface GetFileAtTreeishParams {
    workDir: string
    treeish: string
    filePath: string
}

type GetFileAtTreeishResponse = Pick<OpenADETaskGitFileAtTreeishResult, "content" | "exists" | "tooLarge">

interface GetFilePairParams {
    workDir: string
    fromTreeish: string
    toTreeish: string
    filePath: string
    oldPath?: string
}

export type GetFilePairResponse = Pick<OpenADETaskFilePairReadResult, "before" | "after" | "tooLarge">

interface GetWorktreeFilePatchParams {
    workDir: string
    fromTreeish: string
    filePath: string
    oldPath?: string
    contextLines: OpenADETaskDiffContextLines
    allowTruncation?: boolean
}

interface GetCommitFilePatchParams {
    workDir: string
    commit: string
    filePath: string
    oldPath?: string
    contextLines: OpenADETaskDiffContextLines
    allowTruncation?: boolean
}

export type GetFilePatchResponse = Pick<OpenADETaskDiffReadResult, "patch" | "truncated" | "heavy" | "stats">

interface GetGitLogParams {
    workDir: string
    ref?: string
    limit?: number
    skip?: number
}

type GetGitLogResponse = Pick<OpenADETaskGitLogResult, "commits" | "hasMore">

interface GetCommitFilesParams {
    workDir: string
    commit: string
}

type GetCommitFilesResponse = Pick<OpenADETaskGitCommitFilesResult, "files">

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
