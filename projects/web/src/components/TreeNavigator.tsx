import { ChevronDown, ChevronRight, ChevronsDownUp, FileCode, Folder, Loader2, RefreshCw, Search, X } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useEffect, useRef } from "react"
import { twMerge } from "tailwind-merge"
import { useCodeStore } from "../store/context"
import type { TreeNode } from "../store/managers/FileBrowserManager"

interface TreeItemProps {
    node: TreeNode
    selected: boolean
    onSelect: () => void
    onToggle: () => void
    onOpen: () => void
}

function TreeItem({ node, selected, onSelect, onToggle, onOpen }: TreeItemProps) {
    const handleClick = useCallback(() => {
        onSelect()
        if (node.isDir) {
            onToggle()
        } else {
            onOpen()
        }
    }, [node.isDir, onSelect, onToggle, onOpen])

    const handleDoubleClick = useCallback(() => {
        if (!node.isDir) {
            onOpen()
        }
    }, [node.isDir, onOpen])

    return (
        <button
            type="button"
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            className={twMerge(
                "btn w-full flex items-center gap-1 py-1 pr-2 text-sm text-left transition-colors",
                selected ? "bg-primary/10 text-base-content" : "text-muted hover:text-base-content hover:bg-base-200"
            )}
            style={{ paddingLeft: `${node.depth * 12 + 8}px` }}
        >
            {node.isDir ? (
                <>
                    {node.isLoading ? (
                        <Loader2 size={14} className="flex-shrink-0 text-muted animate-spin" />
                    ) : node.isExpanded ? (
                        <ChevronDown size={14} className="flex-shrink-0 text-muted" />
                    ) : (
                        <ChevronRight size={14} className="flex-shrink-0 text-muted" />
                    )}
                    <Folder size={14} className="flex-shrink-0 text-warning" />
                </>
            ) : (
                <>
                    <span className="w-[14px]" />
                    <FileCode size={14} className="flex-shrink-0 text-muted" />
                </>
            )}
            <span className="truncate font-mono text-xs">{node.name}</span>
        </button>
    )
}

interface SearchResultItemProps {
    fullPath: string
    selected: boolean
    onSelect: () => void
    onOpen: () => void
}

function SearchResultItem({ fullPath, selected, onSelect, onOpen }: SearchResultItemProps) {
    return (
        <button
            type="button"
            onClick={() => {
                onSelect()
                onOpen()
            }}
            className={twMerge(
                "btn w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left transition-colors",
                selected ? "bg-primary/10 text-base-content" : "text-muted hover:text-base-content hover:bg-base-200"
            )}
        >
            <FileCode size={14} className="flex-shrink-0 text-muted" />
            <span className="truncate font-mono text-xs">{fullPath}</span>
        </button>
    )
}

interface TreeNavigatorProps {
    className?: string
    onEscapeClose?: () => void
}

