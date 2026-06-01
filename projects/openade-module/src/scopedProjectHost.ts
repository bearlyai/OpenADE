import fs from "node:fs/promises"
import path from "node:path"
import type {
    OpenADEProject,
    OpenADEProjectFileReadRequest,
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesTreeEntry,
    OpenADEProjectFilesTreeRequest,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectFileWriteRequest,
    OpenADEProjectFileWriteResult,
    OpenADEProjectSearchRequest,
    OpenADEProjectSearchResult,
} from "./types"

const DEFAULT_SCOPED_FILE_MAX_BYTES = 256 * 1024
const DEFAULT_SCOPED_TREE_MAX_DEPTH = 4
const DEFAULT_SCOPED_TREE_MAX_ENTRIES = 1000
const DEFAULT_SCOPED_SEARCH_LIMIT = 100
const MAX_SCOPED_SEARCH_FILE_BYTES = 1024 * 1024
const SCOPED_PROJECT_SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next"])

export function resolveOpenADEProjectRelativePath(repo: OpenADEProject, relativePath: string): string {
    const root = path.resolve(repo.path)
    const target = path.resolve(root, relativePath)
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
        throw new Error("path is outside the repository")
    }
    return target
}

function scopedRelativePath(root: string, fullPath: string): string {
    return path.relative(root, fullPath).split(path.sep).join("/")
}

function shouldSkipScopedEntry(name: string, includeHidden: boolean): boolean {
    if (!includeHidden && name.startsWith(".")) return true
    return SCOPED_PROJECT_SKIP_DIRS.has(name)
}

export async function listOpenADEProjectFiles(params: OpenADEProjectFilesTreeRequest & { repo: OpenADEProject }): Promise<OpenADEProjectFilesTreeResult> {
    const root = path.resolve(params.repo.path)
    const start = resolveOpenADEProjectRelativePath(params.repo, params.path ?? "")
    const maxDepth = params.maxDepth ?? DEFAULT_SCOPED_TREE_MAX_DEPTH
    const maxEntries = params.maxEntries ?? DEFAULT_SCOPED_TREE_MAX_ENTRIES
    const includeHidden = params.includeHidden === true
    const entries: OpenADEProjectFilesTreeEntry[] = []
    const queue: Array<{ dir: string; depth: number }> = [{ dir: start, depth: 0 }]

    while (queue.length > 0 && entries.length < maxEntries) {
        const current = queue.shift()
        if (!current) break
        const dirEntries = await fs.readdir(current.dir, { withFileTypes: true }).catch(() => [])
        for (const entry of dirEntries) {
            if (entries.length >= maxEntries) break
            if (shouldSkipScopedEntry(entry.name, includeHidden)) continue
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

    return { repoId: params.repoId, path: params.path ?? "", entries, truncated: entries.length >= maxEntries || queue.length > 0 }
}

export async function readOpenADEProjectFile(params: OpenADEProjectFileReadRequest & { repo: OpenADEProject }): Promise<OpenADEProjectFileReadResult> {
    const target = resolveOpenADEProjectRelativePath(params.repo, params.path)
    const encoding = params.encoding ?? "utf8"
    const maxBytes = params.maxBytes ?? DEFAULT_SCOPED_FILE_MAX_BYTES
    const stat = await fs.stat(target)
    if (!stat.isFile()) throw new Error("path is not a file")
    if (stat.size > maxBytes) {
        return { repoId: params.repoId, path: params.path, encoding, size: stat.size, tooLarge: true, content: null }
    }
    return {
        repoId: params.repoId,
        path: params.path,
        encoding,
        size: stat.size,
        tooLarge: false,
        content: await fs.readFile(target, encoding),
    }
}

export async function writeOpenADEProjectFile(params: OpenADEProjectFileWriteRequest & { repo: OpenADEProject }): Promise<OpenADEProjectFileWriteResult> {
    const target = resolveOpenADEProjectRelativePath(params.repo, params.path)
    if (target === path.resolve(params.repo.path)) throw new Error("path is not a file")
    if (params.createDirs) await fs.mkdir(path.dirname(target), { recursive: true })
    const data = params.encoding === "base64" ? Buffer.from(params.content, "base64") : Buffer.from(params.content, "utf8")
    await fs.writeFile(target, data)
    return { repoId: params.repoId, path: params.path, size: data.byteLength }
}

async function walkOpenADEProjectFiles(root: string): Promise<Array<{ fullPath: string; relativePath: string }>> {
    const files: Array<{ fullPath: string; relativePath: string }> = []
    const queue = [root]
    while (queue.length > 0 && files.length < 10_000) {
        const dir = queue.shift()
        if (!dir) break
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const entry of entries) {
            if (entry.name.startsWith(".") || SCOPED_PROJECT_SKIP_DIRS.has(entry.name)) continue
            const fullPath = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                queue.push(fullPath)
            } else if (entry.isFile()) {
                files.push({ fullPath, relativePath: path.relative(root, fullPath) })
            }
        }
    }
    return files
}

export async function searchOpenADEProject(params: OpenADEProjectSearchRequest & { repo: OpenADEProject }): Promise<OpenADEProjectSearchResult> {
    const root = path.resolve(params.repo.path)
    const limit = params.limit ?? DEFAULT_SCOPED_SEARCH_LIMIT
    const needle = params.caseSensitive ? params.query : params.query.toLowerCase()
    const matches: OpenADEProjectSearchResult["matches"] = []
    const files = await walkOpenADEProjectFiles(root)

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

    return { repoId: params.repoId, matches, truncated: matches.length >= limit }
}
