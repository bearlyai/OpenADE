/**
 * InputManager
 *
 * Manages input state and actions for a task:
 * - Input value
 * - Mode-aware button state computations
 * - Centralized command definitions with ordering
 *
 * All commands that execute actions consume pending comments.
 */

import NiceModal from "@ebay/nice-modal-react"
import type { LucideIcon } from "lucide-react"
import {
    ArrowUpFromLine,
    CheckCircle,
    ClipboardCheck,
    FileText,
    MessageCircleQuestion,
    Play,
    RefreshCcw,
    RefreshCw,
    Repeat,
    RotateCcw,
    Send,
    Square,
    X,
} from "lucide-react"
import { makeAutoObservable } from "mobx"
import { OPENADE_METHOD, type OpenADEMethod } from "../../../../openade-client/src"
import type { OpenADETurnStartRequest, OpenADETurnStartResult } from "../../../../openade-module/src"
import { track } from "../../analytics"
import { ReviewPickerModal } from "../../components/ReviewPickerModal"
import { ACTION_PROMPTS } from "../../prompts/actionPrompts"
import {
    COMMIT_AND_PUSH_COMMAND_LABEL,
    TRACKABLE_TASK_COMMAND_IDS,
    type TaskShellCommandDescriptor,
    type TaskShellCommandId,
    type TaskShellCommandStyle,
    buildTaskShellCommandDescriptors,
} from "../../shell/task/taskCommandModel"
import { taskCommandLabel } from "../../shell/task/taskCommands"
import { latestActivePlanEventId, taskHasActivePlan } from "../../shell/task/taskPlanState"
import type { ActionEvent, QueuedTurn, UserInputContext } from "../../types"
import type { ImagePersistencePayload } from "../../utils/imageAttachment"
import { createProductProjectProcessAccess } from "../productProjectProcessAccess"
import type { CodeStore } from "../store"
import type { EditorSnapshot } from "./SmartEditorManager"
import type { SmartEditorManager } from "./SmartEditorManager"

const INTERRUPT_IDLE_TIMEOUT_MS = 30_000
const INTERRUPT_IDLE_POLL_MS = 100
const TURN_START_COMMAND_IDS: ReadonlySet<TaskShellCommandId> = new Set([
    "interrupt",
    "retry",
    "runPlan",
    "revise",
    "do",
    "plan",
    "ask",
    "repeat",
    "commitAndPush",
])
const REVIEW_START_COMMAND_IDS: ReadonlySet<TaskShellCommandId> = new Set(["review", "reviewPlan"])
const TASK_METADATA_COMMAND_IDS: ReadonlySet<TaskShellCommandId> = new Set(["cancelPlan", "close", "reopen"])

export type CommandStyle = TaskShellCommandStyle

export interface Command extends TaskShellCommandDescriptor {
    action: () => Promise<void> | void
    icon: LucideIcon
}

export class InputManager {
    private taskId: string

    constructor(
        private store: CodeStore,
        taskId: string,
        private editorManager: SmartEditorManager
    ) {
        this.taskId = taskId
        makeAutoObservable(this)
    }

    // === Computed state ===

    private get taskModel() {
        return this.store.tasks.getTaskModel(this.taskId)
    }

    private get hasActivePlan(): boolean {
        const task = this.store.tasks.getTask(this.taskId)
        if (latestActivePlanEventId(task)) return true
        const taskHasPlanEvent = task?.events.some((event) => {
            if (event.type !== "action") return false
            return event.source.type === "plan" || event.source.type === "revise" || event.source.type === "hyperplan"
        }) ?? false
        if (taskHasPlanEvent) return taskHasActivePlan(task)
        return this.taskModel?.hasActivePlan ?? false
    }

    private get isWorking(): boolean {
        return this.store.isTaskRunning(this.taskId)
    }

    private get productRuntimeOwnsCapabilities(): boolean {
        return this.store.shouldUseRuntimeProductTaskRoute()
    }

    private canUseProductCapability(method: OpenADEMethod): boolean {
        if (!this.productRuntimeOwnsCapabilities) return true
        return this.store.canUseProductMethod(method)
    }

    private async canUseProductCapabilityAfterConnect(method: OpenADEMethod): Promise<boolean> {
        if (!this.productRuntimeOwnsCapabilities) return true
        if (this.store.usesCoreOwnedProductRuntime()) return this.store.canUseProductMethodAfterConnect(method)
        if (this.store.shouldUseRuntimeProductAPI()) return this.store.canUseProductMethod(method)
        return this.store.canUseProductMethodAfterConnect(method)
    }