export const TreeNavigator = observer(function TreeNavigator({ className, onEscapeClose }: TreeNavigatorProps) {
    const codeStore = useCodeStore()
    const fileBrowser = codeStore.fileBrowser
    const searchInputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    // Focus search on mount
    useEffect(() => {
        const timer = setTimeout(() => {
            searchInputRef.current?.focus()
        }, 50)
        return () => clearTimeout(timer)
    }, [])

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            const tree = fileBrowser.flattenedTree
            const searchItems = fileBrowser.searchDisplayItems
            const isSearching = fileBrowser.isSearching
            const items = isSearching ? searchItems : tree

            const currentIndex = isSearching
                ? searchItems.findIndex((item) => `${fileBrowser.workingDir}/${item.name}` === fileBrowser.selectedPath)
                : tree.findIndex((node) => node.path === fileBrowser.selectedPath)

            switch (e.key) {
                case "ArrowDown": {
                    e.preventDefault()
                    const nextIndex = Math.min(currentIndex + 1, items.length - 1)
                    if (isSearching) {
                        const item = searchItems[nextIndex]
                        if (item) fileBrowser.selectPath(item.fullPath)
                    } else {
                        const node = tree[nextIndex]
                        if (node) fileBrowser.selectPath(node.path)
                    }
                    break
                }
                case "ArrowUp": {
                    e.preventDefault()
                    const prevIndex = Math.max(currentIndex - 1, 0)
                    if (isSearching) {
                        const item = searchItems[prevIndex]
                        if (item) fileBrowser.selectPath(item.fullPath)
                    } else {
                        const node = tree[prevIndex]
                        if (node) fileBrowser.selectPath(node.path)
                    }
                    break
                }
                case "Enter": {
                    e.preventDefault()
                    if (isSearching) {
                        const item = searchItems.find((i) => i.fullPath === fileBrowser.selectedPath)
                        if (item) fileBrowser.openFile(item.fullPath)
                    } else {
                        const node = tree.find((n) => n.path === fileBrowser.selectedPath)
                        if (node) {
                            if (node.isDir) {
                                fileBrowser.toggleExpanded(node.path)
                            } else {
                                fileBrowser.openFile(node.path)
                            }
                        }
                    }
                    break
                }
                case "ArrowRight": {
                    if (!isSearching) {
                        e.preventDefault()
                        const node = tree.find((n) => n.path === fileBrowser.selectedPath)
                        if (node?.isDir && !node.isExpanded) {
                            fileBrowser.toggleExpanded(node.path)
                        }
                    }
                    break
                }
                case "ArrowLeft": {
                    if (!isSearching) {
                        e.preventDefault()
                        const node = tree.find((n) => n.path === fileBrowser.selectedPath)
                        if (node?.isDir && node.isExpanded) {
                            fileBrowser.toggleExpanded(node.path)
                        }
                    }
                    break
                }
                case "Escape":
                    if (fileBrowser.searchQuery) {
                        e.preventDefault()
                        fileBrowser.setSearchQuery("")
                    } else {
                        onEscapeClose?.()
                    }
                    break
            }
        },
        [fileBrowser, onEscapeClose]
    )

    // Scroll selected into view
    useEffect(() => {
        const listEl = listRef.current
        if (!listEl || !fileBrowser.selectedPath) return

        const selectedEl = listEl.querySelector(`[data-path="${CSS.escape(fileBrowser.selectedPath)}"]`)
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: "nearest" })
        }
    }, [fileBrowser.selectedPath])

    const tree = fileBrowser.flattenedTree
    const searchItems = fileBrowser.searchDisplayItems
    const isSearching = fileBrowser.isSearching

    return (
        <div className={twMerge("flex flex-col h-full bg-base-100 border-r border-border", className)} onKeyDown={handleKeyDown}>
            {/* Search bar */}
            <div className="flex items-center gap-2 px-2 py-2 border-b border-border">
                <Search size={14} className="text-muted flex-shrink-0" />
                <input
                    ref={searchInputRef}
                    type="text"
                    value={fileBrowser.searchQuery}
                    onChange={(e) => fileBrowser.setSearchQuery(e.target.value)}
                    placeholder="Search files..."
                    className="input flex-1 bg-transparent border-none text-sm px-0 py-1 focus:outline-none"
                />
                {fileBrowser.searchQuery && (
                    <button
                        type="button"
                        onClick={() => fileBrowser.setSearchQuery("")}
                        className="btn p-1 text-muted hover:text-base-content hover:bg-base-200 transition-colors"
                        title="Clear search"
                    >
                        <X size={14} />
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => fileBrowser.refreshTree()}
                    className="btn p-1 text-muted hover:text-base-content hover:bg-base-200 transition-colors"
                    title="Refresh file tree"
                >
                    <RefreshCw size={14} />
                </button>
                <button
                    type="button"
                    onClick={() => fileBrowser.collapseAll()}
                    className="btn p-1 text-muted hover:text-base-content hover:bg-base-200 transition-colors"
                    title="Collapse all"
                >
                    <ChevronsDownUp size={14} />
                </button>
            </div>

            {/* Tree or search results */}
            <div ref={listRef} className="flex-1 overflow-y-auto">
                {isSearching ? (
                    searchItems.length === 0 && !fileBrowser.searchLoading ? (
                        <div className="flex items-center justify-center py-8 text-muted text-sm">No files found</div>
                    ) : (
                        <div className="flex flex-col py-1">
                            {searchItems.map((item) => (
                                <SearchResultItem
                                    key={item.fullPath}
                                    fullPath={item.fullPath}
                                    selected={fileBrowser.selectedPath === item.fullPath}
                                    onSelect={() => fileBrowser.selectPath(item.fullPath)}
                                    onOpen={() => fileBrowser.openFile(item.fullPath)}
                                />
                            ))}
                        </div>
                    )
                ) : tree.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-muted text-sm">No files</div>
                ) : (
                    <div className="flex flex-col py-1">
                        {tree.map((node) => (
                            <div key={node.path} data-path={node.path}>
                                <TreeItem
                                    node={node}
                                    selected={fileBrowser.selectedPath === node.path}
                                    onSelect={() => fileBrowser.selectPath(node.path)}
                                    onToggle={() => fileBrowser.toggleExpanded(node.path)}
                                    onOpen={() => fileBrowser.openFile(node.path)}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
})
