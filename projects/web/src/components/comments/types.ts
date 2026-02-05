import type { AnnotationSide } from "@pierre/diffs"

export interface CommentAnnotationMeta {
    id: string | null // null = new comment form, string = existing comment
    content: string
    startLine: number
    endLine: number
    submitted: boolean
    side: AnnotationSide
}
