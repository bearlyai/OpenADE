import { makeAutoObservable, reaction, runInAction } from "mobx"
import type { OpenADEProject, OpenADESnapshot, OpenADETask, OpenADETaskPreview, OpenADETaskReadOptions } from "../../../openade-module/src"
import type { RuntimeNotification } from "../../../runtime-protocol/src"
import { analytics, track } from "../analytics"
import { DEFAULT_HARNESS_ID, DEFAULT_MODEL, MODEL_REGISTRY, getDefaultModelForHarness } from "../constants"
import { getDeviceConfig, setDeviceId as setDeviceConfigDeviceId, setTelemetryDisabled } from "../electronAPI/deviceConfig"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { setGlobalEnv } from "../electronAPI/subprocess"
import { isDesktopSharedTaskScreenEnabled, isRuntimeBackedProductStoreEnabled } from "../featureFlags"
import { crossReviewStrategy, ensembleStrategy, peerReviewStrategy, standardStrategy } from "../hyperplan/strategies"
import type { AgentCouplet, HyperPlanStrategy } from "../hyperplan/types"
import { OpenADEProductStore } from "../kernel/productStore"
import { taskFromRuntimeProduct } from "../kernel/taskAdapter"
import type { McpServerStore } from "../persistence/mcpServerStore"
import { type McpServerStoreConnection, connectMcpServerStore } from "../persistence/mcpServerStoreBootstrap"
import type { PersonalSettings, PersonalSettingsStore } from "../persistence/personalSettingsStore"
import { type PersonalSettingsStoreConnection, connectPersonalSettingsStore } from "../persistence/personalSettingsStoreBootstrap"
import { type RepoStore, type TaskPreview, getTaskPreview } from "../persistence/repoStore"
import { type RepoStoreConnection, connectRepoStore } from "../persistence/repoStoreBootstrap"
import { type TaskStoreConnection, loadTaskStore } from "../persistence/taskLoader"
import { computeTaskUsage, needsTaskUsageBackfill, normalizeTaskPreviewUsage } from "../persistence/taskStatsUtils"
import { type TaskStore, taskFromStore } from "../persistence/taskStore"
import { localOpenADEClient } from "../runtime/localOpenADEClient"
import { localRuntimeClient } from "../runtime/localRuntimeClient"
import type { Task, User } from "../types"
import type { ThinkingLevel } from "./TaskModel"

import { CommentManager } from "./managers/CommentManager"
import { CronManager } from "./managers/CronManager"
import { EventManager } from "./managers/EventManager"
import { ExecutionManager } from "./managers/ExecutionManager"
import { McpServerManager } from "./managers/McpServerManager"
import { NotificationManager } from "./managers/NotificationManager"
import { QueryManager } from "./managers/QueryManager"
import { QueuedTurnManager } from "./managers/QueuedTurnManager"
import { RepeatManager } from "./managers/RepeatManager"
import { RepoManager } from "./managers/RepoManager"
import { RepoProcessesManager } from "./managers/RepoProcessesManager"
import { RuntimeManager } from "./managers/RuntimeManager"
import { ScratchpadManager } from "./managers/ScratchpadManager"
import { SmartEditorManagerStore } from "./managers/SmartEditorManager"
import { type CreationPhase, type TaskCreation, TaskCreationManager, type TaskCreationOptions } from "./managers/TaskCreationManager"
import { TaskManager } from "./managers/TaskManager"
import { UIStateManager, type ViewMode } from "./managers/UIStateManager"

export type { CreationPhase, TaskCreationOptions, TaskCreation, ViewMode }

export interface CodeStoreConfig {
    getCurrentUser: () => User
    navigateToTask: (workspaceId: string, taskId: string) => void
    enableRuntimeProductStore?: boolean
    enableDesktopSharedTaskScreen?: boolean
    runtimeProductStoreFactory?: () => OpenADEProductStore
    runtimeNotificationSource?: RuntimeNotificationSource
}

const ANALYTICS_DEVICE_ID_BACKUP_KEY = "openade-analytics-device-id"

export type RuntimeProductStoreStatus = "disabled" | "loading" | "ready" | "error"

export interface RuntimeNotificationSource {
    subscribe(listener: (notification: RuntimeNotification) => void): () => void
}

function toRuntimeTaskPreview(preview: OpenADETaskPreview): TaskPreview {
    return {
        id: preview.id,
        slug: preview.slug,
        title: preview.title,
        closed: preview.closed,
        createdAt: preview.createdAt,
        lastEvent: preview.lastEvent,
        usage: preview.usage,
        lastViewedAt: preview.lastViewedAt,
        lastEventAt: preview.lastEventAt,
    }
}

function notificationRecord(notification: RuntimeNotification): Record<string, unknown> {
    return typeof notification.params === "object" && notification.params !== null && !Array.isArray(notification.params)
        ? (notification.params as Record<string, unknown>)
        : {}
}

type AnalyticsDeviceIdSource =
    | "device_config_existing"
    | "device_config_generated"
    | "personal_settings_backup"
    | "local_storage_backup"
    | "personal_settings"
    | "local_storage"
    | "generated"

interface NewTaskAgentDefaults {
    harnessId: HarnessId
    modelId: string
}

function isHarnessId(value: string | undefined): value is HarnessId {
    return value === "claude-code" || value === "codex"
}

