/**
 * TaskModel - Observable wrapper for Task
 *
 * Provides derived state and actions for tasks.
 * Models compute from loaded task stores - no task data is cached here.
 */

import { makeAutoObservable, runInAction } from "mobx"
import type {
    OpenADETaskChangesReadRequest,
    OpenADETaskChangesReadResult,
    OpenADETaskDiffReadRequest,
    OpenADETaskDiffReadResult,
    OpenADETaskFilePairReadRequest,
    OpenADETaskFilePairReadResult,
    OpenADETaskGitSummaryResult,
} from "../../../openade-module/src"
import { DEFAULT_MODEL, getDefaultModelForHarness, resolveModelForHarness } from "../constants"
import type { GitSummaryResponse } from "../electronAPI/git"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { computeTaskUsage, normalizeTaskPreviewUsage } from "../persistence/taskStatsUtils"
import { type TaskThreadFormat, type TaskThreadJson, buildTaskThreadJson, buildTaskThreadXml } from "../prompts/taskThreadSerializer"
import type { ActionEvent, CodeEvent, IsolationStrategy, QueuedTurn, SetupEnvironmentEvent, SnapshotEvent, Task, TaskDeviceEnvironment } from "../types"
import { getDeviceId } from "../utils/deviceId"
import { ActionEventModel, type EventModel, SetupEnvironmentEventModel, SnapshotEventModel } from "./EventModel"
import { TaskEnvironment } from "./TaskEnvironment"
import { ChangesManager } from "./managers/ChangesManager"
import { ContentSearchManager } from "./managers/ContentSearchManager"
import { FileBrowserManager } from "./managers/FileBrowserManager"
import { InputManager } from "./managers/InputManager"
import { SdkCapabilitiesManager } from "./managers/SdkCapabilitiesManager"
import { TrayManager } from "./managers/TrayManager"
import type { CodeStore } from "./store"

export type ThinkingLevel = "low" | "med" | "high" | "max"

const GIT_STATE_FRESH_MS = 5_000

function legacyWorktreeDirFromSetupEvent(event: SetupEnvironmentEvent): string | null {
    const setupOutput = event.setupOutput ?? ""
    const worktreeLine = setupOutput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith("Worktree:"))
    const worktreeDir = worktreeLine?.slice("Worktree:".length).trim()
    return worktreeDir || event.workingDir || null
}

function gitSummaryFromProductSummary(summary: OpenADETaskGitSummaryResult): GitSummaryResponse {
    const toGitFiles = (files: OpenADETaskGitSummaryResult["unstaged"]["files"]) =>
        files.map((file) => ({
            path: file.path,
            binary: file.binary ?? false,
            status: file.status,
        }))

    return {
        branch: summary.branch,
        headCommit: summary.headCommit,
        ahead: summary.ahead,
        hasChanges: summary.hasChanges,
        staged: { files: toGitFiles(summary.staged.files), stats: summary.staged.stats },
        unstaged: { files: toGitFiles(summary.unstaged.files), stats: summary.unstaged.stats },
        untracked: toGitFiles(summary.untracked),
    }
}

function normalizedDirectoryPath(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+$/, "")
}

export class TaskModel {
    gitStatus: GitSummaryResponse | null = null
    model: string = DEFAULT_MODEL
    thinking: ThinkingLevel = "max"
    fastMode = false
    harnessId: HarnessId = "claude-code"
    private gitStateLoading = false
    private gitStateLoadedAt = 0
    private _environmentCache: TaskEnvironment | null = null
    private _environmentDeviceId: string | null = null
    private _environmentLoadPromise: Promise<TaskEnvironment | null> | null = null
    private _inputManager: InputManager | null = null
    private _trayManager: TrayManager | null = null
    private _fileBrowser: FileBrowserManager | null = null
    private _contentSearch: ContentSearchManager | null = null
    private _sdkCapabilities: SdkCapabilitiesManager | null = null
    private _changes: ChangesManager | null = null
    private _eventModelCache = new Map<string, EventModel>()
    private disposers: Array<() => void> = []

    constructor(
        private store: CodeStore,
        public readonly taskId: string
    ) {
        makeAutoObservable(this, {
            taskId: false,
            _eventModelCache: false,
        } as never)

        // Subscribe to execution events to refresh git state after any event completes
        this.disposers.push(
            this.store.execution.onAfterEvent((eventTaskId) => {
                if (eventTaskId === this.taskId) {
                    this.refreshGitState()
                }
            })
        )

        this.initializeExecutionSelectionFromHistory()
    }

