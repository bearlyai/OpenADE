import { ArrowDown, Loader2, MessageSquarePlus } from "lucide-react"
import cx from "classnames"
import { type ReactNode, useMemo } from "react"
import type {
    OpenADETask,
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadResult,
    OpenADETaskGitChangedFile,
    OpenADETaskGitLogResult,
    OpenADETaskPreview,
} from "../../../../openade-module/src"
import { TaskComposer, type TaskComposerAgentControls } from "./TaskComposer"
import { TaskEventThread, type TaskImageLoader } from "./TaskEventThread"
import { TaskProductPanel, openADETaskComments, type OpenADETaskCommentView, type TaskReviewType } from "./TaskProductPanel"
import { taskEventBlocks, type TaskEventBlock } from "./taskEventPresentation"
import type { TaskCommandType } from "./taskCommands"
import { useTaskThreadScroll } from "./useTaskThreadScroll"

export function TaskScreen({
    task,
    preview,
    isRunning,
    input,
    commandType,
    titleDraft,
    commentDraft,
    editingCommentId,
    editingCommentDraft,
    reviewInstructions,
    taskChanges,
    taskGitLog,
    taskChangesLoading,
    taskDiff,
    taskDiffActionPath,
    isLoading,
    isSubmitting,
    isOnline,
    agentControls,
    composer,
    messageViewportClassName,
    loadImage,
    onInputChange,
    onCommandTypeChange,
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
    onSend,
    onAbort,
}: {
    task: OpenADETask | null
    preview: OpenADETaskPreview | null
    isRunning: boolean
    input: string
    commandType: TaskCommandType
    titleDraft: string
    commentDraft: string
    editingCommentId: string | null
    editingCommentDraft: string
    reviewInstructions: string
    taskChanges: OpenADETaskChangesReadResult | null
    taskGitLog: OpenADETaskGitLogResult | null
    taskChangesLoading: boolean
    taskDiff: OpenADETaskDiffReadResult | null
    taskDiffActionPath: string | null
    isLoading: boolean
    isSubmitting: boolean
    isOnline: boolean
    agentControls?: TaskComposerAgentControls
    composer?: ReactNode
    messageViewportClassName?: string
    loadImage?: TaskImageLoader
    onInputChange: (value: string) => void
    onCommandTypeChange: (value: TaskCommandType) => void
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
    onSend: () => void
    onAbort: () => void
}) {
    const blocks = useMemo(() => taskEventBlocks(task), [task])
    const comments = useMemo(() => openADETaskComments(task), [task])
    return (
        <div className="relative flex h-full w-full max-w-full flex-col overflow-hidden">
            <TaskMessages
                task={task}
                preview={preview}
                blocks={blocks}
                isRunning={isRunning}
                titleDraft={titleDraft}
                comments={comments}
                commentDraft={commentDraft}
                editingCommentId={editingCommentId}
                editingCommentDraft={editingCommentDraft}
                reviewInstructions={reviewInstructions}
                taskChanges={taskChanges}
                taskGitLog={taskGitLog}
                taskChangesLoading={taskChangesLoading}
                taskDiff={taskDiff}
                taskDiffActionPath={taskDiffActionPath}
                isSubmitting={isSubmitting}
                messageViewportClassName={messageViewportClassName}
                loadImage={loadImage}
                onTitleChange={onTitleChange}
                onSaveTitle={onSaveTitle}
                onToggleClosed={onToggleClosed}
                onDeleteTask={onDeleteTask}
                onCommentDraftChange={onCommentDraftChange}
                onCreateComment={onCreateComment}
                onStartEditComment={onStartEditComment}
                onEditingCommentDraftChange={onEditingCommentDraftChange}
                onSaveComment={onSaveComment}
                onCancelEditComment={onCancelEditComment}
                onDeleteComment={onDeleteComment}
                onCancelQueuedTurn={onCancelQueuedTurn}
                onReviewInstructionsChange={onReviewInstructionsChange}
                onStartReview={onStartReview}
                onRefreshTaskGit={onRefreshTaskGit}
                onReadTaskDiff={onReadTaskDiff}
            />
            {composer ?? (
                <TaskComposer
                    input={input}
                    commandType={commandType}
                    isLoading={isLoading}
                    isSubmitting={isSubmitting}
                    isOnline={isOnline}
                    isRunning={isRunning}
                    agentControls={agentControls}
                    onInputChange={onInputChange}
                    onCommandTypeChange={onCommandTypeChange}
                    onSend={onSend}
                    onAbort={onAbort}
                />
            )}
        </div>
    )
}

