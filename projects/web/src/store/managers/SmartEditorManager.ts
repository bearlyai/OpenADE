/**
 * SmartEditorManager
 *
 * Manages state for SmartEditor instances:
 * - Input value and mentioned files
 * - File search for @mentions
 * - Favorites/recents tracking (persisted to localStorage)
 * - File insertion callbacks for external UI
 *
 * Managers are retrieved by ID and workspaceId via SmartEditorManagerStore.
 */

import { makeAutoObservable, observable, runInAction } from "mobx"
import { ulid } from "ulid"
import type {
    OpenADEProjectFilesFuzzySearchRequest,
    OpenADEProjectFilesFuzzySearchResult,
    OpenADETaskImageStagedReadRequest,
    OpenADETaskImageStagedReadResult,
} from "../../../../openade-module/src"
import { dataFolderApi } from "../../electronAPI/dataFolder"
import { filesApi } from "../../electronAPI/files"
import type { ImageAttachment } from "../../types"

// ============================================================================
// Types
// ============================================================================

export interface FileUsageItem {
    path: string
    fileName: string
    parentDir?: string
}

export interface EditorSnapshot {
    value: string
    files: string[]
    editorContent: Record<string, unknown> | null
    pendingImages: ImageAttachment[]
    pendingImageDataUrls: Map<string, string>
}

export interface StashedDraft {
    id: string
    createdAt: string
    snapshot: EditorSnapshot
}

interface PersistedEditorSnapshot {
    value: string
    files: string[]
    editorContent: Record<string, unknown> | null
    pendingImages: ImageAttachment[]
}

interface PersistedStashedDraft {
    id: string
    createdAt: string
    snapshot: PersistedEditorSnapshot
}

interface FileUsageStat {
    count: number
    lastUsed: number
}

type NamespaceStats = Record<string, FileUsageStat>
type AllStats = Record<string, NamespaceStats>

export interface SmartEditorFileTreeChild {
    name: string
    isDir: boolean
    fullPath: string
}

export interface SmartEditorFileTreeMatch {
    path: string
    children: SmartEditorFileTreeChild[]
}

export interface SmartEditorFileSearchResult {
    results: string[]
    treeMatch: SmartEditorFileTreeMatch | null
}

interface SmartEditorProductFileContext {
    repoId: string
    taskId?: string
}

export interface SmartEditorProductFileAccess {
    getContext(id: string, workspaceId: string, dir: string): SmartEditorProductFileContext | null
    fuzzySearchProjectFiles(args: OpenADEProjectFilesFuzzySearchRequest): Promise<OpenADEProjectFilesFuzzySearchResult>
    readStagedTaskImage?(args: OpenADETaskImageStagedReadRequest): Promise<OpenADETaskImageStagedReadResult | null>
}

// ============================================================================
// Constants
// ============================================================================

const FILE_USAGE_STATS_KEY = "code:fileUsageStats"
const MAX_STORED_FILES = 50
const MAX_FAVORITES = 5

/** Half-life for frecency decay: after this duration, a file's score halves. */
const FRECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function frecencyScore(stat: FileUsageStat, now: number): number {
    const ageMs = Math.max(0, now - stat.lastUsed)
    const decay = 2 ** (-ageMs / FRECENCY_HALF_LIFE_MS)
    return stat.count * decay
}

function cloneEditorContent(content: Record<string, unknown> | null): Record<string, unknown> | null {
    if (content === null) return null
    return JSON.parse(JSON.stringify(content)) as Record<string, unknown>
}

function clonePendingImages(images: ImageAttachment[]): ImageAttachment[] {
    return images.map((image) => ({ ...image }))
}

function normalizeMentionPath(path: string): string {
    return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/+$/, "")
}

