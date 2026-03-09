/**
 * RunCmdManager
 *
 * Canonical programmatic entry point for executing agent commands.
 * Handles both "create new task + execute" and "run in existing task".
 *
 * This is the clean API for crons, external triggers, and other
 * programmatic task execution — separate from TaskCreationManager
 * which handles UI-specific concerns (phases, abort, progress).
 */

import { exhaustive } from "exhaustive"
import { makeAutoObservable } from "mobx"
import { track } from "../../analytics"
import { addTaskPreview, syncTaskPreviewFromStore, taskFromStore, updateTaskPreview } from "../../persistence"
import { fallbackTitle, generateSlug, generateTitle } from "../../prompts/titleExtractor"
import type { HarnessId } from "../../electronAPI/harnessEventTypes"
import type { IsolationStrategy, RunCmdArgs, RunCmdResult, SetupEnvironmentEvent, TaskDeviceEnvironment, UserInputContext } from "../../types"
import { getDeviceId } from "../../utils/deviceId"
import { ulid } from "../../utils/ulid"
import { TaskEnvironment } from "../TaskEnvironment"
import { buildTaskCreationInput } from "./TaskCreationManager"
import type { CodeStore } from "../store"

export class RunCmdManager {
    constructor(private store: CodeStore) {
        makeAutoObservable<RunCmdManager, "store">(this, { store: false })
    }

    /**
     * Execute an agent command. Creates a new task if inTaskId is not set,
     * otherwise runs in the existing task.
     */
    async run(args: RunCmdArgs): Promise<RunCmdResult> {
        if (args.inTaskId) {
            return this.runInExistingTask(args)
        }
        return this.runInNewTask(args)
    }

    private async runInExistingTask(args: RunCmdArgs): Promise<RunCmdResult> {
        const taskId = args.inTaskId!

        // Validate task exists
        await this.store.getTaskStore(args.repoId, taskId)

        const input = buildTaskCreationInput(args.input, args.images ?? [])
        this.dispatchExecution(taskId, args.type, input, args.appendSystemPrompt)

        return { taskId }
    }

