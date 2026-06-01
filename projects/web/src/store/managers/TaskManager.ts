import { makeAutoObservable, runInAction } from "mobx"
import { gitApi } from "../../electronAPI/git"
import { taskFromStore } from "../../persistence"
import { fallbackTitle, generateTitle } from "../../prompts/titleExtractor"
import { localOpenADEClient } from "../../runtime/localOpenADEClient"
import type { Task, TaskDeviceEnvironment } from "../../types"
import { TaskModel } from "../TaskModel"
import type { CodeStore } from "../store"
import { TaskUIStateManager } from "./TaskUIStateManager"

// ============================================================================
// Deep Delete Types
// ============================================================================

export interface TaskResourceInventory {
    taskId: string
    taskTitle: string
    isRunning: boolean
    snapshotIds: string[]
    images: Array<{ id: string; ext: string }>
    sessions: Array<{ sessionId: string; harnessId: string }>
    worktree: {
        slug: string
        branchName: string
        sourceBranch: string
        branchMerged: boolean | null
    } | null
}

export interface DeleteOptions {
    deleteSnapshots: boolean
    deleteImages: boolean
    deleteSessions: boolean
    deleteWorktrees: boolean
}

export class TaskManager {
    tasksLoading = false
    loadedRepoIds: Set<string> = new Set()
    regeneratingTitleTaskIds: Set<string> = new Set()
    private taskModels: Map<string, TaskModel> = new Map()
    private taskUIStates: Map<string, TaskUIStateManager> = new Map()

    constructor(private store: CodeStore) {
        makeAutoObservable(this, {
            loadedRepoIds: true,
        })
    }

    getTask(taskId: string): Task | null {
        const runtimeTask = this.store.getCachedRuntimeProductTask(taskId)
        if (runtimeTask) return runtimeTask

        const taskStore = this.store.getCachedTaskStore(taskId)
        if (taskStore) {
            return taskFromStore(taskStore)
        }
        return null
    }

    getTasksForRepo(repoId: string): Task[] {
        // Return previews from RepoStore for sidebar
        if (!this.store.repoStore) return []

        const repo = this.store.repoStore.repos.get(repoId)
        if (!repo) return []

        // Convert previews to minimal Task objects for sidebar
        return repo.tasks.map((preview) => {
            // If TaskStore is loaded, use that for full data
            const taskStore = this.store.getCachedTaskStore(preview.id)
            if (taskStore) {
                return taskFromStore(taskStore)
            }

            // Otherwise, return minimal data from preview
            return {
                id: preview.id,
                repoId,
                slug: preview.slug,
                title: preview.title,
                description: "",
                isolationStrategy: { type: "head" as const },
                deviceEnvironments: [],
                createdBy: { id: "", email: "" },
                events: [],
                comments: [],
                sessionIds: {},
                createdAt: "",
                updatedAt: "",
                closed: preview.closed,
            }
        })
    }

    getTaskModel(taskId: string): TaskModel | null {
        if (!this.store.getCachedTaskStore(taskId) && !this.store.hasRuntimeProductTaskReference(taskId)) return null

        const cached = this.taskModels.get(taskId)
        if (cached) {
            return cached
        }

        const model = new TaskModel(this.store, taskId)
        this.taskModels.set(taskId, model)
        return model
    }

    getTaskUIState(taskId: string): TaskUIStateManager {
        const cached = this.taskUIStates.get(taskId)
        if (cached) {
            return cached
        }

        const uiState = new TaskUIStateManager()
        this.taskUIStates.set(taskId, uiState)
        return uiState
    }

    invalidateTaskModel(taskId: string): void {
        const model = this.taskModels.get(taskId)
        if (model) {
            model.invalidateEnvironmentCache()
            model.dispose()
        }
        this.taskModels.delete(taskId)
    }

    ensureTasksLoaded(repoId: string): void {
        // Tasks are now loaded from RepoStore previews - no separate loading needed
        this.loadedRepoIds.add(repoId)
    }

    async removeTask(id: string): Promise<void> {
        await this.deepRemoveTask(id, {
            deleteSnapshots: false,
            deleteImages: false,
            deleteSessions: false,
            deleteWorktrees: false,
        })
    }