function toFileSearchTreeMatch(treeMatch: OpenADEProjectFilesFuzzySearchResult["treeMatch"]): SmartEditorFileTreeMatch | null {
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

function decodeBase64ArrayBuffer(value: string): ArrayBuffer {
    const binary = globalThis.atob(value)
    const arrayBuffer = new ArrayBuffer(binary.length)
    const bytes = new Uint8Array(arrayBuffer)
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index)
    }
    return arrayBuffer
}

async function loadImagePreviewUrl(image: ImageAttachment, productAccess: SmartEditorProductFileAccess | null): Promise<string | null> {
    if (productAccess?.readStagedTaskImage) {
        try {
            const result = await productAccess.readStagedTaskImage({ imageId: image.id, ext: image.ext })
            if (result?.data) {
                const blob = new Blob([decodeBase64ArrayBuffer(result.data)], { type: result.mediaType ?? image.mediaType })
                return URL.createObjectURL(blob)
            }
        } catch (err) {
            console.error("[SmartEditorManager] Failed to restore runtime image preview:", image.id, err)
        }
    }

    if (!dataFolderApi.isAvailable()) return null

    try {
        const data = await dataFolderApi.load("images", image.id, image.ext)
        if (!data) return null
        const blob = new Blob([data], { type: image.mediaType })
        return URL.createObjectURL(blob)
    } catch (err) {
        console.error("[SmartEditorManager] Failed to restore image preview:", image.id, err)
        return null
    }
}

// ============================================================================
// SmartEditorManager
// ============================================================================

export class SmartEditorManager {
    readonly id: string
    readonly workspaceId: string

    value = ""
    files: string[] = [] // Currently mentioned files in editor
    // TipTap JSON content - source of truth for editor state
    editorContent: Record<string, unknown> | null = null
    // Pending image attachments (not yet submitted)
    pendingImages: ImageAttachment[] = []
    // In-memory data URLs for previewing pending images (keyed by image ID)
    pendingImageDataUrls: Map<string, string> = observable.map()
    stashedDrafts: StashedDraft[] = []

    // Bumped after localStorage mutations to invalidate MobX computed getters
    private _statsVersion = 0

    // Callbacks registered by SmartEditor
    private onInsertFile: ((path: string) => void) | null = null
    private onClear: (() => void) | null = null
    private onSetContent: ((content: string | Record<string, unknown> | null) => void) | null = null
    private productSearchesInFlight = new Map<string, Promise<OpenADEProjectFilesFuzzySearchResult | null>>()

    constructor(
        id: string,
        workspaceId: string,
        private readonly productAccess: SmartEditorProductFileAccess | null = null
    ) {
        this.id = id
        this.workspaceId = workspaceId
        makeAutoObservable(this)
        void this.loadPersistedStashes()
    }

    // === Input state ===

    setValue(value: string): void {
        this.value = value
    }

    setFiles(files: string[]): void {
        this.files = files
    }

    setEditorContent(content: Record<string, unknown> | null): void {
        this.editorContent = content
    }

    get hasDraftableContent(): boolean {
        return this.value.trim().length > 0 || this.pendingImages.length > 0
    }

    clear(options?: { revokeImagePreviews?: boolean }): void {
        const revokeImagePreviews = options?.revokeImagePreviews ?? true
        this.value = ""
        this.files = []
        this.editorContent = null
        if (revokeImagePreviews) {
            for (const url of this.pendingImageDataUrls.values()) {
                URL.revokeObjectURL(url)
            }
        }
        this.pendingImages = []
        this.pendingImageDataUrls.clear()
        if (this.onClear) {
            this.onClear()
        }
    }

    captureSnapshot(): EditorSnapshot {
        return {
            value: this.value,
            files: [...this.files],
            editorContent: cloneEditorContent(this.editorContent),
            pendingImages: clonePendingImages(this.pendingImages),
            pendingImageDataUrls: new Map(this.pendingImageDataUrls),
        }
    }

