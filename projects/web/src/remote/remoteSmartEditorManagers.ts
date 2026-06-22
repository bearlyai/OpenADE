import { makeAutoObservable, runInAction } from "mobx"
import type {
    OpenADEProjectFilesFuzzySearchRequest,
    OpenADEProjectFilesFuzzySearchResult,
    OpenADESdkCapabilities,
} from "../../../openade-module/src"
import type {
    SlashCommandEntry,
    SmartEditorFileSearchResult,
    SmartEditorManagerContract,
    SmartEditorSdkCapabilitiesContract,
} from "../components/SmartEditor"
import type { ImageAttachment } from "../types"

interface FileUsageStat {
    count: number
    lastUsed: number
}

type NamespaceStats = Record<string, FileUsageStat>
type AllStats = Record<string, NamespaceStats>

interface RemoteSmartEditorFileContext {
    repoId: string
    taskId?: string
}

export interface RemoteSmartEditorFileAccess {
    getContext(dir: string): RemoteSmartEditorFileContext | null
    fuzzySearchProjectFiles(args: OpenADEProjectFilesFuzzySearchRequest): Promise<OpenADEProjectFilesFuzzySearchResult | null>
}

type RemoteSdkCapabilitiesLoader = (cwd: string) => Promise<OpenADESdkCapabilities | null>

const FILE_USAGE_STATS_KEY = "code:fileUsageStats"
const MAX_STORED_FILES = 50
const MAX_FAVORITES = 5
const FRECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000