    /**
     * Clean up all subscriptions. Call when TaskModel is no longer needed.
     */
    dispose(): void {
        for (const disposer of this.disposers) {
            disposer()
        }
        this.disposers = []
        this._changes?.dispose()
    }

    // === Input manager ===

    get input(): InputManager {
        if (!this._inputManager) {
            const editorManager = this.store.smartEditors.getManager(`task-${this.taskId}`, this.workspaceId)
            this._inputManager = new InputManager(this.store, this.taskId, editorManager)
        }
        return this._inputManager
    }

    // === Tray manager ===

    get tray(): TrayManager {
        if (!this._trayManager) {
            this._trayManager = new TrayManager(this.store, this)
        }
        return this._trayManager
    }

    // === File browser ===

    get fileBrowser(): FileBrowserManager {
        if (!this._fileBrowser) {
            this._fileBrowser = new FileBrowserManager({
                getContext: (workingDir) => {
                    if (!this.usesRuntimeProductReads || !this.repoId) return null
                    const repo = this.store.repos.getRepo(this.repoId)
                    const dir = this.environment?.taskWorkingDir ?? repo?.path
                    if (!dir || normalizedDirectoryPath(dir) !== normalizedDirectoryPath(workingDir)) return null
                    return { repoId: this.repoId, taskId: this.taskId }
                },
                listProjectFiles: (args) => this.store.listProductProjectFiles(args),
                readProjectFile: (args) => this.store.readProductProjectFile(args),
                fuzzySearchProjectFiles: (args) => this.store.fuzzySearchProductProjectFiles(args),
            })
            const dir = this.environment?.taskWorkingDir
            if (dir) this._fileBrowser.setWorkingDir(dir)
        }
        return this._fileBrowser
    }

    // === Content search ===

    get contentSearch(): ContentSearchManager {
        if (!this._contentSearch) {
            this._contentSearch = new ContentSearchManager({
                getContext: (workingDir) => {
                    if (!this.usesRuntimeProductReads || !this.repoId) return null
                    const repo = this.store.repos.getRepo(this.repoId)
                    const dir = this.environment?.taskWorkingDir ?? repo?.path
                    if (!dir || normalizedDirectoryPath(dir) !== normalizedDirectoryPath(workingDir)) return null
                    return { repoId: this.repoId, taskId: this.taskId }
                },
                searchProject: (args) => this.store.searchProductProject(args),
                readProjectFile: (args) => this.store.readProductProjectFile(args),
            })
            const dir = this.environment?.taskWorkingDir
            if (dir) this._contentSearch.setWorkingDir(dir)
        }
        return this._contentSearch
    }

    // === SDK capabilities ===

    get sdkCapabilities(): SdkCapabilitiesManager {
        if (!this._sdkCapabilities) {
            this._sdkCapabilities = new SdkCapabilitiesManager()
        }
        return this._sdkCapabilities
    }

    // === Changes ===

    get changes(): ChangesManager {
        if (!this._changes) {
            this._changes = new ChangesManager(this)
        }
        return this._changes
    }

    // === Model & Harness ===

    setModel(modelId: string): void {
        this.model = this.normalizeModelForHarness(modelId, this.harnessId)
    }

    setThinking(level: ThinkingLevel): void {
        this.thinking = level
    }

    setFastMode(enabled: boolean): void {
        this.fastMode = enabled
    }

    setHarnessId(id: HarnessId): void {
        if (this.hasActionHistory) return
        if (id === this.harnessId) return
        this.harnessId = id
        // Reset model to the new harness's default
        this.model = getDefaultModelForHarness(id)
    }

    /**
     * Re-sync harness/model from the latest action event.
     * Called after HyperPlan completes so the TaskModel reflects
     * the reconciler's agent rather than stale pre-HyperPlan defaults.
     */
    syncHarnessFromHistory(): void {
        this.initializeExecutionSelectionFromHistory()
    }

    private get hasActionHistory(): boolean {
        const events = this.task?.events ?? []
        return events.some((event) => event.type === "action")
    }

