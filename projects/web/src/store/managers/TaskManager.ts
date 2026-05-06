import { makeAutoObservable, runInAction } from "mobx"
import { dataFolderApi } from "../../electronAPI/dataFolder"
import { gitApi } from "../../electronAPI/git"
import { deleteHarnessSession } from "../../electronAPI/harnessQuery"
import { getTaskPtyId, ptyApi } from "../../electronAPI/pty"
import { snapshotsApi } from "../../electronAPI/snapshots"
import { deleteTaskPreview, syncTaskPreviewFromStore, taskFromStore, updateTaskPreview } from "../../persistence"
import { getStorageDriver } from "../../persistence/storage"
import type { TaskStore } from "../../persistence/taskStore"
import { fallbackTitle, generateTitle } from "../../prompts/titleExtractor"
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
    tasksById: Map<string, Task> = new Map()
    tasksLoading = false
    loadedRepoIds: Set<string> = new Set()
    regeneratingTitleTaskIds: Set<string> = new Set()
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

        // Clean up pinned state
        const pinned = this.store.personalSettingsStore?.settings.current.pinnedTaskIds
        if (pinned?.includes(id)) {
            this.store.personalSettingsStore?.settings.set({
                pinnedTaskIds: pinned.filter((pid) => pid !== id),
            })
        }

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
        return null
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
                isRunning: this.store.workingTaskIds.has(id),
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
        // 1. Abort active query + kill terminal
        await this.store.queries.abortTask(id)
        ptyApi.kill(getTaskPtyId(id)).catch(() => {})

        // 2. Resolve repoId
        const repoId = this.resolveRepoId(id)
        if (!repoId) {
            console.warn("[TaskManager] deepRemoveTask: Cannot find repoId for task", id)
            return
        }

        // 3. Load TaskStore if needed
        const taskStore = await this.ensureTaskStore(id, repoId)
        const meta = taskStore.meta.current
        const events = taskStore.events.all()

        // 4. Conditionally delete snapshots
        if (options.deleteSnapshots && snapshotsApi.isAvailable()) {
            for (const event of events) {
                if (event.type === "snapshot" && event.patchFileId) {
                    await snapshotsApi.delete(event.patchFileId).catch(() => {})
                }
            }
        }

        // 5. Conditionally delete images
        if (options.deleteImages && dataFolderApi.isAvailable()) {
            for (const event of events) {
                if (event.type === "action" && event.images?.length) {
                    for (const img of event.images) {
                        await dataFolderApi.delete("images", img.id, img.ext).catch(() => {})
                    }
                }
            }
        }

        // 6. Conditionally delete harness sessions
        if (options.deleteSessions) {
            const sessionEntries = new Map<string, string>()
            for (const sid of Object.values(meta.sessionIds)) {
                sessionEntries.set(sid, "claude-code")
            }
            for (const event of events) {
                if (event.type === "action" && event.execution?.sessionId) {
                    sessionEntries.set(event.execution.sessionId, event.execution.harnessId ?? "claude-code")
                }
            }
            for (const [sessionId, harnessId] of sessionEntries) {
                await deleteHarnessSession({ harnessId, sessionId }).catch(() => {})
            }
        }

        // 7. Conditionally delete worktree + branch
        if (options.deleteWorktrees && meta.isolationStrategy.type === "worktree") {
            const gitInfo = await this.store.repos.getGitInfo(repoId)
            if (gitInfo) {
                await gitApi.deleteWorkTree({ repoDir: gitInfo.repoRoot, id: meta.slug }).catch(() => {})
                await gitApi.deleteBranch({ repoDir: gitInfo.repoRoot, branchName: `openade/${meta.slug}` }).catch(() => {})
            }
        }

        // 8. Always: delete TaskPreview, disconnect + delete YJS doc, clean runtime state
        if (this.store.repoStore) {
            deleteTaskPreview(this.store.repoStore, repoId, id)
        }
        this.store.disconnectTaskStore(id)
        await getStorageDriver().deleteDoc(`code:task:${id}`)

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
            this.tasksById.delete(id)
            this.taskModels.delete(id)
            this.taskUIStates.delete(id)
            this.store.workingTaskIds.delete(id)
        })
    }

    // ==================== Session Management ====================

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
        if (window.location.hash.includes(taskId)) return

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
        const repoId = this.resolveRepoId(taskId)
        if (!repoId) {
            console.warn("[TaskManager] Cannot update task closed state - not found in task store or repo previews:", taskId)
            return
        }

        let taskStore: TaskStore
        try {
            taskStore = await this.ensureTaskStore(taskId, repoId)
        } catch (error) {
            console.error("[TaskManager] Failed to load task store before updating closed state:", error)
            return
        }

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
            syncTaskPreviewFromStore(this.store.repoStore, repoId, taskStore)
        }
    }

    setEnabledMcpServerIds(taskId: string, serverIds: string[]): void {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        taskStore.meta.update((draft) => {
            draft.enabledMcpServerIds = serverIds.length > 0 ? serverIds : undefined
            draft.updatedAt = new Date().toISOString()
        })
    }

    setTaskTitle(taskId: string, title: string): void {
        const trimmed = title.trim()
        if (!trimmed) return

        const task = this.getTask(taskId)
        if (!task) return

        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        if (this.store.repoStore) {
            updateTaskPreview(this.store.repoStore, task.repoId, taskId, { title: trimmed })
        }
        taskStore.meta.update((draft) => {
            draft.title = trimmed
            draft.updatedAt = new Date().toISOString()
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

        const taskModel = this.getTaskModel(taskId)
        const harnessId = taskModel?.harnessId

        runInAction(() => this.regeneratingTitleTaskIds.add(taskId))
        try {
            const abortController = new AbortController()
            const events = taskStore.events.all()
            const generatedTitle = await generateTitle(description, abortController, harnessId, events)
            this.setTaskTitle(taskId, generatedTitle ?? fallbackTitle(description))
        } catch (err) {
            console.error("[TaskManager] Title regeneration failed:", err)
            this.setTaskTitle(taskId, fallbackTitle(description))
        } finally {
            runInAction(() => this.regeneratingTitleTaskIds.delete(taskId))
        }
    }
}
