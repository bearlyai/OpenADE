import { makeAutoObservable, runInAction } from "mobx"
import { type ContentSearchMatch, type DescribePathResponse, filesApi } from "../../electronAPI/files"

const MAX_FILE_READ_SIZE = 5 * 1024 * 1024 // 5MB
const CONTENT_RESULTS_LIMIT = 100 // Max content matches to show

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
    contentResults: ContentSearchMatch[] = [] // Content matches
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

    constructor() {
        makeAutoObservable(this)
    }

    setWorkingDir(path: string): void {
        if (this.workingDir !== path) {
            this.workingDir = path
            // Reset search state when directory changes
            this.query = ""
            this.contentResults = []
            this.selectedIndex = 0
            this.error = null
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

            runInAction(() => {
                this.loading = true
                this.error = null
            })

            try {
                const result = await filesApi.contentSearch({
                    dir: this.workingDir,
                    query: query.trim(),
                    limit: CONTENT_RESULTS_LIMIT,
                    caseSensitive: false,
                    regex: false,
                    rankByHotFiles: true,
                })

                runInAction(() => {
                    // Only update if query hasn't changed
                    if (this.query === query) {
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
                    }
                })
            } catch (err) {
                runInAction(() => {
                    if (this.query === query) {
                        this.contentResults = []
                        this.contentTruncated = false
                        this.error = err instanceof Error ? err.message : "Search failed"
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
    async loadPreviewForMatch(match: ContentSearchMatch): Promise<void> {
        const absolutePath = `${this.workingDir}/${match.file}`

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

        try {
            const response = await filesApi.describePath({
                path: absolutePath,
                readContents: true,
                maxReadSize: MAX_FILE_READ_SIZE,
            })

            runInAction(() => {
                // Only update if still viewing this file
                if (this.previewPath === absolutePath) {
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
                }
            })
        } catch (err) {
            runInAction(() => {
                if (this.previewPath === absolutePath) {
                    this.previewError = err instanceof Error ? err.message : "Failed to load file"
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
