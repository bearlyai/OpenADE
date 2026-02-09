import { makeAutoObservable, runInAction } from "mobx"
import { gitApi } from "../../electronAPI/git"
import { getTaskPtyId, ptyApi } from "../../electronAPI/pty"
import { snapshotsApi } from "../../electronAPI/snapshots"
import { deleteTaskPreview, syncTaskPreviewFromStore, taskFromStore } from "../../persistence"
import type { Task, TaskDeviceEnvironment } from "../../types"
import { TaskModel } from "../TaskModel"
import type { CodeStore } from "../store"
import { TaskUIStateManager } from "./TaskUIStateManager"

export class TaskManager {
    tasksById: Map<string, Task> = new Map()
    tasksLoading = false
    loadedRepoIds: Set<string> = new Set()
    private taskModels: Map<string, TaskModel> = new Map()
    private taskUIStates: Map<string, TaskUIStateManager> = new Map()
    private disposers: Array<() => void> = []

    constructor(private store: CodeStore) {
        makeAutoObservable(this, {
            tasksById: true,
            loadedRepoIds: true,
        })
        this.init()
    }

    private init(): void {
        this.disposers.push(
            this.store.execution.onAfterEvent((taskId) => {
                this.markTaskHasNewEvent(taskId)
            })
        )
    }

    getTask(taskId: string): Task | null {
        // First check cache (for backward compat with working tasks)
        const cached = this.tasksById.get(taskId)
        if (cached) return cached

        // Otherwise, get from TaskStore if loaded
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
        if (!this.store.getCachedTaskStore(taskId) && !this.tasksById.has(taskId)) return null

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

    /** @deprecated - Kept for backward compat during migration. Use TaskStore directly. */
    updateTask(task: Task): void {
        runInAction(() => this.tasksById.set(task.id, task))
    }

    ensureTasksLoaded(repoId: string): void {
        // Tasks are now loaded from RepoStore previews - no separate loading needed
        this.loadedRepoIds.add(repoId)
    }

    async removeTask(id: string): Promise<void> {
        const task = this.getTask(id)

        // Find repoId - from task if loaded, otherwise search RepoStore previews
        let repoId = task?.repoId
        if (!repoId && this.store.repoStore) {
            // Task not loaded - find it in RepoStore previews
            for (const repo of this.store.repoStore.repos.all()) {
                const preview = repo.tasks.find((t) => t.id === id)
                if (preview) {
                    repoId = repo.id
                    console.debug("[TaskManager] Found orphaned task preview, repoId:", repoId)
                    break
                }
            }
        }

        if (!repoId) {
            console.warn("[TaskManager] Cannot remove task - not found in task store or repo previews:", id)
            return
        }

        // Delete snapshot patch files if TaskStore is available
        const taskStore = this.store.getCachedTaskStore(id)
        if (taskStore && snapshotsApi.isAvailable()) {
            const events = taskStore.events.all()
            for (const event of events) {
                if (event.type === "snapshot" && event.patchFileId) {
                    try {
                        await snapshotsApi.delete(event.patchFileId)
                        console.debug("[TaskManager] Deleted snapshot patch file:", event.patchFileId)
                    } catch (err) {
                        console.warn("[TaskManager] Failed to delete snapshot patch file:", err)
                    }
                }
            }
        }

        // Delete from RepoStore
        if (this.store.repoStore) {
            deleteTaskPreview(this.store.repoStore, repoId, id)
        }

        // Disconnect TaskStore
        this.store.disconnectTaskStore(id)

        // Cleanup local state
        const model = this.taskModels.get(id)
        if (model) {
            model.dispose()
        }
        runInAction(() => {
            this.tasksById.delete(id)
            this.taskModels.delete(id)
            this.taskUIStates.delete(id)
            this.store.workingTaskIds.delete(id)
        })
    }

    async setSessionId({ taskId, key, sessionId }: { taskId: string; key: string; sessionId: string }): Promise<void> {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        taskStore.meta.update((draft) => {
            draft.sessionIds[key] = sessionId
            draft.updatedAt = new Date().toISOString()
        })
    }

    async addDeviceEnvironment(taskId: string, deviceEnv: TaskDeviceEnvironment): Promise<void> {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        // Check if exists
        const existing = taskStore.deviceEnvironments.all().find((de) => de.deviceId === deviceEnv.deviceId)
        if (existing) {
            taskStore.deviceEnvironments.update(existing.id, () => deviceEnv)
        } else {
            taskStore.deviceEnvironments.push(deviceEnv)
        }

        taskStore.meta.update((draft) => {
            draft.updatedAt = new Date().toISOString()
        })

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
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        taskStore.meta.update((draft) => {
            draft.lastViewedAt = new Date().toISOString()
            draft.updatedAt = new Date().toISOString()
        })

        // Sync to RepoStore so sidebar unread badge updates
        if (this.store.repoStore) {
            syncTaskPreviewFromStore(this.store.repoStore, taskStore.meta.current.repoId, taskStore)
        }
    }

    private markTaskHasNewEvent(taskId: string): void {
        // Skip if user is currently viewing this task (it's already "read")
        if (window.location.pathname.includes(taskId)) return

        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        const now = new Date().toISOString()
        taskStore.meta.update((draft) => {
            draft.lastEventAt = now
            draft.updatedAt = now
        })

        // Sync to RepoStore for sidebar badge
        if (this.store.repoStore) {
            syncTaskPreviewFromStore(this.store.repoStore, taskStore.meta.current.repoId, taskStore)
        }
    }

    async setTaskClosed(taskId: string, closed: boolean): Promise<void> {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        // Kill terminal when closing task
        if (closed) {
            ptyApi.kill(getTaskPtyId(taskId)).catch(() => {})
        }

        taskStore.meta.update((draft) => {
            draft.closed = closed
            draft.updatedAt = new Date().toISOString()
        })

        // Sync to RepoStore
        if (this.store.repoStore) {
            syncTaskPreviewFromStore(this.store.repoStore, taskStore.meta.current.repoId, taskStore)
        }
    }
}
