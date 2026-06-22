import type {
    OpenADEActionEventCompleteRequest,
    OpenADEActionEventCreateRequest,
    OpenADEActionEventCreateResult,
    OpenADEActionEventErrorRequest,
    OpenADEActionEventRuntimeReconcileRequest,
    OpenADEActionEventRuntimeReconcileResult,
    OpenADEActionEventStoppedRequest,
    OpenADEActionExecutionUpdateRequest,
    OpenADEActionStreamAppendRequest,
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
    OpenADEHyperPlanReconcileLabelsSetRequest,
    OpenADEHyperPlanSubExecutionAddRequest,
    OpenADEHyperPlanSubExecutionStreamAppendRequest,
    OpenADEHyperPlanSubExecutionUpdateRequest,
    OpenADELegacyResourcesImportRequest,
    OpenADELegacyResourcesImportResult,
    OpenADEMCPServerDeleteRequest,
    OpenADEMCPServerDeleteResult,
    OpenADEMCPServersReadResult,
    OpenADEMCPServersReplaceRequest,
    OpenADEMCPServersReplaceResult,
    OpenADEMCPServerUpsertRequest,
    OpenADEMCPServerUpsertResult,
    OpenADEPersonalSettingsReadResult,
    OpenADEPersonalSettingsReplaceRequest,
    OpenADEPersonalSettingsReplaceResult,
    OpenADEProjectFileReadRequest,
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesFuzzySearchRequest,
    OpenADEProjectFilesFuzzySearchResult,
    OpenADEProjectFilesTreeRequest,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectFileWriteRequest,
    OpenADEProjectFileWriteResult,
    OpenADEProjectGitBranchesReadRequest,
    OpenADEProjectGitBranchesReadResult,
    OpenADEProjectGitInfoRequest,
    OpenADEProjectGitInfoResult,
    OpenADEProjectGitSummaryReadRequest,
    OpenADEProjectGitSummaryReadResult,
    OpenADEProject,
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
    OpenADEQueuedTurnEnqueueRequest,
    OpenADEQueuedTurnEnqueueResult,
    OpenADEQueuedTurnImportLegacyRequest,
    OpenADEQueuedTurnImportLegacyResult,
    OpenADEQueuedTurnReorderRequest,
    OpenADEQueuedTurnReorderResult,
    OpenADERepoCreateRequest,
    OpenADERepoCreateResult,
    OpenADERepoDeleteRequest,
    OpenADERepoPathInspectRequest,
    OpenADERepoPathInspectResult,
    OpenADERepoUpdateRequest,
    OpenADESnapshot,
    OpenADESnapshotEventCreateRequest,
    OpenADESnapshotEventCreateResult,
    OpenADETask,
    OpenADETaskPreview,
    OpenADETaskChangesReadRequest,
    OpenADETaskChangesReadResult,
    OpenADETaskCreateRequest,
    OpenADETaskCreateResult,
    OpenADETaskReadOptions,
    OpenADETaskDeleteRequest,
    OpenADETaskDeleteResult,
    OpenADETaskTitleGenerateRequest,
    OpenADETaskTitleGenerateResult,
    OpenADETaskDiffReadRequest,
    OpenADETaskDiffReadResult,
    OpenADETaskFilePairReadRequest,
    OpenADETaskFilePairReadResult,
    OpenADETaskEnvironmentPrepareRequest,
    OpenADETaskEnvironmentPrepareResult,
    OpenADETaskEnvironmentSetupRequest,
    OpenADETaskGitCommitFilePatchRequest,
    OpenADETaskGitCommitFilePatchResult,
    OpenADETaskGitCommitFilesRequest,
    OpenADETaskGitCommitFilesResult,
    OpenADETaskGitCommitRequest,
    OpenADETaskGitCommitResult,
    OpenADETaskGitFileAtTreeishRequest,
    OpenADETaskGitFileAtTreeishResult,
    OpenADETaskGitLogRequest,
    OpenADETaskGitLogResult,
    OpenADETaskGitScopesReadRequest,
    OpenADETaskGitScopesReadResult,
    OpenADETaskGitSummaryRequest,
    OpenADETaskGitSummaryResult,
    OpenADETaskImageImportLegacyRequest,
    OpenADETaskImageImportLegacyResult,
    OpenADETaskImageReadRequest,
    OpenADETaskImageReadResult,
    OpenADETaskImageStagedReadRequest,
    OpenADETaskImageStagedReadResult,
    OpenADETaskImagesGCStagedRequest,
    OpenADETaskImagesGCStagedResult,
    OpenADETaskImagesImportLegacyRequest,
    OpenADETaskImagesImportLegacyResult,
    OpenADETaskImageWriteRequest,
    OpenADETaskImageWriteResult,
    OpenADETaskHarnessSessionsImportLegacyRequest,
    OpenADETaskHarnessSessionsImportLegacyResult,
    OpenADETaskResourceInventoryReadRequest,
    OpenADETaskResourceInventoryReadResult,
    OpenADETaskTerminalMutationResult,
    OpenADETaskTerminalReconnectRequest,
    OpenADETaskTerminalReconnectResult,
    OpenADETaskTerminalResizeRequest,
    OpenADETaskTerminalStartRequest,
    OpenADETaskTerminalStartResult,
    OpenADETaskTerminalStopRequest,
    OpenADETaskTerminalWriteRequest,
    OpenADETaskSnapshotIndexReadRequest,
    OpenADETaskSnapshotIndexReadResult,
    OpenADETaskSnapshotPatchReadRequest,
    OpenADETaskSnapshotPatchReadResult,
    OpenADETaskSnapshotPatchSliceReadRequest,
    OpenADETaskSnapshotPatchSliceReadResult,
    OpenADETaskSnapshotsImportLegacyRequest,
    OpenADETaskSnapshotsImportLegacyResult,
    OpenADETaskMetadataUpdateRequest,
    OpenADETaskUsageBackfillRequest,
    OpenADETaskUsageBackfillResult,
    OpenADETaskUsageRecalculateRequest,
    OpenADETaskUsageRecalculateResult,
    OpenADEReviewStartRequest,
    OpenADEReviewStartResult,
    OpenADESdkCapabilities,
    OpenADETurnStartRequest,
    OpenADETurnStartResult,
} from "../../openade-module/src/types"
import type { RuntimeCapabilities, RuntimeListParams, RuntimeNotification, RuntimeRecord } from "../../runtime-protocol/src"
import type { RuntimeClientStatus, RuntimeRequestOptions } from "../../runtime-client/src"
import {
    OPENADE_METHOD,
    OPENADE_METHODS,
    OPENADE_NOTIFICATION,
    OPENADE_NOTIFICATIONS,
    OPENADE_PERMISSION_PROFILE_PAIRED_NOTIFICATION_PERMISSIONS,
    OPENADE_PERMISSION_PROFILE_PAIRED_PERMISSIONS,
    OPENADE_READ_METHODS_TO_COALESCE as GENERATED_OPENADE_READ_METHODS_TO_COALESCE,
    OPENADE_REMOTE_METHOD,
    OPENADE_REMOTE_METHODS,
    type OpenADEMethod,
    type OpenADERequestForMethod,
    type OpenADEResponseForMethod,
    type OpenADERemoteMethod,
    type OpenADERemoteRequestForMethod,
    type OpenADERemoteResponseForMethod,
} from "./generated/openade-contracts"
export {
    OPENADE_METHOD,
    OPENADE_METHODS,
    OPENADE_NOTIFICATION,
    OPENADE_NOTIFICATIONS,
    OPENADE_PERMISSION_PROFILE_PAIRED_NOTIFICATION_PERMISSIONS,
    OPENADE_PERMISSION_PROFILE_PAIRED_PERMISSIONS,
    OPENADE_REMOTE_METHOD,
    OPENADE_REMOTE_METHODS,
}
export type {
    OpenADEMethod,
    OpenADENotificationMethod,
    OpenADERemoteMethod,
    OpenADERemoteRequestForMethod,
    OpenADERemoteResponseForMethod,
} from "./generated/openade-contracts"

