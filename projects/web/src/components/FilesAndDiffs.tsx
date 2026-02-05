import type { AnnotationSide, FileContents } from "@pierre/diffs"
import { type ParsedPatch, File as PierreFile, FileDiff as PierreFileDiff, MultiFileDiff as PierreMultiFileDiff } from "@pierre/diffs/react"
import { Check, Copy } from "lucide-react"
import { observer } from "mobx-react"
/**
 * FilesAndDiffs - Unified wrappers for pierre-diffs components
 *
 * This module provides themed wrappers around @pierre/diffs components with:
 * - Automatic dark/light theme synchronization via DOM detection
 * - Optional comment support via explicit `commentHandlers` prop
 *
 * Usage:
 * - For read-only display: omit commentHandlers or pass null
 * - For commenting support: pass commentHandlers object
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Z_INDEX } from "../constants"
import type { Comment, CommentSelectedText, CommentSource } from "../types"
import { useCommentAnnotations } from "./comments/hooks/useCommentAnnotations"
import { extractSelectedText, extractSelectedTextFromDiff, isLineInDiffHunks } from "./comments/utils"
import { formatMarkdownTables, shouldFormatAsMarkdown } from "./utils/markdownTableFormatter"

// ============================================================================
// Theme Detection
// ============================================================================

/**
 * Detects editor theme by reading --editor-theme CSS variable from the ref element.
 * The variable is inherited from the nearest ancestor with the .code-theme class.
 * Watches for class changes on that ancestor to detect theme switches.
 * Returns the literal theme name (e.g., "pierre-dark", "pierre-light", "tokyo-night").
 */
function useEditorTheme(ref: React.RefObject<HTMLElement | null>): string {
    const [theme, setTheme] = useState("pierre-dark")

    useEffect(() => {
        const el = ref.current
        if (!el) return

        const updateTheme = () => {
            const computed = getComputedStyle(el).getPropertyValue("--editor-theme").trim()
            setTheme(computed || "pierre-dark")
        }

        // Initial read
        updateTheme()

        // Find the nearest ancestor with the .code-theme class to observe
        const themeAncestor = el.closest(".code-theme")
        if (!themeAncestor) return

        const observer = new MutationObserver(updateTheme)
        observer.observe(themeAncestor, {
            attributes: true,
            attributeFilter: ["class"],
        })

        return () => observer.disconnect()
    }, [ref])

    return theme
}

// ============================================================================
// Copy Overlay Component
// ============================================================================

interface CopyOverlayProps {
    content: string
    children: ReactNode
}

function CopyOverlay({ content, children }: CopyOverlayProps) {
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error("Failed to copy:", err)
        }
    }

    return (
        <div className="group/copy relative">
            {children}
            <button
                type="button"
                onClick={handleCopy}
                className="absolute top-2 right-2 flex items-center justify-center p-1.5 bg-base-300/80 hover:bg-base-300 text-muted hover:text-base-content cursor-pointer opacity-0 group-hover/copy:opacity-100 [@media(hover:none)_and_(pointer:coarse)]:opacity-100 transition-opacity"
                style={{ zIndex: Z_INDEX.COPY_OVERLAY }}
                title="Copy to clipboard"
            >
                {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
            </button>
        </div>
    )
}

// ============================================================================
// Comment Handlers Type
// ============================================================================

export interface CommentHandlers {
    taskId: string
    sourceMatch: (comment: Comment) => boolean
    createSource: (lineStart: number, lineEnd: number, side: AnnotationSide) => CommentSource
    /** When true, comments are displayed but can't be added/edited/deleted */
    readOnly?: boolean
}

// ============================================================================
// File Component
// ============================================================================

type DiffStyle = "split" | "unified"

interface FileViewerProps {
    file: FileContents
    className?: string
    disableFileHeader?: boolean
    disableLineNumbers?: boolean
    /** Pass handlers to enable commenting, or null for read-only display */
    commentHandlers: CommentHandlers | null
    /** Optional line range to highlight (e.g., for search results) */
    highlightLines?: { start: number; end: number } | null
}