    private get canStartTurns(): boolean {
        return this.canUseProductCapability(OPENADE_METHOD.turnStart)
    }

    private async canStartTurnsAfterConnect(): Promise<boolean> {
        return this.canUseProductCapabilityAfterConnect(OPENADE_METHOD.turnStart)
    }

    private get canStartReviews(): boolean {
        return this.canUseProductCapability(OPENADE_METHOD.reviewStart)
    }

    private async canStartReviewsAfterConnect(): Promise<boolean> {
        return this.canUseProductCapabilityAfterConnect(OPENADE_METHOD.reviewStart)
    }

    private get canUpdateTaskMetadata(): boolean {
        return this.canUseProductCapability(OPENADE_METHOD.taskMetadataUpdate)
    }

    private async canUpdateTaskMetadataAfterConnect(): Promise<boolean> {
        return this.canUseProductCapabilityAfterConnect(OPENADE_METHOD.taskMetadataUpdate)
    }

    private async canReadMcpServersAfterConnect(): Promise<boolean> {
        return this.canUseProductCapabilityAfterConnect(OPENADE_METHOD.settingsMcpServersRead)
    }

    get canCancelQueuedTurn(): boolean {
        return this.canUseProductCapability(OPENADE_METHOD.queuedTurnCancel)
    }

    get canAttachImages(): boolean {
        if (!this.productRuntimeOwnsCapabilities) return true
        return this.canStartTurns && this.store.canUseProductMethod(OPENADE_METHOD.taskImageWrite)
    }

    private async canAttachImagesAfterConnect(): Promise<boolean> {
        if (!this.productRuntimeOwnsCapabilities) return true
        return (await this.canStartTurnsAfterConnect()) && (await this.canUseProductCapabilityAfterConnect(OPENADE_METHOD.taskImageWrite))
    }

    private get hasInput(): boolean {
        return this.editorManager.value.trim().length > 0 || this.editorManager.pendingImages.length > 0
    }

    private get hasUnsubmittedComments(): boolean {
        return this.store.comments.getPendingCommentCount(this.taskId) > 0
    }

    private get hasFeedback(): boolean {
        return this.hasInput || this.hasUnsubmittedComments
    }

    private get hasAnyActionHistory(): boolean {
        const events = this.store.tasks.getTask(this.taskId)?.events ?? []
        return events.some((event) => event.type === "action")
    }

    private get hasGitWorkingChanges(): boolean {
        return this.taskModel?.hasWorkingChanges ?? false
    }

    private get hasUnknownRuntimeGitState(): boolean {
        return this.productRuntimeOwnsCapabilities && this.taskModel?.hasGitStateLoaded === false
    }

    private get hasUnpushedCommits(): boolean {
        return (this.taskModel?.aheadCount ?? 0) > 0
    }

    private get lastActionEvent(): ActionEvent | undefined {
        const task = this.store.tasks.getTask(this.taskId)
        const events = task?.events ?? []
        const last = events[events.length - 1]
        return last?.type === "action" ? last : undefined
    }

    private get canRetry(): boolean {
        return this.lastActionEvent?.status === "error" && !this.isWorking
    }

    private get isClosed(): boolean {
        return this.store.tasks.getTask(this.taskId)?.closed ?? false
    }

    get queuedTurns(): QueuedTurn[] {
        const storedTurns = this.taskModel?.queuedTurns ?? []
        return this.store.queuedTurns.queuedForTask(this.taskId, storedTurns)
    }

    async cancelQueuedTurn(queuedTurnId: string): Promise<void> {
        if (!this.canCancelQueuedTurn) return
        const cancelled = await this.taskModel?.cancelQueuedTurn(queuedTurnId)
        if (!cancelled) return
        this.store.queuedTurns.suppressQueuedTurn(this.taskId, queuedTurnId, this.taskModel?.queuedTurns ?? [])
    }

    private get isCommitAndPushInProgress(): boolean {
        const last = this.lastActionEvent
        if (!last || last.status !== "in_progress") return false
        return last.source.userLabel === COMMIT_AND_PUSH_COMMAND_LABEL
    }

    /** Whether the input area should be disabled (task is closed) */
    get isDisabled(): boolean {
        return this.isClosed
    }

