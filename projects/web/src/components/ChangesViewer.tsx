import { ArrowRight, ChevronDown, ChevronRight, FileCode, FileImage, Folder, RefreshCw } from "lucide-react"
import { observer } from "mobx-react"
import { useMemo } from "react"
import { twMerge } from "tailwind-merge"
import type { ChangesManager } from "../store/managers/ChangesManager"
import { useCodeStore } from "../store/context"
import { StatusIcon, type ViewMode, ViewModeToggle } from "./git/shared"
import { Select } from "./ui/Select"
import { type AnnotationSide, type CommentHandlers, FileViewer, MultiFileDiffViewer } from "./FilesAndDiffs"
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
    const viewMode = codeStore.ui.viewMode
    const setViewMode = (mode: ViewMode) => codeStore.ui.setViewMode(mode)

    const { files, selectedFile, filePair, fileLoading, diffSource, flatEntries, expandedPaths, isLoading } = changesManager

    // Stabilize file objects so contentDeps in useCommentAnnotations doesn't
    // change on every render — prevents clearing the open CommentForm
    const currentFile = useMemo(() => {
        if (!selectedFile || !filePair) return null
        return { name: selectedFile.path, contents: filePair.after }
    }, [selectedFile?.path, filePair?.after])

    const diffOldFile = useMemo(() => {
        if (!selectedFile || !filePair) return null
        return { name: selectedFile.oldPath || selectedFile.path, contents: filePair.before }
    }, [selectedFile?.oldPath, selectedFile?.path, filePair?.before])

    const diffNewFile = useMemo(() => {
        if (!selectedFile || !filePair) return null
        return { name: selectedFile.path, contents: filePair.after }
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

    const onRefresh = () => changesManager.refresh()

    if (isLoading) {
        return <div className={twMerge("flex items-center justify-center py-12 text-muted text-sm", className)}>Loading changes...</div>
    }

    if (files.length === 0) {
        return (
            <div className={twMerge("flex flex-col h-full", className)}>
                {isWorktree && (
                    <div className="px-3 py-2 border-b border-border flex items-center justify-between bg-base-200">
                        <DiffSourceSelect value={diffSource} onChange={(v) => changesManager.setDiffSource(v)} />
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={onRefresh}
                                className="btn p-1 text-muted hover:text-base-content hover:bg-base-300 transition-colors"
                                title="Refresh changes"
                            >
                                <RefreshCw size={14} />
                            </button>
                            <ViewModeToggle value={viewMode} onChange={setViewMode} />
                        </div>
                    </div>
                )}
                <div className="flex-1 flex items-center justify-center py-12 text-muted text-sm">No changes.</div>
            </div>
        )
    }

    return (
        <div className={twMerge("flex h-full", className)}>
            <div className="w-64 border-r border-border flex-shrink-0 bg-base-200 flex flex-col">
                <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
                    {isWorktree ? <DiffSourceSelect value={diffSource} onChange={(v) => changesManager.setDiffSource(v)} /> : <div />}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onRefresh}
                            className="btn p-1 text-muted hover:text-base-content hover:bg-base-300 transition-colors"
                            title="Refresh changes"
                        >
                            <RefreshCw size={14} />
                        </button>
                        <ViewModeToggle value={viewMode} onChange={setViewMode} />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                    <div className="flex flex-col py-1">
                        {flatEntries.map((entry) => (
                            <ChangesTreeItem
                                key={entry.node.path}
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
                        ))}
                    </div>
                </div>
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
                {fileLoading ? (
                    <div className="flex items-center justify-center py-12 text-muted text-sm">Loading file...</div>
                ) : selectedFile?.binary ? (
                    <div className="flex items-center justify-center py-12 text-muted text-sm">Binary file — cannot display diff</div>
                ) : filePair?.tooLarge ? (
                    <div className="flex items-center justify-center py-12 text-muted text-sm">File too large to diff</div>
                ) : currentFile && diffOldFile && diffNewFile ? (
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
                ) : (
                    <div className="flex items-center justify-center py-12 text-muted text-sm">Select a file to view changes</div>
                )}
            </div>
        </div>
    )
})
