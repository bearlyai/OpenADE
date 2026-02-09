import { exhaustive } from "exhaustive"
import { makeAutoObservable, runInAction } from "mobx"
import { track } from "../../analytics"
import { addTaskPreview, syncTaskPreviewFromStore, taskFromStore, updateTaskPreview } from "../../persistence"
import { fallbackTitle, generateSlug, generateTitle } from "../../prompts/titleExtractor"
import type { IsolationStrategy, SetupEnvironmentEvent, TaskDeviceEnvironment } from "../../types"
import { getDeviceId } from "../../utils/deviceId"
import { ulid } from "../../utils/ulid"
import { TaskEnvironment } from "../TaskEnvironment"
import type { CodeStore } from "../store"

export type CreationPhase = "workspace"

export interface TaskCreationOptions {
    repoId: string
    description: string
    mode: "plan" | "do" | "ask"
    isolationStrategy: IsolationStrategy
    enabledMcpServerIds?: string[]
}

export interface TaskCreation {
    id: string
    repoId: string
    description: string
    mode: "plan" | "do" | "ask"
    isolationStrategy: IsolationStrategy
    enabledMcpServerIds?: string[]
    phase: CreationPhase | "pending" | "completing"
    error: string | null
    slug: string | null
    abortController: AbortController
    createdAt: string
    completedTaskId: string | null
}

export class TaskCreationManager {
    creationsById: Map<string, TaskCreation> = new Map()

    constructor(private store: CodeStore) {
        makeAutoObservable(this, {
            creationsById: true,
        })
    }

    newTask(options: TaskCreationOptions): string {
        const id = ulid()
        const creation: TaskCreation = {
            id,
            repoId: options.repoId,
            description: options.description,
            mode: options.mode,
            isolationStrategy: options.isolationStrategy,
            enabledMcpServerIds: options.enabledMcpServerIds,
            phase: "pending",
            error: null,
            slug: null,
            abortController: new AbortController(),
            createdAt: new Date().toISOString(),
            completedTaskId: null,
        }

        runInAction(() => {
            this.creationsById.set(id, creation)
        })

        this.runCreation(id)

        return id
    }

    getCreation(id: string): TaskCreation | null {
        return this.creationsById.get(id) || null
    }

    getCreationsForRepo(repoId: string): TaskCreation[] {
        return Array.from(this.creationsById.values()).filter((c) => c.repoId === repoId && c.completedTaskId === null)
    }

    async cancelCreation(id: string): Promise<void> {
        const creation = this.creationsById.get(id)
        if (!creation) return

        creation.abortController.abort()

        // Clean up worktree if we created one
        if (creation.slug && creation.isolationStrategy.type === "worktree") {
            await this.store.tasks.cleanupWorktree(creation.repoId, creation.slug)
        }

        runInAction(() => {
            this.creationsById.delete(id)
        })
    }

    retryCreation(id: string): void {
        const creation = this.creationsById.get(id)
        if (!creation || !creation.error) return

        runInAction(() => {
            creation.error = null
            creation.phase = "pending"
            creation.abortController = new AbortController()
        })

        this.runCreation(id)
    }

    dismissCreation(id: string): void {
        const creation = this.creationsById.get(id)
        if (!creation) return

        // Abort if still running
        creation.abortController.abort()

        runInAction(() => {
            this.creationsById.delete(id)
        })
    }

