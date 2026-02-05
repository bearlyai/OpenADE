/**
 * Code Module MobX State
 *
 * This file contains the CodeStore which coordinates nested managers for code repos, tasks, and events.
 * Uses YJS-backed stores (RepoStore, TaskStore) for persistence and sync.
 *
 * Supports concurrent task execution - each task tracks its own working state.
 */

import { makeAutoObservable, reaction, runInAction } from "mobx"
import { analytics, track } from "../analytics"
import { type ClaudeModelId, DEFAULT_MODEL } from "../constants"
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
import { ContentSearchManager } from "./managers/ContentSearchManager"
import { EventManager } from "./managers/EventManager"
import { ExecutionManager } from "./managers/ExecutionManager"
import { FileBrowserManager } from "./managers/FileBrowserManager"
import { McpServerManager } from "./managers/McpServerManager"
import { NotificationManager } from "./managers/NotificationManager"
import { QueryManager } from "./managers/QueryManager"
import { RepoManager } from "./managers/RepoManager"
import { RepoProcessesManager } from "./managers/RepoProcessesManager"
import { SdkCapabilitiesManager } from "./managers/SdkCapabilitiesManager"
import { SmartEditorManagerStore } from "./managers/SmartEditorManager"
import { type CreationPhase, type TaskCreation, TaskCreationManager, type TaskCreationOptions } from "./managers/TaskCreationManager"
import { TaskManager } from "./managers/TaskManager"
// Import managers
import { UIStateManager, type ViewMode } from "./managers/UIStateManager"

// Re-export types for external use
export type { CreationPhase, TaskCreationOptions, TaskCreation, ViewMode }

export interface CodeStoreConfig {
    getCurrentUser: () => User
    navigateToTask: (workspaceId: string, taskId: string) => void
}

export class CodeStore {
    readonly config: CodeStoreConfig
    // Model configuration
    model: ClaudeModelId = DEFAULT_MODEL

    // Cross-cutting state (used by multiple managers)
    workingTaskIds: Set<string> = new Set()

    // Store state
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
    storeInitialized = false
    storeInitializing = false
    private storeInitPromise: Promise<void> | null = null

    // Nested managers
    readonly ui: UIStateManager
    readonly queries: QueryManager
    readonly repos: RepoManager
    readonly tasks: TaskManager
    readonly events: EventManager
    readonly execution: ExecutionManager
    readonly creation: TaskCreationManager
    readonly notifications: NotificationManager
    readonly comments: CommentManager
    readonly fileBrowser: FileBrowserManager
    readonly contentSearch: ContentSearchManager
    readonly repoProcesses: RepoProcessesManager
    readonly mcpServers: McpServerManager
    readonly smartEditors: SmartEditorManagerStore
    readonly sdkCapabilities: SdkCapabilitiesManager

    constructor(config: CodeStoreConfig) {
        this.config = config
        // Initialize managers (order matters for dependencies)
        this.ui = new UIStateManager()
        this.queries = new QueryManager(this)
        this.repos = new RepoManager(this)
        this.events = new EventManager(this)
        this.execution = new ExecutionManager(this)
        // TaskManager depends on ExecutionManager (subscribes to onAfterEvent)
        this.tasks = new TaskManager(this)
        this.creation = new TaskCreationManager(this)
        this.notifications = new NotificationManager(this)
        this.comments = new CommentManager(this)
        this.fileBrowser = new FileBrowserManager()
        this.contentSearch = new ContentSearchManager()
        this.repoProcesses = new RepoProcessesManager()
        this.mcpServers = new McpServerManager(this)
        this.smartEditors = new SmartEditorManagerStore()
        this.sdkCapabilities = new SdkCapabilitiesManager()

        makeAutoObservable(this, {
            workingTaskIds: true,
            repoStore: true,
            mcpServerStore: true,
            personalSettingsStore: true,
            storeInitialized: true,
            storeInitializing: true,
            ui: false, // Managers are observable themselves
            queries: false,
            repos: false,
            tasks: false,
            events: false,
            execution: false,
            creation: false,
            notifications: false,
            comments: false,
            fileBrowser: false,
            contentSearch: false,
            repoProcesses: false,
            mcpServers: false,
            smartEditors: false,
            sdkCapabilities: false,
        })
    }

    // ==================== Store Initialization ====================

