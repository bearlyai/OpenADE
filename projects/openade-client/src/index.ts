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
    OpenADECronInstallStateReadRequest,
    OpenADECronInstallStateReadResult,
    OpenADECronInstallStateReplaceRequest,
    OpenADECronInstallStateReplaceResult,
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
    OpenADERepoUpdateRequest,
    OpenADESnapshot,
    OpenADESnapshotEventCreateRequest,
    OpenADESnapshotEventCreateResult,
    OpenADETask,
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
    OpenADETurnStartRequest,
    OpenADETurnStartResult,
} from "../../openade-module/src/types"
import type { RuntimeListParams, RuntimeNotification, RuntimeRecord } from "../../runtime-protocol/src"
import type { RuntimeClientStatus } from "../../runtime-client/src"
import {
    OPENADE_READ_METHODS_TO_COALESCE as GENERATED_OPENADE_READ_METHODS_TO_COALESCE,
    type OpenADEMethod,
    type OpenADERequestForMethod,
    type OpenADEResponseForMethod,
} from "./generated/openade-contracts"

export type OpenADEClientConnectionStatus = RuntimeClientStatus

export interface RuntimeClientLike {
    request<T>(method: string, params?: unknown): Promise<T>
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

function isOpenADENotification(notification: RuntimeNotification): boolean {
    return notification.method === "connection/lagged" || notification.method.startsWith("openade/") || notification.method.startsWith("runtime/") || notification.method.startsWith("remote/")
}

const SLOW_OPENADE_CLIENT_REQUEST_MS = 750
const OPENADE_CLIENT_REQUEST_BURST_WINDOW_MS = 2_000
const OPENADE_CLIENT_REQUEST_BURST_COUNT = 12
const OPENADE_READ_METHODS_TO_COALESCE: ReadonlySet<OpenADEMethod> = new Set(GENERATED_OPENADE_READ_METHODS_TO_COALESCE)

interface ClientRequestBurstEntry {
    startedAt: number
    count: number
    lastWarnedCount: number
}

const clientRequestBursts = new Map<string, ClientRequestBurstEntry>()

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

function coalescedReadRequestKey(method: OpenADEMethod, params: unknown): string | null {
    if (!OPENADE_READ_METHODS_TO_COALESCE.has(method)) return null
    return `${method}:${JSON.stringify(stableRequestValue(params))}`
}

export class OpenADEClient {
    private readonly readRequestsInFlight = new Map<string, Promise<unknown>>()

    constructor(private readonly options: OpenADEClientOptions) {}

    async getSnapshot(): Promise<OpenADESnapshot> {
        return this.request("openade/snapshot/read")
    }

    async listRuntimes(args: RuntimeListParams = {}): Promise<RuntimeRecord[]> {
        return this.options.runtime.request<RuntimeRecord[]>("runtime/list", args)
    }

    async getTask(repoId: string, taskId: string, options: OpenADETaskReadOptions = {}): Promise<OpenADETask> {
        return this.request("openade/task/read", { repoId, taskId, ...options })
    }

    async readProjectFile(args: OpenADEProjectFileReadRequest): Promise<OpenADEProjectFileReadResult> {
        return this.request("openade/project/file/read", args)
    }

    async listProjectFiles(args: OpenADEProjectFilesTreeRequest): Promise<OpenADEProjectFilesTreeResult> {
        return this.request("openade/project/files/tree", args)
    }

    async fuzzySearchProjectFiles(args: OpenADEProjectFilesFuzzySearchRequest): Promise<OpenADEProjectFilesFuzzySearchResult> {
        return this.request("openade/project/files/fuzzySearch", args)
    }