function isModelForHarness(harnessId: HarnessId, modelId: string | undefined): modelId is string {
    if (!modelId) return false
    return MODEL_REGISTRY[harnessId].models.some((model) => model.id === modelId)
}

function getNewTaskAgentDefaults(settings: PersonalSettings | undefined): NewTaskAgentDefaults {
    const harnessId = isHarnessId(settings?.newTaskHarnessId) ? settings.newTaskHarnessId : DEFAULT_HARNESS_ID
    const modelId = isModelForHarness(harnessId, settings?.newTaskModelId) ? settings.newTaskModelId : getDefaultModelForHarness(harnessId)

    return { harnessId, modelId }
}

function getLocalAnalyticsDeviceIdBackup(): string | null {
    if (typeof window === "undefined") return null

    try {
        const storage = window.localStorage
        if (!storage) return null
        const value = storage.getItem(ANALYTICS_DEVICE_ID_BACKUP_KEY)?.trim()
        return value || null
    } catch (err) {
        console.warn("[Analytics] Failed to read local device ID backup:", err)
        return null
    }
}

function setLocalAnalyticsDeviceIdBackup(deviceId: string): void {
    if (typeof window === "undefined") return

    try {
        const storage = window.localStorage
        if (!storage) return
        storage.setItem(ANALYTICS_DEVICE_ID_BACKUP_KEY, deviceId)
    } catch (err) {
        console.warn("[Analytics] Failed to write local device ID backup:", err)
    }
}

export class CodeStore {
    readonly config: CodeStoreConfig
    defaultModel: string = DEFAULT_MODEL
    defaultThinking: ThinkingLevel = "max"
    defaultFastMode = false
    defaultHarnessId: HarnessId = DEFAULT_HARNESS_ID

    repoStore: RepoStore | null = null
    mcpServerStore: McpServerStore | null = null
    personalSettingsStore: PersonalSettingsStore | null = null
    private repoStoreConnection: RepoStoreConnection | null = null
    private mcpServerStoreConnection: McpServerStoreConnection | null = null
    private personalSettingsStoreConnection: PersonalSettingsStoreConnection | null = null
    private taskStoreConnections: Map<string, TaskStoreConnection> = new Map()
    private envVarsReactionDisposer: (() => void) | null = null
    private runtimeNotificationDisposer: (() => void) | null = null
    private runtimeRefreshQueue: Promise<void> = Promise.resolve()
    private runtimeProductStore: OpenADEProductStore | null = null
    private telemetryReactionDisposer: (() => void) | null = null
    private pingIntervalId: ReturnType<typeof setInterval> | null = null
    private focusHandler: (() => void) | null = null
    private blurHandler: (() => void) | null = null
    private trackedRuntimeProductFallbackKeys: Set<string> = new Set()
    storeInitialized = false
    storeInitializing = false
    runtimeProductSnapshot: OpenADESnapshot | null = null
    runtimeProductTasks: Map<string, Task> = new Map()
    runtimeProductStoreStatus: RuntimeProductStoreStatus = "disabled"
    runtimeProductStoreError: string | null = null
    private storeInitPromise: Promise<void> | null = null

    readonly ui: UIStateManager
    readonly queries: QueryManager
    readonly repos: RepoManager
    readonly tasks: TaskManager
    readonly events: EventManager
    readonly execution: ExecutionManager
    readonly creation: TaskCreationManager
    readonly notifications: NotificationManager
    readonly comments: CommentManager
    readonly repoProcesses: RepoProcessesManager
    readonly mcpServers: McpServerManager
    readonly smartEditors: SmartEditorManagerStore
    readonly runtimes: RuntimeManager
    readonly queuedTurns: QueuedTurnManager
    readonly crons: CronManager
    readonly repeat: RepeatManager
    readonly scratchpads: ScratchpadManager

    constructor(config: CodeStoreConfig) {
        this.config = config
        this.ui = new UIStateManager()
        this.queries = new QueryManager(this)
        this.repos = new RepoManager(this)
        this.events = new EventManager(this)
        this.execution = new ExecutionManager(this)
        this.tasks = new TaskManager(this)
        this.creation = new TaskCreationManager(this)
        this.notifications = new NotificationManager(this)
        this.comments = new CommentManager(this)
        this.repoProcesses = new RepoProcessesManager()
        this.mcpServers = new McpServerManager(this)
        this.smartEditors = new SmartEditorManagerStore()
        this.runtimes = new RuntimeManager()
        this.queuedTurns = new QueuedTurnManager()
        this.crons = new CronManager(this)
        this.repeat = new RepeatManager(this)
        this.scratchpads = new ScratchpadManager()

        makeAutoObservable(this, {
            repoStore: true,
            mcpServerStore: true,
            personalSettingsStore: true,
            storeInitialized: true,
            storeInitializing: true,
            runtimeProductSnapshot: true,
            runtimeProductTasks: true,
            runtimeProductStoreStatus: true,
            runtimeProductStoreError: true,
            ui: false,
            queries: false,
            repos: false,
            tasks: false,
            events: false,
            execution: false,
            creation: false,
            notifications: false,
            comments: false,
            repoProcesses: false,
            mcpServers: false,
            smartEditors: false,
            runtimes: false,
            queuedTurns: false,
            crons: false,
            repeat: false,
            scratchpads: false,
        })
    }

