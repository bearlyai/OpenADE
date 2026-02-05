import type { AnnotationSide, DiffLineAnnotation, LineAnnotation, SelectedLineRange } from "@pierre/diffs"
import { Plus } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { useCodeStore } from "../../../store/context"
import type { Comment, CommentSelectedText, CommentSource } from "../../../types"
import { CommentForm } from "../CommentForm"
import { CommentThread } from "../CommentThread"
import type { CommentAnnotationMeta } from "../types"

interface UseCommentAnnotationsParams {
    taskId: string
    sourceMatch: (comment: Comment) => boolean
    createSource: (lineStart: number, lineEnd: number, side: AnnotationSide) => CommentSource
    getSelectedText: (lineStart: number, lineEnd: number, side: AnnotationSide) => CommentSelectedText
    /** Dependencies that should clear the form when changed (e.g., file, fileDiff) */
    contentDeps: unknown[]
    /** For diff views: validate if a line is visible in the diff hunks */
    isLineValid?: (lineNumber: number, side: AnnotationSide) => boolean
    /** Whether the component uses DiffLineAnnotation (needs side) vs LineAnnotation */
    isDiffView?: boolean
    /** Default side for non-diff views */
    defaultSide?: AnnotationSide
    /** When true, comments can be viewed but not added/edited/deleted */
    readOnly?: boolean
}

interface UseCommentAnnotationsReturn {
    /** Annotations for non-diff views (File component) */
    lineAnnotations: LineAnnotation<CommentAnnotationMeta>[]
    /** Annotations for diff views (FileDiff, MultiFileDiff) */
    diffLineAnnotations: DiffLineAnnotation<CommentAnnotationMeta>[]
    selectedRange: SelectedLineRange | null
    hasOpenForm: boolean
    handleLineSelectionEnd: (range: SelectedLineRange | null) => void
    renderAnnotation: (annotation: LineAnnotation<CommentAnnotationMeta> | DiffLineAnnotation<CommentAnnotationMeta>) => ReactNode
    renderHoverUtility: () => ReactNode
}