    // ==================== Deep Delete ====================

    private resolveRepoId(taskId: string): string | null {
        const task = this.getTask(taskId)
        if (task?.repoId) return task.repoId

        if (this.store.repoStore) {
            for (const repo of this.store.repoStore.repos.all()) {
                if (repo.tasks.find((t) => t.id === taskId)) {
                    return repo.id
                }
            }
        }
        return this.store.findRuntimeProductRepoIdForTask(taskId)
    }

    private async ensureTaskStore(taskId: string, repoId: string) {
        const cached = this.store.getCachedTaskStore(taskId)
        if (cached) return cached
        return this.store.getTaskStore(repoId, taskId)
    }

    async getResourceInventory(ids: string[]): Promise<TaskResourceInventory[]> {
        const results: TaskResourceInventory[] = []

        for (const id of ids) {
            const repoId = this.resolveRepoId(id)
            if (!repoId) continue

            const taskStore = await this.ensureTaskStore(id, repoId)
            const meta = taskStore.meta.current
            const events = taskStore.events.all()

            const snapshotIds: string[] = []
            const images: Array<{ id: string; ext: string }> = []
            const sessions = new Map<string, string>()

            for (const event of events) {
                if (event.type === "snapshot" && event.patchFileId) {
                    snapshotIds.push(event.patchFileId)
                }
                if (event.type === "action") {
                    if (event.images?.length) {
                        for (const img of event.images) {
                            images.push({ id: img.id, ext: img.ext })
                        }
                    }
                    if (event.execution?.sessionId) {
                        sessions.set(event.execution.sessionId, event.execution.harnessId ?? "claude-code")
                    }
                }
            }
            for (const sessionId of Object.values(meta.sessionIds)) {
                if (!sessions.has(sessionId)) {
                    sessions.set(sessionId, "claude-code")
                }
            }

            let worktree: TaskResourceInventory["worktree"] = null
            if (meta.isolationStrategy.type === "worktree") {
                const branchName = `openade/${meta.slug}`
                let branchMerged: boolean | null = null
                const gitInfo = await this.store.repos.getGitInfo(repoId)
                if (gitInfo) {
                    try {
                        branchMerged = await gitApi.isBranchMerged({
                            repoDir: gitInfo.repoRoot,
                            branchName,
                            targetBranch: meta.isolationStrategy.sourceBranch,
                        })
                    } catch {
                        branchMerged = null
                    }
                }
                worktree = {
                    slug: meta.slug,
                    branchName,
                    sourceBranch: meta.isolationStrategy.sourceBranch,
                    branchMerged,
                }
            }

            results.push({
                taskId: id,
                taskTitle: meta.title || meta.description || "Untitled",
                isRunning: this.store.isTaskRunning(id),
                snapshotIds,
                images,
                sessions: [...sessions.entries()].map(([sessionId, harnessId]) => ({ sessionId, harnessId })),
                worktree,
            })
        }

        return results
    }

    async deepRemoveTasks(ids: string[], options: DeleteOptions): Promise<void> {
        for (const id of ids) {
            await this.deepRemoveTask(id, options)
        }
    }

    async deepRemoveTask(id: string, options: DeleteOptions): Promise<void> {
        const repoId = this.resolveRepoId(id)
        if (!repoId) {
            console.warn("[TaskManager] deepRemoveTask: Cannot find repoId for task", id)
            return
        }

        await this.store.queries.abortTask(id)
        await localOpenADEClient.deleteTask({ repoId, taskId: id, options })
        await this.store.refreshProductStateAfterTaskDeletion(id)

        // Clean up pinned state
        const pinned = this.store.personalSettingsStore?.settings.current.pinnedTaskIds
        if (pinned?.includes(id)) {
            this.store.personalSettingsStore?.settings.set({
                pinnedTaskIds: pinned.filter((pid) => pid !== id),
            })
        }

        const model = this.taskModels.get(id)
        if (model) {
            model.dispose()
        }
        runInAction(() => {
            this.taskModels.delete(id)
            this.taskUIStates.delete(id)
        })
        this.store.runtimes.removeTask(id)
    }

    // ==================== Session Management ====================

