import { AlertTriangle } from "lucide-react"
import { observer } from "mobx-react"
import { useMemo } from "react"
import { twMerge } from "tailwind-merge"
import type { FileBrowserManager } from "../store/managers/FileBrowserManager"
import { type AnnotationSide, type CommentHandlers, FileViewer } from "./FilesAndDiffs"

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

export const FileContentViewer = observer(function FileContentViewer({ fileBrowser, taskId, className }: FileContentViewerProps) {
    const { viewingFile, viewingFileData, fileLoading, fileError } = fileBrowser

    // Create comment handlers for the current file
    const commentHandlers: CommentHandlers | null = useMemo(() => {
        if (!viewingFile) return null

        const sourceMatch = (c: { source: { type: string; filePath?: string } }) => c.source.type === "file" && c.source.filePath === viewingFile

        const createSource = (lineStart: number, lineEnd: number, _side: AnnotationSide) => ({
            type: "file" as const,
            filePath: viewingFile,
            lineStart,
            lineEnd,
        })

        return { taskId, sourceMatch, createSource }
    }, [taskId, viewingFile])

    if (!viewingFile) {
        return <div className={twMerge("flex flex-col h-full items-center justify-center text-muted text-sm", className)}>Select a file to view</div>
    }

    return (
        <div className={twMerge("flex flex-col h-full", className)}>
            {/* Content */}
            <div className="flex-1 overflow-auto">
                {fileLoading ? (
                    <div className="flex items-center justify-center py-12 text-muted text-sm">Loading file...</div>
                ) : fileError ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-2">
                        <AlertTriangle size={24} className="text-error" />
                        <span className="text-error text-sm">{fileError}</span>
                    </div>
                ) : viewingFileData?.tooLarge ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-2">
                        <AlertTriangle size={24} className="text-warning" />
                        <span className="text-muted text-sm">File too large to display ({formatFileSize(viewingFileData.size)})</span>
                    </div>
                ) : viewingFileData && !viewingFileData.isReadable ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-2">
                        <AlertTriangle size={24} className="text-warning" />
                        <span className="text-muted text-sm">File is not readable</span>
                    </div>
                ) : viewingFileData && viewingFileData.content !== null ? (
                    <div className="min-h-full bg-editor-background">
                        <FileViewer
                            file={{
                                name: viewingFile,
                                contents: viewingFileData.content,
                            }}
                            disableFileHeader
                            commentHandlers={commentHandlers}
                        />
                    </div>
                ) : (
                    <div className="flex items-center justify-center py-12 text-muted text-sm">Unable to load file content</div>
                )}
            </div>
        </div>
    )
})
