import { ChevronLeft, ChevronRight, Columns2, FileCode, Loader2, Rows2 } from "lucide-react"
import { observer } from "mobx-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { twMerge } from "tailwind-merge"
import { type SnapshotPatchFile, type SnapshotPatchIndex, snapshotsApi } from "../electronAPI/snapshots"
import { useCodeStore } from "../store/context"
import { type AnnotationSide, type CommentHandlers, FileDiffViewer, type ParsedPatch, parsePatchFiles } from "./FilesAndDiffs"
import { VirtualizedFixedList } from "./ui/VirtualizedFixedList"
import { getFileDir, getFileName } from "./utils/paths"

type DiffStyle = "split" | "unified"

interface FileInfo {
    id: string
    name: string
    oldPath?: string
    insertions: number
    deletions: number
    changedLines: number
    hunkCount: number
    binary: boolean
    patchStart?: number
    patchEnd?: number
    fileDiff?: ParsedPatch["files"][number]
}

interface LegacyFileStats {
    name: string
    insertions: number
    deletions: number
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

function getLegacyFileStats(patch: string): LegacyFileStats[] {
    const files: LegacyFileStats[] = []
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
            insertions += 1
        } else if (line.startsWith("-") && !line.startsWith("---")) {
            deletions += 1
        }
    }

    if (currentFile) {
        files.push({ name: currentFile, insertions, deletions })
    }

    return files
}