    restoreSnapshot(snapshot: EditorSnapshot): void {
        this.value = snapshot.value
        this.files = [...snapshot.files]
        this.editorContent = cloneEditorContent(snapshot.editorContent)
        this.pendingImages = clonePendingImages(snapshot.pendingImages)
        this.pendingImageDataUrls.clear()
        for (const [id, dataUrl] of snapshot.pendingImageDataUrls.entries()) {
            this.pendingImageDataUrls.set(id, dataUrl)
        }
        this.onSetContent?.(this.editorContent)
    }

    stashCurrentDraft(): StashedDraft | null {
        if (!this.hasDraftableContent) return null

        const draft = this.createDraft(this.captureSnapshot())
        this.stashedDrafts.unshift(draft)
        this.persistStashedDrafts()
        this.clear({ revokeImagePreviews: false })
        return draft
    }

    popStash(stashId?: string): boolean {
        const nextDraft = stashId ? this.stashedDrafts.find((draft) => draft.id === stashId) : this.stashedDrafts[0]
        if (!nextDraft) return false

        this.stashedDrafts = this.stashedDrafts.filter((draft) => draft.id !== nextDraft.id)
        if (this.hasDraftableContent) {
            this.stashedDrafts.unshift(this.createDraft(this.captureSnapshot()))
        }

        this.persistStashedDrafts()
        this.restoreSnapshot(nextDraft.snapshot)
        return true
    }

    deleteStash(stashId: string): void {
        const draft = this.stashedDrafts.find((item) => item.id === stashId)
        if (!draft) return

        for (const url of draft.snapshot.pendingImageDataUrls.values()) {
            URL.revokeObjectURL(url)
        }
        this.stashedDrafts = this.stashedDrafts.filter((item) => item.id !== stashId)
        this.persistStashedDrafts()
    }

    addImage(image: ImageAttachment, dataUrl: string): void {
        this.pendingImages.push(image)
        this.pendingImageDataUrls.set(image.id, dataUrl)
    }

    removeImage(id: string): void {
        const url = this.pendingImageDataUrls.get(id)
        if (url) URL.revokeObjectURL(url)
        this.pendingImages = this.pendingImages.filter((img) => img.id !== id)
        this.pendingImageDataUrls.delete(id)
    }

    // === Editor callbacks (registered by SmartEditor) ===

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

    /** Programmatically set the editor text content (replaces everything) */
    setTextContent(text: string): void {
        this.value = text
        if (this.onSetContent) {
            this.onSetContent(text)
        }
    }

    /** Insert file into editor and track usage - called by custom renderers */
    insertFile(path: string): void {
        this.trackFileUsage(path)
        this.onInsertFile?.(path)
    }

    // === File search ===

    canSearchFileMentions(dir: string): boolean {
        return this.productContextFor(dir) !== null || filesApi.isAvailable()
    }

    async warmFileMentionSearch(dir: string): Promise<void> {
        if (this.productContextFor(dir)) return
        await this.searchFileMentions(dir, "", 20)
    }

