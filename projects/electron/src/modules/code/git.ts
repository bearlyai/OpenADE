/**
 * Git Worktree Utilities Module for Electron
 *
 * Provides blazing-fast git operations via IPC to the dashboard frontend.
 * Implements worktree management, diff generation, file listing with fuzzy search, and basic git commands.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"
import * as fsExtra from "fs-extra"
import logger from "electron-log"
import fuzzysort from "fuzzysort"
import { isDev } from "../../config"
import { execCommand } from "./subprocess"

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/dashboard/src/pages/code/electronAPI/git.ts
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

interface GitStatusParams {
    repoDir: string
    workTreeId?: string // Optional - if not provided, checks the main repo directly
}

/** File info returned from git status with binary detection */
interface GitFileInfo {
    path: string
    binary: boolean
}

interface GitStatusResponse {
    // Git ref info
    branch: string | null // Current branch name (null if detached HEAD)
    headCommit: string // Short SHA of HEAD commit

    // Working tree status
    hasChanges: boolean
    staged: {
        files: GitFileInfo[]
        patch: string
        stats: { filesChanged: number; insertions: number; deletions: number }
    }
    unstaged: {
        files: GitFileInfo[]
        patch: string
        stats: { filesChanged: number; insertions: number; deletions: number }
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

interface BranchInfo {
    name: string
    isDefault: boolean
    isRemote: boolean
}

interface ListBranchesResponse {
    branches: BranchInfo[]
    defaultBranch: string
}

interface IsGitDirectoryParams {
    directory: string
}

type IsGitDirectoryResponse =
    | {
          isGitDirectory: true
          repoRoot: string
          relativePath: string
          mainBranch: string
      }
    | {
          isGitDirectory: false
          error?: string
      }

interface ResolvePathParams {
    path: string
}

interface ResolvePathResponse {
    resolvedPath: string
    exists: boolean
    isDirectory: boolean
}

interface InitGitParams {
    directory: string
}

interface InitGitResponse {
    success: boolean
    error?: string
}

interface GetChangedFilesParams {
    workDir: string
    fromTreeish: string
    toTreeish: string
}

interface ChangedFileInfo {
    path: string
    status: "added" | "deleted" | "modified" | "renamed"
    oldPath?: string // For renamed files
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
    oldPath?: string // For renamed files
}

interface GetFilePairResponse {
    before: string
    after: string
    tooLarge?: boolean
}

// ============================================================================
// Helper Functions
// ============================================================================

// Cache for git installation check
let gitInstalledCache: { installed: boolean; version?: string } | null = null

/**
 * Get the base directory for worktrees (cross-platform)
 */
function getWorktreeBaseDir(): string {
    return path.join(os.homedir(), ".openade", "workspaces", "worktrees")
}

/**
 * Get worktree path from ID
 */
function getWorktreePath(id: string): string {
    return path.join(getWorktreeBaseDir(), id)
}

/**
 * Validate repository directory
 */
function validateRepoDir(dir: string): void {
    if (!dir || typeof dir !== "string") {
        throw new Error("repoDir must be a non-empty string")
    }
    if (!fs.existsSync(dir)) {
        throw new Error(`Repository directory does not exist: ${dir}`)
    }
    if (!fs.statSync(dir).isDirectory()) {
        throw new Error(`Path is not a directory: ${dir}`)
    }
}

/**
 * Validate worktree ID (prevent path traversal)
 */
function validateWorkTreeId(id: string): void {
    if (!id || typeof id !== "string") {
        throw new Error("workTreeId must be a non-empty string")
    }
    if (id.includes("..") || id.includes("/") || id.includes("\\")) {
        throw new Error("workTreeId cannot contain path traversal characters")
    }
}

/**
 * Resolve git repository root and relative path from any directory within a repo
 */
async function resolveGitInfo(directory: string): Promise<{ repoRoot: string; relativePath: string }> {
    const startTime = Date.now()

    // Validate directory exists
    if (!fs.existsSync(directory)) {
        throw new Error(`Directory does not exist: ${directory}`)
    }

    // Get repository root
    const rootResult = await execGit(["rev-parse", "--show-toplevel"], directory)
    if (!rootResult.success) {
        throw new Error(`Not a git repository: ${directory}`)
    }
    const repoRoot = rootResult.stdout.trim()

    // Get relative path from root (empty string if at root)
    const prefixResult = await execGit(["rev-parse", "--show-prefix"], directory)
    let relativePath = ""
    if (prefixResult.success && prefixResult.stdout.trim()) {
        // Remove trailing slash if present
        relativePath = prefixResult.stdout.trim().replace(/\/$/, "")
    }

    logger.info(`[Git:resolveGitInfo] Resolved: ${directory} -> root=${repoRoot}, relative=${relativePath || "(root)"}`, JSON.stringify({
        duration: Date.now() - startTime,
    }))

    return { repoRoot, relativePath }
}

/**
 * Execute git command with error handling
 * Uses centralized subprocess runner to respect user-configured env vars (e.g., custom PATH)
 */
async function execGit(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; success: boolean }> {
    return execCommand("git", args, { cwd, maxBuffer: 50 * 1024 * 1024 })
}

/**
 * Parse git worktree list --porcelain output
 */
function parseWorktreeList(output: string): WorkTreeInfo[] {
    const worktrees: WorkTreeInfo[] = []
    const lines = output.split("\n")
    let currentWorktree: Partial<WorkTreeInfo> = {}

    for (const line of lines) {
        if (line.startsWith("worktree ")) {
            const worktreePath = line.substring(9).trim()
            currentWorktree.path = worktreePath
            // Extract ID from path
            const baseDir = getWorktreeBaseDir()
            if (worktreePath.startsWith(baseDir)) {
                currentWorktree.id = path.basename(worktreePath)
            }
        } else if (line.startsWith("HEAD ")) {
            currentWorktree.head = line.substring(5).trim()
        } else if (line.startsWith("branch ")) {
            currentWorktree.branch = line.substring(7).trim()
        } else if (line === "" && currentWorktree.path) {
            // Empty line marks end of worktree entry
            if (currentWorktree.id && currentWorktree.path && currentWorktree.head) {
                worktrees.push({
                    id: currentWorktree.id,
                    path: currentWorktree.path,
                    branch: currentWorktree.branch || "",
                    head: currentWorktree.head,
                })
            }
            currentWorktree = {}
        }
    }

    // Handle last entry if no trailing newline
    if (currentWorktree.id && currentWorktree.path && currentWorktree.head) {
        worktrees.push({
            id: currentWorktree.id,
            path: currentWorktree.path,
            branch: currentWorktree.branch || "",
            head: currentWorktree.head,
        })
    }

    return worktrees
}

/**
 * Check if caller is allowed
 */
function checkAllowed(e: IpcMainInvokeEvent): boolean {
    const origin = e.sender.getURL()
    try {
        const url = new URL(origin)
        if (isDev) {
            return url.hostname.endsWith("localhost")
        } else {
            return url.hostname.endsWith("localhost") || url.protocol === "file:"
        }
    } catch (error) {
        logger.error("[Git:checkAllowed] Failed to parse origin:", error)
        return false
    }
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Check if git is installed
 */
async function handleIsGitInstalled(): Promise<IsGitInstalledResponse> {
    const startTime = Date.now()
    logger.info("[Git:isGitInstalled] Checking git installation")

    // Return cached result if available
    if (gitInstalledCache) {
        logger.info("[Git:isGitInstalled] Returning cached result", JSON.stringify({ duration: Date.now() - startTime }))
        return gitInstalledCache
    }

    const result = await execCommand("git", ["--version"], { timeout: 2000 })
    if (result.success) {
        const version = result.stdout.trim()
        gitInstalledCache = { installed: true, version }
        logger.info("[Git:isGitInstalled] Git is installed", JSON.stringify({ version, duration: Date.now() - startTime }))
        return gitInstalledCache
    }

    gitInstalledCache = { installed: false }
    logger.warn("[Git:isGitInstalled] Git is not installed", JSON.stringify({ error: result.stderr, duration: Date.now() - startTime }))
    return gitInstalledCache
}

/**
 * Check if directory is within a git repository and return repo info
 */
async function handleIsGitDirectory(params: IsGitDirectoryParams): Promise<IsGitDirectoryResponse> {
    const startTime = Date.now()
    logger.info("[Git:isGitDirectory] Checking directory", JSON.stringify({ directory: params.directory }))

    try {
        // Resolve git info (repo root and relative path)
        const { repoRoot, relativePath } = await resolveGitInfo(params.directory)

        // Detect main branch using the repo root
        let mainBranch = "main"

        // Try to get from remote HEAD
        const remoteHeadResult = await execGit(["symbolic-ref", "refs/remotes/origin/HEAD"], repoRoot)
        if (remoteHeadResult.success) {
            const refName = remoteHeadResult.stdout.trim()
            mainBranch = refName.replace("refs/remotes/origin/", "")
        } else {
            // Check if main exists
            const mainExistsResult = await execGit(["show-ref", "--verify", "refs/heads/main"], repoRoot)
            if (mainExistsResult.success) {
                mainBranch = "main"
            } else {
                // Check if master exists
                const masterExistsResult = await execGit(["show-ref", "--verify", "refs/heads/master"], repoRoot)
                if (masterExistsResult.success) {
                    mainBranch = "master"
                }
            }
        }

        logger.info("[Git:isGitDirectory] Git directory found", JSON.stringify({
            directory: params.directory,
            repoRoot,
            relativePath: relativePath || "(root)",
            mainBranch,
            duration: Date.now() - startTime,
        }))

        return {
            isGitDirectory: true,
            repoRoot,
            relativePath,
            mainBranch,
        }
    } catch (error: any) {
        logger.info("[Git:isGitDirectory] Not a git directory", JSON.stringify({
            directory: params.directory,
            error: error.message,
            duration: Date.now() - startTime,
        }))
        return {
            isGitDirectory: false,
            error: error.message,
        }
    }
}

/**
 * Check if directory is a git repository and detect main branch
 * (Legacy handler - supports subdirectories via resolveGitInfo)
 */
async function handleIsGitDir(params: IsGitDirParams): Promise<IsGitDirResponse> {
    const startTime = Date.now()
    logger.info("[Git:isGitDir] Checking if directory is a git repo", JSON.stringify({ repoDir: params.repoDir }))

    try {
        validateRepoDir(params.repoDir)

        // Use resolveGitInfo to handle subdirectories
        const { repoRoot } = await resolveGitInfo(params.repoDir)

        // Detect main branch using repo root
        let mainBranch = "main"

        // Try to get from remote HEAD
        const remoteHeadResult = await execGit(["symbolic-ref", "refs/remotes/origin/HEAD"], repoRoot)
        if (remoteHeadResult.success) {
            const refName = remoteHeadResult.stdout.trim()
            mainBranch = refName.replace("refs/remotes/origin/", "")
            logger.info("[Git:isGitDir] Detected main branch from remote HEAD", JSON.stringify({ mainBranch, repoDir: params.repoDir, duration: Date.now() - startTime }))
            return { isGitRepo: true, mainBranch }
        }

        // Check if main exists
        const mainExistsResult = await execGit(["show-ref", "--verify", "refs/heads/main"], repoRoot)
        if (mainExistsResult.success) {
            logger.info("[Git:isGitDir] Found main branch", JSON.stringify({ repoDir: params.repoDir, duration: Date.now() - startTime }))
            return { isGitRepo: true, mainBranch: "main" }
        }

        // Check if master exists
        const masterExistsResult = await execGit(["show-ref", "--verify", "refs/heads/master"], repoRoot)
        if (masterExistsResult.success) {
            logger.info("[Git:isGitDir] Found master branch", JSON.stringify({ repoDir: params.repoDir, duration: Date.now() - startTime }))
            return { isGitRepo: true, mainBranch: "master" }
        }

        // Default to main
        logger.info("[Git:isGitDir] No main/master found, defaulting to main", JSON.stringify({ repoDir: params.repoDir, duration: Date.now() - startTime }))
        return { isGitRepo: true, mainBranch: "main" }
    } catch (error: any) {
        logger.info("[Git:isGitDir] Not a git repository", JSON.stringify({ repoDir: params.repoDir, error: error.message, duration: Date.now() - startTime }))
        return { isGitRepo: false, error: error.message }
    }
}

/**
 * Get or create a worktree
 */
async function handleGetOrCreateWorkTree(params: GetOrCreateWorkTreeParams): Promise<GetOrCreateWorkTreeResponse> {
    const startTime = Date.now()
    logger.info("[Git:getOrCreateWorkTree] Processing worktree request", JSON.stringify({
        repoDir: params.repoDir,
        id: params.id,
        sourceTreeish: params.sourceTreeish,
    }))

    try {
        validateRepoDir(params.repoDir)
        validateWorkTreeId(params.id)

        // Resolve git info (handles subdirectories)
        const { repoRoot, relativePath } = await resolveGitInfo(params.repoDir)
        logger.info("[Git:getOrCreateWorkTree] Resolved subdirectory", JSON.stringify({
            input: params.repoDir,
            repoRoot,
            relativePath: relativePath || "(root)",
        }))

        const worktreePath = getWorktreePath(params.id)
        const baseDir = getWorktreeBaseDir()

        // Calculate matching directory (worktree root + relative path)
        const matchingDir = relativePath ? path.join(worktreePath, relativePath) : worktreePath
        logger.info("[Git:getOrCreateWorkTree] Matching directory", JSON.stringify({ matchingDir }))

        // Ensure base directory exists
        await fsExtra.ensureDir(baseDir)
        logger.info("[Git:getOrCreateWorkTree] Base directory ensured", JSON.stringify({ baseDir }))

        // Check if worktree already exists
        const expectedBranchName = `refs/heads/openade/${params.id}`
        const listResult = await execGit(["worktree", "list", "--porcelain"], repoRoot)
        if (listResult.success) {
            const existingWorktrees = parseWorktreeList(listResult.stdout)
            const existing = existingWorktrees.find((wt) => wt.path === worktreePath)
            if (existing) {
                // Check if the worktree is on the correct branch
                if (existing.branch === expectedBranchName) {
                    logger.info("[Git:getOrCreateWorkTree] Worktree already exists on correct branch", JSON.stringify({
                        worktreePath,
                        matchingDir,
                        branch: existing.branch,
                        duration: Date.now() - startTime
                    }))
                    return { worktreeDir: worktreePath, matchingDir, created: false }
                } else {
                    // Worktree exists but on wrong branch - remove and recreate
                    logger.info("[Git:getOrCreateWorkTree] Worktree exists on wrong branch, removing", JSON.stringify({
                        worktreePath,
                        existingBranch: existing.branch,
                        expectedBranch: expectedBranchName
                    }))
                    await execGit(["worktree", "remove", worktreePath, "--force"], repoRoot)
                    // Also try to remove directory manually
                    try {
                        await fsExtra.remove(worktreePath)
                    } catch (e) {
                        logger.warn("[Git:getOrCreateWorkTree] Failed to remove worktree directory", JSON.stringify({ error: e }))
                    }
                }
            }
        }

        // Create worktree from repo root with a new branch
        // Use params.id (task slug) as the new branch name, branching from sourceTreeish
        // Prefix with "openade/" to namespace our branches
        const sourceTreeish = params.sourceTreeish || "HEAD"
        const newBranchName = `openade/${params.id}`
        logger.info("[Git:getOrCreateWorkTree] Creating new worktree with new branch", JSON.stringify({
            worktreePath,
            newBranchName,
            sourceTreeish
        }))

        // git worktree add -b <new-branch> <path> <source-branch>
        // This creates a new branch named <new-branch> from <source-branch> at <path>
        let addResult = await execGit(["worktree", "add", "-b", newBranchName, worktreePath, sourceTreeish], repoRoot)

        // If branch already exists, checkout the existing branch instead of creating new one
        // This is safe because:
        // 1. Slugs have 6 random chars (e.g., "add-login-a1b2c3"), making collisions extremely rare
        // 2. If collision happens, it's likely the user's previous work that should be preserved
        // 3. We never silently destroy existing branches with -B (force reset)
        if (!addResult.success && addResult.stderr.includes("already exists")) {
            logger.info("[Git:getOrCreateWorkTree] Branch exists, checking out existing branch instead", JSON.stringify({
                newBranchName,
                note: "Preserving existing work - NOT force resetting"
            }))
            // Just checkout the existing branch without creating a new one
            addResult = await execGit(["worktree", "add", worktreePath, newBranchName], repoRoot)
        }

        if (!addResult.success) {
            throw new Error(`Failed to create worktree: ${addResult.stderr}`)
        }

        logger.info("[Git:getOrCreateWorkTree] Worktree created successfully", JSON.stringify({ worktreePath }))

        // Ensure matching directory exists (for subdirectories)
        if (relativePath) {
            await fsExtra.ensureDir(matchingDir)
            logger.info("[Git:getOrCreateWorkTree] Ensured matching directory exists", JSON.stringify({ matchingDir }))
        }

        logger.info("[Git:getOrCreateWorkTree] Worktree ready", JSON.stringify({ worktreePath, matchingDir, duration: Date.now() - startTime }))
        return { worktreeDir: worktreePath, matchingDir, created: true }
    } catch (error: any) {
        logger.error("[Git:getOrCreateWorkTree] Error:", JSON.stringify({ error: error.message, stack: error.stack, duration: Date.now() - startTime }))
        throw error
    }
}

/**
 * Generate diff patch for worktree against a specific commit (supports subdirectories)
 * Diffs against the working tree (includes uncommitted changes)
 * Excludes binary files and truncates large patches
 */
async function handleWorkTreeDiffPatch(params: WorkTreeDiffPatchParams): Promise<WorkTreeDiffPatchResponse> {
    const startTime = Date.now()
    logger.info("[Git:workTreeDiffPatch] Generating diff patch", JSON.stringify({
        repoDir: params.repoDir,
        workTreeId: params.workTreeId,
        compareToCommit: params.compareToCommit,
    }))

    try {
        validateRepoDir(params.repoDir)
        validateWorkTreeId(params.workTreeId)

        // Resolve git info (handles subdirectories)
        const { repoRoot } = await resolveGitInfo(params.repoDir)

        const worktreePath = getWorktreePath(params.workTreeId)
        logger.info("[Git:workTreeDiffPatch] Worktree path resolved", JSON.stringify({ worktreePath, exists: fs.existsSync(worktreePath) }))

        // Validate worktree exists
        if (!fs.existsSync(worktreePath)) {
            throw new Error(`Worktree does not exist: ${worktreePath}`)
        }

        // Validate worktree is in git's list using repo root
        const listResult = await execGit(["worktree", "list", "--porcelain"], repoRoot)
        if (listResult.success) {
            const worktrees = parseWorktreeList(listResult.stdout)
            const exists = worktrees.some((wt) => wt.path === worktreePath)
            if (!exists) {
                throw new Error(`Worktree not registered in git: ${worktreePath}`)
            }
        }

        // Verify the commit exists and is accessible
        const verifyResult = await execGit(["cat-file", "-t", params.compareToCommit], worktreePath)
        logger.info("[Git:workTreeDiffPatch] Verified commit", JSON.stringify({
            commit: params.compareToCommit,
            exists: verifyResult.success,
            type: verifyResult.stdout.trim(),
            stderr: verifyResult.stderr,
        }))

        if (!verifyResult.success) {
            throw new Error(`Commit not accessible in worktree: ${params.compareToCommit}`)
        }

        // Generate diff patch against working tree (includes uncommitted changes)
        // Using just "git diff <commit>" diffs the commit against the working tree
        // By default, git diff shows "Binary files differ" for binary files without content
        const diffArgs = ["diff", params.compareToCommit]
        logger.info("[Git:workTreeDiffPatch] Running git diff", JSON.stringify({ args: diffArgs, cwd: worktreePath }))
        const diffResult = await execGit(diffArgs, worktreePath)

        if (!diffResult.success) {
            logger.error("[Git:workTreeDiffPatch] Git diff failed", JSON.stringify({ stderr: diffResult.stderr, args: diffArgs }))
            throw new Error(`Failed to generate diff: ${diffResult.stderr}`)
        }

        // Truncate if too large
        const { patch, truncated } = truncatePatch(diffResult.stdout)

        logger.info("[Git:workTreeDiffPatch] Diff generated", JSON.stringify({
            patchSize: diffResult.stdout.length,
            truncated,
            duration: Date.now() - startTime,
        }))
        return { patch }
    } catch (error: any) {
        logger.error("[Git:workTreeDiffPatch] Error:", JSON.stringify({ error: error.message, stack: error.stack, duration: Date.now() - startTime }))
        throw error
    }
}

/**
 * Get the merge-base commit between the worktree's HEAD and a target branch
 */
async function handleGetMergeBase(params: GetMergeBaseParams): Promise<GetMergeBaseResponse> {
    const startTime = Date.now()
    logger.info("[Git:getMergeBase] Finding merge-base", JSON.stringify({
        repoDir: params.repoDir,
        workTreeId: params.workTreeId,
        targetBranch: params.targetBranch,
    }))

    try {
        validateRepoDir(params.repoDir)
        validateWorkTreeId(params.workTreeId)

        const worktreePath = getWorktreePath(params.workTreeId)

        // Validate worktree exists
        if (!fs.existsSync(worktreePath)) {
            throw new Error(`Worktree does not exist: ${worktreePath}`)
        }

        // Find merge-base between HEAD and target branch
        const mergeBaseResult = await execGit(["merge-base", "HEAD", params.targetBranch], worktreePath)

        if (!mergeBaseResult.success) {
            throw new Error(`Failed to find merge-base: ${mergeBaseResult.stderr}`)
        }

        const mergeBaseCommit = mergeBaseResult.stdout.trim()
        if (!mergeBaseCommit) {
            throw new Error("No merge-base found")
        }

        logger.info("[Git:getMergeBase] Found merge-base", JSON.stringify({ mergeBaseCommit, duration: Date.now() - startTime }))
        return { mergeBaseCommit }
    } catch (error: any) {
        logger.error("[Git:getMergeBase] Error:", JSON.stringify({ error: error.message, stack: error.stack, duration: Date.now() - startTime }))
        throw error
    }
}

/**
 * Parse stats from a unified diff patch
 */
function parsePatchStats(patch: string): { filesChanged: number; insertions: number; deletions: number } {
    const lines = patch.split("\n")
    const files = new Set<string>()
    let insertions = 0
    let deletions = 0

    for (const line of lines) {
        if (line.startsWith("diff --git")) {
            const match = line.match(/diff --git a\/(.+) b\//)
            if (match) files.add(match[1])
        } else if (line.startsWith("+") && !line.startsWith("+++")) {
            insertions++
        } else if (line.startsWith("-") && !line.startsWith("---")) {
            deletions++
        }
    }

    return { filesChanged: files.size, insertions, deletions }
}

// Max patch size to return (1MB) - larger patches are truncated
const MAX_PATCH_SIZE = 1024 * 1024

/**
 * Truncate patch if too large, add warning message
 */
function truncatePatch(patch: string, maxSize: number = MAX_PATCH_SIZE): { patch: string; truncated: boolean } {
    if (patch.length <= maxSize) {
        return { patch, truncated: false }
    }
    const truncatedPatch = patch.slice(0, maxSize) + "\n\n... [PATCH TRUNCATED - too large to display] ..."
    return { patch: truncatedPatch, truncated: true }
}

// Common binary file extensions for fallback detection (when git can't determine)
const BINARY_EXTENSIONS = new Set([
    // Images
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".bmp", ".tiff", ".tif", ".psd", ".ai", ".eps",
    // Fonts
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    // Audio/Video
    ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".flac", ".aac", ".m4a", ".avi", ".mov", ".mkv",
    // Archives
    ".zip", ".tar", ".gz", ".rar", ".7z", ".bz2", ".xz",
    // Documents
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    // Compiled/Binary
    ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
    ".pyc", ".pyo", ".class", ".o", ".a", ".lib", ".obj",
    // Other
    ".sqlite", ".db", ".lock",
])

/**
 * Check if a file is likely binary based on extension
 */
function isBinaryByExtension(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return BINARY_EXTENSIONS.has(ext)
}

/**
 * Parse git diff --numstat output to get file info with binary detection
 * Format: "10\t5\tfile.ts" for text files, "-\t-\tfile.png" for binary files
 */
function parseNumstatOutput(output: string): GitFileInfo[] {
    if (!output.trim()) return []

    return output
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
            // Format: additions<tab>deletions<tab>filepath
            // Binary files show as: -<tab>-<tab>filepath
            const parts = line.split("\t")
            if (parts.length < 3) return null

            const [additions, , ...pathParts] = parts
            const filePath = pathParts.join("\t") // Handle paths with tabs (rare but possible)
            const binary = additions === "-"

            return { path: filePath, binary }
        })
        .filter((f): f is GitFileInfo => f !== null)
}

/**
 * Get git status including current branch, HEAD commit, and working tree changes
 * Excludes binary files from patches and truncates large patches
 */
async function handleGetGitStatus(params: GitStatusParams): Promise<GitStatusResponse> {
    const startTime = Date.now()
    logger.info("[Git:getGitStatus] Getting git status", JSON.stringify({
        repoDir: params.repoDir,
        workTreeId: params.workTreeId,
    }))

    try {
        validateRepoDir(params.repoDir)

        // Determine the working directory - either worktree or main repo
        let workingDir: string
        if (params.workTreeId) {
            validateWorkTreeId(params.workTreeId)
            workingDir = getWorktreePath(params.workTreeId)

            // Validate worktree exists
            if (!fs.existsSync(workingDir)) {
                throw new Error(`Worktree does not exist: ${workingDir}`)
            }
        } else {
            // Use the main repo directly
            workingDir = params.repoDir
        }

        // Get current branch name (returns "HEAD" if detached)
        const branchResult = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], workingDir)
        let branch: string | null = null
        if (branchResult.success) {
            const branchName = branchResult.stdout.trim()
            // "HEAD" means detached HEAD state
            branch = branchName === "HEAD" ? null : branchName
        }

        // Get short HEAD commit SHA
        const headResult = await execGit(["rev-parse", "--short", "HEAD"], workingDir)
        const headCommit = headResult.success ? headResult.stdout.trim() : ""

        // Get staged changes (diff --cached)
        const stagedDiffResult = await execGit(["diff", "--cached"], workingDir)
        const stagedPatchRaw = stagedDiffResult.success ? stagedDiffResult.stdout : ""
        const { patch: stagedPatch, truncated: stagedTruncated } = truncatePatch(stagedPatchRaw)
        const stagedStats = parsePatchStats(stagedPatchRaw) // Stats from full patch

        // Get staged file names with binary detection using --numstat
        const stagedNumstatResult = await execGit(["diff", "--cached", "--numstat"], workingDir)
        const stagedFiles = stagedNumstatResult.success
            ? parseNumstatOutput(stagedNumstatResult.stdout)
            : []

        // Get unstaged changes (diff without --cached)
        const unstagedDiffResult = await execGit(["diff"], workingDir)
        const unstagedPatchRaw = unstagedDiffResult.success ? unstagedDiffResult.stdout : ""
        const { patch: unstagedPatch, truncated: unstagedTruncated } = truncatePatch(unstagedPatchRaw)
        const unstagedStats = parsePatchStats(unstagedPatchRaw) // Stats from full patch

        // Get unstaged file names with binary detection using --numstat
        const unstagedNumstatResult = await execGit(["diff", "--numstat"], workingDir)
        const unstagedFiles = unstagedNumstatResult.success
            ? parseNumstatOutput(unstagedNumstatResult.stdout)
            : []

        // Get untracked files (use extension-based binary detection since they're not in git yet)
        const untrackedResult = await execGit(["ls-files", "--others", "--exclude-standard"], workingDir)
        const untracked: GitFileInfo[] = untrackedResult.success
            ? untrackedResult.stdout
                  .split("\n")
                  .filter((f: string) => f.trim())
                  .map((filePath: string) => ({ path: filePath, binary: isBinaryByExtension(filePath) }))
            : []

        const hasChanges = stagedFiles.length > 0 || unstagedFiles.length > 0 || untracked.length > 0

        logger.info("[Git:getGitStatus] Status retrieved", JSON.stringify({
            branch,
            headCommit,
            hasChanges,
            stagedCount: stagedFiles.length,
            unstagedCount: unstagedFiles.length,
            untrackedCount: untracked.length,
            stagedTruncated,
            unstagedTruncated,
            duration: Date.now() - startTime,
        }))

        return {
            branch,
            headCommit,
            hasChanges,
            staged: {
                files: stagedFiles,
                patch: stagedPatch,
                stats: stagedStats,
            },
            unstaged: {
                files: unstagedFiles,
                patch: unstagedPatch,
                stats: unstagedStats,
            },
            untracked,
        }
    } catch (error: any) {
        logger.error("[Git:getGitStatus] Error:", JSON.stringify({ error: error.message, stack: error.stack, duration: Date.now() - startTime }))
        throw error
    }
}

