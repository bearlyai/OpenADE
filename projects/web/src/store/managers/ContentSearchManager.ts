import { makeAutoObservable, runInAction } from "mobx"
import type { OpenADEProjectFileReadResult, OpenADEProjectSearchMatch, OpenADEProjectSearchResult } from "../../../../openade-module/src"
import { type DescribePathResponse, filesApi } from "../../electronAPI/files"

const MAX_FILE_READ_SIZE = 5 * 1024 * 1024 // 5MB
const CONTENT_RESULTS_LIMIT = 100 // Max content matches to show

interface ProductProjectSearchContext {
    repoId: string
    taskId?: string
}

interface ProductProjectSearchScope {
    workingDir: string
    productContext: ProductProjectSearchContext | null
    usesLegacyFilesApi: boolean
}

interface ProductProjectSearchAccess {
    ownsFiles?(): boolean
    getContext(workingDir: string): ProductProjectSearchContext | null
    searchProject(args: { repoId: string; taskId?: string; query: string; limit: number; caseSensitive: boolean }): Promise<OpenADEProjectSearchResult | null>
    readProjectFile(args: { repoId: string; taskId?: string; path: string; maxBytes: number }): Promise<OpenADEProjectFileReadResult | null>
}

/**
 * ContentSearchManager - Manages content search state (ripgrep)
 *
 * Handles:
 * - Search query input with debouncing
 * - Content search (ripgrep)
 * - Selection state for keyboard navigation
 * - File preview (independent of FileBrowserManager)
 */
export class ContentSearchManager {
    // Search state
    query = ""
    contentResults: OpenADEProjectSearchMatch[] = [] // Content matches
    loading = false
    contentTruncated = false
    error: string | null = null

    // Selection state for keyboard navigation
    selectedIndex = 0

    // Search directory (task working directory)
    workingDir = ""

    // File preview state (independent of FileBrowserManager)
    previewPath: string | null = null
    previewData: Extract<DescribePathResponse, { type: "file" }> | null = null
    previewLoading = false
    previewError: string | null = null

    private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
    private searchGeneration = 0
    private previewGeneration = 0

    constructor(private readonly productAccess: ProductProjectSearchAccess | null = null) {
        makeAutoObservable<ContentSearchManager, "searchDebounceTimer" | "searchGeneration" | "previewGeneration">(this, {
            searchDebounceTimer: false,
            searchGeneration: false,
            previewGeneration: false,
        })
    }

    private get productRuntimeOwnsFiles(): boolean {
        return this.productAccess?.ownsFiles?.() ?? this.productAccess !== null
    }

    private get shouldUseLegacyFilesApi(): boolean {
        return !this.productRuntimeOwnsFiles
    }

    private scopeFor(workingDir: string): ProductProjectSearchScope {
        const productRuntimeOwnsFiles = this.productRuntimeOwnsFiles
        return {
            workingDir,
            productContext: productRuntimeOwnsFiles ? (this.productAccess?.getContext(workingDir) ?? null) : null,
            usesLegacyFilesApi: this.shouldUseLegacyFilesApi,
        }
    }

    private scopeMatches(scope: ProductProjectSearchScope): boolean {
        const current = this.scopeFor(this.workingDir)
        return (
            current.workingDir === scope.workingDir &&
            current.usesLegacyFilesApi === scope.usesLegacyFilesApi &&
            current.productContext?.repoId === scope.productContext?.repoId &&
            current.productContext?.taskId === scope.productContext?.taskId
        )
    }

    private async searchContent(query: string, scope: ProductProjectSearchScope): Promise<{ matches: OpenADEProjectSearchMatch[]; truncated: boolean }> {
        const productAccess = this.productAccess
        const productContext = scope.productContext
        if (productAccess && productContext) {
            const result = await productAccess.searchProject({
                repoId: productContext.repoId,
                taskId: productContext.taskId,
                query,
                limit: CONTENT_RESULTS_LIMIT,
                caseSensitive: false,
            })
            if (!result) return { matches: [], truncated: false }
            return { matches: result.matches, truncated: result.truncated }
        }

        if (!this.shouldUseLegacyFilesApi) {
            return { matches: [], truncated: false }
        }

        const result = await filesApi.contentSearch({
            dir: scope.workingDir,
            query,
            limit: CONTENT_RESULTS_LIMIT,
            caseSensitive: false,
            regex: false,
            rankByHotFiles: true,
        })
        return {
            matches: result.matches.map((match) => ({
                path: match.file,
                line: match.line,
                content: match.content,
                matchStart: match.matchStart,
                matchEnd: match.matchEnd,
            })),
            truncated: result.truncated,
        }
    }

    private async readPreviewFile(absolutePath: string, relativePath: string, scope: ProductProjectSearchScope): Promise<DescribePathResponse> {
        const productAccess = this.productAccess
        const productContext = scope.productContext
        if (productAccess && productContext) {
            const result = await productAccess.readProjectFile({
                repoId: productContext.repoId,
                taskId: productContext.taskId,
                path: relativePath,
                maxBytes: MAX_FILE_READ_SIZE,
            })
            if (!result) return { type: "not_found", path: absolutePath }
            return productFileReadToDescribePath(absolutePath, result)
        }

        if (!this.shouldUseLegacyFilesApi) {
            return { type: "not_found", path: absolutePath }
        }

        return filesApi.describePath({
            path: absolutePath,
            readContents: true,
            maxReadSize: MAX_FILE_READ_SIZE,
        })
    }