function frecencyScore(stat: FileUsageStat, now: number): number {
    const ageMs = Math.max(0, now - stat.lastUsed)
    const decay = 2 ** (-ageMs / FRECENCY_HALF_LIFE_MS)
    return stat.count * decay
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function isFileUsageStat(value: unknown): value is FileUsageStat {
    return isRecord(value) && typeof value.count === "number" && typeof value.lastUsed === "number"
}

function parseAllStats(value: unknown): AllStats {
    if (!isRecord(value)) return {}

    const allStats: AllStats = {}
    for (const [namespace, namespaceValue] of Object.entries(value)) {
        if (!isRecord(namespaceValue)) continue

        const namespaceStats: NamespaceStats = {}
        for (const [path, statValue] of Object.entries(namespaceValue)) {
            if (isFileUsageStat(statValue)) {
                namespaceStats[path] = {
                    count: statValue.count,
                    lastUsed: statValue.lastUsed,
                }
            }
        }
        allStats[namespace] = namespaceStats
    }
    return allStats
}

function toFileSearchTreeMatch(treeMatch: OpenADEProjectFilesFuzzySearchResult["treeMatch"]): SmartEditorFileSearchResult["treeMatch"] {
    if (!treeMatch) return null
    return {
        path: treeMatch.path,
        children: treeMatch.children.map((child) => ({
            name: child.name,
            isDir: child.isDir,
            fullPath: child.fullPath,
        })),
    }
}

export class RemoteSmartEditorManager implements SmartEditorManagerContract {
    readonly id: string
    readonly workspaceId: string

    value = ""
    files: string[] = []
    editorContent: Record<string, unknown> | null = null
    pendingImages: ImageAttachment[] = []
    private readonly pendingImageDataUrls = new Map<string, string>()
    private statsVersion = 0
    private onInsertFile: ((path: string) => void) | null = null
    private onClear: (() => void) | null = null
    private onSetContent: ((content: string | Record<string, unknown> | null) => void) | null = null
    private readonly productSearchesInFlight = new Map<string, Promise<OpenADEProjectFilesFuzzySearchResult | null>>()

    constructor(
        id: string,
        workspaceId: string,
        private readonly fileAccess: RemoteSmartEditorFileAccess
    ) {
        this.id = id
        this.workspaceId = workspaceId
        makeAutoObservable(this)
    }

    setValue(value: string): void {
        this.value = value
    }

    setFiles(files: string[]): void {
        this.files = files
    }

    setEditorContent(content: Record<string, unknown> | null): void {
        this.editorContent = content
    }

    setTextContent(text: string): void {
        this.value = text
        this.onSetContent?.(text)
    }

    clear(): void {
        this.value = ""
        this.files = []
        this.editorContent = null
        for (const url of this.pendingImageDataUrls.values()) {
            URL.revokeObjectURL(url)
        }
        this.pendingImages = []
        this.pendingImageDataUrls.clear()
        this.onClear?.()
    }

    addImage(image: ImageAttachment, dataUrl: string): void {
        this.pendingImages.push(image)
        this.pendingImageDataUrls.set(image.id, dataUrl)
    }

    insertFile(path: string): void {
        this.trackFileUsage(path)
        this.onInsertFile?.(path)
    }

    canSearchFileMentions(dir: string): boolean {
        return this.fileAccess.getContext(dir) !== null
    }

    getFileMentionFavorites(limit = 20): string[] {
        return this.getFavoritePaths().slice(0, limit)
    }

    async searchFileMentions(dir: string, query: string, limit = 20): Promise<SmartEditorFileSearchResult> {
        const normalizedQuery = query.trim()
        if (normalizedQuery === "") {
            return {
                results: this.getFileMentionFavorites(limit),
                treeMatch: null,
            }
        }

        const context = this.fileAccess.getContext(dir)
        if (!context) return { results: [], treeMatch: null }

        const result = await this.searchProductFiles({
            repoId: context.repoId,
            taskId: context.taskId,
            query: normalizedQuery,
            matchDirs: false,
            limit,
            includeHidden: true,
        })
        if (!result) return { results: [], treeMatch: null }
        return {
            results: result.results,
            treeMatch: toFileSearchTreeMatch(result.treeMatch),
        }
    }

    registerInsertCallback(cb: (path: string) => void): void {
        this.onInsertFile = cb
    }

    unregisterInsertCallback(): void {
        this.onInsertFile = null
    }

    registerClearCallback(cb: () => void): void {
        this.onClear = cb
    }

    unregisterClearCallback(): void {
        this.onClear = null
    }

    registerSetContentCallback(cb: (content: string | Record<string, unknown> | null) => void): void {
        this.onSetContent = cb
    }

    unregisterSetContentCallback(): void {
        this.onSetContent = null
    }

    private searchProductFiles(args: OpenADEProjectFilesFuzzySearchRequest): Promise<OpenADEProjectFilesFuzzySearchResult | null> {
        const key = JSON.stringify({
            repoId: args.repoId,
            taskId: args.taskId ?? null,
            query: args.query,
            matchDirs: args.matchDirs,
            limit: args.limit,
            includeHidden: args.includeHidden,
        })
        const existing = this.productSearchesInFlight.get(key)
        if (existing) return existing

        const promise = this.fileAccess.fuzzySearchProjectFiles(args).finally(() => {
            if (this.productSearchesInFlight.get(key) === promise) {
                this.productSearchesInFlight.delete(key)
            }
        })
        this.productSearchesInFlight.set(key, promise)
        return promise
    }

    private getAllFileUsageStats(): AllStats {
        try {
            const data = localStorage.getItem(FILE_USAGE_STATS_KEY)
            if (!data) return {}
            const parsed: unknown = JSON.parse(data)
            return parseAllStats(parsed)
        } catch {
            return {}
        }
    }

    private getFileUsageStats(): NamespaceStats {
        void this.statsVersion
        const all = this.getAllFileUsageStats()
        return all[this.workspaceId] ?? {}
    }

    private trackFileUsage(filePath: string): void {
        const all = this.getAllFileUsageStats()
        const namespaceStats = all[this.workspaceId] ?? {}
        const existing = namespaceStats[filePath]
        namespaceStats[filePath] = {
            count: (existing?.count ?? 0) + 1,
            lastUsed: Date.now(),
        }

        const entries = Object.entries(namespaceStats)
        if (entries.length > MAX_STORED_FILES) {
            entries.sort((a, b) => b[1].lastUsed - a[1].lastUsed)
            all[this.workspaceId] = Object.fromEntries(entries.slice(0, MAX_STORED_FILES))
        } else {
            all[this.workspaceId] = namespaceStats
        }

        localStorage.setItem(FILE_USAGE_STATS_KEY, JSON.stringify(all))
        this.statsVersion++
    }

    private getFavoritePaths(): string[] {
        const stats = this.getFileUsageStats()
        const now = Date.now()
        const entries = Object.entries(stats)
        entries.sort((a, b) => frecencyScore(b[1], now) - frecencyScore(a[1], now))
        return entries.slice(0, MAX_FAVORITES).map(([path]) => path)
    }
}

export class RemoteSdkCapabilitiesManager implements SmartEditorSdkCapabilitiesContract {
    slashCommands: string[] = []
    skills: string[] = []
    plugins: OpenADESdkCapabilities["plugins"] = []
    loading = false
    loaded = false
    loadedForCwd: string | null = null
    private loadingForCwd: string | null = null
    private loadRequestId = 0

    constructor(private readonly loadSdkCapabilities: RemoteSdkCapabilitiesLoader) {
        makeAutoObservable<RemoteSdkCapabilitiesManager, "loadingForCwd" | "loadRequestId">(this, {
            loadingForCwd: false,
            loadRequestId: false,
        })
    }

    async loadCapabilities(cwd: string): Promise<void> {
        if (this.loadedForCwd === cwd) return
        if (this.loading && this.loadingForCwd === cwd) return

        const requestId = this.loadRequestId + 1
        runInAction(() => {
            this.loadRequestId = requestId
            this.loading = true
            this.loadingForCwd = cwd
        })

        try {
            const result = await this.loadSdkCapabilities(cwd)
            runInAction(() => {
                if (this.loadRequestId !== requestId) return
                if (result) this.applyCapabilities(result)
                this.loadedForCwd = cwd
            })
        } catch (err) {
            console.error("[RemoteSdkCapabilitiesManager] Failed to load capabilities:", err)
        } finally {
            runInAction(() => {
                if (this.loadRequestId !== requestId) return
                this.loading = false
                this.loaded = true
                this.loadingForCwd = null
            })
        }
    }

    get allCommands(): SlashCommandEntry[] {
        const entries: SlashCommandEntry[] = []
        for (const name of this.skills) {
            entries.push({ name, type: "skill" })
        }
        for (const name of this.slashCommands) {
            if (!this.skills.includes(name)) {
                entries.push({ name, type: "slash_command" })
            }
        }
        return entries
    }

    private applyCapabilities(data: OpenADESdkCapabilities): void {
        this.slashCommands = data.slash_commands
        this.skills = data.skills
        this.plugins = data.plugins
    }
}
