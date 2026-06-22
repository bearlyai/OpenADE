import { Archive, ArrowDown, ArrowUp, CheckCircle2, Loader2, Star, TerminalSquare, Trash2, Wand2, X } from "lucide-react"
import { useEffect, useState } from "react"
import type {
    OpenADETask,
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadResult,
    OpenADETaskFilePairReadResult,
    OpenADETaskGitChangedFile,
    OpenADETaskGitCommitFilePatchResult,
    OpenADETaskGitCommitFilesResult,
    OpenADETaskGitFileAtTreeishResult,
    OpenADETaskGitLogResult,
    OpenADETaskGitLogEntry,
    OpenADETaskGitScopesReadResult,
    OpenADETaskGitSummaryResult,
    OpenADETaskResourceInventory,
} from "../../../../openade-module/src"
import { Terminal } from "../../components/Terminal"
import type { TaskTerminalProductAccess } from "../../components/terminalSession"
import { ShortcutBadge } from "../../components/ui/ShortcutBadge"
import { useMetaKeyPressed } from "../../hooks/useMetaKeyPressed"
import { getMetaDigitShortcutIndex } from "../../utils/keyboardShortcuts"
import { type TaskGitCapabilities, TaskGitPanel } from "./TaskGitPanel"
import { taskCommandLabel } from "./taskCommands"
import { latestActivePlanEventId } from "./taskPlanState"

const TASK_CANCEL_PLAN_SHORTCUT_LABEL = "8"
const TASK_CLOSE_SHORTCUT_LABEL = "9"

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

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
}