    private async runInNewTask(args: RunCmdArgs): Promise<RunCmdResult> {
        const repo = this.store.repos.getRepo(args.repoId)
        if (!repo) throw new Error("Repository not found")
        if (!this.store.repoStore) throw new Error("RepoStore not initialized")

        const slug = generateSlug()
        const taskId = ulid()
        const now = new Date().toISOString()
        const isolationStrategy: IsolationStrategy = args.isolationStrategy ?? { type: "head" }

        // Set up device environment
        const gitInfo = await this.store.repos.getGitInfo(args.repoId)

        let deviceEnv: TaskDeviceEnvironment | undefined
        let setupEvent: SetupEnvironmentEvent | undefined

        const needsFullSetup = exhaustive.tag(isolationStrategy, "type", {
            worktree: () => true,
            head: () => false,
        })

        if (needsFullSetup && gitInfo?.isGitRepo) {
            if (!gitInfo?.isGitRepo) {
                throw new Error("Worktree mode requires a git repository")
            }

            const abortController = new AbortController()
            deviceEnv = await TaskEnvironment.setup({
                taskSlug: slug,
                gitInfo,
                isolationStrategy,
                signal: abortController.signal,
                onPhase: () => {},
            })

            const deviceId = getDeviceId()
            const relativePath = gitInfo?.relativePath ?? ""
            const workingDir = relativePath ? `${deviceEnv!.worktreeDir}/${relativePath}` : deviceEnv!.worktreeDir!

            const outputLines = exhaustive.tag(isolationStrategy, "type", {
                worktree: (strategy) =>
                    [
                        `Worktree: ${deviceEnv!.worktreeDir}`,
                        `Working directory: ${workingDir}`,
                        `Branch: ${strategy.sourceBranch}`,
                        deviceEnv!.mergeBaseCommit ? `Merge base: ${deviceEnv!.mergeBaseCommit.slice(0, 8)}` : "",
                    ].filter(Boolean),
                head: () => [`Working directory: ${workingDir}`].filter(Boolean),
            })

            setupEvent = {
                id: ulid(),
                type: "setup_environment",
                status: "completed",
                createdAt: now,
                completedAt: now,
                userInput: "Environment setup",
                worktreeId: slug,
                deviceId,
                workingDir,
                setupOutput: outputLines.join("\n"),
            }
        } else if (isolationStrategy.type === "head") {
            const deviceId = getDeviceId()
            deviceEnv = {
                id: deviceId,
                deviceId,
                setupComplete: true,
                createdAt: now,
                lastUsedAt: now,
            }
        }

        const title = args.title ?? "New task"

        // Create task preview in RepoStore
        addTaskPreview(this.store.repoStore, args.repoId, { id: taskId, slug, title })

        // Load TaskStore and populate
        const taskStore = await this.store.getTaskStore(args.repoId, taskId)
        if (taskStore.meta.current.id === "" || taskStore.meta.current.id !== taskId) {
            const metaFields: Parameters<typeof taskStore.meta.set>[0] = {
                id: taskId,
                repoId: args.repoId,
                slug,
                title,
                description: args.input,
                isolationStrategy,
                sessionIds: {},
                createdBy: this.store.currentUser,
                createdAt: now,
                updatedAt: now,
            }
            if (args.enabledMcpServerIds && args.enabledMcpServerIds.length > 0) {
                metaFields.enabledMcpServerIds = args.enabledMcpServerIds
            }
            taskStore.meta.set(metaFields)

            if (setupEvent) taskStore.events.push(setupEvent)
            if (deviceEnv) taskStore.deviceEnvironments.push(deviceEnv)
        }

        syncTaskPreviewFromStore(this.store.repoStore, args.repoId, taskStore)
        const task = taskFromStore(taskStore)

        track("task_created", {
            mode: args.type,
            isolationStrategy: isolationStrategy.type,
            source: "runCmd",
        })

        // Set harness and thinking on TaskModel
        const taskModel = this.store.tasks.getTaskModel(task.id)
        if (taskModel) {
            if (args.harnessId) taskModel.setHarnessId(args.harnessId)
            if (args.thinking) taskModel.setThinking(args.thinking)
        }

        // Generate title async if not provided
        if (!args.title) {
            this.generateTitleAsync(task.id, args.repoId, args.input, args.harnessId)
        }

        // Dispatch execution
        const input = buildTaskCreationInput(args.input, args.images ?? [])
        setTimeout(() => this.dispatchExecution(task.id, args.type, input, args.appendSystemPrompt), 0)

        return { taskId: task.id }
    }

    private dispatchExecution(taskId: string, type: RunCmdArgs["type"], input: UserInputContext, appendSystemPrompt?: string): void {
        if (type === "plan") {
            this.store.execution.executePlan(taskId, input, appendSystemPrompt)
        } else if (type === "hyperplan") {
            const strategy = this.store.getActiveHyperPlanStrategy()
            this.store.execution.executeHyperPlan(taskId, input, strategy)
        } else if (type === "ask") {
            this.store.execution.executeAsk({ taskId, input, extraSystemPrompt: appendSystemPrompt })
        } else {
            this.store.execution.executeAction({ taskId, input, extraSystemPrompt: appendSystemPrompt })
        }
    }

    private async generateTitleAsync(taskId: string, repoId: string, description: string, harnessId?: HarnessId): Promise<void> {
        const updateTitle = (title: string) => {
            if (this.store.repoStore) {
                updateTaskPreview(this.store.repoStore, repoId, taskId, { title })
            }
            const taskStore = this.store.getCachedTaskStore(taskId)
            if (taskStore) {
                taskStore.meta.update((draft) => {
                    draft.title = title
                    draft.updatedAt = new Date().toISOString()
                })
            }
        }

        try {
            const abortController = new AbortController()
            const generatedTitle = await generateTitle(description, abortController, harnessId)
            updateTitle(generatedTitle ?? fallbackTitle(description))
        } catch (err) {
            console.error("[RunCmdManager] Title generation failed:", err)
            updateTitle(fallbackTitle(description))
        }
    }
}
