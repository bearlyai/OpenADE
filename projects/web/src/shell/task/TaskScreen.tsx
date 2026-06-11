import { ArrowDown, Loader2, MessageSquarePlus } from "lucide-react"
import cx from "classnames"
import { type ReactNode, useMemo } from "react"
import type {
    OpenADESnapshotPatchFile,
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
    OpenADETaskPreview,
    OpenADETaskResourceInventory,
} from "../../../../openade-module/src"
import { TaskComposer, type TaskComposerAgentControls } from "./TaskComposer"
import { TaskEventThread, type TaskImageLoader, type TaskSnapshotPatchView } from "./TaskEventThread"
import { TaskProductPanel, openADETaskComments, type OpenADETaskCommentView, type TaskProductCapabilities, type TaskReviewType } from "./TaskProductPanel"
import type { TaskTerminalProductAccess } from "../../components/terminalSession"
import type { TaskGitCapabilities } from "./TaskGitPanel"
import { taskEventBlocks, type TaskEventBlock, type TaskSnapshotBlock } from "./taskEventPresentation"
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
    taskProductCapabilities,
    taskCanReadResources,
    taskCanDelete,
    taskCanStartTurn,
    taskCanEnqueueQueuedTurn,
    taskCanInterrupt,
    isLoading,
    isSubmitting,
    isOnline,
    agentControls,
    composer,
    messageViewportClassName,
    loadImage,
    snapshotPatches,
    snapshotPatchActionId,
    onInputChange,
    onCommandTypeChange,
    onTitleChange,
    onSaveTitle,
    onGenerateTitle,
    onPrepareEnvironment,
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
    onSend,
    onAbort,
    onLoadSnapshotPatch,
    onLoadSnapshotPatchSlice,
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
    taskProductCapabilities: TaskProductCapabilities
    taskCanReadResources: boolean
    taskCanDelete: boolean
    taskCanStartTurn: boolean
    taskCanEnqueueQueuedTurn: boolean
    taskCanInterrupt: boolean
    isLoading: boolean
    isSubmitting: boolean
    isOnline: boolean
    agentControls?: TaskComposerAgentControls
    composer?: ReactNode
    messageViewportClassName?: string
    loadImage?: TaskImageLoader
    snapshotPatches?: Record<string, TaskSnapshotPatchView>
    snapshotPatchActionId?: string | null
    onInputChange: (value: string) => void
    onCommandTypeChange: (value: TaskCommandType) => void
    onTitleChange: (value: string) => void
    onSaveTitle: () => void
    onGenerateTitle: () => void
    onPrepareEnvironment: () => void
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
    onReorderQueuedTurns: (queuedTurnIds: string[]) => void
    onReviewInstructionsChange: (value: string) => void
    onStartReview: (reviewType: TaskReviewType) => void
    onRefreshTaskGit: () => void
    onReadTaskDiff: (file: OpenADETaskGitChangedFile) => void
    onReadTaskFilePair: (file: OpenADETaskGitChangedFile) => void
    onReadTaskCommitFiles: (commit: OpenADETaskGitLogEntry) => void
    onReadTaskCommitFilePatch: (file: OpenADETaskGitChangedFile) => void
    onReadTaskCommitFileAtTreeish: (file: OpenADETaskGitChangedFile) => void
    onCommitTaskGit: (message: string) => void
    onRefreshTaskResources: () => void
    onSend: () => void
    onAbort: () => void
    onLoadSnapshotPatch?: (block: TaskSnapshotBlock) => void
    onLoadSnapshotPatchSlice?: (block: TaskSnapshotBlock, file: OpenADESnapshotPatchFile) => void
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
                taskGitSummary={taskGitSummary}
                taskGitScopes={taskGitScopes}
                taskChangesLoading={taskChangesLoading}
                taskDiff={taskDiff}
                taskDiffActionPath={taskDiffActionPath}
                taskFilePair={taskFilePair}
                taskFilePairActionPath={taskFilePairActionPath}
                taskCommitFiles={taskCommitFiles}
                taskCommitFilesActionSha={taskCommitFilesActionSha}
                taskCommitPatch={taskCommitPatch}
                taskCommitPatchActionKey={taskCommitPatchActionKey}
                taskTreeishFile={taskTreeishFile}
                taskTreeishFileActionKey={taskTreeishFileActionKey}
                taskResources={taskResources}
                taskResourcesLoading={taskResourcesLoading}
                taskTerminalProductAccess={taskTerminalProductAccess}
                taskGitCapabilities={taskGitCapabilities}
                taskProductCapabilities={taskProductCapabilities}
                taskCanReadResources={taskCanReadResources}
                taskCanDelete={taskCanDelete}
                isSubmitting={isSubmitting}
                messageViewportClassName={messageViewportClassName}
                loadImage={loadImage}
                snapshotPatches={snapshotPatches}
                snapshotPatchActionId={snapshotPatchActionId}
                onTitleChange={onTitleChange}
                onSaveTitle={onSaveTitle}
                onGenerateTitle={onGenerateTitle}
                onPrepareEnvironment={onPrepareEnvironment}
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
                onReorderQueuedTurns={onReorderQueuedTurns}
                onReviewInstructionsChange={onReviewInstructionsChange}
                onStartReview={onStartReview}
                onRefreshTaskGit={onRefreshTaskGit}
                onReadTaskDiff={onReadTaskDiff}
                onReadTaskFilePair={onReadTaskFilePair}
                onReadTaskCommitFiles={onReadTaskCommitFiles}
                onReadTaskCommitFilePatch={onReadTaskCommitFilePatch}
                onReadTaskCommitFileAtTreeish={onReadTaskCommitFileAtTreeish}
                onCommitTaskGit={onCommitTaskGit}
                onRefreshTaskResources={onRefreshTaskResources}
                onLoadSnapshotPatch={onLoadSnapshotPatch}
                onLoadSnapshotPatchSlice={onLoadSnapshotPatchSlice}
            />
            {composer ?? (
                <TaskComposer
                    input={input}
                    commandType={commandType}
                    isLoading={isLoading}
                    isSubmitting={isSubmitting}
                    isOnline={isOnline}
                    isRunning={isRunning}
                    canSend={isRunning ? taskCanEnqueueQueuedTurn : taskCanStartTurn}
                    canAbort={taskCanInterrupt}
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
    taskProductCapabilities,
    taskCanReadResources,
    taskCanDelete,
    isSubmitting,
    messageViewportClassName,
    loadImage,
    snapshotPatches,
    snapshotPatchActionId,
    onTitleChange,
    onSaveTitle,
    onGenerateTitle,
    onPrepareEnvironment,
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
    onLoadSnapshotPatch,
    onLoadSnapshotPatchSlice,
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
    taskProductCapabilities: TaskProductCapabilities
    taskCanReadResources: boolean
    taskCanDelete: boolean
    isSubmitting: boolean
    messageViewportClassName?: string
    loadImage?: TaskImageLoader
    snapshotPatches?: Record<string, TaskSnapshotPatchView>
    snapshotPatchActionId?: string | null
    onTitleChange: (value: string) => void
    onSaveTitle: () => void
    onGenerateTitle: () => void
    onPrepareEnvironment: () => void
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
    onReorderQueuedTurns: (queuedTurnIds: string[]) => void
    onReviewInstructionsChange: (value: string) => void
    onStartReview: (reviewType: TaskReviewType) => void
    onRefreshTaskGit: () => void
    onReadTaskDiff: (file: OpenADETaskGitChangedFile) => void
    onReadTaskFilePair: (file: OpenADETaskGitChangedFile) => void
    onReadTaskCommitFiles: (commit: OpenADETaskGitLogEntry) => void
    onReadTaskCommitFilePatch: (file: OpenADETaskGitChangedFile) => void
    onReadTaskCommitFileAtTreeish: (file: OpenADETaskGitChangedFile) => void
    onCommitTaskGit: (message: string) => void
    onRefreshTaskResources: () => void
    onLoadSnapshotPatch?: (block: TaskSnapshotBlock) => void
    onLoadSnapshotPatchSlice?: (block: TaskSnapshotBlock, file: OpenADESnapshotPatchFile) => void
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
                        taskGitSummary={taskGitSummary}
                        taskGitScopes={taskGitScopes}
                        taskChangesLoading={taskChangesLoading}
                        taskDiff={taskDiff}
                        taskDiffActionPath={taskDiffActionPath}
                        taskFilePair={taskFilePair}
                        taskFilePairActionPath={taskFilePairActionPath}
                        taskCommitFiles={taskCommitFiles}
                        taskCommitFilesActionSha={taskCommitFilesActionSha}
                        taskCommitPatch={taskCommitPatch}
                        taskCommitPatchActionKey={taskCommitPatchActionKey}
                        taskTreeishFile={taskTreeishFile}
                        taskTreeishFileActionKey={taskTreeishFileActionKey}
                        taskResources={taskResources}
                        taskResourcesLoading={taskResourcesLoading}
                        taskTerminalProductAccess={taskTerminalProductAccess}
                        taskGitCapabilities={taskGitCapabilities}
                        taskProductCapabilities={taskProductCapabilities}
                        canReadTaskResources={taskCanReadResources}
                        canDeleteTask={taskCanDelete}
                        isSubmitting={isSubmitting}
                        onTitleChange={onTitleChange}
                        onSaveTitle={onSaveTitle}
                        onGenerateTitle={onGenerateTitle}
                        onPrepareEnvironment={onPrepareEnvironment}
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
                        onReorderQueuedTurns={onReorderQueuedTurns}
                        onReviewInstructionsChange={onReviewInstructionsChange}
                        onStartReview={onStartReview}
                        onRefreshTaskGit={onRefreshTaskGit}
                        onReadTaskDiff={onReadTaskDiff}
                        onReadTaskFilePair={onReadTaskFilePair}
                        onReadTaskCommitFiles={onReadTaskCommitFiles}
                        onReadTaskCommitFilePatch={onReadTaskCommitFilePatch}
                        onReadTaskCommitFileAtTreeish={onReadTaskCommitFileAtTreeish}
                        onCommitTaskGit={onCommitTaskGit}
                        onRefreshTaskResources={onRefreshTaskResources}
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
                <TaskEventThread
                    blocks={blocks}
                    isRunning={isRunning}
                    loadImage={loadImage}
                    snapshotPatches={snapshotPatches}
                    snapshotPatchActionId={snapshotPatchActionId}
                    onLoadSnapshotPatch={onLoadSnapshotPatch}
                    onLoadSnapshotPatchSlice={onLoadSnapshotPatchSlice}
                />
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