    /**
     * Initialize stores (RepoStore + McpServerStore).
     * Call this before accessing repos/tasks/mcp servers.
     */
    async initializeStores(): Promise<void> {
        // If already initialized, return immediately
        if (this.storeInitialized) return

        // If initialization is in progress, wait for it
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
            // Connect to RepoStore, McpServerStore, and PersonalSettingsStore in parallel
            const [repoConnection, mcpConnection, personalSettingsConnection] = await Promise.all([
                connectRepoStore(),
                connectMcpServerStore(),
                connectPersonalSettingsStore(),
            ])

            // Wait for initial sync
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

            // Push initial env vars to Electron subprocess module
            const initialEnvVars = personalSettingsConnection.store.settings.get()?.envVars
            if (initialEnvVars && Object.keys(initialEnvVars).length > 0) {
                setGlobalEnv(initialEnvVars).catch((err) => {
                    console.error("[CodeStore] Failed to push initial env vars:", err)
                })
            }

            // Set up reaction to push env vars when they change
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

            // Initialize analytics
            this.initializeAnalytics(personalSettingsConnection.store)
        } catch (err) {
            console.error("[CodeStore] Failed to initialize stores:", err)
            runInAction(() => {
                this.storeInitializing = false
            })
            throw err
        }
    }

    /**
     * Initialize analytics with device ID and telemetry preference.
     * Fetches device config from main process to ensure consistent device ID
     * across main process (Sentry) and renderer (Amplitude + Sentry).
     */
    private async initializeAnalytics(personalSettings: PersonalSettingsStore): Promise<void> {
        const settings = personalSettings.settings.get()

        // Get device config from main process (single source of truth for device ID)
        const deviceConfig = await getDeviceConfig()
        let deviceId: string

        if (deviceConfig) {
            deviceId = deviceConfig.deviceId
            // Sync device ID to YJS settings if different
            if (settings?.deviceId !== deviceId) {
                personalSettings.settings.set({ deviceId })
            }
        } else {
            // Fallback: generate device ID if not running in Electron
            deviceId = settings?.deviceId ?? crypto.randomUUID()
            if (!settings?.deviceId) {
                personalSettings.settings.set({ deviceId })
            }
        }

        // Initialize analytics with device ID
        analytics.init(deviceId)

        // Set initial enabled state (enabled by default, unless telemetryDisabled is true)
        const telemetryDisabled = settings?.telemetryDisabled ?? false
        analytics.setEnabled(!telemetryDisabled)

        // Track app opened event
        track("app_opened")

        // Set up reaction to sync telemetry toggle changes
        this.telemetryReactionDisposer = reaction(
            () => this.personalSettingsStore?.settings.get()?.telemetryDisabled,
            (disabled) => {
                analytics.setEnabled(!disabled)
                // Sync to device.json for main process
                setTelemetryDisabled(disabled ?? false)
            }
        )

        // Start ping interval (every 10 minutes)
        const PING_INTERVAL_MS = 10 * 60 * 1000
        this.pingIntervalId = setInterval(() => {
            track("ping", { focused: document.hasFocus() })
        }, PING_INTERVAL_MS)
    }

    // ==================== TaskStore Management ====================

    /**
     * Get a TaskStore for a task, loading it if not cached.
     * The TaskStore is cached for the lifetime of this CodeStore.
     */
    async getTaskStore(repoId: string, taskId: string): Promise<TaskStore> {
        // Return cached if available
        const cached = this.taskStoreConnections.get(taskId)
        if (cached) {
            return cached.store
        }

        // Load from RepoStore using room ticket
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

        // Sync preview from TaskStore (in case TaskStore has newer data)
        syncTaskPreviewFromStore(this.repoStore, repoId, connection.store)

        return connection.store
    }

    /**
     * Get a cached TaskStore synchronously.
     * Returns null if not loaded yet.
     */
    getCachedTaskStore(taskId: string): TaskStore | null {
        return this.taskStoreConnections.get(taskId)?.store ?? null
    }

    /**
     * Disconnect a specific TaskStore.
     */
    disconnectTaskStore(taskId: string): void {
        const connection = this.taskStoreConnections.get(taskId)
        if (connection) {
            connection.disconnect()
            this.taskStoreConnections.delete(taskId)
        }
    }

    /**
     * Force an immediate sync of the RepoStore to disk.
     * Use this before actions that might interrupt the debounced save (e.g., page reload).
     */
    async syncRepoStore(): Promise<void> {
        if (this.repoStoreConnection) {
            await this.repoStoreConnection.sync()
        }
    }

    /**
     * Disconnect all stores (cleanup on unmount).
     */
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

        // Dispose env vars reaction
        if (this.envVarsReactionDisposer) {
            this.envVarsReactionDisposer()
            this.envVarsReactionDisposer = null
        }

        // Dispose telemetry reaction
        if (this.telemetryReactionDisposer) {
            this.telemetryReactionDisposer()
            this.telemetryReactionDisposer = null
        }

        // Stop ping interval
        if (this.pingIntervalId) {
            clearInterval(this.pingIntervalId)
            this.pingIntervalId = null
        }

        // Cleanup manager resources
        this.mcpServers.dispose()

        this.storeInitialized = false
    }

    // ==================== Cross-cutting computed ====================

    get isWorking(): boolean {
        return this.workingTaskIds.size > 0
    }

    get currentUser(): User {
        return this.config.getCurrentUser()
    }

    // ==================== Cross-cutting working state ====================

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

    // ==================== Model Configuration ====================

    setModel(modelId: ClaudeModelId): void {
        this.model = modelId
    }
}
