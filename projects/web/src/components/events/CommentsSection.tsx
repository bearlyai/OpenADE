import { ChevronDown, ChevronRight, FileCode, GitCompare, MessageCircle, MessageSquare, Terminal } from "lucide-react"
import { useState } from "react"
import type { Comment } from "../../types"
import { getFileName } from "../utils/paths"

type CommentsSectionVariant = "submitted" | "pending"

interface CommentsSectionProps {
    comments: Comment[]
    variant: CommentsSectionVariant
}

function getSourceInfo(comment: Comment): { icon: React.ReactNode; label: string } {
    switch (comment.source.type) {
        case "plan":
            return { icon: <FileCode size="0.75em" />, label: "plan" }
        case "file":
            return { icon: <FileCode size="0.75em" />, label: getFileName(comment.source.filePath) || "file" }
        case "diff":
        case "patch":
        case "edit_diff":
            return { icon: <GitCompare size="0.75em" />, label: getFileName(comment.source.filePath) || "diff" }
        case "write_diff":
            return { icon: <GitCompare size="0.75em" />, label: getFileName(comment.source.filePath) || "file" }
        case "bash_output":
            return { icon: <Terminal size="0.75em" />, label: "terminal" }
        case "llm_output":
        case "assistant_text":
            return { icon: <MessageCircle size="0.75em" />, label: "response" }
        default:
            return { icon: <MessageSquare size="0.75em" />, label: "comment" }
    }
}

function truncateContext(text: string, maxLines = 2): string {
    const lines = text.split("\n").filter((l) => l.trim())
    if (lines.length <= maxLines) return lines.join(" › ")
    return lines.slice(0, maxLines).join(" › ") + "…"
}

function CommentItem({ comment }: { comment: Comment }) {
    const { icon, label } = getSourceInfo(comment)
    const context = truncateContext(comment.selectedText.text, 2)
    const userComment = comment.content.length > 100 ? `${comment.content.slice(0, 100)}…` : comment.content

    return (
        <div className="py-2 px-3 border-b border-border/30 last:border-b-0">
            <div className="flex items-center gap-1.5 text-muted mb-1">
                {icon}
                <span className="text-[10px] font-medium uppercase tracking-wide">{label}</span>
            </div>
            {context && (
                <div className="text-[11px] text-muted font-mono mb-1.5 truncate" title={comment.selectedText.text}>
                    "{context}"
                </div>
            )}
            <div className="text-xs text-base-content">{userComment}</div>
        </div>
    )
}

export function CommentsSection({ comments, variant: _variant }: CommentsSectionProps) {
    const [expanded, setExpanded] = useState(false)

    if (comments.length === 0) return null

    const count = comments.length
    const label = count === 1 ? "1 comment" : `${count} comments`

    return (
        <div className="border-t border-border">
            <div className="border-l-2 border-info bg-info/5 mx-3 my-2">
                <button
                    type="button"
                    onClick={() => setExpanded(!expanded)}
                    className="btn w-full flex items-center gap-2 px-3 py-2 text-left text-base-content hover:bg-info/10 transition-colors cursor-pointer"
                >
                    {expanded ? (
                        <ChevronDown size="1em" className="text-muted flex-shrink-0" />
                    ) : (
                        <ChevronRight size="1em" className="text-muted flex-shrink-0" />
                    )}
                    <MessageSquare size="1em" className="text-info flex-shrink-0" />
                    <span className="text-xs text-base-content">{label}</span>
                </button>
                {expanded && (
                    <div className="border-t border-border/50">
                        {comments.map((comment) => (
                            <CommentItem key={comment.id} comment={comment} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
