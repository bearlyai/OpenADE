import { makeAutoObservable, reaction, runInAction } from "mobx"
import { analytics, track } from "../analytics"
import { DEFAULT_MODEL, getDefaultModelForHarness } from "../constants"
import { getDeviceConfig, setDeviceId as setDeviceConfigDeviceId, setTelemetryDisabled } from "../electronAPI/deviceConfig"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { setGlobalEnv } from "../electronAPI/subprocess"
import { crossReviewStrategy, ensembleStrategy, peerReviewStrategy, standardStrategy } from "../hyperplan/strategies"
import type { AgentCouplet, HyperPlanStrategy } from "../hyperplan/types"
import type { McpServerStore } from "../persistence/mcpServerStore"
import { type McpServerStoreConnection, connectMcpServerStore } from "../persistence/mcpServerStoreBootstrap"
import type { PersonalSettingsStore } from "../persistence/personalSettingsStore"
import { type PersonalSettingsStoreConnection, connectPersonalSettingsStore } from "../persistence/personalSettingsStoreBootstrap"
import { type RepoStore, getTaskPreview } from "../persistence/repoStore"
import { type RepoStoreConnection, connectRepoStore } from "../persistence/repoStoreBootstrap"
import { type TaskStoreConnection, loadTaskStore } from "../persistence/taskLoader"
import { computeTaskUsage, needsTaskUsageBackfill, normalizeTaskPreviewUsage } from "../persistence/taskStatsUtils"
import type { TaskStore } from "../persistence/taskStore"
import type { RuntimeNotification } from "../../../runtime-protocol/src"
import type { User } from "../types"
import { localRuntimeClient } from "../runtime/localRuntimeClient"
import { localOpenADEClient } from "../runtime/localOpenADEClient"
import type { ThinkingLevel } from "./TaskModel"

import { CommentManager } from "./managers/CommentManager"
import { CronManager } from "./managers/CronManager"
import { EventManager } from "./managers/EventManager"
import { ExecutionManager } from "./managers/ExecutionManager"
import { McpServerManager } from "./managers/McpServerManager"
import { NotificationManager } from "./managers/NotificationManager"
import { QueryManager } from "./managers/QueryManager"
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
}

const ANALYTICS_DEVICE_ID_BACKUP_KEY = "openade-analytics-device-id"

type AnalyticsDeviceIdSource =
    | "device_config_existing"
    | "device_config_generated"
    | "personal_settings_backup"
    | "local_storage_backup"
    | "personal_settings"
    | "local_storage"
    | "generated"

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
    defaultHarnessId: HarnessId = "claude-code"

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
    private telemetryReactionDisposer: (() => void) | null = null
    private pingIntervalId: ReturnType<typeof setInterval> | null = null
    private focusHandler: (() => void) | null = null
    private blurHandler: (() => void) | null = null
    storeInitialized = false
    storeInitializing = false
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
        this.crons = new CronManager(this)
        this.repeat = new RepeatManager(this)
        this.scratchpads = new ScratchpadManager()

        makeAutoObservable(this, {
            repoStore: true,
            mcpServerStore: true,
            personalSettingsStore: true,
            storeInitialized: true,
            storeInitializing: true,
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

            runInAction(() => {
                this.repoStoreConnection = repoConnection
                this.repoStore = repoConnection.store
                this.mcpServerStoreConnection = mcpConnection
                this.mcpServerStore = mcpConnection.store
                this.personalSettingsStoreConnection = personalSettingsConnection
                this.personalSettingsStore = personalSettingsConnection.store
                this.storeInitialized = true
                this.storeInitializing = false
            })

            this.runtimeNotificationDisposer?.()
            this.runtimeNotificationDisposer = this.subscribeToRuntimeNotifications()
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

    private subscribeToRuntimeNotifications(): (() => void) | null {
        if (typeof window === "undefined" || !window.openadeAPI?.runtime) return null

        return localRuntimeClient.subscribe((notification) => {
            this.runtimeRefreshQueue = this.runtimeRefreshQueue
                .then(() => this.handleRuntimeNotification(notification))
                .catch((err) => {
                    console.warn("[CodeStore] Failed to refresh from runtime notification:", err)
                })
        })
    }

    private async handleRuntimeNotification(notification: RuntimeNotification): Promise<void> {
        const params = typeof notification.params === "object" && notification.params !== null ? (notification.params as Record<string, unknown>) : {}

        const settledTaskIds = this.runtimes.applyNotification(notification)
        for (const taskId of settledTaskIds) {
            await this.notifyRuntimeTaskSettled(taskId)
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

    private async notifyRuntimeTaskSettled(taskId: string): Promise<void> {
        await this.refreshTaskStoreFromStorage(taskId)
        const events = this.getCachedTaskStore(taskId)?.events.all() ?? []
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
    }

    async refreshTaskStoreFromStorage(taskId: string): Promise<void> {
        const connection = this.taskStoreConnections.get(taskId)
        if (!connection) return
        const refreshed = await connection.refresh()
        if (!refreshed) {
            this.disconnectTaskStore(taskId)
            return
        }
        const model = this.tasks.getTaskModel(taskId)
        model?.invalidateEnvironmentCache()
        model?.syncHarnessFromHistory()
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

    setDefaultModel(modelId: string): void {
        this.defaultModel = modelId
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