export type OpenADEClientConnectionStatus = RuntimeClientStatus

export interface RuntimeClientLike {
    request<Method extends OpenADEMethod>(
        method: Method,
        ...[params]: undefined extends OpenADERequestForMethod<Method>
            ? [params?: OpenADERequestForMethod<Method>]
            : [params: OpenADERequestForMethod<Method>]
    ): Promise<OpenADEResponseForMethod<Method>>
    request<Method extends OpenADERemoteMethod>(
        method: Method,
        ...[params]: undefined extends OpenADERemoteRequestForMethod<Method>
            ? [params?: OpenADERemoteRequestForMethod<Method>]
            : [params: OpenADERemoteRequestForMethod<Method>]
    ): Promise<OpenADERemoteResponseForMethod<Method>>
    request<T>(method: string, params?: unknown): Promise<T>
    requestWithOptions?<T>(method: string, params: unknown | undefined, options: RuntimeRequestOptions): Promise<T>
    connect(): Promise<void> | void
    readonly capabilities: RuntimeCapabilities | null
    hasMethod(method: string): boolean
    subscribe(listener: (notification: RuntimeNotification) => void): () => void
    close(): void | Promise<void>
}

export interface OpenADEClientOptions {
    runtime: RuntimeClientLike
    clientName?: string
    clientPlatform?: "desktop" | "mobile" | "web" | "cli" | "unknown"
    protocolVersion?: number
}

export interface OpenADERequestOptions {
    clientRequestId?: string
}

export type OpenADETurnStartOptions = OpenADERequestOptions

