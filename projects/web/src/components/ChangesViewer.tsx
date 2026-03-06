import { ArrowRight, ChevronDown, ChevronRight, FileCode, FileImage, Folder, RefreshCw } from "lucide-react"
import { observer } from "mobx-react"
import { useEffect, useMemo, useState } from "react"
import { twMerge } from "tailwind-merge"
import { type ChangedFileInfo, type GitStatusResponse, gitApi } from "../electronAPI/git"
import { useCodeStore } from "../store/context"
import { StatusIcon, type ViewMode, ViewModeToggle } from "./git/shared"
import { Select } from "./ui/Select"
import { type AnnotationSide, type CommentHandlers, FileViewer, MultiFileDiffViewer } from "./FilesAndDiffs"
import { buildFileTree, collectAllDirPaths, flattenFileTree, type FlatTreeEntry } from "./utils/changesTree"

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

/** Derive ChangedFileInfo[] from gitStatus for uncommitted changes */
function deriveUncommittedFiles(status: GitStatusResponse): ChangedFileInfo[] {
    const files: ChangedFileInfo[] = []
    const seen = new Set<string>()

    // Staged and unstaged files (dedupe in case same file appears in both)
    for (const file of [...status.staged.files, ...status.unstaged.files]) {
        if (!seen.has(file.path)) {
            seen.add(file.path)
            files.push({ path: file.path, status: file.status ?? "modified", binary: file.binary })
        }
    }

    // Untracked files are added
    for (const file of status.untracked) {
        files.push({ path: file.path, status: "added", binary: file.binary })
    }

    return files
}

interface ChangesViewerProps {
    workDir: string
    gitStatus: GitStatusResponse | null
    isWorktree: boolean
    mergeBaseCommit?: string
    className?: string
    taskId: string
    onRefresh?: () => void
}