export const FileViewer = observer(function FileViewer({
    file,
    className,
    disableFileHeader,
    disableLineNumbers,
    commentHandlers,
    highlightLines,
}: FileViewerProps) {
    const wrapperRef = useRef<HTMLDivElement>(null)
    const theme = useEditorTheme(wrapperRef)

    // Format markdown tables for better display
    const formattedFile = useMemo((): FileContents => {
        if (!shouldFormatAsMarkdown(file.name, file.lang)) {
            return file
        }
        return {
            ...file,
            contents: formatMarkdownTables(file.contents),
        }
    }, [file])

    if (commentHandlers === null) {
        return (
            <div ref={wrapperRef}>
                <CopyOverlay content={file.contents}>
                    <PierreFile
                        file={formattedFile}
                        className={className}
                        options={{
                            theme,
                            overflow: "wrap",
                            disableFileHeader,
                            disableLineNumbers,
                            enableLineSelection: false,
                            enableHoverUtility: false,
                        }}
                        selectedLines={highlightLines}
                    />
                </CopyOverlay>
            </div>
        )
    }

    return (
        <div ref={wrapperRef}>
            <CommentableFileInner
                file={formattedFile}
                className={className}
                disableFileHeader={disableFileHeader}
                disableLineNumbers={disableLineNumbers}
                commentHandlers={commentHandlers}
                theme={theme}
                highlightLines={highlightLines}
            />
        </div>
    )
})

interface CommentableFileInnerProps {
    file: FileContents
    className?: string
    disableFileHeader?: boolean
    disableLineNumbers?: boolean
    commentHandlers: CommentHandlers
    theme: string
    highlightLines?: { start: number; end: number } | null
}

const CommentableFileInner = observer(function CommentableFileInner({
    file,
    className,
    disableFileHeader,
    disableLineNumbers,
    commentHandlers,
    theme,
    highlightLines,
}: CommentableFileInnerProps) {
    const { taskId, sourceMatch, createSource, readOnly = false } = commentHandlers
    const contentDeps = useMemo(() => [file], [file])

    const getSelectedText = useCallback(
        (lineStart: number, lineEnd: number, _side: AnnotationSide): CommentSelectedText => {
            return extractSelectedText(file.contents, lineStart, lineEnd)
        },
        [file.contents]
    )

    const { lineAnnotations, selectedRange, hasOpenForm, handleLineSelectionEnd, renderAnnotation, renderHoverUtility } = useCommentAnnotations({
        taskId,
        sourceMatch,
        createSource,
        getSelectedText,
        contentDeps,
        isDiffView: false,
        defaultSide: "additions",
        readOnly,
    })

    // Merge highlightLines with selectedRange (comment annotations take precedence)
    const mergedSelectedLines = useMemo(() => {
        if (selectedRange) return selectedRange
        return highlightLines
    }, [selectedRange, highlightLines])

    return (
        <CopyOverlay content={file.contents}>
            <PierreFile
                file={file}
                className={className}
                options={{
                    theme,
                    overflow: "wrap",
                    disableFileHeader,
                    disableLineNumbers,
                    enableLineSelection: !readOnly && !hasOpenForm,
                    enableHoverUtility: !readOnly && !hasOpenForm,
                    onLineSelectionEnd: !readOnly ? handleLineSelectionEnd : undefined,
                }}
                selectedLines={mergedSelectedLines}
                lineAnnotations={lineAnnotations}
                renderAnnotation={renderAnnotation}
                renderHoverUtility={!readOnly ? renderHoverUtility : undefined}
            />
        </CopyOverlay>
    )
})

// ============================================================================
// FileDiff Component
// ============================================================================

interface FileDiffViewerProps {
    fileDiff: ParsedPatch["files"][number]
    className?: string
    diffStyle?: DiffStyle
    /** Pass handlers to enable commenting, or null for read-only display */
    commentHandlers: CommentHandlers | null
}