interface ViewPatchProps {
    patch?: string
    patchFileId?: string
    patchIndex?: SnapshotPatchIndex | null
    indexLoading?: boolean
    className?: string
    taskId: string
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

function getLegacyFileEntries(patch: string): FileInfo[] {
    const parsedPatches = parsePatchFiles(patch)
    const fileStats = getLegacyFileStats(patch)
    const entries: FileInfo[] = []
    let statsIndex = 0

    for (const parsedPatch of parsedPatches) {
        for (const fileDiff of parsedPatch.files) {
            const stats = fileStats[statsIndex] ?? { name: fileDiff.name, insertions: 0, deletions: 0 }
            statsIndex += 1

            entries.push({
                id: String(entries.length),
                name: stats.name,
                insertions: stats.insertions,
                deletions: stats.deletions,
                changedLines: stats.insertions + stats.deletions,
                hunkCount: fileDiff.hunks.length,
                binary: false,
                fileDiff,
            })
        }
    }

    return entries
}

function getIndexedFileEntries(index: SnapshotPatchIndex | null): FileInfo[] {
    if (!index) return []

    return index.files.map((file: SnapshotPatchFile) => ({
        id: file.id,
        name: file.path,
        oldPath: file.oldPath,
        insertions: file.insertions,
        deletions: file.deletions,
        changedLines: file.changedLines,
        hunkCount: file.hunkCount,
        binary: file.binary,
        patchStart: file.patchStart,
        patchEnd: file.patchEnd,
    }))
}

function isHeavyFile(file: FileInfo | undefined): boolean {
    if (!file) return false
    const patchBytes = (file.patchEnd ?? 0) - (file.patchStart ?? 0)
    return patchBytes > 256 * 1024 || file.changedLines > 4_000 || file.hunkCount > 50
}

export const ViewPatch = observer(function ViewPatch({
    patch = "",
    patchFileId,
    patchIndex,
    indexLoading = false,
    className,
    taskId,
    snapshotEventId,
}: ViewPatchProps) {
    const codeStore = useCodeStore()
    const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
    const [selectedPatch, setSelectedPatch] = useState("")
    const [selectedPatchLoading, setSelectedPatchLoading] = useState(false)
    const [selectedPatchError, setSelectedPatchError] = useState(false)
    const [renderLargeDiffKey, setRenderLargeDiffKey] = useState<string | null>(null)
    const tabsContainerRef = useRef<HTMLDivElement>(null)
    const patchCacheRef = useRef(new Map<string, string>())

    const viewMode = codeStore.ui.viewMode
    const diffStyle: DiffStyle = viewMode === "current" ? "unified" : viewMode
    const setDiffStyle = (style: DiffStyle) => codeStore.ui.setViewMode(style)
    const indexedFiles = useMemo(() => getIndexedFileEntries(patchIndex ?? null), [patchIndex])
    const legacyFiles = useMemo(() => {
        if (patchFileId || !patch) {
            return []
        }
        return getLegacyFileEntries(patch)
    }, [patchFileId, patch])
    const allFiles = patchFileId ? indexedFiles : legacyFiles

    useEffect(() => {
        if (allFiles.length === 0) {
            setSelectedFileId(null)
            return
        }

        if (!selectedFileId || !allFiles.some((file) => file.id === selectedFileId)) {
            setSelectedFileId(allFiles[0].id)
        }
    }, [allFiles, selectedFileId])

    const selectedIndex = allFiles.findIndex((file) => file.id === selectedFileId)
    const selectedFile = selectedIndex >= 0 ? allFiles[selectedIndex] : allFiles[0]
    const showSidebar = allFiles.length > 5
    const largeDiffKey = selectedFile ? `${selectedFile.id}:${selectedFile.changedLines}:${selectedFile.hunkCount}` : null
    const deferLargeDiff = patchFileId !== undefined && isHeavyFile(selectedFile) && renderLargeDiffKey !== largeDiffKey

    useEffect(() => {
        setRenderLargeDiffKey(null)
    }, [selectedFile?.id])

    useEffect(() => {
        if (!showSidebar && tabsContainerRef.current && selectedIndex >= 0) {
            const container = tabsContainerRef.current
            const selectedTab = container.children[selectedIndex] as HTMLElement | undefined
            if (selectedTab) {
                const containerRect = container.getBoundingClientRect()
                const tabRect = selectedTab.getBoundingClientRect()
                if (tabRect.left < containerRect.left || tabRect.right > containerRect.right) {
                    selectedTab.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
                }
            }
        }
    }, [selectedIndex, showSidebar])

    useEffect(() => {
        if (!patchFileId || !selectedFile || selectedFile.patchStart === undefined || selectedFile.patchEnd === undefined) {
            setSelectedPatch("")
            setSelectedPatchLoading(false)
            setSelectedPatchError(false)
            return
        }

        if (deferLargeDiff) {
            setSelectedPatch("")
            setSelectedPatchLoading(false)
            setSelectedPatchError(false)
            return
        }

        const cachedPatch = patchCacheRef.current.get(selectedFile.id)
        if (cachedPatch !== undefined) {
            setSelectedPatch(cachedPatch)
            setSelectedPatchLoading(false)
            setSelectedPatchError(false)
            return
        }

        let cancelled = false
        setSelectedPatchLoading(true)
        setSelectedPatchError(false)

        void snapshotsApi
            .loadPatchSlice(patchFileId, selectedFile.patchStart, selectedFile.patchEnd)
            .then((patchSlice) => {
                if (cancelled) return
                const nextPatch = patchSlice ?? ""
                patchCacheRef.current.set(selectedFile.id, nextPatch)
                setSelectedPatch(nextPatch)
                setSelectedPatchLoading(false)
            })
            .catch((error) => {
                console.error("[ViewPatch] Failed to load patch slice:", error)
                if (cancelled) return
                setSelectedPatch("")
                setSelectedPatchLoading(false)
                setSelectedPatchError(true)
            })

        return () => {
            cancelled = true
        }
    }, [deferLargeDiff, patchFileId, selectedFile])

    const selectedFileDiff = useMemo(() => {
        if (!selectedFile) return { fileDiff: null as ParsedPatch["files"][number] | null, parseError: false }

        if (!patchFileId) {
            return {
                fileDiff: selectedFile.fileDiff ?? null,
                parseError: false,
            }
        }

        if (!selectedPatch) {
            return { fileDiff: null, parseError: false }
        }

        try {
            const parsedPatches = parsePatchFiles(selectedPatch, selectedFile.name)
            for (const parsedPatch of parsedPatches) {
                if (parsedPatch.files[0]) {
                    return { fileDiff: parsedPatch.files[0], parseError: false }
                }
            }
            return { fileDiff: null, parseError: false }
        } catch (error) {
            console.error("[ViewPatch] Failed to parse patch slice:", error)
            return { fileDiff: null, parseError: true }
        }
    }, [patchFileId, selectedFile, selectedPatch])

    const commentHandlers: CommentHandlers | null = useMemo(() => {
        if (!selectedFile) return null
        const filePath = selectedFile.name

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
    }, [taskId, snapshotEventId, selectedFile?.name])

    const handlePrev = () => setSelectedFileId((currentId) => allFiles[Math.max(0, (selectedIndex >= 0 ? selectedIndex : 0) - 1)]?.id ?? currentId)
    const handleNext = () =>
        setSelectedFileId((currentId) => allFiles[Math.min(allFiles.length - 1, (selectedIndex >= 0 ? selectedIndex : 0) + 1)]?.id ?? currentId)

    if (patchFileId && patchIndex === null) {
        if (!indexLoading) {
            return <div className={twMerge("text-muted italic p-4", className)}>Patch index unavailable</div>
        }
        return (
            <div className={twMerge("px-4 py-6 text-muted text-sm text-center flex items-center justify-center gap-2", className)}>
                <Loader2 size="1em" className="animate-spin" />
                Loading patch index...
            </div>
        )
    }

    if (allFiles.length === 0) {
        return <div className={twMerge("text-muted italic p-4", className)}>No changes to display</div>
    }

    return (
        <div className={twMerge("flex flex-col h-full", className)}>
            <div className="flex items-center border-b border-border bg-base-200/50 overflow-hidden">
                {showSidebar ? (
                    <div className="flex items-center gap-2 px-3 py-2 flex-1 min-w-0">
                        <FileCode size="1em" className="flex-shrink-0 text-muted" />
                        <span className="font-medium text-sm truncate">{selectedFile?.name}</span>
                        <span className="text-xs text-muted">
                            ({selectedIndex + 1} of {allFiles.length})
                        </span>
                    </div>
                ) : (
                    <>
                        <button
                            type="button"
                            onClick={handlePrev}
                            disabled={selectedIndex <= 0}
                            className="btn p-2 text-muted hover:text-base-content disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft size="1em" />
                        </button>
                        <div ref={tabsContainerRef} className="flex-1 flex overflow-x-auto scrollbar-hide">
                            {allFiles.map((file) => (
                                <FileTab key={file.id} file={file} selected={file.id === selectedFile?.id} onClick={() => setSelectedFileId(file.id)} />
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

            <div className="flex-1 flex overflow-hidden">
                {showSidebar && (
                    <VirtualizedFixedList
                        items={allFiles}
                        rowHeight={56}
                        className="w-64 flex-shrink-0 border-r border-border overflow-y-auto bg-base-200/30"
                        renderRow={(file) => <FileListItem file={file} selected={file.id === selectedFile?.id} onClick={() => setSelectedFileId(file.id)} />}
                    />
                )}

                <div className="flex-1 overflow-auto">
                    {selectedFile?.binary ? (
                        <div className="px-4 py-6 text-muted text-sm text-center">Binary file — patch preview unavailable</div>
                    ) : deferLargeDiff ? (
                        <div className="px-4 py-6 flex flex-col items-center gap-3 text-sm">
                            <div className="text-base-content font-medium">Large diff deferred</div>
                            <div className="text-muted text-center">
                                {selectedFile.changedLines} changed lines across {selectedFile.hunkCount} hunks.
                            </div>
                            <button
                                type="button"
                                onClick={() => setRenderLargeDiffKey(largeDiffKey)}
                                className="btn px-3 py-1.5 text-xs bg-base-300 hover:bg-base-200 text-base-content"
                            >
                                Render diff
                            </button>
                        </div>
                    ) : selectedPatchLoading ? (
                        <div className="px-4 py-6 text-muted text-sm text-center flex items-center justify-center gap-2">
                            <Loader2 size="1em" className="animate-spin" />
                            Loading file diff...
                        </div>
                    ) : selectedPatchError ? (
                        <div className="px-4 py-6 text-muted text-sm text-center">Could not load patch preview for this file</div>
                    ) : selectedFileDiff.parseError ? (
                        <div className="px-4 py-6 text-muted text-sm text-center">Large diff preview unavailable for this file</div>
                    ) : selectedFileDiff.fileDiff ? (
                        <div className="min-h-full bg-editor-background">
                            {isHeavyFile(selectedFile) && (
                                <div className="px-3 py-2 border-b border-border bg-base-200 text-xs text-muted">
                                    Simplified rendering enabled for a large patch slice ({selectedFile.changedLines} changed lines)
                                </div>
                            )}
                            <FileDiffViewer
                                fileDiff={selectedFileDiff.fileDiff}
                                diffStyle={diffStyle}
                                commentHandlers={commentHandlers}
                                options={
                                    isHeavyFile(selectedFile)
                                        ? { lineDiffType: "none", maxLineDiffLength: 0, tokenizeMaxLineLength: 0, overflow: "scroll" }
                                        : undefined
                                }
                            />
                        </div>
                    ) : (
                        <div className="px-4 py-6 text-muted text-sm text-center">No diff content for selected file</div>
                    )}
                </div>
            </div>
        </div>
    )
})