    private initializeExecutionSelectionFromHistory(): void {
        const events = this.task?.events ?? []
        for (let i = events.length - 1; i >= 0; i--) {
            const event = events[i]
            if (event.type !== "action") continue
            if (event.source.type === "review") continue

            // v1 compat: pre-harness tasks stored `type` instead of `harnessId`
            const harnessId: HarnessId =
                event.execution.harnessId ?? ((event.execution as unknown as Record<string, unknown>).type as HarnessId) ?? "claude-code"
            this.harnessId = harnessId
            const persistedModelId = event.execution.modelId
            this.model = persistedModelId ? this.normalizeModelForHarness(persistedModelId, harnessId) : getDefaultModelForHarness(harnessId)
            this.fastMode = event.execution.fastMode ?? false
            return
        }
    }

    private normalizeModelForHarness(modelId: string, harnessId: HarnessId): string {
        return resolveModelForHarness(modelId, harnessId)
    }

    private get task(): Task | undefined {
        return this.store.tasks.getTask(this.taskId) ?? undefined
    }

    // === Raw accessors ===

    get exists(): boolean {
        return !!this.task
    }

    get id(): string {
        return this.taskId
    }

    get title(): string {
        return this.task?.title ?? ""
    }

    get isClosed(): boolean {
        return this.task?.closed ?? false
    }

    get slug(): string {
        return this.task?.slug ?? ""
    }

    get description(): string {
        return this.task?.description ?? ""
    }

    get repoId(): string {
        return this.task?.repoId ?? ""
    }

    /** Alias for repoId - prefer this in new code for consistency with routing */
    get workspaceId(): string {
        return this.repoId
    }

    get usesRuntimeProductReads(): boolean {
        return this.store.shouldUseRuntimeProductReads()
    }

    get createdAt(): string {
        return this.task?.createdAt ?? ""
    }

    get sessionIds(): Record<string, string> {
        return this.task?.sessionIds ?? {}
    }

    get isolationStrategy(): IsolationStrategy | undefined {
        return this.task?.isolationStrategy
    }

    get enabledMcpServerIds(): string[] {
        return this.task?.enabledMcpServerIds ?? []
    }

    get queuedTurns(): QueuedTurn[] {
        return this.task?.queuedTurns ?? []
    }

    async cancelQueuedTurn(queuedTurnId: string): Promise<void> {
        if (!this.repoId) return
        await this.store.cancelProductQueuedTurn({
            repoId: this.repoId,
            taskId: this.taskId,
            queuedTurnId,
        })
        await this.store.refreshProductStateAfterTaskMutation(this.taskId)
    }

    readProductTaskChanges(params: Omit<OpenADETaskChangesReadRequest, "repoId" | "taskId">): Promise<OpenADETaskChangesReadResult> {
        return this.store.readProductTaskChanges({ repoId: this.repoId, taskId: this.taskId, ...params })
    }

    readProductTaskGitSummary(): Promise<OpenADETaskGitSummaryResult> {
        return this.store.readProductTaskGitSummary({ repoId: this.repoId, taskId: this.taskId })
    }

    readProductTaskDiff(params: Omit<OpenADETaskDiffReadRequest, "repoId" | "taskId">): Promise<OpenADETaskDiffReadResult> {
        return this.store.readProductTaskDiff({ repoId: this.repoId, taskId: this.taskId, ...params })
    }

    readProductTaskFilePair(params: Omit<OpenADETaskFilePairReadRequest, "repoId" | "taskId">): Promise<OpenADETaskFilePairReadResult> {
        return this.store.readProductTaskFilePair({ repoId: this.repoId, taskId: this.taskId, ...params })
    }

    setEnabledMcpServerIds(serverIds: string[]): void {
        this.store.tasks.setEnabledMcpServerIds(this.taskId, serverIds)
    }

    get deviceEnvironments(): TaskDeviceEnvironment[] {
        return this.task?.deviceEnvironments ?? []
    }

    get currentDeviceEnvironment(): TaskDeviceEnvironment | null {
        const deviceId = getDeviceId()
        return this.deviceEnvironments.find((e) => e.deviceId === deviceId) ?? this.legacyDeviceEnvironment
    }

    get needsEnvironmentSetup(): boolean {
        const deviceEnv = this.currentDeviceEnvironment
        if (!deviceEnv) return true
        return !deviceEnv.setupComplete
    }