    async initializeStores(): Promise<void> {
        if (this.storeInitialized) return

        if (this.storeInitializing && this.storeInitPromise) {
            return this.storeInitPromise
        }

        runInAction(() => {
            this.storeInitializing = true
        })

        this.storeInitPromise = this._doInitializeStores()
        return this.storeInitPromise
    }

    private async _doInitializeStores(): Promise<void> {
        try {
            const [repoConnection, mcpConnection, personalSettingsConnection] = await Promise.all([
                connectRepoStore(),
                connectMcpServerStore(),
                connectPersonalSettingsStore(),
            ])

            await Promise.all([repoConnection.sync(), mcpConnection.sync(), personalSettingsConnection.sync()])

            const newTaskDefaults = getNewTaskAgentDefaults(personalSettingsConnection.store.settings.get())

            runInAction(() => {
                this.repoStoreConnection = repoConnection
                this.repoStore = repoConnection.store
                this.mcpServerStoreConnection = mcpConnection
                this.mcpServerStore = mcpConnection.store
                this.personalSettingsStoreConnection = personalSettingsConnection
                this.personalSettingsStore = personalSettingsConnection.store
                this.defaultHarnessId = newTaskDefaults.harnessId
                this.defaultModel = newTaskDefaults.modelId
                this.storeInitialized = true
                this.storeInitializing = false
            })

            this.resetRuntimeNotificationSubscription()
            await this.initializeRuntimeProductStore()
            await this.runtimes.hydrateOpenADETasks().catch((err) => {
                console.warn("[CodeStore] Failed to hydrate runtime state:", err)
            })

            // Start cron tracking for all repos (runs in background, doesn't block init)
            this.crons.startAll().catch((err) => {
                console.error("[CodeStore] Failed to start cron manager:", err)
            })

            const initialEnvVars = personalSettingsConnection.store.settings.get()?.envVars
            if (initialEnvVars && Object.keys(initialEnvVars).length > 0) {
                setGlobalEnv(initialEnvVars).catch((err) => {
                    console.error("[CodeStore] Failed to push initial env vars:", err)
                })
            }

            this.envVarsReactionDisposer = reaction(
                () => this.personalSettingsStore?.settings.get()?.envVars,
                (envVars) => {
                    if (envVars) {
                        setGlobalEnv(envVars).catch((err) => {
                            console.error("[CodeStore] Failed to push env vars:", err)
                        })
                    }
                }
            )

            this.initializeAnalytics(personalSettingsConnection.store)
        } catch (err) {
            console.error("[CodeStore] Failed to initialize stores:", err)
            runInAction(() => {
                this.storeInitializing = false
            })
            throw err
        }
    }

    private runtimeNotificationSource(): RuntimeNotificationSource | null {
        if (this.config.runtimeNotificationSource) return this.config.runtimeNotificationSource
        if (typeof window === "undefined" || !window.openadeAPI?.runtime) return null
        return localRuntimeClient
    }

    private subscribeToRuntimeNotifications(): (() => void) | null {
        const source = this.runtimeNotificationSource()
        if (!source) return null

        return source.subscribe((notification) => {
            this.runtimeRefreshQueue = this.runtimeRefreshQueue
                .then(() => this.handleRuntimeNotification(notification))
                .catch((err) => {
                    console.warn("[CodeStore] Failed to refresh from runtime notification:", err)
                })
        })
    }

    private resetRuntimeNotificationSubscription(): void {
        this.runtimeNotificationDisposer?.()
        this.runtimeNotificationDisposer = this.subscribeToRuntimeNotifications()
    }

    private ensureRuntimeNotificationSubscription(): void {
        if (this.runtimeNotificationDisposer) return
        this.runtimeNotificationDisposer = this.subscribeToRuntimeNotifications()
    }

    private async handleRuntimeNotification(notification: RuntimeNotification): Promise<void> {
        const params = typeof notification.params === "object" && notification.params !== null ? (notification.params as Record<string, unknown>) : {}

        const settledTaskIds = this.runtimes.applyNotification(notification)
        await this.handleRuntimeProductStoreNotification(notification)
        for (const taskId of settledTaskIds) {
            await this.notifyRuntimeTaskSettled(taskId)
        }

        const queuedTurnTaskId = this.queuedTurns.applyNotification(notification)
        if (queuedTurnTaskId) {
            await this.refreshTaskStoreFromStorage(queuedTurnTaskId)
            this.queuedTurns.reconcileTaskWithStorage(queuedTurnTaskId, this.tasks.getTaskModel(queuedTurnTaskId)?.queuedTurns ?? [])
            return
        }

        if (notification.method === "openade/task/updated" || notification.method === "openade/task/previewChanged") {
            await this.refreshRepoStoreFromStorage()
            if (typeof params.taskId === "string") {
                await this.refreshTaskStoreFromStorage(params.taskId)
            }
            return
        }

        if (notification.method === "openade/task/deleted") {
            await this.refreshRepoStoreFromStorage()
            if (typeof params.taskId === "string") {
                this.disconnectTaskStore(params.taskId)
                this.runtimes.removeTask(params.taskId)
            }
            return
        }

        if (
            notification.method === "openade/snapshotChanged" ||
            notification.method === "openade/repo/updated" ||
            notification.method === "openade/repo/deleted"
        ) {
            await this.refreshRepoStoreFromStorage()
        }
    }

