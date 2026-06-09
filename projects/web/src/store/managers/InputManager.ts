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
import type { OpenADETurnStartRequest, OpenADETurnStartResult } from "../../../../openade-module/src"
import { track } from "../../analytics"
import { ReviewPickerModal } from "../../components/ReviewPickerModal"
import { ACTION_PROMPTS } from "../../prompts/prompts"
import {
    COMMIT_AND_PUSH_COMMAND_LABEL,
    TRACKABLE_TASK_COMMAND_IDS,
    type TaskShellCommandDescriptor,
    type TaskShellCommandId,
    type TaskShellCommandStyle,
    buildTaskShellCommandDescriptors,
} from "../../shell/task/taskCommandModel"
import { taskCommandLabel } from "../../shell/task/taskCommands"
import type { ActionEvent, QueuedTurn, UserInputContext } from "../../types"
import type { ImagePersistencePayload } from "../../utils/imageAttachment"
import type { CodeStore } from "../store"
import type { EditorSnapshot } from "./SmartEditorManager"
import type { SmartEditorManager } from "./SmartEditorManager"

const INTERRUPT_IDLE_TIMEOUT_MS = 30_000
const INTERRUPT_IDLE_POLL_MS = 100

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
        return this.taskModel?.hasActivePlan ?? false
    }

    private get isWorking(): boolean {
        return this.store.isTaskRunning(this.taskId)
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
        await this.taskModel?.cancelQueuedTurn(queuedTurnId)
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
        const env = taskModel?.environment
        if (!env?.taskWorkingDir) return

        const task = this.store.tasks.getTask(this.taskId)
        if (task?.isolationStrategy?.type === "worktree") {
            const repoId = taskModel?.repoId
            const productAccess =
                this.store.shouldUseRuntimeProductReads() && repoId
                    ? {
                          startProjectProcess: (args: { definitionId: string }) =>
                              this.store.startProductProjectProcess({ repoId, taskId: this.taskId, definitionId: args.definitionId }),
                          reconnectProjectProcess: (args: { processId: string }) =>
                              this.store.reconnectProductProjectProcess({ repoId, taskId: this.taskId, processId: args.processId }),
                          stopProjectProcess: (args: { processId: string }) =>
                              this.store.stopProductProjectProcess({ repoId, taskId: this.taskId, processId: args.processId }),
                      }
                    : undefined
            await this.store.repoProcesses.stopAllForContext({ type: "worktree", root: env.taskWorkingDir }, productAccess)
        }
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
        options: Pick<OpenADETurnStartRequest, "label" | "includeComments" | "appendSystemPrompt"> = {},
        lifecycle: { onAccepted?: () => void } = {}
    ): Promise<void> {
        const taskModel = this.taskModel
        if (!taskModel?.repoId) return

        const useRuntimeProductReads = this.store.shouldUseRuntimeProductReads()
        if (!useRuntimeProductReads) {
            await this.store.getTaskStore(taskModel.repoId, this.taskId)
        }
        const result = await this.store.startProductTurn({
            repoId: taskModel.repoId,
            type,
            input: input.userInput,
            images: input.images,
            inTaskId: this.taskId,
            enabledMcpServerIds: taskModel.enabledMcpServerIds,
            harnessId: taskModel.harnessId,
            modelId: taskModel.model,
            thinking: taskModel.thinking,
            fastMode: taskModel.fastMode,
            ...options,
        })
        lifecycle.onAccepted?.()
        this.rememberQueuedTurn(type, result, input, taskModel, options)
        try {
            if (!useRuntimeProductReads) {
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
        options: Pick<OpenADETurnStartRequest, "label" | "includeComments" | "appendSystemPrompt">
    ): void {
        if (!result.queued || !result.queuedTurnId) return
        if (type !== "do" && type !== "ask") return

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
                    const input = this.captureAndClear()

                    const repoId = this.taskModel?.repoId
                    let hasGhCli = this.taskModel?.hasGhCli ?? false
                    if (repoId && !hasGhCli) {
                        hasGhCli = await this.store.repos.refreshGhCliStatus(repoId)
                        if (hasGhCli) {
                            this.taskModel?.invalidateEnvironmentCache()
                        }
                    }

                    const branch = this.taskModel?.gitStatus?.branch ?? "HEAD"
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
                    if (this.store.repeat.activeTaskId === this.taskId && this.store.repeat.isActive) this.store.repeat.stop()
                    await this.stopTaskProcesses()
                    await this.store.tasks.setTaskClosed(this.taskId, true)
                },
            },
            reopen: {
                icon: RotateCcw,
                action: async () => {
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
            unpushedCommits: this.hasUnpushedCommits,
            commitAndPushInProgress: this.isCommitAndPushInProgress,
            forceAllCommands: this.store.personalSettingsStore?.settings.current.devForceAllCommands ?? false,
        }).map((descriptor) => ({ ...descriptor, ...commandActions[descriptor.id] }))
    }

    async runCommand(id: string): Promise<void> {
        const cmd = this.commands.find((c) => c.id === id)
        if (!cmd || !cmd.enabled) return

        if (TRACKABLE_TASK_COMMAND_IDS.has(cmd.id)) {
            track("command_run", { commandType: id })
        }

        await cmd.action()
    }
}
