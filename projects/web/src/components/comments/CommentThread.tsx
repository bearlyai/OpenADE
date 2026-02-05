import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react"
import { useState } from "react"
import { CommentForm } from "./CommentForm"

interface CommentThreadProps {
    content: string
    startLine: number
    endLine: number
    submitted: boolean
    /** When provided, shows edit button. When undefined, editing is disabled. */
    onEdit?: (newContent: string) => void
    /** When provided, shows delete button. When undefined, deletion is disabled. */
    onDelete?: () => void
}

export function CommentThread({ content, startLine, endLine, submitted, onEdit, onDelete }: CommentThreadProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [isExpanded, setIsExpanded] = useState(false)
    const lineLabel = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`

    // Editing mode is only available when onEdit is provided and comment is not submitted
    if (isEditing && onEdit && !submitted) {
        return (
            <CommentForm
                startLine={startLine}
                endLine={endLine}
                initialContent={content}
                onSubmit={(newContent) => {
                    onEdit(newContent)
                    setIsEditing(false)
                }}
                onCancel={() => setIsEditing(false)}
            />
        )
    }

    // Submitted comments: minimal single-line view, expandable, no edit/delete
    if (submitted) {
        const truncatedContent = content.length > 50 ? `${content.slice(0, 50)}...` : content
        const singleLineContent = truncatedContent.replace(/\n/g, " ")

        return (
            <div style={{ overflow: "hidden", display: "flex", flexDirection: "row" }}>
                <div style={{ width: "100%" }}>
                    <div className="max-w-[95%] sm:max-w-[70%]" style={{ whiteSpace: "normal", margin: "8px 20px" }}>
                        <div className="bg-base-200 border border-border px-3 py-2 shadow-sm">
                            <button
                                type="button"
                                onClick={() => setIsExpanded(!isExpanded)}
                                className="btn w-full flex items-center gap-2 text-left text-base-content cursor-pointer"
                            >
                                {isExpanded ? (
                                    <ChevronDown size="0.875em" className="text-muted flex-shrink-0" />
                                ) : (
                                    <ChevronRight size="0.875em" className="text-muted flex-shrink-0" />
                                )}
                                <span className="text-xs text-muted flex-shrink-0">{lineLabel}</span>
                                <span className="text-[10px] px-1.5 py-0.5 bg-success/20 text-success flex-shrink-0">Seen by Agent</span>
                                {!isExpanded && <span className="text-xs text-muted truncate flex-1">{singleLineContent}</span>}
                            </button>
                            {isExpanded && <p className="text-base-content text-sm leading-relaxed whitespace-pre-wrap mt-2 pl-5">{content}</p>}
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    // Unseen comments: full view with edit/delete buttons
    const canEdit = !!onEdit
    const canDelete = !!onDelete

    return (
        <div style={{ overflow: "hidden", display: "flex", flexDirection: "row" }}>
            <div style={{ width: "100%" }}>
                <div className="max-w-[95%] sm:max-w-[70%]" style={{ whiteSpace: "normal", margin: 20 }}>
                    <div className="bg-base-200 border border-border p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs text-muted">{lineLabel}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 bg-warning/20 text-warning">Unseen by Agent</span>
                                </div>
                                <p className="text-base-content text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
                            </div>
                            {(canEdit || canDelete) && (
                                <div className="flex items-center gap-1 flex-shrink-0">
                                    {canEdit && (
                                        <button
                                            type="button"
                                            className="btn p-1 text-muted hover:text-base-content cursor-pointer"
                                            onClick={() => setIsEditing(true)}
                                            title="Edit comment"
                                        >
                                            <Pencil size="1em" />
                                        </button>
                                    )}
                                    {canDelete && (
                                        <button
                                            type="button"
                                            className="btn p-1 text-muted hover:text-error cursor-pointer"
                                            onClick={onDelete}
                                            title="Delete comment"
                                        >
                                            <Trash2 size="1em" />
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