/**
 * List files with optional fuzzy search (supports subdirectories)
 */
async function handleListFiles(params: ListFilesParams): Promise<ListFilesResponse> {
    const startTime = Date.now()
    logger.info("[Git:listFiles] Listing files", JSON.stringify({
        repoDir: params.repoDir,
        workTreeId: params.workTreeId,
        hasQuery: !!params.query,
        limit: params.limit,
    }))

    try {
        validateRepoDir(params.repoDir)

        let targetDir = params.repoDir
        if (params.workTreeId) {
            validateWorkTreeId(params.workTreeId)
            targetDir = getWorktreePath(params.workTreeId)
            if (!fs.existsSync(targetDir)) {
                throw new Error(`Worktree does not exist: ${targetDir}`)
            }
        }

        // Resolve git info (handles subdirectories)
        const { repoRoot, relativePath } = await resolveGitInfo(targetDir)
        logger.info("[Git:listFiles] Resolved git info", JSON.stringify({ targetDir, repoRoot, relativePath: relativePath || "(root)" }))

        // Get tracked files from repo root
        const lsFilesResult = await execGit(["ls-files"], repoRoot)
        if (!lsFilesResult.success) {
            throw new Error(`Failed to list files: ${lsFilesResult.stderr}`)
        }

        let files = lsFilesResult.stdout
            .split("\n")
            .map((f) => f.trim())
            .filter((f) => f.length > 0)

        // Filter to only files in the subdirectory if not at root
        if (relativePath) {
            const prefix = relativePath + "/"
            files = files.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length))
            logger.info("[Git:listFiles] Filtered to subdirectory", JSON.stringify({ relativePath, count: files.length }))
        }

        logger.info("[Git:listFiles] Files retrieved", JSON.stringify({ count: files.length }))

        // Apply fuzzy search if query provided
        if (params.query && params.query.trim()) {
            const fuzzyResults = fuzzysort.go(params.query, files)
            files = fuzzyResults.map((result) => result.target)
            logger.info("[Git:listFiles] Fuzzy search applied", JSON.stringify({ query: params.query, matchCount: files.length }))
        }

        // Apply limit
        const limit = params.limit || 100
        const maxLimit = 1000
        const actualLimit = Math.min(limit, maxLimit)
        const truncated = files.length > actualLimit
        if (truncated) {
            files = files.slice(0, actualLimit)
        }

        logger.info("[Git:listFiles] Files listed", JSON.stringify({ count: files.length, truncated, duration: Date.now() - startTime }))
        return { files, truncated }
    } catch (error: any) {
        logger.error("[Git:listFiles] Error:", JSON.stringify({ error: error.message, stack: error.stack, duration: Date.now() - startTime }))
        throw error
    }
}

