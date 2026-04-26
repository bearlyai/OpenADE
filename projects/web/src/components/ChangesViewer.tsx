import { parsePatchFiles } from "@pierre/diffs"
import { ArrowRight, ChevronDown, ChevronRight, FileCode, FileImage, Folder, RefreshCw } from "lucide-react"
import { observer } from "mobx-react"
import { useEffect, useMemo, useState } from "react"
import { twMerge } from "tailwind-merge"
import type { ChangesManager } from "../store/managers/ChangesManager"
import { useCodeStore } from "../store/context"
import { getChangesLoadMode, getPatchContextLines, shouldUsePatchDiff } from "../utils/gitDiffContext"
import { type AnnotationSide, type CommentHandlers, FileDiffViewer, FileViewer, MultiFileDiffViewer } from "./FilesAndDiffs"
import { DiffContextSelect, StatusIcon, type ViewMode, ViewModeToggle } from "./git/shared"
import { Select } from "./ui/Select"
import { VirtualizedFixedList } from "./ui/VirtualizedFixedList"
import type { FlatTreeEntry } from "./utils/changesTree"

type DiffSource = "uncommitted" | "from-base"

const DIFF_SOURCE_ENTRIES = [
    { id: "uncommitted" as DiffSource, content: "Uncommitted" },
    { id: "from-base" as DiffSource, content: "From base" },
]

function DiffSourceSelect({ value, onChange }: { value: DiffSource; onChange: (v: DiffSource) => void }) {
    return (
        <Select
            selectedId={value}
            entries={DIFF_SOURCE_ENTRIES}
            onSelect={(entry) => onChange(entry.id)}
            className={{
                trigger: "h-8 px-2 text-xs border border-border bg-base-100 hover:bg-base-200 transition-colors",
                value: "text-xs",
            }}
        />
    )
}

interface ChangesTreeItemProps {
    entry: FlatTreeEntry
    expanded: boolean
    selected: boolean
    onSelect: () => void
    onToggle: () => void
}

function ChangesTreeItem({ entry, expanded, selected, onSelect, onToggle }: ChangesTreeItemProps) {
    const { node, depth } = entry

    if (node.isDir) {
        return (
            <button
                type="button"
                onClick={onToggle}
                className={twMerge(
                    "btn w-full flex items-center gap-1 py-1 pr-2 text-sm text-left transition-colors",
                    "text-muted hover:text-base-content hover:bg-base-200"
                )}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                title={node.path}
            >
                {expanded ? <ChevronDown size={14} className="flex-shrink-0 text-muted" /> : <ChevronRight size={14} className="flex-shrink-0 text-muted" />}
                <Folder size={14} className="flex-shrink-0 text-muted" />
                <span className="truncate font-mono text-xs">{node.name}</span>
                <span className="ml-auto flex-shrink-0 text-xs text-muted">{node.fileCount}</span>
            </button>
        )
    }

    if (!node.file) {
        return null
    }

    const file = node.file
    const FileIcon = file.binary ? FileImage : FileCode

    return (
        <button
            type="button"
            onClick={onSelect}
            className={twMerge(
                "btn w-full flex items-center gap-1 py-1 pr-2 text-sm text-left transition-colors",
                selected ? "bg-primary/10 text-base-content" : "text-muted hover:text-base-content hover:bg-base-200"
            )}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            title={file.binary ? `${file.path} (binary)` : file.path}
        >
            <StatusIcon status={file.status} />
            <FileIcon size={14} className="flex-shrink-0 text-muted" />
            <span className="truncate font-mono text-xs">{node.name}</span>
        </button>
    )
}

interface ChangesViewerProps {
    changesManager: ChangesManager
    isWorktree: boolean
    className?: string
    taskId: string
}

