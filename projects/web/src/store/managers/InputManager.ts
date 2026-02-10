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

import type { LucideIcon } from "lucide-react"
import { ArrowUpFromLine, CheckCircle, FileText, GitCommit, MessageCircleQuestion, Play, RefreshCcw, RefreshCw, RotateCcw, Square, X } from "lucide-react"
import { makeAutoObservable } from "mobx"
import { track } from "../../analytics"
import { ACTION_PROMPTS } from "../../prompts/prompts"
import type { ActionEvent, UserInputContext } from "../../types"
import type { CodeStore } from "../store"
import type { SmartEditorManager } from "./SmartEditorManager"

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

    /** Whether the input area should be disabled (task is closed) */
    get isDisabled(): boolean {
        return this.isClosed
    }

    private get retryLabel(): string {
        return "Retry"
    }

    /** Stop all processes associated with this task (used before closing) */
    private async stopTaskProcesses(): Promise<void> {
        const env = this.taskModel?.environment
        if (!env?.taskWorkingDir) return

        const task = this.store.tasks.getTask(this.taskId)
        const isWorktree = task?.isolationStrategy?.type === "worktree"
        const context = isWorktree ? { type: "worktree" as const, root: env.taskWorkingDir } : { type: "repo" as const }
        await this.store.repoProcesses.stopAllForContext(context)
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

    // === Commands ===

    get commands(): Command[] {
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

            // Plan - create a new plan (consumes comments)
            {
                id: "plan",
                label: "Plan",
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

            // Commit - commit working changes (does NOT consume comments)
            {
                id: "commit",
                label: "Commit",
                icon: GitCommit,
                order: 100,
                style: { variant: "neutral" },
                show: this.hasGitWorkingChanges && !this.isWorking,
                enabled: !this.hasFeedback,
                action: async () => {
                    await this.store.execution.executeAction({
                        taskId: this.taskId,
                        input: { userInput: ACTION_PROMPTS.commit, images: [] },
                        label: "Commit",
                        includeComments: false,
                    })
                },
            },

            // Push - push unpushed commits to remote (does NOT consume comments)
            {
                id: "push",
                label: `Push ↑${this.taskModel?.aheadCount ?? 0}`,
                icon: ArrowUpFromLine,
                order: 101,
                style: { variant: "neutral" },
                show: this.hasUnpushedCommits && !this.hasGitWorkingChanges && !this.isWorking,
                enabled: !this.hasFeedback,
                action: async () => {
                    const hasGhCli = this.taskModel?.hasGhCli ?? false
                    const branch = this.taskModel?.gitStatus?.branch ?? "HEAD"
                    await this.store.execution.executeAction({
                        taskId: this.taskId,
                        input: { userInput: ACTION_PROMPTS.push(hasGhCli, branch), images: [] },
                        label: "Push",
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
                show: !this.isClosed && !this.isWorking,
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
        const trackableCommands = ["plan", "do", "ask", "revise", "runPlan", "retry"]
        if (trackableCommands.includes(id)) {
            track("command_run", { commandType: id })
        }

        await cmd.action()
    }
}
