import { ArrowDown, ImagePlus, Loader2, MessageSquarePlus } from "lucide-react"
import cx from "classnames"
import { type DragEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import {
    TaskComposer,
    type TaskComposerAction,
    type TaskComposerAgentControls,
    type TaskComposerImageAttachment,
    type TaskComposerRepeatState,
} from "./TaskComposer"
import { TaskEventThread, type TaskImageLoader, type TaskSnapshotPatchView } from "./TaskEventThread"
import { TaskProductPanel, openADETaskComments, type OpenADETaskCommentView, type TaskReviewType } from "./TaskProductPanel"
import type { TaskTerminalProductAccess } from "../../components/terminalSession"
import type { TaskTurnCapabilities } from "../capabilities"
import type { TaskGitCapabilities } from "./TaskGitPanel"
import { taskEventBlocks, type TaskEventBlock, type TaskSnapshotBlock } from "./taskEventPresentation"
import { canQueueTaskCommandWhileRunning, type TaskCommandType } from "./taskCommands"
import { latestActivePlanEventId, taskHasRetryableLastAction } from "./taskPlanState"
import { useTaskThreadScroll } from "./useTaskThreadScroll"
import { useMetaKeyPressed } from "../../hooks/useMetaKeyPressed"
import { getMetaDigitShortcutIndex } from "../../utils/keyboardShortcuts"
import { buildTaskShellCommandDescriptors, type TaskShellCommandId } from "./taskCommandModel"

const TASK_COMMAND_TYPE_BY_SHELL_COMMAND_ID: Partial<Record<TaskShellCommandId, TaskCommandType>> = {
    do: "do",
    plan: "plan",
    ask: "ask",
    revise: "revise",
    runPlan: "run_plan",
}

const TASK_COMMAND_SHORTCUT_LABELS: Partial<Record<TaskCommandType, string>> = {
    do: "1",
    run_plan: "1",
    plan: "2",
    revise: "2",
    ask: "3",
    hyperplan: "4",
}
const TASK_COMMAND_SHORTCUT_LABELS_WITHOUT_HYPERPLAN: Partial<Record<TaskCommandType, string>> = {
    do: "1",
    run_plan: "1",
    plan: "2",
    revise: "2",
    ask: "3",
}
const TASK_REVIEW_PLAN_SHORTCUT_LABEL = "4"
const TASK_REVIEW_SHORTCUT_LABEL = "4"
const TASK_RETRY_SHORTCUT_LABEL = "5"
const TASK_REPEAT_SHORTCUT_LABEL = "6"
const TASK_COMMIT_AND_PUSH_SHORTCUT_LABEL = "7"
const TASK_CANCEL_PLAN_SHORTCUT_LABEL = "8"
const TASK_ABORT_SHORTCUT_LABEL = "8"
const TASK_CLOSE_SHORTCUT_LABEL = "9"

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
    taskTurnCapabilities,
    isLoading,
    isSubmitting,
    isOnline,
    agentControls,
    hyperplanControl,
    imageAttachments,
    imageAttachLoading,
    repeatState,
    editor,
    onFocusInputShortcut,
    composer,
    messageViewportClassName,
    loadImage,
    snapshotPatches,
    snapshotPatchActionId,
    onInputChange,
    onCommandTypeChange,
    onAttachImage,
    onRemoveImage,
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
    onCommitAndPush,
    onStartRepeat,
    onStopRepeat,
    onRefreshTaskResources,
    onSend,
    onAbort,
    onRetry,
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
    taskTurnCapabilities: TaskTurnCapabilities
    isLoading: boolean
    isSubmitting: boolean
    isOnline: boolean
    agentControls?: TaskComposerAgentControls
    hyperplanControl?: ReactNode
    imageAttachments?: TaskComposerImageAttachment[]
    imageAttachLoading?: boolean
    repeatState?: TaskComposerRepeatState
    editor?: ReactNode
    onFocusInputShortcut?: () => void
    composer?: ReactNode
    messageViewportClassName?: string
    loadImage?: TaskImageLoader
    snapshotPatches?: Record<string, TaskSnapshotPatchView>
    snapshotPatchActionId?: string | null
    onInputChange: (value: string) => void
    onCommandTypeChange: (value: TaskCommandType) => void
    onAttachImage?: (file: File) => void
    onRemoveImage?: (imageId: string) => void
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
    onCommitAndPush?: () => void
    onStartRepeat?: () => void
    onStopRepeat?: () => void
    onRefreshTaskResources?: () => void
    onSend?: () => void
    onAbort?: () => void
    onRetry?: () => void
    onLoadSnapshotPatch?: (block: TaskSnapshotBlock) => void
    onLoadSnapshotPatchSlice?: (block: TaskSnapshotBlock, file: OpenADESnapshotPatchFile) => void
}) {
    const blocks = useMemo(() => taskEventBlocks(task), [task])
    const comments = useMemo(() => openADETaskComments(task), [task])
    const activePlanEventId = latestActivePlanEventId(task)
    const activePlan = activePlanEventId !== null
    const repeatActive = repeatState !== undefined
    const canSubmitTurnInput = isRunning ? taskTurnCapabilities.canEnqueue : taskTurnCapabilities.canStart
    const canAbortTask = isRunning && Boolean(onAbort)
    const canRetryTask = !isRunning && Boolean(onRetry) && taskHasRetryableLastAction(task)
    const canCommitAndPush =
        Boolean(task && !task.unavailableReason && onCommitAndPush) &&
        !isRunning &&
        canSubmitTurnInput &&
        (taskGitSummary === null || taskGitSummary.hasChanges || (taskGitSummary.ahead ?? 0) > 0)
    const canAttachTaskImages = Boolean(onAttachImage)
    const shortcutHintsVisible = useMetaKeyPressed()
    const imageDragDepthRef = useRef(0)
    const [isImageDragOver, setIsImageDragOver] = useState(false)
    const desktopCommandDescriptors = useMemo(() => {
        return buildTaskShellCommandDescriptors({
            repeatActive,
            closed: task?.closed ?? false,
            working: isRunning,
            activePlan,
            feedback: canSubmitTurnInput,
            input: input.trim().length > 0,
            retryable: canRetryTask,
            actionHistory: blocks.length > 0,
            gitWorkingChanges: taskGitSummary?.hasChanges === true,
            gitStateUnknown: taskGitSummary === null,
            unpushedCommits: (taskGitSummary?.ahead ?? 0) > 0,
            commitAndPushInProgress: false,
        })
    }, [activePlan, blocks.length, canRetryTask, canSubmitTurnInput, input, isRunning, repeatActive, task?.closed, taskGitSummary])
    const composerCommands = useMemo(() => {
        const desktopTurnCommands = desktopCommandDescriptors
            .map((command) => TASK_COMMAND_TYPE_BY_SHELL_COMMAND_ID[command.id])
            .filter((type): type is TaskCommandType => type !== undefined)

        if (!activePlan) return [...desktopTurnCommands, "hyperplan"] satisfies TaskCommandType[]
        return desktopTurnCommands
    }, [activePlan, desktopCommandDescriptors])
    const visibleComposerCommands = useMemo(() => {
        if (!canSubmitTurnInput) return []
        return isRunning ? composerCommands.filter(canQueueTaskCommandWhileRunning) : composerCommands
    }, [canSubmitTurnInput, composerCommands, isRunning])
    const canReviewPlan =
        Boolean(task && !task.unavailableReason && onStartReview) &&
        desktopCommandDescriptors.some((command) => command.id === "reviewPlan" && command.enabled)
    const canReviewWork =
        Boolean(task && !task.unavailableReason && onStartReview) &&
        desktopCommandDescriptors.some((command) => command.id === "review" && command.enabled)
    const canCancelPlan =
        Boolean(task && !task.unavailableReason && activePlanEventId && onCancelPlan) &&
        desktopCommandDescriptors.some((command) => command.id === "cancelPlan" && command.enabled)
    const canStartRepeat =
        Boolean(task && !task.unavailableReason && onStartRepeat) &&
        desktopCommandDescriptors.some((command) => command.id === "repeat" && command.enabled)
    const canStopRepeat =
        Boolean(task && !task.unavailableReason && onStopRepeat) &&
        desktopCommandDescriptors.some((command) => command.id === "repeatStop" && command.enabled)
    const closeToggleDescriptor = desktopCommandDescriptors.find((command) => (command.id === "close" || command.id === "reopen") && command.enabled)
    const canToggleClosedFromComposer = Boolean(task && !task.unavailableReason && onToggleClosed && closeToggleDescriptor)
    const composerCommandShortcutLabels = canReviewWork ? TASK_COMMAND_SHORTCUT_LABELS_WITHOUT_HYPERPLAN : TASK_COMMAND_SHORTCUT_LABELS
    const shortcutCommandTypes = useMemo(() => {
        return new Map(
            visibleComposerCommands.flatMap((type) => {
                const label = composerCommandShortcutLabels[type]
                if (!label) return []
                const shortcutNumber = Number.parseInt(label, 10)
                return Number.isInteger(shortcutNumber) ? ([[shortcutNumber, type]] satisfies [number, TaskCommandType][]) : []
            })
        )
    }, [composerCommandShortcutLabels, visibleComposerCommands])
    const visibleAgentControls = canSubmitTurnInput ? agentControls : agentControls?.mcpControl ? { mcpControl: agentControls.mcpControl } : undefined
    const composerActions = useMemo<readonly TaskComposerAction[]>(() => {
        const actions: TaskComposerAction[] = []
        if (canCancelPlan && activePlanEventId && onCancelPlan) {
            actions.push({
                id: "cancelPlan",
                label: "Cancel Plan",
                ariaLabel: "Cancel active plan from composer",
                shortcutLabel: TASK_CANCEL_PLAN_SHORTCUT_LABEL,
                onClick: () => onCancelPlan(activePlanEventId),
            })
        }
        if (canReviewPlan && onStartReview) {
            actions.push({
                id: "reviewPlan",
                label: "Review Plan",
                shortcutLabel: TASK_REVIEW_PLAN_SHORTCUT_LABEL,
                onClick: () => onStartReview("plan"),
            })
        }
        if (canReviewWork && onStartReview) {
            actions.push({
                id: "review",
                label: "Review",
                shortcutLabel: TASK_REVIEW_SHORTCUT_LABEL,
                onClick: () => onStartReview("work"),
            })
        }
        if (canStartRepeat && onStartRepeat) {
            actions.push({
                id: "repeat",
                label: "Repeat",
                shortcutLabel: TASK_REPEAT_SHORTCUT_LABEL,
                onClick: onStartRepeat,
            })
        }
        if (canStopRepeat && onStopRepeat) {
            actions.push({
                id: "repeatStop",
                label: "Stop",
                ariaLabel: "Stop repeat",
                shortcutLabel: TASK_ABORT_SHORTCUT_LABEL,
                onClick: onStopRepeat,
            })
        }
        if (canCommitAndPush && onCommitAndPush) {
            actions.push({
                id: "commitAndPush",
                label: "Commit & Push",
                shortcutLabel: TASK_COMMIT_AND_PUSH_SHORTCUT_LABEL,
                onClick: onCommitAndPush,
            })
        }
        if (canToggleClosedFromComposer && closeToggleDescriptor && onToggleClosed) {
            actions.push({
                id: closeToggleDescriptor.id,
                label: closeToggleDescriptor.label,
                ariaLabel: `${closeToggleDescriptor.label} task from composer`,
                shortcutLabel: TASK_CLOSE_SHORTCUT_LABEL,
                onClick: onToggleClosed,
            })
        }
        return actions
    }, [
        activePlanEventId,
        canCancelPlan,
        canCommitAndPush,
        canReviewPlan,
        canReviewWork,
        canStartRepeat,
        canStopRepeat,
        canToggleClosedFromComposer,
        closeToggleDescriptor,
        onCancelPlan,
        onCommitAndPush,
        onStartRepeat,
        onStartReview,
        onStopRepeat,
        onToggleClosed,
    ])

    useEffect(() => {
        const handleCommandShortcut = (event: KeyboardEvent) => {
            if (isLoading || isSubmitting || !isOnline) return

            const shortcutIndex = getMetaDigitShortcutIndex(event)
            if (shortcutIndex === null) return

            const shortcutNumber = shortcutIndex + 1
            if (shortcutNumber === Number.parseInt(TASK_ABORT_SHORTCUT_LABEL, 10) && canStopRepeat && onStopRepeat) {
                event.preventDefault()
                onStopRepeat()
                return
            }

            if (shortcutNumber === Number.parseInt(TASK_ABORT_SHORTCUT_LABEL, 10)) {
                if (canAbortTask && onAbort) {
                    event.preventDefault()
                    onAbort()
                }
                return
            }

            if (shortcutNumber === Number.parseInt(TASK_RETRY_SHORTCUT_LABEL, 10)) {
                if (canRetryTask && onRetry) {
                    event.preventDefault()
                    onRetry()
                }
                return
            }

            if (shortcutNumber === Number.parseInt(TASK_REVIEW_PLAN_SHORTCUT_LABEL, 10) && canReviewPlan && onStartReview) {
                event.preventDefault()
                onStartReview("plan")
                return
            }

            if (shortcutNumber === Number.parseInt(TASK_REVIEW_SHORTCUT_LABEL, 10) && canReviewWork && onStartReview) {
                event.preventDefault()
                onStartReview("work")
                return
            }

            if (shortcutNumber === Number.parseInt(TASK_REPEAT_SHORTCUT_LABEL, 10) && canStartRepeat && onStartRepeat) {
                event.preventDefault()
                onStartRepeat()
                return
            }

            if (shortcutNumber === Number.parseInt(TASK_COMMIT_AND_PUSH_SHORTCUT_LABEL, 10)) {
                if (canCommitAndPush && onCommitAndPush) {
                    event.preventDefault()
                    onCommitAndPush()
                }
                return
            }

            const commandTypeForShortcut = shortcutCommandTypes.get(shortcutNumber)
            if (!commandTypeForShortcut) return
            if (isRunning && !canQueueTaskCommandWhileRunning(commandTypeForShortcut)) return

            event.preventDefault()
            onCommandTypeChange(commandTypeForShortcut)
        }

        window.addEventListener("keydown", handleCommandShortcut, true)
        return () => window.removeEventListener("keydown", handleCommandShortcut, true)
    }, [
        canAbortTask,
        canCommitAndPush,
        canRetryTask,
        canReviewPlan,
        canReviewWork,
        canStartRepeat,
        canStopRepeat,
        isLoading,
        isOnline,
        isRunning,
        isSubmitting,
        onAbort,
        onCommandTypeChange,
        onCommitAndPush,
        onRetry,
        onStartRepeat,
        onStartReview,
        onStopRepeat,
        shortcutCommandTypes,
    ])

    const handleImageDragEnter = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            if (!canAttachTaskImages || !event.dataTransfer.types.includes("Files")) return
            event.preventDefault()
            imageDragDepthRef.current += 1
            setIsImageDragOver(true)
        },
        [canAttachTaskImages]
    )

    const handleImageDragOver = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            if (!canAttachTaskImages || !event.dataTransfer.types.includes("Files")) return
            event.preventDefault()
        },
        [canAttachTaskImages]
    )

    const handleImageDragLeave = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            if (!canAttachTaskImages) return
            event.preventDefault()
            imageDragDepthRef.current -= 1
            if (imageDragDepthRef.current <= 0) {
                imageDragDepthRef.current = 0
                setIsImageDragOver(false)
            }
        },
        [canAttachTaskImages]
    )

    const handleImageDrop = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            if (!canAttachTaskImages || !onAttachImage) return
            event.preventDefault()
            imageDragDepthRef.current = 0
            setIsImageDragOver(false)
            for (const file of Array.from(event.dataTransfer.files)) {
                if (file.type.startsWith("image/")) onAttachImage(file)
            }
        },
        [canAttachTaskImages, onAttachImage]
    )

    return (
        <div
            className="relative flex h-full w-full max-w-full flex-col overflow-hidden"
            onDragEnter={canAttachTaskImages ? handleImageDragEnter : undefined}
            onDragOver={canAttachTaskImages ? handleImageDragOver : undefined}
            onDragLeave={canAttachTaskImages ? handleImageDragLeave : undefined}
            onDrop={canAttachTaskImages ? handleImageDrop : undefined}
        >
            {isImageDragOver && (
                <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="border-2 border-dashed border-primary bg-base-100/95 px-10 py-8 text-center">
                        <ImagePlus className="mx-auto mb-3 h-9 w-9 text-primary" />
                        <div className="text-base font-medium text-base-content">Drop images here</div>
                        <div className="mt-1 text-sm text-muted">PNG, JPG, GIF, WebP</div>
                    </div>
                </div>
            )}
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
                onCancelPlan={onCancelPlan}
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
                    commands={visibleComposerCommands}
                    actions={composerActions}
                    agentControls={visibleAgentControls}
                    hyperplanControl={canSubmitTurnInput ? hyperplanControl : undefined}
                    commandShortcutLabels={composerCommandShortcutLabels}
                    abortShortcutLabel={canAbortTask ? TASK_ABORT_SHORTCUT_LABEL : undefined}
                    retryShortcutLabel={canRetryTask ? TASK_RETRY_SHORTCUT_LABEL : undefined}
                    shortcutHintsVisible={shortcutHintsVisible}
                    imageAttachments={canAttachTaskImages ? imageAttachments : undefined}
                    imageAttachLoading={canAttachTaskImages ? imageAttachLoading : false}
                    repeatState={repeatState}
                    editor={canSubmitTurnInput ? editor : undefined}
                    inputDisabled={!canSubmitTurnInput}
                    onInputChange={onInputChange}
                    onCommandTypeChange={onCommandTypeChange}
                    onAttachImage={canAttachTaskImages ? onAttachImage : undefined}
                    onRemoveImage={onRemoveImage}
                    onFocusInputShortcut={onFocusInputShortcut}
                    onSend={onSend}
                    onAbort={canAbortTask ? onAbort : undefined}
                    onRetry={canRetryTask ? onRetry : undefined}
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
    isSubmitting: boolean
    messageViewportClassName?: string
    loadImage?: TaskImageLoader
    snapshotPatches?: Record<string, TaskSnapshotPatchView>
    snapshotPatchActionId?: string | null
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
                        isRunning={isRunning}
                        isSubmitting={isSubmitting}
                        onTitleChange={onTitleChange}
                        onSaveTitle={onSaveTitle}
                        onGenerateTitle={onGenerateTitle}
                        onPrepareEnvironment={onPrepareEnvironment}
                        onToggleClosed={onToggleClosed}
                        onDeleteTask={onDeleteTask}
                        onCancelPlan={onCancelPlan}
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