    /** Stop all processes associated with this task (used before closing).
     *  Only kills processes for worktree tasks — repo/global processes are shared and should persist. */
    private async stopTaskProcesses(): Promise<void> {
        const taskModel = this.taskModel
        const task = this.store.tasks.getTask(this.taskId)
        if (!taskModel || task?.isolationStrategy?.type !== "worktree") return

        const taskWorkingDir = taskModel.taskWorkingDirHint ?? taskModel.environment?.taskWorkingDir ?? (await taskModel.loadEnvironment())?.taskWorkingDir
        if (!taskWorkingDir) return

        const repoId = taskModel.repoId
        const productAccess =
            this.productRuntimeOwnsCapabilities && repoId
                ? createProductProjectProcessAccess(this.store, {
                      repoId,
                      taskId: this.taskId,
                  })
                : undefined
        await this.store.repoProcesses.stopAllForContext({ type: "worktree", root: taskWorkingDir }, productAccess)
    }

    // === Input mutations (delegated to SmartEditorManager) ===

    get value(): string {
        return this.editorManager.value
    }

    get files(): string[] {
        return this.editorManager.files
    }

    setValue(value: string): void {
        this.editorManager.setValue(value)
    }

    clear(): void {
        this.editorManager.clear()
    }

    async persistImage(payload: ImagePersistencePayload): Promise<void> {
        if (!(await this.canAttachImagesAfterConnect())) throw new Error("Task image upload is not available from this runtime")
        await this.store.persistProductTaskImage(payload)
    }

    private captureAndClear(): UserInputContext {
        const userInput = this.editorManager.value.trim()
        const images = [...this.editorManager.pendingImages]
        this.editorManager.clear()
        return { userInput, images }
    }

    private captureSnapshotAndClear(): { input: UserInputContext; snapshot: EditorSnapshot } {
        const snapshot = this.editorManager.captureSnapshot()
        const input = { userInput: snapshot.value.trim(), images: [...snapshot.pendingImages] }
        this.editorManager.clear({ revokeImagePreviews: false })
        return { input, snapshot }
    }

    private async executeRuntimeTurn(
        type: OpenADETurnStartRequest["type"],
        input: UserInputContext,
        options: Pick<OpenADETurnStartRequest, "label" | "includeComments" | "appendSystemPrompt" | "hyperplanStrategy"> = {},
        lifecycle: { onAccepted?: () => void } = {}
    ): Promise<void> {
        if (!(await this.canStartTurnsAfterConnect())) return

        const taskModel = this.taskModel
        if (!taskModel?.repoId) return

        const useLegacyTaskStore = !this.store.shouldUseRuntimeProductTaskRoute()
        if (useLegacyTaskStore) {
            await this.store.getTaskStore(taskModel.repoId, this.taskId)
        }
        const enabledMcpServerIds = (await this.canReadMcpServersAfterConnect()) ? taskModel.enabledMcpServerIds : []
        const canAttachImages = await this.canAttachImagesAfterConnect()
        const submittedInput: UserInputContext = {
            userInput: input.userInput,
            images: canAttachImages ? input.images : [],
        }
        const request: OpenADETurnStartRequest = {
            repoId: taskModel.repoId,
            type,
            input: submittedInput.userInput,
            images: submittedInput.images,
            inTaskId: this.taskId,
            harnessId: taskModel.harnessId,
            modelId: taskModel.model,
            thinking: taskModel.thinking,
            fastMode: taskModel.fastMode,
            ...options,
        }
        if (enabledMcpServerIds.length > 0) request.enabledMcpServerIds = enabledMcpServerIds
        const result = await this.store.startProductTurn(request)
        lifecycle.onAccepted?.()
        this.rememberQueuedTurn(
            type,
            result,
            submittedInput,
            {
                enabledMcpServerIds,
                harnessId: taskModel.harnessId,
                model: taskModel.model,
                thinking: taskModel.thinking,
                fastMode: taskModel.fastMode,
            },
            options
        )
        try {
            if (useLegacyTaskStore) {
                await this.store.refreshTaskStoreFromStorage(this.taskId)
            }
        } finally {
            this.store.queuedTurns.reconcileTaskWithStorage(this.taskId, taskModel.queuedTurns)
        }
    }