async function handleDeleteWorkTree(params: DeleteWorkTreeParams): Promise<DeleteWorkTreeResponse> {
    const startTime = Date.now()
    logger.info("[Git:deleteWorkTree] Deleting worktree", JSON.stringify({ repoDir: params.repoDir, id: params.id }))

    try {
        validateRepoDir(params.repoDir)
        validateWorkTreeId(params.id)

        const { repoRoot } = await resolveGitInfo(params.repoDir)
        const worktreePath = getWorktreePath(params.id)

        // First, manually delete the directory if it exists (handles node_modules etc)
        if (fs.existsSync(worktreePath)) {
            logger.info("[Git:deleteWorkTree] Removing directory first", JSON.stringify({ worktreePath }))
            await fsExtra.remove(worktreePath)
        }

        // Then prune git's worktree tracking
        await execGit(["worktree", "prune"], repoRoot)

        logger.info("[Git:deleteWorkTree] Worktree removed successfully", JSON.stringify({ worktreePath, duration: Date.now() - startTime }))
        return { deleted: true }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const errorStack = error instanceof Error ? error.stack : undefined
        logger.error("[Git:deleteWorkTree] Error:", JSON.stringify({ error: errorMessage, stack: errorStack, duration: Date.now() - startTime }))
        return { deleted: false, error: errorMessage }
    }
}

