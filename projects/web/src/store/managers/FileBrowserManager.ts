import { makeAutoObservable, runInAction } from "mobx"
import type {
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesFuzzySearchRequest,
    OpenADEProjectFilesFuzzySearchResult,
    OpenADEProjectFilesTreeRequest,
    OpenADEProjectFilesTreeResult,
} from "../../../../openade-module/src"
import { getFileName, getRelativePath, splitPath } from "../../components/utils/paths"
import { type DescribePathResponse, type PathEntry, filesApi } from "../../electronAPI/files"
import { getPathSeparator } from "../../electronAPI/platform"

const MAX_FILE_READ_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_OPEN_TABS = 8
const FILE_REFERENCE_SEARCH_LIMIT = 12

// Infrastructure directories to always hide in tree view (not searchable either via gitignore)
const HIDDEN_INFRA_DIRS = new Set([".git"])

interface ProductFileBrowserContext {
    repoId: string
    taskId?: string
}

interface ProductFileBrowserAccess {
    getContext(workingDir: string): ProductFileBrowserContext | null
    listProjectFiles(args: OpenADEProjectFilesTreeRequest): Promise<OpenADEProjectFilesTreeResult>
    readProjectFile(args: { repoId: string; taskId?: string; path: string; maxBytes: number }): Promise<OpenADEProjectFileReadResult>
    fuzzySearchProjectFiles(args: OpenADEProjectFilesFuzzySearchRequest): Promise<OpenADEProjectFilesFuzzySearchResult>
}

function normalizePathForMatch(path: string): string {
    return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").toLowerCase()
}

function isAbsolutePath(path: string): boolean {
    return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path)
}

function normalizeFileReferenceInput(referencePath: string): string {
    const trimmed = referencePath.trim()
    return trimmed.startsWith("@") ? trimmed.slice(1).trimStart() : trimmed
}

function joinPath(basePath: string, relativePath: string): string {
    const sep = getPathSeparator()
    const base = basePath.endsWith(sep) && basePath.length > 1 ? basePath.slice(0, -1) : basePath
    return `${base}${sep}${splitPath(relativePath).join(sep)}`
}