function branchMergedLabel(value: boolean | null): string {
    if (value === true) return "Merged"
    if (value === false) return "Unmerged"
    return "Unknown"
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
    taskGitSummary,
    taskGitScopes,
    taskChangesLoading,
    taskDiff,
    taskDiffActionPath,
    taskFilePair,
    taskFilePairActionPath,
    taskCommitFiles,
    taskCommitFilesActionSha,
    taskCommitPatch,
    taskCommitPatchActionKey,
    taskTreeishFile,
    taskTreeishFileActionKey,
    taskResources,
    taskResourcesLoading,
    taskTerminalProductAccess,
    taskGitCapabilities,
    isRunning,
    isSubmitting,
    onTitleChange,
    onSaveTitle,
    onGenerateTitle,
    onPrepareEnvironment,
    onToggleClosed,
    onDeleteTask,
    onCancelPlan,
    onCommentDraftChange,
    onCreateComment,
    onStartEditComment,
    onEditingCommentDraftChange,
    onSaveComment,
    onCancelEditComment,
    onDeleteComment,
    onCancelQueuedTurn,
    onReorderQueuedTurns,
    onReviewInstructionsChange,
    onStartReview,
    onRefreshTaskGit,
    onReadTaskDiff,
    onReadTaskFilePair,
    onReadTaskCommitFiles,
    onReadTaskCommitFilePatch,
    onReadTaskCommitFileAtTreeish,
    onCommitTaskGit,
    onRefreshTaskResources,
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
    taskGitSummary: OpenADETaskGitSummaryResult | null
    taskGitScopes: OpenADETaskGitScopesReadResult | null
    taskChangesLoading: boolean
    taskDiff: OpenADETaskDiffReadResult | null
    taskDiffActionPath: string | null
    taskFilePair: OpenADETaskFilePairReadResult | null
    taskFilePairActionPath: string | null
    taskCommitFiles: OpenADETaskGitCommitFilesResult | null
    taskCommitFilesActionSha: string | null
    taskCommitPatch: OpenADETaskGitCommitFilePatchResult | null
    taskCommitPatchActionKey: string | null
    taskTreeishFile: OpenADETaskGitFileAtTreeishResult | null
    taskTreeishFileActionKey: string | null
    taskResources: OpenADETaskResourceInventory | null
    taskResourcesLoading: boolean
    taskTerminalProductAccess: TaskTerminalProductAccess | null
    taskGitCapabilities: TaskGitCapabilities
    isRunning: boolean
    isSubmitting: boolean
    onTitleChange?: (value: string) => void
    onSaveTitle?: () => void
    onGenerateTitle?: () => void
    onPrepareEnvironment?: () => void
    onToggleClosed?: () => void
    onDeleteTask?: () => void
    onCancelPlan?: (planEventId: string) => void
    onCommentDraftChange?: (value: string) => void
    onCreateComment?: () => void
    onStartEditComment?: (comment: OpenADETaskCommentView) => void
    onEditingCommentDraftChange?: (value: string) => void
    onSaveComment?: (commentId: string) => void
    onCancelEditComment: () => void
    onDeleteComment?: (commentId: string) => void
    onCancelQueuedTurn?: (queuedTurnId: string) => void
    onReorderQueuedTurns?: (queuedTurnIds: string[]) => void
    onReviewInstructionsChange?: (value: string) => void
    onStartReview?: (reviewType: TaskReviewType) => void
    onRefreshTaskGit?: () => void
    onReadTaskDiff?: (file: OpenADETaskGitChangedFile) => void
    onReadTaskFilePair?: (file: OpenADETaskGitChangedFile) => void
    onReadTaskCommitFiles?: (commit: OpenADETaskGitLogEntry) => void
    onReadTaskCommitFilePatch?: (file: OpenADETaskGitChangedFile) => void
    onReadTaskCommitFileAtTreeish?: (file: OpenADETaskGitChangedFile) => void
    onCommitTaskGit?: (message: string) => void
    onRefreshTaskResources?: () => void
}) {
    const queuedTurns = task.queuedTurns ?? []
    const hasQueuedTurns = queuedTurns.length > 0
    const activeQueuedTurnIds = queuedTurns.filter((turn) => turn.status === "queued").map((turn) => turn.id)
    const titleChanged = titleDraft.trim().length > 0 && titleDraft.trim() !== task.title
    const [terminalOpen, setTerminalOpen] = useState(false)
    const hasTaskDeviceEnvironments = task.deviceEnvironments.length > 0
    const canUpdateTitle = Boolean(onTitleChange)
    const canSaveTitle = Boolean(onSaveTitle)
    const canGenerateTitle = Boolean(onGenerateTitle)
    const canPrepareEnvironment = Boolean(onPrepareEnvironment)
    const canToggleClosed = Boolean(onToggleClosed)
    const canCancelPlan = Boolean(onCancelPlan)
    const canStartReview = Boolean(onReviewInstructionsChange && onStartReview)
    const canCreateComment = Boolean(onCommentDraftChange && onCreateComment)
    const canEditComment = Boolean(onStartEditComment && onEditingCommentDraftChange && onSaveComment)
    const canDeleteComment = Boolean(onDeleteComment)
    const canCancelQueuedTurn = Boolean(onCancelQueuedTurn)
    const canReorderQueuedTurns = Boolean(onReorderQueuedTurns)
    const canReadTaskResources = Boolean(onRefreshTaskResources)
    const visibleTaskResources = canReadTaskResources ? taskResources : null
    const showResourcesSection = canReadTaskResources || canPrepareEnvironment || hasTaskDeviceEnvironments
    const activePlanEventId = latestActivePlanEventId(task)
    const shortcutHintsVisible = useMetaKeyPressed()
    const showCloseToggle = canToggleClosed && !isRunning
    const canDeleteTask = Boolean(onDeleteTask)
    const showTaskActions = showCloseToggle || canDeleteTask
    const taskActionColumnCount = showCloseToggle && canDeleteTask ? "grid-cols-2" : "grid-cols-1"
    const showCancelPlan = canCancelPlan && !isRunning && Boolean(activePlanEventId)

    useEffect(() => {
        setTerminalOpen(false)
    }, [task.id])

    useEffect(() => {
        if (!taskTerminalProductAccess) setTerminalOpen(false)
    }, [taskTerminalProductAccess])

    useEffect(() => {
        if (editingCommentId && !canEditComment) onCancelEditComment()
    }, [canEditComment, editingCommentId, onCancelEditComment])

    useEffect(() => {
        const handleActionShortcut = (event: KeyboardEvent) => {
            if (isSubmitting) return
            const shortcutIndex = getMetaDigitShortcutIndex(event)
            if (shortcutIndex === null) return

            const shortcutNumber = shortcutIndex + 1
            if (shortcutNumber === Number.parseInt(TASK_CANCEL_PLAN_SHORTCUT_LABEL, 10)) {
                if (showCancelPlan && activePlanEventId) {
                    event.preventDefault()
                    onCancelPlan?.(activePlanEventId)
                }
                return
            }

            if (shortcutNumber === Number.parseInt(TASK_CLOSE_SHORTCUT_LABEL, 10)) {
                if (showCloseToggle) {
                    event.preventDefault()
                    onToggleClosed?.()
                }
            }
        }

        window.addEventListener("keydown", handleActionShortcut, true)
        return () => window.removeEventListener("keydown", handleActionShortcut, true)
    }, [activePlanEventId, isSubmitting, onCancelPlan, onToggleClosed, showCancelPlan, showCloseToggle])

    const moveQueuedTurn = (queuedTurnId: string, direction: -1 | 1) => {
        if (!canReorderQueuedTurns) return
        const index = activeQueuedTurnIds.indexOf(queuedTurnId)
        const nextIndex = index + direction
        if (index < 0 || nextIndex < 0 || nextIndex >= activeQueuedTurnIds.length) return
        const nextIds = [...activeQueuedTurnIds]
        const turnId = nextIds[index]
        if (!turnId) return
        nextIds.splice(index, 1)
        nextIds.splice(nextIndex, 0, turnId)
        onReorderQueuedTurns?.(nextIds)
    }

    return (
        <section className="mb-3 flex flex-col gap-3 border border-border bg-base-200/20 p-3">
            <div className="flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">Task</div>
                <div className="flex min-w-0 gap-2">
                    <input
                        value={titleDraft}
                        aria-label="Task title"
                        onChange={(event) => onTitleChange?.(event.target.value)}
                        disabled={!canUpdateTitle}
                        className="input h-10 min-w-0 flex-1 border border-border bg-base-100 px-2 text-sm"
                    />
                    {canSaveTitle && (
                        <button
                            type="button"
                            onClick={onSaveTitle}
                            disabled={!titleChanged || isSubmitting}
                            className="btn h-10 shrink-0 bg-base-300 px-3 text-xs disabled:opacity-50"
                        >
                            Save
                        </button>
                    )}
                    {canGenerateTitle && (
                        <button
                            type="button"
                            onClick={onGenerateTitle}
                            disabled={isSubmitting}
                            className="btn flex h-10 shrink-0 items-center gap-1.5 bg-base-300 px-3 text-xs disabled:opacity-50"
                        >
                            <Wand2 size={14} />
                            Generate
                        </button>
                    )}
                </div>
                {showTaskActions && (
                    <div className={`grid gap-2 ${taskActionColumnCount}`}>
                        {showCloseToggle && (
                            <button
                                type="button"
                                onClick={onToggleClosed}
                                disabled={isSubmitting}
                                aria-keyshortcuts={`Meta+${TASK_CLOSE_SHORTCUT_LABEL}`}
                                className="btn relative flex h-10 items-center justify-center gap-2 bg-base-300 px-3 text-xs disabled:opacity-50"
                            >
                                <CheckCircle2 size={14} />
                                {task.closed ? "Reopen" : "Close"}
                                <ShortcutBadge label={TASK_CLOSE_SHORTCUT_LABEL} visible={shortcutHintsVisible} variant="corner" />
                            </button>
                        )}
                        {canDeleteTask && (
                            <button
                                type="button"
                                onClick={onDeleteTask}
                                aria-label="Delete task"
                                className="btn flex h-10 items-center justify-center gap-2 bg-error/10 px-3 text-xs text-error"
                            >
                                <Trash2 size={14} />
                                Delete
                            </button>
                        )}
                    </div>
                )}
            </div>

            {showCancelPlan && activePlanEventId && (
                <div className="flex flex-col gap-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted">Plan</div>
                    <button
                        type="button"
                        onClick={() => onCancelPlan?.(activePlanEventId)}
                        disabled={isSubmitting}
                        aria-label="Cancel active plan"
                        aria-keyshortcuts={`Meta+${TASK_CANCEL_PLAN_SHORTCUT_LABEL}`}
                        className="btn relative flex h-10 items-center justify-center gap-2 bg-error/10 px-3 text-xs text-error disabled:opacity-50"
                    >
                        <X size={14} />
                        Cancel Plan
                        <ShortcutBadge label={TASK_CANCEL_PLAN_SHORTCUT_LABEL} visible={shortcutHintsVisible} variant="corner" />
                    </button>
                </div>
            )}

            {canStartReview && (
                <div className="flex flex-col gap-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted">Review</div>
                    <textarea
                        value={reviewInstructions}
                        aria-label="Review instructions"
                        onChange={(event) => onReviewInstructionsChange?.(event.target.value)}
                        placeholder="Optional review notes"
                        className="input min-h-16 w-full resize-none border border-border bg-base-100 p-2 text-sm"
                    />
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => onStartReview?.("plan")}
                            disabled={isSubmitting}
                            className="btn flex h-10 items-center justify-center gap-2 bg-base-300 px-3 text-xs disabled:opacity-50"
                        >
                            <Star size={14} />
                            Review Plan
                        </button>
                        <button
                            type="button"
                            onClick={() => onStartReview?.("work")}
                            disabled={isSubmitting}
                            className="btn flex h-10 items-center justify-center gap-2 bg-base-300 px-3 text-xs disabled:opacity-50"
                        >
                            <Star size={14} />
                            Review Work
                        </button>
                    </div>
                </div>
            )}

            <TaskGitPanel
                changes={taskChanges}
                gitLog={taskGitLog}
                gitSummary={taskGitSummary}
                gitScopes={taskGitScopes}
                loading={taskChangesLoading}
                diff={taskDiff}
                actionPath={taskDiffActionPath}
                filePair={taskFilePair}
                filePairActionPath={taskFilePairActionPath}
                commitFiles={taskCommitFiles}
                commitFilesActionSha={taskCommitFilesActionSha}
                commitPatch={taskCommitPatch}
                commitPatchActionKey={taskCommitPatchActionKey}
                treeishFile={taskTreeishFile}
                treeishFileActionKey={taskTreeishFileActionKey}
                capabilities={taskGitCapabilities}
                onRefresh={onRefreshTaskGit}
                onReadDiff={onReadTaskDiff}
                onReadFilePair={onReadTaskFilePair}
                onReadCommitFiles={onReadTaskCommitFiles}
                onReadCommitFilePatch={onReadTaskCommitFilePatch}
                onReadCommitFileAtTreeish={onReadTaskCommitFileAtTreeish}
                onCommit={onCommitTaskGit}
            />

            {showResourcesSection && (
                <div className="flex flex-col gap-2">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted">Resources</div>
                        <div className="flex shrink-0 gap-2">
                            {canPrepareEnvironment && (
                                <button
                                    type="button"
                                    onClick={onPrepareEnvironment}
                                    disabled={isSubmitting}
                                    className="btn flex h-8 shrink-0 items-center justify-center gap-2 bg-base-300 px-2 text-xs disabled:opacity-50"
                                >
                                    <TerminalSquare size={13} />
                                    Prepare Environment
                                </button>
                            )}
                            {canReadTaskResources && (
                                <button
                                    type="button"
                                    title={taskResources ? "Refresh task resources" : "Load task resources"}
                                    aria-label={taskResources ? "Refresh task resources" : "Load task resources"}
                                    onClick={onRefreshTaskResources}
                                    disabled={taskResourcesLoading}
                                    className="btn flex h-8 shrink-0 items-center justify-center gap-2 bg-base-300 px-2 text-xs disabled:opacity-50"
                                >
                                    {taskResourcesLoading ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
                                    {taskResources ? "Refresh" : "Load"}
                                </button>
                            )}
                        </div>
                    </div>
                    {(visibleTaskResources || hasTaskDeviceEnvironments) && (
                        <div className="grid grid-cols-2 gap-2">
                            {hasTaskDeviceEnvironments && (
                                <div className="border border-border bg-base-100/60 p-2">
                                    <div className="text-[11px] uppercase text-muted">Environments</div>
                                    <div className="mt-1 text-sm font-medium">{countLabel(task.deviceEnvironments.length, "environment")}</div>
                                </div>
                            )}
                            {visibleTaskResources && (
                                <>
                                    <div className="border border-border bg-base-100/60 p-2">
                                        <div className="text-[11px] uppercase text-muted">Snapshots</div>
                                        <div className="mt-1 text-sm font-medium">
                                            {countLabel(visibleTaskResources.snapshotIds.length, "patch", "patches")}
                                        </div>
                                    </div>
                                    <div className="border border-border bg-base-100/60 p-2">
                                        <div className="text-[11px] uppercase text-muted">Images</div>
                                        <div className="mt-1 text-sm font-medium">{countLabel(visibleTaskResources.images.length, "image")}</div>
                                    </div>
                                    <div className="border border-border bg-base-100/60 p-2">
                                        <div className="text-[11px] uppercase text-muted">Sessions</div>
                                        <div className="mt-1 text-sm font-medium">{countLabel(visibleTaskResources.sessions.length, "session")}</div>
                                    </div>
                                    <div className="border border-border bg-base-100/60 p-2">
                                        <div className="text-[11px] uppercase text-muted">Runtime</div>
                                        <div className="mt-1 text-sm font-medium">{visibleTaskResources.isRunning ? "Running" : "Idle"}</div>
                                    </div>
                                    {visibleTaskResources.worktree && (
                                        <div className="col-span-2 min-w-0 border border-border bg-base-100/60 p-2">
                                            <div className="text-[11px] uppercase text-muted">Worktree</div>
                                            <div className="mt-1 min-w-0 truncate text-sm font-medium">{visibleTaskResources.worktree.branchName}</div>
                                            <div className="mt-1 min-w-0 truncate text-xs text-muted">
                                                {visibleTaskResources.worktree.sourceBranch} - {branchMergedLabel(visibleTaskResources.worktree.branchMerged)}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}

            {taskTerminalProductAccess && (
                <div className="flex flex-col gap-2">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted">Terminal</div>
                        <button
                            type="button"
                            onClick={() => setTerminalOpen((value) => !value)}
                            className="btn flex h-8 shrink-0 items-center justify-center gap-2 bg-base-300 px-2 text-xs"
                        >
                            <TerminalSquare size={13} />
                            {terminalOpen ? "Hide Terminal" : "Open Terminal"}
                        </button>
                    </div>
                    {terminalOpen && (
                        <div className="h-80 min-h-0 overflow-hidden border border-border bg-base-100">
                            <Terminal
                                ptyId={task.id}
                                cwd=""
                                productAccess={taskTerminalProductAccess}
                                className="h-full"
                                onClose={() => setTerminalOpen(false)}
                            />
                        </div>
                    )}
                </div>
            )}

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
                                {turn.status === "queued" && (canReorderQueuedTurns || canCancelQueuedTurn) && (
                                    <div className="flex shrink-0 gap-1">
                                        {canReorderQueuedTurns && (
                                            <>
                                                <button
                                                    type="button"
                                                    title="Move queued turn up"
                                                    aria-label="Move queued turn up"
                                                    onClick={() => moveQueuedTurn(turn.id, -1)}
                                                    disabled={activeQueuedTurnIds.indexOf(turn.id) <= 0}
                                                    className="btn flex h-8 w-8 items-center justify-center bg-base-300 p-0 text-xs disabled:opacity-40"
                                                >
                                                    <ArrowUp size={13} />
                                                </button>
                                                <button
                                                    type="button"
                                                    title="Move queued turn down"
                                                    aria-label="Move queued turn down"
                                                    onClick={() => moveQueuedTurn(turn.id, 1)}
                                                    disabled={activeQueuedTurnIds.indexOf(turn.id) === activeQueuedTurnIds.length - 1}
                                                    className="btn flex h-8 w-8 items-center justify-center bg-base-300 p-0 text-xs disabled:opacity-40"
                                                >
                                                    <ArrowDown size={13} />
                                                </button>
                                            </>
                                        )}
                                        {canCancelQueuedTurn && (
                                            <button
                                                type="button"
                                                onClick={() => onCancelQueuedTurn?.(turn.id)}
                                                className="btn h-8 bg-error/10 px-2 text-xs text-error"
                                            >
                                                Cancel
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">Comments</div>
                {canCreateComment && (
                    <div className="flex min-w-0 gap-2">
                        <input
                            value={commentDraft}
                            aria-label="New comment"
                            onChange={(event) => onCommentDraftChange?.(event.target.value)}
                            placeholder="Add a comment"
                            className="input h-10 min-w-0 flex-1 border border-border bg-base-100 px-2 text-sm"
                        />
                        <button
                            type="button"
                            onClick={onCreateComment}
                            disabled={!commentDraft.trim() || isSubmitting}
                            className="btn h-10 shrink-0 bg-primary px-3 text-xs text-primary-content disabled:opacity-50"
                        >
                            Add
                        </button>
                    </div>
                )}
                <div className="flex flex-col gap-2">
                    {comments.length === 0 && <div className="border border-border bg-base-100/50 p-2 text-xs text-muted">No comments.</div>}
                    {comments.map((comment) => (
                        <div key={comment.id} className="border border-border bg-base-100/60 p-2">
                            {editingCommentId === comment.id && canEditComment ? (
                                <div className="flex flex-col gap-2">
                                    <textarea
                                        value={editingCommentDraft}
                                        aria-label="Edit comment"
                                        onChange={(event) => onEditingCommentDraftChange?.(event.target.value)}
                                        className="input min-h-20 w-full resize-none border border-border bg-base-200 p-2 text-sm"
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => onSaveComment?.(comment.id)}
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
                                        {(canEditComment || canDeleteComment) && (
                                            <div className="flex shrink-0 gap-1">
                                                {canEditComment && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onStartEditComment?.(comment)}
                                                        className="btn h-7 bg-base-300 px-2 text-[11px]"
                                                    >
                                                        Edit
                                                    </button>
                                                )}
                                                {canDeleteComment && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onDeleteComment?.(comment.id)}
                                                        className="btn h-7 bg-error/10 px-2 text-[11px] text-error"
                                                    >
                                                        Delete
                                                    </button>
                                                )}
                                            </div>
                                        )}
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
