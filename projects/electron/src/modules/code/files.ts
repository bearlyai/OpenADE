/**
 * File Search Utilities Module for Electron
 *
 * Provides fuzzy file search across directories.
 * Uses git ls-files for git repos, ripgrep for non-git directories.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import * as path from "path"
import * as fs from "fs"
import logger from "electron-log"
import fuzzysort from "fuzzysort"
import { isDev } from "../../config"
import { getHotFiles } from "./git"
import { execCommand } from "./subprocess"
import { resolve as resolveBinary } from "./binaries"

// Cache file lists by directory (key: `${dir}:${matchDirs}`)
const FILE_LIST_CACHE_TTL_MS = 20 * 1000 // 20 seconds

// Tree node for directory browsing
interface TreeNode {
    name: string
    isDir: boolean
    fullPath: string
    children: Map<string, TreeNode>
}

interface FileListCacheEntry {
    items: string[]
    source: "git" | "ripgrep" | "fs"
    tree: TreeNode
    timeoutId: NodeJS.Timeout
}
const fileListCache = new Map<string, FileListCacheEntry>()

// ============================================================================
// Type Definitions
// IMPORTANT: Keep in sync with projects/dashboard/src/pages/code/electronAPI/files.ts
// ============================================================================

interface FuzzySearchParams {
    dir: string
    query: string
    matchDirs: boolean
    limit?: number
}

interface TreeChild {
    name: string
    isDir: boolean
    fullPath: string
}

interface TreeMatch {
    path: string
    children: TreeChild[]
}

interface FuzzySearchResponse {
    results: string[]
    truncated: boolean
    source: "git" | "ripgrep" | "fs"
    treeMatch?: TreeMatch
}

// ============================================================================
// Content Search Types
// ============================================================================

interface ContentSearchParams {
    dir: string
    query: string
    limit?: number // default 100
    caseSensitive?: boolean
    regex?: boolean
    rankByHotFiles?: boolean // if true, rank results by git commit frequency
}

interface ContentSearchMatch {
    file: string // relative path from dir
    line: number // 1-indexed
    content: string // full line content
    matchStart: number // character offset in content where match starts
    matchEnd: number // character offset in content where match ends
}

interface ContentSearchResponse {
    matches: ContentSearchMatch[]
    truncated: boolean
}

// ============================================================================
// describePath Types
// ============================================================================

interface DescribePathParams {
    path: string
    readContents?: boolean   // If true and path is a file, include content
    maxReadSize?: number     // Max file size to read (caller decides limit)
    showHidden?: boolean     // If true and path is a dir, include dotfiles
}

interface PathEntry {
    name: string
    path: string  // Absolute path
    isDir: boolean
    isSymlink: boolean
    size: number
    mode: number
}

type DescribePathResponse =
    | { type: "dir"; path: string; mode: number; entries: PathEntry[] }
    | { type: "file"; path: string; size: number; mode: number; content: string | null; tooLarge: boolean; isReadable: boolean }
    | { type: "not_found"; path: string }
    | { type: "error"; path: string; message: string }

// ============================================================================
// Helper Functions
// ============================================================================

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
        logger.error("[Files:checkAllowed] Failed to parse origin:", error)
        return false
    }
}

/**
 * Execute a command using centralized subprocess runner
 * Uses execCommand to respect user-configured env vars (e.g., custom PATH)
 */
async function execCmd(cmd: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; success: boolean }> {
    return execCommand(cmd, args, { cwd, maxBuffer: 50 * 1024 * 1024 })
}

/**
 * Check if directory is within a git repository
 */
async function isGitRepo(dir: string): Promise<boolean> {
    const result = await execCmd("git", ["rev-parse", "--is-inside-work-tree"], dir)
    return result.success && result.stdout.trim() === "true"
}

/**
 * Get git repo root from a directory
 */
async function getGitRoot(dir: string): Promise<string | null> {
    const result = await execCmd("git", ["rev-parse", "--show-toplevel"], dir)
    return result.success ? result.stdout.trim() : null
}

/**
 * Get the relative path from git root to dir
 */