    private shouldEnableRuntimeProductStore(): boolean {
        return this.config.enableRuntimeProductStore ?? isRuntimeBackedProductStoreEnabled
    }

    private createRuntimeProductStore(): OpenADEProductStore {
        return this.config.runtimeProductStoreFactory?.() ?? new OpenADEProductStore(localOpenADEClient)
    }

    private runtimeProductErrorMessage(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }

    private runtimeProductTelemetryProperties(source: string): Record<string, unknown> {
        const snapshot = this.runtimeProductSnapshot
        return {
            source,
            enabled: this.shouldEnableRuntimeProductStore(),
            desktopSharedTaskScreenEnabled: this.config.enableDesktopSharedTaskScreen ?? isDesktopSharedTaskScreenEnabled,
            status: this.runtimeProductStoreStatus,
            hasSnapshot: snapshot !== null,
            repoCount: snapshot?.repos.length ?? 0,
            taskPreviewCount: snapshot?.repos.reduce((count, repo) => count + repo.tasks.length, 0) ?? 0,
            cachedTaskCount: this.runtimeProductTasks.size,
        }
    }

    private runtimeProductErrorKind(err: unknown): string {
        if (err instanceof Error) return err.name || "Error"
        return typeof err
    }

    private trackRuntimeProductStoreError(source: string, err: unknown): void {
        track("runtime_product_store_error", {
            ...this.runtimeProductTelemetryProperties(source),
            errorKind: this.runtimeProductErrorKind(err),
        })
    }

    trackRuntimeProductFallback(source: string, reason: string): void {
        if (!this.shouldEnableRuntimeProductStore()) return

        const key = `${source}:${reason}:${this.runtimeProductStoreStatus}:${this.runtimeProductSnapshot === null ? "no-snapshot" : "snapshot"}`
        if (this.trackedRuntimeProductFallbackKeys.has(key)) return
        this.trackedRuntimeProductFallbackKeys.add(key)

        const properties = {
            ...this.runtimeProductTelemetryProperties(source),
            reason,
        }
        track("runtime_product_store_fallback", properties)
        console.warn("[CodeStore] Runtime product store fallback:", properties)
    }

    async initializeRuntimeProductStore(): Promise<void> {
        if (!this.shouldEnableRuntimeProductStore()) {
            this.runtimeProductStore?.destroy()
            this.runtimeProductStore = null
            this.trackedRuntimeProductFallbackKeys.clear()
            runInAction(() => {
                this.runtimeProductSnapshot = null
                this.runtimeProductTasks.clear()
                this.runtimeProductStoreStatus = "disabled"
                this.runtimeProductStoreError = null
            })
            return
        }

        const productStore = this.runtimeProductStore ?? this.createRuntimeProductStore()
        this.runtimeProductStore = productStore
        this.ensureRuntimeNotificationSubscription()
        runInAction(() => {
            this.runtimeProductStoreStatus = "loading"
            this.runtimeProductStoreError = null
        })

        try {
            const snapshot = await productStore.refreshSnapshot()
            runInAction(() => {
                this.runtimeProductSnapshot = snapshot
                this.pruneRuntimeProductTasks(snapshot)
                this.runtimeProductStoreStatus = "ready"
                this.runtimeProductStoreError = null
            })
        } catch (err) {
            const message = this.runtimeProductErrorMessage(err)
            runInAction(() => {
                this.runtimeProductSnapshot = null
                this.runtimeProductTasks.clear()
                this.runtimeProductStoreStatus = "error"
                this.runtimeProductStoreError = message
            })
            this.trackRuntimeProductStoreError("initialize", err)
            console.warn("[CodeStore] Failed to initialize runtime product store:", err)
        }
    }

    async refreshRuntimeProductSnapshot(): Promise<OpenADESnapshot | null> {
        if (!this.runtimeProductStore) return null
        try {
            const snapshot = await this.runtimeProductStore.refreshSnapshot()
            runInAction(() => {
                this.runtimeProductSnapshot = snapshot
                this.pruneRuntimeProductTasks(snapshot)
                this.runtimeProductStoreStatus = "ready"
                this.runtimeProductStoreError = null
            })
            return snapshot
        } catch (err) {
            const message = this.runtimeProductErrorMessage(err)
            runInAction(() => {
                this.runtimeProductStoreStatus = "error"
                this.runtimeProductStoreError = message
            })
            this.trackRuntimeProductStoreError("snapshot_refresh", err)
            throw err
        }
    }

    private runtimeProductTaskPreview(repoId: string, taskId: string): OpenADETaskPreview | undefined {
        return this.runtimeProductSnapshot?.repos.find((repo) => repo.id === repoId)?.tasks.find((task) => task.id === taskId)
    }

    private cacheRuntimeProductTask(task: OpenADETask): Task {
        const adapted = taskFromRuntimeProduct({
            task,
            preview: this.runtimeProductTaskPreview(task.repoId, task.id),
            currentUser: this.currentUser,
        })
        this.runtimeProductTasks.set(task.id, adapted)
        return adapted
    }

