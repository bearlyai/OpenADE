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
import { track } from "../../analytics"
import { ReviewPickerModal } from "../../components/ReviewPickerModal"
import { ACTION_PROMPTS } from "../../prompts/prompts"
import { localOpenADEClient } from "../../runtime/localOpenADEClient"
import type { ActionEvent, QueuedTurn, UserInputContext } from "../../types"
import type { OpenADETurnStartRequest, OpenADETurnStartResult } from "../../../../openade-module/src"
import type { EditorSnapshot } from "./SmartEditorManager"
import type { CodeStore } from "../store"
import type { SmartEditorManager } from "./SmartEditorManager"

const COMMIT_AND_PUSH_LABEL = "Commit & Push"
const INTERRUPT_IDLE_TIMEOUT_MS = 30_000
const INTERRUPT_IDLE_POLL_MS = 100

// Command style customization
export interface CommandStyle {
    variant?: "primary" | "success" | "danger" | "neutral" | "ghost"
}

export interface Command {
    id: string
    label: string
    icon: LucideIcon
    order: number
    style?: CommandStyle
    action: () => Promise<void> | void
    show: boolean
    enabled: boolean
    /** If true, renders with ml-auto before it (pushes to the right) */
    spacer?: boolean
    /** Row grouping: "primary" for direct AI actions, "secondary" for utilities/lifecycle */
    group?: "primary" | "secondary"
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
        return last.source.userLabel === COMMIT_AND_PUSH_LABEL
    }

    /** Whether the input area should be disabled (task is closed) */
    get isDisabled(): boolean {
        return this.isClosed
    }

    private get retryLabel(): string {
        return "Retry"
    }

    /** Label for the plan button — always "Plan"; HyperPlan is a separate button */
    private get planButtonLabel(): string {
        return "Plan"
    }

    /** Stop all processes associated with this task (used before closing).
     *  Only kills processes for worktree tasks — repo/global processes are shared and should persist. */
    private async stopTaskProcesses(): Promise<void> {
        const env = this.taskModel?.environment
        if (!env?.taskWorkingDir) return

        const task = this.store.tasks.getTask(this.taskId)
        if (task?.isolationStrategy?.type === "worktree") {
            await this.store.repoProcesses.stopAllForContext({ type: "worktree", root: env.taskWorkingDir })
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

        await this.store.getTaskStore(taskModel.repoId, this.taskId)
        const result = await localOpenADEClient.startTurn({
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
            await this.store.refreshTaskStoreFromStorage(this.taskId)
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
            label: options.label ?? (type === "ask" ? "Ask Next" : "Do Next"),
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
        // Repeat mode: show only repeat-specific controls + close/reopen
        if (this.store.repeat.activeTaskId === this.taskId && this.store.repeat.isActive) {
            return [
                {
                    id: "repeatStop",
                    label: "Stop",
                    icon: Square,
                    order: 0,
                    style: { variant: "danger" as const },
                    show: true,
                    enabled: true,
                    action: () => {
                        this.store.repeat.stop()
                    },
                },
                // Close
                {
                    id: "close",
                    label: "Close",
                    icon: CheckCircle,
                    order: 200,
                    style: { variant: "neutral" as const },
                    show: !this.isClosed,
                    enabled: true,
                    spacer: true,
                    action: async () => {
                        this.store.repeat.stop()
                        await this.stopTaskProcesses()
                        await this.store.tasks.setTaskClosed(this.taskId, true)
                    },
                },
            ]
                .filter((cmd) => cmd.show)
                .sort((a, b) => a.order - b.order)
        }

        const allCommands: Command[] = [
            // Stop - abort current execution
            {
                id: "stop",
                label: "Stop",
                icon: Square,
                order: 0,
                group: "primary" as const,
                style: { variant: "danger" },
                show: this.isWorking,
                enabled: true,
                action: async () => {
                    await this.store.queries.abortTask(this.taskId)
                },
            },

            // Interrupt - gracefully stop the current turn, then send this message immediately.
            {
                id: "interrupt",
                label: "Interrupt",
                icon: Send,
                order: 2,
                group: "primary" as const,
                style: { variant: "primary" },
                show: this.isWorking && !this.hasActivePlan,
                enabled: this.hasFeedback,
                action: async () => {
                    await this.interruptAndRunDo()
                },
            },

            // Retry - retry the last failed action by prompting the LLM
            {
                id: "retry",
                label: this.retryLabel,
                icon: RefreshCcw,
                order: 1,
                group: "primary" as const,
                style: { variant: "danger" },
                show: this.canRetry,
                enabled: true,
                action: async () => {
                    await this.executeRuntimeTurn(
                        "do",
                        { userInput: ACTION_PROMPTS.retry, images: [] },
                        {
                            label: this.retryLabel,
                            includeComments: false,
                        }
                    )
                },
            },

            // Run Plan - execute the current plan (consumes comments)
            {
                id: "runPlan",
                label: "Run Plan",
                icon: Play,
                order: 4,
                group: "primary" as const,
                style: { variant: "success" },
                show: this.hasActivePlan && !this.isWorking,
                enabled: true,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.executeRuntimeTurn("run_plan", input)
                },
            },

            // Review Plan - one-off external review of the active plan
            {
                id: "reviewPlan",
                label: "Review Plan",
                icon: ClipboardCheck,
                order: 8,
                group: "secondary" as const,
                style: { variant: "neutral" },
                show: this.hasActivePlan && !this.isWorking,
                enabled: true,
                action: async () => {
                    await NiceModal.show(ReviewPickerModal, {
                        taskId: this.taskId,
                        reviewType: "plan" as const,
                        customInstructions: this.editorManager.value.trim(),
                        onStart: () => this.clear(),
                    })
                },
            },

            // Revise Plan - update plan with feedback (consumes comments)
            {
                id: "revise",
                label: "Revise Plan",
                icon: RefreshCw,
                order: 6,
                group: "primary" as const,
                style: { variant: "primary" },
                show: this.hasActivePlan && !this.isWorking,
                enabled: this.hasFeedback,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.executeRuntimeTurn("revise", input)
                },
            },

            // Cancel Plan - exit plan mode without executing
            {
                id: "cancelPlan",
                label: "Cancel Plan",
                icon: X,
                order: 7,
                group: "secondary" as const,
                style: { variant: "danger" },
                show: this.hasActivePlan && !this.isWorking,
                enabled: true,
                action: async () => {
                    const latestPlan = this.taskModel?.getLatestPlanEvent()
                    if (latestPlan) {
                        await this.store.execution.cancelPlan(this.taskId, latestPlan.id)
                    }
                },
            },
            // Do - direct action without planning (consumes comments)
            {
                id: "do",
                label: this.isWorking ? "Do Next" : "Do",
                icon: Play,
                order: 10,
                group: "primary" as const,
                style: { variant: "success" },
                show: !this.hasActivePlan,
                enabled: this.hasFeedback,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.executeRuntimeTurn("do", input)
                },
            },

            // Plan - create a new plan (consumes comments).
            {
                id: "plan",
                label: this.planButtonLabel,
                icon: FileText,
                order: 15,
                group: "primary" as const,
                style: { variant: "primary" },
                show: !this.hasActivePlan && !this.isWorking,
                enabled: this.hasFeedback,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.executeRuntimeTurn("plan", input)
                },
            },

            // Ask - read-only exploration (consumes comments)
            {
                id: "ask",
                label: this.isWorking ? "Ask Next" : "Ask",
                icon: MessageCircleQuestion,
                order: 20,
                group: "primary" as const,
                style: { variant: "neutral" },
                show: true,
                enabled: this.hasFeedback,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.executeRuntimeTurn("ask", input)
                },
            },

            // Review - one-off external review of recent work when no active plan exists
            {
                id: "review",
                label: "Review",
                icon: ClipboardCheck,
                order: 21,
                group: "secondary" as const,
                style: { variant: "neutral" },
                show: !this.hasActivePlan && !this.isWorking && this.hasAnyActionHistory,
                enabled: true,
                action: async () => {
                    await NiceModal.show(ReviewPickerModal, {
                        taskId: this.taskId,
                        reviewType: "work" as const,
                        customInstructions: this.editorManager.value.trim(),
                        onStart: () => this.clear(),
                    })
                },
            },

            // Repeat - repeatedly send the same prompt
            {
                id: "repeat",
                label: "Repeat",
                icon: Repeat,
                order: 22,
                group: "secondary" as const,
                style: { variant: "neutral" },
                show: !this.hasActivePlan && !this.isWorking,
                enabled: this.hasInput,
                action: () => {
                    this.store.repeat.start(this.taskId)
                },
            },

            // Commit & Push - commit working changes (if any), then push (does NOT consume comments)
            {
                id: "commitAndPush",
                label: COMMIT_AND_PUSH_LABEL,
                icon: ArrowUpFromLine,
                order: 100,
                group: "secondary" as const,
                style: { variant: "neutral" },
                show: (this.hasGitWorkingChanges || this.hasUnpushedCommits) && !this.isWorking,
                enabled: true,
                action: async () => {
                    const input = this.captureAndClear()

                    // Re-check gh CLI status before push to avoid stale cached value
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
                            label: COMMIT_AND_PUSH_LABEL,
                            includeComments: false,
                        }
                    )
                },
            },

            // Close - mark task as closed (stops all processes first)
            {
                id: "close",
                label: "Close",
                icon: CheckCircle,
                order: 200,
                group: "primary" as const,
                style: { variant: "neutral" },
                show: !this.isClosed && (!this.isWorking || this.isCommitAndPushInProgress),
                enabled: true,
                spacer: true,
                action: async () => {
                    await this.stopTaskProcesses()
                    await this.store.tasks.setTaskClosed(this.taskId, true)
                },
            },

            // Reopen - reopen a closed task
            {
                id: "reopen",
                label: "Reopen",
                icon: RotateCcw,
                order: 201,
                group: "primary" as const,
                style: { variant: "neutral" },
                show: this.isClosed,
                enabled: true,
                spacer: true,
                action: async () => {
                    await this.store.tasks.setTaskClosed(this.taskId, false)
                },
            },
        ]

        const forceAll = this.store.personalSettingsStore?.settings.current.devForceAllCommands ?? false
        return allCommands.filter((cmd) => forceAll || cmd.show).sort((a, b) => a.order - b.order)
    }

    async runCommand(id: string): Promise<void> {
        const cmd = this.commands.find((c) => c.id === id)
        console.debug("[InputManager] runCommand", { id, found: !!cmd, enabled: cmd?.enabled })
        if (!cmd || !cmd.enabled) return

        // Track command execution for execution-related commands
        const trackableCommands = ["plan", "do", "ask", "revise", "runPlan", "retry", "review", "reviewPlan", "interrupt"]
        if (trackableCommands.includes(id)) {
            track("command_run", { commandType: id })
        }

        await cmd.action()
    }
}
