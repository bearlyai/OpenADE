import { AlertTriangle, ExternalLink, FileWarning, ImageIcon } from "lucide-react"
import { observer } from "mobx-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { twMerge } from "tailwind-merge"
import { getFilePreviewUrl } from "../electronAPI/files"
import { openPathInNativeApp } from "../electronAPI/shell"
import type { FileBrowserManager } from "../store/managers/FileBrowserManager"
import { type AnnotationSide, type CommentHandlers, FileViewer } from "./FilesAndDiffs"
import { scrollFileViewerToLine } from "./utils/fileViewerScroll"

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface FileContentViewerProps {
    fileBrowser: FileBrowserManager
    taskId: string
    className?: string
}

function OpenNativeButton({ path, label = "Open" }: { path: string; label?: string }) {
    return (
        <button
            type="button"
            className="btn inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-base-200 text-base-content hover:bg-base-300 border border-border text-xs font-medium transition-colors cursor-pointer"
            onClick={() => openPathInNativeApp(path)}
            title="Open in default app"
        >
            <ExternalLink size={14} />
            <span>{label}</span>
        </button>
    )
}

function FileMessage({
    icon,
    title,
    detail,
    action,
}: {
    icon: React.ReactNode
    title: string
    detail?: string
    action?: React.ReactNode
}) {
    return (
        <div className="flex flex-col items-center justify-center py-12 px-4 gap-3 text-center">
            {icon}
            <div>
                <div className="text-sm text-base-content">{title}</div>
                {detail && <div className="mt-1 text-xs text-muted">{detail}</div>}
            </div>
            {action}
        </div>
    )
}

function ImagePreview({ path, mediaType, size }: { path: string; mediaType?: string | null; size: number }) {
    const [failed, setFailed] = useState(false)
    const src = useMemo(() => getFilePreviewUrl(path), [path])

    useEffect(() => {
        setFailed(false)
    }, [path])

    if (failed) {
        return (
            <FileMessage
                icon={<AlertTriangle size={24} className="text-warning" />}
                title="Image preview failed"
                detail="Open it in the default app instead."
                action={<OpenNativeButton path={path} />}
            />
        )
    }

    return (
        <div className="h-full min-h-full bg-editor-background flex flex-col">
            <div className="shrink-0 flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-base-100">
                <div className="min-w-0 flex items-center gap-2 text-xs text-muted">
                    <ImageIcon size={14} className="shrink-0" />
                    <span className="truncate">{mediaType ?? "Image"}</span>
                    <span className="shrink-0">· {formatFileSize(size)}</span>
                </div>
                <OpenNativeButton path={path} />
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-4">
                <div className="min-h-full flex items-center justify-center">
                    <img
                        src={src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        onError={() => setFailed(true)}
                        className="block max-w-full max-h-[calc(100vh-12rem)] object-contain"
                    />
                </div>
            </div>
        </div>
    )
}

export const FileContentViewer = observer(function FileContentViewer({ fileBrowser, taskId, className }: FileContentViewerProps) {
    const { activeFile, activeFileData, activeLine, fileLoading, fileError } = fileBrowser
    const contentRef = useRef<HTMLDivElement>(null)

    // Create comment handlers for the current file
    const commentHandlers: CommentHandlers | null = useMemo(() => {
        if (!activeFile) return null

        const sourceMatch = (c: { source: { type: string; filePath?: string } }) => c.source.type === "file" && c.source.filePath === activeFile

        const createSource = (lineStart: number, lineEnd: number, _side: AnnotationSide) => ({
            type: "file" as const,
            filePath: activeFile,
            lineStart,
            lineEnd,
        })

        return { taskId, sourceMatch, createSource }
    }, [taskId, activeFile])

    useEffect(() => {
        if (!activeLine || fileLoading || !activeFileData?.content) return

        const timeoutId = setTimeout(() => {
            scrollFileViewerToLine(contentRef.current, activeLine)
        }, 50)

        return () => clearTimeout(timeoutId)
    }, [activeFile, activeFileData?.content, activeLine, fileLoading])

    if (!activeFile) {
        return <div className={twMerge("flex flex-col h-full items-center justify-center text-muted text-sm", className)}>Select a file to view</div>
    }

    return (
        <div className={twMerge("flex flex-col h-full", className)}>
            {/* Content */}
            <div ref={contentRef} className="flex-1 overflow-auto">
                {fileLoading ? (
                    <div className="flex items-center justify-center py-12 text-muted text-sm">Loading file...</div>
                ) : fileError ? (
                    <FileMessage icon={<AlertTriangle size={24} className="text-error" />} title={fileError} />
                ) : activeFileData && activeFileData.isReadable === false ? (
                    <FileMessage icon={<AlertTriangle size={24} className="text-warning" />} title="File is not readable" />
                ) : activeFileData?.previewKind === "image" ? (
                    <ImagePreview path={activeFileData.path} mediaType={activeFileData.mediaType} size={activeFileData.size} />
                ) : activeFileData?.tooLarge ? (
                    <FileMessage
                        icon={<AlertTriangle size={24} className="text-warning" />}
                        title={`File too large to display (${formatFileSize(activeFileData.size)})`}
                        action={<OpenNativeButton path={activeFileData.path} />}
                    />
                ) : activeFileData?.isBinary ? (
                    <FileMessage
                        icon={<FileWarning size={24} className="text-warning" />}
                        title="Binary file cannot be displayed as text"
                        detail={
                            activeFileData.mediaType
                                ? `${activeFileData.mediaType} · ${formatFileSize(activeFileData.size)}`
                                : formatFileSize(activeFileData.size)
                        }
                        action={<OpenNativeButton path={activeFileData.path} />}
                    />
                ) : activeFileData && activeFileData.content !== null ? (
                    <div className="min-h-full bg-editor-background">
                        <FileViewer
                            file={{
                                name: activeFile,
                                contents: activeFileData.content,
                            }}
                            disableFileHeader
                            commentHandlers={commentHandlers}
                            highlightLines={activeLine ? { start: activeLine, end: activeLine } : null}
                        />
                    </div>
                ) : (
                    <div className="flex items-center justify-center py-12 text-muted text-sm">Unable to load file content</div>
                )}
            </div>
        </div>
    )
})