function createClientRequestId(): string {
    const crypto = globalThis.crypto
    if (crypto?.randomUUID) return crypto.randomUUID()
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function withClientRequestId<T extends object>(args: T, options: OpenADERequestOptions = {}): T & { clientRequestId: string } {
    const existing = "clientRequestId" in args && typeof args.clientRequestId === "string" && args.clientRequestId.length > 0 ? args.clientRequestId : undefined
    return {
        ...args,
        clientRequestId: options.clientRequestId ?? existing ?? createClientRequestId(),
    }
}

const SLOW_OPENADE_CLIENT_REQUEST_MS = 750
const OPENADE_CLIENT_REQUEST_BURST_WINDOW_MS = 2_000
const OPENADE_CLIENT_REQUEST_BURST_COUNT = 12
const OPENADE_READ_METHODS_TO_COALESCE: ReadonlySet<OpenADEMethod> = new Set(GENERATED_OPENADE_READ_METHODS_TO_COALESCE)
const OPENADE_NOTIFICATION_METHODS: ReadonlySet<string> = new Set(OPENADE_NOTIFICATIONS)

function isOpenADEClientNotification(notification: RuntimeNotification): boolean {
    return notification.method === "connection/lagged" || notification.method.startsWith("runtime/") || OPENADE_NOTIFICATION_METHODS.has(notification.method)
}

interface ClientRequestBurstEntry {
    startedAt: number
    count: number
    lastWarnedCount: number
    lastRequestId: string
}

type OpenADERequestLogScope = Record<string, string | number | boolean>

function warnSlowOpenADERequest(details: Record<string, unknown>): void {
    if (typeof console === "undefined" || typeof console.warn !== "function") return
    console.warn("[OpenADEClient] Slow runtime request", details)
}

function warnOpenADERequestBurst(details: Record<string, unknown>): void {
    if (typeof console === "undefined" || typeof console.warn !== "function") return
    console.warn("[OpenADEClient] Runtime request burst", details)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function stableRequestValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableRequestValue)
    if (!isRecord(value)) return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableRequestValue(value[key])]))
}

