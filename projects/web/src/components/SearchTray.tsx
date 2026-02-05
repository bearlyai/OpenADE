import { AlertTriangle, FileCode, Loader2, Search, X } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { twMerge } from "tailwind-merge"
import type { ContentSearchMatch } from "../electronAPI/files"
import { useCodeStore } from "../store/context"
import { type AnnotationSide, type CommentHandlers, FileViewer } from "./FilesAndDiffs"
import { getDisambiguatedPaths } from "./utils/paths"

const CONTEXT_BEFORE_HIGHLIGHT = 5
const MIN_LINE_LENGTH_FOR_TRIM = 40

function HighlightedContent({
    content,
    matchStart,
    matchEnd,
}: {
    content: string
    matchStart: number
    matchEnd: number
}) {
    // If content is short enough, show it all
    // Otherwise, trim from front to show ~5 chars before the highlight
    let displayContent = content
    let displayMatchStart = matchStart
    let showEllipsis = false

    if (content.length >= MIN_LINE_LENGTH_FOR_TRIM && matchStart > CONTEXT_BEFORE_HIGHLIGHT) {
        const trimStart = matchStart - CONTEXT_BEFORE_HIGHLIGHT
        displayContent = content.slice(trimStart)
        displayMatchStart = CONTEXT_BEFORE_HIGHLIGHT
        showEllipsis = true
    }

    const before = displayContent.slice(0, displayMatchStart)
    const highlighted = displayContent.slice(displayMatchStart, displayMatchStart + (matchEnd - matchStart))
    const after = displayContent.slice(displayMatchStart + (matchEnd - matchStart))

    return (
        <span>
            {showEllipsis && <span className="text-muted">…</span>}
            {before}
            <span className="bg-warning/30 text-base-content">{highlighted}</span>
            {after}
        </span>
    )
}

/**
 * Content match result item
 */
function ContentResultItem({
    match,
    selected,
    onSelect,
    shortPath,
}: {
    match: ContentSearchMatch
    selected: boolean
    onSelect: () => void
    shortPath: string
}) {
    const ref = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        if (selected && ref.current) {
            ref.current.scrollIntoView({ block: "nearest" })
        }
    }, [selected])

    return (
        <button
            ref={ref}
            type="button"
            onClick={onSelect}
            className={twMerge(
                "btn w-full text-left px-2 py-2 flex flex-col gap-0.5 transition-colors border-l-2",
                selected ? "bg-primary/10 text-base-content border-l-primary" : "text-muted hover:text-base-content hover:bg-base-200 border-l-transparent"
            )}
            title={match.file}
        >
            {/* Match content - main emphasis */}
            <div className="font-mono text-xs truncate text-base-content w-full">
                <HighlightedContent content={match.content} matchStart={match.matchStart} matchEnd={match.matchEnd} />
            </div>
            {/* File info - secondary */}
            <div className="flex items-center gap-1.5 text-xs text-muted w-full">
                <FileCode size={10} className="flex-shrink-0" />
                <span className="truncate">
                    {shortPath}
                    <span className="text-muted/50">:{match.line}</span>
                </span>
            </div>
        </button>
    )
}

interface SearchTrayProps {
    taskId: string
    onEscapeClose?: () => void
}