    async searchFileMentions(dir: string, query: string, limit = 20): Promise<SmartEditorFileSearchResult> {
        const productContext = this.productContextFor(dir)
        if (productContext) {
            const result = await this.searchProductFiles({
                repoId: productContext.repoId,
                taskId: productContext.taskId,
                query,
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

        if (!filesApi.isAvailable()) {
            throw new Error("Files API is not available")
        }

        const result = await filesApi.fuzzySearch({
            dir,
            query,
            matchDirs: false,
            limit,
        })
        return {
            results: result.results,
            treeMatch: result.treeMatch
                ? {
                      path: result.treeMatch.path,
                      children: result.treeMatch.children.map((child) => ({
                          name: child.name,
                          isDir: child.isDir,
                          fullPath: child.fullPath,
                      })),
                  }
                : null,
        }
    }

    // === Favorites (computed from localStorage, scoped to workspaceId, ranked by frecency) ===

    get favorites(): FileUsageItem[] {
        const paths = this.getFavoritePaths()
        return this.pathsToItems(paths)
    }

    /**
     * Validate that tracked files still exist on disk.
     * Removes stale entries from localStorage and bumps version to trigger re-render.
     */
    async validateFiles(dir: string): Promise<void> {
        const stats = this.getFileUsageStats()
        const paths = Object.keys(stats)
        if (paths.length === 0) return

        const results = await Promise.all(
            paths.map(async (relPath) => {
                try {
                    const productContext = this.productContextFor(dir)
                    if (productContext) {
                        return { relPath, exists: await this.productFileExists(productContext, relPath) }
                    }

                    const fullPath = `${dir}/${relPath}`
                    const desc = await filesApi.describePath({ path: fullPath })
                    return { relPath, exists: desc.type !== "not_found" }
                } catch {
                    // If the check fails, keep the entry (don't prune on error)
                    return { relPath, exists: true }
                }
            })
        )

        const stalePaths = results.filter((r) => !r.exists).map((r) => r.relPath)
        if (stalePaths.length === 0) return

        const all = this.getAllFileUsageStats()
        const ns = all[this.workspaceId]
        if (!ns) return

        for (const p of stalePaths) {
            delete ns[p]
        }
        localStorage.setItem(FILE_USAGE_STATS_KEY, JSON.stringify(all))
        this._statsVersion++
    }

    private productContextFor(dir: string): SmartEditorProductFileContext | null {
        return this.productAccess?.getContext(this.id, this.workspaceId, dir) ?? null
    }

    private async productFileExists(context: SmartEditorProductFileContext, relPath: string): Promise<boolean> {
        const normalizedPath = normalizeMentionPath(relPath)
        const result = await this.searchProductFiles({
            repoId: context.repoId,
            taskId: context.taskId,
            query: normalizedPath,
            matchDirs: false,
            limit: 5,
            includeHidden: true,
        })
        return result?.results.some((path) => normalizeMentionPath(path) === normalizedPath) ?? true
    }

    private searchProductFiles(args: OpenADEProjectFilesFuzzySearchRequest): Promise<OpenADEProjectFilesFuzzySearchResult | null> {
        if (!this.productAccess) return Promise.resolve(null)
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

        const promise = this.productAccess
            .fuzzySearchProjectFiles(args)
            .catch((error: unknown) => {
                throw error
            })
            .finally(() => {
                if (this.productSearchesInFlight.get(key) === promise) {
                    this.productSearchesInFlight.delete(key)
                }
            })
        this.productSearchesInFlight.set(key, promise)
        return promise
    }

    // === Private: localStorage operations (uses workspaceId as namespace) ===

    private getAllFileUsageStats(): AllStats {
        try {
            const data = localStorage.getItem(FILE_USAGE_STATS_KEY)
            if (!data) return {}
            const parsed = JSON.parse(data)
            if (typeof parsed !== "object" || parsed === null) return {}
            return parsed as AllStats
        } catch {
            return {}
        }
    }

    private getFileUsageStats(): NamespaceStats {
        // Reference _statsVersion so MobX tracks this dependency
        void this._statsVersion
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
            const trimmed = entries.slice(0, MAX_STORED_FILES)
            all[this.workspaceId] = Object.fromEntries(trimmed)
        } else {
            all[this.workspaceId] = namespaceStats
        }

        localStorage.setItem(FILE_USAGE_STATS_KEY, JSON.stringify(all))
        this._statsVersion++
    }

    private getFavoritePaths(): string[] {
        const stats = this.getFileUsageStats()
        const now = Date.now()
        const entries = Object.entries(stats)
        entries.sort((a, b) => frecencyScore(b[1], now) - frecencyScore(a[1], now))
        return entries.slice(0, MAX_FAVORITES).map(([path]) => path)
    }

    private createDraft(snapshot: EditorSnapshot): StashedDraft {
        return {
            id: ulid(),
            createdAt: new Date().toISOString(),
            snapshot,
        }
    }

    private async loadPersistedStashes(): Promise<void> {
        const persistedDrafts = this.getPersistedStashedDrafts()
        if (persistedDrafts.length === 0) return

        const drafts = await Promise.all(
            persistedDrafts.map(async (draft) => ({
                id: draft.id,
                createdAt: draft.createdAt,
                snapshot: {
                    value: draft.snapshot.value,
                    files: [...draft.snapshot.files],
                    editorContent: cloneEditorContent(draft.snapshot.editorContent),
                    pendingImages: clonePendingImages(draft.snapshot.pendingImages),
                    pendingImageDataUrls: await this.createPreviewUrlMap(draft.snapshot.pendingImages),
                },
            }))
        )

        runInAction(() => {
            this.stashedDrafts = drafts
        })
    }

    private getPersistedStashedDrafts(): PersistedStashedDraft[] {
        try {
            const data = localStorage.getItem(this.getStashedDraftsKey())
            if (!data) return []
            const parsed = JSON.parse(data)
            if (!Array.isArray(parsed)) return []
            return parsed as PersistedStashedDraft[]
        } catch {
            return []
        }
    }

    private persistStashedDrafts(): void {
        if (this.stashedDrafts.length === 0) {
            localStorage.removeItem(this.getStashedDraftsKey())
            return
        }

        const serialized: PersistedStashedDraft[] = this.stashedDrafts.map((draft) => ({
            id: draft.id,
            createdAt: draft.createdAt,
            snapshot: {
                value: draft.snapshot.value,
                files: [...draft.snapshot.files],
                editorContent: cloneEditorContent(draft.snapshot.editorContent),
                pendingImages: clonePendingImages(draft.snapshot.pendingImages),
            },
        }))

        localStorage.setItem(this.getStashedDraftsKey(), JSON.stringify(serialized))
    }

    private getStashedDraftsKey(): string {
        return `code:stashedDrafts:${this.workspaceId}:${this.id}`
    }

    private async createPreviewUrlMap(images: ImageAttachment[]): Promise<Map<string, string>> {
        const entries = await Promise.all(
            images.map(async (image) => {
                const url = await loadImagePreviewUrl(image, this.productAccess)
                return url ? ([image.id, url] as const) : null
            })
        )

        return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null))
    }