    private rememberQueuedTurn(
        type: OpenADETurnStartRequest["type"],
        result: OpenADETurnStartResult,
        input: UserInputContext,
        taskModel: {
            enabledMcpServerIds: string[]
            harnessId: string
            model: string
            thinking: QueuedTurn["thinking"]
            fastMode: boolean
        },
        options: Pick<OpenADETurnStartRequest, "label" | "includeComments" | "appendSystemPrompt" | "hyperplanStrategy">
    ): void {
        if (!result.queued || !result.queuedTurnId) return
        if (type !== "do" && type !== "ask" && type !== "hyperplan") return

        const now = new Date().toISOString()
        const turn: QueuedTurn = {
            id: result.queuedTurnId,
            type,
            input: input.userInput,
            images: input.images,
            status: "queued",
            createdAt: now,
            updatedAt: now,
            appendSystemPrompt: options.appendSystemPrompt,
            enabledMcpServerIds: taskModel.enabledMcpServerIds,
            harnessId: taskModel.harnessId,
            modelId: taskModel.model,
            label: options.label ?? taskCommandLabel(type, { queued: true }),
            includeComments: options.includeComments,
            hyperplanStrategy: options.hyperplanStrategy,
            thinking: taskModel.thinking,
            fastMode: taskModel.fastMode,
        }

        this.store.queuedTurns.acceptQueuedTurn(this.taskId, turn)
    }

    private waitForTaskIdle(timeoutMs = INTERRUPT_IDLE_TIMEOUT_MS): Promise<void> {
        const startedAt = Date.now()

        return new Promise((resolve, reject) => {
            const poll = () => {
                if (!this.store.isTaskRunning(this.taskId)) {
                    resolve()
                    return
                }

                if (Date.now() - startedAt >= timeoutMs) {
                    reject(new Error("Timed out waiting for the running turn to stop"))
                    return
                }

                globalThis.setTimeout(poll, INTERRUPT_IDLE_POLL_MS)
            }

            poll()
        })
    }

    private async interruptAndRunDo(): Promise<void> {
        const { input, snapshot } = this.captureSnapshotAndClear()
        let accepted = false

        try {
            const interrupted = await this.store.queries.interruptTask(this.taskId)
            if (interrupted) await this.waitForTaskIdle()
            await this.executeRuntimeTurn(
                "do",
                input,
                {},
                {
                    onAccepted: () => {
                        accepted = true
                    },
                }
            )
        } catch (error) {
            if (!accepted) this.editorManager.restoreSnapshot(snapshot)
            throw error
        }
    }

    // === Repeat mode ===

    get repeatState() {
        const r = this.store.repeat
        if (r.activeTaskId !== this.taskId || !r.isActive) return null
        return {
            stopOnText: r.stopOnText,
            maxRuns: r.maxRuns,
            iterationCount: r.iterationCount,
            setStopOnText: (v: string) => r.setStopOnText(v),
            setMaxRuns: (v: number) => r.setMaxRuns(v),
        }
    }

    // === Commands ===

