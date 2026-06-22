import { makeAutoObservable, reaction, runInAction } from "mobx"
import type { OpenADECoreRuntimeEndpoint } from "../../../electron/src/preload-api"
import { OPENADE_METHOD, OPENADE_NOTIFICATION, OpenADEClient, type OpenADEMethod } from "../../../openade-client/src"
import type {
    OpenADECommentCreateRequest,
    OpenADECommentCreateResult,
    OpenADECommentDeleteRequest,
    OpenADECommentEditRequest,
    OpenADECronDefinitionsReadRequest,
    OpenADECronDefinitionsReadResult,
    OpenADECronInstallStateListResult,
    OpenADECronInstallStateReadRequest,
    OpenADECronInstallStateReadResult,
    OpenADECronInstallStateReplaceRequest,
    OpenADECronInstallStateReplaceResult,
    OpenADECronRunRequest,
    OpenADECronRunResult,
    OpenADELegacyResourcesImportRequest,
    OpenADELegacyResourcesImportResult,
    OpenADEMCPServerDeleteRequest,
    OpenADEMCPServerDeleteResult,
    OpenADEMCPServerUpsertRequest,
    OpenADEMCPServerUpsertResult,
    OpenADEMCPServersReadResult,
    OpenADEMCPServersReplaceRequest,
    OpenADEMCPServersReplaceResult,
    OpenADEProject,
    OpenADEProjectFileReadRequest,
    OpenADEProjectFileReadResult,
    OpenADEProjectFileWriteRequest,
    OpenADEProjectFileWriteResult,
    OpenADEProjectFilesFuzzySearchRequest,
    OpenADEProjectFilesFuzzySearchResult,
    OpenADEProjectFilesTreeRequest,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectGitBranchesReadRequest,
    OpenADEProjectGitBranchesReadResult,
    OpenADEProjectGitInfoRequest,
    OpenADEProjectGitInfoResult,
    OpenADEProjectGitSummaryReadRequest,
    OpenADEProjectGitSummaryReadResult,
    OpenADEProjectProcessListRequest,
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectRequest,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectProcessStartRequest,
    OpenADEProjectProcessStartResult,
    OpenADEProjectProcessStopRequest,
    OpenADEProjectProcessStopResult,
    OpenADEProjectSearchRequest,
    OpenADEProjectSearchResult,
    OpenADEProjectSdkCapabilitiesReadRequest,
    OpenADEQueuedTurnCancelRequest,
    OpenADEQueuedTurnCancelResult,
    OpenADERepoCreateRequest,
    OpenADERepoCreateResult,
    OpenADERepoDeleteRequest,
    OpenADERepoPathInspectRequest,
    OpenADERepoPathInspectResult,
    OpenADERepoUpdateRequest,
    OpenADEReviewStartRequest,
    OpenADEReviewStartResult,
    OpenADESdkCapabilities,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskChangesReadRequest,
    OpenADETaskChangesReadResult,
    OpenADETaskCreateRequest,
    OpenADETaskCreateResult,
    OpenADETaskDeleteRequest,
    OpenADETaskDeleteResult,
    OpenADETaskDiffReadRequest,
    OpenADETaskDiffReadResult,
    OpenADETaskEnvironmentPrepareRequest,
    OpenADETaskEnvironmentPrepareResult,
    OpenADETaskEnvironmentSetupRequest,
    OpenADETaskFilePairReadRequest,
    OpenADETaskFilePairReadResult,
    OpenADETaskGitCommitFilePatchRequest,
    OpenADETaskGitCommitFilePatchResult,
    OpenADETaskGitCommitFilesRequest,
    OpenADETaskGitCommitFilesResult,
    OpenADETaskGitFileAtTreeishRequest,
    OpenADETaskGitFileAtTreeishResult,
    OpenADETaskGitLogRequest,
    OpenADETaskGitLogResult,
    OpenADETaskGitScopesReadRequest,
    OpenADETaskGitScopesReadResult,
    OpenADETaskGitSummaryRequest,
    OpenADETaskGitSummaryResult,
    OpenADETaskImageReadRequest,
    OpenADETaskImageReadResult,
    OpenADETaskImageStagedReadRequest,
    OpenADETaskImageStagedReadResult,
    OpenADETaskMetadataUpdateRequest,
    OpenADETaskPreview,
    OpenADETaskReadOptions,
    OpenADETaskResourceInventoryReadRequest,
    OpenADETaskResourceInventoryReadResult,
    OpenADETaskSnapshotIndexReadRequest,
    OpenADETaskSnapshotIndexReadResult,
    OpenADETaskSnapshotPatchReadRequest,
    OpenADETaskSnapshotPatchReadResult,
    OpenADETaskSnapshotPatchSliceReadRequest,
    OpenADETaskSnapshotPatchSliceReadResult,
    OpenADETaskTerminalMutationResult,
    OpenADETaskTerminalReconnectRequest,
    OpenADETaskTerminalReconnectResult,
    OpenADETaskTerminalResizeRequest,
    OpenADETaskTerminalStartRequest,
    OpenADETaskTerminalStartResult,
    OpenADETaskTerminalStopRequest,
    OpenADETaskTerminalWriteRequest,
    OpenADETaskTitleGenerateRequest,
    OpenADETaskTitleGenerateResult,
    OpenADETurnStartRequest,
    OpenADETurnStartResult,
} from "../../../openade-module/src"
import { createOpenADEYjsProjection } from "../../../openade-module/src/yjsProjection"
import { RuntimeClientError } from "../../../runtime-client/src"
import type { RuntimeNotification, RuntimeRecord } from "../../../runtime-protocol/src"
import { analytics, track } from "../analytics"
import { DEFAULT_HARNESS_ID, DEFAULT_MODEL, MODEL_REGISTRY, getDefaultModelForHarness } from "../constants"
import { getDeviceConfig, setDeviceId as setDeviceConfigDeviceId, setTelemetryDisabled } from "../electronAPI/deviceConfig"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { setGlobalEnv } from "../electronAPI/subprocess"
import { isRuntimeBackedProductStoreEnabled } from "../featureFlags"
import { crossReviewStrategy, ensembleStrategy, peerReviewStrategy, standardStrategy } from "../hyperplan/strategies"
import type { AgentCouplet, HyperPlanStrategy } from "../hyperplan/types"
import { type OpenADEProductLegacyYjsImportReport, type OpenADEProductReadOptions, OpenADEProductStore } from "../kernel/productStore"
import { taskFromRuntimeProduct } from "../kernel/taskAdapter"
import type { McpServerStore } from "../persistence/mcpServerStore"
import { type McpServerStoreConnection, connectMcpServerStore, createEphemeralMcpServerStoreConnection } from "../persistence/mcpServerStoreBootstrap"
import type { PersonalSettings, PersonalSettingsStore } from "../persistence/personalSettingsStore"
import {
    type PersonalSettingsStoreConnection,
    connectPersonalSettingsStore,
    connectProductPersonalSettingsStore,
} from "../persistence/personalSettingsStoreBootstrap"
import { type RepoStore, getTaskPreview } from "../persistence/repoStore"
import { type RepoStoreConnection, connectRepoStore } from "../persistence/repoStoreBootstrap"
import { createElectronOpenADEYjsStorageAdapter } from "../persistence/storage/openadeYjsStorageAdapter"
import { type TaskStoreConnection, loadTaskStore } from "../persistence/taskLoader"
import { computeTaskUsage, needsTaskUsageBackfill, normalizeTaskPreviewUsage } from "../persistence/taskStatsUtils"
import { type TaskStore, taskFromStore } from "../persistence/taskStore"
import { markCoreLegacyYjsMigrationAccepted, revokeCoreLegacyYjsMigrationAcceptance } from "../runtime/coreMigration"
import { localOpenADEClient } from "../runtime/localOpenADEClient"
import {
    createLocalProductRuntimeClient,
    localProductRuntimeNotificationSource,
    resolveCoreMigrationRuntimeEndpoint,
    resolveCoreRolloutState,
    resolveCoreRuntimeEndpoint,
    selectedLocalProductRuntime,
} from "../runtime/localProductRuntimeClient"
import type { Task, User } from "../types"
import { type ImagePersistencePayload, imagePersistencePayloadToWriteRequest, persistImageToDataFolder } from "../utils/imageAttachment"
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
import { RepoManager, projectPathFromGitInfo } from "./managers/RepoManager"
import { RepoProcessesManager } from "./managers/RepoProcessesManager"
import { RuntimeManager } from "./managers/RuntimeManager"
import { ScratchpadManager } from "./managers/ScratchpadManager"
import { SmartEditorManagerStore, type SmartEditorProductFileAccess } from "./managers/SmartEditorManager"
import { type CreationPhase, type TaskCreation, TaskCreationManager, type TaskCreationOptions } from "./managers/TaskCreationManager"
import { TaskManager } from "./managers/TaskManager"
import { UIStateManager, type ViewMode } from "./managers/UIStateManager"

export type { CreationPhase, TaskCreationOptions, TaskCreation, ViewMode }

export interface CodeStoreConfig {
    getCurrentUser: () => User
    navigateToTask: (workspaceId: string, taskId: string) => void
    enableRuntimeProductStore?: boolean
    runtimeProductStoreFactory?: () => OpenADEProductStore
    coreMigrationProductStoreFactory?: (endpoint: OpenADECoreRuntimeEndpoint) => OpenADEProductStore
    runtimeNotificationSource?: RuntimeNotificationSource
    legacyStoreConnectors?: Partial<CodeStoreLegacyStoreConnectors>
}

const ANALYTICS_DEVICE_ID_BACKUP_KEY = "openade-analytics-device-id"

export type RuntimeProductStoreStatus = "disabled" | "loading" | "ready" | "error"

const RUNTIME_TASK_UPDATE_REFRESH_DELAY_MS = 150
const RUNTIME_TASK_UPDATE_MIN_REFRESH_MS = 150
const RUNTIME_TASK_IN_PROGRESS_REFRESH_MIN_MS = 15_000
const RUNTIME_TASK_PREVIEW_MIN_REFRESH_MS = 10_000
const RUNTIME_TASK_LIGHTWEIGHT_CACHE_FRESH_MS = 15_000
const RUNTIME_TASK_SETTLED_REFRESH_MIN_MS = 2_000
const RUNTIME_TASK_SETTLED_REFRESH_DELAY_MS = RUNTIME_TASK_SETTLED_REFRESH_MIN_MS + RUNTIME_TASK_UPDATE_REFRESH_DELAY_MS
const RUNTIME_TASK_ROUTE_CACHE_FRESH_MS = 15_000
const ACCEPTED_RUNTIME_PRODUCT_MUTATION_NOTIFICATION_SUPPRESS_MS = 30_000
const SLOW_CODE_STORE_INIT_PHASE_MS = 250
const GLOBAL_RUNTIME_TASK_PREVIEW_NOTIFICATION_KEY = "\0snapshot"
const RUNTIME_TASK_PREVIEW_FALLBACK_CREATED_AT = new Date(0).toISOString()
const LIGHTWEIGHT_RUNTIME_TASK_READ_OPTIONS: OpenADETaskReadOptions = { hydrateSessionEvents: false }
const ROUTE_RUNTIME_TASK_READ_OPTIONS: OpenADETaskReadOptions = { hydrateSessionEvents: false, eventLimit: 12 }
const NOTIFICATION_RUNTIME_TASK_READ_OPTIONS: OpenADETaskReadOptions = { hydrateSessionEvents: false, eventLimit: 12 }
type RuntimeProductTaskVisibleReadMode = "route-lightweight" | "lightweight" | "hydrated"
type RuntimeProductTaskRefreshOptions = {
    allowProjectionRepair?: boolean
}
type CodeStoreInitializationPhase =
    | "total"
    | "runtime_product_store"
    | "personal_settings_sync"
    | "mcp_store_sync"
    | "legacy_repo_store_sync"
    | "mcp_product_projection"
    | "runtime_task_hydration"
    | "cron_start"
    | "env_vars_push"

function runtimeProductTaskReadKey(repoId: string, taskId: string, options: OpenADETaskReadOptions): string {
    const readMode = options.hydrateSessionEvents === true ? "hydrated" : "lightweight"
    const eventLimit = readMode === "lightweight" ? (options.eventLimit ?? "default") : "all"
    return `${repoId}\0${taskId}\0${readMode}\0${eventLimit}`
}

function runtimeProductFuzzySearchKey(params: OpenADEProjectFilesFuzzySearchRequest): string {
    return JSON.stringify({
        repoId: params.repoId,
        taskId: params.taskId ?? null,
        query: params.query,
        matchDirs: params.matchDirs === true,
        limit: params.limit ?? null,
        includeHidden: params.includeHidden === true,
        includeGenerated: params.includeGenerated === true,
    })
}

function createCodeStoreClientRequestId(): string {
    const crypto = globalThis.crypto
    if (crypto?.randomUUID) return crypto.randomUUID()
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function isLimitedRuntimeProductTaskRead(options: OpenADETaskReadOptions): boolean {
    return options.hydrateSessionEvents !== true && options.eventLimit !== undefined
}

export interface RuntimeNotificationSource {
    subscribe(listener: (notification: RuntimeNotification) => void): () => void
}

export interface CodeStoreLegacyStoreConnectors {
    connectRepoStore: () => Promise<RepoStoreConnection>
    connectMcpServerStore: () => Promise<McpServerStoreConnection>
    connectPersonalSettingsStore: () => Promise<PersonalSettingsStoreConnection>
}

function notificationRecord(notification: RuntimeNotification): Record<string, unknown> {
    return typeof notification.params === "object" && notification.params !== null && !Array.isArray(notification.params)
        ? (notification.params as Record<string, unknown>)
        : {}
}

function normalizedDirectoryPath(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+$/, "")
}

function timestampMs(value: string | undefined): number | null {
    if (!value) return null
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
}