    private pruneRuntimeProductTasks(snapshot: OpenADESnapshot): void {
        const taskIds = new Set(snapshot.repos.flatMap((repo) => repo.tasks.map((task) => task.id)))
        for (const taskId of this.runtimeProductTasks.keys()) {
            if (!taskIds.has(taskId)) this.runtimeProductTasks.delete(taskId)
        }
    }

    async getRuntimeProductTask(repoId: string, taskId: string, options: OpenADETaskReadOptions = {}): Promise<OpenADETask | null> {
        if (!this.runtimeProductStore) return null
        const task = await this.runtimeProductStore.getTask(repoId, taskId, options)
        runInAction(() => {
            this.cacheRuntimeProductTask(task)
        })
        return task
    }

    async loadRuntimeProductTask(repoId: string, taskId: string, options: OpenADETaskReadOptions = {}): Promise<Task | null> {
        const task = await this.getRuntimeProductTask(repoId, taskId, options)
        const adapted = task ? (this.runtimeProductTasks.get(task.id) ?? null) : null
        if (adapted) this.tasks.getTaskModel(taskId)?.syncHarnessFromHistory()
        return adapted
    }

    async refreshRuntimeProductTaskForTaskId(taskId: string, options: OpenADETaskReadOptions = {}): Promise<OpenADETask | null> {
        if (!this.runtimeProductStore || !this.shouldUseRuntimeProductReads()) return null

        let repoId = this.runtimeProductTasks.get(taskId)?.repoId ?? this.findRuntimeProductRepoIdForTask(taskId)
        if (!repoId) {
            await this.refreshRuntimeProductSnapshot()
            repoId = this.findRuntimeProductRepoIdForTask(taskId)
        }
        if (!repoId) return null

        const task = await this.getRuntimeProductTask(repoId, taskId, options)
        if (task) this.tasks.getTaskModel(taskId)?.syncHarnessFromHistory()
        return task
    }

    private async refreshRuntimeProductTaskById(taskId: string): Promise<void> {
        await this.refreshRuntimeProductTaskForTaskId(taskId)
    }

    getCachedRuntimeProductTask(taskId: string): Task | null {
        return this.runtimeProductTasks.get(taskId) ?? null
    }

    getCachedRuntimeProductOpenADETask(taskId: string): OpenADETask | null {
        const repoId = this.runtimeProductTasks.get(taskId)?.repoId ?? this.findRuntimeProductRepoIdForTask(taskId)
        if (!repoId) return null
        return this.runtimeProductStore?.getCachedTask(repoId, taskId) ?? null
    }

    findRuntimeProductRepoIdForTask(taskId: string): string | null {
        for (const repo of this.runtimeProductSnapshot?.repos ?? []) {
            if (repo.tasks.some((task) => task.id === taskId)) return repo.id
        }
        return null
    }

    hasRuntimeProductTaskReference(taskId: string): boolean {
        return this.runtimeProductSnapshot !== null && this.findRuntimeProductRepoIdForTask(taskId) !== null
    }

    shouldUseRuntimeProductReads(): boolean {
        return this.runtimeProductSnapshot !== null
    }

    shouldUseDesktopSharedTaskScreen(): boolean {
        const enabled = this.config.enableDesktopSharedTaskScreen ?? isDesktopSharedTaskScreenEnabled
        return enabled && this.shouldUseRuntimeProductReads()
    }

    getRuntimeProductProject(repoId: string): OpenADEProject | null {
        return this.runtimeProductSnapshot?.repos.find((repo) => repo.id === repoId) ?? null
    }

    getRuntimeProductTaskPreviewDto(repoId: string, taskId: string): OpenADETaskPreview | null {
        return this.runtimeProductTaskPreview(repoId, taskId) ?? null
    }

    getRuntimeProductTaskPreviews(repoId: string): TaskPreview[] | null {
        const project = this.getRuntimeProductProject(repoId)
        return project ? project.tasks.map(toRuntimeTaskPreview) : null
    }

    getTaskPreviewsForRepo(repoId: string): TaskPreview[] {
        const runtimePreviews = this.getRuntimeProductTaskPreviews(repoId)
        if (runtimePreviews) return runtimePreviews

        const legacyPreviews = this.repoStore?.repos.get(repoId)?.tasks ?? []
        if (legacyPreviews.length > 0) {
            this.trackRuntimeProductFallback("task_previews", this.runtimeProductSnapshot ? "runtime_repo_missing" : "snapshot_unavailable")
        }
        return legacyPreviews
    }

    private async handleRuntimeProductStoreNotification(notification: RuntimeNotification): Promise<void> {
        if (!this.runtimeProductStore) return

        try {
            await this.runtimeProductStore.handleNotification(notification)
            runInAction(() => {
                this.runtimeProductSnapshot = this.runtimeProductStore?.snapshot ?? null
                if (this.runtimeProductSnapshot) this.pruneRuntimeProductTasks(this.runtimeProductSnapshot)
                const params = notificationRecord(notification)
                const repoId = typeof params.repoId === "string" ? params.repoId : null
                const taskId = typeof params.taskId === "string" ? params.taskId : null
                if (notification.method === "openade/task/deleted" && taskId) {
                    this.runtimeProductTasks.delete(taskId)
                } else if (repoId && taskId) {
                    const task = this.runtimeProductStore?.getCachedTask(repoId, taskId)
                    if (task) this.cacheRuntimeProductTask(task)
                }
                if (this.runtimeProductStoreStatus !== "loading") this.runtimeProductStoreStatus = "ready"
                this.runtimeProductStoreError = null
            })
        } catch (err) {
            const message = this.runtimeProductErrorMessage(err)
            runInAction(() => {
                this.runtimeProductStoreStatus = "error"
                this.runtimeProductStoreError = message
            })
            this.trackRuntimeProductStoreError("notification", err)
            console.warn("[CodeStore] Failed to refresh runtime product store from notification:", err)
        }
    }

