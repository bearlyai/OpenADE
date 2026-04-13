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

import { makeAutoObservable, observable } from "mobx"
import { ulid } from "ulid"
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

interface FileUsageStat {
    count: number
    lastUsed: number
}

type NamespaceStats = Record<string, FileUsageStat>
type AllStats = Record<string, NamespaceStats>

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

    constructor(id: string, workspaceId: string) {
        this.id = id
        this.workspaceId = workspaceId
        makeAutoObservable(this)
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

    constructor() {
        makeAutoObservable(this)
    }

    getManager(id: string, workspaceId: string): SmartEditorManager {
        const key = `${workspaceId}:${id}`
        const existing = this.managers.get(key)
        if (existing) return existing

        const manager = new SmartEditorManager(id, workspaceId)
        this.managers.set(key, manager)
        return manager
    }

    disposeManager(id: string, workspaceId: string): void {
        const key = `${workspaceId}:${id}`
        this.managers.delete(key)
    }
}
