import { makeAutoObservable, runInAction } from "mobx"
import { OPENADE_METHOD, type OpenADEMethod } from "../../../../openade-client/src"
import type { OpenADETaskResourceInventory } from "../../../../openade-module/src"
import { gitApi } from "../../electronAPI/git"
import { fallbackTitle, generateTitle } from "../../prompts/titleExtractor"
import type { Task, TaskDeviceEnvironment } from "../../types"
import { TaskModel } from "../TaskModel"
import type { CodeStore } from "../store"
import { TaskUIStateManager } from "./TaskUIStateManager"

const TASK_VIEWED_WRITE_MIN_INTERVAL_MS = 60_000
const RUNTIME_TASK_VIEWED_WRITE_DEFER_MS = 5 * 60_000

interface DeferredViewedWrite {
    viewedAt: string
    viewedAtMs: number
    cancel: () => void
}

function scheduleDeferredViewedWrite(callback: () => void): () => void {
    const timeoutId = setTimeout(callback, RUNTIME_TASK_VIEWED_WRITE_DEFER_MS)
    return () => clearTimeout(timeoutId)
}

function parseTimestampMs(value: string | undefined): number | null {
    if (!value) return null
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
}

function latestTaskEventTimestampMs(task: Task | null): number | null {
    const events = task?.events ?? []
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const parsed = parseTimestampMs(events[index]?.createdAt)
        if (parsed !== null) return parsed
    }
    return null
}

// ============================================================================
// Deep Delete Types
// ============================================================================