    async setSessionId({ taskId, key, sessionId }: { taskId: string; key: string; sessionId: string }): Promise<void> {
        await localOpenADEClient.updateTaskMetadata({ taskId, sessionIds: { [key]: sessionId } })
        await this.store.refreshProductStateAfterTaskMutation(taskId)
    }

    async addDeviceEnvironment(taskId: string, deviceEnv: TaskDeviceEnvironment): Promise<void> {
        await localOpenADEClient.setupTaskEnvironment({ taskId, deviceEnvironment: deviceEnv })
        await this.store.refreshProductStateAfterTaskMutation(taskId)
        this.invalidateTaskModel(taskId)
    }

    async cleanupWorktree(repoId: string, slug: string): Promise<void> {
        const gitInfo = await this.store.repos.getGitInfo(repoId)
        if (!gitInfo?.repoRoot) {
            console.debug("[TaskManager] Cannot cleanup worktree - repo has no gitInfo")
            return
        }

        try {
            console.debug("[TaskManager] Cleaning up worktree:", { repoGitRoot: gitInfo.repoRoot, slug })
            await gitApi.deleteWorkTree({
                repoDir: gitInfo.repoRoot,
                id: slug,
            })
            console.debug("[TaskManager] Worktree cleaned up successfully")
        } catch (error) {
            console.error("[TaskManager] Failed to cleanup worktree:", error)
        }
    }

    async markTaskViewed(taskId: string): Promise<void> {
        if (!this.getTask(taskId)) return

        await localOpenADEClient.updateTaskMetadata({ taskId, lastViewedAt: new Date().toISOString() })
        await this.store.refreshProductStateAfterTaskMutation(taskId)
    }

    async setTaskClosed(taskId: string, closed: boolean): Promise<void> {
        if (!this.resolveRepoId(taskId)) {
            console.warn("[TaskManager] Cannot update task closed state - not found in task store or repo previews:", taskId)
            return
        }

        await localOpenADEClient.updateTaskMetadata({ taskId, closed })
        await this.store.refreshProductStateAfterTaskMutation(taskId)
    }

    setEnabledMcpServerIds(taskId: string, serverIds: string[]): void {
        void (async () => {
            await localOpenADEClient.updateTaskMetadata({ taskId, enabledMcpServerIds: serverIds })
            await this.store.refreshProductStateAfterTaskMutation(taskId)
        })().catch((error) => {
            console.error("[TaskManager] Failed to update MCP server selection:", error)
        })
    }

    setTaskTitle(taskId: string, title: string): void {
        const trimmed = title.trim()
        if (!trimmed) return

        void (async () => {
            await localOpenADEClient.updateTaskMetadata({ taskId, title: trimmed })
            await this.store.refreshProductStateAfterTaskMutation(taskId)
        })().catch((error) => {
            console.error("[TaskManager] Failed to update task title:", error)
        })
    }

    toggleTaskPinned(taskId: string): void {
        const store = this.store.personalSettingsStore
        if (!store) return
        const current = store.settings.current.pinnedTaskIds ?? []
        const isPinned = current.includes(taskId)
        store.settings.set({
            pinnedTaskIds: isPinned ? current.filter((id) => id !== taskId) : [...current, taskId],
        })
    }

    async regenerateTitle(taskId: string): Promise<void> {
        const task = this.getTask(taskId)
        if (!task) return

        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        const description = task.description
        if (!description) return

        const repo = this.store.repos.getRepo(task.repoId)
        if (!repo) return

        const taskModel = this.getTaskModel(taskId)
        const harnessId = taskModel?.harnessId

        runInAction(() => this.regeneratingTitleTaskIds.add(taskId))
        try {
            const abortController = new AbortController()
            const events = taskStore.events.all()
            const generatedTitle = await generateTitle(description, abortController, { harnessId, cwd: repo.path, events })
            this.setTaskTitle(taskId, generatedTitle ?? fallbackTitle(description))
        } catch (err) {
            console.error("[TaskManager] Title regeneration failed:", err)
            this.setTaskTitle(taskId, fallbackTitle(description))
        } finally {
            runInAction(() => this.regeneratingTitleTaskIds.delete(taskId))
        }
    }
}