function isRuntimeNotFoundError(error: unknown): boolean {
    return error instanceof RuntimeClientError && error.code === "not_found"
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
    private pendingRuntimeTaskUpdateNotifications: Map<string, RuntimeNotification> = new Map()
    private runtimeTaskUpdateTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
    private runtimeTaskUpdateRefreshLoadedAt: Map<string, number> = new Map()
    private pendingRuntimeTaskPreviewNotifications: Map<string, RuntimeNotification> = new Map()
    private runtimeTaskPreviewTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
    private runtimeTaskPreviewRefreshLoadedAt: Map<string, number> = new Map()
    private runtimeTaskSettledTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
    private runtimeProductStore: OpenADEProductStore | null = null
    private coreMigrationProductStoreEntry: { key: string; store: OpenADEProductStore } | null = null
    private runtimeProductInitializationInFlight: Promise<void> | null = null
    private runtimeProductDeferredTaskRefreshStore: OpenADEProductStore | null = null
    private runtimeProductDeferredTaskRefreshDisposer: (() => void) | null = null
    private runtimeProductTaskReadInFlight: Map<string, Promise<OpenADETask | null>> = new Map()
    private runtimeProductFuzzySearchInFlight: Map<string, Promise<OpenADEProjectFilesFuzzySearchResult>> = new Map()
    private runtimeProductTaskReadLoadedAt: Map<string, number> = new Map()
    private runtimeProductRouteTaskReadLoadedAt: Map<string, number> = new Map()
    private runtimeProductRouteTaskReadMisses: Set<string> = new Set()
    private runtimeProductRouteTaskReadErrors: Map<string, string> = new Map()
    private runtimeTaskRouteShellInitPromise: Promise<void> | null = null
    private runtimeTaskRouteShellInitialized = false
    private runtimeProductTaskVisibleReadMode: Map<string, RuntimeProductTaskVisibleReadMode> = new Map()
    private telemetryReactionDisposer: (() => void) | null = null
    private pingIntervalId: ReturnType<typeof setInterval> | null = null
    private focusHandler: (() => void) | null = null
    private blurHandler: (() => void) | null = null
    private trackedRuntimeProductFallbackKeys: Set<string> = new Set()
    private acceptedRuntimeProductMutationNotifications: Map<string, number> = new Map()
    storeInitialized = false
    storeInitializing = false
    runtimeProductSnapshot: OpenADESnapshot | null = null
    runtimeProductProjects: Map<string, OpenADEProject> = new Map()
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
        this.smartEditors = new SmartEditorManagerStore(this.smartEditorProductFileAccess())
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
            runtimeProductProjects: true,
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

    private smartEditorProductFileAccess(): SmartEditorProductFileAccess {
        return {
            usesRuntimeProductAPI: () => this.shouldUseRuntimeProductTaskRoute(),
            productRuntimeOwnsFiles: () => this.shouldUseRuntimeProductTaskRoute(),
            getContext: (id, workspaceId, dir) => this.getSmartEditorProductFileContext(id, workspaceId, dir),
            fuzzySearchProjectFiles: async (args) => {
                const productStore = await this.runtimeProductStoreForMethodIfAvailable(OPENADE_METHOD.projectFilesFuzzySearch)
                return productStore ? this.runRuntimeProductFuzzySearch(productStore, args) : null
            },
            readStagedTaskImage: async (args) => {
                const productStore = await this.runtimeProductStoreForMethodIfAvailable(OPENADE_METHOD.taskImageStagedRead)
                return productStore ? productStore.readStagedTaskImage(args) : null
            },
        }
    }

    private getSmartEditorProductFileContext(id: string, workspaceId: string, dir: string): { repoId: string; taskId?: string } | null {
        if (!this.shouldUseRuntimeProductTaskRoute()) return null
        if (!this.usesCoreOwnedProductRuntime() && !this.canUseProductMethod(OPENADE_METHOD.projectFilesFuzzySearch)) return null

        const normalizedDir = normalizedDirectoryPath(dir)
        if (id.startsWith("task-") && id !== "task-create") {
            const taskId = id.slice("task-".length)
            const task = this.tasks.getTask(taskId)
            const repoId = task?.repoId ?? this.findRuntimeProductRepoIdForTask(taskId)
            if (!repoId) return null
            const repo = this.repos.getRepo(repoId)

            const taskModel = this.tasks.getTaskModel(taskId)
            const taskDir = taskModel?.taskWorkingDirHint ?? null
            if (taskDir) {
                if (normalizedDirectoryPath(taskDir) !== normalizedDir) return null
            } else {
                if (task?.isolationStrategy.type === "worktree") return null
                const repoPath = repo?.path ?? this.smartEditorProjectPathFromCachedGitInfo(repoId)
                if (repoPath) {
                    if (normalizedDirectoryPath(repoPath) !== normalizedDir) return null
                } else if (repoId !== workspaceId) {
                    return null
                }
            }
            return { repoId, taskId }
        }

        const repoPath = this.repos.getRepo(workspaceId)?.path ?? this.smartEditorProjectPathFromCachedGitInfo(workspaceId)
        if (!repoPath || normalizedDirectoryPath(repoPath) !== normalizedDir) return null
        return { repoId: workspaceId }
    }

    private smartEditorProjectPathFromCachedGitInfo(workspaceId: string): string | null {
        if (!this.shouldUseRuntimeProductTaskRoute()) return null
        const gitInfo = this.repos.getGitInfoSync(workspaceId)
        return gitInfo ? projectPathFromGitInfo(gitInfo) : null
    }

    async initializeStores(): Promise<void> {
        if (this.storeInitialized) return

        if (this.storeInitializing && this.storeInitPromise) {
            return this.storeInitPromise
        }

        runInAction(() => {
            this.storeInitializing = true
        })

        const initPromise = this._doInitializeStores().catch((err: unknown) => {
            runInAction(() => {
                if (this.storeInitPromise === initPromise) {
                    this.storeInitPromise = null
                }
                this.storeInitializing = false
            })
            throw err
        })
        this.storeInitPromise = initPromise
        return this.storeInitPromise
    }

    async initializeRuntimeTaskRouteShell(): Promise<void> {
        if (this.storeInitialized) return
        if (this.runtimeTaskRouteShellInitialized) return
        if (this.storeInitializing && this.storeInitPromise) return this.storeInitPromise
        if (!this.shouldUseRuntimeProductTaskRoute()) return
        if (this.runtimeTaskRouteShellInitPromise) return this.runtimeTaskRouteShellInitPromise

        const initPromise = this.initializeRuntimeTaskRouteShellUncoalesced().finally(() => {
            if (this.runtimeTaskRouteShellInitPromise === initPromise) {
                this.runtimeTaskRouteShellInitPromise = null
            }
        })
        this.runtimeTaskRouteShellInitPromise = initPromise
        return initPromise
    }

    private async initializeRuntimeTaskRouteShellUncoalesced(): Promise<void> {
        const productStore = this.usesCoreOwnedProductRuntime()
            ? this.attachRuntimeProductStoreForCoreOwned()
            : this.runtimeProductStore ?? (this.shouldEnableRuntimeProductStore() ? this.createRuntimeProductStore() : null)
        if (!productStore) return
        if (!this.runtimeProductStore) {
            this.runtimeProductStore = productStore
            this.observeRuntimeProductStore(productStore)
            this.ensureRuntimeNotificationSubscription()
        }

        this.ensureRuntimeNotificationSubscription()
        await productStore.canUseMethodAfterConnect(OPENADE_METHOD.taskRead)
        runInAction(() => {
            this.runtimeTaskRouteShellInitialized = true
        })
    }

    private async runInitializationPhase<T>(phase: CodeStoreInitializationPhase, run: () => Promise<T> | T): Promise<T> {
        const startedAt = Date.now()
        try {
            return await run()
        } finally {
            this.recordSlowInitializationPhase(phase, startedAt)
        }
    }

    private recordSlowInitializationPhase(phase: CodeStoreInitializationPhase, startedAt: number): void {
        const durationMs = Math.max(0, Date.now() - startedAt)
        if (durationMs < SLOW_CODE_STORE_INIT_PHASE_MS) return
        console.warn("[CodeStore] Slow initialization phase", {
            phase,
            durationMs,
            runtimeProductAPI: this.shouldUseRuntimeProductAPI(),
            coreOwned: this.usesCoreOwnedProductRuntime(),
            runtimeProductStoreStatus: this.runtimeProductStoreStatus,
        })
    }

    private connectRepoStore(): Promise<RepoStoreConnection> {
        return this.config.legacyStoreConnectors?.connectRepoStore?.() ?? connectRepoStore()
    }

    private connectMcpServerStore(): Promise<McpServerStoreConnection> {
        return this.config.legacyStoreConnectors?.connectMcpServerStore?.() ?? connectMcpServerStore()
    }

    private connectEphemeralMcpServerProjectionStore(): McpServerStoreConnection {
        return createEphemeralMcpServerStoreConnection()
    }

    private connectPersonalSettingsStore(): Promise<PersonalSettingsStoreConnection> {
        if (this.runtimeProductStore && this.shouldUseRuntimeProductStoresForInitialization()) {
            const productStore = this.runtimeProductStore
            return connectProductPersonalSettingsStore({
                readPersonalSettings: () => productStore.readPersonalSettings(),
                replacePersonalSettings: (params) => productStore.replacePersonalSettings(params),
                canReadPersonalSettings: () => productStore.canUseMethod(OPENADE_METHOD.settingsPersonalRead),
                canReplacePersonalSettings: () => productStore.canUseMethod(OPENADE_METHOD.settingsPersonalReplace),
            })
        }
        return this.config.legacyStoreConnectors?.connectPersonalSettingsStore?.() ?? connectPersonalSettingsStore()
    }

    private async connectPersonalSettingsStoreForInitialization(): Promise<PersonalSettingsStoreConnection> {
        if (this.personalSettingsStoreConnection) return this.personalSettingsStoreConnection
        return this.runInitializationPhase("personal_settings_sync", async () => {
            const connection = await this.connectPersonalSettingsStore()
            await connection.sync()
            return connection
        })
    }

    private async connectRuntimeMcpStoreForInitialization(): Promise<McpServerStoreConnection> {
        if (this.mcpServerStoreConnection) return this.mcpServerStoreConnection
        const connection = this.connectEphemeralMcpServerProjectionStore()
        await this.runInitializationPhase("mcp_store_sync", () => connection.sync())
        return connection
    }

    async ensureRuntimeMcpServerProjectionStore(): Promise<void> {
        if (this.mcpServerStoreConnection) return
        if (!(this.shouldUseRuntimeProductAPI() || this.usesCoreOwnedProductRuntime())) return

        const connection = await this.connectRuntimeMcpStoreForInitialization()
        runInAction(() => {
            if (this.mcpServerStoreConnection !== connection) {
                this.mcpServerStoreConnection = connection
                this.mcpServerStore = connection.store
            } else if (!this.mcpServerStore) {
                this.mcpServerStore = connection.store
            }
        })
    }

    private shouldInitializeRuntimeProductBeforeLegacyRepoStore(): boolean {
        return this.usesCoreOwnedProductRuntime() || this.shouldEnableRuntimeProductStore()
    }

    private shouldUseRuntimeProductStoresForInitialization(): boolean {
        if (this.shouldUseRuntimeProductAPI() || this.usesCoreOwnedProductRuntime()) return true
        return this.shouldEnableRuntimeProductStore() && this.runtimeProductStore !== null
    }

    private coreRolloutOwnsProductRuntime(): boolean {
        const rolloutState = resolveCoreRolloutState()
        if (rolloutState?.status !== "connected" || rolloutState.source === "legacy-ipc") return false
        if (!resolveCoreRuntimeEndpoint() && !this.config.runtimeProductStoreFactory) return false
        return rolloutState.legacyYjsDocumentsPresent === false || rolloutState.legacyYjsMigrationAccepted === true
    }

    usesCleanManagedCoreRuntime(): boolean {
        const rolloutState = resolveCoreRolloutState()
        return this.coreRolloutOwnsProductRuntime() && rolloutState?.legacyYjsDocumentsPresent === false
    }

    usesCoreOwnedProductRuntime(): boolean {
        return this.coreRolloutOwnsProductRuntime()
    }

    shouldUseCoreOwnedCronScheduler(): boolean {
        return this.usesCoreOwnedProductRuntime()
    }

    private shouldStartRendererCronManager(): boolean {
        return !this.shouldEnableRuntimeProductStore() && !this.shouldUseRuntimeProductAPI() && !this.usesCoreOwnedProductRuntime()
    }

    private shouldPushEnvVarsToElectronHost(): boolean {
        return !this.usesCoreOwnedProductRuntime()
    }

    private async connectLegacyRepoStoreFallback(): Promise<void> {
        const repoConnection = await this.connectRepoStore()
        await repoConnection.sync()
        runInAction(() => {
            this.repoStoreConnection = repoConnection
            this.repoStore = repoConnection.store
        })
    }

    private async _doInitializeStores(): Promise<void> {
        const startedAt = Date.now()
        try {
            if (this.runtimeTaskRouteShellInitPromise) {
                await this.runtimeTaskRouteShellInitPromise
            }
            const initializeRuntimeBeforeLegacyRepoStore = this.shouldInitializeRuntimeProductBeforeLegacyRepoStore()
            if (initializeRuntimeBeforeLegacyRepoStore) {
                await this.runInitializationPhase("runtime_product_store", () => this.initializeRuntimeProductStore())
            }
            const useRuntimeProductStores = this.shouldUseRuntimeProductStoresForInitialization()
            let personalSettingsConnection: PersonalSettingsStoreConnection
            let mcpConnection: McpServerStoreConnection | null = null
            if (useRuntimeProductStores) {
                const [runtimePersonalSettingsConnection, runtimeMcpConnection] = await Promise.all([
                    this.connectPersonalSettingsStoreForInitialization(),
                    this.connectRuntimeMcpStoreForInitialization(),
                ])
                personalSettingsConnection = runtimePersonalSettingsConnection
                mcpConnection = runtimeMcpConnection
            } else {
                personalSettingsConnection = await this.connectPersonalSettingsStoreForInitialization()
            }

            const newTaskDefaults = getNewTaskAgentDefaults(personalSettingsConnection.store.settings.get())

            runInAction(() => {
                if (this.personalSettingsStoreConnection !== personalSettingsConnection) {
                    this.personalSettingsStoreConnection = personalSettingsConnection
                    this.personalSettingsStore = personalSettingsConnection.store
                } else if (!this.personalSettingsStore) {
                    this.personalSettingsStore = personalSettingsConnection.store
                }
                this.defaultHarnessId = newTaskDefaults.harnessId
                this.defaultModel = newTaskDefaults.modelId
            })

            this.resetRuntimeNotificationSubscription()
            if (!mcpConnection) {
                mcpConnection = await this.runInitializationPhase("mcp_store_sync", async () => {
                    const connection = await this.connectMcpServerStore()
                    await connection.sync()
                    return connection
                })
                await this.runInitializationPhase("legacy_repo_store_sync", () => this.connectLegacyRepoStoreFallback())
                if (!initializeRuntimeBeforeLegacyRepoStore) {
                    await this.runInitializationPhase("runtime_product_store", () => this.initializeRuntimeProductStore())
                }
            }
            runInAction(() => {
                if (this.mcpServerStoreConnection !== mcpConnection) {
                    this.mcpServerStoreConnection = mcpConnection
                    this.mcpServerStore = mcpConnection.store
                } else if (!this.mcpServerStore) {
                    this.mcpServerStore = mcpConnection.store
                }
                this.storeInitialized = true
                this.storeInitializing = false
            })
            if (!useRuntimeProductStores) {
                await this.runInitializationPhase("mcp_product_projection", () => this.mcpServers.initializeProductSettingsProjection())
            }
            const runtimeHydrationSource = this.shouldUseRuntimeProductAPI() ? this.runtimeProductStore : null
            const hydrateRuntimeTasks = () =>
                this.runInitializationPhase("runtime_task_hydration", () => this.runtimes.hydrateOpenADETasks(runtimeHydrationSource)).catch((err) => {
                    console.warn("[CodeStore] Failed to hydrate runtime state:", err)
                })
            if (this.usesCoreOwnedProductRuntime()) {
                void hydrateRuntimeTasks()
            } else {
                await hydrateRuntimeTasks()
            }

            if (this.shouldStartRendererCronManager()) {
                void this.runInitializationPhase("cron_start", () => this.crons.startAll()).catch((err) => {
                    console.error("[CodeStore] Failed to start cron manager:", err)
                })
            }

            if (this.shouldPushEnvVarsToElectronHost()) {
                const initialEnvVars = personalSettingsConnection.store.settings.get()?.envVars
                if (initialEnvVars && Object.keys(initialEnvVars).length > 0) {
                    void this.runInitializationPhase("env_vars_push", () => setGlobalEnv(initialEnvVars)).catch((err) => {
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
            }

            this.initializeAnalytics(personalSettingsConnection.store)
        } catch (err) {
            console.error("[CodeStore] Failed to initialize stores:", err)
            runInAction(() => {
                this.storeInitializing = false
            })
            throw err
        } finally {
            this.recordSlowInitializationPhase("total", startedAt)
        }
    }

    private runtimeNotificationSource(): RuntimeNotificationSource | null {
        if (this.config.runtimeNotificationSource) return this.config.runtimeNotificationSource
        if (typeof window === "undefined") return null
        if (!window.openadeAPI?.runtime && !resolveCoreRuntimeEndpoint()) return null
        return localProductRuntimeNotificationSource
    }

    private subscribeToRuntimeNotifications(): (() => void) | null {
        const source = this.runtimeNotificationSource()
        if (!source) return null

        return source.subscribe((notification) => {
            if (this.scheduleCoalescedRuntimeTaskUpdateNotification(notification)) return
            this.cancelPendingRuntimeTaskUpdateNotification(notification)
            if (this.scheduleCoalescedRuntimeTaskPreviewNotification(notification)) return
            this.cancelPendingRuntimeTaskPreviewNotification(notification)
            this.enqueueRuntimeNotification(notification)
        })
    }

    private enqueueRuntimeNotification(notification: RuntimeNotification): void {
        this.runtimeRefreshQueue = this.runtimeRefreshQueue
            .then(() => this.handleRuntimeNotification(notification))
            .catch((err) => {
                console.warn("[CodeStore] Failed to refresh from runtime notification:", err)
            })
    }

    private runtimeTaskNotificationKey(notification: RuntimeNotification): string | null {
        const params = notificationRecord(notification)
        const repoId = typeof params.repoId === "string" ? params.repoId : null
        const taskId = typeof params.taskId === "string" ? params.taskId : null
        return repoId && taskId ? `${repoId}\0${taskId}` : null
    }

    private runtimeRepoNotificationKey(notification: RuntimeNotification): string | null {
        const params = notificationRecord(notification)
        return typeof params.repoId === "string" ? params.repoId : null
    }

    private scheduleCoalescedRuntimeTaskUpdateNotification(notification: RuntimeNotification): boolean {
        if (notification.method !== OPENADE_NOTIFICATION.taskUpdated && notification.method !== OPENADE_NOTIFICATION.queuedTurnUpdated) return false
        const key = this.runtimeTaskNotificationKey(notification)
        if (!key) return false

        this.pendingRuntimeTaskUpdateNotifications.set(key, notification)
        if (this.runtimeTaskUpdateTimers.has(key)) return true

        const loadedAt = this.runtimeTaskUpdateRefreshLoadedAt.get(key) ?? 0
        const minRefreshMs = this.runtimeTaskUpdateNotificationMinRefreshMs(notification)
        const elapsedMs = Date.now() - loadedAt
        const delayMs =
            loadedAt > 0 && elapsedMs < minRefreshMs
                ? Math.max(minRefreshMs - elapsedMs, RUNTIME_TASK_UPDATE_REFRESH_DELAY_MS)
                : RUNTIME_TASK_UPDATE_REFRESH_DELAY_MS

        const timer = setTimeout(() => {
            this.runtimeTaskUpdateTimers.delete(key)
            const pending = this.pendingRuntimeTaskUpdateNotifications.get(key)
            this.pendingRuntimeTaskUpdateNotifications.delete(key)
            if (pending) {
                this.runtimeTaskUpdateRefreshLoadedAt.set(key, Date.now())
                this.enqueueRuntimeNotification(pending)
            }
        }, delayMs)

        this.runtimeTaskUpdateTimers.set(key, timer)
        return true
    }

    private runtimeTaskUpdateNotificationMinRefreshMs(notification: RuntimeNotification): number {
        const params = notificationRecord(notification)
        return notification.method === OPENADE_NOTIFICATION.taskUpdated && params.previewChanged === false && params.eventStatus === "in_progress"
            ? RUNTIME_TASK_IN_PROGRESS_REFRESH_MIN_MS
            : RUNTIME_TASK_UPDATE_MIN_REFRESH_MS
    }

    private clearPendingRuntimeTaskUpdateNotificationKey(key: string): void {
        const timer = this.runtimeTaskUpdateTimers.get(key)
        if (timer) {
            clearTimeout(timer)
            this.runtimeTaskUpdateTimers.delete(key)
        }
        this.pendingRuntimeTaskUpdateNotifications.delete(key)
        this.runtimeTaskUpdateRefreshLoadedAt.delete(key)
    }

    private clearPendingRuntimeTaskUpdateNotificationsForRepo(repoId: string): void {
        const keyPrefix = `${repoId}\0`
        const keys = new Set([...this.pendingRuntimeTaskUpdateNotifications.keys(), ...this.runtimeTaskUpdateTimers.keys()])
        for (const key of keys) {
            if (key.startsWith(keyPrefix)) this.clearPendingRuntimeTaskUpdateNotificationKey(key)
        }
    }

    private cancelPendingRuntimeTaskUpdateNotification(notification: RuntimeNotification): void {
        if (
            notification.method === OPENADE_NOTIFICATION.repoUpdated ||
            notification.method === OPENADE_NOTIFICATION.repoDeleted ||
            notification.method === OPENADE_NOTIFICATION.snapshotChanged
        ) {
            const repoId = this.runtimeRepoNotificationKey(notification)
            if (repoId) this.clearPendingRuntimeTaskUpdateNotificationsForRepo(repoId)
            return
        }

        if (notification.method !== OPENADE_NOTIFICATION.taskPreviewChanged && notification.method !== OPENADE_NOTIFICATION.taskDeleted) return

        const key = this.runtimeTaskNotificationKey(notification)
        if (!key) return

        this.clearPendingRuntimeTaskUpdateNotificationKey(key)
    }

    private scheduleCoalescedRuntimeTaskPreviewNotification(notification: RuntimeNotification): boolean {
        if (notification.method !== OPENADE_NOTIFICATION.taskPreviewChanged) return false

        const key = this.runtimeRepoNotificationKey(notification) ?? GLOBAL_RUNTIME_TASK_PREVIEW_NOTIFICATION_KEY

        this.pendingRuntimeTaskPreviewNotifications.set(key, notification)
        if (this.runtimeTaskPreviewTimers.has(key)) return true

        const loadedAt = this.runtimeTaskPreviewRefreshLoadedAt.get(key) ?? 0
        const elapsedMs = Date.now() - loadedAt
        const delayMs =
            loadedAt > 0 && elapsedMs < RUNTIME_TASK_PREVIEW_MIN_REFRESH_MS
                ? Math.max(RUNTIME_TASK_PREVIEW_MIN_REFRESH_MS - elapsedMs, RUNTIME_TASK_UPDATE_REFRESH_DELAY_MS)
                : RUNTIME_TASK_UPDATE_REFRESH_DELAY_MS

        const timer = setTimeout(() => {
            this.runtimeTaskPreviewTimers.delete(key)
            const pending = this.pendingRuntimeTaskPreviewNotifications.get(key)
            this.pendingRuntimeTaskPreviewNotifications.delete(key)
            if (pending) {
                this.runtimeTaskPreviewRefreshLoadedAt.set(key, Date.now())
                this.enqueueRuntimeNotification(pending)
            }
        }, delayMs)

        this.runtimeTaskPreviewTimers.set(key, timer)
        return true
    }

    private clearPendingRuntimeTaskPreviewNotificationKey(key: string): void {
        const timer = this.runtimeTaskPreviewTimers.get(key)
        if (timer) {
            clearTimeout(timer)
            this.runtimeTaskPreviewTimers.delete(key)
        }
        this.pendingRuntimeTaskPreviewNotifications.delete(key)
        this.runtimeTaskPreviewRefreshLoadedAt.delete(key)
    }

    private cancelPendingRuntimeTaskPreviewNotification(notification: RuntimeNotification): void {
        if (
            notification.method !== OPENADE_NOTIFICATION.taskDeleted &&
            notification.method !== OPENADE_NOTIFICATION.repoUpdated &&
            notification.method !== OPENADE_NOTIFICATION.repoDeleted &&
            notification.method !== OPENADE_NOTIFICATION.snapshotChanged
        ) {
            return
        }

        const key = this.runtimeRepoNotificationKey(notification)
        if (!key) {
            this.clearPendingRuntimeTaskPreviewNotificationKey(GLOBAL_RUNTIME_TASK_PREVIEW_NOTIFICATION_KEY)
            return
        }

        this.clearPendingRuntimeTaskPreviewNotificationKey(key)
        if (notification.method === OPENADE_NOTIFICATION.repoUpdated || notification.method === OPENADE_NOTIFICATION.repoDeleted) {
            this.clearPendingRuntimeTaskPreviewNotificationKey(GLOBAL_RUNTIME_TASK_PREVIEW_NOTIFICATION_KEY)
        }
    }

    private clearPendingRuntimeTaskUpdateNotifications(): void {
        for (const timer of this.runtimeTaskUpdateTimers.values()) {
            clearTimeout(timer)
        }
        this.runtimeTaskUpdateTimers.clear()
        this.pendingRuntimeTaskUpdateNotifications.clear()
        this.runtimeTaskUpdateRefreshLoadedAt.clear()
        for (const timer of this.runtimeTaskPreviewTimers.values()) {
            clearTimeout(timer)
        }
        this.runtimeTaskPreviewTimers.clear()
        this.pendingRuntimeTaskPreviewNotifications.clear()
        this.runtimeTaskPreviewRefreshLoadedAt.clear()
        for (const timer of this.runtimeTaskSettledTimers.values()) {
            clearTimeout(timer)
        }
        this.runtimeTaskSettledTimers.clear()
    }

    private resetRuntimeNotificationSubscription(): void {
        this.runtimeNotificationDisposer?.()
        this.clearPendingRuntimeTaskUpdateNotifications()
        this.runtimeNotificationDisposer = this.subscribeToRuntimeNotifications()
    }

    private ensureRuntimeNotificationSubscription(): void {
        if (this.runtimeNotificationDisposer) return
        this.runtimeNotificationDisposer = this.subscribeToRuntimeNotifications()
    }

    private async handleRuntimeNotification(notification: RuntimeNotification): Promise<void> {
        const params = typeof notification.params === "object" && notification.params !== null ? (notification.params as Record<string, unknown>) : {}

        const settledTaskIds = this.runtimes.applyNotification(notification)
        const hadRuntimeProductSnapshotProjection = this.hasRuntimeProductSnapshotProjection()
        const wasUsingRuntimeProductAPI = this.shouldUseRuntimeProductAPI()
        const runtimeProductNotificationHandled = await this.handleRuntimeProductStoreNotification(notification)
        const shouldSkipLegacyNotificationRefresh =
            runtimeProductNotificationHandled && (hadRuntimeProductSnapshotProjection || wasUsingRuntimeProductAPI || this.shouldUseRuntimeProductAPI())
        for (const taskId of settledTaskIds) {
            if (this.scheduleRuntimeTaskSettledNotification(taskId, this.runtimes.runtimeForTask(taskId))) continue
            await this.notifyRuntimeTaskSettled(taskId, this.runtimes.runtimeForTask(taskId))
        }

        const queuedTurnTaskId = this.queuedTurns.applyNotification(notification)
        if (queuedTurnTaskId) {
            if (!shouldSkipLegacyNotificationRefresh) {
                await this.refreshProductTaskAfterRuntimeNotification(queuedTurnTaskId)
            }
            this.queuedTurns.reconcileTaskWithStorage(queuedTurnTaskId, this.tasks.getTaskModel(queuedTurnTaskId)?.queuedTurns ?? [])
            return
        }

        if (notification.method === OPENADE_NOTIFICATION.taskUpdated || notification.method === OPENADE_NOTIFICATION.taskPreviewChanged) {
            if (!shouldSkipLegacyNotificationRefresh) {
                await this.refreshProductSnapshotAfterRuntimeNotification()
                if (typeof params.taskId === "string") {
                    await this.refreshProductTaskAfterRuntimeNotification(params.taskId)
                }
            }
            return
        }

        if (notification.method === OPENADE_NOTIFICATION.taskDeleted) {
            if (!shouldSkipLegacyNotificationRefresh) {
                await this.refreshProductSnapshotAfterRuntimeNotification()
            }
            const taskId = typeof params.taskId === "string" ? params.taskId : null
            if (taskId) {
                this.disconnectTaskStore(taskId)
                runInAction(() => {
                    this.clearDeletedRuntimeProductTask(taskId)
                })
            }
            return
        }

        if (
            notification.method === OPENADE_NOTIFICATION.snapshotChanged ||
            notification.method === OPENADE_NOTIFICATION.repoUpdated ||
            notification.method === OPENADE_NOTIFICATION.repoDeleted
        ) {
            if (!shouldSkipLegacyNotificationRefresh) {
                await this.refreshProductSnapshotAfterRuntimeNotification()
            }
        }
    }

    private shouldEnableRuntimeProductStore(): boolean {
        if (this.coreRolloutOwnsProductRuntime()) return true
        return this.config.enableRuntimeProductStore ?? isRuntimeBackedProductStoreEnabled
    }

    private createRuntimeProductStore(): OpenADEProductStore {
        return this.config.runtimeProductStoreFactory?.() ?? new OpenADEProductStore(localOpenADEClient, localOpenADEClient)
    }

    private attachRuntimeProductStoreForCoreOwned(): OpenADEProductStore | null {
        if (!this.usesCoreOwnedProductRuntime()) return this.runtimeProductStore
        const productStore = this.runtimeProductStore ?? this.createRuntimeProductStore()
        if (!this.runtimeProductStore) {
            this.runtimeProductStore = productStore
            this.observeRuntimeProductStore(productStore)
            this.ensureRuntimeNotificationSubscription()
        }
        return productStore
    }

    private observeRuntimeProductStore(productStore: OpenADEProductStore): void {
        if (this.runtimeProductDeferredTaskRefreshStore === productStore) return
        this.runtimeProductDeferredTaskRefreshDisposer?.()
        this.runtimeProductDeferredTaskRefreshStore = productStore
        this.runtimeProductDeferredTaskRefreshDisposer = productStore.onDeferredTaskRefresh((task, readOptions) => {
            runInAction(() => {
                this.clearRuntimeProductRouteTaskReadProblemForTask(task.id)
                this.cacheRuntimeProductTask(task, isLimitedRuntimeProductTaskRead(readOptions) ? "route-lightweight" : "lightweight")
                if (!isLimitedRuntimeProductTaskRead(readOptions)) {
                    this.runtimeProductTaskReadLoadedAt.set(task.id, Date.now())
                }
            })
            this.tasks.getTaskModel(task.id)?.syncHarnessFromHistory()
        })
    }

    private clearRuntimeProductStoreObserver(): void {
        this.runtimeProductDeferredTaskRefreshDisposer?.()
        this.runtimeProductDeferredTaskRefreshDisposer = null
        this.runtimeProductDeferredTaskRefreshStore = null
    }

    private coreMigrationEndpointKey(endpoint: OpenADECoreRuntimeEndpoint): string {
        return `${endpoint.url}\n${endpoint.token}`
    }

    private createCoreMigrationProductStore(endpoint: OpenADECoreRuntimeEndpoint): OpenADEProductStore {
        const runtime = createLocalProductRuntimeClient(endpoint)
        return new OpenADEProductStore(
            new OpenADEClient({
                runtime: runtime.client,
                clientName: "OpenADE Desktop",
                clientPlatform: "desktop",
                protocolVersion: 1,
            })
        )
    }

    private coreMigrationProductStore(): OpenADEProductStore {
        if (!this.shouldEnableRuntimeProductStore()) {
            throw new Error("OpenADE Core migration requires the runtime product store.")
        }
        const coreEndpoint = resolveCoreRuntimeEndpoint()
        const migrationEndpoint = resolveCoreMigrationRuntimeEndpoint()
        if (!this.config.runtimeProductStoreFactory && !coreEndpoint && !migrationEndpoint) {
            throw new Error("OpenADE Core is not connected.")
        }

        if (!coreEndpoint && migrationEndpoint && !this.config.runtimeProductStoreFactory) {
            const key = this.coreMigrationEndpointKey(migrationEndpoint)
            if (this.coreMigrationProductStoreEntry?.key !== key) {
                this.coreMigrationProductStoreEntry?.store.destroy()
                this.coreMigrationProductStoreEntry = {
                    key,
                    store: this.config.coreMigrationProductStoreFactory?.(migrationEndpoint) ?? this.createCoreMigrationProductStore(migrationEndpoint),
                }
            }
            return this.coreMigrationProductStoreEntry.store
        }

        const productStore = this.runtimeProductStore ?? this.createRuntimeProductStore()
        this.runtimeProductStore = productStore
        this.observeRuntimeProductStore(productStore)
        this.ensureRuntimeNotificationSubscription()
        return productStore
    }

    private runtimeProductErrorMessage(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }

    private runtimeProductProjectionTelemetry(): {
        hasSnapshot: boolean
        hasProjectProjection: boolean
        repoCount: number
        taskPreviewCount: number
        cachedTaskCount: number
    } {
        const projectProjection = this.shouldUseRuntimeProductAPI() ? this.getRuntimeProductProjectProjection() : null
        const projects = projectProjection ?? this.runtimeProductSnapshot?.repos ?? []
        return {
            hasSnapshot: this.runtimeProductSnapshot !== null,
            hasProjectProjection: projectProjection !== null,
            repoCount: projects.length,
            taskPreviewCount: projects.reduce((count, repo) => count + repo.tasks.length, 0),
            cachedTaskCount: this.runtimeProductTasks.size,
        }
    }

    private runtimeProductTelemetryProperties(source: string): Record<string, unknown> {
        const projection = this.runtimeProductProjectionTelemetry()
        const coreRolloutState = resolveCoreRolloutState()
        return {
            source,
            enabled: this.shouldEnableRuntimeProductStore(),
            status: this.runtimeProductStoreStatus,
            hasSnapshot: projection.hasSnapshot,
            hasProjectProjection: projection.hasProjectProjection,
            repoCount: projection.repoCount,
            taskPreviewCount: projection.taskPreviewCount,
            cachedTaskCount: projection.cachedTaskCount,
            runtimeProductTransport: selectedLocalProductRuntime().source,
            coreRolloutStatus: coreRolloutState?.status ?? "unavailable",
            coreRolloutSource: coreRolloutState?.source ?? "unavailable",
            coreRolloutReason: coreRolloutState?.reason ?? "unavailable",
            coreRolloutAutomatic: coreRolloutState?.automatic ?? false,
            coreLegacyYjsDocumentsPresent: coreRolloutState?.legacyYjsDocumentsPresent ?? false,
            coreLegacyYjsMigrationAccepted: coreRolloutState?.legacyYjsMigrationAccepted ?? false,
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

    private legacyProductClient(method: OpenADEMethod): typeof localOpenADEClient {
        if (this.usesCoreOwnedProductRuntime()) {
            throw new Error(`Core-owned product runtime cannot fall back to the legacy product client for ${method}`)
        }
        this.trackRuntimeProductFallback("legacy_product_client", method)
        return localOpenADEClient
    }

    private async runtimeProductStoreForMethod(method: OpenADEMethod): Promise<OpenADEProductStore | null> {
        let store = this.usesCoreOwnedProductRuntime() ? this.attachRuntimeProductStoreForCoreOwned() : this.runtimeProductStore
        const routeOwnsProductMethod = this.shouldUseRuntimeProductTaskRoute()
        if (!store && routeOwnsProductMethod && !this.usesCoreOwnedProductRuntime() && this.shouldEnableRuntimeProductStore()) {
            store = this.createRuntimeProductStore()
            this.runtimeProductStore = store
            this.observeRuntimeProductStore(store)
            this.ensureRuntimeNotificationSubscription()
        }
        if (!store && this.usesCoreOwnedProductRuntime()) {
            throw new Error(`Core-owned product runtime cannot run ${method} without a runtime product store`)
        }
        if (store && this.shouldUseRuntimeProductStoresForInitialization() && !this.shouldUseRuntimeProductAPI() && !routeOwnsProductMethod) {
            throw new Error(`Runtime product store is not initialized for ${method}`)
        }
        if (!this.shouldUseRuntimeProductAPI() && !routeOwnsProductMethod) return null
        if (!store) throw new Error(`Runtime product store unavailable for ${method}`)
        if (this.usesCoreOwnedProductRuntime()) {
            if (!(await store.canUseMethodAfterConnect(method))) throw new Error(`Runtime product method unavailable: ${method}`)
            return store
        }
        if (!store.canUseMethod(method)) throw new Error(`Runtime product method unavailable: ${method}`)
        return store
    }

    private async runtimeProductStoreForMethodIfAvailable(method: OpenADEMethod): Promise<OpenADEProductStore | null> {
        const store = this.usesCoreOwnedProductRuntime() ? this.attachRuntimeProductStoreForCoreOwned() : this.runtimeProductStore
        if (!store) return null
        if (!this.shouldUseRuntimeProductAPI() && !this.shouldUseRuntimeProductTaskRoute()) return null
        if (this.usesCoreOwnedProductRuntime()) return (await store.canUseMethodAfterConnect(method)) ? store : null
        return store.canUseMethod(method) ? store : null
    }

    private async initializeRuntimeProductProjectList(productStore: OpenADEProductStore): Promise<void> {
        try {
            const projects = await productStore.listProjects({ bypassCache: true })
            runInAction(() => {
                this.runtimeProductSnapshot = null
                this.replaceRuntimeProductProjects(projects)
                this.pruneRuntimeProductTasksForProjects(projects)
                this.runtimeProductStoreStatus = "ready"
                this.runtimeProductStoreError = null
            })
        } catch (projectErr) {
            const message = this.runtimeProductErrorMessage(projectErr)
            runInAction(() => {
                this.runtimeProductSnapshot = null
                this.runtimeProductProjects.clear()
                this.runtimeProductTasks.clear()
                this.runtimeProductTaskReadLoadedAt.clear()
                this.clearRuntimeProductRouteTaskReadLoadedAt()
                this.runtimeProductTaskVisibleReadMode.clear()
                this.runtimeProductStoreStatus = "error"
                this.runtimeProductStoreError = message
            })
            this.trackRuntimeProductStoreError("initialize_project_list", projectErr)
            console.warn("[CodeStore] Failed to initialize runtime product project list:", projectErr)
        }
    }

    async initializeRuntimeProductStore(): Promise<void> {
        if (!this.shouldEnableRuntimeProductStore()) {
            this.runtimeProductInitializationInFlight = null
            this.clearRuntimeProductStoreObserver()
            this.runtimeProductStore?.destroy()
            this.runtimeProductStore = null
            this.trackedRuntimeProductFallbackKeys.clear()
            this.acceptedRuntimeProductMutationNotifications.clear()
            runInAction(() => {
                this.runtimeProductSnapshot = null
                this.runtimeProductProjects.clear()
                this.runtimeProductTasks.clear()
                this.runtimeProductTaskReadLoadedAt.clear()
                this.clearRuntimeProductRouteTaskReadLoadedAt()
                this.runtimeProductTaskVisibleReadMode.clear()
                this.runtimeProductStoreStatus = "disabled"
                this.runtimeProductStoreError = null
            })
            return
        }

        if (this.runtimeProductInitializationInFlight) return this.runtimeProductInitializationInFlight
        if (this.runtimeProductStore && this.runtimeProductStoreStatus === "ready") return

        const initialization = this.initializeRuntimeProductStoreUncoalesced().finally(() => {
            if (this.runtimeProductInitializationInFlight === initialization) {
                this.runtimeProductInitializationInFlight = null
            }
        })
        this.runtimeProductInitializationInFlight = initialization
        return initialization
    }

    private async initializeRuntimeProductStoreUncoalesced(): Promise<void> {
        const productStore = this.runtimeProductStore ?? this.createRuntimeProductStore()
        this.runtimeProductStore = productStore
        this.observeRuntimeProductStore(productStore)
        this.ensureRuntimeNotificationSubscription()
        runInAction(() => {
            this.runtimeProductStoreStatus = "loading"
            this.runtimeProductStoreError = null
        })

        try {
            const [canReadProjectList, canReadSnapshot] = await Promise.all([
                productStore.canUseMethodAfterConnect(OPENADE_METHOD.projectList),
                productStore.canUseMethodAfterConnect(OPENADE_METHOD.snapshotRead),
            ])
            if (canReadProjectList) {
                await this.initializeRuntimeProductProjectList(productStore)
                return
            }
            if (this.usesCoreOwnedProductRuntime() && !canReadSnapshot) {
                await this.initializeRuntimeProductProjectList(productStore)
                return
            }

            const snapshot = await productStore.refreshSnapshot()
            runInAction(() => {
                this.runtimeProductSnapshot = snapshot
                this.replaceRuntimeProductProjects(snapshot.repos)
                this.pruneRuntimeProductTasks(snapshot)
                this.runtimeProductStoreStatus = "ready"
                this.runtimeProductStoreError = null
            })
        } catch (err) {
            if (this.usesCoreOwnedProductRuntime()) {
                this.trackRuntimeProductStoreError("initialize_snapshot", err)
                console.warn("[CodeStore] Failed to initialize runtime product snapshot; initializing from scoped project list:", err)
                await this.initializeRuntimeProductProjectList(productStore)
                return
            }
            const message = this.runtimeProductErrorMessage(err)
            runInAction(() => {
                this.runtimeProductSnapshot = null
                this.runtimeProductProjects.clear()
                this.runtimeProductTasks.clear()
                this.runtimeProductTaskReadLoadedAt.clear()
                this.clearRuntimeProductRouteTaskReadLoadedAt()
                this.runtimeProductTaskVisibleReadMode.clear()
                this.runtimeProductStoreStatus = "error"
                this.runtimeProductStoreError = message
            })
            this.trackRuntimeProductStoreError("initialize", err)
            console.warn("[CodeStore] Failed to initialize runtime product store:", err)
        }
    }

    async refreshRuntimeProductSnapshot(options: OpenADEProductReadOptions = {}): Promise<OpenADESnapshot | null> {
        if (!this.runtimeProductStore) return null
        try {
            const snapshot = await this.runtimeProductStore.refreshSnapshot(options)
            runInAction(() => {
                this.runtimeProductSnapshot = snapshot
                this.replaceRuntimeProductProjects(snapshot.repos)
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

    private async refreshRuntimeProductProjection(options: OpenADEProductReadOptions = {}): Promise<void> {
        const productStore = this.attachRuntimeProductStoreForCoreOwned()
        if (!productStore) return

        const [canReadProjectList, canReadSnapshot] = await Promise.all([
            productStore.canUseMethodAfterConnect(OPENADE_METHOD.projectList),
            productStore.canUseMethodAfterConnect(OPENADE_METHOD.snapshotRead),
        ])
        if (canReadProjectList) {
            await this.loadRuntimeProductProjects(options)
            return
        }
        if (canReadSnapshot) await this.refreshRuntimeProductSnapshot(options)
    }

    async loadRuntimeProductProjects(options: OpenADEProductReadOptions = {}): Promise<OpenADEProject[]> {
        const productStore = this.attachRuntimeProductStoreForCoreOwned()
        if (!productStore || !this.shouldUseRuntimeProductAPI()) return []
        const canReadProjects = this.usesCoreOwnedProductRuntime()
            ? await productStore.canUseMethodAfterConnect(OPENADE_METHOD.projectList)
            : this.canUseProductMethod(OPENADE_METHOD.projectList)
        if (!canReadProjects) return []
        try {
            const projects = await productStore.listProjects(options)
            runInAction(() => {
                this.replaceRuntimeProductProjects(projects)
                this.pruneRuntimeProductTasksForProjects(projects)
                const hasProductProjection = this.runtimeProductSnapshot !== null || projects !== null
                if ((this.usesCoreOwnedProductRuntime() || hasProductProjection) && this.runtimeProductStoreStatus !== "loading") {
                    this.runtimeProductStoreStatus = "ready"
                }
                this.runtimeProductStoreError = null
            })
            return projects
        } catch (err) {
            const message = this.runtimeProductErrorMessage(err)
            runInAction(() => {
                this.runtimeProductStoreStatus = "error"
                this.runtimeProductStoreError = message
            })
            this.trackRuntimeProductStoreError("project_list", err)
            throw err
        }
    }

    private async loadRuntimeProductTaskPreviews(repoId: string, options: OpenADEProductReadOptions = {}): Promise<OpenADETaskPreview[]> {
        const productStore = this.attachRuntimeProductStoreForCoreOwned()
        if (!productStore || !this.shouldUseRuntimeProductAPI()) return []
        const canReadTasks = this.usesCoreOwnedProductRuntime()
            ? await productStore.canUseMethodAfterConnect(OPENADE_METHOD.taskList)
            : this.canUseProductMethod(OPENADE_METHOD.taskList)
        if (!canReadTasks) return []
        try {
            const tasks = await productStore.listTasks(repoId, options)
            this.syncRuntimeProductStoreCache(undefined, repoId)
            return tasks
        } catch (err) {
            const message = this.runtimeProductErrorMessage(err)
            runInAction(() => {
                this.runtimeProductStoreStatus = "error"
                this.runtimeProductStoreError = message
            })
            this.trackRuntimeProductStoreError("task_list", err)
            throw err
        }
    }

    private runtimeProductTaskPreview(repoId: string, taskId: string): OpenADETaskPreview | undefined {
        return this.getRuntimeProductProject(repoId)?.tasks.find((task) => task.id === taskId)
    }

    private runtimeProductTaskPreviewFromCachedTask(repoId: string, taskId: string): OpenADETaskPreview | null {
        const task = this.runtimeProductStore?.getCachedTask(repoId, taskId)
        if (!task) return null
        if (task.preview) return task.preview

        const preview: OpenADETaskPreview = {
            id: task.id,
            slug: task.slug,
            title: task.title,
            createdAt: task.createdAt ?? task.updatedAt ?? task.lastEventAt ?? RUNTIME_TASK_PREVIEW_FALLBACK_CREATED_AT,
        }
        if (task.closed !== undefined) preview.closed = task.closed
        if (task.lastViewedAt !== undefined) preview.lastViewedAt = task.lastViewedAt
        if (task.lastEventAt !== undefined) preview.lastEventAt = task.lastEventAt
        return preview
    }

    private cacheRuntimeProductTask(task: OpenADETask, readMode: RuntimeProductTaskVisibleReadMode = "lightweight"): Task {
        const adapted = taskFromRuntimeProduct({
            task,
            preview: this.runtimeProductTaskPreview(task.repoId, task.id),
            currentUser: this.currentUser,
        })
        this.runtimeProductTasks.set(task.id, adapted)
        this.runtimeProductTaskVisibleReadMode.set(task.id, readMode)
        this.runtimes.applyOpenADETaskRuntimeState(task.id, task.runtimeState)
        return adapted
    }

    private pruneRuntimeProductTasks(snapshot: OpenADESnapshot): void {
        this.pruneRuntimeProductTasksForProjects(snapshot.repos)
    }

    private pruneRuntimeProductTasksForProjects(projects: OpenADEProject[] | null): void {
        const taskIds = new Set((projects ?? []).flatMap((repo) => repo.tasks.map((task) => task.id)))
        for (const taskId of this.runtimeProductTasks.keys()) {
            if (!taskIds.has(taskId)) {
                this.clearDeletedRuntimeProductTask(taskId)
            }
        }
    }

    private clearDeletedRuntimeProductTask(taskId: string): void {
        this.runtimeProductTasks.delete(taskId)
        this.runtimeProductTaskReadLoadedAt.delete(taskId)
        this.clearRuntimeProductRouteTaskReadLoadedAtForTask(taskId)
        this.runtimeProductTaskVisibleReadMode.delete(taskId)
        this.runtimes.removeTask(taskId)
        this.tasks.invalidateTaskModel(taskId)
    }

    private clearRuntimeProductRouteTaskReadLoadedAtForTask(taskId: string): void {
        for (const key of this.runtimeProductRouteTaskReadLoadedAt.keys()) {
            if (key.includes(`\0${taskId}\0`)) this.runtimeProductRouteTaskReadLoadedAt.delete(key)
        }
        this.clearRuntimeProductRouteTaskReadProblemForTask(taskId)
    }

    private clearRuntimeProductRouteTaskReadProblemForTask(taskId: string): void {
        for (const key of this.runtimeProductRouteTaskReadMisses.keys()) {
            if (key.includes(`\0${taskId}\0`)) this.runtimeProductRouteTaskReadMisses.delete(key)
        }
        for (const key of this.runtimeProductRouteTaskReadErrors.keys()) {
            if (key.includes(`\0${taskId}\0`)) this.runtimeProductRouteTaskReadErrors.delete(key)
        }
    }

    private clearRuntimeProductRouteTaskReadLoadedAt(): void {
        this.runtimeProductRouteTaskReadLoadedAt.clear()
        this.runtimeProductRouteTaskReadMisses.clear()
        this.runtimeProductRouteTaskReadErrors.clear()
    }

    private markRuntimeProductRouteTaskReadFresh(repoId: string, taskId: string): void {
        const routeReadKey = runtimeProductTaskReadKey(repoId, taskId, ROUTE_RUNTIME_TASK_READ_OPTIONS)
        this.runtimeProductRouteTaskReadLoadedAt.set(routeReadKey, Date.now())
        this.runtimeProductRouteTaskReadMisses.delete(routeReadKey)
        this.runtimeProductRouteTaskReadErrors.delete(routeReadKey)
    }

    private cleanupAcceptedRuntimeProductMutationNotifications(): void {
        const now = Date.now()
        for (const [clientRequestId, expiresAt] of this.acceptedRuntimeProductMutationNotifications) {
            if (expiresAt <= now) this.acceptedRuntimeProductMutationNotifications.delete(clientRequestId)
        }
    }

    private trackAcceptedRuntimeProductMutationNotification(clientRequestId: string): void {
        this.cleanupAcceptedRuntimeProductMutationNotifications()
        this.acceptedRuntimeProductMutationNotifications.set(clientRequestId, Date.now() + ACCEPTED_RUNTIME_PRODUCT_MUTATION_NOTIFICATION_SUPPRESS_MS)
    }

    private isAcceptedRuntimeProductMutationNotification(clientRequestId: string): boolean {
        if (!clientRequestId) return false
        this.cleanupAcceptedRuntimeProductMutationNotifications()
        return this.acceptedRuntimeProductMutationNotifications.has(clientRequestId)
    }

    private runtimeProductTaskIdsForRepo(repoId: string): Set<string> {
        const taskIds = new Set<string>()
        for (const [taskId, task] of this.runtimeProductTasks) {
            if (task.repoId === repoId) taskIds.add(taskId)
        }
        const project = this.getRuntimeProductProject(repoId)
        for (const task of project?.tasks ?? []) taskIds.add(task.id)
        return taskIds
    }

    private clearRuntimeProductRepoState(repoId: string, taskIds = this.runtimeProductTaskIdsForRepo(repoId)): void {
        runInAction(() => {
            this.runtimeProductProjects.delete(repoId)
            for (const taskId of taskIds) {
                this.clearDeletedRuntimeProductTask(taskId)
            }
            if (this.runtimeProductSnapshot) {
                this.runtimeProductSnapshot = {
                    ...this.runtimeProductSnapshot,
                    repos: this.runtimeProductSnapshot.repos.filter((repo) => repo.id !== repoId),
                    workingTaskIds: this.runtimeProductSnapshot.workingTaskIds.filter((taskId) => !taskIds.has(taskId)),
                }
            }
        })
    }

    async getRuntimeProductTask(
        repoId: string,
        taskId: string,
        options: OpenADETaskReadOptions = LIGHTWEIGHT_RUNTIME_TASK_READ_OPTIONS,
        readOptions: OpenADEProductReadOptions = {}
    ): Promise<OpenADETask | null> {
        const productStore = this.usesCoreOwnedProductRuntime() ? this.attachRuntimeProductStoreForCoreOwned() : this.runtimeProductStore
        if (!productStore) return null
        const limitedLightweightRead = isLimitedRuntimeProductTaskRead(options)
        const allowRouteReadBeforeProjection = limitedLightweightRead && this.shouldUseRuntimeProductTaskRoute() && !this.shouldUseRuntimeProductAPI()
        const canReadTask = this.usesCoreOwnedProductRuntime()
            ? await productStore.canUseMethodAfterConnect(OPENADE_METHOD.taskRead)
            : this.shouldUseRuntimeProductAPI()
              ? this.canUseProductMethod(OPENADE_METHOD.taskRead)
              : allowRouteReadBeforeProjection
                ? await productStore.canUseMethodAfterConnect(OPENADE_METHOD.taskRead)
                : false
        if (!canReadTask) return null
        if (!this.shouldUseRuntimeProductAPI() && !allowRouteReadBeforeProjection) return null
        const key = runtimeProductTaskReadKey(repoId, taskId, options)
        if (options.hydrateSessionEvents !== true && !limitedLightweightRead && !readOptions.bypassCache) {
            const loadedAt = this.runtimeProductTaskReadLoadedAt.get(taskId) ?? 0
            const cachedTask = productStore.getCachedLightweightTask(repoId, taskId)
            if (cachedTask && Date.now() - loadedAt < RUNTIME_TASK_LIGHTWEIGHT_CACHE_FRESH_MS) {
                return cachedTask
            }
        }

        if (options.hydrateSessionEvents !== true && this.runtimeProductTaskVisibleReadMode.get(taskId) === "hydrated") {
            runInAction(() => {
                this.runtimeProductTasks.delete(taskId)
                this.clearRuntimeProductRouteTaskReadLoadedAtForTask(taskId)
                this.runtimeProductTaskVisibleReadMode.delete(taskId)
            })
        }

        let request = this.runtimeProductTaskReadInFlight.get(key)
        if (!request) {
            const nextRequest = productStore.getTask(repoId, taskId, options, readOptions).finally(() => {
                runInAction(() => {
                    this.runtimeProductTaskReadInFlight.delete(key)
                })
            })
            request = nextRequest
            runInAction(() => {
                this.runtimeProductTaskReadInFlight.set(key, nextRequest)
            })
        }

        const task = await request
        if (task) {
            runInAction(() => {
                this.clearRuntimeProductRouteTaskReadProblemForTask(task.id)
                if (options.hydrateSessionEvents === true) {
                    this.cacheRuntimeProductTask(task, "hydrated")
                    this.runtimeProductTaskReadLoadedAt.delete(task.id)
                    this.clearRuntimeProductRouteTaskReadLoadedAtForTask(task.id)
                } else {
                    if (limitedLightweightRead) {
                        this.cacheRuntimeProductTask(task, "route-lightweight")
                        this.runtimeProductTaskReadLoadedAt.delete(task.id)
                    } else {
                        this.cacheRuntimeProductTask(task, "lightweight")
                        this.runtimeProductTaskReadLoadedAt.set(task.id, Date.now())
                    }
                }
            })
        }
        return task
    }

    async loadRuntimeProductTask(
        repoId: string,
        taskId: string,
        options: OpenADETaskReadOptions = LIGHTWEIGHT_RUNTIME_TASK_READ_OPTIONS
    ): Promise<Task | null> {
        const task = await this.getRuntimeProductTask(repoId, taskId, options)
        const adapted = task ? (this.runtimeProductTasks.get(task.id) ?? null) : null
        if (adapted) this.tasks.getTaskModel(taskId)?.syncHarnessFromHistory()
        return adapted
    }

    async loadRuntimeProductTaskForRoute(
        repoId: string,
        taskId: string,
        options: OpenADETaskReadOptions = ROUTE_RUNTIME_TASK_READ_OPTIONS
    ): Promise<Task | null> {
        const routeReadKey = runtimeProductTaskReadKey(repoId, taskId, options)
        const coreOwnedRoute = this.usesCoreOwnedProductRuntime()
        if (coreOwnedRoute || (!this.runtimeProductStore && this.shouldUseRuntimeProductTaskRoute())) {
            const productStore = this.runtimeProductStore ?? this.createRuntimeProductStore()
            if (!this.runtimeProductStore) {
                this.runtimeProductStore = productStore
                this.observeRuntimeProductStore(productStore)
                this.ensureRuntimeNotificationSubscription()
            }
            const canReadTask = await productStore.canUseMethodAfterConnect(OPENADE_METHOD.taskRead)
            if (!canReadTask) {
                if (coreOwnedRoute) {
                    runInAction(() => {
                        if (this.runtimeProductStoreStatus === "disabled" || this.runtimeProductStoreStatus === "loading") {
                            this.runtimeProductStoreStatus = "ready"
                        }
                    })
                }
                return null
            }
        }

        if (isLimitedRuntimeProductTaskRead(options)) {
            const loadedAt = this.runtimeProductRouteTaskReadLoadedAt.get(routeReadKey) ?? 0
            const cached = this.runtimeProductTasks.get(taskId)
            if (
                cached?.repoId === repoId &&
                (this.runtimeProductTaskVisibleReadMode.get(taskId) === "route-lightweight" ||
                    this.runtimeProductTaskVisibleReadMode.get(taskId) === "lightweight") &&
                Date.now() - loadedAt < RUNTIME_TASK_ROUTE_CACHE_FRESH_MS
            ) {
                return cached
            }
        }

        let task: Task | null = null
        try {
            task = await this.loadRuntimeProductTask(repoId, taskId, options)
        } catch (error) {
            if (isLimitedRuntimeProductTaskRead(options)) {
                runInAction(() => {
                    if (isRuntimeNotFoundError(error)) {
                        this.runtimeProductRouteTaskReadMisses.add(routeReadKey)
                        this.runtimeProductRouteTaskReadErrors.delete(routeReadKey)
                    } else {
                        this.runtimeProductRouteTaskReadMisses.delete(routeReadKey)
                        this.runtimeProductRouteTaskReadErrors.set(routeReadKey, this.runtimeProductErrorMessage(error))
                    }
                })
            }
            throw error
        }
        if (isLimitedRuntimeProductTaskRead(options)) {
            runInAction(() => {
                if (task) {
                    this.runtimeProductRouteTaskReadLoadedAt.set(routeReadKey, Date.now())
                    this.runtimeProductRouteTaskReadMisses.delete(routeReadKey)
                    this.runtimeProductRouteTaskReadErrors.delete(routeReadKey)
                }
            })
        }
        return task
    }

    hasRuntimeProductRouteTaskReadMiss(
        repoId: string,
        taskId: string,
        options: OpenADETaskReadOptions = ROUTE_RUNTIME_TASK_READ_OPTIONS
    ): boolean {
        return this.runtimeProductRouteTaskReadMisses.has(runtimeProductTaskReadKey(repoId, taskId, options))
    }

    getRuntimeProductRouteTaskReadError(
        repoId: string,
        taskId: string,
        options: OpenADETaskReadOptions = ROUTE_RUNTIME_TASK_READ_OPTIONS
    ): string | null {
        return this.runtimeProductRouteTaskReadErrors.get(runtimeProductTaskReadKey(repoId, taskId, options)) ?? null
    }

    async refreshRuntimeProductTaskForTaskId(
        taskId: string,
        options: OpenADETaskReadOptions = LIGHTWEIGHT_RUNTIME_TASK_READ_OPTIONS,
        readOptions: OpenADEProductReadOptions = { bypassCache: true },
        refreshOptions: RuntimeProductTaskRefreshOptions = {}
    ): Promise<OpenADETask | null> {
        const productStore = this.attachRuntimeProductStoreForCoreOwned()
        if (!productStore) return null
        const allowRouteReadBeforeProjection = this.shouldUseRuntimeProductTaskRoute() && !this.shouldUseRuntimeProductAPI()
        if (!this.shouldUseRuntimeProductAPI() && !allowRouteReadBeforeProjection) return null
        const canReadTask = this.usesCoreOwnedProductRuntime()
            ? await productStore.canUseMethodAfterConnect(OPENADE_METHOD.taskRead)
            : this.shouldUseRuntimeProductAPI()
              ? this.canUseProductMethod(OPENADE_METHOD.taskRead)
              : await productStore.canUseMethodAfterConnect(OPENADE_METHOD.taskRead)
        if (!canReadTask) return null

        let repoId = this.runtimeProductTasks.get(taskId)?.repoId ?? this.findRuntimeProductRepoIdForTask(taskId)
        if (!repoId && refreshOptions.allowProjectionRepair === true) {
            if (this.usesCoreOwnedProductRuntime() && !this.hasRuntimeProductProjectionToRepair()) return null
            await this.refreshRuntimeProductProjection({ bypassCache: true })
            repoId = this.findRuntimeProductRepoIdForTask(taskId)
        }
        if (!repoId) return null

        const task = await this.getRuntimeProductTask(repoId, taskId, options, readOptions)
        if (task) this.tasks.getTaskModel(taskId)?.syncHarnessFromHistory()
        return task
    }

    private async refreshRuntimeProductTaskById(taskId: string, refreshOptions: RuntimeProductTaskRefreshOptions = {}): Promise<void> {
        await this.refreshRuntimeProductTaskForTaskId(taskId, NOTIFICATION_RUNTIME_TASK_READ_OPTIONS, { bypassCache: true }, refreshOptions)
    }

    private getCachedRuntimeProductTask(taskId: string): Task | null {
        return this.runtimeProductTasks.get(taskId) ?? null
    }

    getCachedProductTask(taskId: string): Task | null {
        if (this.shouldUseRuntimeProductTaskRoute()) {
            if (!this.canUseProductMethod(OPENADE_METHOD.taskRead)) return null
            return this.getCachedRuntimeProductTask(taskId)
        }

        const runtimeTask = this.getCachedRuntimeProductTask(taskId)
        if (runtimeTask) return runtimeTask

        const taskStore = this.getCachedTaskStore(taskId)
        return taskStore ? taskFromStore(taskStore) : null
    }

    private getCachedRuntimeProductOpenADETask(taskId: string): OpenADETask | null {
        if (this.shouldUseRuntimeProductTaskRoute() && !this.canUseProductMethod(OPENADE_METHOD.taskRead)) return null
        const repoId = this.runtimeProductTasks.get(taskId)?.repoId ?? this.findRuntimeProductRepoIdForTask(taskId)
        if (!repoId) return null
        return this.runtimeProductStore?.getCachedTask(repoId, taskId) ?? null
    }

    private findRuntimeProductRepoIdForTask(taskId: string): string | null {
        for (const repo of this.runtimeProductSnapshot?.repos ?? []) {
            if (repo.tasks.some((task) => task.id === taskId)) return repo.id
        }
        for (const repo of this.runtimeProductProjects.values()) {
            if (repo.tasks.some((task) => task.id === taskId)) return repo.id
        }
        return null
    }

    private hasRuntimeProductTaskReference(taskId: string): boolean {
        return this.findRuntimeProductRepoIdForTask(taskId) !== null
    }

    hasProductTaskReadInFlight(repoId: string, taskId: string, options: OpenADETaskReadOptions = ROUTE_RUNTIME_TASK_READ_OPTIONS): boolean {
        return this.runtimeProductTaskReadInFlight.has(runtimeProductTaskReadKey(repoId, taskId, options))
    }

    hasProductTaskModelSource(taskId: string): boolean {
        if (this.shouldUseRuntimeProductTaskRoute() && !this.canUseProductMethod(OPENADE_METHOD.taskRead)) return false
        return this.getCachedProductTask(taskId) !== null || this.hasRuntimeProductTaskReference(taskId)
    }

    findProductRepoIdForTask(taskId: string): string | null {
        const task = this.getCachedProductTask(taskId)
        if (task?.repoId) return task.repoId

        const runtimeRepoId = this.findRuntimeProductRepoIdForTask(taskId)
        if (runtimeRepoId) return runtimeRepoId
        if (this.shouldUseRuntimeProductTaskRoute()) return null

        for (const repo of this.repoStore?.repos.all() ?? []) {
            if (repo.tasks.some((taskPreview) => taskPreview.id === taskId)) return repo.id
        }
        return null
    }

    private hasRuntimeProductSnapshotProjection(): boolean {
        return this.runtimeProductSnapshot !== null
    }

    private hasRuntimeProductProjectListProjection(): boolean {
        return this.runtimeProductStore !== null && this.runtimeProductSnapshot === null && this.runtimeProductStoreStatus === "ready"
    }

    private hasRuntimeProductProjectProjectionForRepo(repoId: string): boolean {
        return Boolean(this.runtimeProductSnapshot?.repos.some((repo) => repo.id === repoId) || this.runtimeProductProjects.has(repoId))
    }

    shouldUseRuntimeProductAPI(): boolean {
        return (
            this.runtimeProductStore !== null &&
            (this.hasRuntimeProductSnapshotProjection() || this.hasRuntimeProductProjectListProjection() || this.usesCoreOwnedProductRuntime())
        )
    }

    shouldUseRuntimeProductTaskRoute(): boolean {
        if (this.shouldUseRuntimeProductAPI() || this.usesCoreOwnedProductRuntime()) return true
        return this.shouldEnableRuntimeProductStore() && this.runtimeProductStoreStatus !== "error"
    }

    canUseProductMethod(method: OpenADEMethod): boolean {
        if (this.usesCoreOwnedProductRuntime() && !this.runtimeProductStore) return false
        if (this.shouldUseRuntimeProductTaskRoute() && !this.shouldUseRuntimeProductAPI()) return this.runtimeProductStore?.canUseMethod(method) ?? false
        if (this.runtimeProductStore && this.shouldUseRuntimeProductStoresForInitialization() && !this.shouldUseRuntimeProductAPI()) return false
        if (!this.shouldUseRuntimeProductAPI()) return true
        return this.runtimeProductStore?.canUseMethod(method) ?? false
    }

    async canUseProductMethodAfterConnect(method: OpenADEMethod): Promise<boolean> {
        if (!this.usesCoreOwnedProductRuntime()) return this.canUseProductMethod(method)
        const store = this.attachRuntimeProductStoreForCoreOwned()
        if (!store) return false
        return store.canUseMethodAfterConnect(method)
    }

    async ensureCoreOwnedProductMethodsAvailable(methods: readonly OpenADEMethod[]): Promise<void> {
        if (!this.usesCoreOwnedProductRuntime()) return
        const store = this.attachRuntimeProductStoreForCoreOwned()
        if (!store) return
        await Promise.all(methods.map((method) => store.canUseMethodAfterConnect(method)))
    }

    canUseRuntimeProductTaskRouteModelSource(): boolean {
        if (!this.shouldUseRuntimeProductTaskRoute()) return false
        if (this.canUseProductMethod(OPENADE_METHOD.taskRead)) return true
        if (!this.usesCoreOwnedProductRuntime()) return false
        if (!this.runtimeProductStore) return true
        return this.runtimeProductStoreStatus === "disabled" || this.runtimeProductStoreStatus === "loading"
    }

    shouldUseRuntimeProductProjectListProjection(): boolean {
        return this.usesCoreOwnedProductRuntime() || this.hasRuntimeProductProjectListProjection()
    }

    getRuntimeProductProjectProjection(): OpenADEProject[] | null {
        if (this.shouldUseRuntimeProductProjectListProjection()) return Array.from(this.runtimeProductProjects.values())
        if (this.hasRuntimeProductSnapshotProjection() && this.runtimeProductSnapshot) return this.runtimeProductSnapshot.repos
        return null
    }

    trackRepoListFallbackIfNeeded(): void {
        if (this.getRuntimeProductProjectProjection() !== null) return
        if (this.usesCoreOwnedProductRuntime()) return
        if (this.repoStore?.repos.all().length) {
            this.trackRuntimeProductFallback("repo_list", this.hasRuntimeProductSnapshotProjection() ? "runtime_repo_missing" : "snapshot_unavailable")
        }
    }

    getRuntimeProductProject(repoId: string): OpenADEProject | null {
        if (this.shouldUseRuntimeProductProjectListProjection()) {
            return this.runtimeProductProjects.get(repoId) ?? this.runtimeProductSnapshot?.repos.find((repo) => repo.id === repoId) ?? null
        }
        return this.runtimeProductSnapshot?.repos.find((repo) => repo.id === repoId) ?? this.runtimeProductProjects.get(repoId) ?? null
    }

    getRuntimeProductTaskPreviewDto(repoId: string, taskId: string): OpenADETaskPreview | null {
        return this.runtimeProductTaskPreview(repoId, taskId) ?? this.runtimeProductTaskPreviewFromCachedTask(repoId, taskId)
    }

    getRuntimeProductTaskPreviews(repoId: string): OpenADETaskPreview[] | null {
        const project = this.getRuntimeProductProject(repoId)
        if (project) return project.tasks
        if (!this.shouldUseRuntimeProductTaskRoute()) return null

        const cachedPreviews: OpenADETaskPreview[] = []
        for (const task of this.runtimeProductTasks.values()) {
            if (task.repoId !== repoId) continue
            const preview = this.getRuntimeProductTaskPreviewDto(repoId, task.id)
            if (preview) cachedPreviews.push(preview)
        }
        return cachedPreviews.length > 0 ? cachedPreviews : null
    }

    getTaskPreviewsForRepo(repoId: string): OpenADETaskPreview[] {
        const runtimePreviews = this.getRuntimeProductTaskPreviews(repoId)
        if (runtimePreviews) return runtimePreviews

        if (this.shouldUseRuntimeProductTaskRoute()) return []

        const legacyPreviews = this.repoStore?.repos.get(repoId)?.tasks ?? []
        if (legacyPreviews.length > 0) {
            this.trackRuntimeProductFallback("task_previews", this.runtimeProductSnapshot ? "runtime_repo_missing" : "snapshot_unavailable")
        }
        return legacyPreviews
    }

    getTaskPreviewReposForStats(): Array<{ id: string; name: string; tasks: OpenADETaskPreview[] }> {
        if (this.shouldUseRuntimeProductProjectListProjection()) {
            return Array.from(this.runtimeProductProjects.values()).map((repo) => ({ id: repo.id, name: repo.name, tasks: repo.tasks }))
        }
        if (this.hasRuntimeProductSnapshotProjection() && this.runtimeProductSnapshot) {
            return this.runtimeProductSnapshot.repos.map((repo) => ({
                id: repo.id,
                name: repo.name,
                tasks: repo.tasks,
            }))
        }
        if (this.shouldUseRuntimeProductTaskRoute()) return []
        return this.repoStore?.repos.all().map((repo) => ({ id: repo.id, name: repo.name, tasks: repo.tasks })) ?? []
    }

    private replaceRuntimeProductProjects(projects: OpenADEProject[] | null): void {
        this.runtimeProductProjects.clear()
        for (const project of projects ?? []) {
            this.runtimeProductProjects.set(project.id, project)
        }
    }

    private syncRuntimeProductStoreCache(taskId?: string, repoIdHint?: string): void {
        const productStore = this.runtimeProductStore
        runInAction(() => {
            this.runtimeProductSnapshot = productStore?.snapshot ?? null
            const projects = productStore?.getCachedProjects() ?? this.runtimeProductSnapshot?.repos ?? null
            this.replaceRuntimeProductProjects(projects)
            if (this.runtimeProductSnapshot) {
                this.pruneRuntimeProductTasks(this.runtimeProductSnapshot)
            } else if (projects) {
                this.pruneRuntimeProductTasksForProjects(projects)
            }
            if (productStore && taskId) {
                const repoId = repoIdHint ?? this.runtimeProductTasks.get(taskId)?.repoId ?? this.findRuntimeProductRepoIdForTask(taskId)
                const task = repoId ? productStore.getCachedLightweightTask(repoId, taskId) : null
                if (task) this.cacheRuntimeProductTask(task, "lightweight")
            }
            if ((this.runtimeProductSnapshot || projects) && this.runtimeProductStoreStatus !== "loading") this.runtimeProductStoreStatus = "ready"
            this.runtimeProductStoreError = null
        })
    }

    private syncRuntimeProductTaskCache(taskId: string, repoIdHint?: string): void {
        const productStore = this.runtimeProductStore
        if (!productStore) return
        runInAction(() => {
            this.runtimeProductSnapshot = productStore.snapshot ?? this.runtimeProductSnapshot
            const repoId = repoIdHint ?? this.runtimeProductTasks.get(taskId)?.repoId ?? this.findRuntimeProductRepoIdForTask(taskId)
            const projects = productStore.getCachedProjects() ?? this.runtimeProductSnapshot?.repos ?? null
            const project = repoId ? (projects?.find((candidate) => candidate.id === repoId) ?? null) : null
            if (project) this.runtimeProductProjects.set(project.id, project)

            const task = repoId ? productStore.getCachedLightweightTask(repoId, taskId) : null
            if (task) this.cacheRuntimeProductTask(task, "lightweight")

            if ((this.runtimeProductSnapshot || project) && this.runtimeProductStoreStatus !== "loading") this.runtimeProductStoreStatus = "ready"
            this.runtimeProductStoreError = null
        })
    }

    private async handleRuntimeProductStoreNotification(notification: RuntimeNotification): Promise<boolean> {
        if (!this.runtimeProductStore) return false

        try {
            const handled = await this.runtimeProductStore.handleNotification(notification)
            runInAction(() => {
                this.runtimeProductSnapshot = this.runtimeProductStore?.snapshot ?? null
                const projects = this.runtimeProductStore?.getCachedProjects() ?? this.runtimeProductSnapshot?.repos ?? null
                this.replaceRuntimeProductProjects(projects)
                if (this.runtimeProductSnapshot) {
                    this.pruneRuntimeProductTasks(this.runtimeProductSnapshot)
                } else if (projects) {
                    this.pruneRuntimeProductTasksForProjects(projects)
                }
                const params = notificationRecord(notification)
                const taskId = typeof params.taskId === "string" ? params.taskId : null
                const clientRequestId = typeof params.clientRequestId === "string" ? params.clientRequestId : ""
                const acceptedLocalMutation = this.isAcceptedRuntimeProductMutationNotification(clientRequestId)
                const repoId =
                    typeof params.repoId === "string"
                        ? params.repoId
                        : taskId
                          ? (this.runtimeProductTasks.get(taskId)?.repoId ?? this.findRuntimeProductRepoIdForTask(taskId))
                          : null
                if (notification.method === OPENADE_NOTIFICATION.taskDeleted && taskId) {
                    this.clearDeletedRuntimeProductTask(taskId)
                } else if (repoId && taskId) {
                    const task = this.runtimeProductStore?.getCachedLightweightTask(repoId, taskId)
                    if (task) {
                        this.cacheRuntimeProductTask(task, "lightweight")
                        if (acceptedLocalMutation) {
                            this.markRuntimeProductRouteTaskReadFresh(repoId, taskId)
                        } else {
                            this.clearRuntimeProductRouteTaskReadLoadedAtForTask(taskId)
                        }
                    } else {
                        this.clearRuntimeProductRouteTaskReadLoadedAtForTask(taskId)
                    }
                }
                const hasProductProjection = this.runtimeProductSnapshot !== null || projects !== null
                if ((this.usesCoreOwnedProductRuntime() || hasProductProjection) && this.runtimeProductStoreStatus !== "loading") {
                    this.runtimeProductStoreStatus = "ready"
                }
                this.runtimeProductStoreError = null
            })
            return handled
        } catch (err) {
            const message = this.runtimeProductErrorMessage(err)
            runInAction(() => {
                this.runtimeProductStoreStatus = "error"
                this.runtimeProductStoreError = message
            })
            this.trackRuntimeProductStoreError("notification", err)
            console.warn("[CodeStore] Failed to refresh runtime product store from notification:", err)
            return false
        }
    }

    private cachedTerminalActionEventForSettledRuntime(taskId: string, runtime: RuntimeRecord | null): Task["events"][number] | null {
        if (!runtime) return null
        const runtimeStartedAt = timestampMs(runtime.startedAt)
        if (runtimeStartedAt === null) return null

        const runtimeEventId = runtime.scope.labels?.eventId
        const events = this.tasks.getTask(taskId)?.events ?? []
        for (let index = events.length - 1; index >= 0; index--) {
            const event = events[index]
            if (event.type !== "action") continue
            if (event.status !== "completed" && event.status !== "error" && event.status !== "stopped") continue
            if (runtimeEventId && event.id !== runtimeEventId) continue

            const eventSettledAt = timestampMs(event.completedAt ?? event.createdAt)
            if (eventSettledAt === null || eventSettledAt <= runtimeStartedAt) continue
            return event
        }
        return null
    }

    private notifyAfterTerminalActionEvent(taskId: string, event: Task["events"][number]): void {
        if (event.type !== "action") return
        this.execution.notifyAfterEvent(taskId, event.source.type, event.status === "completed" && event.result?.success !== false)
    }

    private hasPendingRuntimeTaskUpdateNotificationForTask(taskId: string): boolean {
        for (const key of this.pendingRuntimeTaskUpdateNotifications.keys()) {
            const [, keyTaskId] = key.split("\0")
            if (keyTaskId === taskId) return true
        }
        return false
    }

    private scheduleRuntimeTaskSettledNotification(taskId: string, runtime: RuntimeRecord | null): boolean {
        if (!this.shouldUseRuntimeProductTaskRoute()) return false
        if (!this.shouldRefreshRuntimeProductTaskDetail(taskId)) return false
        if (!this.hasPendingRuntimeTaskUpdateNotificationForTask(taskId)) return false

        const existing = this.runtimeTaskSettledTimers.get(taskId)
        if (existing) clearTimeout(existing)

        const timer = setTimeout(() => {
            this.runtimeTaskSettledTimers.delete(taskId)
            void this.notifyRuntimeTaskSettled(taskId, runtime).catch((err) => {
                console.warn("[CodeStore] Failed to notify runtime task settled:", err)
            })
        }, RUNTIME_TASK_SETTLED_REFRESH_DELAY_MS)
        this.runtimeTaskSettledTimers.set(taskId, timer)
        return true
    }

    private async notifyRuntimeTaskSettled(taskId: string, runtime: RuntimeRecord | null): Promise<void> {
        const cachedTerminalEvent = this.cachedTerminalActionEventForSettledRuntime(taskId, runtime)
        if (cachedTerminalEvent) {
            this.notifyAfterTerminalActionEvent(taskId, cachedTerminalEvent)
            return
        }

        const refreshed = await this.refreshProductTaskAfterRuntimeNotification(taskId)
        if (!refreshed) return
        const events = this.tasks.getTask(taskId)?.events ?? []
        for (let index = events.length - 1; index >= 0; index--) {
            const event = events[index]
            if (event.type !== "action") continue
            if (event.status !== "completed" && event.status !== "error" && event.status !== "stopped") continue
            this.notifyAfterTerminalActionEvent(taskId, event)
            return
        }
    }

    private async refreshProductSnapshotAfterRuntimeNotification(): Promise<void> {
        if (this.shouldUseRuntimeProductTaskRoute() && !this.shouldUseRuntimeProductAPI() && !this.hasRuntimeProductProjectionToRepair()) {
            return
        }

        if (this.usesCoreOwnedProductRuntime() && !this.hasRuntimeProductProjectionToRepair()) {
            return
        }

        if (this.shouldUseRuntimeProductAPI()) {
            await this.refreshRuntimeProductProjection({ bypassCache: true })
            return
        }

        if (this.usesCoreOwnedProductRuntime()) {
            await this.refreshRuntimeProductProjection({ bypassCache: true })
            return
        }

        await this.refreshRepoStoreFromStorage()
    }

    private hasRuntimeProductProjectionToRepair(): boolean {
        return this.runtimeProductSnapshot !== null || this.runtimeProductProjects.size > 0
    }

    private shouldRefreshRuntimeProductTaskDetail(taskId: string): boolean {
        return this.runtimeProductTasks.has(taskId) || this.getCachedRuntimeProductOpenADETask(taskId) !== null
    }

    private async refreshProductTaskAfterRuntimeNotification(taskId: string): Promise<boolean> {
        if (this.shouldUseRuntimeProductTaskRoute()) {
            if (!this.shouldRefreshRuntimeProductTaskDetail(taskId)) return false
            await this.refreshRuntimeProductTaskForTaskId(taskId, NOTIFICATION_RUNTIME_TASK_READ_OPTIONS)
            return true
        }

        await this.refreshTaskStoreFromStorage(taskId)
        return true
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
        const coreRolloutState = resolveCoreRolloutState()
        const projection = this.runtimeProductProjectionTelemetry()
        track("app_opened", {
            deviceIdSource,
            deviceConfigWasGenerated: deviceConfig?.wasGenerated ?? false,
            deviceConfigReadFailed: deviceConfig?.readFailed ?? false,
            runtimeProductStoreEnabled: this.shouldEnableRuntimeProductStore(),
            runtimeProductStoreStatus: this.runtimeProductStoreStatus,
            runtimeProductStoreHasSnapshot: projection.hasSnapshot,
            runtimeProductStoreHasProjectProjection: projection.hasProjectProjection,
            runtimeProductStoreRepoCount: projection.repoCount,
            runtimeProductStoreTaskPreviewCount: projection.taskPreviewCount,
            runtimeProductStoreCachedTaskCount: projection.cachedTaskCount,
            runtimeProductTransport: selectedLocalProductRuntime().source,
            coreRolloutStatus: coreRolloutState?.status ?? "unavailable",
            coreRolloutSource: coreRolloutState?.source ?? "unavailable",
            coreRolloutReason: coreRolloutState?.reason ?? "unavailable",
            coreRolloutAutomatic: coreRolloutState?.automatic ?? false,
            coreLegacyYjsDocumentsPresent: coreRolloutState?.legacyYjsDocumentsPresent ?? false,
            coreLegacyYjsMigrationAccepted: coreRolloutState?.legacyYjsMigrationAccepted ?? false,
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
        if (this.usesCoreOwnedProductRuntime()) {
            throw new Error("Legacy task stores are disabled while Core owns product state")
        }
        if (this.shouldEnableRuntimeProductStore()) {
            this.trackRuntimeProductFallback("task_store", this.runtimeProductSnapshot ? "direct_task_store_read" : "snapshot_unavailable")
        }
        if (this.shouldUseRuntimeProductAPI()) {
            throw new Error("Legacy task stores are disabled while Core owns product state")
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

    async backfillTaskUsagePreviews(tasks: Array<{ repoId: string; taskId: string }>): Promise<void> {
        if (tasks.length === 0) return

        if (this.shouldUseRuntimeProductAPI() && this.runtimeProductStore && this.usesCoreOwnedProductRuntime()) {
            if (!this.canUseProductMethod(OPENADE_METHOD.taskUsageBackfill)) return

            const taskIdsByRepo = new Map<string, string[]>()
            for (const task of tasks) {
                const preview = this.runtimeProductTaskPreview(task.repoId, task.taskId)
                if (!preview || !needsTaskUsageBackfill(preview.usage)) continue
                taskIdsByRepo.set(task.repoId, [...(taskIdsByRepo.get(task.repoId) ?? []), task.taskId])
            }

            for (const [repoId, taskIds] of taskIdsByRepo) {
                await this.runtimeProductStore.backfillTaskUsage({ repoId, taskIds })
            }
            this.syncRuntimeProductStoreCache()
            return
        }
        if (this.usesCoreOwnedProductRuntime()) return

        for (const task of tasks) {
            await this.backfillTaskUsagePreview(task.repoId, task.taskId)
        }
    }

    async backfillTaskUsagePreview(repoId: string, taskId: string): Promise<void> {
        if (this.shouldUseRuntimeProductAPI() && this.runtimeProductStore) {
            const preview = this.runtimeProductTaskPreview(repoId, taskId)
            if (!preview || !needsTaskUsageBackfill(preview.usage)) return

            if (this.usesCoreOwnedProductRuntime()) {
                if (!this.canUseProductMethod(OPENADE_METHOD.taskUsageBackfill)) return

                await this.runtimeProductStore.backfillTaskUsage({ repoId, taskIds: [taskId] })
                this.syncRuntimeProductStoreCache(taskId)
                return
            }

            if (!this.canUseProductMethod(OPENADE_METHOD.taskMetadataUpdate)) return

            const task = await this.loadRuntimeProductTask(repoId, taskId)
            const usage = task ? computeTaskUsage(task.events) : normalizeTaskPreviewUsage(preview.usage)
            await this.updateProductTaskMetadata({ taskId, usage })
            return
        }
        if (this.usesCoreOwnedProductRuntime()) return

        if (!this.repoStore) {
            throw new Error("RepoStore not initialized")
        }

        const preview = getTaskPreview(this.repoStore, repoId, taskId)
        if (!preview || !needsTaskUsageBackfill(preview.usage)) return

        const cached = this.taskStoreConnections.get(taskId)
        if (cached) {
            if (cached.store.meta.current.id === taskId) {
                await this.updateProductTaskMetadata({ taskId, usage: computeTaskUsage(cached.store.events.all()) })
                await this.refreshRepoStoreFromStorage()
            } else {
                await this.updateProductTaskMetadata({ taskId, usage: normalizeTaskPreviewUsage(preview.usage) })
                await this.refreshRepoStoreFromStorage()
                this.disconnectTaskStore(taskId)
            }
            return
        }

        const connection = await loadTaskStore({ taskId })
        try {
            if (connection.store.meta.current.id === taskId) {
                await this.updateProductTaskMetadata({ taskId, usage: computeTaskUsage(connection.store.events.all()) })
            } else {
                await this.updateProductTaskMetadata({ taskId, usage: normalizeTaskPreviewUsage(preview.usage) })
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
        if (this.shouldUseRuntimeProductTaskRoute()) {
            return
        }

        if (this.repoStoreConnection) {
            await this.repoStoreConnection.sync()
        }
    }

    async refreshRepoStoreFromStorage(): Promise<void> {
        if (this.shouldUseRuntimeProductTaskRoute()) {
            if (!this.shouldUseRuntimeProductAPI() && !this.hasRuntimeProductProjectionToRepair()) return
            await this.refreshRuntimeProductProjection()
            return
        }

        await this.repoStoreConnection?.refresh()
    }

    async refreshTaskStoreFromStorage(taskId: string): Promise<void> {
        if (this.shouldUseRuntimeProductTaskRoute()) {
            await this.refreshRuntimeProductTaskById(taskId)
            return
        }

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
        if (this.shouldUseRuntimeProductTaskRoute()) {
            const repoId = this.runtimeProductTasks.get(taskId)?.repoId ?? this.findRuntimeProductRepoIdForTask(taskId)
            if (repoId) {
                const refreshTask = this.refreshRuntimeProductTaskForTaskId(taskId, NOTIFICATION_RUNTIME_TASK_READ_OPTIONS)
                if (this.hasRuntimeProductProjectProjectionForRepo(repoId)) {
                    await Promise.all([this.loadRuntimeProductTaskPreviews(repoId, { bypassCache: true }), refreshTask])
                    return
                }
                await refreshTask
                return
            }

            if (!this.hasRuntimeProductProjectionToRepair()) {
                return
            }

            await this.refreshRuntimeProductProjection({ bypassCache: true })
            await this.refreshRuntimeProductTaskForTaskId(taskId, NOTIFICATION_RUNTIME_TASK_READ_OPTIONS)
            return
        }

        await this.refreshTaskStoreFromStorage(taskId)
        await this.refreshRepoStoreFromStorage()
    }

    async refreshProductStateAfterTaskCreation(repoId: string, taskId: string): Promise<void> {
        if (this.shouldUseRuntimeProductTaskRoute()) {
            const refreshTask = this.getRuntimeProductTask(repoId, taskId, LIGHTWEIGHT_RUNTIME_TASK_READ_OPTIONS, { bypassCache: true })
            if (this.hasRuntimeProductProjectProjectionForRepo(repoId)) {
                await Promise.all([this.loadRuntimeProductTaskPreviews(repoId, { bypassCache: true }), refreshTask])
                return
            }
            await refreshTask
            return
        }

        await this.refreshRepoStoreFromStorage()
        await this.getTaskStore(repoId, taskId)
    }

    async refreshProductStateAfterTaskDeletion(taskId: string): Promise<void> {
        this.disconnectTaskStore(taskId)

        if (this.shouldUseRuntimeProductTaskRoute()) {
            runInAction(() => {
                this.clearDeletedRuntimeProductTask(taskId)
                this.runtimeProductSnapshot = this.runtimeProductStore?.snapshot ?? this.runtimeProductSnapshot
                const projects = this.runtimeProductStore?.getCachedProjects() ?? this.runtimeProductSnapshot?.repos ?? null
                this.replaceRuntimeProductProjects(projects)
                if (this.runtimeProductSnapshot) {
                    this.pruneRuntimeProductTasks(this.runtimeProductSnapshot)
                } else if (projects) {
                    this.pruneRuntimeProductTasksForProjects(projects)
                }
            })
            return
        }

        await this.refreshRepoStoreFromStorage()
    }

    async refreshProductStateAfterRepoMutation(): Promise<void> {
        if (this.shouldUseRuntimeProductTaskRoute()) {
            if (!this.hasRuntimeProductProjectionToRepair()) return
            await this.refreshRuntimeProductProjection({ bypassCache: true })
            return
        }

        await this.refreshRepoStoreFromStorage()
    }

    async createProductRepo(params: OpenADERepoCreateRequest): Promise<OpenADERepoCreateResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.repoCreate)
        if (productStore) {
            const result = await productStore.createRepo(params)
            this.syncRuntimeProductStoreCache()
            return result
        }

        return this.legacyProductClient(OPENADE_METHOD.repoCreate).createRepo(params)
    }

    async inspectProductRepoPath(params: OpenADERepoPathInspectRequest): Promise<OpenADERepoPathInspectResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.repoPathInspect)
        if (productStore) {
            return productStore.inspectRepoPath(params)
        }
        return this.legacyProductClient(OPENADE_METHOD.repoPathInspect).inspectRepoPath(params)
    }

    async updateProductRepo(params: OpenADERepoUpdateRequest): Promise<void> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.repoUpdate)
        if (productStore) {
            await productStore.updateRepo(params)
            this.syncRuntimeProductStoreCache()
            return
        }

        await this.legacyProductClient(OPENADE_METHOD.repoUpdate).updateRepo(params)
    }

    async deleteProductRepo(params: OpenADERepoDeleteRequest): Promise<void> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.repoDelete)
        if (productStore) {
            const taskIds = this.runtimeProductTaskIdsForRepo(params.repoId)
            await productStore.deleteRepo(params)
            this.syncRuntimeProductStoreCache()
            this.clearRuntimeProductRepoState(params.repoId, taskIds)
            return
        }

        await this.legacyProductClient(OPENADE_METHOD.repoDelete).deleteRepo(params)
    }

    async createProductTask(params: OpenADETaskCreateRequest): Promise<OpenADETaskCreateResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskCreate)
        if (productStore) {
            const result = await productStore.createTask(params)
            this.syncRuntimeProductTaskCache(result.taskId, params.repoId)
            return result
        }

        return this.legacyProductClient(OPENADE_METHOD.taskCreate).createTask(params)
    }

    async startProductTurn(params: OpenADETurnStartRequest): Promise<OpenADETurnStartResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.turnStart)
        if (productStore) {
            const result = await productStore.startTurn(params)
            const taskId = result.taskId || params.inTaskId || undefined
            if (taskId) this.syncRuntimeProductTaskCache(taskId, params.repoId)
            else this.syncRuntimeProductStoreCache()
            return result
        }

        return this.legacyProductClient(OPENADE_METHOD.turnStart).startTurn(params)
    }

    async persistProductTaskImage(payload: ImagePersistencePayload): Promise<void> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskImageWrite)
        if (productStore) {
            const request = imagePersistencePayloadToWriteRequest(payload)
            await productStore.writeTaskImage(request)
            return
        }

        await persistImageToDataFolder(payload)
    }

    async readProductTaskImage(params: OpenADETaskImageReadRequest): Promise<OpenADETaskImageReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskImageRead)
        if (productStore) {
            return productStore.readTaskImage(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskImageRead).readTaskImage(params)
    }

    async readProductStagedTaskImage(params: OpenADETaskImageStagedReadRequest): Promise<OpenADETaskImageStagedReadResult | null> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskImageStagedRead)
        if (productStore) {
            return productStore.readStagedTaskImage(params)
        }

        return null
    }

    async importProductLegacyResources(params: OpenADELegacyResourcesImportRequest): Promise<OpenADELegacyResourcesImportResult> {
        const productStore = this.coreMigrationProductStore()
        try {
            const result = await productStore.importLegacyResources(params)
            if (productStore === this.runtimeProductStore) {
                this.syncRuntimeProductStoreCache()
                runInAction(() => {
                    this.runtimeProductStoreStatus = "ready"
                    this.runtimeProductStoreError = null
                })
            }
            return result
        } catch (err) {
            const message = this.runtimeProductErrorMessage(err)
            if (productStore === this.runtimeProductStore) {
                runInAction(() => {
                    this.runtimeProductStoreStatus = "error"
                    this.runtimeProductStoreError = message
                })
            }
            this.trackRuntimeProductStoreError("legacy_resources_import", err)
            throw err
        }
    }

    async importProductLegacyYjsData(): Promise<OpenADEProductLegacyYjsImportReport> {
        const productStore = this.coreMigrationProductStore()

        try {
            const projection = createOpenADEYjsProjection(createElectronOpenADEYjsStorageAdapter())
            const result = await productStore.importLegacyYjsData(projection)
            const snapshot = productStore.snapshot
            if (productStore === this.runtimeProductStore && snapshot) {
                runInAction(() => {
                    this.runtimeProductSnapshot = snapshot
                    this.replaceRuntimeProductProjects(snapshot.repos)
                    this.pruneRuntimeProductTasks(snapshot)
                    this.runtimeProductStoreStatus = "ready"
                    this.runtimeProductStoreError = null
                })
            }
            return { ...result, legacyYjsMigrationAccepted: false }
        } catch (err) {
            const message = this.runtimeProductErrorMessage(err)
            if (productStore === this.runtimeProductStore) {
                runInAction(() => {
                    this.runtimeProductStoreStatus = "error"
                    this.runtimeProductStoreError = message
                })
            }
            this.trackRuntimeProductStoreError("legacy_yjs_import", err)
            throw err
        }
    }

    async markProductLegacyYjsMigrationAccepted(report: OpenADEProductLegacyYjsImportReport, resources: OpenADELegacyResourcesImportResult): Promise<void> {
        const coreEndpoint = resolveCoreRuntimeEndpoint() ?? resolveCoreMigrationRuntimeEndpoint()
        if (!coreEndpoint) {
            throw new Error("OpenADE Core is not connected.")
        }
        await markCoreLegacyYjsMigrationAccepted(report, resources)
    }

    async revokeProductLegacyYjsMigrationAcceptance(): Promise<void> {
        const coreEndpoint = resolveCoreRuntimeEndpoint() ?? resolveCoreMigrationRuntimeEndpoint()
        if (!coreEndpoint) {
            throw new Error("OpenADE Core is not connected.")
        }
        await revokeCoreLegacyYjsMigrationAcceptance()
    }

    async startProductReview(params: OpenADEReviewStartRequest): Promise<OpenADEReviewStartResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.reviewStart)
        if (productStore) {
            const result = await productStore.startReview(params)
            this.syncRuntimeProductTaskCache(result.taskId, params.repoId)
            return result
        }

        return this.legacyProductClient(OPENADE_METHOD.reviewStart).startReview(params)
    }

    async interruptProductTurn(taskId: string): Promise<void> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.turnInterrupt)
        if (productStore) {
            await productStore.interruptTurn(taskId)
            return
        }

        await this.legacyProductClient(OPENADE_METHOD.turnInterrupt).interruptTurn(taskId)
    }

    async cancelProductQueuedTurn(params: OpenADEQueuedTurnCancelRequest): Promise<OpenADEQueuedTurnCancelResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.queuedTurnCancel)
        if (productStore) {
            const result = await productStore.cancelQueuedTurn(params)
            this.syncRuntimeProductTaskCache(params.taskId)
            return result
        }

        return this.legacyProductClient(OPENADE_METHOD.queuedTurnCancel).cancelQueuedTurn(params)
    }

    async updateProductTaskMetadata(params: OpenADETaskMetadataUpdateRequest): Promise<void> {
        const scopedParams = this.withRuntimeProductTaskRepoId(params)
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskMetadataUpdate)
        if (productStore) {
            const taggedParams = {
                ...scopedParams,
                clientRequestId: scopedParams.clientRequestId ?? createCodeStoreClientRequestId(),
            }
            this.trackAcceptedRuntimeProductMutationNotification(taggedParams.clientRequestId)
            try {
                await productStore.updateTaskMetadata(taggedParams)
                this.syncRuntimeProductTaskCache(taggedParams.taskId, taggedParams.repoId)
            } catch (error) {
                this.acceptedRuntimeProductMutationNotifications.delete(taggedParams.clientRequestId)
                throw error
            }
            return
        }

        await this.legacyProductClient(OPENADE_METHOD.taskMetadataUpdate).updateTaskMetadata(scopedParams)
    }

    patchRuntimeProductTaskMetadata(params: OpenADETaskMetadataUpdateRequest): boolean {
        if (!this.shouldUseRuntimeProductTaskRoute() || !this.runtimeProductStore) return false
        const scopedParams = this.withRuntimeProductTaskRepoId(params)
        this.runtimeProductStore.patchTaskMetadata(scopedParams)
        this.syncRuntimeProductTaskCache(scopedParams.taskId, scopedParams.repoId)
        return true
    }

    private withRuntimeProductTaskRepoId(params: OpenADETaskMetadataUpdateRequest): OpenADETaskMetadataUpdateRequest {
        if (params.repoId) return params
        const repoId = this.runtimeProductTasks.get(params.taskId)?.repoId ?? this.findRuntimeProductRepoIdForTask(params.taskId)
        return repoId ? { ...params, repoId } : params
    }

    async generateProductTaskTitle(params: OpenADETaskTitleGenerateRequest): Promise<OpenADETaskTitleGenerateResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskTitleGenerate)
        if (productStore) {
            const result = await productStore.generateTaskTitle(params)
            this.syncRuntimeProductTaskCache(params.taskId)
            return result
        }

        return this.legacyProductClient(OPENADE_METHOD.taskTitleGenerate).generateTaskTitle(params)
    }

    async setupProductTaskEnvironment(params: OpenADETaskEnvironmentSetupRequest): Promise<void> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskEnvironmentSetup)
        if (productStore) {
            await productStore.setupTaskEnvironment(params)
            this.syncRuntimeProductTaskCache(params.taskId)
            return
        }

        await this.legacyProductClient(OPENADE_METHOD.taskEnvironmentSetup).setupTaskEnvironment(params)
    }

    async prepareProductTaskEnvironment(params: OpenADETaskEnvironmentPrepareRequest): Promise<OpenADETaskEnvironmentPrepareResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskEnvironmentPrepare)
        if (productStore) {
            const result = await productStore.prepareTaskEnvironment(params)
            this.syncRuntimeProductTaskCache(params.taskId)
            return result
        }

        return this.legacyProductClient(OPENADE_METHOD.taskEnvironmentPrepare).prepareTaskEnvironment(params)
    }

    async createProductComment(params: OpenADECommentCreateRequest): Promise<OpenADECommentCreateResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.commentCreate)
        if (productStore) {
            const result = await productStore.createComment(params)
            this.syncRuntimeProductTaskCache(params.taskId)
            return result
        }

        return this.legacyProductClient(OPENADE_METHOD.commentCreate).createComment(params)
    }

    async editProductComment(params: OpenADECommentEditRequest): Promise<void> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.commentEdit)
        if (productStore) {
            await productStore.editComment(params)
            this.syncRuntimeProductTaskCache(params.taskId)
            return
        }

        await this.legacyProductClient(OPENADE_METHOD.commentEdit).editComment(params)
    }

    async deleteProductComment(params: OpenADECommentDeleteRequest): Promise<void> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.commentDelete)
        if (productStore) {
            await productStore.deleteComment(params)
            this.syncRuntimeProductTaskCache(params.taskId)
            return
        }

        await this.legacyProductClient(OPENADE_METHOD.commentDelete).deleteComment(params)
    }

    async deleteProductTask(params: OpenADETaskDeleteRequest): Promise<OpenADETaskDeleteResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskDelete)
        if (productStore) {
            const result = await productStore.deleteTask(params)
            this.syncRuntimeProductStoreCache()
            runInAction(() => {
                this.clearDeletedRuntimeProductTask(params.taskId)
            })
            return result
        }

        return this.legacyProductClient(OPENADE_METHOD.taskDelete).deleteTask(params)
    }

    async readProductTaskChanges(params: OpenADETaskChangesReadRequest): Promise<OpenADETaskChangesReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskChangesRead)
        if (productStore) {
            return productStore.readTaskChanges(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskChangesRead).readTaskChanges(params)
    }

    async readProductTaskGitSummary(params: OpenADETaskGitSummaryRequest, options: OpenADEProductReadOptions = {}): Promise<OpenADETaskGitSummaryResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskGitSummaryRead)
        if (productStore) {
            return productStore.readTaskGitSummary(params, options)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskGitSummaryRead).readTaskGitSummary(params)
    }

    async readProductTaskGitScopes(params: OpenADETaskGitScopesReadRequest): Promise<OpenADETaskGitScopesReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskGitScopesRead)
        if (productStore) {
            return productStore.readTaskGitScopes(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskGitScopesRead).readTaskGitScopes(params)
    }

    async readProductTaskResourceInventory(params: OpenADETaskResourceInventoryReadRequest): Promise<OpenADETaskResourceInventoryReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskResourceInventoryRead)
        if (productStore) {
            return productStore.readTaskResourceInventory(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskResourceInventoryRead).readTaskResourceInventory(params)
    }

    async readProductMcpServers(): Promise<OpenADEMCPServersReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.settingsMcpServersRead)
        if (productStore) {
            return productStore.readMcpServers()
        }

        return this.legacyProductClient(OPENADE_METHOD.settingsMcpServersRead).readMcpServers()
    }

    async replaceProductMcpServers(params: OpenADEMCPServersReplaceRequest): Promise<OpenADEMCPServersReplaceResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.settingsMcpServersReplace)
        if (productStore) {
            return productStore.replaceMcpServers(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.settingsMcpServersReplace).replaceMcpServers(params)
    }

    async upsertProductMcpServer(params: OpenADEMCPServerUpsertRequest): Promise<OpenADEMCPServerUpsertResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.settingsMcpServersUpsert)
        if (productStore) {
            return productStore.upsertMcpServer(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.settingsMcpServersUpsert).upsertMcpServer(params)
    }

    async deleteProductMcpServer(params: OpenADEMCPServerDeleteRequest): Promise<OpenADEMCPServerDeleteResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.settingsMcpServersDelete)
        if (productStore) {
            return productStore.deleteMcpServer(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.settingsMcpServersDelete).deleteMcpServer(params)
    }

    async readProductTaskDiff(params: OpenADETaskDiffReadRequest): Promise<OpenADETaskDiffReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskDiffRead)
        if (productStore) {
            return productStore.readTaskDiff(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskDiffRead).readTaskDiff(params)
    }

    async readProductTaskFilePair(params: OpenADETaskFilePairReadRequest): Promise<OpenADETaskFilePairReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskFilePairRead)
        if (productStore) {
            return productStore.readTaskFilePair(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskFilePairRead).readTaskFilePair(params)
    }

    async listProductProjectFiles(params: OpenADEProjectFilesTreeRequest): Promise<OpenADEProjectFilesTreeResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.projectFilesTree)
        if (productStore) {
            return productStore.listProjectFiles(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.projectFilesTree).listProjectFiles(params)
    }

    async readProductProjectFile(params: OpenADEProjectFileReadRequest): Promise<OpenADEProjectFileReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.projectFileRead)
        if (productStore) {
            return productStore.readProjectFile(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.projectFileRead).readProjectFile(params)
    }

    private runRuntimeProductFuzzySearch(
        productStore: OpenADEProductStore,
        params: OpenADEProjectFilesFuzzySearchRequest
    ): Promise<OpenADEProjectFilesFuzzySearchResult> {
        const key = runtimeProductFuzzySearchKey(params)
        const existing = this.runtimeProductFuzzySearchInFlight.get(key)
        if (existing) return existing

        const search = productStore.fuzzySearchProjectFiles(params).finally(() => {
            if (this.runtimeProductFuzzySearchInFlight.get(key) === search) this.runtimeProductFuzzySearchInFlight.delete(key)
        })
        this.runtimeProductFuzzySearchInFlight.set(key, search)
        return search
    }

    async fuzzySearchProductProjectFiles(params: OpenADEProjectFilesFuzzySearchRequest): Promise<OpenADEProjectFilesFuzzySearchResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.projectFilesFuzzySearch)
        if (productStore) {
            return this.runRuntimeProductFuzzySearch(productStore, params)
        }

        return this.legacyProductClient(OPENADE_METHOD.projectFilesFuzzySearch).fuzzySearchProjectFiles(params)
    }

    async writeProductProjectFile(params: OpenADEProjectFileWriteRequest): Promise<OpenADEProjectFileWriteResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.projectFileWrite)
        if (productStore) {
            return productStore.writeProjectFile(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.projectFileWrite).writeProjectFile(params)
    }

    async searchProductProject(params: OpenADEProjectSearchRequest): Promise<OpenADEProjectSearchResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.projectSearch)
        if (productStore) {
            return productStore.searchProject(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.projectSearch).searchProject(params)
    }

    async readProductProjectSdkCapabilities(params: OpenADEProjectSdkCapabilitiesReadRequest): Promise<OpenADESdkCapabilities> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.projectSdkCapabilitiesRead)
        if (productStore) {
            return productStore.readProjectSdkCapabilities(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.projectSdkCapabilitiesRead).readProjectSdkCapabilities(params)
    }

    async readProductProjectGitInfo(params: OpenADEProjectGitInfoRequest): Promise<OpenADEProjectGitInfoResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.projectGitInfoRead)
        if (productStore) {
            return productStore.readProjectGitInfo(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.projectGitInfoRead).readProjectGitInfo(params)
    }

    async readProductProjectGitBranches(params: OpenADEProjectGitBranchesReadRequest): Promise<OpenADEProjectGitBranchesReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.projectGitBranchesRead)
        if (productStore) {
            return productStore.readProjectGitBranches(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.projectGitBranchesRead).readProjectGitBranches(params)
    }

    async readProductProjectGitSummary(
        params: OpenADEProjectGitSummaryReadRequest,
        options: OpenADEProductReadOptions = {}
    ): Promise<OpenADEProjectGitSummaryReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.projectGitSummaryRead)
        if (productStore) {
            return productStore.readProjectGitSummary(params, options)
        }

        return this.legacyProductClient(OPENADE_METHOD.projectGitSummaryRead).readProjectGitSummary(params)
    }

    async listProductProjectProcesses(
        params: OpenADEProjectProcessListRequest,
        options: OpenADEProductReadOptions = {}
    ): Promise<OpenADEProjectProcessListResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.projectProcessList)
        if (productStore) {
            return productStore.listProjectProcesses(params, options)
        }

        return this.legacyProductClient(OPENADE_METHOD.projectProcessList).listProjectProcesses(params)
    }

    async readProductCronDefinitions(params: OpenADECronDefinitionsReadRequest): Promise<OpenADECronDefinitionsReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.cronDefinitionsRead)
        if (productStore) {
            return productStore.readCronDefinitions(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.cronDefinitionsRead).readCronDefinitions(params)
    }

    async startProductProjectProcess(params: OpenADEProjectProcessStartRequest): Promise<OpenADEProjectProcessStartResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.projectProcessStart)
        if (productStore) {
            return productStore.startProjectProcess(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.projectProcessStart).startProjectProcess(params)
    }

    async reconnectProductProjectProcess(params: OpenADEProjectProcessReconnectRequest): Promise<OpenADEProjectProcessReconnectResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.projectProcessReconnect)
        if (productStore) {
            return productStore.reconnectProjectProcess(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.projectProcessReconnect).reconnectProjectProcess(params)
    }

    async stopProductProjectProcess(params: OpenADEProjectProcessStopRequest): Promise<OpenADEProjectProcessStopResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.projectProcessStop)
        if (productStore) {
            return productStore.stopProjectProcess(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.projectProcessStop).stopProjectProcess(params)
    }

    async readProductCronInstallState(params: OpenADECronInstallStateReadRequest): Promise<OpenADECronInstallStateReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.cronInstallStateRead)
        if (productStore) {
            return productStore.readCronInstallState(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.cronInstallStateRead).readCronInstallState(params)
    }

    async listProductCronInstallStateRepos(): Promise<OpenADECronInstallStateListResult | null> {
        if (this.shouldUseRuntimeProductTaskRoute()) {
            const productStore = await this.runtimeProductStoreForMethodIfAvailable(OPENADE_METHOD.cronInstallStateList)
            if (!productStore) return null
            return productStore.listCronInstallStateRepos()
        }

        if (!localOpenADEClient.hasMethod(OPENADE_METHOD.cronInstallStateList)) return null
        return this.legacyProductClient(OPENADE_METHOD.cronInstallStateList).listCronInstallStateRepos()
    }

    async replaceProductCronInstallState(params: OpenADECronInstallStateReplaceRequest): Promise<OpenADECronInstallStateReplaceResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.cronInstallStateReplace)
        if (productStore) {
            return productStore.replaceCronInstallState(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.cronInstallStateReplace).replaceCronInstallState(params)
    }

    async runProductCron(params: OpenADECronRunRequest): Promise<OpenADECronRunResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.cronRun)
        if (productStore) {
            return productStore.runCron(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.cronRun).runCron(params)
    }

    async readProductTaskGitLog(params: OpenADETaskGitLogRequest): Promise<OpenADETaskGitLogResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskGitLog)
        if (productStore) {
            return productStore.readTaskGitLog(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskGitLog).readTaskGitLog(params)
    }

    async readProductTaskGitCommitFiles(params: OpenADETaskGitCommitFilesRequest): Promise<OpenADETaskGitCommitFilesResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskGitCommitFilesRead)
        if (productStore) {
            return productStore.readTaskGitCommitFiles(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskGitCommitFilesRead).readTaskGitCommitFiles(params)
    }

    async readProductTaskGitFileAtTreeish(params: OpenADETaskGitFileAtTreeishRequest): Promise<OpenADETaskGitFileAtTreeishResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskGitFileAtTreeishRead)
        if (productStore) {
            return productStore.readTaskGitFileAtTreeish(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskGitFileAtTreeishRead).readTaskGitFileAtTreeish(params)
    }

    async readProductTaskGitCommitFilePatch(params: OpenADETaskGitCommitFilePatchRequest): Promise<OpenADETaskGitCommitFilePatchResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskGitCommitFilePatchRead)
        if (productStore) {
            return productStore.readTaskGitCommitFilePatch(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskGitCommitFilePatchRead).readTaskGitCommitFilePatch(params)
    }

    async startProductTaskTerminal(params: OpenADETaskTerminalStartRequest): Promise<OpenADETaskTerminalStartResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskTerminalStart)
        if (productStore) {
            return productStore.startTaskTerminal(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskTerminalStart).startTaskTerminal(params)
    }

    async reconnectProductTaskTerminal(params: OpenADETaskTerminalReconnectRequest): Promise<OpenADETaskTerminalReconnectResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskTerminalReconnect)
        if (productStore) {
            return productStore.reconnectTaskTerminal(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskTerminalReconnect).reconnectTaskTerminal(params)
    }

    async writeProductTaskTerminal(params: OpenADETaskTerminalWriteRequest): Promise<OpenADETaskTerminalMutationResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskTerminalWrite)
        if (productStore) {
            return productStore.writeTaskTerminal(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskTerminalWrite).writeTaskTerminal(params)
    }

    async resizeProductTaskTerminal(params: OpenADETaskTerminalResizeRequest): Promise<OpenADETaskTerminalMutationResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskTerminalResize)
        if (productStore) {
            return productStore.resizeTaskTerminal(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskTerminalResize).resizeTaskTerminal(params)
    }

    async stopProductTaskTerminal(params: OpenADETaskTerminalStopRequest): Promise<OpenADETaskTerminalMutationResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskTerminalStop)
        if (productStore) {
            return productStore.stopTaskTerminal(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskTerminalStop).stopTaskTerminal(params)
    }

    async readProductTaskSnapshotPatch(params: OpenADETaskSnapshotPatchReadRequest): Promise<OpenADETaskSnapshotPatchReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskSnapshotPatchRead)
        if (productStore) {
            return productStore.readTaskSnapshotPatch(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskSnapshotPatchRead).readTaskSnapshotPatch(params)
    }

    async readProductTaskSnapshotIndex(params: OpenADETaskSnapshotIndexReadRequest): Promise<OpenADETaskSnapshotIndexReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskSnapshotIndexRead)
        if (productStore) {
            return productStore.readTaskSnapshotIndex(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskSnapshotIndexRead).readTaskSnapshotIndex(params)
    }

    async readProductTaskSnapshotPatchSlice(params: OpenADETaskSnapshotPatchSliceReadRequest): Promise<OpenADETaskSnapshotPatchSliceReadResult> {
        const productStore = await this.runtimeProductStoreForMethod(OPENADE_METHOD.taskSnapshotPatchReadSlice)
        if (productStore) {
            return productStore.readTaskSnapshotPatchSlice(params)
        }

        return this.legacyProductClient(OPENADE_METHOD.taskSnapshotPatchReadSlice).readTaskSnapshotPatchSlice(params)
    }

    async loadProductTaskForRead(repoId: string, taskId: string): Promise<Task | null> {
        if (this.shouldUseRuntimeProductTaskRoute()) {
            return this.loadRuntimeProductTask(repoId, taskId)
        }

        const cached = this.tasks.getTask(taskId)
        if (cached) return cached

        const taskStore = await this.getTaskStore(repoId, taskId)
        return taskFromStore(taskStore)
    }

    async reloadRepoStoreFromStorage(): Promise<void> {
        if (this.shouldUseRuntimeProductTaskRoute()) {
            if (!this.hasRuntimeProductProjectionToRepair()) return
            await this.refreshRuntimeProductProjection({ bypassCache: true })
            return
        }

        if (this.repoStoreConnection) {
            await this.repoStoreConnection.sync()
            this.repoStoreConnection.disconnect()
        }

        const repoConnection = await this.connectRepoStore()
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
        this.clearPendingRuntimeTaskUpdateNotifications()

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
        this.tasks.disposeDeferredViewedWrites()
        this.clearRuntimeProductStoreObserver()
        this.runtimeProductStore?.destroy()
        this.runtimeProductStore = null
        this.coreMigrationProductStoreEntry?.store.destroy()
        this.coreMigrationProductStoreEntry = null
        this.runtimeProductSnapshot = null
        this.runtimeProductProjects.clear()
        this.runtimeProductTasks.clear()
        this.runtimeProductTaskReadInFlight.clear()
        this.runtimeProductFuzzySearchInFlight.clear()
        this.runtimeProductTaskReadLoadedAt.clear()
        this.clearRuntimeProductRouteTaskReadLoadedAt()
        this.runtimeTaskRouteShellInitialized = false
        this.runtimeProductTaskVisibleReadMode.clear()
        this.trackedRuntimeProductFallbackKeys.clear()
        this.acceptedRuntimeProductMutationNotifications.clear()
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