    async writeProjectFile(args: OpenADEProjectFileWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectFileWriteResult> {
        return this.request("openade/project/file/write", withClientRequestId(args, options))
    }

    async searchProject(args: OpenADEProjectSearchRequest): Promise<OpenADEProjectSearchResult> {
        return this.request("openade/project/search", args)
    }

    async readProjectGitInfo(args: OpenADEProjectGitInfoRequest): Promise<OpenADEProjectGitInfoResult> {
        return this.request("openade/project/git/info/read", args)
    }

    async readProjectGitBranches(args: OpenADEProjectGitBranchesReadRequest): Promise<OpenADEProjectGitBranchesReadResult> {
        return this.request("openade/project/git/branches/read", args)
    }

    async readProjectGitSummary(args: OpenADEProjectGitSummaryReadRequest): Promise<OpenADEProjectGitSummaryReadResult> {
        return this.request("openade/project/git/summary/read", args)
    }

    async listProjectProcesses(args: OpenADEProjectProcessListRequest): Promise<OpenADEProjectProcessListResult> {
        return this.request("openade/project/process/list", args)
    }

    async startProjectProcess(
        args: OpenADEProjectProcessStartRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEProjectProcessStartResult> {
        return this.request("openade/project/process/start", withClientRequestId(args, options))
    }

    async reconnectProjectProcess(args: OpenADEProjectProcessReconnectRequest): Promise<OpenADEProjectProcessReconnectResult> {
        return this.request("openade/project/process/reconnect", args)
    }

    async stopProjectProcess(args: OpenADEProjectProcessStopRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectProcessStopResult> {
        return this.request("openade/project/process/stop", withClientRequestId(args, options))
    }

    async readCronInstallState(args: OpenADECronInstallStateReadRequest): Promise<OpenADECronInstallStateReadResult> {
        return this.request("openade/cron/installState/read", args)
    }

    async replaceCronInstallState(
        args: OpenADECronInstallStateReplaceRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADECronInstallStateReplaceResult> {
        return this.request("openade/cron/installState/replace", withClientRequestId(args, options))
    }

    async readTaskChanges(args: OpenADETaskChangesReadRequest): Promise<OpenADETaskChangesReadResult> {
        return this.request("openade/task/changes/read", args)
    }

    async readTaskGitSummary(args: OpenADETaskGitSummaryRequest): Promise<OpenADETaskGitSummaryResult> {
        return this.request("openade/task/git/summary/read", args)
    }

    async readTaskGitScopes(args: OpenADETaskGitScopesReadRequest): Promise<OpenADETaskGitScopesReadResult> {
        return this.request("openade/task/git/scopes/read", args)
    }

    async readTaskDiff(args: OpenADETaskDiffReadRequest): Promise<OpenADETaskDiffReadResult> {
        return this.request("openade/task/diff/read", args)
    }

    async readTaskFilePair(args: OpenADETaskFilePairReadRequest): Promise<OpenADETaskFilePairReadResult> {
        return this.request("openade/task/filePair/read", args)
    }

    async readTaskGitLog(args: OpenADETaskGitLogRequest): Promise<OpenADETaskGitLogResult> {
        return this.request("openade/task/git/log", args)
    }

    async readTaskGitCommitFiles(args: OpenADETaskGitCommitFilesRequest): Promise<OpenADETaskGitCommitFilesResult> {
        return this.request("openade/task/git/commit/files/read", args)
    }

    async readTaskGitFileAtTreeish(args: OpenADETaskGitFileAtTreeishRequest): Promise<OpenADETaskGitFileAtTreeishResult> {
        return this.request("openade/task/git/fileAtTreeish/read", args)
    }

    async readTaskGitCommitFilePatch(args: OpenADETaskGitCommitFilePatchRequest): Promise<OpenADETaskGitCommitFilePatchResult> {
        return this.request("openade/task/git/commit/filePatch/read", args)
    }

    async commitTaskGit(args: OpenADETaskGitCommitRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskGitCommitResult> {
        return this.request("openade/task/git/commit", withClientRequestId(args, options))
    }

    async startTaskTerminal(args: OpenADETaskTerminalStartRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalStartResult> {
        return this.request("openade/task/terminal/start", withClientRequestId(args, options))
    }

    async reconnectTaskTerminal(args: OpenADETaskTerminalReconnectRequest): Promise<OpenADETaskTerminalReconnectResult> {
        return this.request("openade/task/terminal/reconnect", args)
    }

    async writeTaskTerminal(args: OpenADETaskTerminalWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        return this.request("openade/task/terminal/write", withClientRequestId(args, options))
    }

    async resizeTaskTerminal(args: OpenADETaskTerminalResizeRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        return this.request("openade/task/terminal/resize", withClientRequestId(args, options))
    }

    async stopTaskTerminal(args: OpenADETaskTerminalStopRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        return this.request("openade/task/terminal/stop", withClientRequestId(args, options))
    }

    async importLegacyResources(
        args: OpenADELegacyResourcesImportRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADELegacyResourcesImportResult> {
        return this.request("openade/import/legacyResources", withClientRequestId(args, options))
    }

    async readMcpServers(): Promise<OpenADEMCPServersReadResult> {
        return this.request("openade/settings/mcpServers/read", {})
    }

    async replaceMcpServers(
        args: OpenADEMCPServersReplaceRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEMCPServersReplaceResult> {
        return this.request("openade/settings/mcpServers/replace", withClientRequestId(args, options))
    }

    async upsertMcpServer(
        args: OpenADEMCPServerUpsertRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEMCPServerUpsertResult> {
        return this.request("openade/settings/mcpServers/upsert", withClientRequestId(args, options))
    }

    async deleteMcpServer(
        args: OpenADEMCPServerDeleteRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEMCPServerDeleteResult> {
        return this.request("openade/settings/mcpServers/delete", withClientRequestId(args, options))
    }

    async readPersonalSettings(): Promise<OpenADEPersonalSettingsReadResult> {
        return this.request("openade/settings/personal/read", {})
    }

    async replacePersonalSettings(
        args: OpenADEPersonalSettingsReplaceRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEPersonalSettingsReplaceResult> {
        return this.request("openade/settings/personal/replace", withClientRequestId(args, options))
    }

    async readTaskImage(args: OpenADETaskImageReadRequest): Promise<OpenADETaskImageReadResult> {
        return this.request("openade/task/image/read", args)
    }

    async readStagedTaskImage(args: OpenADETaskImageStagedReadRequest): Promise<OpenADETaskImageStagedReadResult> {
        return this.request("openade/task/image/staged/read", args)
    }

    async writeTaskImage(args: OpenADETaskImageWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskImageWriteResult> {
        return this.request("openade/task/image/write", withClientRequestId(args, options))
    }

    async importLegacyTaskImage(
        args: OpenADETaskImageImportLegacyRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskImageImportLegacyResult> {
        return this.request("openade/task/image/importLegacy", withClientRequestId(args, options))
    }

    async importLegacyTaskImages(
        args: OpenADETaskImagesImportLegacyRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskImagesImportLegacyResult> {
        return this.request("openade/task/images/importLegacy", withClientRequestId(args, options))
    }

    async gcStagedTaskImages(
        args: OpenADETaskImagesGCStagedRequest = {},
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskImagesGCStagedResult> {
        return this.request("openade/task/images/gcStaged", withClientRequestId(args, options))
    }

    async importLegacyTaskHarnessSessions(
        args: OpenADETaskHarnessSessionsImportLegacyRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskHarnessSessionsImportLegacyResult> {
        return this.request("openade/task/sessions/importLegacy", withClientRequestId(args, options))
    }

    async readTaskResourceInventory(args: OpenADETaskResourceInventoryReadRequest): Promise<OpenADETaskResourceInventoryReadResult> {
        return this.request("openade/task/resourceInventory/read", args)
    }

    async generateTaskTitle(args: OpenADETaskTitleGenerateRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTitleGenerateResult> {
        return this.request("openade/task/title/generate", withClientRequestId(args, options))
    }

    async readTaskSnapshotPatch(args: OpenADETaskSnapshotPatchReadRequest): Promise<OpenADETaskSnapshotPatchReadResult> {
        return this.request("openade/task/snapshot/patch/read", args)
    }

    async readTaskSnapshotIndex(args: OpenADETaskSnapshotIndexReadRequest): Promise<OpenADETaskSnapshotIndexReadResult> {
        return this.request("openade/task/snapshot/index/read", args)
    }

    async readTaskSnapshotPatchSlice(args: OpenADETaskSnapshotPatchSliceReadRequest): Promise<OpenADETaskSnapshotPatchSliceReadResult> {
        return this.request("openade/task/snapshot/patch/readSlice", args)
    }

    async importLegacyTaskSnapshots(
        args: OpenADETaskSnapshotsImportLegacyRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskSnapshotsImportLegacyResult> {
        return this.request("openade/task/snapshots/importLegacy", withClientRequestId(args, options))
    }

    async createRepo(args: OpenADERepoCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADERepoCreateResult> {
        return this.request("openade/repo/create", withClientRequestId(args, options))
    }

    async createTask(args: OpenADETaskCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskCreateResult> {
        return this.request("openade/task/create", withClientRequestId(args, options))
    }

    async updateRepo(args: OpenADERepoUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/repo/update", withClientRequestId(args, options))
    }

    async deleteRepo(args: OpenADERepoDeleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/repo/delete", withClientRequestId(args, options))
    }

    async startTurn(args: OpenADETurnStartRequest, options: OpenADETurnStartOptions = {}): Promise<OpenADETurnStartResult> {
        return this.request("openade/turn/start", withClientRequestId(args, options))
    }

    async startReview(args: OpenADEReviewStartRequest, options: OpenADETurnStartOptions = {}): Promise<{ taskId: string }> {
        return this.request("openade/review/start", withClientRequestId(args, options))
    }

    async interruptTurn(taskId: string, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/turn/interrupt", withClientRequestId({ taskId }, options))
    }

    async cancelQueuedTurn(args: OpenADEQueuedTurnCancelRequest, options: OpenADERequestOptions = {}): Promise<OpenADEQueuedTurnCancelResult> {
        return this.request("openade/queued-turn/cancel", withClientRequestId(args, options))
    }

    async enqueueQueuedTurn(args: OpenADEQueuedTurnEnqueueRequest, options: OpenADERequestOptions = {}): Promise<OpenADEQueuedTurnEnqueueResult> {
        return this.request("openade/queued-turn/enqueue", withClientRequestId(args, options))
    }

    async importLegacyQueuedTurn(args: OpenADEQueuedTurnImportLegacyRequest, options: OpenADERequestOptions = {}): Promise<OpenADEQueuedTurnImportLegacyResult> {
        return this.request("openade/queued-turn/importLegacy", withClientRequestId(args, options))
    }

    async reorderQueuedTurns(args: OpenADEQueuedTurnReorderRequest, options: OpenADERequestOptions = {}): Promise<OpenADEQueuedTurnReorderResult> {
        return this.request("openade/queued-turn/reorder", withClientRequestId(args, options))
    }

    async createActionEvent(args: OpenADEActionEventCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADEActionEventCreateResult> {
        return this.request("openade/action/create", withClientRequestId(args, options))
    }

    async appendActionStreamEvent(args: OpenADEActionStreamAppendRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/action/stream/append", withClientRequestId(args, options))
    }

    async completeActionEvent(args: OpenADEActionEventCompleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/action/complete", withClientRequestId(args, options))
    }

    async errorActionEvent(args: OpenADEActionEventErrorRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/action/error", withClientRequestId(args, options))
    }

    async stoppedActionEvent(args: OpenADEActionEventStoppedRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/action/stopped", withClientRequestId(args, options))
    }

    async reconcileActionEventRuntime(
        args: OpenADEActionEventRuntimeReconcileRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEActionEventRuntimeReconcileResult> {
        return this.request("openade/action/reconcileRuntime", withClientRequestId(args, options))
    }

    async updateActionExecution(args: OpenADEActionExecutionUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/action/execution/update", withClientRequestId(args, options))
    }

    async addHyperPlanSubExecution(args: OpenADEHyperPlanSubExecutionAddRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/hyperplan/subExecution/add", withClientRequestId(args, options))
    }

    async appendHyperPlanSubExecutionStreamEvent(args: OpenADEHyperPlanSubExecutionStreamAppendRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/hyperplan/subExecution/stream/append", withClientRequestId(args, options))
    }

    async updateHyperPlanSubExecution(args: OpenADEHyperPlanSubExecutionUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/hyperplan/subExecution/update", withClientRequestId(args, options))
    }

    async setHyperPlanReconcileLabels(args: OpenADEHyperPlanReconcileLabelsSetRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/hyperplan/reconcileLabels/set", withClientRequestId(args, options))
    }

    async createSnapshotEvent(args: OpenADESnapshotEventCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADESnapshotEventCreateResult> {
        return this.request("openade/snapshot/create", withClientRequestId(args, options))
    }

    async createComment(args: OpenADECommentCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADECommentCreateResult> {
        return this.request("openade/comment/create", withClientRequestId(args, options))
    }

    async editComment(args: OpenADECommentEditRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/comment/edit", withClientRequestId(args, options))
    }

    async deleteComment(args: OpenADECommentDeleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/comment/delete", withClientRequestId(args, options))
    }

    async updateTaskMetadata(args: OpenADETaskMetadataUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/task/metadata/update", withClientRequestId(args, options))
    }

    async backfillTaskUsage(
        args: OpenADETaskUsageBackfillRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskUsageBackfillResult> {
        return this.request("openade/task/usage/backfill", withClientRequestId(args, options))
    }

    async recalculateTaskUsage(
        args: OpenADETaskUsageRecalculateRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskUsageRecalculateResult> {
        return this.request("openade/task/usage/recalculate", withClientRequestId(args, options))
    }

    async deleteTask(args: OpenADETaskDeleteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskDeleteResult> {
        return this.request("openade/task/delete", withClientRequestId(args, options))
    }

    async setupTaskEnvironment(args: OpenADETaskEnvironmentSetupRequest, options: OpenADERequestOptions = {}): Promise<void> {
        return this.request("openade/task/environment/setup", withClientRequestId(args, options))
    }

    async prepareTaskEnvironment(
        args: OpenADETaskEnvironmentPrepareRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskEnvironmentPrepareResult> {
        return this.request("openade/task/environment/prepare", withClientRequestId(args, options))
    }

    subscribeToChanges(onEvent: (notification: RuntimeNotification) => void): () => void {
        return this.options.runtime.subscribe((notification) => {
            if (isOpenADENotification(notification)) onEvent(notification)
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
        this.recordRequestBurst(method)
        const coalescedKey = coalescedReadRequestKey(method, params)
        const inFlight = coalescedKey ? this.readRequestsInFlight.get(coalescedKey) : undefined
        // The key includes the typed OpenADE method name and params; callers of request<T>()
        // control T through the public method for that same runtime method.
        if (inFlight) return inFlight as Promise<OpenADEResponseForMethod<Method>>

        const promise = this.options.runtime
            .request<OpenADEResponseForMethod<Method>>(method, params)
            .catch((error: unknown) => {
                failed = true
                throw error
            })
            .finally(() => {
                this.recordSlowRequest(method, startedAt, failed)
                if (coalescedKey && this.readRequestsInFlight.get(coalescedKey) === promise) {
                    this.readRequestsInFlight.delete(coalescedKey)
                }
            })
        if (coalescedKey) this.readRequestsInFlight.set(coalescedKey, promise)

        return promise
    }

    private recordSlowRequest(method: OpenADEMethod, startedAt: number, failed: boolean): void {
        const durationMs = Date.now() - startedAt
        if (durationMs < SLOW_OPENADE_CLIENT_REQUEST_MS) return
        warnSlowOpenADERequest({
            method,
            durationMs,
            failed,
            clientName: this.options.clientName,
            clientPlatform: this.options.clientPlatform,
        })
    }

    private recordRequestBurst(method: OpenADEMethod): void {
        const now = Date.now()
        const existing = clientRequestBursts.get(method)
        const burst = existing && now - existing.startedAt <= OPENADE_CLIENT_REQUEST_BURST_WINDOW_MS
            ? existing
            : { startedAt: now, count: 0, lastWarnedCount: 0 }
        burst.count += 1

        if (burst.count >= OPENADE_CLIENT_REQUEST_BURST_COUNT && burst.count - burst.lastWarnedCount >= OPENADE_CLIENT_REQUEST_BURST_COUNT) {
            burst.lastWarnedCount = burst.count
            warnOpenADERequestBurst({
                method,
                count: burst.count,
                windowMs: now - burst.startedAt,
                clientName: this.options.clientName,
                clientPlatform: this.options.clientPlatform,
            })
        }

        clientRequestBursts.set(method, burst)
    }
}