async function getGitRelativePath(dir: string): Promise<string> {
    const result = await execCmd("git", ["rev-parse", "--show-prefix"], dir)
    return result.success ? result.stdout.trim().replace(/\/$/, "") : ""
}

/**
 * List files using git ls-files
 */
async function listFilesWithGit({
    dir,
    matchDirs,
}: {
    dir: string
    matchDirs: boolean
}): Promise<string[]> {
    // Get relative path from git root
    const relativePath = await getGitRelativePath(dir)
    const gitRoot = await getGitRoot(dir)
    if (!gitRoot) return []

    // List tracked files
    const result = await execCmd("git", ["ls-files"], gitRoot)
    if (!result.success) return []

    let files = result.stdout
        .split("\n")
        .map((f) => f.trim())
        .filter((f) => f.length > 0)

    // Filter to only files in the current subdirectory
    if (relativePath) {
        const prefix = relativePath + "/"
        files = files.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length))
    }

    if (matchDirs) {
        // Extract unique directory paths
        const dirs = new Set<string>()
        for (const file of files) {
            let dir = path.dirname(file)
            while (dir && dir !== ".") {
                dirs.add(dir)
                dir = path.dirname(dir)
            }
        }
        return Array.from(dirs).sort()
    }

    return files
}

/**
 * Check if ripgrep is available in PATH
 */
async function getRipgrepPath(): Promise<string | null> {
    // First check system PATH
    const whichResult = await execCmd(process.platform === "win32" ? "where" : "which", ["rg"])
    if (whichResult.success) {
        return whichResult.stdout.trim().split("\n")[0]
    }
    return null
}

/**
 * Get the managed ripgrep path from the binary manager.
 */
function getManagedRipgrepPath(): string | null {
    return resolveBinary("rg")
}

/**
 * List files using ripgrep
 */
async function listFilesWithRipgrep({
    rgPath,
    dir,
    matchDirs,
}: {
    rgPath: string
    dir: string
    matchDirs: boolean
}): Promise<string[]> {
    // Use rg --files to list all files (respects .gitignore by default)
    // Exclude .git directory explicitly since --hidden includes it but .gitignore doesn't exclude it
    const result = await execCmd(rgPath, ["--files", "--hidden", "--glob", "!.git"], dir)
    if (!result.success) {
        logger.warn("[Files:listFilesWithRipgrep] Failed:", result.stderr)
        return []
    }

    let files = result.stdout
        .split("\n")
        .map((f) => f.trim())
        .filter((f) => f.length > 0)

    if (matchDirs) {
        // Extract unique directory paths
        const dirs = new Set<string>()
        for (const file of files) {
            let dirPath = path.dirname(file)
            while (dirPath && dirPath !== ".") {
                dirs.add(dirPath)
                dirPath = path.dirname(dirPath)
            }
        }
        return Array.from(dirs).sort()
    }

    return files
}

/**
 * List files using filesystem walk (fallback)
 */
function listFilesWithFs({
    dir,
    matchDirs,
    maxDepth = 10,
    maxFiles = 10000,
}: {
    dir: string
    matchDirs: boolean
    maxDepth?: number
    maxFiles?: number
}): string[] {
    const files: string[] = []
    const dirs: Set<string> = new Set()

    function walk(currentDir: string, depth: number, relativeBase: string): void {
        if (depth > maxDepth || files.length >= maxFiles) return

        let entries: fs.Dirent[]
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true })
        } catch (err) {
            logger.debug('[Files] Error reading directory:', err)
            return
        }

        for (const entry of entries) {
            if (files.length >= maxFiles) break

            // Skip common ignores
            if (
                entry.name.startsWith(".") ||
                entry.name === "node_modules" ||
                entry.name === "__pycache__" ||
                entry.name === "dist" ||
                entry.name === "build" ||
                entry.name === "vendor"
            ) {
                continue
            }

            const relativePath = relativeBase ? path.join(relativeBase, entry.name) : entry.name

            if (entry.isDirectory()) {
                dirs.add(relativePath)
                walk(path.join(currentDir, entry.name), depth + 1, relativePath)
            } else if (entry.isFile()) {
                files.push(relativePath)
            }
        }
    }

    walk(dir, 0, "")

    if (matchDirs) {
        return Array.from(dirs).sort()
    }

    return files
}