    get commands(): Command[] {
        const commandActions: Record<TaskShellCommandId, Pick<Command, "icon" | "action">> = {
            stop: {
                icon: Square,
                action: async () => {
                    await this.store.queries.abortTask(this.taskId)
                },
            },
            interrupt: {
                icon: Send,
                action: async () => {
                    await this.interruptAndRunDo()
                },
            },
            retry: {
                icon: RefreshCcw,
                action: async () => {
                    await this.executeRuntimeTurn(
                        "do",
                        { userInput: ACTION_PROMPTS.retry, images: [] },
                        {
                            label: "Retry",
                            includeComments: false,
                        }
                    )
                },
            },
            runPlan: {
                icon: Play,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.executeRuntimeTurn("run_plan", input)
                },
            },
            reviewPlan: {
                icon: ClipboardCheck,
                action: async () => {
                    if (!(await this.canStartReviewsAfterConnect())) return
                    await NiceModal.show(ReviewPickerModal, {
                        taskId: this.taskId,
                        reviewType: "plan" as const,
                        customInstructions: this.editorManager.value.trim(),
                        onStart: () => this.clear(),
                    })
                },
            },
            revise: {
                icon: RefreshCw,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.executeRuntimeTurn("revise", input)
                },
            },
            cancelPlan: {
                icon: X,
                action: async () => {
                    if (!this.canUpdateTaskMetadata) return
                    const latestPlan = this.taskModel?.getLatestPlanEvent()
                    if (latestPlan) {
                        await this.store.execution.cancelPlan(this.taskId, latestPlan.id)
                    }
                },
            },
            do: {
                icon: Play,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.executeRuntimeTurn("do", input)
                },
            },
            plan: {
                icon: FileText,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.executeRuntimeTurn("plan", input)
                },
            },
            ask: {
                icon: MessageCircleQuestion,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.executeRuntimeTurn("ask", input)
                },
            },
            review: {
                icon: ClipboardCheck,
                action: async () => {
                    if (!(await this.canStartReviewsAfterConnect())) return
                    await NiceModal.show(ReviewPickerModal, {
                        taskId: this.taskId,
                        reviewType: "work" as const,
                        customInstructions: this.editorManager.value.trim(),
                        onStart: () => this.clear(),
                    })
                },
            },
            repeat: {
                icon: Repeat,
                action: () => {
                    this.store.repeat.start(this.taskId)
                },
            },
            commitAndPush: {
                icon: ArrowUpFromLine,
                action: async () => {
                    const taskModel = this.taskModel
                    if (this.productRuntimeOwnsCapabilities) {
                        await taskModel?.refreshGitState({ force: true })
                        if (!taskModel?.hasWorkingChanges && (taskModel?.aheadCount ?? 0) <= 0) return
                    }

                    const input = this.captureAndClear()

                    const repoId = taskModel?.repoId
                    let hasGhCli = taskModel?.hasGhCli ?? false
                    if (repoId && !hasGhCli) {
                        hasGhCli = await this.store.repos.refreshGhCliStatus(repoId)
                        if (hasGhCli) {
                            taskModel?.invalidateEnvironmentCache()
                        }
                    }

                    const branch = taskModel?.gitStatus?.branch ?? "HEAD"
                    await this.executeRuntimeTurn(
                        "do",
                        { userInput: ACTION_PROMPTS.commitAndPush(input.userInput, hasGhCli, branch), images: input.images },
                        {
                            label: COMMIT_AND_PUSH_COMMAND_LABEL,
                            includeComments: false,
                        }
                    )
                },
            },
            close: {
                icon: CheckCircle,
                action: async () => {
                    if (!(await this.canUpdateTaskMetadataAfterConnect())) return
                    if (this.store.repeat.activeTaskId === this.taskId && this.store.repeat.isActive) this.store.repeat.stop()
                    await this.stopTaskProcesses()
                    await this.store.tasks.setTaskClosed(this.taskId, true)
                },
            },
            reopen: {
                icon: RotateCcw,
                action: async () => {
                    if (!(await this.canUpdateTaskMetadataAfterConnect())) return
                    await this.store.tasks.setTaskClosed(this.taskId, false)
                },
            },
            repeatStop: {
                icon: Square,
                action: () => {
                    this.store.repeat.stop()
                },
            },
        }

        return buildTaskShellCommandDescriptors({
            repeatActive: this.store.repeat.activeTaskId === this.taskId && this.store.repeat.isActive,
            closed: this.isClosed,
            working: this.isWorking,
            activePlan: this.hasActivePlan,
            feedback: this.hasFeedback,
            input: this.hasInput,
            retryable: this.canRetry,
            actionHistory: this.hasAnyActionHistory,
            gitWorkingChanges: this.hasGitWorkingChanges,
            gitStateUnknown: this.hasUnknownRuntimeGitState,
            unpushedCommits: this.hasUnpushedCommits,
            commitAndPushInProgress: this.isCommitAndPushInProgress,
            forceAllCommands: this.store.personalSettingsStore?.settings.current.devForceAllCommands ?? false,
        })
            .filter((descriptor) => this.canStartTurns || !TURN_START_COMMAND_IDS.has(descriptor.id))
            .filter((descriptor) => this.canStartReviews || !REVIEW_START_COMMAND_IDS.has(descriptor.id))
            .filter((descriptor) => this.canUpdateTaskMetadata || !TASK_METADATA_COMMAND_IDS.has(descriptor.id))
            .map((descriptor) => ({ ...descriptor, ...commandActions[descriptor.id] }))
    }

    async runCommand(id: string): Promise<void> {
        const cmd = this.commands.find((c) => c.id === id)
        if (!cmd || !cmd.enabled) return
        if (TURN_START_COMMAND_IDS.has(cmd.id) && !this.canStartTurns) return
        if (REVIEW_START_COMMAND_IDS.has(cmd.id) && !this.canStartReviews) return
        if (TASK_METADATA_COMMAND_IDS.has(cmd.id) && !this.canUpdateTaskMetadata) return

        if (TRACKABLE_TASK_COMMAND_IDS.has(cmd.id)) {
            track("command_run", { commandType: id })
        }

        await cmd.action()
    }
}
