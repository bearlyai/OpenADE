import { makeAutoObservable, runInAction } from "mobx"
import { getFileName, getRelativePath, splitPath } from "../../components/utils/paths"
import { type DescribePathResponse, type PathEntry, filesApi } from "../../electronAPI/files"
import { getPathSeparator } from "../../electronAPI/platform"

const MAX_FILE_READ_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_OPEN_TABS = 8

// Infrastructure directories to always hide in tree view (not searchable either via gitignore)
const HIDDEN_INFRA_DIRS = new Set([".git"])

export interface TreeNode {
    path: string
    name: string
    isDir: boolean
    depth: number
    isExpanded: boolean
    isLoading: boolean
}

export interface OpenTab {
    path: string
    name: string
}

export class FileBrowserManager {
    // Navigation state
    workingDir = ""

    // Tree state - expanded directories and their cached contents
    expandedPaths: Set<string> = new Set()
    directoryContents: Map<string, PathEntry[]> = new Map()
    loadingPaths: Set<string> = new Set()

    // Sidebar visibility
    sidebarOpen = false

    // Search state
    searchQuery = ""
    searchResults: string[] = []
    searchLoading = false

    // Open tabs (LRU - most recent at end)
    openTabs: OpenTab[] = []

    // Currently active file
    activeFile: string | null = null
    activeFileData: Extract<DescribePathResponse, { type: "file" }> | null = null
    fileLoading = false
    fileError: string | null = null

    // Selection in tree
    selectedPath: string | null = null

    // Settings
    showHidden = true // Show dotfiles like .env, .gitignore by default

    private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

    constructor() {
        makeAutoObservable(this)
    }

    setWorkingDir(path: string): void {
        if (this.workingDir !== path) {
            this.workingDir = path
            this.expandedPaths.clear()
            this.directoryContents.clear()
            this.loadingPaths.clear()
            this.searchQuery = ""
            this.openTabs = []
            this.activeFile = null
            this.activeFileData = null
            // Auto-expand root
            this.expandedPaths.add(path)
            this.loadDirectoryContents(path)
        }
    }

    toggleSidebar(): void {
        this.sidebarOpen = !this.sidebarOpen
    }

    setSidebarOpen(open: boolean): void {
        this.sidebarOpen = open
    }

    async loadDirectoryContents(dirPath: string): Promise<void> {
        if (this.loadingPaths.has(dirPath)) return
        if (this.directoryContents.has(dirPath)) return

        this.loadingPaths.add(dirPath)

        try {
            // Always request hidden files, we filter infra dirs (like .git) on frontend
            // The showHidden toggle controls whether user sees dotfiles like .env
            const result = await filesApi.describePath({
                path: dirPath,
                showHidden: true,
            })
            runInAction(() => {
                if (result.type === "dir") {
                    // Filter out infrastructure directories (always hidden)
                    // and dotfiles if showHidden is false
                    const filtered = result.entries.filter((e) => {
                        // Always hide infra dirs like .git
                        if (e.isDir && HIDDEN_INFRA_DIRS.has(e.name)) return false
                        // Hide dotfiles unless showHidden is true
                        if (!this.showHidden && e.name.startsWith(".")) return false
                        return true
                    })
                    this.directoryContents.set(dirPath, filtered)
                }
                this.loadingPaths.delete(dirPath)
            })
        } catch {
            runInAction(() => {
                this.loadingPaths.delete(dirPath)
            })
        }
    }

    toggleExpanded(dirPath: string): void {
        if (this.expandedPaths.has(dirPath)) {
            this.expandedPaths.delete(dirPath)
        } else {
            this.expandedPaths.add(dirPath)
            // Load contents if not cached
            if (!this.directoryContents.has(dirPath)) {
                this.loadDirectoryContents(dirPath)
            }
        }
    }

    collapseAll(): void {
        // Keep only the root expanded
        this.expandedPaths.clear()
        if (this.workingDir) {
            this.expandedPaths.add(this.workingDir)
        }
    }

    expandPathToFile(filePath: string): void {
        if (!this.workingDir) return

        // Get all parent directories from repo root to the file
        const relativePath = getRelativePath(this.workingDir, filePath)
        const parts = splitPath(relativePath)

        // Expand each parent directory (excluding the file itself)
        let currentPath = this.workingDir
        this.expandedPaths.add(currentPath)
        const sep = getPathSeparator()
        for (let i = 0; i < parts.length - 1; i++) {
            currentPath = `${currentPath}${sep}${parts[i]}`
            this.expandedPaths.add(currentPath)
            // Load contents if not cached
            if (!this.directoryContents.has(currentPath)) {
                this.loadDirectoryContents(currentPath)
            }
        }
    }

    setSearchQuery(query: string): void {
        this.searchQuery = query
        if (query) {
            this.performSearch(query)
        } else {
            this.searchResults = []
        }
    }