    private get legacyDeviceEnvironment(): TaskDeviceEnvironment | null {
        const task = this.task
        if (!task) return null

        const deviceId = getDeviceId()
        const timestamp = task.updatedAt || task.createdAt || new Date().toISOString()
        if (task.isolationStrategy.type === "head") {
            return {
                id: deviceId,
                deviceId,
                setupComplete: true,
                createdAt: timestamp,
                lastUsedAt: timestamp,
            }
        }

        const setupEvent = this.findLegacySetupEnvironment(task, deviceId)
        if (!setupEvent) return null

        const worktreeDir = legacyWorktreeDirFromSetupEvent(setupEvent)
        if (!worktreeDir) return null

        return {
            id: deviceId,
            deviceId,
            worktreeDir,
            setupComplete: true,
            mergeBaseCommit: this.latestSnapshotMergeBase(task),
            createdAt: setupEvent.completedAt ?? setupEvent.createdAt ?? timestamp,
            lastUsedAt: timestamp,
        }
    }

    private findLegacySetupEnvironment(task: Task, deviceId: string): SetupEnvironmentEvent | null {
        for (let index = task.events.length - 1; index >= 0; index--) {
            const event = task.events[index]
            if (event.type !== "setup_environment" || event.status !== "completed") continue
            if (event.deviceId === deviceId) return event
        }

        if (task.deviceEnvironments.length > 0) return null
        for (let index = task.events.length - 1; index >= 0; index--) {
            const event = task.events[index]
            if (event.type === "setup_environment" && event.status === "completed") return event
        }
        return null
    }

    private latestSnapshotMergeBase(task: Task): string | undefined {
        for (let index = task.events.length - 1; index >= 0; index--) {
            const event = task.events[index]
            if (event.type === "snapshot") return (event as SnapshotEvent).mergeBaseCommit
        }
        return undefined
    }

    /**
     * Get the cached environment. Returns null if not yet loaded.
     * Call loadEnvironment() to fetch and cache the environment.
     */
    get environment(): TaskEnvironment | null {
        const deviceId = getDeviceId()

        // Return cached if same device
        if (this._environmentCache && this._environmentDeviceId === deviceId) {
            return this._environmentCache
        }

        // If device changed or no cache, return null (caller should call loadEnvironment)
        return null
    }

    /**
     * Load and cache the task environment.
     * Fetches git info asynchronously and creates the environment.
     */
    async loadEnvironment(): Promise<TaskEnvironment | null> {
        const deviceId = getDeviceId()

        // Return cached if same device
        if (this._environmentCache && this._environmentDeviceId === deviceId) {
            return this._environmentCache
        }

        const deviceEnv = this.currentDeviceEnvironment
        if (!deviceEnv?.setupComplete) {
            return null
        }

        const task = this.task
        if (!task) {
            return null
        }

        const repo = this.store.repos.getRepo(this.repoId)
        if (!repo) {
            return null
        }

        // Coalesce concurrent loads to a single in-flight promise.
        if (this._environmentLoadPromise) {
            return this._environmentLoadPromise
        }

        const loadPromise = (async () => {
            // Fetch git info asynchronously
            const gitInfo = await this.store.repos.getGitInfo(this.repoId)

            const env = new TaskEnvironment(task, repo, gitInfo, deviceEnv)

            runInAction(() => {
                this._environmentCache = env
                this._environmentDeviceId = deviceId
            })

            return env
        })()

        this._environmentLoadPromise = loadPromise
        try {
            return await loadPromise
        } finally {
            if (this._environmentLoadPromise === loadPromise) {
                this._environmentLoadPromise = null
            }
        }
    }

    invalidateEnvironmentCache(): void {
        this._environmentCache = null
        this._environmentDeviceId = null
        this._environmentLoadPromise = null
    }

    get hasWorkingChanges(): boolean {
        return this.gitStatus?.hasChanges ?? false
    }

    get aheadCount(): number {
        return this.gitStatus?.ahead ?? 0
    }

    get hasGhCli(): boolean {
        return this.environment?.hasGhCli ?? false
    }

    get pullRequest(): { url: string; number?: number; provider: "github" | "gitlab" | "other" } | undefined {
        return this.task?.pullRequest
    }

    getThreadJson(format: Partial<TaskThreadFormat> = {}): TaskThreadJson | null {
        if (!this.task) return null
        return buildTaskThreadJson(this.task, format)
    }

    getThreadXml(format: Partial<TaskThreadFormat> = {}): string {
        if (!this.task) return ""
        return buildTaskThreadXml(this.task, format)
    }

    // === Event models ===