/**
 * List all worktrees (supports subdirectories)
 */
async function handleListWorkTrees(params: ListWorkTreesParams): Promise<ListWorkTreesResponse> {
    const startTime = Date.now()
    logger.info("[Git:listWorkTrees] Listing worktrees", JSON.stringify({ repoDir: params.repoDir }))

    try {
        validateRepoDir(params.repoDir)

        // Resolve git info (handles subdirectories)
        const { repoRoot } = await resolveGitInfo(params.repoDir)

        const listResult = await execGit(["worktree", "list", "--porcelain"], repoRoot)
        if (!listResult.success) {
            throw new Error(`Failed to list worktrees: ${listResult.stderr}`)
        }

        const allWorktrees = parseWorktreeList(listResult.stdout)
        const baseDir = getWorktreeBaseDir()

        // Filter for only our managed worktrees
        const worktrees = allWorktrees.filter((wt) => wt.path.startsWith(baseDir))

        logger.info("[Git:listWorkTrees] Worktrees listed", JSON.stringify({ count: worktrees.length, duration: Date.now() - startTime }))
        return { worktrees }
    } catch (error: any) {
        logger.error("[Git:listWorkTrees] Error:", JSON.stringify({ error: error.message, stack: error.stack, duration: Date.now() - startTime }))
        throw error
    }
}