export const FileDiffViewer = observer(function FileDiffViewer({ fileDiff, className, diffStyle = "split", commentHandlers }: FileDiffViewerProps) {
    const wrapperRef = useRef<HTMLDivElement>(null)
    const theme = useEditorTheme(wrapperRef)

    const copyContent = fileDiff.newLines?.join("\n") ?? ""

    if (commentHandlers === null) {
        return (
            <div ref={wrapperRef}>
                <CopyOverlay content={copyContent}>
                    <PierreFileDiff
                        fileDiff={fileDiff}
                        className={className}
                        options={{
                            theme,
                            overflow: "wrap",
                            diffStyle,
                            enableLineSelection: false,
                            enableHoverUtility: false,
                        }}
                    />
                </CopyOverlay>
            </div>
        )
    }

    return (
        <div ref={wrapperRef}>
            <CommentableFileDiffInner fileDiff={fileDiff} className={className} diffStyle={diffStyle} commentHandlers={commentHandlers} theme={theme} />
        </div>
    )
})

interface CommentableFileDiffInnerProps {
    fileDiff: ParsedPatch["files"][number]
    className?: string
    diffStyle: DiffStyle
    commentHandlers: CommentHandlers
    theme: string
}

const CommentableFileDiffInner = observer(function CommentableFileDiffInner({
    fileDiff,
    className,
    diffStyle,
    commentHandlers,
    theme,
}: CommentableFileDiffInnerProps) {
    const { taskId, sourceMatch, createSource, readOnly = false } = commentHandlers
    const contentDeps = useMemo(() => [fileDiff], [fileDiff])

    const isLineValid = useCallback((lineNumber: number, side: AnnotationSide) => isLineInDiffHunks(fileDiff, lineNumber, side), [fileDiff])

    const getSelectedText = useCallback(
        (lineStart: number, lineEnd: number, side: AnnotationSide): CommentSelectedText => {
            return extractSelectedTextFromDiff(fileDiff, lineStart, lineEnd, side)
        },
        [fileDiff]
    )

    const { diffLineAnnotations, selectedRange, hasOpenForm, handleLineSelectionEnd, renderAnnotation, renderHoverUtility } = useCommentAnnotations({
        taskId,
        sourceMatch,
        createSource,
        getSelectedText,
        contentDeps,
        isLineValid,
        isDiffView: true,
        defaultSide: "additions",
        readOnly,
    })

    const copyContent = fileDiff.newLines?.join("\n") ?? ""

    return (
        <CopyOverlay content={copyContent}>
            <PierreFileDiff
                fileDiff={fileDiff}
                className={className}
                options={{
                    theme,
                    overflow: "wrap",
                    diffStyle,
                    enableLineSelection: !readOnly && !hasOpenForm,
                    enableHoverUtility: !readOnly && !hasOpenForm,
                    onLineSelectionEnd: !readOnly ? handleLineSelectionEnd : undefined,
                }}
                selectedLines={selectedRange}
                lineAnnotations={diffLineAnnotations}
                renderAnnotation={renderAnnotation}
                renderHoverUtility={!readOnly ? renderHoverUtility : undefined}
            />
        </CopyOverlay>
    )
})

// ============================================================================
// MultiFileDiff Component
// ============================================================================

interface MultiFileDiffViewerProps {
    oldFile: FileContents
    newFile: FileContents
    className?: string
    diffStyle?: DiffStyle
    disableFileHeader?: boolean
    /** Pass handlers to enable commenting, or null for read-only display */
    commentHandlers: CommentHandlers | null
}