    private async runCreation(id: string): Promise<void> {
        const creation = this.creationsById.get(id)
        if (!creation) return

        const repo = this.store.repos.getRepo(creation.repoId)
        if (!repo) {
            runInAction(() => {
                creation.error = "Repository not found"
            })
            return
        }

        const signal = creation.abortController.signal

        try {
            if (signal.aborted) throw new Error("Task creation cancelled")

            // Generate slug synchronously - no LLM call needed
            const slug = generateSlug()
            const title = "New task" // Placeholder, will be updated async after creation

            runInAction(() => {
                creation.slug = slug
            })

            // Fetch git info (async, from cache or Electron)
            const gitInfo = await this.store.repos.getGitInfo(creation.repoId)

            // Validate worktree mode requires git
            if (creation.isolationStrategy.type === "worktree" && !gitInfo?.isGitRepo) {
                throw new Error("Worktree mode requires a git repository")
            }

            // Set up environment based on isolation strategy
            let deviceEnv: TaskDeviceEnvironment | undefined
            let setupEvent: SetupEnvironmentEvent | undefined

            const needsFullSetup = exhaustive.tag(creation.isolationStrategy, "type", {
                worktree: () => true,
                head: () => false, // Head mode never needs full setup
            })

            if (needsFullSetup && gitInfo?.isGitRepo) {
                deviceEnv = await TaskEnvironment.setup({
                    taskSlug: slug,
                    gitInfo,
                    isolationStrategy: creation.isolationStrategy,
                    signal,
                    onPhase: (phase) =>
                        runInAction(() => {
                            creation.phase = phase
                        }),
                })

                // Create setup event for the event log
                const now = new Date().toISOString()
                const deviceId = getDeviceId()

                // Compute working dir for display (worktreeDir + relativePath)
                const relativePath = gitInfo?.relativePath ?? ""
                const workingDir = relativePath ? `${deviceEnv!.worktreeDir}/${relativePath}` : deviceEnv!.worktreeDir!

                const outputLines = exhaustive.tag(creation.isolationStrategy, "type", {
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
            } else if (creation.isolationStrategy.type === "head") {
                // For head mode, create a minimal device environment
                // No worktreeDir - working dir is derived from repo.path at runtime
                const now = new Date().toISOString()
                const deviceId = getDeviceId()

                deviceEnv = {
                    id: deviceId, // Required for YArrayHandle
                    deviceId,
                    // No worktreeDir for head mode
                    setupComplete: true,
                    // No mergeBaseCommit for head mode
                    createdAt: now,
                    lastUsedAt: now,
                }
            }

            if (signal.aborted) {
                // Clean up if we created a worktree
                if (creation.isolationStrategy.type === "worktree" && gitInfo?.repoRoot && creation.slug) {
                    await this.store.tasks.cleanupWorktree(creation.repoId, creation.slug)
                }
                throw new Error("Task creation cancelled")
            }

            runInAction(() => {
                creation.phase = "completing"
            })

            // Create task using new YJS-backed stores
            if (!this.store.repoStore) {
                throw new Error("RepoStore not initialized")
            }

            const taskId = ulid()
            const now = new Date().toISOString()

            // 1. Create task preview in RepoStore
            addTaskPreview(this.store.repoStore, creation.repoId, {
                id: taskId,
                slug,
                title,
            })

            // 2. Load TaskStore and cache the connection
            const taskStore = await this.store.getTaskStore(creation.repoId, taskId)

            // 3. Populate TaskStore if empty (for fresh creates)
            if (taskStore.meta.current.id === "" || taskStore.meta.current.id !== taskId) {
                const metaFields: Parameters<typeof taskStore.meta.set>[0] = {
                    id: taskId,
                    repoId: creation.repoId,
                    slug,
                    title,
                    description: creation.description,
                    isolationStrategy: creation.isolationStrategy,
                    sessionIds: {},
                    createdBy: this.store.currentUser,
                    createdAt: now,
                    updatedAt: now,
                }
                // Only add enabledMcpServerIds if provided (YJS can't serialize undefined)
                if (creation.enabledMcpServerIds && creation.enabledMcpServerIds.length > 0) {
                    metaFields.enabledMcpServerIds = creation.enabledMcpServerIds
                }
                taskStore.meta.set(metaFields)

                if (setupEvent) {
                    taskStore.events.push(setupEvent)
                }

                if (deviceEnv) {
                    taskStore.deviceEnvironments.push(deviceEnv)
                }
            }

            // 4. Sync preview to reflect initial state
            syncTaskPreviewFromStore(this.store.repoStore, creation.repoId, taskStore)

            // 5. Get task object for backward compatibility
            const task = taskFromStore(taskStore)

            runInAction(() => {
                creation.completedTaskId = task.id
            })

            // Track task creation
            track("task_created", {
                mode: creation.mode,
                isolationStrategy: creation.isolationStrategy.type,
                hasMcpServers: (creation.enabledMcpServerIds?.length ?? 0) > 0,
            })

            // Generate title async - don't block task creation
            this.generateTitleAsync(task.id, creation.repoId, creation.description)

            setTimeout(() => {
                const input = { userInput: creation.description, images: [] }
                if (creation.mode === "plan") {
                    this.store.execution.executePlan(task.id, input)
                } else if (creation.mode === "ask") {
                    this.store.execution.executeAsk({ taskId: task.id, input })
                } else {
                    this.store.execution.executeAction({ taskId: task.id, input })
                }
            }, 0)
        } catch (err) {
            if (err instanceof Error && err.message === "Task creation cancelled") {
                runInAction(() => {
                    this.creationsById.delete(id)
                })
                return
            }
            console.error("[TaskCreationManager] Creation failed:", err)
            runInAction(() => {
                creation.error = err instanceof Error ? err.message : "Failed to create task"
            })
        }
    }

    /** Generate title async and update task when done (fire-and-forget) */
    private async generateTitleAsync(taskId: string, repoId: string, description: string): Promise<void> {
        const updateTitle = (title: string) => {
            // Update task preview in repo store (sidebar display)
            if (this.store.repoStore) {
                updateTaskPreview(this.store.repoStore, repoId, taskId, { title })
            }

            // Update task metadata in task store
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
            const generatedTitle = await generateTitle(description, abortController)
            updateTitle(generatedTitle ?? fallbackTitle(description))
        } catch (err) {
            console.error("[TaskCreationManager] Title generation failed:", err)
            updateTitle(fallbackTitle(description))
        }
    }
}