export function useCommentAnnotations({
    taskId,
    sourceMatch,
    createSource,
    getSelectedText,
    contentDeps,
    isLineValid,
    isDiffView = false,
    defaultSide = "additions",
    readOnly = false,
}: UseCommentAnnotationsParams): UseCommentAnnotationsReturn {
    const codeStore = useCodeStore()
    const [openFormRange, setOpenFormRange] = useState<{ start: number; end: number; side: AnnotationSide } | null>(null)
    const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(null)

    // Clear form when content changes
    useEffect(() => {
        setOpenFormRange(null)
        setSelectedRange(null)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, contentDeps)

    // Get filtered comments - access observable directly for MobX tracking
    const task = codeStore.tasks.getTask(taskId)
    const comments = task ? task.comments.filter(sourceMatch) : []

    // Get included comment IDs for styling - access observable directly
    const includedCommentIds = codeStore.comments.getIncludedCommentIds(taskId)

    // Build annotations from comments
    const { lineAnnotations, diffLineAnnotations } = useMemo(() => {
        const lineAnns: LineAnnotation<CommentAnnotationMeta>[] = []
        const diffAnns: DiffLineAnnotation<CommentAnnotationMeta>[] = []

        // Existing comments
        for (const c of comments) {
            const source = c.source as { side?: AnnotationSide; lineStart?: number; lineEnd?: number }
            if (source.lineEnd === undefined) continue

            const side = source.side ?? defaultSide
            const lineStart = source.lineStart ?? source.lineEnd
            const lineEnd = source.lineEnd

            // For diff views, validate the line is in visible range
            if (isDiffView && isLineValid && !isLineValid(lineEnd, side)) continue

            const metadata: CommentAnnotationMeta = {
                id: c.id,
                content: c.content,
                startLine: lineStart,
                endLine: lineEnd,
                submitted: includedCommentIds.has(c.id),
                side,
            }

            if (isDiffView) {
                diffAnns.push({ lineNumber: lineEnd, side, metadata })
            } else {
                lineAnns.push({ lineNumber: lineEnd, metadata })
            }
        }

        // Open form annotation (only if not readOnly)
        if (!readOnly && openFormRange !== null) {
            const formValid = !isDiffView || !isLineValid || isLineValid(openFormRange.end, openFormRange.side)
            if (formValid) {
                const metadata: CommentAnnotationMeta = {
                    id: null,
                    content: "",
                    startLine: openFormRange.start,
                    endLine: openFormRange.end,
                    submitted: false,
                    side: openFormRange.side,
                }

                if (isDiffView) {
                    diffAnns.push({ lineNumber: openFormRange.end, side: openFormRange.side, metadata })
                } else {
                    lineAnns.push({ lineNumber: openFormRange.end, metadata })
                }
            }
        }

        return { lineAnnotations: lineAnns, diffLineAnnotations: diffAnns }
    }, [comments, openFormRange, includedCommentIds, isDiffView, isLineValid, defaultSide, readOnly])

    const hasOpenForm = openFormRange !== null

    const handleLineSelectionEnd = useCallback(
        (range: SelectedLineRange | null) => {
            if (readOnly) return
            setSelectedRange(range)
            if (range == null) return
            const start = Math.min(range.start, range.end)
            const end = Math.max(range.start, range.end)
            const side = range.side ?? defaultSide
            setOpenFormRange({ start, end, side })
        },
        [defaultSide, readOnly]
    )

    const handleSubmitComment = useCallback(
        async (content: string) => {
            if (readOnly || !openFormRange) return
            const source = createSource(openFormRange.start, openFormRange.end, openFormRange.side)
            const selectedText = getSelectedText(openFormRange.start, openFormRange.end, openFormRange.side)

            console.log("[CommentAnnotations] Creating comment", {
                sourceType: source.type,
                lineStart: openFormRange.start,
                lineEnd: openFormRange.end,
                side: openFormRange.side,
                selectedText,
            })

            await codeStore.comments.addComment(taskId, source, content, selectedText)
            setOpenFormRange(null)
            setSelectedRange(null)
        },
        [taskId, createSource, getSelectedText, openFormRange, readOnly]
    )

    const handleCancelComment = useCallback(() => {
        setOpenFormRange(null)
        setSelectedRange(null)
    }, [])

    const handleEditComment = useCallback(
        async (commentId: string, newContent: string) => {
            if (readOnly) return
            await codeStore.comments.editComment(taskId, commentId, newContent)
        },
        [taskId, readOnly]
    )

    const handleDeleteComment = useCallback(
        async (commentId: string) => {
            if (readOnly) return
            await codeStore.comments.removeComment(taskId, commentId)
        },
        [taskId, readOnly]
    )

    const renderAnnotation = useCallback(
        (annotation: LineAnnotation<CommentAnnotationMeta> | DiffLineAnnotation<CommentAnnotationMeta>) => {
            const { id, content, startLine, endLine, submitted } = annotation.metadata
            if (id === null) {
                return <CommentForm startLine={startLine} endLine={endLine} onSubmit={handleSubmitComment} onCancel={handleCancelComment} />
            }
            return (
                <CommentThread
                    content={content}
                    startLine={startLine}
                    endLine={endLine}
                    submitted={submitted}
                    onEdit={readOnly ? undefined : (newContent) => handleEditComment(id, newContent)}
                    onDelete={readOnly ? undefined : () => handleDeleteComment(id)}
                />
            )
        },
        [handleSubmitComment, handleCancelComment, handleEditComment, handleDeleteComment, readOnly]
    )

    const renderHoverUtility = useCallback(() => {
        return (
            <button type="button" className="flex items-center justify-center w-5 h-5 bg-primary text-primary-content hover:bg-primary/90 cursor-pointer">
                <Plus size="0.75em" />
            </button>
        )
    }, [])

    return {
        lineAnnotations,
        diffLineAnnotations,
        selectedRange,
        hasOpenForm,
        handleLineSelectionEnd,
        renderAnnotation,
        renderHoverUtility,
    }
}