    private async notifyRuntimeTaskSettled(taskId: string): Promise<void> {
        await this.refreshTaskStoreFromStorage(taskId)
        const events = this.tasks.getTask(taskId)?.events ?? []
        for (let index = events.length - 1; index >= 0; index--) {
            const event = events[index]
            if (event.type !== "action") continue
            if (event.status !== "completed" && event.status !== "error" && event.status !== "stopped") continue
            this.execution.notifyAfterEvent(taskId, event.source.type, event.status === "completed" && event.result?.success !== false)
            return
        }
    }

    private async initializeAnalytics(personalSettings: PersonalSettingsStore): Promise<void> {
        const settings = personalSettings.settings.get()
        const deviceConfig = await getDeviceConfig()
        const settingsDeviceId = settings?.deviceId?.trim() || null
        const localStorageDeviceId = getLocalAnalyticsDeviceIdBackup()
        const backupDeviceId = settingsDeviceId ?? localStorageDeviceId
        const backupSource: AnalyticsDeviceIdSource | null = settingsDeviceId
            ? "personal_settings_backup"
            : localStorageDeviceId
              ? "local_storage_backup"
              : null
        let deviceId: string
        let deviceIdSource: AnalyticsDeviceIdSource

        if (deviceConfig) {
            if (deviceConfig.wasGenerated && backupDeviceId && backupDeviceId !== deviceConfig.deviceId) {
                deviceId = backupDeviceId
                deviceIdSource = backupSource ?? "personal_settings_backup"
                const restoredConfig = await setDeviceConfigDeviceId(deviceId)
                if (!restoredConfig) {
                    console.warn("[Analytics] Failed to restore device ID from backup; using backup for renderer analytics")
                }
            } else {
                deviceId = deviceConfig.deviceId
                deviceIdSource = deviceConfig.wasGenerated ? "device_config_generated" : "device_config_existing"
            }
        } else {
            if (backupDeviceId) {
                deviceId = backupDeviceId
                deviceIdSource = backupSource === "local_storage_backup" ? "local_storage" : "personal_settings"
            } else {
                deviceId = crypto.randomUUID()
                deviceIdSource = "generated"
            }
        }

        if (settings?.deviceId !== deviceId) {
            personalSettings.settings.set({ deviceId })
        }
        setLocalAnalyticsDeviceIdBackup(deviceId)

        analytics.init(deviceId)

        const telemetryDisabled = settings?.telemetryDisabled ?? false
        analytics.setEnabled(!telemetryDisabled)
        track("app_opened", {
            deviceIdSource,
            deviceConfigWasGenerated: deviceConfig?.wasGenerated ?? false,
            deviceConfigReadFailed: deviceConfig?.readFailed ?? false,
            runtimeProductStoreEnabled: this.shouldEnableRuntimeProductStore(),
            runtimeProductStoreStatus: this.runtimeProductStoreStatus,
            runtimeProductStoreHasSnapshot: this.runtimeProductSnapshot !== null,
            desktopSharedTaskScreenEnabled: this.config.enableDesktopSharedTaskScreen ?? isDesktopSharedTaskScreenEnabled,
        })

        this.telemetryReactionDisposer = reaction(
            () => this.personalSettingsStore?.settings.get()?.telemetryDisabled,
            (disabled) => {
                // Track before toggling so the event is sent while analytics is still active
                track(disabled ? "telemetry_disabled" : "telemetry_enabled")
                analytics.setEnabled(!disabled)
                setTelemetryDisabled(disabled ?? false)
            }
        )

        const PING_INTERVAL_MS = 12 * 60 * 60 * 1000
        this.pingIntervalId = setInterval(() => {
            track("ping")
        }, PING_INTERVAL_MS)

        // Track when the user returns to the app after being away for >30s
        const FOCUS_DEBOUNCE_MS = 30 * 1000
        let lastBlurTime = 0
        this.blurHandler = () => {
            lastBlurTime = Date.now()
        }
        this.focusHandler = () => {
            if (lastBlurTime > 0 && Date.now() - lastBlurTime > FOCUS_DEBOUNCE_MS) {
                track("app_focused")
            }
        }
        window.addEventListener("blur", this.blurHandler)
        window.addEventListener("focus", this.focusHandler)
    }