// ============================================================================
// Tree Building
// Note: Git always outputs paths with forward slashes, even on Windows.
// The tree structure uses forward slashes internally for consistency.
// ============================================================================

function buildTree(files: string[]): TreeNode {
    const root: TreeNode = { name: "", isDir: true, fullPath: "", children: new Map() }

    for (const filePath of files) {
        const parts = filePath.split("/")
        let current = root
        let pathSoFar = ""

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i]
            pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part
            const isLast = i === parts.length - 1

            if (!current.children.has(part)) {
                current.children.set(part, {
                    name: part,
                    isDir: !isLast,
                    fullPath: pathSoFar,
                    children: new Map(),
                })
            }
            current = current.children.get(part)!
        }
    }

    return root
}

function lookupTree(root: TreeNode, treePath: string): TreeNode | null {
    if (!treePath) return root
    const parts = treePath.split("/")
    let current = root
    for (const part of parts) {
        const child = current.children.get(part)
        if (!child) return null
        current = child
    }
    return current
}

function getChildrenFromTree(root: TreeNode, treePath: string): TreeChild[] {
    const node = lookupTree(root, treePath)
    if (!node || !node.isDir) return []

    return Array.from(node.children.values())
        .map((n) => ({ name: n.name, isDir: n.isDir, fullPath: n.fullPath }))
        .sort((a, b) => {
            // Dirs first, then alphabetical
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
            return a.name.localeCompare(b.name)
        })
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Get file list for a directory, using cache if available
 */
async function getFileList(
    dir: string,
    matchDirs: boolean
): Promise<{ items: string[]; source: "git" | "ripgrep" | "fs"; tree: TreeNode }> {
    const cacheKey = `${dir}:${matchDirs}`

    // Check cache
    const cached = fileListCache.get(cacheKey)
    if (cached) {
        logger.info("[Files:getFileList] Using cached file list", JSON.stringify({
            dir,
            matchDirs,
            count: cached.items.length,
        }))
        return { items: cached.items, source: cached.source, tree: cached.tree }
    }

    let items: string[] = []
    let source: "git" | "ripgrep" | "fs" = "fs"

    // Strategy 1: Use ripgrep if available (faster than git ls-files)
    const rgPath = (await getRipgrepPath()) || getManagedRipgrepPath()
    if (rgPath) {
        items = await listFilesWithRipgrep({ rgPath, dir, matchDirs })
        source = "ripgrep"
        logger.info("[Files:getFileList] Using ripgrep", JSON.stringify({ path: rgPath, count: items.length }))
    }

    // Strategy 2: Use git if ripgrep didn't work
    if (items.length === 0 && (await isGitRepo(dir))) {
        items = await listFilesWithGit({ dir, matchDirs })
        source = "git"
        logger.info("[Files:getFileList] Using git ls-files", JSON.stringify({ count: items.length }))
    }

    // Strategy 3: Fallback to filesystem walk
    if (items.length === 0) {
        items = listFilesWithFs({ dir, matchDirs })
        source = "fs"
        logger.info("[Files:getFileList] Using filesystem walk", JSON.stringify({ count: items.length }))
    }

    // Build tree for directory browsing
    const tree = buildTree(items)

    // Cache with auto-expiry
    const timeoutId = setTimeout(() => {
        fileListCache.delete(cacheKey)
        logger.info("[Files:getFileList] Cache expired", JSON.stringify({ cacheKey }))
    }, FILE_LIST_CACHE_TTL_MS)

    fileListCache.set(cacheKey, { items, source, tree, timeoutId })

    return { items, source, tree }
}

/**
 * Fuzzy search for files or directories
 */
async function handleFuzzySearch(params: FuzzySearchParams): Promise<FuzzySearchResponse> {
    const startTime = Date.now()
    logger.info("[Files:fuzzySearch] Starting search", JSON.stringify({
        dir: params.dir,
        query: params.query,
        matchDirs: params.matchDirs,
        limit: params.limit,
    }))

    // Validate directory exists
    if (!fs.existsSync(params.dir)) {
        throw new Error(`Directory does not exist: ${params.dir}`)
    }

    if (!fs.statSync(params.dir).isDirectory()) {
        throw new Error(`Path is not a directory: ${params.dir}`)
    }

    // Get file list (cached, includes tree)
    const { items, source, tree } = await getFileList(params.dir, params.matchDirs)

    const trimmedQuery = (params.query || "").trim()

    // Check for exact tree match (for directory browsing)
    let treeMatch: TreeMatch | undefined
    if (!trimmedQuery) {
        // Empty query = show root
        treeMatch = {
            path: "",
            children: getChildrenFromTree(tree, ""),
        }
    } else {
        // Check if query matches a directory exactly
        const node = lookupTree(tree, trimmedQuery)
        if (node && node.isDir) {
            treeMatch = {
                path: trimmedQuery,
                children: getChildrenFromTree(tree, trimmedQuery),
            }
        }
    }

    // Apply fuzzy search if query provided
    let results: string[]
    if (trimmedQuery) {
        const fuzzyResults = fuzzysort.go(trimmedQuery, items, {
            limit: params.limit || 100,
            threshold: -10000, // Include most results
        })
        results = fuzzyResults.map((r) => r.target)
        logger.info("[Files:fuzzySearch] Fuzzy search applied", JSON.stringify({
            query: trimmedQuery,
            matchCount: results.length,
        }))
    } else {
        results = items
    }

    // Apply limit
    const limit = params.limit || 100
    const maxLimit = 1000
    const actualLimit = Math.min(limit, maxLimit)
    const truncated = results.length > actualLimit
    if (truncated) {
        results = results.slice(0, actualLimit)
    }

    logger.info("[Files:fuzzySearch] Search complete", JSON.stringify({
        source,
        resultCount: results.length,
        truncated,
        hasTreeMatch: !!treeMatch,
        duration: Date.now() - startTime,
    }))

    return { results, truncated, source, treeMatch }
}

// ============================================================================
// describePath Handler
// ============================================================================

async function handleDescribePath(params: DescribePathParams): Promise<DescribePathResponse> {
    const {
        path: targetPath,
        readContents = false,
        maxReadSize,
        showHidden = false,
    } = params

    logger.info("[Files:describePath] Describing path", JSON.stringify({ targetPath, readContents, maxReadSize, showHidden }))

    // Check existence
    if (!fs.existsSync(targetPath)) {
        return { type: "not_found", path: targetPath }
    }

    let stats: fs.Stats
    try {
        stats = fs.lstatSync(targetPath)
    } catch (err) {
        return {
            type: "error",
            path: targetPath,
            message: err instanceof Error ? err.message : "Failed to stat path",
        }
    }

    const mode = stats.mode

    // Handle directory
    if (stats.isDirectory()) {
        const entries: PathEntry[] = []

        try {
            const rawEntries = fs.readdirSync(targetPath, { withFileTypes: true })

            for (const entry of rawEntries) {
                // Skip hidden unless requested
                if (!showHidden && entry.name.startsWith(".")) continue

                const fullPath = path.join(targetPath, entry.name)
                let entrySize = 0
                let entryMode = 0

                try {
                    const entryStat = fs.statSync(fullPath)
                    entrySize = entryStat.size
                    entryMode = entryStat.mode
                } catch (err) {
                    logger.debug('[Files] Error statting entry, skipping:', err)
                    continue  // Skip entries we can't stat
                }

                entries.push({
                    name: entry.name,
                    path: fullPath,
                    isDir: entry.isDirectory(),
                    isSymlink: entry.isSymbolicLink(),
                    size: entrySize,
                    mode: entryMode,
                })
            }

            // Sort: directories first, then alphabetically
            entries.sort((a, b) => {
                if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
                return a.name.localeCompare(b.name)
            })
        } catch (err) {
            return {
                type: "error",
                path: targetPath,
                message: err instanceof Error ? err.message : "Failed to read directory",
            }
        }

        logger.info("[Files:describePath] Directory described", JSON.stringify({ path: targetPath, entryCount: entries.length }))
        return { type: "dir", path: targetPath, mode, entries }
    }

    // Handle file
    if (stats.isFile()) {
        const size = stats.size

        // Check readability
        let isReadable = true
        try {
            fs.accessSync(targetPath, fs.constants.R_OK)
        } catch (err) {
            logger.debug('[Files] File not readable:', err)
            isReadable = false
        }

        // Determine if too large (only if maxReadSize specified)
        const tooLarge = maxReadSize !== undefined && size > maxReadSize

        // Read content if requested
        let content: string | null = null
        if (readContents && isReadable && !tooLarge) {
            try {
                content = fs.readFileSync(targetPath, "utf8")
            } catch (err) {
                logger.debug('[Files] Error reading file content:', err)
                isReadable = false
            }
        }

        logger.info("[Files:describePath] File described", JSON.stringify({ path: targetPath, size, tooLarge, isReadable, hasContent: content !== null }))
        return {
            type: "file",
            path: targetPath,
            size,
            mode,
            content,
            tooLarge,
            isReadable,
        }
    }

    // Handle other types (symlinks to nowhere, etc.)
    return {
        type: "error",
        path: targetPath,
        message: "Unsupported file type",
    }
}

// ============================================================================
// Content Search Handler
// ============================================================================

/**
 * Ripgrep JSON output types (subset of what we need)
 */
interface RgJsonMatch {
    type: "match"
    data: {
        path: { text: string }
        lines: { text: string }
        line_number: number
        submatches: Array<{
            match: { text: string }
            start: number
            end: number
        }>
    }
}

interface RgJsonSummary {
    type: "summary"
    data: {
        stats: {
            matches: number
        }
    }
}

type RgJsonLine = RgJsonMatch | RgJsonSummary | { type: string }

/**
 * Content search using ripgrep
 * Searches file contents for a pattern, returns matching lines with context
 */
async function handleContentSearch(params: ContentSearchParams): Promise<ContentSearchResponse> {
    const startTime = Date.now()
    const { dir, query, limit = 100, caseSensitive = false, regex = false, rankByHotFiles = false } = params

    logger.info("[Files:contentSearch] Starting search", JSON.stringify({ dir, query, limit, caseSensitive, regex, rankByHotFiles }))

    if (!query || !query.trim()) {
        return { matches: [], truncated: false }
    }

    // Validate directory exists
    if (!fs.existsSync(dir)) {
        throw new Error(`Directory does not exist: ${dir}`)
    }

    if (!fs.statSync(dir).isDirectory()) {
        throw new Error(`Path is not a directory: ${dir}`)
    }

    // Get ripgrep path
    const rgPath = (await getRipgrepPath()) || getManagedRipgrepPath()
    if (!rgPath) {
        throw new Error("Ripgrep not available")
    }

    // Build ripgrep arguments
    const args: string[] = [
        "--json", // JSON output for structured parsing
        "--line-number", // Include line numbers
        "--hidden", // Search hidden files
        "--max-count", String(limit + 1), // Get one extra to detect truncation
        // Exclude common non-code files and directories
        "--glob", "!.git",
        "--glob", "!*.lock",
        "--glob", "!package-lock.json",
        "--glob", "!yarn.lock",
        "--glob", "!pnpm-lock.yaml",
        "--glob", "!node_modules",
        "--glob", "!dist",
        "--glob", "!build",
        "--glob", "!.next",
        "--glob", "!.nuxt",
        "--glob", "!coverage",
        "--glob", "!*.min.js",
        "--glob", "!*.min.css",
        "--glob", "!*.map",
        "--glob", "!*.chunk.js",
        "--glob", "!vendor",
        "--glob", "!__pycache__",
        "--glob", "!*.pyc",
        "--glob", "!.venv",
        "--glob", "!venv",
        "--glob", "!*.egg-info",
    ]

    if (!caseSensitive) {
        args.push("--ignore-case")
    }

    if (!regex) {
        args.push("--fixed-strings") // Literal string search, not regex
    }

    args.push("--", query, dir)

    // Execute ripgrep
    const result = await execCmd(rgPath, args, dir)

    // ripgrep exits with 1 when no matches found, which is not an error
    if (!result.success && result.stderr && !result.stderr.includes("No files were searched")) {
        logger.warn("[Files:contentSearch] ripgrep error:", result.stderr)
    }

    // Parse JSON output
    const matches: ContentSearchMatch[] = []
    const lines = result.stdout.split("\n").filter((line) => line.trim())

    for (const line of lines) {
        try {
            const parsed = JSON.parse(line) as RgJsonLine
            if (parsed.type === "match") {
                const matchData = (parsed as RgJsonMatch).data
                const filePath = matchData.path.text
                const lineContent = matchData.lines.text.replace(/\n$/, "") // Remove trailing newline
                const lineNumber = matchData.line_number

                // Get first submatch for highlight positions
                const submatch = matchData.submatches[0]
                const matchStart = submatch?.start ?? 0
                const matchEnd = submatch?.end ?? matchStart

                // Make path relative to search dir
                const relativePath = filePath.startsWith(dir + "/") ? filePath.slice(dir.length + 1) : filePath

                matches.push({
                    file: relativePath,
                    line: lineNumber,
                    content: lineContent,
                    matchStart,
                    matchEnd,
                })

                // Stop if we have enough
                if (matches.length > limit) break
            }
        } catch (err) {
            // Skip malformed lines
            logger.debug('[Files] Error parsing ripgrep JSON line:', err)
        }
    }

    // Check truncation
    let truncated = matches.length > limit
    if (truncated) {
        matches.pop() // Remove the extra one we fetched
    }

    // Optionally rank by hot files (files frequently modified in recent commits)
    if (rankByHotFiles && matches.length > 0) {
        try {
            const hotFiles = await getHotFiles(dir)
            const hotFileCount = Object.keys(hotFiles).length

            if (hotFileCount > 0) {
                // Stable sort: hot files first (by commit count desc), preserve original order otherwise
                // We use the original index to maintain ripgrep's relevance ordering within same hotness
                const indexedMatches = matches.map((m, i) => ({ match: m, originalIndex: i }))

                indexedMatches.sort((a, b) => {
                    const aCount = hotFiles[a.match.file] || 0
                    const bCount = hotFiles[b.match.file] || 0
                    if (bCount !== aCount) {
                        return bCount - aCount // Higher count first
                    }
                    return a.originalIndex - b.originalIndex // Preserve original order
                })

                // Replace matches array with sorted results
                matches.length = 0
                for (const { match } of indexedMatches) {
                    matches.push(match)
                }

                logger.info("[Files:contentSearch] Ranked by hot files", JSON.stringify({
                    hotFileCount,
                    matchesWithHotness: indexedMatches.filter((m) => hotFiles[m.match.file]).length,
                }))
            }
        } catch (err) {
            // Hot files ranking is best-effort, don't fail the search
            logger.warn("[Files:contentSearch] Failed to get hot files for ranking:", err)
        }
    }

    logger.info("[Files:contentSearch] Search complete", JSON.stringify({
        matchCount: matches.length,
        truncated,
        duration: Date.now() - startTime,
    }))

    return { matches, truncated }
}

// ============================================================================
// Module Export
// ============================================================================

export const load = () => {
    logger.info("[Files] Registering IPC handlers")

    ipcMain.handle("files:fuzzySearch", async (event, params: FuzzySearchParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleFuzzySearch(params)
    })

    ipcMain.handle("files:describePath", async (event, params: DescribePathParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleDescribePath(params)
    })

    ipcMain.handle("files:contentSearch", async (event, params: ContentSearchParams) => {
        if (!checkAllowed(event)) throw new Error("not allowed")
        return handleContentSearch(params)
    })

    logger.info("[Files] IPC handlers registered successfully")
}

export const cleanup = () => {
    logger.info("[Files] Cleanup called, clearing file list cache")
    for (const entry of fileListCache.values()) {
        clearTimeout(entry.timeoutId)
    }
    fileListCache.clear()
}