export const SearchTray = observer(function SearchTray({ taskId, onEscapeClose }: SearchTrayProps) {
    const codeStore = useCodeStore()
    const contentSearch = codeStore.contentSearch
    const searchInputRef = useRef<HTMLInputElement>(null)

    // Focus search on mount
    useEffect(() => {
        const timer = setTimeout(() => {
            searchInputRef.current?.focus()
        }, 50)
        return () => clearTimeout(timer)
    }, [])

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            switch (e.key) {
                case "ArrowDown": {
                    e.preventDefault()
                    contentSearch.selectNext()
                    // Load preview for newly selected result
                    const newSelected = contentSearch.contentResults[contentSearch.selectedIndex]
                    if (newSelected) {
                        contentSearch.loadPreviewForMatch(newSelected)
                    }
                    break
                }
                case "ArrowUp": {
                    e.preventDefault()
                    contentSearch.selectPrevious()
                    // Load preview for newly selected result
                    const newSelected = contentSearch.contentResults[contentSearch.selectedIndex]
                    if (newSelected) {
                        contentSearch.loadPreviewForMatch(newSelected)
                    }
                    break
                }
                case "Escape":
                    if (contentSearch.query) {
                        e.preventDefault()
                        contentSearch.clear()
                    } else {
                        onEscapeClose?.()
                    }
                    break
            }
        },
        [contentSearch, onEscapeClose]
    )

    const handleSelectResult = useCallback(
        (index: number) => {
            contentSearch.selectIndex(index)
            // Load preview for selected result
            const match = contentSearch.contentResults[index]
            if (match) {
                contentSearch.loadPreviewForMatch(match)
            }
        },
        [contentSearch]
    )

    // Create comment handlers for the selected file
    const selectedMatch = contentSearch.contentResults[contentSearch.selectedIndex] ?? null
    const selectedFile = selectedMatch ? `${contentSearch.repoPath}/${selectedMatch.file}` : null

    const commentHandlers: CommentHandlers | null = useMemo(() => {
        if (!selectedFile) return null

        const sourceMatch = (c: { source: { type: string; filePath?: string } }) => c.source.type === "file" && c.source.filePath === selectedFile

        const createSource = (lineStart: number, lineEnd: number, _side: AnnotationSide) => ({
            type: "file" as const,
            filePath: selectedFile,
            lineStart,
            lineEnd,
        })

        return { taskId, sourceMatch, createSource }
    }, [taskId, selectedFile])

    const results = contentSearch.contentResults
    const hasResults = results.length > 0

    // Compute disambiguated short paths for all results
    const shortPaths = useMemo(() => {
        return getDisambiguatedPaths(results.map((r) => r.file))
    }, [results])

    // Get the file path for the title bar (selectedMatch already defined above)
    const selectedFilePath = selectedMatch?.file ?? null
    const selectedLine = selectedMatch?.line ?? null

    // Highlight the matched line in the preview
    const highlightLines = useMemo(() => {
        if (!selectedLine) return null
        return { start: selectedLine, end: selectedLine }
    }, [selectedLine])

    // Ref for scroll-to-line functionality
    const previewContainerRef = useRef<HTMLDivElement>(null)

    // Scroll to the matched line when preview loads
    useEffect(() => {
        if (!selectedMatch || !contentSearch.previewData?.content || contentSearch.previewLoading) {
            return
        }

        // Wait for FileViewer to render, then scroll to the matched line
        const timeoutId = setTimeout(() => {
            const container = previewContainerRef.current
            if (!container) return

            const selector = `[data-line="${selectedMatch.line}"]`

            // PierreFile renders inside a shadow root, so we need to query inside it
            for (const host of Array.from(container.querySelectorAll("*"))) {
                const lineEl = host.shadowRoot?.querySelector(selector)
                if (lineEl) {
                    lineEl.scrollIntoView({ block: "center", behavior: "instant" })
                    break
                }
            }
        }, 50)

        return () => clearTimeout(timeoutId)
    }, [selectedMatch?.file, selectedMatch?.line, contentSearch.previewData?.content, contentSearch.previewLoading])

    return (
        <div className="flex h-full" onKeyDown={handleKeyDown}>
            {/* Left panel: Search input + results list */}
            <div className="w-72 flex-shrink-0 flex flex-col border-r border-border bg-base-100">
                {/* Search input */}
                <div className="flex items-center gap-2 px-2 py-2 border-b border-border">
                    <Search size={14} className="text-muted flex-shrink-0" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={contentSearch.query}
                        onChange={(e) => contentSearch.setQuery(e.target.value)}
                        placeholder="Search content..."
                        className="input flex-1 bg-transparent border-none text-sm px-0 py-1 focus:outline-none"
                    />
                    {contentSearch.loading && <Loader2 size={14} className="text-muted animate-spin flex-shrink-0" />}
                    {contentSearch.query && !contentSearch.loading && (
                        <button
                            type="button"
                            onClick={() => contentSearch.clear()}
                            className="btn p-1 text-muted hover:text-base-content hover:bg-base-200 transition-colors"
                            title="Clear search"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>

                {/* Results list */}
                <div className="flex-1 overflow-y-auto">
                    {contentSearch.error ? (
                        <div className="flex flex-col items-center justify-center py-8 gap-2 text-sm">
                            <AlertTriangle size={20} className="text-error" />
                            <span className="text-error">{contentSearch.error}</span>
                        </div>
                    ) : !contentSearch.isSearching ? (
                        <div className="flex items-center justify-center py-8 text-muted text-sm">Search content</div>
                    ) : contentSearch.loading ? (
                        <div className="flex items-center justify-center py-8 text-muted text-sm">Searching...</div>
                    ) : !hasResults ? (
                        <div className="flex items-center justify-center py-8 text-muted text-sm">No matches found</div>
                    ) : (
                        <div className="flex flex-col py-1">
                            {results.map((match, index) => (
                                <ContentResultItem
                                    key={`${match.file}:${match.line}`}
                                    match={match}
                                    selected={index === contentSearch.selectedIndex}
                                    onSelect={() => handleSelectResult(index)}
                                    shortPath={shortPaths.get(match.file) ?? match.file}
                                />
                            ))}
                            {contentSearch.contentTruncated && (
                                <div className="px-2 py-2 text-xs text-muted text-center border-t border-border">Results limited to 100 matches</div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Right panel: File preview */}
            <div ref={previewContainerRef} className="flex-1 min-w-0 overflow-auto flex flex-col bg-base-100">
                {selectedMatch && contentSearch.previewData ? (
                    <>
                        {/* Sticky title bar */}
                        <div className="px-3 py-2 border-b border-border flex items-center gap-2 text-sm bg-base-200 flex-shrink-0 sticky top-0 z-10">
                            <FileCode size="1em" className="flex-shrink-0 text-muted" />
                            <span className="font-medium truncate">{selectedFilePath ? (shortPaths.get(selectedFilePath) ?? selectedFilePath) : ""}</span>
                            {selectedLine && <span className="text-muted/50 flex-shrink-0">:{selectedLine}</span>}
                        </div>
                        <div className="flex-1">
                            {contentSearch.previewLoading ? (
                                <div className="flex items-center justify-center py-12 text-muted text-sm">Loading file...</div>
                            ) : contentSearch.previewError ? (
                                <div className="flex flex-col items-center justify-center py-12 gap-2">
                                    <AlertTriangle size={24} className="text-error" />
                                    <span className="text-error text-sm">{contentSearch.previewError}</span>
                                </div>
                            ) : contentSearch.previewData?.tooLarge ? (
                                <div className="flex flex-col items-center justify-center py-12 gap-2">
                                    <AlertTriangle size={24} className="text-warning" />
                                    <span className="text-muted text-sm">File too large to display</span>
                                </div>
                            ) : contentSearch.previewData && contentSearch.previewData.content !== null ? (
                                <div className="min-h-full bg-editor-background">
                                    <FileViewer
                                        file={{
                                            name: contentSearch.previewPath ?? "",
                                            contents: contentSearch.previewData.content,
                                        }}
                                        disableFileHeader
                                        commentHandlers={commentHandlers}
                                        highlightLines={highlightLines}
                                    />
                                </div>
                            ) : (
                                <div className="flex items-center justify-center py-12 text-muted text-sm">Unable to load file content</div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-muted text-sm">
                        {contentSearch.isSearching && hasResults ? "Loading preview..." : "Search results will appear here"}
                    </div>
                )}
            </div>
        </div>
    )
})