    async getTaskStore(repoId: string, taskId: string, options?: { allowUninitialized?: boolean }): Promise<TaskStore> {
        if (this.shouldEnableRuntimeProductStore()) {
            this.trackRuntimeProductFallback("task_store", this.runtimeProductSnapshot ? "direct_task_store_read" : "snapshot_unavailable")
        }

        const cached = this.taskStoreConnections.get(taskId)
        if (cached) {
            const meta = cached.store.meta.current
            if (!options?.allowUninitialized && meta.id !== taskId) {
                this.disconnectTaskStore(taskId)
                throw new Error(`Task document ${taskId} is missing or has mismatched metadata id ${meta.id || "<empty>"}`)
            }
            return cached.store
        }

        if (!this.repoStore) {
            throw new Error("RepoStore not initialized")
        }

        const preview = getTaskPreview(this.repoStore, repoId, taskId)
        if (!preview) {
            throw new Error(`Task ${taskId} not found in repo ${repoId}`)
        }

        const connection = await loadTaskStore({
            taskId,
        })

        const meta = connection.store.meta.current
        if (!options?.allowUninitialized && meta.id !== taskId) {
            connection.disconnect()
            throw new Error(`Task document ${taskId} is missing or has mismatched metadata id ${meta.id || "<empty>"}`)
        }

        this.taskStoreConnections.set(taskId, connection)

        return connection.store
    }

    async backfillTaskUsagePreview(repoId: string, taskId: string): Promise<void> {
        if (!this.repoStore) {
            throw new Error("RepoStore not initialized")
        }

        const preview = getTaskPreview(this.repoStore, repoId, taskId)
        if (!preview || !needsTaskUsageBackfill(preview.usage)) return

        const cached = this.taskStoreConnections.get(taskId)
        if (cached) {
            if (cached.store.meta.current.id === taskId) {
                await localOpenADEClient.updateTaskMetadata({ taskId, usage: computeTaskUsage(cached.store.events.all()) })
                await this.refreshRepoStoreFromStorage()
            } else {
                await localOpenADEClient.updateTaskMetadata({ taskId, usage: normalizeTaskPreviewUsage(preview.usage) })
                await this.refreshRepoStoreFromStorage()
                this.disconnectTaskStore(taskId)
            }
            return
        }

        const connection = await loadTaskStore({ taskId })
        try {
            if (connection.store.meta.current.id === taskId) {
                await localOpenADEClient.updateTaskMetadata({ taskId, usage: computeTaskUsage(connection.store.events.all()) })
            } else {
                await localOpenADEClient.updateTaskMetadata({ taskId, usage: normalizeTaskPreviewUsage(preview.usage) })
            }
            await this.refreshRepoStoreFromStorage()
        } finally {
            if (!this.taskStoreConnections.has(taskId)) {
                connection.disconnect()
            }
        }
    }

    getCachedTaskStore(taskId: string): TaskStore | null {
        return this.taskStoreConnections.get(taskId)?.store ?? null
    }

    disconnectTaskStore(taskId: string): void {
        const connection = this.taskStoreConnections.get(taskId)
        if (connection) {
            connection.disconnect()
            this.taskStoreConnections.delete(taskId)
        }
    }

    async syncRepoStore(): Promise<void> {
        if (this.repoStoreConnection) {
            await this.repoStoreConnection.sync()
        }
    }

    async refreshRepoStoreFromStorage(): Promise<void> {
        await this.repoStoreConnection?.refresh()
        if (this.shouldUseRuntimeProductReads()) {
            await this.refreshRuntimeProductSnapshot()
        }
    }

    async refreshTaskStoreFromStorage(taskId: string): Promise<void> {
        const connection = this.taskStoreConnections.get(taskId)
        if (connection) {
            const refreshed = await connection.refresh()
            if (!refreshed) {
                this.disconnectTaskStore(taskId)
                await this.refreshRuntimeProductTaskById(taskId)
                return
            }
            const model = this.tasks.getTaskModel(taskId)
            model?.syncHarnessFromHistory()
        }
        await this.refreshRuntimeProductTaskById(taskId)
    }

    async refreshProductStateAfterTaskMutation(taskId: string): Promise<void> {
        if (this.shouldUseRuntimeProductReads()) {
            await Promise.all([this.refreshRuntimeProductSnapshot(), this.refreshRuntimeProductTaskForTaskId(taskId)])
            return
        }

        await this.refreshTaskStoreFromStorage(taskId)
        await this.refreshRepoStoreFromStorage()
    }

    async refreshProductStateAfterTaskCreation(repoId: string, taskId: string): Promise<void> {
        if (this.shouldUseRuntimeProductReads()) {
            await this.refreshRuntimeProductSnapshot()
            await this.getRuntimeProductTask(repoId, taskId)
            return
        }

        await this.refreshRepoStoreFromStorage()
        await this.getTaskStore(repoId, taskId)
    }

    async refreshProductStateAfterTaskDeletion(taskId: string): Promise<void> {
        this.disconnectTaskStore(taskId)

        if (this.shouldUseRuntimeProductReads()) {
            runInAction(() => {
                this.runtimeProductTasks.delete(taskId)
            })
            await this.refreshRuntimeProductSnapshot()
            return
        }

        await this.refreshRepoStoreFromStorage()
    }

    async loadProductTaskForRead(repoId: string, taskId: string): Promise<Task | null> {
        const cached = this.tasks.getTask(taskId)
        if (cached) return cached

        if (this.shouldUseRuntimeProductReads()) {
            return this.loadRuntimeProductTask(repoId, taskId)
        }

        const taskStore = await this.getTaskStore(repoId, taskId)
        return taskFromStore(taskStore)
    }

