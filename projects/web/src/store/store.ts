import { makeAutoObservable, reaction, runInAction } from "mobx"
import { analytics, track } from "../analytics"
import { DEFAULT_MODEL, getDefaultModelForHarness } from "../constants"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { crossReviewStrategy, ensembleStrategy, standardStrategy } from "../hyperplan/strategies"
import type { AgentCouplet, HyperPlanStrategy } from "../hyperplan/types"
import { getDeviceConfig, setTelemetryDisabled } from "../electronAPI/deviceConfig"
import { setGlobalEnv } from "../electronAPI/subprocess"
import type { McpServerStore } from "../persistence/mcpServerStore"
import { type McpServerStoreConnection, connectMcpServerStore } from "../persistence/mcpServerStoreBootstrap"
import type { PersonalSettingsStore } from "../persistence/personalSettingsStore"
import { type PersonalSettingsStoreConnection, connectPersonalSettingsStore } from "../persistence/personalSettingsStoreBootstrap"
import { type RepoStore, getTaskPreview } from "../persistence/repoStore"
import { type RepoStoreConnection, connectRepoStore } from "../persistence/repoStoreBootstrap"
import { type TaskStoreConnection, loadTaskStore } from "../persistence/taskLoader"
import { type TaskStore, syncTaskPreviewFromStore } from "../persistence/taskStore"
import type { User } from "../types"

import { CommentManager } from "./managers/CommentManager"
import { EventManager } from "./managers/EventManager"
import { ExecutionManager } from "./managers/ExecutionManager"
import { McpServerManager } from "./managers/McpServerManager"
import { NotificationManager } from "./managers/NotificationManager"
import { QueryManager } from "./managers/QueryManager"
import { RepoManager } from "./managers/RepoManager"
import { RepoProcessesManager } from "./managers/RepoProcessesManager"
import { SmartEditorManagerStore } from "./managers/SmartEditorManager"
import { type CreationPhase, type TaskCreation, TaskCreationManager, type TaskCreationOptions } from "./managers/TaskCreationManager"
import { TaskManager } from "./managers/TaskManager"
import { UIStateManager, type ViewMode } from "./managers/UIStateManager"

export type { CreationPhase, TaskCreationOptions, TaskCreation, ViewMode }

export interface CodeStoreConfig {
    getCurrentUser: () => User
    navigateToTask: (workspaceId: string, taskId: string) => void
}

export class CodeStore {
    readonly config: CodeStoreConfig
    defaultModel: string = DEFAULT_MODEL
    defaultHarnessId: HarnessId = "claude-code"
    workingTaskIds: Set<string> = new Set()

    repoStore: RepoStore | null = null
    mcpServerStore: McpServerStore | null = null
    personalSettingsStore: PersonalSettingsStore | null = null
    private repoStoreConnection: RepoStoreConnection | null = null
    private mcpServerStoreConnection: McpServerStoreConnection | null = null
    private personalSettingsStoreConnection: PersonalSettingsStoreConnection | null = null
    private taskStoreConnections: Map<string, TaskStoreConnection> = new Map()
    private envVarsReactionDisposer: (() => void) | null = null
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

        makeAutoObservable(this, {
            workingTaskIds: true,
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

    private async initializeAnalytics(personalSettings: PersonalSettingsStore): Promise<void> {
        const settings = personalSettings.settings.get()
        const deviceConfig = await getDeviceConfig()
        let deviceId: string

        if (deviceConfig) {
            deviceId = deviceConfig.deviceId
            if (settings?.deviceId !== deviceId) {
                personalSettings.settings.set({ deviceId })
            }
        } else {
            deviceId = settings?.deviceId ?? crypto.randomUUID()
            if (!settings?.deviceId) {
                personalSettings.settings.set({ deviceId })
            }
        }

        analytics.init(deviceId)

        const telemetryDisabled = settings?.telemetryDisabled ?? false
        analytics.setEnabled(!telemetryDisabled)
        track("app_opened")

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

    async getTaskStore(repoId: string, taskId: string): Promise<TaskStore> {
        const cached = this.taskStoreConnections.get(taskId)
        if (cached) {
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
        await connection.sync()

        this.taskStoreConnections.set(taskId, connection)
        syncTaskPreviewFromStore(this.repoStore, repoId, connection.store)

        return connection.store
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

    disconnectAllStores(): void {
        for (const connection of this.taskStoreConnections.values()) {
            connection.disconnect()
        }
        this.taskStoreConnections.clear()

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

        this.mcpServers.dispose()
        this.storeInitialized = false
    }

    get isWorking(): boolean {
        return this.workingTaskIds.size > 0
    }

    get currentUser(): User {
        return this.config.getCurrentUser()
    }

    setTaskWorking(taskId: string, working: boolean): void {
        if (working) {
            this.workingTaskIds.add(taskId)
        } else {
            this.workingTaskIds.delete(taskId)
        }
    }

    isTaskWorking(taskId: string): boolean {
        return this.workingTaskIds.has(taskId)
    }

    setDefaultModel(modelId: string): void {
        this.defaultModel = modelId
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

        const agents: AgentCouplet[] =
            settings?.hyperplanAgents?.map((a) => ({
                harnessId: a.harnessId as HarnessId,
                modelId: a.modelId,
            })) ?? [{ harnessId: this.defaultHarnessId, modelId: this.defaultModel }]

        const reconciler: AgentCouplet = settings?.hyperplanReconciler
            ? { harnessId: settings.hyperplanReconciler.harnessId as HarnessId, modelId: settings.hyperplanReconciler.modelId }
            : agents[0]

        switch (strategyId) {
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