    private pathsToItems(paths: string[]): FileUsageItem[] {
        return paths.map((path) => {
            const { fileName, parentDir } = this.getDisplayName(path, paths)
            return { path, fileName, parentDir }
        })
    }

    private getDisplayName(filePath: string, allPaths: string[]): { fileName: string; parentDir?: string } {
        const parts = filePath.split("/")
        const fileName = parts.pop() || filePath
        const parentDir = parts.length > 0 ? parts[parts.length - 1] : undefined

        const fileNameCount = allPaths.filter((p) => {
            const name = p.split("/").pop()
            return name === fileName
        }).length

        if (fileNameCount > 1 && parentDir) {
            return { fileName, parentDir }
        }
        return { fileName }
    }
}

// ============================================================================
// SmartEditorManagerStore
// ============================================================================

export class SmartEditorManagerStore {
    private managers = new Map<string, SmartEditorManager>()

    constructor(private readonly productAccess: SmartEditorProductFileAccess | null = null) {
        makeAutoObservable(this)
    }

    getManager(id: string, workspaceId: string): SmartEditorManager {
        const key = `${workspaceId}:${id}`
        const existing = this.managers.get(key)
        if (existing) return existing

        const manager = new SmartEditorManager(id, workspaceId, this.productAccess)
        this.managers.set(key, manager)
        return manager
    }

    disposeManager(id: string, workspaceId: string): void {
        const key = `${workspaceId}:${id}`
        this.managers.delete(key)
    }
}