    async reloadRepoStoreFromStorage(): Promise<void> {
        if (this.repoStoreConnection) {
            await this.repoStoreConnection.sync()
            this.repoStoreConnection.disconnect()
        }

        const repoConnection = await connectRepoStore()
        await repoConnection.sync()

        runInAction(() => {
            this.repoStoreConnection = repoConnection
            this.repoStore = repoConnection.store
        })
    }

    disconnectAllStores(): void {
        for (const connection of this.taskStoreConnections.values()) {
            connection.disconnect()
        }
        this.taskStoreConnections.clear()

        if (this.runtimeNotificationDisposer) {
            this.runtimeNotificationDisposer()
            this.runtimeNotificationDisposer = null
        }

        if (this.repoStoreConnection) {
            this.repoStoreConnection.disconnect()
            this.repoStoreConnection = null
            this.repoStore = null
        }

        if (this.mcpServerStoreConnection) {
            this.mcpServerStoreConnection.disconnect()
            this.mcpServerStoreConnection = null
            this.mcpServerStore = null
        }

        if (this.personalSettingsStoreConnection) {
            this.personalSettingsStoreConnection.disconnect()
            this.personalSettingsStoreConnection = null
            this.personalSettingsStore = null
        }

        this.scratchpads.disconnectAll()
        this.runtimes.clear()
        this.queuedTurns.clear()
        this.runtimeProductStore?.destroy()
        this.runtimeProductStore = null
        this.runtimeProductSnapshot = null
        this.runtimeProductTasks.clear()
        this.trackedRuntimeProductFallbackKeys.clear()
        this.runtimeProductStoreStatus = "disabled"
        this.runtimeProductStoreError = null

        if (this.envVarsReactionDisposer) {
            this.envVarsReactionDisposer()
            this.envVarsReactionDisposer = null
        }

        if (this.telemetryReactionDisposer) {
            this.telemetryReactionDisposer()
            this.telemetryReactionDisposer = null
        }

        if (this.pingIntervalId) {
            clearInterval(this.pingIntervalId)
            this.pingIntervalId = null
        }

        if (this.blurHandler) {
            window.removeEventListener("blur", this.blurHandler)
            this.blurHandler = null
        }
        if (this.focusHandler) {
            window.removeEventListener("focus", this.focusHandler)
            this.focusHandler = null
        }

        this.crons.stop()
        this.mcpServers.dispose()
        this.storeInitialized = false
    }

    get isWorking(): boolean {
        return this.runtimes.hasRunningTasks
    }

    get currentUser(): User {
        return this.config.getCurrentUser()
    }

    isTaskRunning(taskId: string): boolean {
        return this.runtimes.isTaskRunning(taskId)
    }

    private persistNewTaskAgentDefaults(): void {
        this.personalSettingsStore?.settings.set({
            newTaskHarnessId: this.defaultHarnessId,
            newTaskModelId: this.defaultModel,
        })
    }

    setDefaultModel(modelId: string): void {
        this.defaultModel = modelId
        this.persistNewTaskAgentDefaults()
    }

    setDefaultThinking(level: ThinkingLevel): void {
        this.defaultThinking = level
    }

    setDefaultFastMode(enabled: boolean): void {
        this.defaultFastMode = enabled
    }

    setDefaultHarnessId(harnessId: HarnessId): void {
        this.defaultHarnessId = harnessId
        // Reset default model to match the new harness
        this.defaultModel = getDefaultModelForHarness(harnessId)
        this.persistNewTaskAgentDefaults()
    }

    // === HyperPlan Strategy Resolution ===

    /**
     * Resolve the active HyperPlan strategy from persisted preferences.
     * Falls back to Standard (single-agent) if no preference is set.
     */
    getActiveHyperPlanStrategy(): HyperPlanStrategy {
        const settings = this.personalSettingsStore?.settings.get()
        const strategyId = settings?.hyperplanStrategyId ?? "standard"

        const agents: AgentCouplet[] = settings?.hyperplanAgents?.map((a) => ({
            harnessId: a.harnessId as HarnessId,
            modelId: a.modelId,
        })) ?? [{ harnessId: this.defaultHarnessId, modelId: this.defaultModel }]

        const reconciler: AgentCouplet = settings?.hyperplanReconciler
            ? { harnessId: settings.hyperplanReconciler.harnessId as HarnessId, modelId: settings.hyperplanReconciler.modelId }
            : agents[0]

        switch (strategyId) {
            case "peer-review":
                if (agents.length < 2) return standardStrategy(agents[0])
                return peerReviewStrategy(agents[0], agents[1])
            case "ensemble":
                if (agents.length < 2) return standardStrategy(agents[0])
                return ensembleStrategy(agents, reconciler)
            case "cross-review":
                if (agents.length < 2) return standardStrategy(agents[0])
                return crossReviewStrategy(agents[0], agents[1], reconciler)
            default:
                return standardStrategy(agents[0])
        }
    }

    /**
     * Save HyperPlan strategy preferences.
     */
    setHyperPlanPreferences(strategyId: string, agents: AgentCouplet[], reconciler: AgentCouplet): void {
        this.personalSettingsStore?.settings.set({
            hyperplanStrategyId: strategyId,
            hyperplanAgents: agents.map((a) => ({ harnessId: a.harnessId, modelId: a.modelId })),
            hyperplanReconciler: { harnessId: reconciler.harnessId, modelId: reconciler.modelId },
        })
    }
}
