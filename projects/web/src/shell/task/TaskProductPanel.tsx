import { CheckCircle2, Star, Trash2 } from "lucide-react"
import type {
    OpenADETask,
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadResult,
    OpenADETaskGitChangedFile,
    OpenADETaskGitLogResult,
} from "../../../../openade-module/src"
import { TaskGitPanel } from "./TaskGitPanel"
import { taskCommandLabel } from "./taskCommands"

export type TaskReviewType = "plan" | "work"

export interface OpenADETaskCommentView {
    id: string
    content: string
    createdAt?: string
    updatedAt?: string
    authorLabel?: string
}

function recordValue(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null
}

export function openADETaskCommentView(value: unknown): OpenADETaskCommentView | null {
    const record = recordValue(value)
    if (!record || typeof record.id !== "string") return null
    const author = recordValue(record.author) ?? recordValue(record.createdBy)
    const authorLabel = typeof author?.email === "string" ? author.email : typeof author?.id === "string" ? author.id : undefined
    return {
        id: record.id,
        content: typeof record.content === "string" ? record.content : typeof record.body === "string" ? record.body : "",
        createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
        authorLabel,
    }
}

export function openADETaskComments(task: Pick<OpenADETask, "comments"> | null | undefined): OpenADETaskCommentView[] {
    return (task?.comments ?? []).map(openADETaskCommentView).filter((comment): comment is OpenADETaskCommentView => comment !== null)
}

