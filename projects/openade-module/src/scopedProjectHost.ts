import fs from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { classifyFileMetadata, FILE_SIGNATURE_SAMPLE_BYTES, type FileMetadata } from "../../runtime-node/src/fileMetadata"
import type {
    OpenADEProject,
    OpenADEProjectFilesFuzzySearchRequest,
    OpenADEProjectFilesFuzzySearchResult,
    OpenADEProjectFileReadRequest,
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesTreeEntry,
    OpenADEProjectFilesTreeRequest,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectFileWriteRequest,
    OpenADEProjectFileWriteResult,
    OpenADEProjectSearchRequest,
    OpenADEProjectSearchResult,
    OpenADETask,
} from "./types"

const DEFAULT_SCOPED_FILE_MAX_BYTES = 256 * 1024
const DEFAULT_SCOPED_TREE_MAX_DEPTH = 4
const DEFAULT_SCOPED_TREE_MAX_ENTRIES = 1000
const DEFAULT_SCOPED_SEARCH_LIMIT = 100
const MAX_SCOPED_SEARCH_FILE_BYTES = 1024 * 1024
const SCOPED_PROJECT_ALWAYS_SKIP_DIRS = new Set([".git"])
const SCOPED_PROJECT_GENERATED_SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next"])

type ScopedGitResult = {
    stdout: string
    stderr: string
    success: boolean
}

function scopedGit(args: string[], cwd: string): Promise<ScopedGitResult> {
    return new Promise((resolve) => {
        execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({
                stdout: String(stdout),
                stderr: String(stderr),
                success: !error,
            })
        })
    })
}

export function latestOpenADETaskWorktreeDir(task: OpenADETask): string | undefined {
    for (let index = task.deviceEnvironments.length - 1; index >= 0; index--) {
        const environment = task.deviceEnvironments[index]
        if (environment.setupComplete && environment.worktreeDir) return environment.worktreeDir
    }
    return undefined
}

function normalizeGitPrefix(prefix: string): string {
    const normalized = prefix.trim().replace(/\\/g, "/").replace(/\/$/, "")
    if (!normalized) return ""
    if (normalized.startsWith("/") || normalized.split("/").some((segment) => segment === "..")) {
        throw new Error("repository relative path is invalid")
    }
    return normalized
}

async function openADERepoPrefix(repoPath: string): Promise<string> {
    const result = await scopedGit(["rev-parse", "--show-prefix"], repoPath)
    if (!result.success) return ""
    return normalizeGitPrefix(result.stdout)
}

export async function resolveOpenADETaskWorkDir(repo: OpenADEProject, task: OpenADETask): Promise<string> {
    const isolationStrategy = task.isolationStrategy ?? { type: "head" }
    if (isolationStrategy.type === "head") return path.resolve(repo.path)

    const worktreeDir = latestOpenADETaskWorktreeDir(task)
    if (!worktreeDir) throw new Error("task worktree is not available")

    const root = path.resolve(worktreeDir)
    const prefix = await openADERepoPrefix(repo.path)
    const workDir = path.resolve(root, prefix)
    if (workDir !== root && !workDir.startsWith(`${root}${path.sep}`)) {
        throw new Error("task worktree path is invalid")
    }
    return workDir
}

async function scopedHostRoot(params: { repo: OpenADEProject; task?: OpenADETask }): Promise<string> {
    return params.task ? resolveOpenADETaskWorkDir(params.repo, params.task) : path.resolve(params.repo.path)
}

export function resolveOpenADEProjectRelativePath(repo: OpenADEProject, relativePath: string): string {
    const root = path.resolve(repo.path)
    return resolveOpenADERootRelativePath(root, relativePath)
}

function resolveOpenADERootRelativePath(root: string, relativePath: string): string {
    const target = path.resolve(root, relativePath)
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
        throw new Error("path is outside the repository")
    }
    return target
}

function scopedRelativePath(root: string, fullPath: string): string {
    return path.relative(root, fullPath).split(path.sep).join("/")
}

function shouldSkipScopedEntry(name: string, includeHidden: boolean, includeGenerated: boolean): boolean {
    if (SCOPED_PROJECT_ALWAYS_SKIP_DIRS.has(name)) return true
    if (!includeHidden && name.startsWith(".")) return true
    return !includeGenerated && SCOPED_PROJECT_GENERATED_SKIP_DIRS.has(name)
}

async function readFileSample(filePath: string, size: number): Promise<Uint8Array> {
    if (size <= 0) return new Uint8Array()
    const handle = await fs.open(filePath, "r")
    try {
        const buffer = Buffer.alloc(Math.min(size, FILE_SIGNATURE_SAMPLE_BYTES))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        return buffer.subarray(0, bytesRead)
    } finally {
        await handle.close()
    }
}