/**
 * Commit changes in a worktree
 */
async function handleCommitWorkTree(params: CommitWorkTreeParams): Promise<CommitWorkTreeResponse> {
    const startTime = Date.now()
    logger.info("[Git:commitWorkTree] Committing changes", JSON.stringify({
        repoDir: params.repoDir,
        workTreeId: params.workTreeId,
        message: params.message.slice(0, 50),
    }))

    try {
        validateRepoDir(params.repoDir)
        validateWorkTreeId(params.workTreeId)

        const worktreePath = getWorktreePath(params.workTreeId)

        // Validate worktree exists
        if (!fs.existsSync(worktreePath)) {
            throw new Error(`Worktree does not exist: ${worktreePath}`)
        }

        // Stage all changes
        const addResult = await execGit(["add", "-A"], worktreePath)
        if (!addResult.success) {
            throw new Error(`Failed to stage changes: ${addResult.stderr}`)
        }

        logger.info("[Git:commitWorkTree] Changes staged")

        // Commit
        const commitResult = await execGit(["commit", "-m", params.message], worktreePath)

        if (!commitResult.success) {
            // Check if it's "nothing to commit"
            if (commitResult.stdout.includes("nothing to commit") || commitResult.stderr.includes("nothing to commit")) {
                logger.info("[Git:commitWorkTree] Nothing to commit", JSON.stringify({ duration: Date.now() - startTime }))
                return { committed: false, error: "Nothing to commit" }
            }
            throw new Error(`Failed to commit: ${commitResult.stderr}`)
        }

        // Extract SHA from output
        const shaMatch = commitResult.stdout.match(/\[[\w\/\-]+\s+([a-f0-9]+)\]/)
        const sha = shaMatch ? shaMatch[1] : undefined

        logger.info("[Git:commitWorkTree] Commit successful", JSON.stringify({ sha, duration: Date.now() - startTime }))
        return { committed: true, sha }
    } catch (error: any) {
        logger.error("[Git:commitWorkTree] Error:", JSON.stringify({ error: error.message, stack: error.stack, duration: Date.now() - startTime }))
        return { committed: false, error: error.message }
    }
}

