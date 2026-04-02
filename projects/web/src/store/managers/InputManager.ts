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
import { ArrowUpFromLine, CheckCircle, ClipboardCheck, FileText, MessageCircleQuestion, Play, RefreshCcw, RefreshCw, Repeat, RotateCcw, Square, X } from "lucide-react"
import { makeAutoObservable } from "mobx"
import { track } from "../../analytics"
import { ReviewPickerModal } from "../../components/ReviewPickerModal"
import { ACTION_PROMPTS } from "../../prompts/prompts"
import type { ActionEvent, UserInputContext } from "../../types"
import type { CodeStore } from "../store"
import type { SmartEditorManager } from "./SmartEditorManager"

const COMMIT_AND_PUSH_LABEL = "Commit & Push"

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
        return this.store.isTaskWorking(this.taskId)
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
                style: { variant: "danger" },
                show: this.isWorking,
                enabled: true,
                action: async () => {
                    await this.store.queries.abortTask(this.taskId)
                },
            },

            // Retry - retry the last failed action by prompting the LLM
            {
                id: "retry",
                label: this.retryLabel,
                icon: RefreshCcw,
                order: 1,
                style: { variant: "danger" },
                show: this.canRetry,
                enabled: true,
                action: async () => {
                    await this.store.execution.executeAction({
                        taskId: this.taskId,
                        input: { userInput: ACTION_PROMPTS.retry, images: [] },
                        label: this.retryLabel,
                        includeComments: false,
                    })
                },
            },

            // Run Plan - execute the current plan (consumes comments)
            {
                id: "runPlan",
                label: "Run Plan",
                icon: Play,
                order: 4,
                style: { variant: "success" },
                show: this.hasActivePlan && !this.isWorking,
                enabled: true,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.store.execution.executeRunPlan(this.taskId, input)
                },
            },

            // Review Plan - one-off external review of the active plan
            {
                id: "reviewPlan",
                label: "Review Plan",
                icon: ClipboardCheck,
                order: 5,
                style: { variant: "neutral" },
                show: this.hasActivePlan && !this.isWorking,
                enabled: true,
                action: async () => {
                    await NiceModal.show(ReviewPickerModal, { taskId: this.taskId, reviewType: "plan" as const })
                },
            },

            // Revise Plan - update plan with feedback (consumes comments)
            {
                id: "revise",
                label: "Revise Plan",
                icon: RefreshCw,
                order: 6,
                style: { variant: "primary" },
                show: this.hasActivePlan && !this.isWorking,
                enabled: this.hasFeedback,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.store.execution.executeRevise(this.taskId, input)
                },
            },

            // Cancel Plan - exit plan mode without executing
            {
                id: "cancelPlan",
                label: "Cancel Plan",
                icon: X,
                order: 21,
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
                label: "Do",
                icon: Play,
                order: 10,
                style: { variant: "success" },
                show: !this.hasActivePlan && !this.isWorking,
                enabled: this.hasFeedback,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.store.execution.executeAction({ taskId: this.taskId, input })
                },
            },

            // Plan - create a new plan (consumes comments).
            {
                id: "plan",
                label: this.planButtonLabel,
                icon: FileText,
                order: 15,
                style: { variant: "primary" },
                show: !this.hasActivePlan && !this.isWorking,
                enabled: this.hasFeedback,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.store.execution.executePlan(this.taskId, input)
                },
            },

            // Ask - read-only exploration (consumes comments)
            {
                id: "ask",
                label: "Ask",
                icon: MessageCircleQuestion,
                order: 20,
                style: { variant: "neutral" },
                show: !this.isWorking,
                enabled: this.hasFeedback,
                action: async () => {
                    const input = this.captureAndClear()
                    await this.store.execution.executeAsk({ taskId: this.taskId, input })
                },
            },

            // Review - one-off external review of recent work when no active plan exists
            {
                id: "review",
                label: "Review",
                icon: ClipboardCheck,
                order: 19,
                style: { variant: "neutral" },
                show: !this.hasActivePlan && !this.isWorking && !!this.lastActionEvent,
                enabled: true,
                action: async () => {
                    await NiceModal.show(ReviewPickerModal, { taskId: this.taskId, reviewType: "work" as const })
                },
            },

            // Repeat - repeatedly send the same prompt
            {
                id: "repeat",
                label: "Repeat",
                icon: Repeat,
                order: 22,
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
                    await this.store.execution.executeAction({
                        taskId: this.taskId,
                        input: { userInput: ACTION_PROMPTS.commitAndPush(input.userInput, hasGhCli, branch), images: input.images },
                        label: COMMIT_AND_PUSH_LABEL,
                        includeComments: false,
                    })
                },
            },

            // Close - mark task as closed (stops all processes first)
            {
                id: "close",
                label: "Close",
                icon: CheckCircle,
                order: 200,
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
                style: { variant: "neutral" },
                show: this.isClosed,
                enabled: true,
                spacer: true,
                action: async () => {
                    await this.store.tasks.setTaskClosed(this.taskId, false)
                },
            },
        ]

        return allCommands.filter((cmd) => cmd.show).sort((a, b) => a.order - b.order)
    }

    async runCommand(id: string): Promise<void> {
        const cmd = this.commands.find((c) => c.id === id)
        console.debug("[InputManager] runCommand", { id, found: !!cmd, enabled: cmd?.enabled })
        if (!cmd || !cmd.enabled) return

        // Track command execution for execution-related commands
        const trackableCommands = ["plan", "do", "ask", "revise", "runPlan", "retry", "review", "reviewPlan"]
        if (trackableCommands.includes(id)) {
            track("command_run", { commandType: id })
        }

        await cmd.action()
    }
}