export function TaskProductPanel({
    task,
    titleDraft,
    comments,
    commentDraft,
    editingCommentId,
    editingCommentDraft,
    reviewInstructions,
    taskChanges,
    taskGitLog,
    taskChangesLoading,
    taskDiff,
    taskDiffActionPath,
    isSubmitting,
    onTitleChange,
    onSaveTitle,
    onToggleClosed,
    onDeleteTask,
    onCommentDraftChange,
    onCreateComment,
    onStartEditComment,
    onEditingCommentDraftChange,
    onSaveComment,
    onCancelEditComment,
    onDeleteComment,
    onCancelQueuedTurn,
    onReviewInstructionsChange,
    onStartReview,
    onRefreshTaskGit,
    onReadTaskDiff,
}: {
    task: OpenADETask
    titleDraft: string
    comments: OpenADETaskCommentView[]
    commentDraft: string
    editingCommentId: string | null
    editingCommentDraft: string
    reviewInstructions: string
    taskChanges: OpenADETaskChangesReadResult | null
    taskGitLog: OpenADETaskGitLogResult | null
    taskChangesLoading: boolean
    taskDiff: OpenADETaskDiffReadResult | null
    taskDiffActionPath: string | null
    isSubmitting: boolean
    onTitleChange: (value: string) => void
    onSaveTitle: () => void
    onToggleClosed: () => void
    onDeleteTask: () => void
    onCommentDraftChange: (value: string) => void
    onCreateComment: () => void
    onStartEditComment: (comment: OpenADETaskCommentView) => void
    onEditingCommentDraftChange: (value: string) => void
    onSaveComment: (commentId: string) => void
    onCancelEditComment: () => void
    onDeleteComment: (commentId: string) => void
    onCancelQueuedTurn: (queuedTurnId: string) => void
    onReviewInstructionsChange: (value: string) => void
    onStartReview: (reviewType: TaskReviewType) => void
    onRefreshTaskGit: () => void
    onReadTaskDiff: (file: OpenADETaskGitChangedFile) => void
}) {
    const queuedTurns = task.queuedTurns ?? []
    const hasQueuedTurns = queuedTurns.length > 0
    const titleChanged = titleDraft.trim().length > 0 && titleDraft.trim() !== task.title

    return (
        <section className="mb-3 flex flex-col gap-3 border border-border bg-base-200/20 p-3">
            <div className="flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">Task</div>
                <div className="flex min-w-0 gap-2">
                    <input
                        value={titleDraft}
                        onChange={(event) => onTitleChange(event.target.value)}
                        className="input h-10 min-w-0 flex-1 border border-border bg-base-100 px-2 text-sm"
                    />
                    <button
                        type="button"
                        onClick={onSaveTitle}
                        disabled={!titleChanged}
                        className="btn h-10 shrink-0 bg-base-300 px-3 text-xs disabled:opacity-50"
                    >
                        Save
                    </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={onToggleClosed} className="btn flex h-10 items-center justify-center gap-2 bg-base-300 px-3 text-xs">
                        <CheckCircle2 size={14} />
                        {task.closed ? "Reopen" : "Close"}
                    </button>
                    <button
                        type="button"
                        onClick={onDeleteTask}
                        className="btn flex h-10 items-center justify-center gap-2 bg-error/10 px-3 text-xs text-error"
                    >
                        <Trash2 size={14} />
                        Delete
                    </button>
                </div>
            </div>

            <div className="flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">Review</div>
                <textarea
                    value={reviewInstructions}
                    onChange={(event) => onReviewInstructionsChange(event.target.value)}
                    placeholder="Optional review notes"
                    className="input min-h-16 w-full resize-none border border-border bg-base-100 p-2 text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={() => onStartReview("plan")}
                        disabled={isSubmitting}
                        className="btn flex h-10 items-center justify-center gap-2 bg-base-300 px-3 text-xs disabled:opacity-50"
                    >
                        <Star size={14} />
                        Review Plan
                    </button>
                    <button
                        type="button"
                        onClick={() => onStartReview("work")}
                        disabled={isSubmitting}
                        className="btn flex h-10 items-center justify-center gap-2 bg-base-300 px-3 text-xs disabled:opacity-50"
                    >
                        <Star size={14} />
                        Review Work
                    </button>
                </div>
            </div>

            <TaskGitPanel
                changes={taskChanges}
                gitLog={taskGitLog}
                loading={taskChangesLoading}
                diff={taskDiff}
                actionPath={taskDiffActionPath}
                onRefresh={onRefreshTaskGit}
                onReadDiff={onReadTaskDiff}
            />

            {hasQueuedTurns && (
                <div className="flex flex-col gap-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted">Queued turns</div>
                    <div className="flex flex-col gap-2">
                        {queuedTurns.map((turn) => (
                            <div key={turn.id} className="flex min-w-0 items-start gap-2 border border-border bg-base-100/60 p-2">
                                <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span className="shrink-0 text-xs font-semibold uppercase text-base-content">{taskCommandLabel(turn.type)}</span>
                                        <span className="min-w-0 truncate text-xs text-muted">{turn.status}</span>
                                    </div>
                                    <div className="mt-1 line-clamp-2 text-xs text-muted">{turn.input}</div>
                                </div>
                                {turn.status === "queued" && (
                                    <button
                                        type="button"
                                        onClick={() => onCancelQueuedTurn(turn.id)}
                                        className="btn h-8 shrink-0 bg-error/10 px-2 text-xs text-error"
                                    >
                                        Cancel
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">Comments</div>
                <div className="flex min-w-0 gap-2">
                    <input
                        value={commentDraft}
                        onChange={(event) => onCommentDraftChange(event.target.value)}
                        placeholder="Add a comment"
                        className="input h-10 min-w-0 flex-1 border border-border bg-base-100 px-2 text-sm"
                    />
                    <button
                        type="button"
                        onClick={onCreateComment}
                        disabled={!commentDraft.trim()}
                        className="btn h-10 shrink-0 bg-primary px-3 text-xs text-primary-content disabled:opacity-50"
                    >
                        Add
                    </button>
                </div>
                <div className="flex flex-col gap-2">
                    {comments.length === 0 && <div className="border border-border bg-base-100/50 p-2 text-xs text-muted">No comments.</div>}
                    {comments.map((comment) => (
                        <div key={comment.id} className="border border-border bg-base-100/60 p-2">
                            {editingCommentId === comment.id ? (
                                <div className="flex flex-col gap-2">
                                    <textarea
                                        value={editingCommentDraft}
                                        onChange={(event) => onEditingCommentDraftChange(event.target.value)}
                                        className="input min-h-20 w-full resize-none border border-border bg-base-200 p-2 text-sm"
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => onSaveComment(comment.id)}
                                            disabled={!editingCommentDraft.trim()}
                                            className="btn h-8 bg-primary px-3 text-xs text-primary-content disabled:opacity-50"
                                        >
                                            Save
                                        </button>
                                        <button type="button" onClick={onCancelEditComment} className="btn h-8 bg-base-300 px-3 text-xs">
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    <div className="break-words text-sm text-base-content">{comment.content}</div>
                                    <div className="flex min-w-0 items-center justify-between gap-2">
                                        <div className="min-w-0 truncate text-[11px] text-muted">
                                            {comment.authorLabel ?? comment.updatedAt ?? comment.createdAt ?? "Comment"}
                                        </div>
                                        <div className="flex shrink-0 gap-1">
                                            <button type="button" onClick={() => onStartEditComment(comment)} className="btn h-7 bg-base-300 px-2 text-[11px]">
                                                Edit
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onDeleteComment(comment.id)}
                                                className="btn h-7 bg-error/10 px-2 text-[11px] text-error"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