export const ChangesViewer = observer(function ChangesViewer({
    workDir,
    gitStatus,
    isWorktree,
    mergeBaseCommit,
    className,
    taskId,
    onRefresh,
}: ChangesViewerProps) {
    const codeStore = useCodeStore()
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
    const [diffSource, setDiffSource] = useState<DiffSource>("uncommitted")
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

    const [filePair, setFilePair] = useState<{ before: string; after: string; tooLarge?: boolean } | null>(null)
    const [fileLoading, setFileLoading] = useState(false)

    // State for "from base" files (fetched on demand)
    const [fromBaseFiles, setFromBaseFiles] = useState<ChangedFileInfo[] | null>(null)
    const [fromBaseLoading, setFromBaseLoading] = useState(false)

    const viewMode = codeStore.ui.viewMode
    const setViewMode = (mode: ViewMode) => codeStore.ui.setViewMode(mode)

    // Derive uncommitted files from gitStatus
    const uncommittedFiles = useMemo(() => {
        if (!gitStatus) return []
        return deriveUncommittedFiles(gitStatus)
    }, [gitStatus])

    // Fetch "from base" files when switching to that mode
    useEffect(() => {
        if (diffSource !== "from-base" || !mergeBaseCommit) {
            return
        }

        // Already loaded
        if (fromBaseFiles !== null) {
            return
        }

        async function loadFromBaseFiles() {
            setFromBaseLoading(true)
            try {
                const result = await gitApi.getChangedFiles({
                    workDir,
                    fromTreeish: mergeBaseCommit!,
                    toTreeish: "HEAD",
                })
                setFromBaseFiles(result.files)
            } catch (err) {
                console.error("[ChangesViewer] Failed to load from-base files:", err)
                setFromBaseFiles([])
            } finally {
                setFromBaseLoading(false)
            }
        }
        loadFromBaseFiles()
    }, [diffSource, mergeBaseCommit, workDir, fromBaseFiles])

    // Reset from-base cache when gitStatus changes (new commits may have been made)
    useEffect(() => {
        setFromBaseFiles(null)
    }, [gitStatus])

    // Current files based on diff source
    const files = useMemo(() => (diffSource === "uncommitted" ? uncommittedFiles : (fromBaseFiles ?? [])), [diffSource, uncommittedFiles, fromBaseFiles])
    const fileTree = useMemo(() => buildFileTree(files), [files])
    const flatEntries = useMemo(() => flattenFileTree(fileTree, expandedPaths), [fileTree, expandedPaths])
    const isLoading = diffSource === "uncommitted" ? gitStatus === null : fromBaseLoading

    // Reset selection when files change
    useEffect(() => {
        setSelectedFilePath((prev) => {
            if (files.length === 0) return null
            if (prev && files.some((file) => file.path === prev)) return prev
            return files[0].path
        })
    }, [files])

    // Expand all directories by default when file list changes
    useEffect(() => {
        setExpandedPaths(collectAllDirPaths(fileTree))
    }, [fileTree])

    const selectedFile = useMemo(() => {
        if (files.length === 0) return null
        if (!selectedFilePath) return files[0]
        return files.find((file) => file.path === selectedFilePath) ?? files[0]
    }, [files, selectedFilePath])

    // Compute treeish values for file pair fetching
    const fromTreeish = diffSource === "uncommitted" ? "HEAD" : (mergeBaseCommit ?? "HEAD")
    const toTreeish = diffSource === "uncommitted" ? "" : "HEAD" // Empty string = working tree

    useEffect(() => {
        if (!selectedFile) {
            setFilePair(null)
            return
        }

        const fileToLoad = selectedFile

        // Skip loading for binary files - we'll show a placeholder instead
        if (fileToLoad.binary) {
            setFilePair(null)
            return
        }

        async function loadFilePair() {
            setFileLoading(true)
            try {
                const result = await gitApi.getFilePair({
                    workDir,
                    fromTreeish,
                    toTreeish,
                    filePath: fileToLoad.path,
                    oldPath: fileToLoad.oldPath,
                })
                setFilePair(result)
            } catch (err) {
                console.error("[ChangesViewer] Failed to load file pair:", err)
                setFilePair(null)
            } finally {
                setFileLoading(false)
            }
        }
        loadFilePair()
    }, [workDir, fromTreeish, toTreeish, selectedFile])

    // Create comment handlers for the selected file
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

    // Handle diff source change
    const handleDiffSourceChange = (source: DiffSource) => {
        setDiffSource(source)
    }

    if (isLoading) {
        return <div className={twMerge("flex items-center justify-center py-12 text-muted text-sm", className)}>Loading changes...</div>
    }

    if (files.length === 0) {
        return (
            <div className={twMerge("flex flex-col h-full", className)}>
                {isWorktree && (
                    <div className="px-3 py-2 border-b border-border flex items-center justify-between bg-base-200">
                        <DiffSourceSelect value={diffSource} onChange={handleDiffSourceChange} />
                        <div className="flex items-center gap-2">
                            {onRefresh && (
                                <button
                                    type="button"
                                    onClick={onRefresh}
                                    className="btn p-1 text-muted hover:text-base-content hover:bg-base-300 transition-colors"
                                    title="Refresh changes"
                                >
                                    <RefreshCw size={14} />
                                </button>
                            )}
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
                    {isWorktree ? <DiffSourceSelect value={diffSource} onChange={handleDiffSourceChange} /> : <div />}
                    <div className="flex items-center gap-2">
                        {onRefresh && (
                            <button
                                type="button"
                                onClick={onRefresh}
                                className="btn p-1 text-muted hover:text-base-content hover:bg-base-300 transition-colors"
                                title="Refresh changes"
                            >
                                <RefreshCw size={14} />
                            </button>
                        )}
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
                                        setSelectedFilePath(entry.node.file.path)
                                    }
                                }}
                                onToggle={() => {
                                    if (!entry.node.isDir) return
                                    setExpandedPaths((prev) => {
                                        const next = new Set(prev)
                                        if (next.has(entry.node.path)) {
                                            next.delete(entry.node.path)
                                        } else {
                                            next.add(entry.node.path)
                                        }
                                        return next
                                    })
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
                ) : filePair && selectedFile ? (
                    <div className="min-h-full bg-editor-background">
                        {viewMode === "current" ? (
                            <FileViewer
                                file={{
                                    name: selectedFile.path,
                                    contents: filePair.after,
                                }}
                                disableFileHeader
                                commentHandlers={commentHandlers}
                            />
                        ) : (
                            <MultiFileDiffViewer
                                oldFile={{
                                    name: selectedFile.oldPath || selectedFile.path,
                                    contents: filePair.before,
                                }}
                                newFile={{
                                    name: selectedFile.path,
                                    contents: filePair.after,
                                }}
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
