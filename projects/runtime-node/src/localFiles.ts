import fs from "node:fs/promises"
import path from "node:path"
import { classifyFileMetadata, FILE_SIGNATURE_SAMPLE_BYTES, type FileMetadata } from "./fileMetadata"
import type { RuntimeNodeFilesAdapter } from "./files"

interface PathEntry {
    name: string
    path: string
    isDir: boolean
    isSymlink: boolean
    size: number
    mode: number
}

const DEFAULT_MAX_READ_SIZE = 256 * 1024
const DEFAULT_SEARCH_LIMIT = 100
const MAX_WALK_ENTRIES = 10_000
const MAX_SEARCH_FILE_SIZE = 1024 * 1024
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next"])

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function stringValue(record: Record<string, unknown>, key: string): string {
    const value = record[key]
    if (typeof value !== "string" || !value) throw new Error(`${key} is required`)
    return value
}

function boolValue(value: unknown, fallback = false): boolean {
    return typeof value === "boolean" ? value : fallback
}

function encodingValue(value: unknown): BufferEncoding {
    return value === "base64" ? "base64" : "utf8"
}

function positiveInt(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

async function entryFor(dir: string, name: string): Promise<PathEntry | null> {
    const fullPath = path.join(dir, name)
    try {
        const stat = await fs.lstat(fullPath)
        return {
            name,
            path: fullPath,
            isDir: stat.isDirectory(),
            isSymlink: stat.isSymbolicLink(),
            size: stat.size,
            mode: stat.mode,
        }
    } catch {
        return null
    }
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

async function walk(root: string, options: { includeDirs?: boolean; showHidden?: boolean } = {}): Promise<Array<{ relativePath: string; fullPath: string; isDir: boolean }>> {
    const result: Array<{ relativePath: string; fullPath: string; isDir: boolean }> = []
    const queue = [root]

    while (queue.length > 0 && result.length < MAX_WALK_ENTRIES) {
        const dir = queue.shift()!
        let entries: Array<{ name: string; isDirectory(): boolean }>
        try {
            entries = await fs.readdir(dir, { withFileTypes: true })
        } catch {
            continue
        }

        for (const entry of entries) {
            if (!options.showHidden && entry.name.startsWith(".")) continue
            const fullPath = path.join(dir, entry.name)
            const relativePath = path.relative(root, fullPath)
            const isDir = entry.isDirectory()
            if (isDir && SKIP_DIRS.has(entry.name)) continue
            if (!isDir || options.includeDirs) result.push({ relativePath, fullPath, isDir })
            if (isDir) queue.push(fullPath)
            if (result.length >= MAX_WALK_ENTRIES) break
        }
    }

    return result
}

function rankMatch(pathname: string, query: string): number {
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

export function createRuntimeNodeLocalFilesAdapter(): RuntimeNodeFilesAdapter {
    return {
        async describePath(params) {
            const record = asRecord(params)
            const targetPath = stringValue(record, "path")
            const maxReadSize = positiveInt(record.maxReadSize, DEFAULT_MAX_READ_SIZE)
            const readContents = boolValue(record.readContents)
            const showHidden = boolValue(record.showHidden)

            try {
                const stat = await fs.lstat(targetPath)
                if (stat.isDirectory()) {
                    const names = await fs.readdir(targetPath)
                    const entries = (await Promise.all(names.filter((name) => showHidden || !name.startsWith(".")).map((name) => entryFor(targetPath, name))))
                        .filter((entry): entry is PathEntry => entry !== null)
                        .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
                    return { type: "dir", path: targetPath, mode: stat.mode, entries }
                }

                if (stat.isFile()) {
                    const tooLarge = stat.size > maxReadSize
                    let isReadable = true
                    let metadata: FileMetadata | null = null
                    if (readContents) {
                        try {
                            metadata = classifyFileMetadata(targetPath, await readFileSample(targetPath, stat.size))
                        } catch {
                            isReadable = false
                        }
                    }
                    const content = readContents && isReadable && !tooLarge && metadata?.isBinary !== true ? await fs.readFile(targetPath, "utf8").catch(() => null) : null
                    if (readContents && isReadable && !tooLarge && metadata?.isBinary !== true && content === null) isReadable = false
                    return {
                        type: "file",
                        path: targetPath,
                        size: stat.size,
                        mode: stat.mode,
                        content,
                        tooLarge,
                        isReadable,
                        ...(metadata ? { isBinary: metadata.isBinary, mediaType: metadata.mediaType, previewKind: metadata.previewKind } : {}),
                    }
                }

                return { type: "error", path: targetPath, message: "Path is neither a file nor directory" }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return { type: "not_found", path: targetPath }
                return { type: "error", path: targetPath, message: error instanceof Error ? error.message : "Unable to read path" }
            }
        },

        async readFile(params) {
            const record = asRecord(params)
            const targetPath = stringValue(record, "path")
            const encoding = encodingValue(record.encoding)
            const maxReadSize = positiveInt(record.maxReadSize, DEFAULT_MAX_READ_SIZE)
            const stat = await fs.stat(targetPath)
            if (!stat.isFile()) return { type: "error", path: targetPath, message: "Path is not a file" }
            if (stat.size > maxReadSize) return { type: "file", path: targetPath, size: stat.size, encoding, tooLarge: true, content: null }
            return {
                type: "file",
                path: targetPath,
                size: stat.size,
                encoding,
                tooLarge: false,
                content: await fs.readFile(targetPath, encoding),
            }
        },

        async writeFile(params) {
            const record = asRecord(params)
            const targetPath = stringValue(record, "path")
            const encoding = encodingValue(record.encoding)
            const content = typeof record.content === "string" ? record.content : ""
            if (boolValue(record.createDirectory)) await fs.mkdir(path.dirname(targetPath), { recursive: true })
            await fs.writeFile(targetPath, content, encoding)
            const stat = await fs.stat(targetPath)
            return { ok: true, path: targetPath, size: stat.size, encoding }
        },

        async createDirectory(params) {
            const record = asRecord(params)
            const targetPath = stringValue(record, "path")
            await fs.mkdir(targetPath, { recursive: boolValue(record.recursive, true) })
            return { ok: true, path: targetPath }
        },

        async removePath(params) {
            const record = asRecord(params)
            const targetPath = stringValue(record, "path")
            await fs.rm(targetPath, { recursive: boolValue(record.recursive), force: boolValue(record.force) })
            return { ok: true, path: targetPath }
        },

        async copyPath(params) {
            const record = asRecord(params)
            const from = stringValue(record, "from")
            const to = stringValue(record, "to")
            await fs.cp(from, to, { recursive: boolValue(record.recursive), force: boolValue(record.force, true) })
            return { ok: true, from, to }
        },

        async fuzzySearch(params) {
            const record = asRecord(params)
            const dir = stringValue(record, "dir")
            const query = typeof record.query === "string" ? record.query : ""
            const limit = positiveInt(record.limit, DEFAULT_SEARCH_LIMIT)
            const items = await walk(dir, { includeDirs: boolValue(record.matchDirs) })
            const ranked = items
                .map((item) => ({ ...item, rank: rankMatch(item.relativePath, query) }))
                .filter((item) => Number.isFinite(item.rank))
                .sort((a, b) => a.rank - b.rank || a.relativePath.localeCompare(b.relativePath))
            return {
                results: ranked.slice(0, limit).map((item) => item.relativePath),
                truncated: ranked.length > limit || items.length >= MAX_WALK_ENTRIES,
                source: "fs",
            }
        },

        async searchContent(params) {
            const record = asRecord(params)
            const dir = stringValue(record, "dir")
            const query = typeof record.query === "string" ? record.query : ""
            const limit = positiveInt(record.limit, DEFAULT_SEARCH_LIMIT)
            const caseSensitive = boolValue(record.caseSensitive)
            const files = await walk(dir)
            const matches: Array<{ file: string; line: number; content: string; matchStart: number; matchEnd: number }> = []
            const matcher = boolValue(record.regex)
                ? new RegExp(query, caseSensitive ? "u" : "iu")
                : null
            const needle = caseSensitive ? query : query.toLowerCase()

            for (const file of files) {
                if (file.isDir || matches.length >= limit) break
                const stat = await fs.stat(file.fullPath).catch(() => null)
                if (!stat || stat.size > MAX_SEARCH_FILE_SIZE) continue
                const content = await fs.readFile(file.fullPath, "utf8").catch(() => null)
                if (content === null) continue
                const lines = content.split(/\r?\n/)
                for (let index = 0; index < lines.length && matches.length < limit; index++) {
                    const line = lines[index]
                    const match = matcher?.exec(line)
                    const matchStart = matcher ? (match?.index ?? -1) : (caseSensitive ? line : line.toLowerCase()).indexOf(needle)
                    if (matchStart < 0) continue
                    matches.push({
                        file: file.relativePath,
                        line: index + 1,
                        content: line,
                        matchStart,
                        matchEnd: matchStart + (matcher ? (match?.[0].length ?? 0) : query.length),
                    })
                }
            }

            return { matches, truncated: matches.length >= limit }
        },
    }
}