function sanitizedScopeValue(value: unknown): string | number | boolean | undefined {
    if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 80)}...` : value
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "boolean") return value
    return undefined
}

function requestLogScope(params: unknown): OpenADERequestLogScope | undefined {
    if (!isRecord(params) || Array.isArray(params)) return undefined
    const scope: OpenADERequestLogScope = {}
    for (const key of ["repoId", "taskId", "runtimeId", "processId", "terminalId", "provider", "harnessId"]) {
        const value = sanitizedScopeValue(params[key])
        if (value !== undefined) scope[key] = value
    }
    if (typeof params.query === "string") scope.queryLength = params.query.length
    if (typeof params.path === "string") scope.pathDepth = params.path.split("/").filter(Boolean).length
    return Object.keys(scope).length > 0 ? scope : undefined
}

function coalescedReadRequestKey(method: OpenADEMethod, params: unknown): string | null {
    if (!OPENADE_READ_METHODS_TO_COALESCE.has(method)) return null
    return `${method}:${JSON.stringify(stableRequestValue(params))}`
}

function openADERequestArgs<Method extends OpenADEMethod>(
    params: OpenADERequestForMethod<Method> | undefined
): undefined extends OpenADERequestForMethod<Method> ? [params?: OpenADERequestForMethod<Method>] : [params: OpenADERequestForMethod<Method>] {
    return (params === undefined ? [] : [params]) as undefined extends OpenADERequestForMethod<Method>
        ? [params?: OpenADERequestForMethod<Method>]
        : [params: OpenADERequestForMethod<Method>]
}

export class OpenADEClient {
    private readonly readRequestsInFlight = new Map<string, Promise<unknown>>()
    private readonly requestBursts = new Map<string, ClientRequestBurstEntry>()
    private readonly requestsInFlightByMethod = new Map<string, number>()
    private requestsInFlight = 0
    private nextTelemetryRequestId = 1

    constructor(private readonly options: OpenADEClientOptions) {}

    hasMethod(method: OpenADEMethod): boolean {
        return this.options.runtime.hasMethod(method)
    }

    hasRuntimeMethod(method: string): boolean {
        return this.options.runtime.hasMethod(method)
    }

    async getSnapshot(): Promise<OpenADESnapshot> {
        return this.request(OPENADE_METHOD.snapshotRead)
    }

    async listProjects(): Promise<OpenADEProject[]> {
        return this.request(OPENADE_METHOD.projectList)
    }

    async listTasks(repoId: string): Promise<OpenADETaskPreview[]> {
        return this.request(OPENADE_METHOD.taskList, { repoId })
    }

    async listRuntimes(args: RuntimeListParams = {}): Promise<RuntimeRecord[]> {
        await this.ensureRuntimeMethodAvailable("runtime/list")
        return this.requestRuntime<RuntimeRecord[]>("runtime/list", args)
    }

    async getTask(repoId: string, taskId: string, options: OpenADETaskReadOptions = { hydrateSessionEvents: false }): Promise<OpenADETask> {
        return this.request(OPENADE_METHOD.taskRead, { repoId, taskId, ...options })
    }

    async readProjectFile(args: OpenADEProjectFileReadRequest): Promise<OpenADEProjectFileReadResult> {
        return this.request(OPENADE_METHOD.projectFileRead, args)
    }

    async listProjectFiles(args: OpenADEProjectFilesTreeRequest): Promise<OpenADEProjectFilesTreeResult> {
        return this.request(OPENADE_METHOD.projectFilesTree, args)
    }

    async fuzzySearchProjectFiles(args: OpenADEProjectFilesFuzzySearchRequest): Promise<OpenADEProjectFilesFuzzySearchResult> {
        return this.request(OPENADE_METHOD.projectFilesFuzzySearch, args)
    }

    async writeProjectFile(args: OpenADEProjectFileWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectFileWriteResult> {
        return this.request(OPENADE_METHOD.projectFileWrite, withClientRequestId(args, options))
    }

    async searchProject(args: OpenADEProjectSearchRequest): Promise<OpenADEProjectSearchResult> {
        return this.request(OPENADE_METHOD.projectSearch, args)
    }

    async readProjectSdkCapabilities(args: OpenADEProjectSdkCapabilitiesReadRequest): Promise<OpenADESdkCapabilities> {
        return this.request(OPENADE_METHOD.projectSdkCapabilitiesRead, args)
    }

    async readProjectGitInfo(args: OpenADEProjectGitInfoRequest): Promise<OpenADEProjectGitInfoResult> {
        return this.request(OPENADE_METHOD.projectGitInfoRead, args)
    }

    async readProjectGitBranches(args: OpenADEProjectGitBranchesReadRequest): Promise<OpenADEProjectGitBranchesReadResult> {
        return this.request(OPENADE_METHOD.projectGitBranchesRead, args)
    }

    async readProjectGitSummary(args: OpenADEProjectGitSummaryReadRequest): Promise<OpenADEProjectGitSummaryReadResult> {
        return this.request(OPENADE_METHOD.projectGitSummaryRead, args)
    }

    async listProjectProcesses(args: OpenADEProjectProcessListRequest): Promise<OpenADEProjectProcessListResult> {
        return this.request(OPENADE_METHOD.projectProcessList, args)
    }

    async readCronDefinitions(args: OpenADECronDefinitionsReadRequest): Promise<OpenADECronDefinitionsReadResult> {
        return this.request(OPENADE_METHOD.cronDefinitionsRead, args)
    }

    async startProjectProcess(
        args: OpenADEProjectProcessStartRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEProjectProcessStartResult> {
        return this.request(OPENADE_METHOD.projectProcessStart, withClientRequestId(args, options))
    }

    async reconnectProjectProcess(args: OpenADEProjectProcessReconnectRequest): Promise<OpenADEProjectProcessReconnectResult> {
        return this.request(OPENADE_METHOD.projectProcessReconnect, args)
    }

    async stopProjectProcess(args: OpenADEProjectProcessStopRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectProcessStopResult> {
        return this.request(OPENADE_METHOD.projectProcessStop, withClientRequestId(args, options))
    }

    async readCronInstallState(args: OpenADECronInstallStateReadRequest): Promise<OpenADECronInstallStateReadResult> {
        return this.request(OPENADE_METHOD.cronInstallStateRead, args)
    }

    async listCronInstallStateRepos(): Promise<OpenADECronInstallStateListResult> {
        return this.request(OPENADE_METHOD.cronInstallStateList)
    }

    async replaceCronInstallState(
        args: OpenADECronInstallStateReplaceRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADECronInstallStateReplaceResult> {
        return this.request(OPENADE_METHOD.cronInstallStateReplace, withClientRequestId(args, options))
    }

    async runCron(args: OpenADECronRunRequest, options: OpenADERequestOptions = {}): Promise<OpenADECronRunResult> {
        return this.request(OPENADE_METHOD.cronRun, withClientRequestId(args, options))
    }

    async readTaskChanges(args: OpenADETaskChangesReadRequest): Promise<OpenADETaskChangesReadResult> {
        return this.request(OPENADE_METHOD.taskChangesRead, args)
    }

    async readTaskGitSummary(args: OpenADETaskGitSummaryRequest): Promise<OpenADETaskGitSummaryResult> {
        return this.request(OPENADE_METHOD.taskGitSummaryRead, args)
    }

    async readTaskGitScopes(args: OpenADETaskGitScopesReadRequest): Promise<OpenADETaskGitScopesReadResult> {
        return this.request(OPENADE_METHOD.taskGitScopesRead, args)
    }

    async readTaskDiff(args: OpenADETaskDiffReadRequest): Promise<OpenADETaskDiffReadResult> {
        return this.request(OPENADE_METHOD.taskDiffRead, args)
    }

    async readTaskFilePair(args: OpenADETaskFilePairReadRequest): Promise<OpenADETaskFilePairReadResult> {
        return this.request(OPENADE_METHOD.taskFilePairRead, args)
    }

    async readTaskGitLog(args: OpenADETaskGitLogRequest): Promise<OpenADETaskGitLogResult> {
        return this.request(OPENADE_METHOD.taskGitLog, args)
    }

    async readTaskGitCommitFiles(args: OpenADETaskGitCommitFilesRequest): Promise<OpenADETaskGitCommitFilesResult> {
        return this.request(OPENADE_METHOD.taskGitCommitFilesRead, args)
    }

    async readTaskGitFileAtTreeish(args: OpenADETaskGitFileAtTreeishRequest): Promise<OpenADETaskGitFileAtTreeishResult> {
        return this.request(OPENADE_METHOD.taskGitFileAtTreeishRead, args)
    }

    async readTaskGitCommitFilePatch(args: OpenADETaskGitCommitFilePatchRequest): Promise<OpenADETaskGitCommitFilePatchResult> {
        return this.request(OPENADE_METHOD.taskGitCommitFilePatchRead, args)
    }

    async commitTaskGit(args: OpenADETaskGitCommitRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskGitCommitResult> {
        return this.request(OPENADE_METHOD.taskGitCommit, withClientRequestId(args, options))
    }

    async startTaskTerminal(args: OpenADETaskTerminalStartRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalStartResult> {
        return this.request(OPENADE_METHOD.taskTerminalStart, withClientRequestId(args, options))
    }

    async reconnectTaskTerminal(args: OpenADETaskTerminalReconnectRequest): Promise<OpenADETaskTerminalReconnectResult> {
        return this.request(OPENADE_METHOD.taskTerminalReconnect, args)
    }

    async writeTaskTerminal(args: OpenADETaskTerminalWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        return this.request(OPENADE_METHOD.taskTerminalWrite, withClientRequestId(args, options))
    }

    async resizeTaskTerminal(args: OpenADETaskTerminalResizeRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        return this.request(OPENADE_METHOD.taskTerminalResize, withClientRequestId(args, options))
    }

    async stopTaskTerminal(args: OpenADETaskTerminalStopRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        return this.request(OPENADE_METHOD.taskTerminalStop, withClientRequestId(args, options))
    }

    async importLegacyResources(
        args: OpenADELegacyResourcesImportRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADELegacyResourcesImportResult> {
        return this.request(OPENADE_METHOD.importLegacyResources, withClientRequestId(args, options))
    }

    async readMcpServers(): Promise<OpenADEMCPServersReadResult> {
        return this.request(OPENADE_METHOD.settingsMcpServersRead, {})
    }

    async replaceMcpServers(
        args: OpenADEMCPServersReplaceRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEMCPServersReplaceResult> {
        return this.request(OPENADE_METHOD.settingsMcpServersReplace, withClientRequestId(args, options))
    }

    async upsertMcpServer(
        args: OpenADEMCPServerUpsertRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEMCPServerUpsertResult> {
        return this.request(OPENADE_METHOD.settingsMcpServersUpsert, withClientRequestId(args, options))
    }

    async deleteMcpServer(
        args: OpenADEMCPServerDeleteRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEMCPServerDeleteResult> {
        return this.request(OPENADE_METHOD.settingsMcpServersDelete, withClientRequestId(args, options))
    }

    async readPersonalSettings(): Promise<OpenADEPersonalSettingsReadResult> {
        return this.request(OPENADE_METHOD.settingsPersonalRead, {})
    }

    async replacePersonalSettings(
        args: OpenADEPersonalSettingsReplaceRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEPersonalSettingsReplaceResult> {
        return this.request(OPENADE_METHOD.settingsPersonalReplace, withClientRequestId(args, options))
    }

    async readTaskImage(args: OpenADETaskImageReadRequest): Promise<OpenADETaskImageReadResult> {
        return this.request(OPENADE_METHOD.taskImageRead, args)
    }

    async readStagedTaskImage(args: OpenADETaskImageStagedReadRequest): Promise<OpenADETaskImageStagedReadResult> {
        return this.request(OPENADE_METHOD.taskImageStagedRead, args)
    }

    async writeTaskImage(args: OpenADETaskImageWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskImageWriteResult> {
        return this.request(OPENADE_METHOD.taskImageWrite, withClientRequestId(args, options))
    }

    async importLegacyTaskImage(
        args: OpenADETaskImageImportLegacyRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskImageImportLegacyResult> {
        return this.request(OPENADE_METHOD.taskImageImportLegacy, withClientRequestId(args, options))
    }

    async importLegacyTaskImages(
        args: OpenADETaskImagesImportLegacyRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskImagesImportLegacyResult> {
        return this.request(OPENADE_METHOD.taskImagesImportLegacy, withClientRequestId(args, options))
    }

    async gcStagedTaskImages(
        args: OpenADETaskImagesGCStagedRequest = {},
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskImagesGCStagedResult> {
        return this.request(OPENADE_METHOD.taskImagesGcStaged, withClientRequestId(args, options))
    }

    async importLegacyTaskHarnessSessions(
        args: OpenADETaskHarnessSessionsImportLegacyRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskHarnessSessionsImportLegacyResult> {
        return this.request(OPENADE_METHOD.taskSessionsImportLegacy, withClientRequestId(args, options))
    }

    async readTaskResourceInventory(args: OpenADETaskResourceInventoryReadRequest): Promise<OpenADETaskResourceInventoryReadResult> {
        return this.request(OPENADE_METHOD.taskResourceInventoryRead, args)
    }

    async generateTaskTitle(args: OpenADETaskTitleGenerateRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTitleGenerateResult> {
        return this.request(OPENADE_METHOD.taskTitleGenerate, withClientRequestId(args, options))
    }

    async readTaskSnapshotPatch(args: OpenADETaskSnapshotPatchReadRequest): Promise<OpenADETaskSnapshotPatchReadResult> {
        return this.request(OPENADE_METHOD.taskSnapshotPatchRead, args)
    }

    async readTaskSnapshotIndex(args: OpenADETaskSnapshotIndexReadRequest): Promise<OpenADETaskSnapshotIndexReadResult> {
        return this.request(OPENADE_METHOD.taskSnapshotIndexRead, args)
    }

    async readTaskSnapshotPatchSlice(args: OpenADETaskSnapshotPatchSliceReadRequest): Promise<OpenADETaskSnapshotPatchSliceReadResult> {
        return this.request(OPENADE_METHOD.taskSnapshotPatchReadSlice, args)
    }

    async importLegacyTaskSnapshots(
        args: OpenADETaskSnapshotsImportLegacyRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskSnapshotsImportLegacyResult> {
        return this.request(OPENADE_METHOD.taskSnapshotsImportLegacy, withClientRequestId(args, options))
    }

    async createRepo(args: OpenADERepoCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADERepoCreateResult> {
        return this.request(OPENADE_METHOD.repoCreate, withClientRequestId(args, options))
    }

    async inspectRepoPath(args: OpenADERepoPathInspectRequest): Promise<OpenADERepoPathInspectResult> {
        return this.request(OPENADE_METHOD.repoPathInspect, args)
    }

    async createTask(args: OpenADETaskCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskCreateResult> {
        return this.request(OPENADE_METHOD.taskCreate, withClientRequestId(args, options))
    }

    async updateRepo(args: OpenADERepoUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.repoUpdate, withClientRequestId(args, options))
    }

    async deleteRepo(args: OpenADERepoDeleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.repoDelete, withClientRequestId(args, options))
    }

    async startTurn(args: OpenADETurnStartRequest, options: OpenADETurnStartOptions = {}): Promise<OpenADETurnStartResult> {
        return this.request(OPENADE_METHOD.turnStart, withClientRequestId(args, options))
    }

    async startReview(args: OpenADEReviewStartRequest, options: OpenADETurnStartOptions = {}): Promise<OpenADEReviewStartResult> {
        return this.request(OPENADE_METHOD.reviewStart, withClientRequestId(args, options))
    }

    async interruptTurn(taskId: string, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.turnInterrupt, withClientRequestId({ taskId }, options))
    }

    async cancelQueuedTurn(args: OpenADEQueuedTurnCancelRequest, options: OpenADERequestOptions = {}): Promise<OpenADEQueuedTurnCancelResult> {
        return this.request(OPENADE_METHOD.queuedTurnCancel, withClientRequestId(args, options))
    }

    async enqueueQueuedTurn(args: OpenADEQueuedTurnEnqueueRequest, options: OpenADERequestOptions = {}): Promise<OpenADEQueuedTurnEnqueueResult> {
        return this.request(OPENADE_METHOD.queuedTurnEnqueue, withClientRequestId(args, options))
    }

    async importLegacyQueuedTurn(args: OpenADEQueuedTurnImportLegacyRequest, options: OpenADERequestOptions = {}): Promise<OpenADEQueuedTurnImportLegacyResult> {
        return this.request(OPENADE_METHOD.queuedTurnImportLegacy, withClientRequestId(args, options))
    }

    async reorderQueuedTurns(args: OpenADEQueuedTurnReorderRequest, options: OpenADERequestOptions = {}): Promise<OpenADEQueuedTurnReorderResult> {
        return this.request(OPENADE_METHOD.queuedTurnReorder, withClientRequestId(args, options))
    }

    async createActionEvent(args: OpenADEActionEventCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADEActionEventCreateResult> {
        return this.request(OPENADE_METHOD.actionCreate, withClientRequestId(args, options))
    }

    async appendActionStreamEvent(args: OpenADEActionStreamAppendRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.actionStreamAppend, withClientRequestId(args, options))
    }

    async completeActionEvent(args: OpenADEActionEventCompleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.actionComplete, withClientRequestId(args, options))
    }

    async errorActionEvent(args: OpenADEActionEventErrorRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.actionError, withClientRequestId(args, options))
    }

    async stoppedActionEvent(args: OpenADEActionEventStoppedRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.actionStopped, withClientRequestId(args, options))
    }

    async reconcileActionEventRuntime(
        args: OpenADEActionEventRuntimeReconcileRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEActionEventRuntimeReconcileResult> {
        return this.request(OPENADE_METHOD.actionReconcileRuntime, withClientRequestId(args, options))
    }

    async updateActionExecution(args: OpenADEActionExecutionUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.actionExecutionUpdate, withClientRequestId(args, options))
    }

    async addHyperPlanSubExecution(args: OpenADEHyperPlanSubExecutionAddRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.hyperplanSubExecutionAdd, withClientRequestId(args, options))
    }

    async appendHyperPlanSubExecutionStreamEvent(args: OpenADEHyperPlanSubExecutionStreamAppendRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.hyperplanSubExecutionStreamAppend, withClientRequestId(args, options))
    }

    async updateHyperPlanSubExecution(args: OpenADEHyperPlanSubExecutionUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.hyperplanSubExecutionUpdate, withClientRequestId(args, options))
    }

    async setHyperPlanReconcileLabels(args: OpenADEHyperPlanReconcileLabelsSetRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.hyperplanReconcileLabelsSet, withClientRequestId(args, options))
    }

    async createSnapshotEvent(args: OpenADESnapshotEventCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADESnapshotEventCreateResult> {
        return this.request(OPENADE_METHOD.snapshotCreate, withClientRequestId(args, options))
    }

    async createComment(args: OpenADECommentCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADECommentCreateResult> {
        return this.request(OPENADE_METHOD.commentCreate, withClientRequestId(args, options))
    }

    async editComment(args: OpenADECommentEditRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.commentEdit, withClientRequestId(args, options))
    }

    async deleteComment(args: OpenADECommentDeleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.commentDelete, withClientRequestId(args, options))
    }

    async updateTaskMetadata(args: OpenADETaskMetadataUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.taskMetadataUpdate, withClientRequestId(args, options))
    }

    async backfillTaskUsage(
        args: OpenADETaskUsageBackfillRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskUsageBackfillResult> {
        return this.request(OPENADE_METHOD.taskUsageBackfill, withClientRequestId(args, options))
    }

    async recalculateTaskUsage(
        args: OpenADETaskUsageRecalculateRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskUsageRecalculateResult> {
        return this.request(OPENADE_METHOD.taskUsageRecalculate, withClientRequestId(args, options))
    }

    async deleteTask(args: OpenADETaskDeleteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskDeleteResult> {
        return this.request(OPENADE_METHOD.taskDelete, withClientRequestId(args, options))
    }

    async setupTaskEnvironment(args: OpenADETaskEnvironmentSetupRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request(OPENADE_METHOD.taskEnvironmentSetup, withClientRequestId(args, options))
    }

    async prepareTaskEnvironment(
        args: OpenADETaskEnvironmentPrepareRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskEnvironmentPrepareResult> {
        return this.request(OPENADE_METHOD.taskEnvironmentPrepare, withClientRequestId(args, options))
    }

    subscribeToChanges(onEvent: (notification: RuntimeNotification) => void): () => void {
        return this.options.runtime.subscribe((notification) => {
            if (isOpenADEClientNotification(notification)) onEvent(notification)
        })
    }

    close(): void {
        this.options.runtime.close()
    }

    private async request<Method extends OpenADEMethod>(
        method: Method,
        ...[params]: undefined extends OpenADERequestForMethod<Method>
            ? [params?: OpenADERequestForMethod<Method>]
            : [params: OpenADERequestForMethod<Method>]
    ): Promise<OpenADEResponseForMethod<Method>> {
        const startedAt = Date.now()
        let failed = false
        const coalescedKey = coalescedReadRequestKey(method, params)
        let inFlight = coalescedKey ? this.readRequestsInFlight.get(coalescedKey) : undefined
        if (inFlight) return inFlight as Promise<OpenADEResponseForMethod<Method>>

        await this.ensureMethodAvailable(method)
        inFlight = coalescedKey ? this.readRequestsInFlight.get(coalescedKey) : undefined
        if (inFlight) return inFlight as Promise<OpenADEResponseForMethod<Method>>

        const requestId = this.createTelemetryRequestId()
        this.startRequestTelemetry(method)
        this.recordRequestBurst(method, requestId, params)
        const runtimeRequest = this.options.runtime.requestWithOptions
            ? this.options.runtime.requestWithOptions<OpenADEResponseForMethod<Method>>(method, params, { requestId })
            : this.options.runtime.request(method, ...openADERequestArgs<Method>(params))
        const promise = runtimeRequest
            .catch((error: unknown) => {
                failed = true
                throw error
            })
            .finally(() => {
                this.recordSlowRequest(method, requestId, params, startedAt, failed)
                this.finishRequestTelemetry(method)
                if (coalescedKey && this.readRequestsInFlight.get(coalescedKey) === promise) {
                    this.readRequestsInFlight.delete(coalescedKey)
                }
            })
        if (coalescedKey) this.readRequestsInFlight.set(coalescedKey, promise)

        return promise
    }

    async ensureMethodAvailable(method: OpenADEMethod): Promise<void> {
        await this.ensureRuntimeMethodAvailable(method)
    }

    async ensureRuntimeMethodAvailable(method: string): Promise<void> {
        const runtime = this.options.runtime
        if (!runtime.capabilities) await runtime.connect()
        if (!runtime.capabilities) throw new Error(`OpenADE runtime capabilities unavailable for method: ${method}`)
        if (!runtime.hasMethod(method)) {
            throw new Error(`OpenADE runtime method unavailable: ${method}`)
        }
    }

    private createTelemetryRequestId(): string {
        const id = `openade-client:${this.nextTelemetryRequestId}`
        this.nextTelemetryRequestId += 1
        return id
    }

    private async requestRuntime<T>(method: string, params?: unknown): Promise<T> {
        const startedAt = Date.now()
        let failed = false
        const requestId = this.createTelemetryRequestId()
        this.startRequestTelemetry(method)
        this.recordRequestBurst(method, requestId, params)
        const runtimeRequest = this.options.runtime.requestWithOptions
            ? this.options.runtime.requestWithOptions<T>(method, params, { requestId })
            : this.options.runtime.request<T>(method, params)

        return runtimeRequest
            .catch((error: unknown) => {
                failed = true
                throw error
            })
            .finally(() => {
                this.recordSlowRequest(method, requestId, params, startedAt, failed)
                this.finishRequestTelemetry(method)
            })
    }

    private startRequestTelemetry(method: string): void {
        this.requestsInFlight += 1
        this.requestsInFlightByMethod.set(method, (this.requestsInFlightByMethod.get(method) ?? 0) + 1)
    }

    private finishRequestTelemetry(method: string): void {
        this.requestsInFlight = Math.max(0, this.requestsInFlight - 1)
        const methodCount = (this.requestsInFlightByMethod.get(method) ?? 0) - 1
        if (methodCount <= 0) {
            this.requestsInFlightByMethod.delete(method)
        } else {
            this.requestsInFlightByMethod.set(method, methodCount)
        }
    }

    private recordSlowRequest(method: string, requestId: string, params: unknown, startedAt: number, failed: boolean): void {
        const durationMs = Date.now() - startedAt
        if (durationMs < SLOW_OPENADE_CLIENT_REQUEST_MS) return
        const scope = requestLogScope(params)
        warnSlowOpenADERequest({
            method,
            requestId,
            durationMs,
            clientObservedDurationMs: durationMs,
            methodInFlight: this.requestsInFlightByMethod.get(method) ?? 0,
            totalInFlight: this.requestsInFlight,
            serverTiming: "correlate with runtime slow logs by requestId for queueWaitMs and handlerMs",
            failed,
            clientName: this.options.clientName,
            clientPlatform: this.options.clientPlatform,
            ...(scope ? { scope } : {}),
        })
    }

    private recordRequestBurst(method: string, requestId: string, params: unknown): void {
        const now = Date.now()
        const existing = this.requestBursts.get(method)
        const burst = existing && now - existing.startedAt <= OPENADE_CLIENT_REQUEST_BURST_WINDOW_MS
            ? existing
            : { startedAt: now, count: 0, lastWarnedCount: 0, lastRequestId: requestId }
        burst.count += 1
        burst.lastRequestId = requestId

        if (burst.count >= OPENADE_CLIENT_REQUEST_BURST_COUNT && burst.count - burst.lastWarnedCount >= OPENADE_CLIENT_REQUEST_BURST_COUNT) {
            burst.lastWarnedCount = burst.count
            const scope = requestLogScope(params)
            warnOpenADERequestBurst({
                method,
                lastRequestId: burst.lastRequestId,
                count: burst.count,
                windowMs: now - burst.startedAt,
                methodInFlight: this.requestsInFlightByMethod.get(method) ?? 0,
                totalInFlight: this.requestsInFlight,
                clientName: this.options.clientName,
                clientPlatform: this.options.clientPlatform,
                ...(scope ? { lastScope: scope } : {}),
            })
        }

        this.requestBursts.set(method, burst)
    }
}