export const MultiFileDiffViewer = observer(function MultiFileDiffViewer({
    oldFile,
    newFile,
    className,
    diffStyle = "split",
    disableFileHeader,
    commentHandlers,
}: MultiFileDiffViewerProps) {
    const wrapperRef = useRef<HTMLDivElement>(null)
    const theme = useEditorTheme(wrapperRef)

    // Format markdown tables for better display
    const formattedOldFile = useMemo((): FileContents => {
        if (!shouldFormatAsMarkdown(oldFile.name, oldFile.lang)) {
            return oldFile
        }
        return {
            ...oldFile,
            contents: formatMarkdownTables(oldFile.contents),
        }
    }, [oldFile])

    const formattedNewFile = useMemo((): FileContents => {
        if (!shouldFormatAsMarkdown(newFile.name, newFile.lang)) {
            return newFile
        }
        return {
            ...newFile,
            contents: formatMarkdownTables(newFile.contents),
        }
    }, [newFile])

    if (commentHandlers === null) {
        return (
            <div ref={wrapperRef}>
                <CopyOverlay content={newFile.contents}>
                    <PierreMultiFileDiff
                        oldFile={formattedOldFile}
                        newFile={formattedNewFile}
                        className={className}
                        options={{
                            theme,
                            overflow: "wrap",
                            diffStyle,
                            disableFileHeader,
                            enableLineSelection: false,
                            enableHoverUtility: false,
                        }}
                    />
                </CopyOverlay>
            </div>
        )
    }

    return (
        <div ref={wrapperRef}>
            <CommentableMultiFileDiffInner
                oldFile={formattedOldFile}
                newFile={formattedNewFile}
                className={className}
                diffStyle={diffStyle}
                disableFileHeader={disableFileHeader}
                commentHandlers={commentHandlers}
                theme={theme}
            />
        </div>
    )
})

interface CommentableMultiFileDiffInnerProps {
    oldFile: FileContents
    newFile: FileContents
    className?: string
    diffStyle: DiffStyle
    disableFileHeader?: boolean
    commentHandlers: CommentHandlers
    theme: string
}

const CommentableMultiFileDiffInner = observer(function CommentableMultiFileDiffInner({
    oldFile,
    newFile,
    className,
    diffStyle,
    disableFileHeader,
    commentHandlers,
    theme,
}: CommentableMultiFileDiffInnerProps) {
    const { taskId, sourceMatch, createSource, readOnly = false } = commentHandlers
    const contentDeps = useMemo(() => [oldFile, newFile], [oldFile, newFile])

    const getSelectedText = useCallback(
        (lineStart: number, lineEnd: number, side: AnnotationSide): CommentSelectedText => {
            const contents = side === "deletions" ? oldFile.contents : newFile.contents
            return extractSelectedText(contents, lineStart, lineEnd)
        },
        [oldFile.contents, newFile.contents]
    )

    const { diffLineAnnotations, selectedRange, hasOpenForm, handleLineSelectionEnd, renderAnnotation, renderHoverUtility } = useCommentAnnotations({
        taskId,
        sourceMatch,
        createSource,
        getSelectedText,
        contentDeps,
        isDiffView: true,
        defaultSide: "additions",
        readOnly,
    })

    return (
        <CopyOverlay content={newFile.contents}>
            <PierreMultiFileDiff
                oldFile={oldFile}
                newFile={newFile}
                className={className}
                options={{
                    theme,
                    overflow: "wrap",
                    diffStyle,
                    disableFileHeader,
                    enableLineSelection: !readOnly && !hasOpenForm,
                    enableHoverUtility: !readOnly && !hasOpenForm,
                    onLineSelectionEnd: !readOnly ? handleLineSelectionEnd : undefined,
                }}
                selectedLines={selectedRange}
                lineAnnotations={diffLineAnnotations}
                renderAnnotation={renderAnnotation}
                renderHoverUtility={!readOnly ? renderHoverUtility : undefined}
            />
        </CopyOverlay>
    )
})

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { parsePatchFiles } from "@pierre/diffs"
export type { ParsedPatch } from "@pierre/diffs/react"
export type { AnnotationSide } from "@pierre/diffs"