export const ChangesViewer = observer(function ChangesViewer({ changesManager, isWorktree, className, taskId }: ChangesViewerProps) {
    const codeStore = useCodeStore()
    const [renderLargeDiffKey, setRenderLargeDiffKey] = useState<string | null>(null)
    const viewMode = codeStore.ui.viewMode
    const diffContext = codeStore.ui.diffContext
    const usePatchDiff = shouldUsePatchDiff(viewMode, diffContext)
    const patchContextLines = getPatchContextLines(diffContext)
    const patchDiffStyle = viewMode === "split" ? "split" : "unified"
    const setViewMode = (mode: ViewMode) => codeStore.ui.setViewMode(mode)
    const setDiffContext = (context: typeof diffContext) => {
        if (viewMode !== "current") {
            changesManager.beginPatchContextTransition(getPatchContextLines(context))
        }
        codeStore.ui.setDiffContext(context)
    }

    const { files, selectedFile, filePair, filePatch, filePairLoading, filePatchLoading, diffSource, flatEntries, expandedPaths, isLoading } = changesManager
    const largeDiffKey = selectedFile && filePatch ? `${selectedFile.path}:${filePatch.stats.changedLines}:${filePatch.stats.hunkCount}` : null
    const deferLargeDiff = filePatch?.heavy === true && renderLargeDiffKey !== largeDiffKey

    const currentFile = useMemo(() => {
        if (!selectedFile || !filePair) return null
        return {
            name: selectedFile.path,
            contents: filePair.after,
            cacheKey: `${selectedFile.path}:current:${filePair.after.length}`,
        }
    }, [selectedFile?.path, filePair?.after])

    const diffOldFile = useMemo(() => {
        if (!selectedFile || !filePair) return null
        return {
            name: selectedFile.oldPath || selectedFile.path,
            contents: filePair.before,
            cacheKey: `${selectedFile.oldPath || selectedFile.path}:old:${filePair.before.length}`,
        }
    }, [selectedFile?.oldPath, selectedFile?.path, filePair?.before])

    const diffNewFile = useMemo(() => {
        if (!selectedFile || !filePair) return null
        return {
            name: selectedFile.path,
            contents: filePair.after,
            cacheKey: `${selectedFile.path}:new:${filePair.after.length}`,
        }
    }, [selectedFile?.path, filePair?.after])

    const commentHandlers: CommentHandlers | null = useMemo(() => {
        if (!selectedFile) return null
        const filePath = selectedFile.path

        const sourceMatch = (c: { source: { type: string; filePath?: string } }) => c.source.type === "file" && c.source.filePath === filePath

        const createSource = (lineStart: number, lineEnd: number, _side: AnnotationSide) => ({
            type: "file" as const,
            filePath,
            lineStart,
            lineEnd,
        })

        return { taskId, sourceMatch, createSource }
    }, [taskId, selectedFile?.path])

    const patchView = useMemo(() => {
        if (!filePatch?.patch || deferLargeDiff) {
            return { fileDiff: null, parseError: false }
        }

        try {
            const parsedPatches = parsePatchFiles(filePatch.patch, selectedFile?.path)
            for (const patch of parsedPatches) {
                if (patch.files[0]) {
                    return { fileDiff: patch.files[0], parseError: false }
                }
            }
            return { fileDiff: null, parseError: false }
        } catch (error) {
            console.error("[ChangesViewer] Failed to parse patch:", error)
            return { fileDiff: null, parseError: true }
        }
    }, [deferLargeDiff, filePatch?.patch, selectedFile?.path])

    useEffect(() => {
        setRenderLargeDiffKey(null)
    }, [selectedFile?.path])

    useEffect(() => {
        if (!selectedFile) {
            return
        }

        changesManager.ensureSelectedFileLoaded(getChangesLoadMode(viewMode, diffContext), usePatchDiff ? patchContextLines : undefined)
    }, [changesManager, diffContext, patchContextLines, selectedFile?.path, usePatchDiff, viewMode])

    const onRefresh = () => changesManager.refresh()

    const toolbar = (
        <div className="px-3 py-2 border-b border-border bg-base-200 overflow-x-auto">
            <div className="flex items-center gap-2 w-full min-w-max">
                {isWorktree ? <DiffSourceSelect value={diffSource} onChange={(v) => changesManager.setDiffSource(v)} /> : null}
                <div className="flex items-center gap-2 ml-auto">
                    <DiffContextSelect value={diffContext} onChange={setDiffContext} />
                    <ViewModeToggle value={viewMode} onChange={setViewMode} />
                    <button
                        type="button"
                        onClick={onRefresh}
                        className="btn p-1 text-muted hover:text-base-content hover:bg-base-300 transition-colors flex-shrink-0"
                        title="Refresh changes"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>
            </div>
        </div>
    )

    const renderContent = () => {
        if (!selectedFile) {
            return <div className="flex items-center justify-center py-12 text-muted text-sm">Select a file to view changes</div>
        }

        if (usePatchDiff) {
            if (filePatchLoading) {
                return <div className="flex items-center justify-center py-12 text-muted text-sm">Loading file...</div>
            }
            if (selectedFile.binary) {
                return <div className="flex items-center justify-center py-12 text-muted text-sm">Binary file — cannot display diff</div>
            }
            if (deferLargeDiff && filePatch) {
                return (
                    <div className="px-4 py-6 flex flex-col items-center gap-3 text-sm">
                        <div className="text-base-content font-medium">Large diff deferred</div>
                        <div className="text-muted text-center">
                            {filePatch.stats.changedLines} changed lines across {filePatch.stats.hunkCount} hunks.
                        </div>
                        <button
                            type="button"
                            onClick={() => setRenderLargeDiffKey(largeDiffKey)}
                            className="btn px-3 py-1.5 text-xs bg-base-300 hover:bg-base-200 text-base-content"
                        >
                            Render diff
                        </button>
                    </div>
                )
            }
            if (patchView.parseError) {
                return <div className="flex items-center justify-center py-12 text-muted text-sm">Large diff preview unavailable for this file</div>
            }
            if (patchView.fileDiff) {
                return (
                    <div className="min-h-full bg-editor-background">
                        {(filePatch?.truncated || filePatch?.heavy) && (
                            <div className="px-3 py-2 border-b border-border bg-base-200 text-xs text-muted">
                                {filePatch.truncated
                                    ? `Large diff preview truncated to keep rendering responsive (${filePatch.stats.changedLines} changed lines)`
                                    : `Large diff — simplified rendering enabled (${filePatch.stats.changedLines} changed lines)`}
                            </div>
                        )}
                        <FileDiffViewer
                            fileDiff={patchView.fileDiff}
                            diffStyle={patchDiffStyle}
                            disableFileHeader
                            disableWorkerPool
                            commentHandlers={commentHandlers}
                            options={
                                filePatch?.heavy ? { lineDiffType: "none", maxLineDiffLength: 0, tokenizeMaxLineLength: 0, overflow: "scroll" } : undefined
                            }
                        />
                    </div>
                )
            }
            return <div className="flex items-center justify-center py-12 text-muted text-sm">No diff content for selected context</div>
        }

        if (filePairLoading) {
            return <div className="flex items-center justify-center py-12 text-muted text-sm">Loading file...</div>
        }
        if (selectedFile.binary) {
            return <div className="flex items-center justify-center py-12 text-muted text-sm">Binary file — cannot display diff</div>
        }
        if (filePair?.tooLarge) {
            return <div className="flex items-center justify-center py-12 text-muted text-sm">File too large to diff</div>
        }
        if (currentFile && diffOldFile && diffNewFile) {
            return (
                <div className="min-h-full bg-editor-background">
                    {viewMode === "current" ? (
                        <FileViewer file={currentFile} disableFileHeader commentHandlers={commentHandlers} />
                    ) : (
                        <MultiFileDiffViewer
                            oldFile={diffOldFile}
                            newFile={diffNewFile}
                            diffStyle={viewMode}
                            disableFileHeader
                            commentHandlers={commentHandlers}
                        />
                    )}
                </div>
            )
        }

        return <div className="flex items-center justify-center py-12 text-muted text-sm">Select a file to view changes</div>
    }

    if (isLoading) {
        return <div className={twMerge("flex items-center justify-center py-12 text-muted text-sm", className)}>Loading changes...</div>
    }

    if (files.length === 0) {
        return (
            <div className={twMerge("flex flex-col h-full", className)}>
                {toolbar}
                <div className="flex-1 flex items-center justify-center py-12 text-muted text-sm">No changes.</div>
            </div>
        )
    }

    return (
        <div className={twMerge("flex h-full", className)}>
            <div className="w-64 border-r border-border flex-shrink-0 bg-base-200 flex flex-col">
                {toolbar}
                <VirtualizedFixedList
                    items={flatEntries}
                    rowHeight={30}
                    className="flex-1 overflow-y-auto"
                    renderRow={(entry) => (
                        <div className="py-1">
                            <ChangesTreeItem
                                entry={entry}
                                expanded={entry.node.isDir && expandedPaths.has(entry.node.path)}
                                selected={!entry.node.isDir && entry.node.file?.path === selectedFile?.path}
                                onSelect={() => {
                                    if (!entry.node.isDir && entry.node.file) {
                                        changesManager.selectFile(entry.node.file.path)
                                    }
                                }}
                                onToggle={() => {
                                    if (!entry.node.isDir) return
                                    changesManager.toggleExpanded(entry.node.path)
                                }}
                            />
                        </div>
                    )}
                />
            </div>
            <div className="flex-1 min-w-0 overflow-auto flex flex-col">
                {selectedFile && (
                    <div className="px-3 py-2 border-b border-border flex items-center gap-2 text-sm bg-base-200 flex-shrink-0 sticky top-0 z-10">
                        <StatusIcon status={selectedFile.status} />
                        <FileCode size="1em" className="flex-shrink-0 text-muted" />
                        <span className="truncate" title={selectedFile.path}>
                            {selectedFile.oldPath ? (
                                <>
                                    <span className="text-muted">{selectedFile.oldPath}</span>
                                    <ArrowRight size="1em" className="inline mx-1" />
                                    {selectedFile.path}
                                </>
                            ) : (
                                selectedFile.path
                            )}
                        </span>
                    </div>
                )}
                {renderContent()}
            </div>
        </div>
    )
})
