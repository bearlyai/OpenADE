/**
 * TaskModel - Observable wrapper for Task
 *
 * Provides derived state and actions for tasks.
 * Models compute from store's tasksById - no caching needed.
 */

import { makeAutoObservable, runInAction } from "mobx"
import { type ClaudeModelId, DEFAULT_MODEL } from "../constants"
import { extractSDKMessages } from "../electronAPI/claudeEventTypes"
import type { GitStatusResponse } from "../electronAPI/git"
import { computeTaskUsage } from "../persistence/taskStatsUtils"
import type { ActionEvent, CodeEvent, IsolationStrategy, Task, TaskDeviceEnvironment } from "../types"
import { getDeviceId } from "../utils/deviceId"
import { ActionEventModel, type EventModel, SetupEnvironmentEventModel, SnapshotEventModel } from "./EventModel"
import { TaskEnvironment } from "./TaskEnvironment"
import { ContentSearchManager } from "./managers/ContentSearchManager"
import { FileBrowserManager } from "./managers/FileBrowserManager"
import { InputManager } from "./managers/InputManager"
import { SdkCapabilitiesManager } from "./managers/SdkCapabilitiesManager"
import { TrayManager } from "./managers/TrayManager"
import type { CodeStore } from "./store"

export class TaskModel {
    gitStatus: GitStatusResponse | null = null
    model: ClaudeModelId = DEFAULT_MODEL
    private gitStateLoading = false
    private _environmentCache: TaskEnvironment | null = null
    private _environmentDeviceId: string | null = null
    private _environmentLoading = false
    private _inputManager: InputManager | null = null
    private _trayManager: TrayManager | null = null
    private _fileBrowser: FileBrowserManager | null = null
    private _contentSearch: ContentSearchManager | null = null
    private _sdkCapabilities: SdkCapabilitiesManager | null = null
    private disposers: Array<() => void> = []

    constructor(
        private store: CodeStore,
        public readonly taskId: string
    ) {
        makeAutoObservable(this, {
            taskId: false,
        })

        // Subscribe to execution events to refresh git state after any event completes
        this.disposers.push(
            this.store.execution.onAfterEvent((eventTaskId) => {
                if (eventTaskId === this.taskId) {
                    this.refreshGitState()
                }
            })
        )
    }

    /**
     * Clean up all subscriptions. Call when TaskModel is no longer needed.
     */
    dispose(): void {
        for (const disposer of this.disposers) {
            disposer()
        }
        this.disposers = []
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
            this._fileBrowser = new FileBrowserManager()
            const dir = this.environment?.taskWorkingDir
            if (dir) this._fileBrowser.setWorkingDir(dir)
        }
        return this._fileBrowser
    }

    // === Content search ===

    get contentSearch(): ContentSearchManager {
        if (!this._contentSearch) {
            this._contentSearch = new ContentSearchManager()
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

    // === Model ===

    setModel(modelId: ClaudeModelId): void {
        this.model = modelId
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

    get createdAt(): string {
        return this.task?.createdAt ?? ""
    }

    get sessionIds(): Record<string, string> {
        return this.task?.sessionIds ?? {}
    }

    get isolationStrategy(): IsolationStrategy | undefined {
        return this.task?.isolationStrategy
    }

    get deviceEnvironments(): TaskDeviceEnvironment[] {
        return this.task?.deviceEnvironments ?? []
    }

    get currentDeviceEnvironment(): TaskDeviceEnvironment | null {
        const deviceId = getDeviceId()
        return this.deviceEnvironments.find((e) => e.deviceId === deviceId) ?? null
    }

    get needsEnvironmentSetup(): boolean {
        const deviceEnv = this.currentDeviceEnvironment
        if (!deviceEnv) return true
        return !deviceEnv.setupComplete
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

        // Prevent concurrent loads
        if (this._environmentLoading) {
            // Wait for the current load to complete
            await new Promise((resolve) => setTimeout(resolve, 50))
            return this.environment
        }

        this._environmentLoading = true
        try {
            // Fetch git info asynchronously
            const gitInfo = await this.store.repos.getGitInfo(this.repoId)

            const env = new TaskEnvironment(task, repo, gitInfo, deviceEnv)

            runInAction(() => {
                this._environmentCache = env
                this._environmentDeviceId = deviceId
            })

            return env
        } finally {
            this._environmentLoading = false
        }
    }

    invalidateEnvironmentCache(): void {
        this._environmentCache = null
        this._environmentDeviceId = null
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

    // === Event models ===

    get events(): EventModel[] {
        const rawEvents = this.task?.events ?? []
        return rawEvents.map((e, i) => this.createEventModel(e, i === rawEvents.length - 1))
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
            if (e.type === "action" && e.status === "completed" && (e.source.type === "plan" || e.source.type === "revise")) {
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
        return this.store.isTaskWorking(this.taskId)
    }

    get stats(): { totalCostUsd: number; durationMs: number; inputTokens: number; outputTokens: number } {
        const events = this.task?.events ?? []
        const usage = computeTaskUsage(events)

        let durationMs = 0
        for (const event of events) {
            if (event.type !== "action") continue
            const sdkMessages = extractSDKMessages(event.execution.events)
            for (const msg of sdkMessages) {
                if (msg.type === "result") {
                    durationMs += (msg as { duration_ms: number }).duration_ms ?? 0
                }
            }
        }

        return { totalCostUsd: usage.totalCostUsd, durationMs, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
    }

    // === Actions ===

    async refreshGitState(): Promise<void> {
        // Load environment first (async)
        const env = await this.loadEnvironment()
        if (!env?.taskWorkingDir) {
            runInAction(() => {
                this.gitStatus = null
            })
            return
        }

        if (this.gitStateLoading) return
        this.gitStateLoading = true

        try {
            const result = await env.getGitStatus()
            runInAction(() => {
                this.gitStatus = result
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