function TaskMessages({
    task,
    preview,
    blocks,
    isRunning,
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
    messageViewportClassName,
    loadImage,
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
    task: OpenADETask | null
    preview: OpenADETaskPreview | null
    blocks: TaskEventBlock[]
    isRunning: boolean
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
    messageViewportClassName?: string
    loadImage?: TaskImageLoader
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
    const { viewportRef, showJump, handleScroll, scrollToBottom } = useTaskThreadScroll({
        changeKey: `${blocks.length}:${isRunning ? "running" : "idle"}`,
        resetKey: task?.id ?? preview?.id ?? "empty",
        mode: "preserve",
    })

    return (
        <div className="relative min-h-0 w-full max-w-full flex-1 overflow-hidden">
            <div
                ref={viewportRef}
                onScroll={handleScroll}
                className={cx("h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-3", messageViewportClassName)}
            >
                {preview && (
                    <div className="mb-3 border border-border bg-base-200/25 p-3">
                        <div className="flex min-w-0 items-center gap-2">
                            <span
                                className={`flex h-8 w-8 shrink-0 items-center justify-center border ${
                                    isRunning ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-base-100/70 text-muted"
                                }`}
                            >
                                {isRunning ? <Loader2 size={15} className="animate-spin" /> : <MessageSquarePlus size={15} />}
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold">{preview.title}</div>
                                <div className="truncate text-xs text-muted">{isRunning ? "Running now" : (preview.lastEvent?.sourceLabel ?? "Thread")}</div>
                            </div>
                        </div>
                    </div>
                )}
                {task && !task.unavailableReason && (
                    <TaskProductPanel
                        task={task}
                        titleDraft={titleDraft}
                        comments={comments}
                        commentDraft={commentDraft}
                        editingCommentId={editingCommentId}
                        editingCommentDraft={editingCommentDraft}
                        reviewInstructions={reviewInstructions}
                        taskChanges={taskChanges}
                        taskGitLog={taskGitLog}
                        taskChangesLoading={taskChangesLoading}
                        taskDiff={taskDiff}
                        taskDiffActionPath={taskDiffActionPath}
                        isSubmitting={isSubmitting}
                        onTitleChange={onTitleChange}
                        onSaveTitle={onSaveTitle}
                        onToggleClosed={onToggleClosed}
                        onDeleteTask={onDeleteTask}
                        onCommentDraftChange={onCommentDraftChange}
                        onCreateComment={onCreateComment}
                        onStartEditComment={onStartEditComment}
                        onEditingCommentDraftChange={onEditingCommentDraftChange}
                        onSaveComment={onSaveComment}
                        onCancelEditComment={onCancelEditComment}
                        onDeleteComment={onDeleteComment}
                        onCancelQueuedTurn={onCancelQueuedTurn}
                        onReviewInstructionsChange={onReviewInstructionsChange}
                        onStartReview={onStartReview}
                        onRefreshTaskGit={onRefreshTaskGit}
                        onReadTaskDiff={onReadTaskDiff}
                    />
                )}
                {!task && <div className="text-sm text-muted">Loading task...</div>}
                {task?.unavailableReason && (
                    <div className="mb-3 break-words border border-warning/30 bg-warning/10 p-3 text-sm text-warning">{task.unavailableReason}</div>
                )}
                {blocks.length === 0 && (
                    <div className="break-words border border-border bg-base-200/40 p-3 text-sm text-muted">
                        {preview?.title ?? "Task"} has no messages yet.
                    </div>
                )}
                <TaskEventThread blocks={blocks} isRunning={isRunning} loadImage={loadImage} />
            </div>
            {showJump && (
                <button
                    type="button"
                    onClick={scrollToBottom}
                    className="btn absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 bg-primary px-3 py-1.5 text-xs text-primary-content shadow-lg"
                >
                    <ArrowDown size={13} />
                    Latest
                </button>
            )}
        </div>
    )
}
