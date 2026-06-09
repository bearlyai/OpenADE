import type { OpenADERequestOptions, OpenADETurnStartOptions } from "../../../openade-client/src"
import type {
    OpenADECommentCreateRequest,
    OpenADECommentCreateResult,
    OpenADECommentDeleteRequest,
    OpenADECommentEditRequest,
    OpenADECronInstallStateReadRequest,
    OpenADECronInstallStateReadResult,
    OpenADECronInstallStateReplaceRequest,
    OpenADECronInstallStateReplaceResult,
    OpenADELegacyResourcesImportRequest,
    OpenADELegacyResourcesImportResult,
    OpenADEMCPServerDeleteRequest,
    OpenADEMCPServerDeleteResult,
    OpenADEMCPServerUpsertRequest,
    OpenADEMCPServerUpsertResult,
    OpenADEMCPServersReadResult,
    OpenADEMCPServersReplaceRequest,
    OpenADEMCPServersReplaceResult,
    OpenADEPersonalSettingsReadResult,
    OpenADEPersonalSettingsReplaceRequest,
    OpenADEPersonalSettingsReplaceResult,
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
    OpenADEQueuedTurnCancelRequest,
    OpenADEQueuedTurnCancelResult,
    OpenADERepoCreateRequest,
    OpenADERepoCreateResult,
    OpenADERepoDeleteRequest,
    OpenADERepoUpdateRequest,
    OpenADEReviewStartRequest,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskChangesReadRequest,
    OpenADETaskChangesReadResult,
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
    OpenADETaskImageReadRequest,
    OpenADETaskImageReadResult,
    OpenADETaskImageStagedReadRequest,
    OpenADETaskImageStagedReadResult,
    OpenADETaskImageWriteRequest,
    OpenADETaskImageWriteResult,
    OpenADETaskMetadataUpdateRequest,
    OpenADETaskPreview,
    OpenADETaskReadOptions,
    OpenADETaskResourceInventoryReadRequest,
    OpenADETaskResourceInventoryReadResult,
    OpenADETaskUsageBackfillRequest,
    OpenADETaskUsageBackfillResult,
    OpenADETaskUsageRecalculateRequest,
    OpenADETaskUsageRecalculateResult,
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
import { importOpenADELegacyYjsData } from "../../../openade-module/src/yjsImport"
import type { OpenADELegacyYjsImportOptions, OpenADELegacyYjsImportResult, OpenADELegacyYjsImportWriter } from "../../../openade-module/src/yjsImport"
import { type OpenADELegacyYjsCoreParityReport, compareOpenADELegacyYjsToCore } from "../../../openade-module/src/yjsImportParity"
import type { OpenADEYjsProjection } from "../../../openade-module/src/yjsProjection"
import { RuntimeRecordCache } from "../../../runtime-client/src"
import type { RuntimeListParams, RuntimeNotification, RuntimeRecord } from "../../../runtime-protocol/src"

function taskKey(repoId: string, taskId: string): string {
    return `${repoId}\0${taskId}`
}

function notificationRecord(notification: RuntimeNotification): Record<string, unknown> {
    return typeof notification.params === "object" && notification.params !== null && !Array.isArray(notification.params)
        ? (notification.params as Record<string, unknown>)
        : {}
}

const LIGHTWEIGHT_TASK_READ_OPTIONS: OpenADETaskReadOptions = { hydrateSessionEvents: false }
const SNAPSHOT_CACHE_TTL_MS = 1_000
const LIGHTWEIGHT_TASK_CACHE_TTL_MS = 1_000
const PROCESS_LIST_CACHE_TTL_MS = 1_000
const PROJECT_SEARCH_CACHE_TTL_MS = 1_000
const GIT_SUMMARY_CACHE_TTL_MS = 1_000
const TASK_UPDATE_NOTIFICATION_COALESCE_MS = 150
const LEGACY_YJS_IMPORT_WRITER_METHODS = [
    "createRepo",
    "updateRepo",
    "createTask",
    "setupTaskEnvironment",
    "createActionEvent",
    "appendActionStreamEvent",
    "completeActionEvent",
    "errorActionEvent",
    "stoppedActionEvent",
    "updateActionExecution",
    "addHyperPlanSubExecution",
    "appendHyperPlanSubExecutionStreamEvent",
    "updateHyperPlanSubExecution",
    "createSnapshotEvent",
    "createComment",
    "updateTaskMetadata",
] as const

type LegacyYjsImportWriterMethod = (typeof LEGACY_YJS_IMPORT_WRITER_METHODS)[number]

interface CachedProcessList {
    expiresAt: number
    result: OpenADEProjectProcessListResult
}

interface CachedFuzzySearch {
    expiresAt: number
    result: OpenADEProjectFilesFuzzySearchResult
}

interface CachedProjectSearch {
    expiresAt: number
    result: OpenADEProjectSearchResult
}

interface CachedProjectGitSummary {
    expiresAt: number
    result: OpenADEProjectGitSummaryReadResult
}

interface CachedTaskGitSummary {
    expiresAt: number
    result: OpenADETaskGitSummaryResult
}

export interface OpenADEProductReadOptions {
    bypassCache?: boolean
}

export interface OpenADEProductLegacyYjsImportReport {
    imported: OpenADELegacyYjsImportResult
    parity: OpenADELegacyYjsCoreParityReport
    legacyYjsMigrationAccepted?: boolean
}

function taskWithMetadataUpdate(task: OpenADETask, args: OpenADETaskMetadataUpdateRequest): OpenADETask {
    return {
        ...task,
        title: args.title ?? task.title,
        closed: args.closed ?? task.closed,
        lastViewedAt: args.lastViewedAt ?? task.lastViewedAt,
        lastEventAt: args.lastEventAt ?? task.lastEventAt,
        cancelledPlanEventId: args.cancelledPlanEventId ?? task.cancelledPlanEventId,
        enabledMcpServerIds: args.enabledMcpServerIds ?? task.enabledMcpServerIds,
        sessionIds: args.sessionIds ? { ...(task.sessionIds ?? {}), ...args.sessionIds } : task.sessionIds,
        queuedTurns: args.queuedTurns ?? task.queuedTurns,
        updatedAt: args.updatedAt ?? task.updatedAt,
    }
}

function taskPreviewWithMetadataUpdate(task: OpenADETaskPreview, args: OpenADETaskMetadataUpdateRequest): OpenADETaskPreview {
    return {
        ...task,
        title: args.title ?? task.title,
        closed: args.closed ?? task.closed,
        lastViewedAt: args.lastViewedAt ?? task.lastViewedAt,
        lastEventAt: args.lastEventAt ?? task.lastEventAt,
        usage: args.usage ?? task.usage,
    }
}

export class OpenADEProductStore {
    snapshot: OpenADESnapshot | null = null
    readonly runtimes = new RuntimeRecordCache()
    private readonly tasks = new Map<string, OpenADETask>()
    private snapshotLoadedAt = 0
    private readonly taskLoadedAt = new Map<string, number>()
    private readonly processListCache = new Map<string, CachedProcessList>()
    private readonly fuzzySearchCache = new Map<string, CachedFuzzySearch>()
    private readonly projectSearchCache = new Map<string, CachedProjectSearch>()
    private readonly projectGitSummaryCache = new Map<string, CachedProjectGitSummary>()
    private readonly taskGitSummaryCache = new Map<string, CachedTaskGitSummary>()
    private readonly pendingTaskUpdateNotifications = new Map<string, RuntimeNotification>()
    private readonly taskUpdateNotificationTimers = new Map<string, ReturnType<typeof setTimeout>>()
    private unsubscribe: (() => void) | null = null

    constructor(
        private readonly client: OpenADEProductClient,
        private readonly legacyYjsImportWriter: OpenADELegacyYjsImportWriter | null = null
    ) {}

    getCachedTask(repoId: string, taskId: string): OpenADETask | null {
        return this.tasks.get(taskKey(repoId, taskId)) ?? null
    }

    private hasCachedTask(repoId: string, taskId: string): boolean {
        return this.tasks.has(taskKey(repoId, taskId))
    }

    async refreshSnapshot(options: OpenADEProductReadOptions = {}): Promise<OpenADESnapshot> {
        if (!options.bypassCache && this.snapshot && Date.now() - this.snapshotLoadedAt < SNAPSHOT_CACHE_TTL_MS) return this.snapshot

        const snapshot = await this.client.getSnapshot()
        this.snapshot = snapshot
        this.snapshotLoadedAt = Date.now()
        return snapshot
    }

    async listRuntimes(args: RuntimeListParams = {}): Promise<RuntimeRecord[]> {
        const runtimes = await this.client.listRuntimes(args)
        this.runtimes.replace(runtimes, args)
        return this.runtimes.list(args)
    }

    async getTask(
        repoId: string,
        taskId: string,
        options: OpenADETaskReadOptions = LIGHTWEIGHT_TASK_READ_OPTIONS,
        readOptions: OpenADEProductReadOptions = {}
    ): Promise<OpenADETask> {
        const key = taskKey(repoId, taskId)
        if (options.hydrateSessionEvents !== true && !readOptions.bypassCache) {
            const loadedAt = this.taskLoadedAt.get(key) ?? 0
            const cached = this.tasks.get(key)
            if (cached && Date.now() - loadedAt < LIGHTWEIGHT_TASK_CACHE_TTL_MS) return cached
        }

        const task = await this.client.getTask(repoId, taskId, options)
        this.tasks.set(key, task)
        this.taskLoadedAt.set(key, Date.now())
        return task
    }

    async refreshTask(repoId: string, taskId: string, options: OpenADETaskReadOptions = LIGHTWEIGHT_TASK_READ_OPTIONS): Promise<OpenADETask> {
        return this.getTask(repoId, taskId, options, { bypassCache: true })
    }

    async listProjectFiles(args: OpenADEProjectFilesTreeRequest): Promise<OpenADEProjectFilesTreeResult> {
        return this.client.listProjectFiles(args)
    }

    async readProjectFile(args: OpenADEProjectFileReadRequest): Promise<OpenADEProjectFileReadResult> {
        return this.client.readProjectFile(args)
    }

    async fuzzySearchProjectFiles(args: OpenADEProjectFilesFuzzySearchRequest): Promise<OpenADEProjectFilesFuzzySearchResult> {
        const key = stableProjectReadCacheKey("fuzzy", args)
        const cached = this.fuzzySearchCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.fuzzySearchProjectFiles(args)
        this.fuzzySearchCache.set(key, { result, expiresAt: Date.now() + PROJECT_SEARCH_CACHE_TTL_MS })
        return result
    }

    async writeProjectFile(args: OpenADEProjectFileWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectFileWriteResult> {
        const result = await this.client.writeProjectFile(args, options)
        this.clearProjectSearchCachesForScope(args.repoId, args.taskId)
        this.clearGitSummaryCacheForScope(args.repoId, args.taskId)
        if (isOpenADETomlPath(args.path)) this.clearProcessListCacheForScope(args.repoId, args.taskId)
        return result
    }

    async searchProject(args: OpenADEProjectSearchRequest): Promise<OpenADEProjectSearchResult> {
        const key = stableProjectReadCacheKey("content", args)
        const cached = this.projectSearchCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.searchProject(args)
        this.projectSearchCache.set(key, { result, expiresAt: Date.now() + PROJECT_SEARCH_CACHE_TTL_MS })
        return result
    }

    async readProjectGitInfo(args: OpenADEProjectGitInfoRequest): Promise<OpenADEProjectGitInfoResult> {
        return this.client.readProjectGitInfo(args)
    }

    async readProjectGitBranches(args: OpenADEProjectGitBranchesReadRequest): Promise<OpenADEProjectGitBranchesReadResult> {
        return this.client.readProjectGitBranches(args)
    }

    async readProjectGitSummary(
        args: OpenADEProjectGitSummaryReadRequest,
        options: OpenADEProductReadOptions = {}
    ): Promise<OpenADEProjectGitSummaryReadResult> {
        const cached = this.projectGitSummaryCache.get(args.repoId)
        if (!options.bypassCache && cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readProjectGitSummary(args)
        this.projectGitSummaryCache.set(args.repoId, { result, expiresAt: Date.now() + GIT_SUMMARY_CACHE_TTL_MS })
        return result
    }

    async listProjectProcesses(args: OpenADEProjectProcessListRequest): Promise<OpenADEProjectProcessListResult> {
        const key = processListCacheKey(args.repoId, args.taskId)
        const cached = this.processListCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.listProjectProcesses(args)
        this.processListCache.set(key, { result, expiresAt: Date.now() + PROCESS_LIST_CACHE_TTL_MS })
        return result
    }

    async startProjectProcess(args: OpenADEProjectProcessStartRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectProcessStartResult> {
        this.clearProcessListCacheForScope(args.repoId, args.taskId)
        const result = await this.client.startProjectProcess(args, options)
        this.clearProcessListCacheForScope(args.repoId, args.taskId)
        return result
    }

    async reconnectProjectProcess(args: OpenADEProjectProcessReconnectRequest): Promise<OpenADEProjectProcessReconnectResult> {
        return this.client.reconnectProjectProcess(args)
    }

    async stopProjectProcess(args: OpenADEProjectProcessStopRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectProcessStopResult> {
        this.clearProcessListCacheForScope(args.repoId, args.taskId)
        const result = await this.client.stopProjectProcess(args, options)
        this.clearProcessListCacheForScope(args.repoId, args.taskId)
        return result
    }

    async readCronInstallState(args: OpenADECronInstallStateReadRequest): Promise<OpenADECronInstallStateReadResult> {
        return this.client.readCronInstallState(args)
    }

    async replaceCronInstallState(
        args: OpenADECronInstallStateReplaceRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADECronInstallStateReplaceResult> {
        return this.client.replaceCronInstallState(args, options)
    }

    async readTaskChanges(args: OpenADETaskChangesReadRequest): Promise<OpenADETaskChangesReadResult> {
        return this.client.readTaskChanges(args)
    }

    async readTaskGitSummary(args: OpenADETaskGitSummaryRequest, options: OpenADEProductReadOptions = {}): Promise<OpenADETaskGitSummaryResult> {
        const key = taskKey(args.repoId, args.taskId)
        const cached = this.taskGitSummaryCache.get(key)
        if (!options.bypassCache && cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskGitSummary(args)
        this.taskGitSummaryCache.set(key, { result, expiresAt: Date.now() + GIT_SUMMARY_CACHE_TTL_MS })
        return result
    }

    async readTaskGitScopes(args: OpenADETaskGitScopesReadRequest): Promise<OpenADETaskGitScopesReadResult> {
        return this.client.readTaskGitScopes(args)
    }

    async readTaskDiff(args: OpenADETaskDiffReadRequest): Promise<OpenADETaskDiffReadResult> {
        return this.client.readTaskDiff(args)
    }

    async readTaskFilePair(args: OpenADETaskFilePairReadRequest): Promise<OpenADETaskFilePairReadResult> {
        return this.client.readTaskFilePair(args)
    }

    async readTaskGitLog(args: OpenADETaskGitLogRequest): Promise<OpenADETaskGitLogResult> {
        return this.client.readTaskGitLog(args)
    }

    async readTaskGitCommitFiles(args: OpenADETaskGitCommitFilesRequest): Promise<OpenADETaskGitCommitFilesResult> {
        return this.client.readTaskGitCommitFiles(args)
    }

    async readTaskGitFileAtTreeish(args: OpenADETaskGitFileAtTreeishRequest): Promise<OpenADETaskGitFileAtTreeishResult> {
        return this.client.readTaskGitFileAtTreeish(args)
    }

    async readTaskGitCommitFilePatch(args: OpenADETaskGitCommitFilePatchRequest): Promise<OpenADETaskGitCommitFilePatchResult> {
        return this.client.readTaskGitCommitFilePatch(args)
    }

    async commitTaskGit(args: OpenADETaskGitCommitRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskGitCommitResult> {
        this.clearGitSummaryCacheForScope(args.repoId, args.taskId)
        const result = await this.client.commitTaskGit(args, options)
        this.clearGitSummaryCacheForScope(args.repoId, args.taskId)
        return result
    }

    async startTaskTerminal(args: OpenADETaskTerminalStartRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalStartResult> {
        return this.client.startTaskTerminal(args, options)
    }

    async reconnectTaskTerminal(args: OpenADETaskTerminalReconnectRequest): Promise<OpenADETaskTerminalReconnectResult> {
        return this.client.reconnectTaskTerminal(args)
    }

    async writeTaskTerminal(args: OpenADETaskTerminalWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        return this.client.writeTaskTerminal(args, options)
    }

    async resizeTaskTerminal(args: OpenADETaskTerminalResizeRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        return this.client.resizeTaskTerminal(args, options)
    }

    async stopTaskTerminal(args: OpenADETaskTerminalStopRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        return this.client.stopTaskTerminal(args, options)
    }

    async importLegacyResources(args: OpenADELegacyResourcesImportRequest, options: OpenADERequestOptions = {}): Promise<OpenADELegacyResourcesImportResult> {
        const result = await this.client.importLegacyResources(args, options)
        await this.refreshSnapshot({ bypassCache: true })
        return result
    }

    async importLegacyYjsData(projection: OpenADEYjsProjection, options: OpenADELegacyYjsImportOptions = {}): Promise<OpenADEProductLegacyYjsImportReport> {
        const writer = this.legacyYjsImportWriter ?? legacyYjsImportWriterFromClient(this.client)
        if (!writer) throw new Error("OpenADE Core legacy Yjs import writer is not available.")
        const imported = await importOpenADELegacyYjsData(projection, writer, options)
        const parity = await compareOpenADELegacyYjsToCore(projection, this.client, options)
        await this.refreshSnapshot({ bypassCache: true })
        return { imported, parity }
    }

    async readTaskImage(args: OpenADETaskImageReadRequest): Promise<OpenADETaskImageReadResult> {
        return this.client.readTaskImage(args)
    }

    async readStagedTaskImage(args: OpenADETaskImageStagedReadRequest): Promise<OpenADETaskImageStagedReadResult> {
        return this.client.readStagedTaskImage(args)
    }

    async writeTaskImage(args: OpenADETaskImageWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskImageWriteResult> {
        return this.client.writeTaskImage(args, options)
    }

    async readTaskResourceInventory(args: OpenADETaskResourceInventoryReadRequest): Promise<OpenADETaskResourceInventoryReadResult> {
        return this.client.readTaskResourceInventory(args)
    }

    async readMcpServers(): Promise<OpenADEMCPServersReadResult> {
        return this.client.readMcpServers()
    }

    async replaceMcpServers(args: OpenADEMCPServersReplaceRequest, options: OpenADERequestOptions = {}): Promise<OpenADEMCPServersReplaceResult> {
        return this.client.replaceMcpServers(args, options)
    }

    async upsertMcpServer(args: OpenADEMCPServerUpsertRequest, options: OpenADERequestOptions = {}): Promise<OpenADEMCPServerUpsertResult> {
        return this.client.upsertMcpServer(args, options)
    }

    async deleteMcpServer(args: OpenADEMCPServerDeleteRequest, options: OpenADERequestOptions = {}): Promise<OpenADEMCPServerDeleteResult> {
        return this.client.deleteMcpServer(args, options)
    }

    async readPersonalSettings(): Promise<OpenADEPersonalSettingsReadResult> {
        return this.client.readPersonalSettings()
    }

    async replacePersonalSettings(
        args: OpenADEPersonalSettingsReplaceRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEPersonalSettingsReplaceResult> {
        return this.client.replacePersonalSettings(args, options)
    }

    async generateTaskTitle(args: OpenADETaskTitleGenerateRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTitleGenerateResult> {
        const result = await this.client.generateTaskTitle(args, options)
        await this.refreshTask(args.repoId, args.taskId)
        await this.refreshSnapshot({ bypassCache: true })
        return result
    }

    async readTaskSnapshotPatch(args: OpenADETaskSnapshotPatchReadRequest): Promise<OpenADETaskSnapshotPatchReadResult> {
        return this.client.readTaskSnapshotPatch(args)
    }

    async readTaskSnapshotIndex(args: OpenADETaskSnapshotIndexReadRequest): Promise<OpenADETaskSnapshotIndexReadResult> {
        return this.client.readTaskSnapshotIndex(args)
    }

    async readTaskSnapshotPatchSlice(args: OpenADETaskSnapshotPatchSliceReadRequest): Promise<OpenADETaskSnapshotPatchSliceReadResult> {
        return this.client.readTaskSnapshotPatchSlice(args)
    }

    async createRepo(args: OpenADERepoCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADERepoCreateResult> {
        const result = await this.client.createRepo(args, options)
        await this.refreshSnapshot({ bypassCache: true })
        return result
    }

    async updateRepo(args: OpenADERepoUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        this.clearGitSummaryCacheForScope(args.repoId)
        await this.client.updateRepo(args, options)
        this.clearGitSummaryCacheForScope(args.repoId)
        await this.refreshSnapshot({ bypassCache: true })
    }

    async deleteRepo(args: OpenADERepoDeleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        this.clearGitSummaryCacheForScope(args.repoId)
        await this.client.deleteRepo(args, options)
        this.clearGitSummaryCacheForScope(args.repoId)
        await this.refreshSnapshot({ bypassCache: true })
    }

    async startTurn(args: OpenADETurnStartRequest, options: OpenADETurnStartOptions = {}): Promise<OpenADETurnStartResult> {
        const result = await this.client.startTurn(args, options)
        this.clearGitSummaryCacheForScope(args.repoId, result.taskId || args.inTaskId || undefined)
        await this.refreshSnapshot({ bypassCache: true })
        if (result.taskId) await this.refreshTask(args.repoId, result.taskId)
        return result
    }

    async startReview(args: OpenADEReviewStartRequest, options: OpenADETurnStartOptions = {}): Promise<{ taskId: string }> {
        const result = await this.client.startReview(args, options)
        await this.refreshTask(args.repoId, result.taskId)
        return result
    }

    async interruptTurn(taskId: string, options: OpenADERequestOptions = {}): Promise<void> {
        await this.client.interruptTurn(taskId, options)
    }

    async cancelQueuedTurn(args: OpenADEQueuedTurnCancelRequest, options: OpenADERequestOptions = {}): Promise<OpenADEQueuedTurnCancelResult> {
        const result = await this.client.cancelQueuedTurn(args, options)
        await this.refreshTask(args.repoId, args.taskId)
        return result
    }

    async updateTaskMetadata(args: OpenADETaskMetadataUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.client.updateTaskMetadata(args, options)
        this.applyTaskMetadataUpdate(args)
    }

    async backfillTaskUsage(args: OpenADETaskUsageBackfillRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskUsageBackfillResult> {
        const result = await this.client.backfillTaskUsage(args, options)
        await this.refreshSnapshot({ bypassCache: true })
        return result
    }

    async recalculateTaskUsage(args: OpenADETaskUsageRecalculateRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskUsageRecalculateResult> {
        const result = await this.client.recalculateTaskUsage(args, options)
        const cached = [...this.tasks.values()].find((task) => task.id === args.taskId)
        if (cached) await this.refreshTask(cached.repoId, args.taskId)
        await this.refreshSnapshot({ bypassCache: true })
        return result
    }

    async createComment(args: OpenADECommentCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADECommentCreateResult> {
        const result = await this.client.createComment(args, options)
        const cached = [...this.tasks.values()].find((task) => task.id === args.taskId)
        if (cached) await this.refreshTask(cached.repoId, args.taskId)
        return result
    }

    async editComment(args: OpenADECommentEditRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.client.editComment(args, options)
        const cached = [...this.tasks.values()].find((task) => task.id === args.taskId)
        if (cached) await this.refreshTask(cached.repoId, args.taskId)
    }

    async deleteComment(args: OpenADECommentDeleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.client.deleteComment(args, options)
        const cached = [...this.tasks.values()].find((task) => task.id === args.taskId)
        if (cached) await this.refreshTask(cached.repoId, args.taskId)
    }

    async deleteTask(args: OpenADETaskDeleteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskDeleteResult> {
        const result = await this.client.deleteTask(args, options)
        this.clearTaskCache(args.repoId, args.taskId)
        await this.refreshSnapshot({ bypassCache: true })
        return result
    }

    async setupTaskEnvironment(args: OpenADETaskEnvironmentSetupRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.client.setupTaskEnvironment(args, options)
        const cached = [...this.tasks.values()].find((task) => task.id === args.taskId)
        if (cached) await this.refreshTask(cached.repoId, args.taskId)
        await this.refreshSnapshot({ bypassCache: true })
    }

    async prepareTaskEnvironment(
        args: OpenADETaskEnvironmentPrepareRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskEnvironmentPrepareResult> {
        const result = await this.client.prepareTaskEnvironment(args, options)
        await this.refreshTask(args.repoId, args.taskId)
        await this.refreshSnapshot({ bypassCache: true })
        return result
    }

    async handleNotification(notification: RuntimeNotification): Promise<boolean> {
        this.runtimes.applyNotification(notification)
        const params = notificationRecord(notification)
        const repoId = typeof params.repoId === "string" ? params.repoId : undefined
        const taskId = typeof params.taskId === "string" ? params.taskId : undefined

        if (
            notification.method === "openade/snapshotChanged" ||
            notification.method === "openade/repo/updated" ||
            notification.method === "openade/repo/deleted"
        ) {
            await this.refreshSnapshot({ bypassCache: true })
            return true
        }

        if (notification.method === "openade/task/deleted" && repoId && taskId) {
            this.clearTaskCache(repoId, taskId)
            await this.refreshSnapshot({ bypassCache: true })
            return true
        }

        if (notification.method === "openade/task/previewChanged") {
            await this.refreshSnapshot({ bypassCache: true })
            return true
        }

        if ((notification.method === "openade/task/updated" || notification.method === "openade/queuedTurn/updated") && repoId && taskId) {
            this.clearGitSummaryCacheForScope(repoId, taskId)
            if (this.hasCachedTask(repoId, taskId)) {
                await this.refreshTask(repoId, taskId, LIGHTWEIGHT_TASK_READ_OPTIONS)
            }
            return true
        }

        return false
    }

    private applyTaskMetadataUpdate(args: OpenADETaskMetadataUpdateRequest): void {
        for (const [key, task] of this.tasks) {
            if (task.id === args.taskId) this.tasks.set(key, taskWithMetadataUpdate(task, args))
        }

        if (!this.snapshot) return
        this.snapshot = {
            ...this.snapshot,
            repos: this.snapshot.repos.map((repo) => ({
                ...repo,
                tasks: repo.tasks.map((task) => (task.id === args.taskId ? taskPreviewWithMetadataUpdate(task, args) : task)),
            })),
        }
    }

    subscribe(): () => void {
        if (this.unsubscribe) return this.unsubscribe
        const unsubscribeClient = this.client.subscribeToChanges((notification) => {
            if (this.scheduleTaskUpdateNotification(notification)) return
            this.cancelPendingTaskUpdateNotification(notification)
            void this.handleNotification(notification)
        })
        let subscribed = true
        this.unsubscribe = () => {
            if (!subscribed) return
            subscribed = false
            this.clearPendingTaskUpdateNotifications()
            unsubscribeClient()
            this.unsubscribe = null
        }
        return this.unsubscribe
    }

    destroy(): void {
        this.unsubscribe?.()
        this.unsubscribe = null
        this.clearPendingTaskUpdateNotifications()
        this.tasks.clear()
        this.taskLoadedAt.clear()
        this.processListCache.clear()
        this.fuzzySearchCache.clear()
        this.projectSearchCache.clear()
        this.projectGitSummaryCache.clear()
        this.taskGitSummaryCache.clear()
        this.runtimes.clear()
    }

    private scheduleTaskUpdateNotification(notification: RuntimeNotification): boolean {
        if (notification.method !== "openade/task/updated" && notification.method !== "openade/queuedTurn/updated") return false

        const key = taskNotificationKey(notification)
        if (!key) return false

        this.pendingTaskUpdateNotifications.set(key, notification)
        if (this.taskUpdateNotificationTimers.has(key)) return true

        const timer = setTimeout(() => {
            this.taskUpdateNotificationTimers.delete(key)
            const pending = this.pendingTaskUpdateNotifications.get(key)
            this.pendingTaskUpdateNotifications.delete(key)
            if (pending) void this.handleNotification(pending)
        }, TASK_UPDATE_NOTIFICATION_COALESCE_MS)
        this.taskUpdateNotificationTimers.set(key, timer)
        return true
    }

    private cancelPendingTaskUpdateNotification(notification: RuntimeNotification): void {
        if (notification.method !== "openade/task/previewChanged" && notification.method !== "openade/task/deleted") return

        const key = taskNotificationKey(notification)
        if (!key) return

        const timer = this.taskUpdateNotificationTimers.get(key)
        if (timer) clearTimeout(timer)
        this.taskUpdateNotificationTimers.delete(key)
        this.pendingTaskUpdateNotifications.delete(key)
    }

    private clearPendingTaskUpdateNotifications(): void {
        for (const timer of this.taskUpdateNotificationTimers.values()) clearTimeout(timer)
        this.taskUpdateNotificationTimers.clear()
        this.pendingTaskUpdateNotifications.clear()
    }

    private clearProcessListCacheForScope(repoId: string, taskId?: string): void {
        if (taskId !== undefined) {
            this.processListCache.delete(processListCacheKey(repoId, taskId))
            return
        }
        for (const key of this.processListCache.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.processListCache.delete(key)
        }
    }

    private clearProjectSearchCachesForScope(repoId: string, taskId?: string): void {
        clearProjectScopedCache(this.fuzzySearchCache, repoId, taskId)
        clearProjectScopedCache(this.projectSearchCache, repoId, taskId)
    }

    private clearTaskCache(repoId: string, taskId: string): void {
        const key = taskKey(repoId, taskId)
        this.tasks.delete(key)
        this.taskLoadedAt.delete(key)
    }

    private clearGitSummaryCacheForScope(repoId: string, taskId?: string): void {
        this.projectGitSummaryCache.delete(repoId)
        if (taskId !== undefined) {
            this.taskGitSummaryCache.delete(taskKey(repoId, taskId))
            return
        }
        for (const key of this.taskGitSummaryCache.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.taskGitSummaryCache.delete(key)
        }
    }
}

function processListCacheKey(repoId: string, taskId?: string): string {
    return `${repoId}\0${taskId ?? ""}`
}

function taskNotificationKey(notification: RuntimeNotification): string | null {
    const params = notificationRecord(notification)
    const repoId = typeof params.repoId === "string" ? params.repoId : null
    const taskId = typeof params.taskId === "string" ? params.taskId : null
    return repoId && taskId ? taskKey(repoId, taskId) : null
}

function isOpenADETomlPath(path: string): boolean {
    const normalized = path.replace(/\\/g, "/")
    const segments = normalized.split("/")
    return segments[segments.length - 1] === "openade.toml"
}

function stableProjectReadCacheKey(prefix: string, args: OpenADEProjectFilesFuzzySearchRequest | OpenADEProjectSearchRequest): string {
    const sorted = Object.fromEntries(
        Object.keys(args)
            .sort()
            .map((key) => [key, args[key as keyof typeof args]])
    )
    return `${prefix}\0${args.repoId}\0${args.taskId ?? ""}\0${JSON.stringify(sorted)}`
}

function clearProjectScopedCache<T>(cache: Map<string, T>, repoId: string, taskId?: string): void {
    const scope = taskId === undefined ? `\0${repoId}\0` : `\0${repoId}\0${taskId}\0`
    for (const key of cache.keys()) {
        if (key.includes(scope)) cache.delete(key)
    }
}

function legacyYjsImportWriterFromClient(client: OpenADEProductClient): OpenADELegacyYjsImportWriter | null {
    const candidate = client as Partial<Record<LegacyYjsImportWriterMethod, unknown>>
    const hasRequiredMethods = LEGACY_YJS_IMPORT_WRITER_METHODS.every((method) => typeof candidate[method] === "function")
    return hasRequiredMethods ? (client as OpenADEProductClient & OpenADELegacyYjsImportWriter) : null
}

export interface OpenADEProductClient {
    getSnapshot(): Promise<OpenADESnapshot>
    listRuntimes(args?: RuntimeListParams): Promise<RuntimeRecord[]>
    getTask(repoId: string, taskId: string, options?: OpenADETaskReadOptions): Promise<OpenADETask>
    listProjectFiles(args: OpenADEProjectFilesTreeRequest): Promise<OpenADEProjectFilesTreeResult>
    readProjectFile(args: OpenADEProjectFileReadRequest): Promise<OpenADEProjectFileReadResult>
    fuzzySearchProjectFiles(args: OpenADEProjectFilesFuzzySearchRequest): Promise<OpenADEProjectFilesFuzzySearchResult>
    writeProjectFile(args: OpenADEProjectFileWriteRequest, options?: OpenADERequestOptions): Promise<OpenADEProjectFileWriteResult>
    searchProject(args: OpenADEProjectSearchRequest): Promise<OpenADEProjectSearchResult>
    readProjectGitInfo(args: OpenADEProjectGitInfoRequest): Promise<OpenADEProjectGitInfoResult>
    readProjectGitBranches(args: OpenADEProjectGitBranchesReadRequest): Promise<OpenADEProjectGitBranchesReadResult>
    readProjectGitSummary(args: OpenADEProjectGitSummaryReadRequest): Promise<OpenADEProjectGitSummaryReadResult>
    listProjectProcesses(args: OpenADEProjectProcessListRequest): Promise<OpenADEProjectProcessListResult>
    startProjectProcess(args: OpenADEProjectProcessStartRequest, options?: OpenADERequestOptions): Promise<OpenADEProjectProcessStartResult>
    reconnectProjectProcess(args: OpenADEProjectProcessReconnectRequest): Promise<OpenADEProjectProcessReconnectResult>
    stopProjectProcess(args: OpenADEProjectProcessStopRequest, options?: OpenADERequestOptions): Promise<OpenADEProjectProcessStopResult>
    readCronInstallState(args: OpenADECronInstallStateReadRequest): Promise<OpenADECronInstallStateReadResult>
    replaceCronInstallState(args: OpenADECronInstallStateReplaceRequest, options?: OpenADERequestOptions): Promise<OpenADECronInstallStateReplaceResult>
    readTaskChanges(args: OpenADETaskChangesReadRequest): Promise<OpenADETaskChangesReadResult>
    readTaskGitSummary(args: OpenADETaskGitSummaryRequest): Promise<OpenADETaskGitSummaryResult>
    readTaskGitScopes(args: OpenADETaskGitScopesReadRequest): Promise<OpenADETaskGitScopesReadResult>
    readTaskDiff(args: OpenADETaskDiffReadRequest): Promise<OpenADETaskDiffReadResult>
    readTaskFilePair(args: OpenADETaskFilePairReadRequest): Promise<OpenADETaskFilePairReadResult>
    readTaskGitLog(args: OpenADETaskGitLogRequest): Promise<OpenADETaskGitLogResult>
    readTaskGitCommitFiles(args: OpenADETaskGitCommitFilesRequest): Promise<OpenADETaskGitCommitFilesResult>
    readTaskGitFileAtTreeish(args: OpenADETaskGitFileAtTreeishRequest): Promise<OpenADETaskGitFileAtTreeishResult>
    readTaskGitCommitFilePatch(args: OpenADETaskGitCommitFilePatchRequest): Promise<OpenADETaskGitCommitFilePatchResult>
    commitTaskGit(args: OpenADETaskGitCommitRequest, options?: OpenADERequestOptions): Promise<OpenADETaskGitCommitResult>
    startTaskTerminal(args: OpenADETaskTerminalStartRequest, options?: OpenADERequestOptions): Promise<OpenADETaskTerminalStartResult>
    reconnectTaskTerminal(args: OpenADETaskTerminalReconnectRequest): Promise<OpenADETaskTerminalReconnectResult>
    writeTaskTerminal(args: OpenADETaskTerminalWriteRequest, options?: OpenADERequestOptions): Promise<OpenADETaskTerminalMutationResult>
    resizeTaskTerminal(args: OpenADETaskTerminalResizeRequest, options?: OpenADERequestOptions): Promise<OpenADETaskTerminalMutationResult>
    stopTaskTerminal(args: OpenADETaskTerminalStopRequest, options?: OpenADERequestOptions): Promise<OpenADETaskTerminalMutationResult>
    importLegacyResources(args: OpenADELegacyResourcesImportRequest, options?: OpenADERequestOptions): Promise<OpenADELegacyResourcesImportResult>
    readTaskImage(args: OpenADETaskImageReadRequest): Promise<OpenADETaskImageReadResult>
    readStagedTaskImage(args: OpenADETaskImageStagedReadRequest): Promise<OpenADETaskImageStagedReadResult>
    writeTaskImage(args: OpenADETaskImageWriteRequest, options?: OpenADERequestOptions): Promise<OpenADETaskImageWriteResult>
    readTaskResourceInventory(args: OpenADETaskResourceInventoryReadRequest): Promise<OpenADETaskResourceInventoryReadResult>
    readMcpServers(): Promise<OpenADEMCPServersReadResult>
    replaceMcpServers(args: OpenADEMCPServersReplaceRequest, options?: OpenADERequestOptions): Promise<OpenADEMCPServersReplaceResult>
    upsertMcpServer(args: OpenADEMCPServerUpsertRequest, options?: OpenADERequestOptions): Promise<OpenADEMCPServerUpsertResult>
    deleteMcpServer(args: OpenADEMCPServerDeleteRequest, options?: OpenADERequestOptions): Promise<OpenADEMCPServerDeleteResult>
    readPersonalSettings(): Promise<OpenADEPersonalSettingsReadResult>
    replacePersonalSettings(args: OpenADEPersonalSettingsReplaceRequest, options?: OpenADERequestOptions): Promise<OpenADEPersonalSettingsReplaceResult>
    generateTaskTitle(args: OpenADETaskTitleGenerateRequest, options?: OpenADERequestOptions): Promise<OpenADETaskTitleGenerateResult>
    readTaskSnapshotPatch(args: OpenADETaskSnapshotPatchReadRequest): Promise<OpenADETaskSnapshotPatchReadResult>
    readTaskSnapshotIndex(args: OpenADETaskSnapshotIndexReadRequest): Promise<OpenADETaskSnapshotIndexReadResult>
    readTaskSnapshotPatchSlice(args: OpenADETaskSnapshotPatchSliceReadRequest): Promise<OpenADETaskSnapshotPatchSliceReadResult>
    createRepo(args: OpenADERepoCreateRequest, options?: OpenADERequestOptions): Promise<OpenADERepoCreateResult>
    updateRepo(args: OpenADERepoUpdateRequest, options?: OpenADERequestOptions): Promise<void>
    deleteRepo(args: OpenADERepoDeleteRequest, options?: OpenADERequestOptions): Promise<void>
    startTurn(args: OpenADETurnStartRequest, options?: OpenADETurnStartOptions): Promise<OpenADETurnStartResult>
    startReview(args: OpenADEReviewStartRequest, options?: OpenADETurnStartOptions): Promise<{ taskId: string }>
    interruptTurn(taskId: string, options?: OpenADERequestOptions): Promise<void>
    cancelQueuedTurn(args: OpenADEQueuedTurnCancelRequest, options?: OpenADERequestOptions): Promise<OpenADEQueuedTurnCancelResult>
    updateTaskMetadata(args: OpenADETaskMetadataUpdateRequest, options?: OpenADERequestOptions): Promise<void>
    backfillTaskUsage(args: OpenADETaskUsageBackfillRequest, options?: OpenADERequestOptions): Promise<OpenADETaskUsageBackfillResult>
    recalculateTaskUsage(args: OpenADETaskUsageRecalculateRequest, options?: OpenADERequestOptions): Promise<OpenADETaskUsageRecalculateResult>
    createComment(args: OpenADECommentCreateRequest, options?: OpenADERequestOptions): Promise<OpenADECommentCreateResult>
    editComment(args: OpenADECommentEditRequest, options?: OpenADERequestOptions): Promise<void>
    deleteComment(args: OpenADECommentDeleteRequest, options?: OpenADERequestOptions): Promise<void>
    deleteTask(args: OpenADETaskDeleteRequest, options?: OpenADERequestOptions): Promise<OpenADETaskDeleteResult>
    setupTaskEnvironment(args: OpenADETaskEnvironmentSetupRequest, options?: OpenADERequestOptions): Promise<void>
    prepareTaskEnvironment(args: OpenADETaskEnvironmentPrepareRequest, options?: OpenADERequestOptions): Promise<OpenADETaskEnvironmentPrepareResult>
    subscribeToChanges(onEvent: (notification: RuntimeNotification) => void): () => void
}