export type TaskResourceInventory = OpenADETaskResourceInventory

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
    private markViewedInFlight: Map<string, Promise<void>> = new Map()
    private lastViewedWriteAt: Map<string, number> = new Map()
    private deferredViewedWrites: Map<string, DeferredViewedWrite> = new Map()

    constructor(private store: CodeStore) {
        makeAutoObservable<TaskManager, "deferredViewedWrites">(this, {
            loadedRepoIds: true,
            deferredViewedWrites: false,
        })
    }

    disposeDeferredViewedWrites(): void {
        for (const deferred of this.deferredViewedWrites.values()) deferred.cancel()
        this.deferredViewedWrites.clear()
    }

    async flushDeferredViewedWrites(): Promise<void> {
        await Promise.all([...this.deferredViewedWrites.keys()].map((taskId) => this.flushDeferredViewedWrite(taskId)))
    }

    getTask(taskId: string): Task | null {
        return this.store.getCachedProductTask(taskId)
    }

    getTasksForRepo(repoId: string): Task[] {
        const previews = this.store.getTaskPreviewsForRepo(repoId)

        // Convert previews to minimal Task objects for sidebar
        return previews.map((preview) => {
            const cachedTask = this.getTask(preview.id)
            if (cachedTask) return cachedTask

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
        const cached = this.taskModels.get(taskId)
        if (cached) {
            return cached.exists ? cached : null
        }

        if (!this.store.hasProductTaskModelSource(taskId)) return null

        const model = new TaskModel(this.store, taskId)
        this.taskModels.set(taskId, model)
        return model
    }

    getTaskModelForRoute(repoId: string, taskId: string): TaskModel | null {
        const existing = this.getTaskModel(taskId)
        if (existing) return existing

        if (!this.store.canUseRuntimeProductTaskRouteModelSource()) return null

        const model = new TaskModel(this.store, taskId, repoId)
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
        return this.store.findProductRepoIdForTask(taskId)
    }

    private canUseProductMethod(method: OpenADEMethod): boolean {
        return this.store.canUseProductMethod(method)
    }

    private productRuntimeOwnsTaskCapabilities(): boolean {
        return this.store.shouldUseRuntimeProductTaskRoute()
    }

    private async canUseProductMethodAfterConnect(method: OpenADEMethod): Promise<boolean> {
        if (!this.productRuntimeOwnsTaskCapabilities()) return this.canUseProductMethod(method)
        if (this.store.usesCoreOwnedProductRuntime()) return this.store.canUseProductMethodAfterConnect(method)
        if (this.store.shouldUseRuntimeProductAPI()) return this.canUseProductMethod(method)
        return this.store.canUseProductMethodAfterConnect(method)
    }

    private canUseTaskMetadataUpdate(): boolean {
        return this.canUseProductMethod(OPENADE_METHOD.taskMetadataUpdate)
    }

    private async canUseTaskMetadataUpdateAfterConnect(): Promise<boolean> {
        return this.canUseProductMethodAfterConnect(OPENADE_METHOD.taskMetadataUpdate)
    }

    private async canUseMcpSelectionAfterConnect(): Promise<boolean> {
        if (!this.productRuntimeOwnsTaskCapabilities()) return true
        return this.canUseProductMethodAfterConnect(OPENADE_METHOD.settingsMcpServersRead)
    }

    private shouldRefreshLegacyTaskAfterMutation(): boolean {
        return !this.store.shouldUseRuntimeProductTaskRoute()
    }

    async getResourceInventory(ids: string[]): Promise<TaskResourceInventory[]> {
        const results: TaskResourceInventory[] = []

        for (const id of ids) {
            const repoId = this.resolveRepoId(id)
            if (!repoId) continue

            if (this.store.shouldUseRuntimeProductTaskRoute()) {
                const canReadInventory = await this.canUseProductMethodAfterConnect(OPENADE_METHOD.taskResourceInventoryRead)
                if (!canReadInventory) continue
                results.push(await this.store.readProductTaskResourceInventory({ repoId, taskId: id }))
                continue
            }

            const task = await this.store.loadProductTaskForRead(repoId, id)
            if (!task) continue
            const events = task.events

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
            for (const sessionId of Object.values(task.sessionIds)) {
                if (!sessions.has(sessionId)) {
                    sessions.set(sessionId, "claude-code")
                }
            }

            let worktree: TaskResourceInventory["worktree"] = null
            if (task.isolationStrategy.type === "worktree") {
                const branchName = `openade/${task.slug}`
                let branchMerged: boolean | null = null
                const gitInfo = await this.store.repos.getGitInfo(repoId)
                if (gitInfo) {
                    try {
                        branchMerged = await gitApi.isBranchMerged({
                            repoDir: gitInfo.repoRoot,
                            branchName,
                            targetBranch: task.isolationStrategy.sourceBranch,
                        })
                    } catch {
                        branchMerged = null
                    }
                }
                worktree = {
                    slug: task.slug,
                    branchName,
                    sourceBranch: task.isolationStrategy.sourceBranch,
                    branchMerged,
                }
            }

            results.push({
                repoId,
                taskId: id,
                taskTitle: task.title || task.description || "Untitled",
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

        if (!(await this.canUseProductMethodAfterConnect(OPENADE_METHOD.taskDelete))) return

        await this.store.queries.abortTask(id)
        await this.store.deleteProductTask({ repoId, taskId: id, options })
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
        if (!(await this.canUseTaskMetadataUpdateAfterConnect())) return
        await this.store.updateProductTaskMetadata({ taskId, sessionIds: { [key]: sessionId } })
        if (this.shouldRefreshLegacyTaskAfterMutation()) await this.store.refreshProductStateAfterTaskMutation(taskId)
    }

    async addDeviceEnvironment(taskId: string, deviceEnv: TaskDeviceEnvironment): Promise<void> {
        if (!(await this.canUseProductMethodAfterConnect(OPENADE_METHOD.taskEnvironmentSetup))) return
        await this.store.setupProductTaskEnvironment({ taskId, deviceEnvironment: deviceEnv })
        if (this.shouldRefreshLegacyTaskAfterMutation()) await this.store.refreshProductStateAfterTaskMutation(taskId)
        this.invalidateTaskModel(taskId)
    }

    async markTaskViewed(taskId: string, options: { defer?: boolean } = {}): Promise<void> {
        const repoId = this.resolveRepoId(taskId)
        if (!repoId) return
        const canCheckMetadataSynchronously = !this.productRuntimeOwnsTaskCapabilities() || this.store.shouldUseRuntimeProductAPI()
        if (canCheckMetadataSynchronously && !this.canUseTaskMetadataUpdate()) return

        const preview =
            this.store.getRuntimeProductTaskPreviewDto?.(repoId, taskId) ?? this.store.getTaskPreviewsForRepo(repoId).find((candidate) => candidate.id === taskId)
        const nowMs = Date.now()
        const lastLocalWriteAt = this.lastViewedWriteAt.get(taskId) ?? 0
        const persistedViewedAt = parseTimestampMs(preview?.lastViewedAt)
        const previewLastEventAt = parseTimestampMs(preview?.lastEventAt)
        const lastEventAt = previewLastEventAt ?? latestTaskEventTimestampMs(this.getTask(taskId))
        if (lastEventAt === null) return
        if (persistedViewedAt !== null && persistedViewedAt >= lastEventAt) return
        if (lastLocalWriteAt >= lastEventAt) return
        if (nowMs - Math.max(lastLocalWriteAt, persistedViewedAt ?? 0) < TASK_VIEWED_WRITE_MIN_INTERVAL_MS) return

        const existing = this.markViewedInFlight.get(taskId)
        if (existing) return existing

        const viewedAt = new Date(nowMs).toISOString()
        if (options.defer && this.store.shouldUseRuntimeProductTaskRoute()) {
            this.lastViewedWriteAt.set(taskId, nowMs)
            this.store.patchRuntimeProductTaskMetadata({ taskId, lastViewedAt: viewedAt })
            this.scheduleDeferredViewedWrite(taskId, viewedAt, nowMs)
            return
        }

        this.cancelDeferredViewedWrite(taskId)
        return this.writeTaskViewed(taskId, viewedAt, nowMs)
    }

    private scheduleDeferredViewedWrite(taskId: string, viewedAt: string, viewedAtMs: number): void {
        this.cancelDeferredViewedWrite(taskId)
        const cancel = scheduleDeferredViewedWrite(() => {
            this.flushDeferredViewedWrite(taskId)
        })
        this.deferredViewedWrites.set(taskId, { viewedAt, viewedAtMs, cancel })
    }

    private cancelDeferredViewedWrite(taskId: string): void {
        const deferred = this.deferredViewedWrites.get(taskId)
        if (!deferred) return
        deferred.cancel()
        this.deferredViewedWrites.delete(taskId)
    }

    private async flushDeferredViewedWrite(taskId: string): Promise<void> {
        const deferred = this.deferredViewedWrites.get(taskId)
        if (!deferred) return
        deferred.cancel()
        this.deferredViewedWrites.delete(taskId)
        await this.writeTaskViewed(taskId, deferred.viewedAt, deferred.viewedAtMs).catch((error) => {
            console.error("[TaskManager] Failed to persist deferred viewed state:", error)
        })
    }

    private async writeTaskViewed(taskId: string, viewedAt: string, viewedAtMs: number): Promise<void> {
        if (!(await this.canUseTaskMetadataUpdateAfterConnect())) return
        this.lastViewedWriteAt.set(taskId, viewedAtMs)
        const promise = (async () => {
            try {
                await this.store.updateProductTaskMetadata({ taskId, lastViewedAt: viewedAt })
                if (this.store.shouldUseRuntimeProductTaskRoute()) return
                await this.store.refreshProductStateAfterTaskMutation(taskId)
            } catch (error) {
                this.lastViewedWriteAt.delete(taskId)
                throw error
            } finally {
                this.markViewedInFlight.delete(taskId)
            }
        })()
        this.markViewedInFlight.set(taskId, promise)
        return promise
    }

    async setTaskClosed(taskId: string, closed: boolean): Promise<void> {
        if (!this.resolveRepoId(taskId)) {
            console.warn("[TaskManager] Cannot update task closed state - not found in task store or repo previews:", taskId)
            return
        }

        if (!(await this.canUseTaskMetadataUpdateAfterConnect())) return

        await this.store.updateProductTaskMetadata({ taskId, closed })
        if (this.shouldRefreshLegacyTaskAfterMutation()) await this.store.refreshProductStateAfterTaskMutation(taskId)
    }

    setEnabledMcpServerIds(taskId: string, serverIds: string[]): void {
        void (async () => {
            if (!(await this.canUseTaskMetadataUpdateAfterConnect())) return
            if (!(await this.canUseMcpSelectionAfterConnect())) return
            await this.store.updateProductTaskMetadata({ taskId, enabledMcpServerIds: serverIds })
            if (this.shouldRefreshLegacyTaskAfterMutation()) await this.store.refreshProductStateAfterTaskMutation(taskId)
        })().catch((error) => {
            console.error("[TaskManager] Failed to update MCP server selection:", error)
        })
    }

    setTaskTitle(taskId: string, title: string): void {
        const trimmed = title.trim()
        if (!trimmed) return

        void (async () => {
            if (!(await this.canUseTaskMetadataUpdateAfterConnect())) return
            await this.store.updateProductTaskMetadata({ taskId, title: trimmed })
            if (this.shouldRefreshLegacyTaskAfterMutation()) await this.store.refreshProductStateAfterTaskMutation(taskId)
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
        const productRuntimeOwnsTitleGeneration = this.productRuntimeOwnsTaskCapabilities()
        const canGenerateTitle = await this.canUseProductMethodAfterConnect(OPENADE_METHOD.taskTitleGenerate)
        if (!canGenerateTitle) return

        let task = this.getTask(taskId)
        if (!task) {
            const repoId = this.resolveRepoId(taskId)
            if (repoId) task = await this.store.loadProductTaskForRead(repoId, taskId)
        }
        if (!task) return

        const description = task.description
        if (!description) return

        const taskModel = this.getTaskModel(taskId)
        const harnessId = taskModel?.harnessId

        runInAction(() => this.regeneratingTitleTaskIds.add(taskId))
        try {
            if (productRuntimeOwnsTitleGeneration) {
                const repoId = task.repoId || this.resolveRepoId(taskId)
                if (!repoId) return
                await this.store.generateProductTaskTitle({ repoId, taskId, harnessId })
                return
            }

            const repo = this.store.repos.getRepo(task.repoId)
            if (!repo) return

            const abortController = new AbortController()
            const generatedTitle = await generateTitle(description, abortController, { harnessId, cwd: repo.path, events: task.events })
            this.setTaskTitle(taskId, generatedTitle ?? fallbackTitle(description))
        } catch (err) {
            console.error("[TaskManager] Title regeneration failed:", err)
            if (!productRuntimeOwnsTitleGeneration) {
                this.setTaskTitle(taskId, fallbackTitle(description))
            }
        } finally {
            runInAction(() => this.regeneratingTitleTaskIds.delete(taskId))
        }
    }
}