    setWorkingDir(path: string): void {
        if (this.workingDir !== path) {
            this.workingDir = path
            // Reset search state when directory changes
            this.query = ""
            this.contentResults = []
            this.contentTruncated = false
            this.selectedIndex = 0
            this.error = null
            this.loading = false
            this.searchGeneration++
            this.previewGeneration++
            if (this.searchDebounceTimer) {
                clearTimeout(this.searchDebounceTimer)
                this.searchDebounceTimer = null
            }
            // Reset preview state
            this.previewPath = null
            this.previewData = null
            this.previewLoading = false
            this.previewError = null
        }
    }

    setQuery(query: string): void {
        this.query = query
        if (query.trim()) {
            this.performSearch(query)
        } else {
            this.contentResults = []
            this.contentTruncated = false
            this.selectedIndex = 0
            this.error = null
        }
    }

    private performSearch(query: string): void {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer)
        }

        this.searchDebounceTimer = setTimeout(async () => {
            if (!this.workingDir) {
                runInAction(() => {
                    this.error = "No repository path set"
                })
                return
            }

            const scope = this.scopeFor(this.workingDir)
            const searchGeneration = ++this.searchGeneration

            runInAction(() => {
                this.loading = true
                this.error = null
            })

            try {
                const result = await this.searchContent(query.trim(), scope)

                runInAction(() => {
                    const stillCurrent = this.searchGeneration === searchGeneration && this.query === query && this.scopeMatches(scope)
                    if (stillCurrent) {
                        this.contentResults = result.matches
                        this.contentTruncated = result.truncated
                        this.selectedIndex = 0
                        this.loading = false

                        // Auto-load preview for first result
                        const firstMatch = this.contentResults[0]
                        if (firstMatch) {
                            this.loadPreviewForMatch(firstMatch)
                        } else {
                            // Clear preview if no results
                            this.previewPath = null
                            this.previewData = null
                            this.previewError = null
                        }
                    } else if (this.searchGeneration === searchGeneration) {
                        this.loading = false
                    }
                })
            } catch (err) {
                runInAction(() => {
                    const stillCurrent = this.searchGeneration === searchGeneration && this.query === query && this.scopeMatches(scope)
                    if (stillCurrent) {
                        this.contentResults = []
                        this.contentTruncated = false
                        this.error = err instanceof Error ? err.message : "Search failed"
                        this.loading = false
                    } else if (this.searchGeneration === searchGeneration) {
                        this.loading = false
                    }
                })
            }
        }, 100) // Reduced debounce to 100ms
    }

    selectNext(): void {
        const total = this.contentResults.length
        if (total > 0) {
            this.selectedIndex = Math.min(this.selectedIndex + 1, total - 1)
        }
    }

    selectPrevious(): void {
        const total = this.contentResults.length
        if (total > 0) {
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
        }
    }

    selectIndex(index: number): void {
        if (index >= 0 && index < this.contentResults.length) {
            this.selectedIndex = index
        }
    }

    clear(): void {
        this.query = ""
        this.contentResults = []
        this.contentTruncated = false
        this.selectedIndex = 0
        this.error = null
        this.loading = false
        // Clear preview state
        this.previewPath = null
        this.previewData = null
        this.previewLoading = false
        this.previewError = null
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer)
            this.searchDebounceTimer = null
        }
    }

    /**
     * Load file preview for a content match
     */
    async loadPreviewForMatch(match: OpenADEProjectSearchMatch): Promise<void> {
        const scope = this.scopeFor(this.workingDir)
        const absolutePath = `${scope.workingDir}/${match.path}`

        // Skip if already loading this file
        if (this.previewPath === absolutePath && this.previewLoading) {
            return
        }

        // Skip if already loaded this file
        if (this.previewPath === absolutePath && this.previewData) {
            return
        }

        this.previewPath = absolutePath
        this.previewLoading = true
        this.previewData = null
        this.previewError = null
        const previewGeneration = ++this.previewGeneration

        try {
            const response = await this.readPreviewFile(absolutePath, match.path, scope)

            runInAction(() => {
                const stillCurrent = this.previewGeneration === previewGeneration && this.previewPath === absolutePath && this.scopeMatches(scope)
                if (stillCurrent) {
                    if (response.type === "file") {
                        this.previewData = response
                        this.previewError = null
                    } else if (response.type === "not_found") {
                        this.previewError = "File not found"
                    } else if (response.type === "error") {
                        this.previewError = response.message
                    } else {
                        this.previewError = "Not a file"
                    }
                    this.previewLoading = false
                } else if (this.previewGeneration === previewGeneration && this.previewPath === absolutePath) {
                    this.previewLoading = false
                }
            })
        } catch (err) {
            runInAction(() => {
                const stillCurrent = this.previewGeneration === previewGeneration && this.previewPath === absolutePath && this.scopeMatches(scope)
                if (stillCurrent) {
                    this.previewError = err instanceof Error ? err.message : "Failed to load file"
                    this.previewLoading = false
                } else if (this.previewGeneration === previewGeneration && this.previewPath === absolutePath) {
                    this.previewLoading = false
                }
            })
        }
    }

    get hasResults(): boolean {
        return this.contentResults.length > 0
    }

    get isSearching(): boolean {
        return this.query.trim().length > 0
    }
}

function productFileReadToDescribePath(path: string, result: OpenADEProjectFileReadResult): DescribePathResponse {
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