/**
 * List branches in a repository
 */
async function handleListBranches(params: ListBranchesParams): Promise<ListBranchesResponse> {
    const startTime = Date.now()
    logger.info("[Git:listBranches] Listing branches", JSON.stringify({ repoDir: params.repoDir, includeRemote: params.includeRemote }))

    try {
        validateRepoDir(params.repoDir)

        // Resolve git info (handles subdirectories)
        const { repoRoot } = await resolveGitInfo(params.repoDir)

        // Detect default branch
        let defaultBranch = "main"

        // Try to get from remote HEAD
        const remoteHeadResult = await execGit(["symbolic-ref", "refs/remotes/origin/HEAD"], repoRoot)
        if (remoteHeadResult.success) {
            const refName = remoteHeadResult.stdout.trim()
            defaultBranch = refName.replace("refs/remotes/origin/", "")
        } else {
            // Check if main exists
            const mainExistsResult = await execGit(["show-ref", "--verify", "refs/heads/main"], repoRoot)
            if (mainExistsResult.success) {
                defaultBranch = "main"
            } else {
                // Check if master exists
                const masterExistsResult = await execGit(["show-ref", "--verify", "refs/heads/master"], repoRoot)
                if (masterExistsResult.success) {
                    defaultBranch = "master"
                }
            }
        }

        // Get local branches
        const localBranchesResult = await execGit(["branch", "--format=%(refname:short)"], repoRoot)
        if (!localBranchesResult.success) {
            throw new Error(`Failed to list branches: ${localBranchesResult.stderr}`)
        }

        const localBranches = localBranchesResult.stdout
            .split("\n")
            .map((b) => b.trim())
            .filter((b) => b.length > 0)

        const branches: BranchInfo[] = localBranches.map((name) => ({
            name,
            isDefault: name === defaultBranch,
            isRemote: false,
        }))

        // Optionally include remote branches
        if (params.includeRemote) {
            const remoteBranchesResult = await execGit(["branch", "-r", "--format=%(refname:short)"], repoRoot)
            if (remoteBranchesResult.success) {
                const remoteBranches = remoteBranchesResult.stdout
                    .split("\n")
                    .map((b) => b.trim())
                    .filter((b) => b.length > 0 && !b.includes("HEAD"))

                for (const remoteBranch of remoteBranches) {
                    // Skip if already in local branches (e.g., origin/main when main exists locally)
                    const localName = remoteBranch.replace(/^origin\//, "")
                    if (!localBranches.includes(localName)) {
                        branches.push({
                            name: remoteBranch,
                            isDefault: localName === defaultBranch,
                            isRemote: true,
                        })
                    }
                }
            }
        }

        // Sort: default branch first, then alphabetically
        branches.sort((a, b) => {
            if (a.isDefault && !b.isDefault) return -1
            if (!a.isDefault && b.isDefault) return 1
            return a.name.localeCompare(b.name)
        })

        logger.info("[Git:listBranches] Branches listed", JSON.stringify({
            count: branches.length,
            defaultBranch,
            duration: Date.now() - startTime,
        }))
        return { branches, defaultBranch }
    } catch (error: any) {
        logger.error("[Git:listBranches] Error:", JSON.stringify({ error: error.message, stack: error.stack, duration: Date.now() - startTime }))
        throw error
    }
}

/**
 * Resolve a path, expanding ~ and environment variables
 */
async function handleResolvePath(params: ResolvePathParams): Promise<ResolvePathResponse> {
    const startTime = Date.now()
    logger.info("[Git:resolvePath] Resolving path", JSON.stringify({ path: params.path }))

    try {
        let resolvedPath = params.path.trim()

        // Expand ~ to home directory
        if (resolvedPath.startsWith("~")) {
            resolvedPath = path.join(os.homedir(), resolvedPath.slice(1))
        }

        // Expand $HOME or ${HOME} (Unix-style)
        resolvedPath = resolvedPath.replace(/\$HOME|\$\{HOME\}/g, os.homedir())

        // Expand %USERPROFILE% or %HOME% (Windows-style)
        resolvedPath = resolvedPath.replace(/%USERPROFILE%|%HOME%/gi, os.homedir())

        // Normalize the path
        resolvedPath = path.normalize(resolvedPath)

        // Check if path exists
        let exists = false
        let isDirectory = false

        try {
            const stats = fs.statSync(resolvedPath)
            exists = true
            isDirectory = stats.isDirectory()
        } catch (err) {
            // Path doesn't exist
            logger.debug('[Git] Path does not exist:', err)
            exists = false
            isDirectory = false
        }

        logger.info("[Git:resolvePath] Path resolved", JSON.stringify({
            original: params.path,
            resolved: resolvedPath,
            exists,
            isDirectory,
            duration: Date.now() - startTime,
        }))

        return { resolvedPath, exists, isDirectory }
    } catch (error: any) {
        logger.error("[Git:resolvePath] Error:", JSON.stringify({ error: error.message, stack: error.stack, duration: Date.now() - startTime }))
        throw error
    }
}

// Default .gitignore contents for new repositories
const DEFAULT_GITIGNORE = `# Dependencies
node_modules/
vendor/
bower_components/
.pnp/
.pnp.js

# Build outputs
dist/
build/
out/
.next/
.nuxt/
.output/
*.egg-info/
__pycache__/
*.pyc

# Environment files
.env
.env.local
.env.*.local
*.local

# IDE/Editor
.idea/
.vscode/
*.swp
*.swo
*~
.project
.classpath
.settings/

# OS files
.DS_Store
.DS_Store?
._*
Thumbs.db
ehthumbs.db
Desktop.ini

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Testing
coverage/
.nyc_output/
.pytest_cache/

# Misc
*.bak
*.tmp
*.temp
.cache/
`

/**
 * Get list of files changed between a commit and the working tree.
 * Uses `git diff <commit>` which compares to working directory (includes uncommitted changes).
 * This is the same approach used by workTreeDiffPatch for snapshots.
 */
async function handleGetChangedFiles(params: GetChangedFilesParams): Promise<GetChangedFilesResponse> {
    const startTime = Date.now()
    logger.info("[Git:getChangedFiles] Getting changed files", JSON.stringify({
        workDir: params.workDir,
        from: params.fromTreeish,
        to: params.toTreeish,
    }))

    try {
        // Use `git diff <commit>` to compare against working tree (includes uncommitted changes)
        // This matches the behavior of workTreeDiffPatch used for snapshots
        const result = await execGit(
            ["diff", "--name-status", "-M", params.fromTreeish],
            params.workDir
        )

        if (!result.success) {
            logger.error("[Git:getChangedFiles] Failed to get diff", JSON.stringify({ stderr: result.stderr }))
            throw new Error(`Failed to get changed files: ${result.stderr}`)
        }

        const files: ChangedFileInfo[] = []
        const seenPaths = new Set<string>()
        const lines = result.stdout.trim().split("\n").filter(Boolean)

        for (const line of lines) {
            // Format: STATUS\tPATH or STATUS\tOLDPATH\tNEWPATH (for renames)
            const parts = line.split("\t")
            const statusCode = parts[0]

            if (statusCode.startsWith("R")) {
                // Renamed file: R100\toldpath\tnewpath
                files.push({
                    path: parts[2],
                    oldPath: parts[1],
                    status: "renamed",
                })
                seenPaths.add(parts[2])
            } else if (statusCode === "A") {
                files.push({ path: parts[1], status: "added" })
                seenPaths.add(parts[1])
            } else if (statusCode === "D") {
                files.push({ path: parts[1], status: "deleted" })
                seenPaths.add(parts[1])
            } else if (statusCode === "M") {
                files.push({ path: parts[1], status: "modified" })
                seenPaths.add(parts[1])
            }
        }

        // Also include untracked files (new files not yet added to git)
        const untrackedResult = await execGit(
            ["ls-files", "--others", "--exclude-standard"],
            params.workDir
        )

        if (untrackedResult.success) {
            const untrackedLines = untrackedResult.stdout.trim().split("\n").filter(Boolean)
            for (const filePath of untrackedLines) {
                if (!seenPaths.has(filePath)) {
                    files.push({ path: filePath, status: "added" })
                }
            }
        }

        logger.info("[Git:getChangedFiles] Found changed files", JSON.stringify({
            count: files.length,
            duration: Date.now() - startTime,
        }))

        return {
            files,
            fromTreeish: params.fromTreeish,
            toTreeish: params.toTreeish,
        }
    } catch (error: any) {
        logger.error("[Git:getChangedFiles] Error:", JSON.stringify({ error: error.message, duration: Date.now() - startTime }))
        throw error
    }
}

// Max file size for diff display (1MB)
const MAX_FILE_SIZE_FOR_DIFF = 1024 * 1024

/**
 * Get file content at a specific treeish
 */
async function handleGetFileAtTreeish(params: GetFileAtTreeishParams): Promise<GetFileAtTreeishResponse> {
    const startTime = Date.now()
    logger.info("[Git:getFileAtTreeish] Getting file content", JSON.stringify({
        workDir: params.workDir,
        treeish: params.treeish,
        filePath: params.filePath,
    }))

    try {
        // First check the file size using git cat-file -s
        const sizeResult = await execGit(["cat-file", "-s", `${params.treeish}:${params.filePath}`], params.workDir)

        if (!sizeResult.success) {
            // File might not exist at this treeish
            if (sizeResult.stderr.includes("does not exist") || sizeResult.stderr.includes("fatal:")) {
                logger.info("[Git:getFileAtTreeish] File does not exist at treeish", JSON.stringify({
                    filePath: params.filePath,
                    treeish: params.treeish,
                }))
                return { content: "", exists: false }
            }
            throw new Error(`Failed to get file size: ${sizeResult.stderr}`)
        }

        const fileSize = parseInt(sizeResult.stdout.trim(), 10)
        if (fileSize > MAX_FILE_SIZE_FOR_DIFF) {
            logger.info("[Git:getFileAtTreeish] File too large for diff", JSON.stringify({
                filePath: params.filePath,
                treeish: params.treeish,
                size: fileSize,
                maxSize: MAX_FILE_SIZE_FOR_DIFF,
            }))
            return { content: "", exists: true, tooLarge: true }
        }

        // Use git show to get file content at specific commit
        const result = await execGit(["show", `${params.treeish}:${params.filePath}`], params.workDir)

        if (!result.success) {
            // File might not exist at this treeish
            if (result.stderr.includes("does not exist") || result.stderr.includes("fatal: path")) {
                logger.info("[Git:getFileAtTreeish] File does not exist at treeish", JSON.stringify({
                    filePath: params.filePath,
                    treeish: params.treeish,
                }))
                return { content: "", exists: false }
            }
            throw new Error(`Failed to get file content: ${result.stderr}`)
        }

        logger.info("[Git:getFileAtTreeish] Got file content", JSON.stringify({
            size: result.stdout.length,
            duration: Date.now() - startTime,
        }))

        return { content: result.stdout, exists: true }
    } catch (error: any) {
        logger.error("[Git:getFileAtTreeish] Error:", JSON.stringify({ error: error.message, duration: Date.now() - startTime }))
        throw error
    }
}

/**
 * Get both before and after content for a file between two treeishes
 */
async function handleGetFilePair(params: GetFilePairParams): Promise<GetFilePairResponse> {
    const startTime = Date.now()
    logger.info("[Git:getFilePair] Getting file pair", JSON.stringify({
        workDir: params.workDir,
        from: params.fromTreeish,
        to: params.toTreeish,
        filePath: params.filePath,
        oldPath: params.oldPath,
    }))

    try {
        // Get before content (use oldPath if it's a rename)
        const beforePath = params.oldPath || params.filePath
        const beforeResult = await handleGetFileAtTreeish({
            workDir: params.workDir,
            treeish: params.fromTreeish,
            filePath: beforePath,
        })

        // Get after content - read from working tree (filesystem) not from git
        // This ensures we get uncommitted changes
        let afterContent = ""
        let afterTooLarge = false
        const fullPath = path.join(params.workDir, params.filePath)

        if (fs.existsSync(fullPath)) {
            const stats = fs.statSync(fullPath)
            if (stats.size > MAX_FILE_SIZE_FOR_DIFF) {
                afterTooLarge = true
                logger.info("[Git:getFilePair] After file too large", JSON.stringify({
                    filePath: params.filePath,
                    size: stats.size,
                }))
            } else {
                afterContent = fs.readFileSync(fullPath, "utf8")
            }
        }

        // If either file is too large, return tooLarge flag
        if (beforeResult.tooLarge || afterTooLarge) {
            logger.info("[Git:getFilePair] File too large for diff", JSON.stringify({
                filePath: params.filePath,
                beforeTooLarge: beforeResult.tooLarge,
                afterTooLarge,
            }))
            return {
                before: "",
                after: "",
                tooLarge: true,
            }
        }

        logger.info("[Git:getFilePair] Got file pair", JSON.stringify({
            beforeSize: beforeResult.content.length,
            afterSize: afterContent.length,
            duration: Date.now() - startTime,
        }))

        return {
            before: beforeResult.content,
            after: afterContent,
        }
    } catch (error: any) {
        logger.error("[Git:getFilePair] Error:", JSON.stringify({ error: error.message, duration: Date.now() - startTime }))
        throw error
    }
}

/**
 * Initialize a git repository with a default .gitignore
 */
async function handleInitGit(params: InitGitParams): Promise<InitGitResponse> {
    const startTime = Date.now()
    logger.info("[Git:initGit] Initializing git repository", JSON.stringify({ directory: params.directory }))

    try {
        // Validate directory exists
        if (!fs.existsSync(params.directory)) {
            return { success: false, error: `Directory does not exist: ${params.directory}` }
        }

        if (!fs.statSync(params.directory).isDirectory()) {
            return { success: false, error: `Path is not a directory: ${params.directory}` }
        }

        // Check if already a git repository
        const gitDir = path.join(params.directory, ".git")
        if (fs.existsSync(gitDir)) {
            return { success: false, error: "Directory is already a git repository" }
        }

        // Initialize git repository
        const initResult = await execGit(["init"], params.directory)
        if (!initResult.success) {
            return { success: false, error: `Failed to initialize git: ${initResult.stderr}` }
        }

        // Create .gitignore if it doesn't exist
        const gitignorePath = path.join(params.directory, ".gitignore")
        if (!fs.existsSync(gitignorePath)) {
            fs.writeFileSync(gitignorePath, DEFAULT_GITIGNORE, "utf8")
            logger.info("[Git:initGit] Created .gitignore")
        }

        // Stage and commit the .gitignore
        await execGit(["add", ".gitignore"], params.directory)
        await execGit(["commit", "-m", "Initial commit: Add .gitignore"], params.directory)

        logger.info("[Git:initGit] Git repository initialized successfully", JSON.stringify({ directory: params.directory, duration: Date.now() - startTime }))
        return { success: true }
    } catch (error: any) {
        logger.error("[Git:initGit] Error:", JSON.stringify({ error: error.message, stack: error.stack, duration: Date.now() - startTime }))
        return { success: false, error: error.message }
    }
}

// ============================================================================
// Hot Files Cache (for search ranking)
// ============================================================================

interface HotFilesCache {
    files: Record<string, number> // filePath -> commit count
    timestamp: number
}

const hotFilesCache = new Map<string, HotFilesCache>()
const HOT_FILES_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

/**
 * Get hot files for a repo (cached for 30 minutes).
 * Returns map of filePath -> commit count.
 * Used by content search to rank results.
 */
export async function getHotFiles(repoDir: string): Promise<Record<string, number>> {
    const startTime = Date.now()

    // Check cache
    const cached = hotFilesCache.get(repoDir)
    if (cached && Date.now() - cached.timestamp < HOT_FILES_CACHE_TTL) {
        logger.info("[Git:getHotFiles] Returning cached hot files", JSON.stringify({
            repoDir,
            fileCount: Object.keys(cached.files).length,
            cacheAge: Math.round((Date.now() - cached.timestamp) / 1000) + "s",
        }))
        return cached.files
    }

    // Build cache
    const files = await buildHotFilesCache(repoDir)
    hotFilesCache.set(repoDir, { files, timestamp: Date.now() })

    logger.info("[Git:getHotFiles] Built hot files cache", JSON.stringify({
        repoDir,
        fileCount: Object.keys(files).length,
        duration: Date.now() - startTime,
    }))

    return files
}

/**
 * Build hot files cache by analyzing recent commits.
 * Tries to use local git user's commits first, falls back to all authors.
 */
async function buildHotFilesCache(repoDir: string): Promise<Record<string, number>> {
    // 1. Get local git user email
    const emailResult = await execGit(["config", "user.email"], repoDir)
    const userEmail = emailResult.success ? emailResult.stdout.trim() : null

    // 2. Try commits by author first (if we have an email)
    let logResult: { success: boolean; stdout: string } = { success: false, stdout: "" }
    if (userEmail) {
        logResult = await execGit(["log", `--author=${userEmail}`, "-n", "100", "--name-only", "--pretty=format:"], repoDir)
    }

    // 3. Count lines to see if we got enough commits
    const authorLines = logResult.stdout.split("\n").filter((line) => line.trim())

    // 4. Fallback to all authors if < 10 file entries from user's commits
    if (authorLines.length < 10) {
        logResult = await execGit(["log", "-n", "100", "--name-only", "--pretty=format:"], repoDir)
    }

    // 5. Count file occurrences
    const fileCounts: Record<string, number> = {}
    for (const line of logResult.stdout.split("\n")) {
        const file = line.trim()
        // Skip empty lines and commit metadata
        if (file && !file.startsWith("commit ") && !file.startsWith("Author:") && !file.startsWith("Date:")) {
            fileCounts[file] = (fileCounts[file] || 0) + 1
        }
    }

    return fileCounts
}

// ============================================================================
// Module Export
// ============================================================================

export const load = () => {
    logger.info("[Git] Registering IPC handlers")

    ipcMain.handle("git:isGitInstalled", async (event) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleIsGitInstalled()
    })

    ipcMain.handle("git:isGitDir", async (event, params: IsGitDirParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleIsGitDir(params)
    })

    ipcMain.handle("git:isGitDirectory", async (event, params: IsGitDirectoryParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleIsGitDirectory(params)
    })

    ipcMain.handle("git:getOrCreateWorkTree", async (event, params: GetOrCreateWorkTreeParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleGetOrCreateWorkTree(params)
    })

    ipcMain.handle("git:workTreeDiffPatch", async (event, params: WorkTreeDiffPatchParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleWorkTreeDiffPatch(params)
    })

    ipcMain.handle("git:getMergeBase", async (event, params: GetMergeBaseParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleGetMergeBase(params)
    })

    ipcMain.handle("git:getGitStatus", async (event, params: GitStatusParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleGetGitStatus(params)
    })

    ipcMain.handle("git:listFiles", async (event, params: ListFilesParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleListFiles(params)
    })

    ipcMain.handle("git:deleteWorkTree", async (event, params: DeleteWorkTreeParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleDeleteWorkTree(params)
    })

    ipcMain.handle("git:listWorkTrees", async (event, params: ListWorkTreesParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleListWorkTrees(params)
    })

    ipcMain.handle("git:commitWorkTree", async (event, params: CommitWorkTreeParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleCommitWorkTree(params)
    })

    ipcMain.handle("git:listBranches", async (event, params: ListBranchesParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleListBranches(params)
    })

    ipcMain.handle("git:resolvePath", async (event, params: ResolvePathParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleResolvePath(params)
    })

    ipcMain.handle("git:initGit", async (event, params: InitGitParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleInitGit(params)
    })

    ipcMain.handle("git:getChangedFiles", async (event, params: GetChangedFilesParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleGetChangedFiles(params)
    })

    ipcMain.handle("git:getFileAtTreeish", async (event, params: GetFileAtTreeishParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleGetFileAtTreeish(params)
    })

    ipcMain.handle("git:getFilePair", async (event, params: GetFilePairParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleGetFilePair(params)
    })

    logger.info("[Git] IPC handlers registered successfully")
}

export const cleanup = () => {
    logger.info("[Git] Cleanup called (no active resources to clean)")
    // No active resources to clean up for now
    // If we add any persistent state or resources in the future, clean them here
}