function chooseBestFuzzyReferenceMatch(results: string[], query: string): string | null {
    if (results.length === 0) return null

    const normalizedQuery = normalizePathForMatch(query)
    const exact = results.find((result) => normalizePathForMatch(result) === normalizedQuery)
    if (exact) return exact

    const suffix = results.find((result) => normalizePathForMatch(result).endsWith(`/${normalizedQuery}`))
    if (suffix) return suffix

    return results[0] ?? null
}

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

    // Open tabs in stable display order
    openTabs: OpenTab[] = []

    // Currently active file
    activeFile: string | null = null
    activeFileData: Extract<DescribePathResponse, { type: "file" }> | null = null
    activeLine: number | null = null
    fileLoading = false
    fileError: string | null = null

    // Selection in tree
    selectedPath: string | null = null

    // Settings
    showHidden = true // Show dotfiles like .env, .gitignore by default

    private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

    constructor(private readonly productAccess: ProductFileBrowserAccess | null = null) {
        makeAutoObservable(this)
    }

    private get productContext(): ProductFileBrowserContext | null {
        return this.productAccess?.getContext(this.workingDir) ?? null
    }

    private get shouldUseLegacyFilesApi(): boolean {
        return this.productAccess === null
    }

    private relativePathForProduct(absolutePath: string): string | null {
        if (!this.workingDir) return null
        const relativePath = getRelativePath(this.workingDir, absolutePath)
        if (relativePath === absolutePath || isAbsolutePath(relativePath) || splitPath(relativePath).some((part) => part === "..")) return null
        return relativePath.replace(/\\/g, "/")
    }

    private absolutePathFromProduct(relativePath: string): string {
        if (!relativePath) return this.workingDir
        return joinPath(this.workingDir, relativePath)
    }

    private productEntryToPathEntry(entry: OpenADEProjectFilesTreeResult["entries"][number]): PathEntry {
        return {
            name: entry.name,
            path: this.absolutePathFromProduct(entry.path),
            isDir: entry.type === "directory",
            isSymlink: false,
            size: entry.size ?? 0,
            mode: 0,
        }
    }

    private productFileReadToDescribePath(path: string, result: OpenADEProjectFileReadResult): DescribePathResponse {
        return {
            type: "file",
            path,
            size: result.size,
            mode: 0,
            content: result.content,
            tooLarge: result.tooLarge,
            isReadable: result.isReadable ?? true,
            isBinary: result.isBinary,
            mediaType: result.mediaType,
            previewKind: result.previewKind,
        }
    }

    private async listDirectoryViaProduct(dirPath: string): Promise<DescribePathResponse | null> {
        const productAccess = this.productAccess
        const productContext = this.productContext
        const relativePath = this.relativePathForProduct(dirPath)
        if (!productAccess || !productContext || relativePath === null) return null

        const result = await productAccess.listProjectFiles({
            repoId: productContext.repoId,
            taskId: productContext.taskId,
            path: relativePath,
            maxDepth: 0,
            maxEntries: 1000,
            includeHidden: true,
            includeGenerated: true,
        })
        return {
            type: "dir",
            path: dirPath,
            mode: 0,
            entries: result.entries.map((entry) => this.productEntryToPathEntry(entry)),
        }
    }

    private async fuzzySearchViaProduct(params: { query: string; matchDirs: boolean; limit: number }): Promise<OpenADEProjectFilesFuzzySearchResult | null> {
        const productAccess = this.productAccess
        const productContext = this.productContext
        if (!productAccess || !productContext) return null

        return productAccess.fuzzySearchProjectFiles({
            repoId: productContext.repoId,
            taskId: productContext.taskId,
            query: params.query,
            matchDirs: params.matchDirs,
            limit: params.limit,
            includeHidden: true,
            includeGenerated: true,
        })
    }

    private async readFileViaProduct(absolutePath: string): Promise<DescribePathResponse | null> {
        const productAccess = this.productAccess
        const productContext = this.productContext
        const relativePath = this.relativePathForProduct(absolutePath)
        if (!productAccess || !productContext || relativePath === null) return null

        const result = await productAccess.readProjectFile({
            repoId: productContext.repoId,
            taskId: productContext.taskId,
            path: relativePath,
            maxBytes: MAX_FILE_READ_SIZE,
        })
        return this.productFileReadToDescribePath(absolutePath, result)
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
            this.activeLine = null
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
            const result =
                (await this.listDirectoryViaProduct(dirPath)) ??
                (this.shouldUseLegacyFilesApi
                    ? await filesApi.describePath({
                          path: dirPath,
                          showHidden: true,
                      })
                    : null)
            if (!result) {
                runInAction(() => {
                    this.loadingPaths.delete(dirPath)
                })
                return
            }
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

    private expandPath(absolutePath: string, includeSelf: boolean): void {
        if (!this.workingDir) return

        // Get all directories from repo root to the target path.
        const relativePath = getRelativePath(this.workingDir, absolutePath)
        const parts = splitPath(relativePath)
        const lastIndex = includeSelf ? parts.length : parts.length - 1

        let currentPath = this.workingDir
        this.expandedPaths.add(currentPath)
        if (!this.directoryContents.has(currentPath)) {
            this.loadDirectoryContents(currentPath)
        }
        const sep = getPathSeparator()
        for (let i = 0; i < lastIndex; i++) {
            currentPath = `${currentPath}${sep}${parts[i]}`
            this.expandedPaths.add(currentPath)
            if (!this.directoryContents.has(currentPath)) {
                this.loadDirectoryContents(currentPath)
            }
        }
    }

    expandPathToFile(filePath: string): void {
        this.expandPath(filePath, false)
    }

    expandPathToDirectory(dirPath: string): void {
        this.expandPath(dirPath, true)
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
                const result =
                    (await this.fuzzySearchViaProduct({
                        query,
                        matchDirs: false,
                        limit: 50,
                    })) ??
                    (this.shouldUseLegacyFilesApi
                        ? await filesApi.fuzzySearch({
                              dir: this.workingDir,
                              query,
                              matchDirs: false,
                              limit: 50,
                          })
                        : null)
                if (!result) {
                    runInAction(() => {
                        this.searchResults = []
                        this.searchLoading = false
                    })
                    return
                }
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

    private resolveFileReferencePath(referencePath: string): string | null {
        const trimmed = normalizeFileReferenceInput(referencePath)
        if (!trimmed) return null
        if (isAbsolutePath(trimmed)) return trimmed

        const parts = splitPath(trimmed).filter((part) => part !== ".")
        if (parts.length === 0 || parts.some((part) => part === "..")) return null
        if (!this.workingDir) return null

        return joinPath(this.workingDir, parts.join(getPathSeparator()))
    }

    private fileReferenceSearchQuery(referencePath: string): string {
        const trimmed = normalizeFileReferenceInput(referencePath)
        if (!trimmed) return ""
        if (isAbsolutePath(trimmed)) {
            const relative = getRelativePath(this.workingDir, trimmed)
            if (relative !== trimmed) return relative
            return getFileName(trimmed)
        }
        return trimmed
    }

    private async fileExists(path: string): Promise<boolean> {
        try {
            const result = await this.describePath(path)
            return result?.type === "file"
        } catch {
            return false
        }
    }

    private async findFuzzyPathReference(referencePath: string, matchDirs: boolean): Promise<string | null> {
        if (!this.workingDir) return null

        const query = this.fileReferenceSearchQuery(referencePath)
        if (!query) return null

        try {
            const result =
                (await this.fuzzySearchViaProduct({
                    query,
                    matchDirs,
                    limit: FILE_REFERENCE_SEARCH_LIMIT,
                })) ??
                (this.shouldUseLegacyFilesApi
                    ? await filesApi.fuzzySearch({
                          dir: this.workingDir,
                          query,
                          matchDirs,
                          limit: FILE_REFERENCE_SEARCH_LIMIT,
                      })
                    : null)
            if (!result) return null
            const match = chooseBestFuzzyReferenceMatch(result.results, query)
            return match ? joinPath(this.workingDir, match) : null
        } catch {
            return null
        }
    }

    private async describePath(path: string): Promise<DescribePathResponse | null> {
        const hasProductAccess = this.productAccess !== null
        const productFile = await this.readFileViaProduct(path).catch(() => null)
        if (productFile) return productFile

        const productDirectory = await this.listDirectoryViaProduct(path).catch(() => null)
        if (productDirectory) return productDirectory
        if (hasProductAccess) return null

        try {
            return await filesApi.describePath({ path })
        } catch {
            return null
        }
    }

    private async openResolvedPath(path: string, options: { line?: number | null } = {}): Promise<boolean> {
        const result = await this.describePath(path)
        if (result?.type === "file") {
            await this.openFile(path, options)
            return true
        }
        if (result?.type === "dir") {
            this.focusDirectory(path)
            return true
        }
        return false
    }

    async openFileReference(referencePath: string, options: { line?: number | null } = {}): Promise<void> {
        const exactPath = this.resolveFileReferencePath(referencePath)
        if (exactPath && (await this.fileExists(exactPath))) {
            await this.openFile(exactPath, options)
            return
        }

        const fuzzyPath = await this.findFuzzyPathReference(referencePath, false)
        if (fuzzyPath) {
            await this.openFile(fuzzyPath, options)
            return
        }

        if (exactPath) {
            await this.openFile(exactPath, options)
            return
        }

        this.setSearchQuery(this.fileReferenceSearchQuery(referencePath))
    }

    async openPathReference(referencePath: string, options: { line?: number | null } = {}): Promise<void> {
        const exactPath = this.resolveFileReferencePath(referencePath)
        if (exactPath && (await this.openResolvedPath(exactPath, options))) return

        const fuzzyFilePath = await this.findFuzzyPathReference(referencePath, false)
        if (fuzzyFilePath && (await this.openResolvedPath(fuzzyFilePath, options))) return

        const fuzzyDirPath = await this.findFuzzyPathReference(referencePath, true)
        if (fuzzyDirPath && (await this.openResolvedPath(fuzzyDirPath, options))) return

        if (exactPath && options.line) {
            await this.openFile(exactPath, options)
        }
    }

    async openFile(absolutePath: string, options: { line?: number | null } = {}): Promise<void> {
        const line = options.line
        this.activeLine = typeof line === "number" && Number.isInteger(line) && line > 0 ? line : null

        // If opening from search, clear search so the tree can show the file.
        if (this.searchQuery) {
            this.searchQuery = ""
            this.searchResults = []
        }

        // Expand all parent directories to reveal the file in the sidebar.
        this.expandPathToFile(absolutePath)

        // Add to tabs.
        this.addToTabs(absolutePath)
        this.activeFile = absolutePath
        this.selectedPath = absolutePath
        this.fileLoading = true
        this.activeFileData = null
        this.fileError = null

        try {
            const result =
                (await this.readFileViaProduct(absolutePath)) ??
                (this.shouldUseLegacyFilesApi
                    ? await filesApi.describePath({
                          path: absolutePath,
                          readContents: true,
                          maxReadSize: MAX_FILE_READ_SIZE,
                      })
                    : null)
            if (!result) {
                runInAction(() => {
                    if (this.activeFile !== absolutePath) return
                    this.fileError = "File not found"
                    this.fileLoading = false
                })
                return
            }
            runInAction(() => {
                if (this.activeFile !== absolutePath) return
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
                if (this.activeFile !== absolutePath) return
                this.fileError = err instanceof Error ? err.message : "Failed to load file"
                this.fileLoading = false
            })
        }
    }

    focusDirectory(absolutePath: string): void {
        if (this.searchQuery) {
            this.searchQuery = ""
            this.searchResults = []
        }
        this.activeLine = null
        this.expandPathToDirectory(absolutePath)
        this.selectedPath = absolutePath
    }

    private addToTabs(path: string): void {
        const name = getFileName(path)

        if (this.openTabs.some((t) => t.path === path)) return

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
                this.activeLine = null
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
            this.openFile(this.activeFile, { line: this.activeLine })
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

    closeFile(): void {
        if (this.activeFile) {
            this.closeTab(this.activeFile)
        }
    }
}