async function classifyScopedFile(filePath: string, size: number): Promise<{ metadata: FileMetadata | null; isReadable: boolean }> {
    try {
        return { metadata: classifyFileMetadata(filePath, await readFileSample(filePath, size)), isReadable: true }
    } catch {
        return { metadata: null, isReadable: false }
    }
}

function rankScopedPathMatch(pathname: string, query: string): number {
    if (!query) return 0
    const lowerPath = pathname.toLowerCase()
    const lowerQuery = query.toLowerCase()
    const index = lowerPath.indexOf(lowerQuery)
    if (index >= 0) return index

    let queryIndex = 0
    for (const char of lowerPath) {
        if (char === lowerQuery[queryIndex]) queryIndex += 1
        if (queryIndex === lowerQuery.length) return lowerPath.length
    }
    return Number.POSITIVE_INFINITY
}

async function walkOpenADEProjectPaths(
    root: string,
    options: { includeDirs?: boolean; includeFiles?: boolean; includeHidden?: boolean; includeGenerated?: boolean } = {}
): Promise<Array<{ fullPath: string; relativePath: string; isDir: boolean }>> {
    const entries: Array<{ fullPath: string; relativePath: string; isDir: boolean }> = []
    const queue = [root]
    const includeHidden = options.includeHidden === true
    const includeGenerated = options.includeGenerated === true
    const includeFiles = options.includeFiles !== false

    while (queue.length > 0 && entries.length < 10_000) {
        const dir = queue.shift()
        if (!dir) break
        const dirEntries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const entry of dirEntries) {
            if (shouldSkipScopedEntry(entry.name, includeHidden, includeGenerated)) continue
            const fullPath = path.join(dir, entry.name)
            const relativePath = scopedRelativePath(root, fullPath)
            const isDir = entry.isDirectory()
            if (isDir) {
                if (options.includeDirs) entries.push({ fullPath, relativePath, isDir: true })
                queue.push(fullPath)
            } else if (includeFiles && entry.isFile()) {
                entries.push({ fullPath, relativePath, isDir: false })
            }
            if (entries.length >= 10_000) break
        }
    }
    return entries
}

export async function listOpenADEProjectFiles(
    params: OpenADEProjectFilesTreeRequest & { repo: OpenADEProject; task?: OpenADETask }
): Promise<OpenADEProjectFilesTreeResult> {
    const root = await scopedHostRoot(params)
    const start = resolveOpenADERootRelativePath(root, params.path ?? "")
    const startStat = await fs.stat(start).catch(() => null)
    if (!startStat) throw new Error("path does not exist")
    if (!startStat.isDirectory()) throw new Error("path is not a directory")
    const maxDepth = params.maxDepth ?? DEFAULT_SCOPED_TREE_MAX_DEPTH
    const maxEntries = params.maxEntries ?? DEFAULT_SCOPED_TREE_MAX_ENTRIES
    const includeHidden = params.includeHidden === true
    const includeGenerated = params.includeGenerated === true
    const entries: OpenADEProjectFilesTreeEntry[] = []
    const queue: Array<{ dir: string; depth: number }> = [{ dir: start, depth: 0 }]

    while (queue.length > 0 && entries.length < maxEntries) {
        const current = queue.shift()
        if (!current) break
        const dirEntries = await fs.readdir(current.dir, { withFileTypes: true }).catch(() => [])
        for (const entry of dirEntries) {
            if (entries.length >= maxEntries) break
            if (shouldSkipScopedEntry(entry.name, includeHidden, includeGenerated)) continue
            const fullPath = path.join(current.dir, entry.name)
            const relativePath = scopedRelativePath(root, fullPath)
            if (entry.isDirectory()) {
                entries.push({ path: relativePath, name: entry.name, type: "directory" })
                if (current.depth < maxDepth) queue.push({ dir: fullPath, depth: current.depth + 1 })
            } else if (entry.isFile()) {
                const stat = await fs.stat(fullPath).catch(() => null)
                entries.push({
                    path: relativePath,
                    name: entry.name,
                    type: "file",
                    size: stat?.size,
                    mtimeMs: stat?.mtimeMs,
                })
            }
        }
    }

    return { repoId: params.repoId, taskId: params.taskId, path: params.path ?? "", entries, truncated: entries.length >= maxEntries || queue.length > 0 }
}