    private performSearch(query: string): void {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer)
        }

        this.searchDebounceTimer = setTimeout(async () => {
            runInAction(() => {
                this.searchLoading = true
            })
            try {
                const result = await filesApi.fuzzySearch({
                    dir: this.workingDir,
                    query,
                    matchDirs: false,
                    limit: 50,
                })
                runInAction(() => {
                    // Filter out paths inside infra dirs like .git/
                    this.searchResults = result.results.filter((path) => {
                        const firstSegment = splitPath(path)[0]
                        return !HIDDEN_INFRA_DIRS.has(firstSegment)
                    })
                    this.searchLoading = false
                })
            } catch {
                runInAction(() => {
                    this.searchResults = []
                    this.searchLoading = false
                })
            }
        }, 150)
    }

    async openFile(absolutePath: string): Promise<void> {
        // If opening from search, clear search and expand tree to show the file
        if (this.searchQuery) {
            this.searchQuery = ""
            this.searchResults = []
            // Expand all parent directories to reveal the file
            this.expandPathToFile(absolutePath)
        }

        // Add to tabs (LRU)
        this.addToTabs(absolutePath)
        this.activeFile = absolutePath
        this.selectedPath = absolutePath
        this.fileLoading = true
        this.activeFileData = null
        this.fileError = null

        try {
            const result = await filesApi.describePath({
                path: absolutePath,
                readContents: true,
                maxReadSize: MAX_FILE_READ_SIZE,
            })
            runInAction(() => {
                if (result.type === "file") {
                    this.activeFileData = result
                    this.fileError = null
                } else if (result.type === "not_found") {
                    this.fileError = "File not found"
                } else if (result.type === "error") {
                    this.fileError = result.message
                } else {
                    this.fileError = "Not a file"
                }
                this.fileLoading = false
            })
        } catch (err) {
            runInAction(() => {
                this.fileError = err instanceof Error ? err.message : "Failed to load file"
                this.fileLoading = false
            })
        }
    }

    private addToTabs(path: string): void {
        const name = getFileName(path)

        // Remove if already exists (will re-add at end for LRU)
        const existingIndex = this.openTabs.findIndex((t) => t.path === path)
        if (existingIndex !== -1) {
            this.openTabs.splice(existingIndex, 1)
        }

        // Add to end
        this.openTabs.push({ path, name })

        // Trim to max size (remove oldest)
        while (this.openTabs.length > MAX_OPEN_TABS) {
            this.openTabs.shift()
        }
    }

    closeTab(path: string): void {
        const index = this.openTabs.findIndex((t) => t.path === path)
        if (index === -1) return

        this.openTabs.splice(index, 1)

        // If closing active file, switch to another tab or clear
        if (this.activeFile === path) {
            if (this.openTabs.length > 0) {
                // Switch to the tab that was next, or the last one
                const newIndex = Math.min(index, this.openTabs.length - 1)
                this.openFile(this.openTabs[newIndex].path)
            } else {
                this.activeFile = null
                this.activeFileData = null
                this.fileError = null
            }
        }
    }

    switchToTab(path: string): void {
        const tab = this.openTabs.find((t) => t.path === path)
        if (tab) {
            this.openFile(path)
        }
    }

    setShowHidden(show: boolean): void {
        this.showHidden = show
        // Clear cache and reload expanded directories
        this.directoryContents.clear()
        for (const path of this.expandedPaths) {
            this.loadDirectoryContents(path)
        }
    }

    selectPath(path: string): void {
        this.selectedPath = path
    }

    refreshTree(): void {
        console.debug("[FileBrowserManager] refreshTree called", { activeFile: this.activeFile, expandedPaths: [...this.expandedPaths] })
        this.directoryContents.clear()
        for (const dirPath of this.expandedPaths) {
            this.loadDirectoryContents(dirPath)
        }
        // Reload active file contents if one is open
        if (this.activeFile) {
            console.debug("[FileBrowserManager] refreshTree: reloading active file", this.activeFile)
            this.openFile(this.activeFile)
        }
    }

    get isSearching(): boolean {
        return this.searchQuery.length > 0
    }

    get flattenedTree(): TreeNode[] {
        if (!this.workingDir) return []

        const result: TreeNode[] = []

        const traverse = (dirPath: string, depth: number) => {
            const entries = this.directoryContents.get(dirPath) || []

            for (const entry of entries) {
                const isExpanded = this.expandedPaths.has(entry.path)
                const isLoading = this.loadingPaths.has(entry.path)

                result.push({
                    path: entry.path,
                    name: entry.name,
                    isDir: entry.isDir,
                    depth,
                    isExpanded,
                    isLoading,
                })

                // Recurse into expanded directories
                if (entry.isDir && isExpanded) {
                    traverse(entry.path, depth + 1)
                }
            }
        }

        // Start from root
        traverse(this.workingDir, 0)

        return result
    }

    get searchDisplayItems(): Array<{ name: string; fullPath: string }> {
        const sep = getPathSeparator()
        return this.searchResults.map((relativePath) => ({
            name: relativePath,
            fullPath: `${this.workingDir}${sep}${relativePath}`,
        }))
    }

    // Legacy getters for compatibility
    get viewingFile(): string | null {
        return this.activeFile
    }

    get viewingFileData(): Extract<DescribePathResponse, { type: "file" }> | null {
        return this.activeFileData
    }

    closeFile(): void {
        if (this.activeFile) {
            this.closeTab(this.activeFile)
        }
    }
}
