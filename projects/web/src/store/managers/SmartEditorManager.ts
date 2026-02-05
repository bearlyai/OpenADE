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

import { makeAutoObservable } from "mobx"

// ============================================================================
// Types
// ============================================================================

export interface FileUsageItem {
    path: string
    fileName: string
    parentDir?: string
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
const MAX_RECENTS = 5

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

    // Callbacks registered by SmartEditor
    private onInsertFile: ((path: string) => void) | null = null
    private onClear: (() => void) | null = null
    private onSetContent: ((text: string) => void) | null = null

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

    clear(): void {
        this.value = ""
        this.files = []
        this.editorContent = null
        if (this.onClear) {
            this.onClear()
        } else {
        }
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

    registerSetContentCallback(cb: (text: string) => void): void {
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

    // === Favorites/Recents (computed from localStorage, scoped to workspaceId) ===

    get favorites(): FileUsageItem[] {
        const paths = this.getFavoritePaths()
        return this.pathsToItems(paths)
    }

    get recents(): FileUsageItem[] {
        const favoritePaths = this.getFavoritePaths()
        const paths = this.getRecentPaths(favoritePaths)
        return this.pathsToItems(paths)
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
    }

    private getFavoritePaths(): string[] {
        const stats = this.getFileUsageStats()
        const entries = Object.entries(stats)
        entries.sort((a, b) => b[1].count - a[1].count)
        return entries.slice(0, MAX_FAVORITES).map(([path]) => path)
    }

    private getRecentPaths(excludePaths: string[]): string[] {
        const stats = this.getFileUsageStats()
        const excludeSet = new Set(excludePaths)
        const entries = Object.entries(stats).filter(([path]) => !excludeSet.has(path))
        entries.sort((a, b) => b[1].lastUsed - a[1].lastUsed)
        return entries.slice(0, MAX_RECENTS).map(([path]) => path)
    }

    private pathsToItems(paths: string[]): FileUsageItem[] {
        const allPaths = [...this.getFavoritePaths(), ...this.getRecentPaths([])]
        return paths.map((path) => {
            const { fileName, parentDir } = this.getDisplayName(path, allPaths)
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