export async function readOpenADEProjectFile(
    params: OpenADEProjectFileReadRequest & { repo: OpenADEProject; task?: OpenADETask }
): Promise<OpenADEProjectFileReadResult> {
    const root = await scopedHostRoot(params)
    const target = resolveOpenADERootRelativePath(root, params.path)
    const encoding = params.encoding ?? "utf8"
    const maxBytes = params.maxBytes ?? DEFAULT_SCOPED_FILE_MAX_BYTES
    const stat = await fs.stat(target)
    if (!stat.isFile()) throw new Error("path is not a file")
    const { metadata, isReadable } = await classifyScopedFile(target, stat.size)
    if (stat.size > maxBytes) {
        return {
            repoId: params.repoId,
            taskId: params.taskId,
            path: params.path,
            encoding,
            size: stat.size,
            tooLarge: true,
            content: null,
            isReadable,
            ...(metadata ? { isBinary: metadata.isBinary, mediaType: metadata.mediaType, previewKind: metadata.previewKind } : {}),
        }
    }
    const shouldReadContent = isReadable && (encoding === "base64" || metadata?.isBinary !== true)
    return {
        repoId: params.repoId,
        taskId: params.taskId,
        path: params.path,
        encoding,
        size: stat.size,
        tooLarge: false,
        content: shouldReadContent ? await fs.readFile(target, encoding).catch(() => null) : null,
        isReadable,
        ...(metadata ? { isBinary: metadata.isBinary, mediaType: metadata.mediaType, previewKind: metadata.previewKind } : {}),
    }
}

export async function writeOpenADEProjectFile(
    params: OpenADEProjectFileWriteRequest & { repo: OpenADEProject; task?: OpenADETask }
): Promise<OpenADEProjectFileWriteResult> {
    const root = await scopedHostRoot(params)
    const target = resolveOpenADERootRelativePath(root, params.path)
    if (target === root) throw new Error("path is not a file")
    if (params.createDirs) await fs.mkdir(path.dirname(target), { recursive: true })
    const data = params.encoding === "base64" ? Buffer.from(params.content, "base64") : Buffer.from(params.content, "utf8")
    await fs.writeFile(target, data)
    return { repoId: params.repoId, taskId: params.taskId, path: params.path, size: data.byteLength }
}

export async function fuzzySearchOpenADEProjectFiles(
    params: OpenADEProjectFilesFuzzySearchRequest & { repo: OpenADEProject; task?: OpenADETask }
): Promise<OpenADEProjectFilesFuzzySearchResult> {
    const root = await scopedHostRoot(params)
    const limit = params.limit ?? DEFAULT_SCOPED_SEARCH_LIMIT
    const query = params.query.trim()
    const paths = await walkOpenADEProjectPaths(root, {
        includeDirs: params.matchDirs === true,
        includeFiles: params.matchDirs !== true,
        includeHidden: params.includeHidden,
        includeGenerated: params.includeGenerated,
    })
    const ranked = paths
        .map((entry) => ({ ...entry, rank: rankScopedPathMatch(entry.relativePath, query) }))
        .filter((entry) => Number.isFinite(entry.rank))
        .sort((a, b) => a.rank - b.rank || a.relativePath.localeCompare(b.relativePath))

    return {
        repoId: params.repoId,
        taskId: params.taskId,
        results: ranked.slice(0, limit).map((entry) => entry.relativePath),
        truncated: ranked.length > limit || paths.length >= 10_000,
        source: "filesystem",
    }
}

export async function searchOpenADEProject(
    params: OpenADEProjectSearchRequest & { repo: OpenADEProject; task?: OpenADETask }
): Promise<OpenADEProjectSearchResult> {
    const root = await scopedHostRoot(params)
    const limit = params.limit ?? DEFAULT_SCOPED_SEARCH_LIMIT
    const needle = params.caseSensitive ? params.query : params.query.toLowerCase()
    const matches: OpenADEProjectSearchResult["matches"] = []
    const files = await walkOpenADEProjectPaths(root)

    for (const file of files) {
        if (matches.length >= limit) break
        const stat = await fs.stat(file.fullPath).catch(() => null)
        if (!stat || stat.size > MAX_SCOPED_SEARCH_FILE_BYTES) continue
        const content = await fs.readFile(file.fullPath, "utf8").catch(() => null)
        if (content === null) continue
        const lines = content.split(/\r?\n/)
        for (let index = 0; index < lines.length && matches.length < limit; index++) {
            const line = lines[index]
            const haystack = params.caseSensitive ? line : line.toLowerCase()
            const matchStart = haystack.indexOf(needle)
            if (matchStart < 0) continue
            matches.push({
                path: file.relativePath,
                line: index + 1,
                content: line,
                matchStart,
                matchEnd: matchStart + params.query.length,
            })
        }
    }

    return { repoId: params.repoId, taskId: params.taskId, matches, truncated: matches.length >= limit }
}