    get events(): EventModel[] {
        const rawEvents = this.task?.events ?? []
        const validIds = new Set<string>()
        const lastIndex = rawEvents.length - 1
        const result = rawEvents.map((e, i) => {
            validIds.add(e.id)
            const cached = this._eventModelCache.get(e.id)
            if (cached) return cached
            const model = this.createEventModel(e, i === lastIndex)
            this._eventModelCache.set(e.id, model)
            return model
        })
        // Drop cache entries for events that no longer exist
        for (const id of this._eventModelCache.keys()) {
            if (!validIds.has(id)) this._eventModelCache.delete(id)
        }
        return result
    }

    private createEventModel(event: CodeEvent, isLast: boolean): EventModel {
        if (event.type === "setup_environment") {
            return new SetupEnvironmentEventModel(this.store, this.taskId, event.id, isLast)
        }
        if (event.type === "snapshot") {
            return new SnapshotEventModel(this.store, this.taskId, event.id, isLast)
        }
        return new ActionEventModel(this.store, this.taskId, event.id, isLast)
    }

    // === Derived state ===

    getLatestPlanEvent(): ActionEvent | null {
        const events = this.task?.events ?? []
        for (let i = events.length - 1; i >= 0; i--) {
            const e = events[i]
            if (e.type === "action" && e.status === "completed" && (e.source.type === "plan" || e.source.type === "revise" || e.source.type === "hyperplan")) {
                return e
            }
        }
        return null
    }

    get hasActivePlan(): boolean {
        const latestPlan = this.getLatestPlanEvent()
        if (!latestPlan) return false

        // Check if this plan was cancelled
        if (latestPlan.id === this.task?.cancelledPlanEventId) return false

        // Check if plan was already executed (run_plan or do after it)
        const events = this.task?.events ?? []
        const planIndex = events.findIndex((e) => e.id === latestPlan.id)
        for (let i = planIndex + 1; i < events.length; i++) {
            const e = events[i]
            if (e.type === "action" && (e.source.type === "run_plan" || e.source.type === "do")) {
                return false
            }
        }
        return true
    }

    get isWorking(): boolean {
        return this.store.isTaskRunning(this.taskId)
    }

    get stats(): { totalCostUsd: number; durationMs: number; inputTokens: number; outputTokens: number } {
        const previewUsage = this.usesRuntimeProductReads ? this.store.getRuntimeProductTaskPreviewDto(this.repoId, this.taskId)?.usage : undefined
        if (previewUsage) {
            const usage = normalizeTaskPreviewUsage(previewUsage)
            return {
                totalCostUsd: usage.totalCostUsd,
                durationMs: usage.durationMs ?? 0,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
            }
        }

        const events = this.task?.events ?? []
        const usage = computeTaskUsage(events)
        return {
            totalCostUsd: usage.totalCostUsd,
            durationMs: usage.durationMs ?? 0,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
        }
    }

    // === Actions ===

    async refreshGitState(options: { force?: boolean } = {}): Promise<void> {
        if (this.gitStateLoading) return
        if (!options.force && this.gitStateLoadedAt > 0 && Date.now() - this.gitStateLoadedAt < GIT_STATE_FRESH_MS) return
        this.gitStateLoading = true

        if (this.usesRuntimeProductReads && this.repoId) {
            try {
                const result = await this.readProductTaskGitSummary()
                runInAction(() => {
                    this.gitStatus = gitSummaryFromProductSummary(result)
                    this.gitStateLoadedAt = Date.now()
                })
            } catch (err) {
                console.error("[TaskModel] Failed to refresh runtime git state:", err)
                runInAction(() => {
                    this.gitStatus = null
                })
            } finally {
                runInAction(() => {
                    this.gitStateLoading = false
                })
            }
            return
        }

        try {
            // Load environment first (async)
            const env = await this.loadEnvironment()
            if (!env?.taskWorkingDir) {
                runInAction(() => {
                    this.gitStatus = null
                    this.gitStateLoadedAt = Date.now()
                    this.gitStateLoading = false
                })
                return
            }

            const result = await env.getGitSummary()
            runInAction(() => {
                this.gitStatus = result
                this.gitStateLoadedAt = Date.now()
            })
        } catch (err) {
            console.error("[TaskModel] Failed to refresh git state:", err)
            runInAction(() => {
                this.gitStatus = null
            })
        } finally {
            runInAction(() => {
                this.gitStateLoading = false
            })
        }
    }
}
