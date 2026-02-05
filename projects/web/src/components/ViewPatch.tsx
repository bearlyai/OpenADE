import { ChevronLeft, ChevronRight, Columns2, FileCode, Rows2 } from "lucide-react"
import { observer } from "mobx-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { twMerge } from "tailwind-merge"
import { useCodeStore } from "../store/context"
import { type AnnotationSide, type CommentHandlers, FileDiffViewer, type ParsedPatch, parsePatchFiles } from "./FilesAndDiffs"
import { getFileDir, getFileName } from "./utils/paths"

type DiffStyle = "split" | "unified"

interface FileInfo {
    name: string
    insertions: number
    deletions: number
}

function getFileStats(patch: string): FileInfo[] {
    const files: FileInfo[] = []
    const lines = patch.split("\n")

    let currentFile: string | null = null
    let insertions = 0
    let deletions = 0

    for (const line of lines) {
        if (line.startsWith("diff --git")) {
            if (currentFile) {
                files.push({ name: currentFile, insertions, deletions })
            }
            const match = line.match(/diff --git a\/(.+) b\//)
            currentFile = match ? match[1] : "unknown"
            insertions = 0
            deletions = 0
        } else if (line.startsWith("+") && !line.startsWith("+++")) {
            insertions++
        } else if (line.startsWith("-") && !line.startsWith("---")) {
            deletions++
        }
    }

    if (currentFile) {
        files.push({ name: currentFile, insertions, deletions })
    }

    return files
}

interface FileTabProps {
    file: FileInfo
    selected: boolean
    onClick: () => void
}

function FileTab({ file, selected, onClick }: FileTabProps) {
    const fileName = getFileName(file.name)

    return (
        <button
            type="button"
            onClick={onClick}
            className={twMerge(
                "btn flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors",
                selected ? "border-primary text-base-content bg-base-300" : "border-transparent text-muted hover:text-base-content hover:bg-base-200"
            )}
            title={file.name}
        >
            <FileCode size="1em" className="flex-shrink-0" />
            <span className="font-medium">{fileName}</span>
            <span className="flex items-center gap-1 text-xs">
                {file.insertions > 0 && <span className="text-success">+{file.insertions}</span>}
                {file.deletions > 0 && <span className="text-error">-{file.deletions}</span>}
            </span>
        </button>
    )
}

interface FileListItemProps {
    file: FileInfo
    selected: boolean
    onClick: () => void
}

function FileListItem({ file, selected, onClick }: FileListItemProps) {
    const fileName = getFileName(file.name)
    const fileDir = getFileDir(file.name)

    return (
        <button
            type="button"
            onClick={onClick}
            className={twMerge(
                "btn w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
                selected ? "bg-primary/10 text-base-content" : "text-muted hover:text-base-content hover:bg-base-200"
            )}
            title={file.name}
        >
            <FileCode size="1em" className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{fileName}</div>
                {fileDir && <div className="text-xs text-muted truncate">{fileDir}</div>}
            </div>
            <span className="flex items-center gap-1 text-xs flex-shrink-0">
                {file.insertions > 0 && <span className="text-success">+{file.insertions}</span>}
                {file.deletions > 0 && <span className="text-error">-{file.deletions}</span>}
            </span>
        </button>
    )
}

interface FileDiffEntry {
    fileDiff: ParsedPatch["files"][number]
    info: FileInfo
}

interface ViewPatchProps {
    patch: string
    className?: string
    /** Task ID - required for comment support */
    taskId: string
    /** Snapshot event ID - required for patch comments */
    snapshotEventId: string
}

function DiffStyleToggle({ value, onChange }: { value: DiffStyle; onChange: (v: DiffStyle) => void }) {
    return (
        <div className="flex items-center border border-border">
            <button
                type="button"
                onClick={() => onChange("split")}
                className={twMerge(
                    "btn flex items-center gap-1.5 px-2 py-1 text-xs font-medium transition-colors",
                    value === "split" ? "bg-base-300 text-base-content" : "text-muted hover:text-base-content"
                )}
                title="Split view"
            >
                <Columns2 size="1em" />
                Split
            </button>
            <button
                type="button"
                onClick={() => onChange("unified")}
                className={twMerge(
                    "btn flex items-center gap-1.5 px-2 py-1 text-xs font-medium transition-colors",
                    value === "unified" ? "bg-base-300 text-base-content" : "text-muted hover:text-base-content"
                )}
                title="Unified view"
            >
                <Rows2 size="1em" />
                Unified
            </button>
        </div>
    )
}

export const ViewPatch = observer(function ViewPatch({ patch, className, taskId, snapshotEventId }: ViewPatchProps) {
    const codeStore = useCodeStore()
    const [selectedIndex, setSelectedIndex] = useState(0)
    const tabsContainerRef = useRef<HTMLDivElement>(null)

    const viewMode = codeStore.ui.viewMode
    const diffStyle: DiffStyle = viewMode === "current" ? "unified" : viewMode
    const setDiffStyle = (style: DiffStyle) => codeStore.ui.setViewMode(style)

    const allFiles = useMemo((): FileDiffEntry[] => {
        const parsedPatches = parsePatchFiles(patch)
        const fileStats = getFileStats(patch)
        const entries: FileDiffEntry[] = []
        let statsIndex = 0

        for (const p of parsedPatches) {
            for (const fileDiff of p.files) {
                entries.push({
                    fileDiff,
                    info: fileStats[statsIndex] || { name: fileDiff.name, insertions: 0, deletions: 0 },
                })
                statsIndex++
            }
        }

        return entries
    }, [patch])

    const selectedFile = allFiles[selectedIndex]
    const showSidebar = allFiles.length > 5

    // Scroll selected tab into view
    useEffect(() => {
        if (!showSidebar && tabsContainerRef.current) {
            const container = tabsContainerRef.current
            const selectedTab = container.children[selectedIndex] as HTMLElement
            if (selectedTab) {
                const containerRect = container.getBoundingClientRect()
                const tabRect = selectedTab.getBoundingClientRect()
                if (tabRect.left < containerRect.left || tabRect.right > containerRect.right) {
                    selectedTab.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
                }
            }
        }
    }, [selectedIndex, showSidebar])

    const handlePrev = () => setSelectedIndex((i) => Math.max(0, i - 1))
    const handleNext = () => setSelectedIndex((i) => Math.min(allFiles.length - 1, i + 1))

    if (allFiles.length === 0) {
        return <div className={twMerge("text-muted italic p-4", className)}>No changes to display</div>
    }

    // Create comment handlers for the selected file
    const commentHandlers: CommentHandlers | null = useMemo(() => {
        if (!selectedFile) return null
        const filePath = selectedFile.info.name

        const sourceMatch = (c: { source: { type: string; snapshotEventId?: string; filePath?: string } }) =>
            c.source.type === "patch" && c.source.snapshotEventId === snapshotEventId && c.source.filePath === filePath

        const createSource = (lineStart: number, lineEnd: number, side: AnnotationSide) => ({
            type: "patch" as const,
            snapshotEventId,
            filePath,
            side,
            lineStart,
            lineEnd,
        })

        return { taskId, sourceMatch, createSource }
    }, [taskId, snapshotEventId, selectedFile?.info.name])

    return (
        <div className={twMerge("flex flex-col h-full", className)}>
            {/* File navigation header */}
            <div className="flex items-center border-b border-border bg-base-200/50 overflow-hidden">
                {showSidebar ? (
                    // Sidebar mode for many files
                    <div className="flex items-center gap-2 px-3 py-2 flex-1 min-w-0">
                        <FileCode size="1em" className="flex-shrink-0 text-muted" />
                        <span className="font-medium text-sm truncate">{selectedFile?.info.name}</span>
                        <span className="text-xs text-muted">
                            ({selectedIndex + 1} of {allFiles.length})
                        </span>
                    </div>
                ) : (
                    // Tab mode for few files
                    <>
                        <button
                            type="button"
                            onClick={handlePrev}
                            disabled={selectedIndex === 0}
                            className="btn p-2 text-muted hover:text-base-content disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft size="1em" />
                        </button>
                        <div ref={tabsContainerRef} className="flex-1 flex overflow-x-auto scrollbar-hide">
                            {allFiles.map((entry, i) => (
                                <FileTab key={entry.info.name} file={entry.info} selected={i === selectedIndex} onClick={() => setSelectedIndex(i)} />
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={handleNext}
                            disabled={selectedIndex === allFiles.length - 1}
                            className="btn p-2 text-muted hover:text-base-content disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <ChevronRight size="1em" />
                        </button>
                    </>
                )}
                <div className="px-2">
                    <DiffStyleToggle value={diffStyle} onChange={setDiffStyle} />
                </div>
            </div>

            {/* Main content area */}
            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar (when many files) */}
                {showSidebar && (
                    <div className="w-64 flex-shrink-0 border-r border-border overflow-y-auto bg-base-200/30">
                        {allFiles.map((entry, i) => (
                            <FileListItem key={entry.info.name} file={entry.info} selected={i === selectedIndex} onClick={() => setSelectedIndex(i)} />
                        ))}
                    </div>
                )}

                {/* Diff view */}
                <div className="flex-1 overflow-auto">
                    {selectedFile && <FileDiffViewer fileDiff={selectedFile.fileDiff} diffStyle={diffStyle} commentHandlers={commentHandlers} />}
                </div>
            </div>
        </div>
    )
})
