import { OPENADE_METHOD, OPENADE_NOTIFICATION } from "./generated/openade-contracts"
import type { RuntimeHandlerContext, RuntimeModule, RuntimeServer } from "../../runtime/src"
import type { RuntimeValidationResult } from "../../runtime-protocol/src"
import type { OpenADEYjsDocumentOperationOptions, OpenADEYjsProjectionCacheInvalidation } from "./yjsProjection"
import type {
    OpenADEActionEventCompleteRequest,
    OpenADEActionEventCreateRequest,
    OpenADEActionEventErrorRequest,
    OpenADEActionEventRuntimeReconcileRequest,
    OpenADEActionEventRuntimeReconcileResult,
    OpenADEActionEventStoppedRequest,
    OpenADEActionExecutionUpdateRequest,
    OpenADEActionStreamAppendRequest,
    OpenADEAgentCouplet,
    OpenADECommentCreateRequest,
    OpenADECommentDeleteRequest,
    OpenADECommentEditRequest,
    OpenADECronInstallState,
    OpenADECronInstallStateListResult,
    OpenADECronInstallStateReadRequest,
    OpenADECronInstallStateReadResult,
    OpenADECronInstallStateReplaceRequest,
    OpenADECronInstallStateReplaceResult,
    OpenADECronRunRequest,
    OpenADECronRunResult,
    OpenADECronDefinitionsReadRequest,
    OpenADECronDefinitionsReadResult,
    OpenADEEventStatus,
    OpenADEHyperPlanReconcileLabelsSetRequest,
    OpenADEHyperPlanStepPrimitive,
    OpenADEHyperPlanStrategy,
    OpenADEHyperPlanSubExecutionAddRequest,
    OpenADEHyperPlanSubExecutionStreamAppendRequest,
    OpenADEHyperPlanSubExecutionUpdateRequest,
    OpenADELegacyResourcesImportRequest,
    OpenADELegacyResourcesImportResult,
    OpenADEMCPHealthStatus,
    OpenADEMCPOAuthTokens,
    OpenADEMCPServer,
    OpenADEMCPServerDeleteRequest,
    OpenADEMCPServerDeleteResult,
    OpenADEMCPServersReadResult,
    OpenADEMCPServersReplaceRequest,
    OpenADEMCPServersReplaceResult,
    OpenADEMCPServerUpsertRequest,
    OpenADEMCPServerUpsertResult,
    OpenADEPersonalSettings,
    OpenADEPersonalSettingsReadResult,
    OpenADEPersonalSettingsReplaceRequest,
    OpenADEPersonalSettingsReplaceResult,
    OpenADEPersonalSettingsTab,
    OpenADEPersonalSettingsThemeSetting,
    OpenADEProjectFileReadRequest,
    OpenADEProjectFileReadResult,
    OpenADEProjectFilesFuzzySearchRequest,
    OpenADEProjectFilesFuzzySearchResult,
    OpenADEProjectFilesTreeRequest,
    OpenADEProjectFilesTreeResult,
    OpenADEProjectFileWriteRequest,
    OpenADEProjectFileWriteResult,
    OpenADEProjectProcessListRequest,
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectRequest,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectProcessStartRequest,
    OpenADEProjectProcessStartResult,
    OpenADEProjectProcessStopRequest,
    OpenADEProjectProcessStopResult,
    OpenADEProjectGitBranchesReadRequest,
    OpenADEProjectGitBranchesReadResult,
    OpenADEProjectGitInfoRequest,
    OpenADEProjectGitInfoResult,
    OpenADEProjectGitSummaryReadRequest,
    OpenADEProjectGitSummaryReadResult,
    OpenADERepoCreateRequest,
    OpenADERepoCreateResult,
    OpenADERepoDeleteRequest,
    OpenADERepoPathInspectRequest,
    OpenADERepoPathInspectResult,
    OpenADERepoUpdateRequest,
    OpenADEProjectSearchRequest,
    OpenADEProjectSearchResult,
    OpenADEProjectSdkCapabilitiesReadRequest,
    OpenADEProject,
    OpenADEQueuedTurnCancelRequest,
    OpenADEQueuedTurnCancelResult,
    OpenADEQueuedTurnEnqueueRequest,
    OpenADEQueuedTurnEnqueueResult,
    OpenADEQueuedTurnReorderRequest,
    OpenADEQueuedTurnReorderResult,
    OpenADESnapshotEventCreateRequest,
    OpenADESnapshot,
    OpenADESnapshotEventCreateResult,
    OpenADESnapshotEventRecord,
    OpenADETask,
    OpenADETaskChangesReadRequest,
    OpenADETaskChangesReadResult,
    OpenADETaskCreateRequest,
    OpenADETaskCreateResult,
    OpenADETaskDiffContextLines,
    OpenADETaskDiffReadRequest,
    OpenADETaskDiffReadResult,
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
    OpenADETaskImageReference,
    OpenADETaskImageStagedReadRequest,
    OpenADETaskImageStagedReadResult,
    OpenADETaskImageWriteRequest,
    OpenADETaskImageWriteResult,
    OpenADETaskResourceInventoryReadRequest,
    OpenADETaskResourceInventoryReadResult,
    OpenADETaskTerminalMutationResult,
    OpenADETaskUsageBackfillRequest,
    OpenADETaskUsageBackfillResult,
    OpenADETaskUsageRecalculateRequest,
    OpenADETaskUsageRecalculateResult,
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
    OpenADETaskReadOptions,
    OpenADETaskReadRequest,
    OpenADETaskTitleGenerateRequest,
    OpenADETaskTitleGenerateResult,
    OpenADETaskDeleteRequest,
    OpenADETaskDeleteResult,
    OpenADETaskEnvironmentPrepareRequest,
    OpenADETaskEnvironmentPrepareResult,
    OpenADETaskEnvironmentSetupRequest,
    OpenADETaskPreview,
    OpenADETaskMetadataUpdateRequest,
    OpenADEReviewStartRequest,
    OpenADESdkCapabilities,
    OpenADETurnStartRequest,
} from "./types"

export type OpenADERuntimeBridgeEvent =
    | { type: "snapshot_changed"; at: string }
    | {
          type: "task_changed"
          repoId: string
          taskId: string
          previewChanged?: boolean
          eventId?: string
          eventStatus?: OpenADEEventStatus
          clientRequestId?: string
          at: string
      }
    | { type: "task_deleted"; repoId: string; taskId: string; at: string }
    | { type: "repo_changed"; repoId: string; at: string }
    | { type: "repo_deleted"; repoId: string; at: string }
    | { type: "working_tasks"; taskIds: string[]; at: string }
    | { type: "devices_changed"; at: string }

export interface OpenADEReadAdapter {
    readSnapshot(options?: {
        version?: string
        hostName?: string
        workingTaskIds?: string[]
    }): Promise<OpenADESnapshot>
    readProjects(options?: {
        workingTaskIds?: string[]
    }): Promise<OpenADEProject[]>
    readTaskList(repoId: string, options?: { workingTaskIds?: string[] }): Promise<OpenADETaskPreview[]>
    readTask(repoId: string, taskId: string, options?: OpenADETaskReadOptions): Promise<OpenADETask>
    listDataDocuments(): Promise<string[]>
    readDataDocumentBase64(id: string, options?: OpenADEYjsDocumentOperationOptions): Promise<{ id: string; data: string } | null>
}

export interface OpenADEWriteAdapter {
    saveDataDocumentBase64(id: string, data: string, options?: OpenADEYjsDocumentOperationOptions): Promise<unknown>
    deleteDataDocument(id: string): Promise<unknown>
    createRepo(params: OpenADERepoCreateRequest): Promise<OpenADERepoCreateResult>
    updateRepo(params: OpenADERepoUpdateRequest): Promise<unknown>
    deleteRepo(params: OpenADERepoDeleteRequest): Promise<unknown>
    createTask(params: OpenADETaskCreateRequest): Promise<OpenADETaskCreateResult>
    startTurn(params: OpenADETurnStartRequest, context?: OpenADETurnStartContext): Promise<unknown>
    startReview(params: OpenADEReviewStartRequest, context?: OpenADETurnStartContext): Promise<unknown>
    interruptTurn(params: { taskId: string }): Promise<unknown>
    enqueueQueuedTurn(params: OpenADEQueuedTurnEnqueueRequest): Promise<OpenADEQueuedTurnEnqueueResult>
    reorderQueuedTurns(params: OpenADEQueuedTurnReorderRequest): Promise<OpenADEQueuedTurnReorderResult>
    cancelQueuedTurn(params: OpenADEQueuedTurnCancelRequest): Promise<OpenADEQueuedTurnCancelResult>
    deleteTask(params: OpenADETaskDeleteRequest): Promise<OpenADETaskDeleteResult>
    setupTaskEnvironment(params: OpenADETaskEnvironmentSetupRequest): Promise<unknown>
    createActionEvent(params: OpenADEActionEventCreateRequest): Promise<unknown>
    appendActionStreamEvent(params: OpenADEActionStreamAppendRequest): Promise<unknown>
    completeActionEvent(params: OpenADEActionEventCompleteRequest): Promise<unknown>
    errorActionEvent(params: OpenADEActionEventErrorRequest): Promise<unknown>
    stoppedActionEvent(params: OpenADEActionEventStoppedRequest): Promise<unknown>
    reconcileActionEventRuntime(params: OpenADEActionEventRuntimeReconcileRequest): Promise<OpenADEActionEventRuntimeReconcileResult>
    updateActionExecution(params: OpenADEActionExecutionUpdateRequest): Promise<unknown>
    addHyperPlanSubExecution(params: OpenADEHyperPlanSubExecutionAddRequest): Promise<unknown>
    appendHyperPlanSubExecutionStreamEvent(params: OpenADEHyperPlanSubExecutionStreamAppendRequest): Promise<unknown>
    updateHyperPlanSubExecution(params: OpenADEHyperPlanSubExecutionUpdateRequest): Promise<unknown>
    setHyperPlanReconcileLabels(params: OpenADEHyperPlanReconcileLabelsSetRequest): Promise<unknown>
    createSnapshotEvent(params: OpenADESnapshotEventCreateRequest): Promise<OpenADESnapshotEventCreateResult>
    createComment(params: OpenADECommentCreateRequest): Promise<unknown>
    editComment(params: OpenADECommentEditRequest): Promise<unknown>
    deleteComment(params: OpenADECommentDeleteRequest): Promise<unknown>
    updateTaskMetadata(params: OpenADETaskMetadataUpdateRequest): Promise<unknown>
    writeTaskImage?(params: OpenADETaskImageWriteRequest): Promise<OpenADETaskImageWriteResult>
    readStagedTaskImage?(params: OpenADETaskImageStagedReadRequest): Promise<OpenADETaskImageStagedReadResult>
}

export interface OpenADEScopedHostAdapter {
    inspectRepoPath?(params: OpenADERepoPathInspectRequest): Promise<OpenADERepoPathInspectResult>
    listProjectFiles(
        params: OpenADEProjectFilesTreeRequest & {
            repo: OpenADEProject
            task?: OpenADETask
        }
    ): Promise<OpenADEProjectFilesTreeResult>
    readProjectFile(
        params: OpenADEProjectFileReadRequest & {
            repo: OpenADEProject
            task?: OpenADETask
        }
    ): Promise<OpenADEProjectFileReadResult>
    writeProjectFile(
        params: OpenADEProjectFileWriteRequest & {
            repo: OpenADEProject
            task?: OpenADETask
        }
    ): Promise<OpenADEProjectFileWriteResult>
    fuzzySearchProjectFiles(
        params: OpenADEProjectFilesFuzzySearchRequest & {
            repo: OpenADEProject
            task?: OpenADETask
        }
    ): Promise<OpenADEProjectFilesFuzzySearchResult>
    searchProject(
        params: OpenADEProjectSearchRequest & {
            repo: OpenADEProject
            task?: OpenADETask
        }
    ): Promise<OpenADEProjectSearchResult>
    readProjectSdkCapabilities?(
        params: OpenADEProjectSdkCapabilitiesReadRequest & {
            repo: OpenADEProject
            task?: OpenADETask
        }
    ): Promise<OpenADESdkCapabilities>
    listProjectProcesses(
        params: OpenADEProjectProcessListRequest & {
            repo: OpenADEProject
            task?: OpenADETask
        }
    ): Promise<OpenADEProjectProcessListResult>
    readCronDefinitions?(
        params: OpenADECronDefinitionsReadRequest & {
            repo: OpenADEProject
            task?: OpenADETask
        }
    ): Promise<OpenADECronDefinitionsReadResult>
    startProjectProcess(
        params: OpenADEProjectProcessStartRequest & {
            repo: OpenADEProject
            task?: OpenADETask
        }
    ): Promise<OpenADEProjectProcessStartResult>
    reconnectProjectProcess(
        params: OpenADEProjectProcessReconnectRequest & {
            repo: OpenADEProject
            task?: OpenADETask
        }
    ): Promise<OpenADEProjectProcessReconnectResult>
    stopProjectProcess(
        params: OpenADEProjectProcessStopRequest & {
            repo: OpenADEProject
            task?: OpenADETask
        }
    ): Promise<OpenADEProjectProcessStopResult>
    readProjectGitInfo(params: OpenADEProjectGitInfoRequest & { repo: OpenADEProject }): Promise<OpenADEProjectGitInfoResult>
    readProjectGitBranches(params: OpenADEProjectGitBranchesReadRequest & { repo: OpenADEProject }): Promise<OpenADEProjectGitBranchesReadResult>
    readProjectGitSummary(params: OpenADEProjectGitSummaryReadRequest & { repo: OpenADEProject }): Promise<OpenADEProjectGitSummaryReadResult>
    startTaskTerminal(
        params: OpenADETaskTerminalStartRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskTerminalStartResult>
    reconnectTaskTerminal(
        params: OpenADETaskTerminalReconnectRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskTerminalReconnectResult>
    writeTaskTerminal(
        params: OpenADETaskTerminalWriteRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskTerminalMutationResult>
    resizeTaskTerminal(
        params: OpenADETaskTerminalResizeRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskTerminalMutationResult>
    stopTaskTerminal(
        params: OpenADETaskTerminalStopRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskTerminalMutationResult>
    readTaskImage(
        params: OpenADETaskImageReadRequest & {
            repo: OpenADEProject
            task: OpenADETask
            image: OpenADETaskImageReference
        }
    ): Promise<OpenADETaskImageReadResult>
    readTaskGitSummary(
        params: OpenADETaskGitSummaryRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskGitSummaryResult>
    readTaskGitScopes(
        params: OpenADETaskGitScopesReadRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskGitScopesReadResult>
    readTaskChanges(
        params: OpenADETaskChangesReadRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskChangesReadResult>
    readTaskDiff(
        params: OpenADETaskDiffReadRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskDiffReadResult>
    readTaskFilePair(
        params: OpenADETaskFilePairReadRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskFilePairReadResult>
    readTaskGitLog(
        params: OpenADETaskGitLogRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskGitLogResult>
    readTaskGitCommitFiles(
        params: OpenADETaskGitCommitFilesRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskGitCommitFilesResult>
    readTaskGitFileAtTreeish(
        params: OpenADETaskGitFileAtTreeishRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskGitFileAtTreeishResult>
    readTaskGitCommitFilePatch(
        params: OpenADETaskGitCommitFilePatchRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskGitCommitFilePatchResult>
    commitTaskGit(
        params: OpenADETaskGitCommitRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskGitCommitResult>
    readTaskSnapshotPatch(
        params: OpenADETaskSnapshotPatchReadRequest & {
            repo: OpenADEProject
            task: OpenADETask
            snapshotEvent: OpenADESnapshotEventRecord
        }
    ): Promise<OpenADETaskSnapshotPatchReadResult>
    readTaskSnapshotIndex(
        params: OpenADETaskSnapshotIndexReadRequest & {
            repo: OpenADEProject
            task: OpenADETask
            snapshotEvent: OpenADESnapshotEventRecord
        }
    ): Promise<OpenADETaskSnapshotIndexReadResult>
    readTaskSnapshotPatchSlice(
        params: OpenADETaskSnapshotPatchSliceReadRequest & {
            repo: OpenADEProject
            task: OpenADETask
            snapshotEvent: OpenADESnapshotEventRecord
        }
    ): Promise<OpenADETaskSnapshotPatchSliceReadResult>
    readTaskResourceInventory(
        params: OpenADETaskResourceInventoryReadRequest & {
            repo: OpenADEProject
            task: OpenADETask
            isRunning: boolean
        }
    ): Promise<OpenADETaskResourceInventoryReadResult>
    generateTaskTitle(
        params: OpenADETaskTitleGenerateRequest & {
            repo: OpenADEProject
            task: OpenADETask
        }
    ): Promise<OpenADETaskTitleGenerateResult>
    prepareTaskEnvironment(
        params: OpenADETaskEnvironmentPrepareRequest & {
            repo: OpenADEProject
            task: OpenADETask
            createdAt: string
        }
    ): Promise<OpenADETaskEnvironmentPrepareResult>
}

export interface OpenADETurnStartContext {
    runtimeId: string
    requestKey: string
}

export interface OpenADEModuleAdapters extends OpenADEReadAdapter, OpenADEWriteAdapter {
    version?: () => string | undefined
    createId?: () => string
    clientRequestRetentionMs?: number
    invalidateReadCache?: (invalidation?: OpenADEYjsProjectionCacheInvalidation) => void
    scopedHost?: OpenADEScopedHostAdapter
    readMcpServers?: () => Promise<OpenADEMCPServersReadResult>
    replaceMcpServers?: (params: OpenADEMCPServersReplaceRequest) => Promise<OpenADEMCPServersReplaceResult>
    upsertMcpServer?: (params: OpenADEMCPServerUpsertRequest) => Promise<OpenADEMCPServerUpsertResult>
    deleteMcpServer?: (params: OpenADEMCPServerDeleteRequest) => Promise<OpenADEMCPServerDeleteResult>
    readPersonalSettings?: () => Promise<OpenADEPersonalSettingsReadResult>
    replacePersonalSettings?: (params: OpenADEPersonalSettingsReplaceRequest) => Promise<OpenADEPersonalSettingsReplaceResult>
    readCronInstallState?: (params: OpenADECronInstallStateReadRequest) => Promise<OpenADECronInstallStateReadResult>
    replaceCronInstallState?: (params: OpenADECronInstallStateReplaceRequest) => Promise<OpenADECronInstallStateReplaceResult>
    listCronInstallStateRepos?: () => Promise<OpenADECronInstallStateListResult>
    runCron?: (params: OpenADECronRunRequest) => Promise<OpenADECronRunResult>
    importLegacyResources?: (params: OpenADELegacyResourcesImportRequest) => Promise<OpenADELegacyResourcesImportResult>
    backfillTaskUsage?: (params: OpenADETaskUsageBackfillRequest) => Promise<OpenADETaskUsageBackfillResult>
    recalculateTaskUsage?: (params: OpenADETaskUsageRecalculateRequest) => Promise<OpenADETaskUsageRecalculateResult>
}

interface ClientRequestEntry {
    promise: Promise<unknown>
    cleanupTimer: ReturnType<typeof setTimeout> | null
}

const NO_READ_CACHE_INVALIDATION: OpenADEYjsProjectionCacheInvalidation = { documentIds: [] }

function mutationRecord(params: unknown): Record<string, unknown> | null {
    return typeof params === "object" && params !== null && !Array.isArray(params) ? (params as Record<string, unknown>) : null
}

function optionalMutationString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key]
    return typeof value === "string" && value.length > 0 ? value : undefined
}

function uniqueDocumentInvalidation(documentIds: Array<string | undefined>): OpenADEYjsProjectionCacheInvalidation {
    return { documentIds: Array.from(new Set(documentIds.filter((documentId): documentId is string => documentId !== undefined))) }
}

function taskDocumentId(taskId: string | undefined): string | undefined {
    return taskId ? `code:task:${taskId}` : undefined
}

function taskMutationInvalidation(params: unknown, options: { includeRepos: boolean }): OpenADEYjsProjectionCacheInvalidation | undefined {
    const record = mutationRecord(params)
    if (!record) return undefined
    const taskId = optionalMutationString(record, "taskId") ?? optionalMutationString(record, "inTaskId")
    if (!taskId) return undefined
    return uniqueDocumentInvalidation([options.includeRepos ? "code:repos" : undefined, taskDocumentId(taskId)])
}

function metadataMutationKeys(record: Record<string, unknown>): Set<string> {
    return new Set(Object.keys(record).filter((key) => key !== "taskId" && key !== "updatedAt" && key !== "clientRequestId"))
}

function taskMetadataInvalidation(params: unknown): OpenADEYjsProjectionCacheInvalidation | undefined {
    const record = mutationRecord(params)
    if (!record) return undefined
    const keys = metadataMutationKeys(record)
    if (keys.size === 1 && (keys.has("lastViewedAt") || keys.has("usage"))) {
        return uniqueDocumentInvalidation(["code:repos"])
    }
    return taskMutationInvalidation(params, { includeRepos: true })
}

function documentMutationInvalidation(params: unknown): OpenADEYjsProjectionCacheInvalidation | undefined {
    const record = mutationRecord(params)
    if (!record) return undefined
    const documentId = optionalMutationString(record, "id")
    return documentId ? uniqueDocumentInvalidation([documentId]) : undefined
}

function mutationReadCacheInvalidation(scope: string, params: unknown): OpenADEYjsProjectionCacheInvalidation | undefined {
    switch (scope) {
        case "data/yjs/save":
        case "data/yjs/delete":
            return documentMutationInvalidation(params)
        case OPENADE_METHOD.settingsPersonalReplace:
            return uniqueDocumentInvalidation(["code:personal_settings"])
        case OPENADE_METHOD.settingsMcpServersReplace:
        case OPENADE_METHOD.settingsMcpServersUpsert:
        case OPENADE_METHOD.settingsMcpServersDelete:
            return uniqueDocumentInvalidation(["code:mcp_servers"])
        case OPENADE_METHOD.projectFileWrite:
        case OPENADE_METHOD.projectProcessStart:
        case OPENADE_METHOD.projectProcessStop:
        case OPENADE_METHOD.cronInstallStateReplace:
        case OPENADE_METHOD.cronRun:
        case OPENADE_METHOD.taskGitCommit:
        case OPENADE_METHOD.taskTerminalStart:
        case OPENADE_METHOD.taskTerminalWrite:
        case OPENADE_METHOD.taskTerminalResize:
        case OPENADE_METHOD.taskTerminalStop:
        case OPENADE_METHOD.taskImageWrite:
        case OPENADE_METHOD.importLegacyResources:
            return NO_READ_CACHE_INVALIDATION
        case OPENADE_METHOD.repoCreate:
        case OPENADE_METHOD.repoUpdate:
        case OPENADE_METHOD.repoDelete:
        case OPENADE_METHOD.taskCreate:
            return uniqueDocumentInvalidation(["code:repos"])
        case OPENADE_METHOD.taskDelete:
        case OPENADE_METHOD.turnInterrupt:
        case OPENADE_METHOD.queuedTurnCancel:
        case OPENADE_METHOD.queuedTurnEnqueue:
        case OPENADE_METHOD.queuedTurnImportLegacy:
        case OPENADE_METHOD.queuedTurnReorder:
        case OPENADE_METHOD.reviewStart:
        case OPENADE_METHOD.actionCreate:
        case OPENADE_METHOD.actionComplete:
        case OPENADE_METHOD.actionError:
        case OPENADE_METHOD.actionStopped:
        case OPENADE_METHOD.actionReconcileRuntime:
        case OPENADE_METHOD.hyperplanSubExecutionAdd:
        case OPENADE_METHOD.hyperplanReconcileLabelsSet:
        case OPENADE_METHOD.snapshotCreate:
        case OPENADE_METHOD.commentCreate:
        case OPENADE_METHOD.commentEdit:
        case OPENADE_METHOD.commentDelete:
        case OPENADE_METHOD.taskTitleGenerate:
        case OPENADE_METHOD.taskUsageRecalculate:
        case OPENADE_METHOD.taskEnvironmentSetup:
        case OPENADE_METHOD.taskEnvironmentPrepare:
            return taskMutationInvalidation(params, { includeRepos: true })
        case OPENADE_METHOD.actionStreamAppend:
        case OPENADE_METHOD.actionExecutionUpdate:
        case OPENADE_METHOD.hyperplanSubExecutionStreamAppend:
        case OPENADE_METHOD.hyperplanSubExecutionUpdate:
            return taskMutationInvalidation(params, { includeRepos: false })
        case OPENADE_METHOD.taskMetadataUpdate:
            return taskMetadataInvalidation(params)
        case OPENADE_METHOD.taskUsageBackfill:
            return uniqueDocumentInvalidation(["code:repos"])
        case OPENADE_METHOD.turnStart:
            return taskMutationInvalidation(params, { includeRepos: true })
        default:
            return undefined
    }
}

const DEFAULT_CLIENT_REQUEST_RETENTION_MS = 10 * 60 * 1000
const SCOPED_HOST_CONTEXT_CACHE_MS = 5_000

interface ScopedHostContextCache {
    projects: { value: OpenADEProject[]; expiresAt: number } | null
    projectsRequest: Promise<OpenADEProject[]> | null
    tasks: Map<string, { value: OpenADETask; expiresAt: number }>
    taskRequests: Map<string, Promise<OpenADETask>>
}

function scopedTaskCacheKey(repoId: string, taskId: string): string {
    return `${repoId}\0${taskId}`
}

function createScopedHostContextCache(): ScopedHostContextCache {
    return {
        projects: null,
        projectsRequest: null,
        tasks: new Map(),
        taskRequests: new Map(),
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function validationPath(message: string): string | undefined {
    const key = message.match(/^([A-Za-z0-9_.]+) /)?.[1]
    return key ? `$.${key}` : undefined
}

function validateWith(parse: (params: unknown) => unknown) {
    return (params: unknown): RuntimeValidationResult<unknown> => {
        try {
            parse(params)
            return { ok: true, value: params }
        } catch (error) {
            const message = error instanceof Error ? error.message : "OpenADE params are invalid"
            return {
                ok: false,
                error: {
                    code: "invalid_params",
                    message,
                    path: validationPath(message),
                },
            }
        }
    }
}

function createFallbackId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function stableClientRequestKey(params: unknown): string | undefined {
    const clientRequestId = asRecord(params).clientRequestId
    return typeof clientRequestId === "string" && clientRequestId.length > 0 ? clientRequestId : undefined
}

function stringParam(record: Record<string, unknown>, key: string): string {
    const value = record[key]
    if (typeof value !== "string" || value.length < 1) throw new Error(`${key} is invalid`)
    return value
}

function stringParamAllowEmpty(record: Record<string, unknown>, key: string): string {
    const value = record[key]
    if (typeof value !== "string") throw new Error(`${key} is invalid`)
    return value
}

function optionalStringParam(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key]
    return typeof value === "string" && value.length > 0 ? value : undefined
}

function booleanParam(record: Record<string, unknown>, key: string): boolean | undefined {
    const value = record[key]
    return typeof value === "boolean" ? value : undefined
}

function optionalPositiveIntegerParam(record: Record<string, unknown>, key: string, fallback?: number): number | undefined {
    const value = record[key]
    if (value === undefined) return fallback
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${key} is invalid`)
    return Math.floor(value)
}

function optionalStrictPositiveIntegerParam(record: Record<string, unknown>, key: string): number | undefined {
    const value = record[key]
    if (value === undefined) return undefined
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) throw new Error(`${key} is invalid`)
    return value
}

function positiveIntegerParam(record: Record<string, unknown>, key: string): number {
    const value = optionalPositiveIntegerParam(record, key)
    if (value === undefined) throw new Error(`${key} is invalid`)
    return value
}

function optionalNonNegativeIntegerParam(record: Record<string, unknown>, key: string, fallback?: number): number | undefined {
    const value = record[key]
    if (value === undefined) return fallback
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${key} is invalid`)
    return Math.floor(value)
}

function stringArrayParam(record: Record<string, unknown>, key: string): string[] | undefined {
    const value = record[key]
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined
}

function optionalStrictStringArrayParam(record: Record<string, unknown>, key: string): string[] | undefined {
    const value = record[key]
    if (value === undefined) return undefined
    if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
        throw new Error(`${key} is invalid`)
    }
    return value
}

function isoTimestampParam(record: Record<string, unknown>, key: string): string {
    const value = stringParam(record, key)
    if (!Number.isFinite(Date.parse(value))) throw new Error(`${key} is invalid`)
    return value
}

function optionalIsoTimestampParam(record: Record<string, unknown>, key: string): string | undefined {
    const value = optionalStringParam(record, key)
    if (value === undefined) return undefined
    if (!Number.isFinite(Date.parse(value))) throw new Error(`${key} is invalid`)
    return value
}

function scopedRelativePathParam(record: Record<string, unknown>, key: string): string {
    const value = stringParam(record, key).replace(/\\/g, "/")
    if (value.startsWith("/") || value.split("/").some((segment) => segment === "..")) throw new Error(`${key} is invalid`)
    return value
}

function optionalScopedRelativePathParam(record: Record<string, unknown>, key: string): string {
    const value = record[key]
    if (value === undefined || value === "") return ""
    if (typeof value !== "string") throw new Error(`${key} is invalid`)
    const normalized = value.replace(/\\/g, "/")
    if (normalized.startsWith("/") || normalized.split("/").some((segment) => segment === "..")) throw new Error(`${key} is invalid`)
    return normalized
}

function projectFilesTreeParams(params: unknown): OpenADEProjectFilesTreeRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: optionalStringParam(record, "taskId"),
        path: optionalScopedRelativePathParam(record, "path"),
        maxDepth: optionalPositiveIntegerParam(record, "maxDepth"),
        maxEntries: optionalPositiveIntegerParam(record, "maxEntries"),
        includeHidden: booleanParam(record, "includeHidden"),
        includeGenerated: booleanParam(record, "includeGenerated"),
    }
}

function projectFileReadParams(params: unknown): OpenADEProjectFileReadRequest {
    const record = asRecord(params)
    const encoding = record.encoding === "base64" ? "base64" : "utf8"
    return {
        repoId: stringParam(record, "repoId"),
        taskId: optionalStringParam(record, "taskId"),
        path: scopedRelativePathParam(record, "path"),
        encoding,
        maxBytes: optionalPositiveIntegerParam(record, "maxBytes"),
    }
}

function projectFileWriteParams(params: unknown): OpenADEProjectFileWriteRequest {
    const record = asRecord(params)
    const encoding = record.encoding === "base64" ? "base64" : "utf8"
    return {
        repoId: stringParam(record, "repoId"),
        taskId: optionalStringParam(record, "taskId"),
        path: scopedRelativePathParam(record, "path"),
        encoding,
        content: stringParamAllowEmpty(record, "content"),
        createDirs: booleanParam(record, "createDirs"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function projectFilesFuzzySearchParams(params: unknown): OpenADEProjectFilesFuzzySearchRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: optionalStringParam(record, "taskId"),
        query: stringParamAllowEmpty(record, "query"),
        matchDirs: booleanParam(record, "matchDirs"),
        limit: optionalPositiveIntegerParam(record, "limit", 100),
        includeHidden: booleanParam(record, "includeHidden"),
        includeGenerated: booleanParam(record, "includeGenerated"),
    }
}

function projectSearchParams(params: unknown): OpenADEProjectSearchRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: optionalStringParam(record, "taskId"),
        query: stringParam(record, "query"),
        limit: optionalPositiveIntegerParam(record, "limit", 100),
        caseSensitive: booleanParam(record, "caseSensitive"),
    }
}

function projectSdkCapabilitiesReadParams(params: unknown): OpenADEProjectSdkCapabilitiesReadRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: optionalStringParam(record, "taskId"),
        harnessId: optionalStringParam(record, "harnessId"),
    }
}

function projectGitInfoParams(params: unknown): OpenADEProjectGitInfoRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
    }
}

function projectGitBranchesReadParams(params: unknown): OpenADEProjectGitBranchesReadRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        includeRemote: booleanParam(record, "includeRemote"),
    }
}

function projectGitSummaryReadParams(params: unknown): OpenADEProjectGitSummaryReadRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
    }
}

function projectProcessListParams(params: unknown): OpenADEProjectProcessListRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: optionalStringParam(record, "taskId"),
    }
}

function cronDefinitionsReadParams(params: unknown): OpenADECronDefinitionsReadRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: optionalStringParam(record, "taskId"),
    }
}

function cronDefinitionsFromProcessList(result: OpenADEProjectProcessListResult): OpenADECronDefinitionsReadResult {
    return {
        repoId: result.repoId,
        taskId: result.taskId,
        repoRoot: result.repoRoot,
        searchRoot: result.searchRoot,
        isWorktree: result.isWorktree,
        worktreeRoot: result.worktreeRoot,
        configs: (result.configs ?? []).map((config) => ({
            relativePath: config.relativePath,
            crons: config.crons,
        })),
        errors: result.errors,
    }
}

function projectProcessStartParams(params: unknown): OpenADEProjectProcessStartRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: optionalStringParam(record, "taskId"),
        definitionId: stringParam(record, "definitionId"),
        timeoutMs: optionalPositiveIntegerParam(record, "timeoutMs"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function projectProcessReconnectParams(params: unknown): OpenADEProjectProcessReconnectRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: optionalStringParam(record, "taskId"),
        processId: stringParam(record, "processId"),
    }
}

function projectProcessStopParams(params: unknown): OpenADEProjectProcessStopRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: optionalStringParam(record, "taskId"),
        processId: stringParam(record, "processId"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function cronInstallStateReadParams(params: unknown): OpenADECronInstallStateReadRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
    }
}

function cronInstallStateParam(key: string, value: unknown): OpenADECronInstallState {
    const record = asRecord(value)
    const cronId = stringParam(record, "cronId")
    if (cronId !== key) throw new Error("installations keys must match cronId")
    return {
        cronId,
        enabled: record.enabled === true,
        installedAt: isoTimestampParam(record, "installedAt"),
        lastRunAt: optionalIsoTimestampParam(record, "lastRunAt"),
        lastTaskId: optionalStringParam(record, "lastTaskId"),
    }
}

function cronInstallStateInstallationsParam(value: unknown): Record<string, OpenADECronInstallState> {
    const record = asRecord(value)
    const result: Record<string, OpenADECronInstallState> = {}
    for (const [key, state] of Object.entries(record)) {
        result[key] = cronInstallStateParam(key, state)
    }
    return result
}

function cronInstallStateReplaceParams(params: unknown): OpenADECronInstallStateReplaceRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        installations: cronInstallStateInstallationsParam(record.installations),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function cronRunParams(params: unknown): OpenADECronRunRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        cronId: stringParam(record, "cronId"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function taskTerminalStartParams(params: unknown): OpenADETaskTerminalStartRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        cols: optionalPositiveIntegerParam(record, "cols"),
        rows: optionalPositiveIntegerParam(record, "rows"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function taskTerminalReconnectParams(params: unknown): OpenADETaskTerminalReconnectRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        terminalId: optionalStringParam(record, "terminalId"),
    }
}

function taskTerminalWriteParams(params: unknown): OpenADETaskTerminalWriteRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        terminalId: stringParam(record, "terminalId"),
        data: stringParamAllowEmpty(record, "data"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function taskTerminalResizeParams(params: unknown): OpenADETaskTerminalResizeRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        terminalId: stringParam(record, "terminalId"),
        cols: positiveIntegerParam(record, "cols"),
        rows: positiveIntegerParam(record, "rows"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function taskTerminalStopParams(params: unknown): OpenADETaskTerminalStopRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        terminalId: stringParam(record, "terminalId"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

type TaskImageWriteExt = OpenADETaskImageWriteRequest["ext"]
type TaskImageWriteMediaType = OpenADETaskImageWriteRequest["mediaType"]

const ALLOWED_TASK_IMAGE_EXTENSIONS = new Set(["gif", "jpeg", "jpg", "png", "webp"])

function taskImageIdParam(record: Record<string, unknown>, key: string): string {
    const value = stringParam(record, key)
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`${key} is invalid`)
    return value
}

function taskImageExtParam(record: Record<string, unknown>, key: string): string {
    const value = stringParam(record, key).toLowerCase()
    if (!ALLOWED_TASK_IMAGE_EXTENSIONS.has(value)) throw new Error(`${key} is invalid`)
    return value
}

function taskImageWriteExtParam(record: Record<string, unknown>, key: string): TaskImageWriteExt {
    const value = stringParam(record, key).toLowerCase()
    switch (value) {
        case "gif":
        case "jpeg":
        case "jpg":
        case "png":
        case "webp":
            return value
        default:
            throw new Error(`${key} is invalid`)
    }
}

function expectedImageMediaType(ext: TaskImageWriteExt): TaskImageWriteMediaType {
    switch (ext) {
        case "gif":
            return "image/gif"
        case "jpeg":
        case "jpg":
            return "image/jpeg"
        case "png":
            return "image/png"
        case "webp":
            return "image/webp"
    }
}

function taskImageWriteMediaTypeParam(record: Record<string, unknown>, key: string, ext: TaskImageWriteExt): TaskImageWriteMediaType {
    const value = stringParam(record, key)
    const expected = expectedImageMediaType(ext)
    if (value !== expected) throw new Error(`${key} is invalid`)
    return expected
}

function base64Param(record: Record<string, unknown>, key: string): string {
    const value = stringParam(record, key)
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
        throw new Error(`${key} is invalid`)
    }
    return value
}

function taskImageReadParams(params: unknown): OpenADETaskImageReadRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        imageId: taskImageIdParam(record, "imageId"),
        ext: taskImageExtParam(record, "ext"),
    }
}

function taskImageStagedReadParams(params: unknown): OpenADETaskImageStagedReadRequest {
    const record = asRecord(params)
    return {
        imageId: taskImageIdParam(record, "imageId"),
        ext: taskImageExtParam(record, "ext"),
    }
}

function taskImageWriteParams(params: unknown): OpenADETaskImageWriteRequest {
    const record = asRecord(params)
    const ext = taskImageWriteExtParam(record, "ext")
    return {
        imageId: taskImageIdParam(record, "imageId"),
        ext,
        mediaType: taskImageWriteMediaTypeParam(record, "mediaType", ext),
        data: base64Param(record, "data"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function taskChangesReadParams(params: unknown): OpenADETaskChangesReadRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        fromTreeish: optionalStringParam(record, "fromTreeish"),
    }
}

function taskGitSummaryParams(params: unknown): OpenADETaskGitSummaryRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
    }
}

function taskGitScopesReadParams(params: unknown): OpenADETaskGitScopesReadRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        includeRemote: booleanParam(record, "includeRemote"),
    }
}

function taskResourceInventoryReadParams(params: unknown): OpenADETaskResourceInventoryReadRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
    }
}

function taskUsageRecalculateParams(params: unknown): OpenADETaskUsageRecalculateRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function taskUsageBackfillParams(params: unknown): OpenADETaskUsageBackfillRequest {
    const record = asRecord(params)
    return {
        repoId: optionalStringParam(record, "repoId"),
        taskIds: optionalStrictStringArrayParam(record, "taskIds"),
        force: booleanParam(record, "force"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function taskTitleGenerateParams(params: unknown): OpenADETaskTitleGenerateRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        harnessId: optionalStringParam(record, "harnessId"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function taskDiffContextLinesParam(value: unknown): OpenADETaskDiffContextLines {
    if (value === undefined) return 3
    switch (value) {
        case 1:
            return 1
        case 3:
            return 3
        case 10:
            return 10
        case 25:
            return 25
        case 100:
            return 100
        default:
            throw new Error("contextLines is invalid")
    }
}

function taskDiffReadParams(params: unknown): OpenADETaskDiffReadRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        filePath: scopedRelativePathParam(record, "filePath"),
        oldPath: optionalScopedRelativePathParam(record, "oldPath") || undefined,
        fromTreeish: optionalStringParam(record, "fromTreeish"),
        contextLines: taskDiffContextLinesParam(record.contextLines),
        allowTruncation: booleanParam(record, "allowTruncation"),
    }
}

function taskFilePairReadParams(params: unknown): OpenADETaskFilePairReadRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        filePath: scopedRelativePathParam(record, "filePath"),
        oldPath: optionalScopedRelativePathParam(record, "oldPath") || undefined,
        fromTreeish: optionalStringParam(record, "fromTreeish"),
    }
}

function taskGitLogParams(params: unknown): OpenADETaskGitLogRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        scopeId: optionalTaskGitScopeIdParam(record, "scopeId"),
        ref: optionalStringParam(record, "ref"),
        limit: optionalPositiveIntegerParam(record, "limit"),
        skip: optionalNonNegativeIntegerParam(record, "skip", 0),
    }
}

function optionalTaskGitScopeIdParam(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key]
    if (value === undefined) return undefined
    if (typeof value !== "string") throw new Error(`${key} is invalid`)
    const trimmed = value.trim()
    if (!trimmed || trimmed.length > 256 || trimmed.includes("\0") || trimmed.includes("..") || trimmed.startsWith("-") || /\s/.test(trimmed)) {
        throw new Error(`${key} is invalid`)
    }
    if (!/^(branch|worktree):[A-Za-z0-9._/@-]+$/.test(trimmed)) throw new Error(`${key} is invalid`)
    return trimmed
}

function mcpHealthStatusParam(value: unknown): OpenADEMCPHealthStatus {
    switch (value) {
        case "unknown":
        case "healthy":
        case "unhealthy":
        case "needs_auth":
            return value
        default:
            throw new Error("healthStatus is invalid")
    }
}

function strictStringRecordParam(value: unknown, key: string): Record<string, string> | undefined {
    if (value === undefined) return undefined
    const record = asRecord(value)
    const result: Record<string, string> = {}
    for (const [nestedKey, nested] of Object.entries(record)) {
        if (typeof nested !== "string") throw new Error(`${key}.${nestedKey} is invalid`)
        result[nestedKey] = nested
    }
    return result
}

function mcpOAuthTokensParam(value: unknown): OpenADEMCPOAuthTokens | undefined {
    if (value === undefined) return undefined
    const record = asRecord(value)
    return {
        accessToken: stringParam(record, "accessToken"),
        tokenType: stringParam(record, "tokenType"),
        refreshToken: optionalStringParam(record, "refreshToken"),
        clientId: optionalStringParam(record, "clientId"),
        expiresAt: optionalStringParam(record, "expiresAt"),
    }
}

function mcpServerParams(value: unknown): OpenADEMCPServer {
    const record = asRecord(value)
    const base = {
        id: stringParam(record, "id"),
        name: stringParam(record, "name"),
        enabled: record.enabled === true,
        presetId: optionalStringParam(record, "presetId"),
        lastTested: optionalStringParam(record, "lastTested"),
        healthStatus: mcpHealthStatusParam(record.healthStatus),
        createdAt: stringParam(record, "createdAt"),
        updatedAt: stringParam(record, "updatedAt"),
    }

    if (record.transportType === "http") {
        return {
            ...base,
            transportType: "http",
            url: stringParam(record, "url"),
            headers: strictStringRecordParam(record.headers, "headers"),
            oauthTokens: mcpOAuthTokensParam(record.oauthTokens),
        }
    }

    if (record.transportType === "stdio") {
        return {
            ...base,
            transportType: "stdio",
            command: stringParam(record, "command"),
            args: stringArrayParam(record, "args"),
            envVars: strictStringRecordParam(record.envVars, "envVars"),
            cwd: optionalStringParam(record, "cwd"),
        }
    }

    throw new Error("transportType is invalid")
}

function mcpServersReplaceParams(params: unknown): OpenADEMCPServersReplaceRequest {
    const record = asRecord(params)
    const servers = record.servers
    if (!Array.isArray(servers)) throw new Error("servers is invalid")
    return {
        servers: servers.map(mcpServerParams),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function mcpServerUpsertParams(params: unknown): OpenADEMCPServerUpsertRequest {
    const record = asRecord(params)
    return {
        server: mcpServerParams(record.server),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function mcpServerDeleteParams(params: unknown): OpenADEMCPServerDeleteRequest {
    const record = asRecord(params)
    return {
        serverId: stringParam(record, "serverId"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

const MCP_SETTINGS_WRITE_METHODS = [
    OPENADE_METHOD.settingsMcpServersReplace,
    OPENADE_METHOD.settingsMcpServersUpsert,
    OPENADE_METHOD.settingsMcpServersDelete,
] as const

function runtimePermissionMatches(method: string, permission: string): boolean {
    if (permission === "*") return true
    if (permission === method) return true
    if (permission.endsWith("/*")) {
        return method.startsWith(permission.slice(0, -1))
    }
    return false
}

function canReadFullMcpServerSettings(context: RuntimeHandlerContext): boolean {
    const permissions = context.connection.permissions
    if (!permissions || permissions.length === 0) return true
    return MCP_SETTINGS_WRITE_METHODS.some((method) => permissions.some((permission) => runtimePermissionMatches(method, permission)))
}

function sanitizeMcpServerForReadOnly(server: OpenADEMCPServer): OpenADEMCPServer {
    const shared = {
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        ...(server.presetId !== undefined ? { presetId: server.presetId } : {}),
        ...(server.lastTested !== undefined ? { lastTested: server.lastTested } : {}),
        healthStatus: server.healthStatus,
        createdAt: server.createdAt,
        updatedAt: server.updatedAt,
    }
    if (server.transportType === "http") {
        return {
            ...shared,
            transportType: "http",
            url: "",
        }
    }
    return {
        ...shared,
        transportType: "stdio",
        command: "",
    }
}

function sanitizeMcpServersReadResult(result: OpenADEMCPServersReadResult): OpenADEMCPServersReadResult {
    return {
        servers: result.servers.map(sanitizeMcpServerForReadOnly),
    }
}

function personalSettingsThemeParam(value: unknown): OpenADEPersonalSettingsThemeSetting {
    switch (value) {
        case undefined:
        case "system":
            return "system"
        case "code-theme-light":
        case "code-theme-bright":
        case "code-theme-clean":
        case "code-theme-black":
        case "code-theme-synthwave":
        case "code-theme-dracula":
            return value
        default:
            throw new Error("theme is invalid")
    }
}

function personalSettingsTabParam(record: Record<string, unknown>, key: string): OpenADEPersonalSettingsTab | undefined {
    const value = record[key]
    switch (value) {
        case undefined:
            return undefined
        case "appearance":
        case "connectors":
        case "companion":
        case "system":
        case "stats":
        case "dev":
            return value
        default:
            throw new Error(`${key} is invalid`)
    }
}

function personalSettingsAgentCoupletParam(value: unknown, key: string): OpenADEAgentCouplet {
    try {
        const record = asRecord(value)
        return {
            harnessId: stringParam(record, "harnessId"),
            modelId: stringParam(record, "modelId"),
        }
    } catch {
        throw new Error(`${key} is invalid`)
    }
}

function personalSettingsAgentCoupletsParam(value: unknown, key: string): OpenADEAgentCouplet[] | undefined {
    if (value === undefined) return undefined
    if (!Array.isArray(value)) throw new Error(`${key} is invalid`)
    return value.map((item, index) => personalSettingsAgentCoupletParam(item, `${key}.${index}`))
}

function optionalPersonalSettingsAgentCoupletParam(value: unknown, key: string): OpenADEAgentCouplet | undefined {
    if (value === undefined) return undefined
    return personalSettingsAgentCoupletParam(value, key)
}

function personalSettingsParam(value: unknown): OpenADEPersonalSettings {
    const record = asRecord(value)
    return {
        envVars: strictStringRecordParam(record.envVars, "envVars") ?? {},
        theme: personalSettingsThemeParam(record.theme),
        lastSettingsTab: personalSettingsTabParam(record, "lastSettingsTab"),
        deviceId: optionalStringParam(record, "deviceId"),
        telemetryDisabled: booleanParam(record, "telemetryDisabled"),
        onboardingCompleted: booleanParam(record, "onboardingCompleted"),
        devHideTray: booleanParam(record, "devHideTray"),
        devForceAllCommands: booleanParam(record, "devForceAllCommands"),
        shortcutHintsHidden: booleanParam(record, "shortcutHintsHidden"),
        renderMarkdownMessages: booleanParam(record, "renderMarkdownMessages") ?? true,
        lastSeenReleaseVersion: optionalStringParam(record, "lastSeenReleaseVersion"),
        newTaskHarnessId: optionalStringParam(record, "newTaskHarnessId"),
        newTaskModelId: optionalStringParam(record, "newTaskModelId"),
        pinnedTaskIds: stringArrayParam(record, "pinnedTaskIds"),
        hyperplanStrategyId: optionalStringParam(record, "hyperplanStrategyId"),
        hyperplanAgents: personalSettingsAgentCoupletsParam(record.hyperplanAgents, "hyperplanAgents"),
        hyperplanReconciler: optionalPersonalSettingsAgentCoupletParam(record.hyperplanReconciler, "hyperplanReconciler"),
    }
}

function personalSettingsReplaceParams(params: unknown): OpenADEPersonalSettingsReplaceRequest {
    const record = asRecord(params)
    return {
        settings: personalSettingsParam(record.settings),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function taskGitTreeishParam(record: Record<string, unknown>, key: string): string {
    const value = stringParam(record, key).trim()
    if (!value || value.length > 512 || value.includes("\0") || value.includes(":") || value.includes("..") || value.startsWith("-") || /\s/.test(value)) {
        throw new Error(`${key} is invalid`)
    }
    return value
}

function taskGitCommitFilesParams(params: unknown): OpenADETaskGitCommitFilesRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        commit: taskGitTreeishParam(record, "commit"),
    }
}

function taskGitFileAtTreeishParams(params: unknown): OpenADETaskGitFileAtTreeishRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        treeish: taskGitTreeishParam(record, "treeish"),
        filePath: scopedRelativePathParam(record, "filePath"),
    }
}

function taskGitCommitFilePatchParams(params: unknown): OpenADETaskGitCommitFilePatchRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        commit: taskGitTreeishParam(record, "commit"),
        filePath: scopedRelativePathParam(record, "filePath"),
        oldPath: optionalScopedRelativePathParam(record, "oldPath") || undefined,
        contextLines: taskDiffContextLinesParam(record.contextLines),
        allowTruncation: booleanParam(record, "allowTruncation"),
    }
}

function gitCommitMessageParam(record: Record<string, unknown>): string {
    const message = stringParam(record, "message").trim()
    if (!message || message.length > 10_000 || message.includes("\0")) throw new Error("message is invalid")
    return message
}

function taskGitCommitParams(params: unknown): OpenADETaskGitCommitRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        message: gitCommitMessageParam(record),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function taskSnapshotPatchReadParams(params: unknown): OpenADETaskSnapshotPatchReadRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        eventId: stringParam(record, "eventId"),
    }
}

function taskSnapshotIndexReadParams(params: unknown): OpenADETaskSnapshotIndexReadRequest {
    return taskSnapshotPatchReadParams(params)
}

function taskSnapshotPatchSliceReadParams(params: unknown): OpenADETaskSnapshotPatchSliceReadRequest {
    const record = asRecord(params)
    const start = optionalNonNegativeIntegerParam(record, "start")
    const end = optionalNonNegativeIntegerParam(record, "end")
    if (start === undefined || end === undefined || end < start) throw new Error("end is invalid")
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        eventId: stringParam(record, "eventId"),
        start,
        end,
    }
}

function hyperplanStrategyParam(value: unknown): OpenADEHyperPlanStrategy | undefined {
    if (value === undefined) return undefined
    const record = asRecord(value)
    const stepsValue = record.steps
    if (!Array.isArray(stepsValue)) throw new Error("hyperplanStrategy.steps is invalid")
    const steps = stepsValue.map((item) => {
        const step = asRecord(item)
        const primitive = step.primitive as OpenADEHyperPlanStepPrimitive
        if (primitive !== "plan" && primitive !== "review" && primitive !== "reconcile" && primitive !== "revise") {
            throw new Error("hyperplanStrategy.steps.primitive is invalid")
        }
        const agent = asRecord(step.agent)
        return {
            id: stringParam(step, "id"),
            primitive,
            agent: {
                harnessId: stringParam(agent, "harnessId"),
                modelId: stringParam(agent, "modelId"),
            },
            inputs: stringArrayParam(step, "inputs") ?? [],
            resumeStepId: optionalStringParam(step, "resumeStepId"),
        }
    })

    return {
        id: stringParam(record, "id"),
        name: stringParam(record, "name"),
        description: stringParam(record, "description"),
        steps,
        terminalStepId: stringParam(record, "terminalStepId"),
    }
}

function gitRefsParam(value: unknown): OpenADEActionEventCreateRequest["gitRefsBefore"] {
    if (value === undefined) return undefined
    const record = asRecord(value)
    if (typeof record.sha !== "string" || record.sha.length < 1) throw new Error("gitRefsBefore.sha is invalid")
    return {
        sha: record.sha,
        branch: typeof record.branch === "string" ? record.branch : undefined,
    }
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
    ;(timer as { unref?: () => void }).unref?.()
}

function activeOpenADETaskIds(server: RuntimeServer): string[] {
    return server.supervisor
        .list({ ownerType: "openade-task" })
        .filter((runtime) => runtime.scope.ownerId && (runtime.status === "starting" || runtime.status === "running"))
        .map((runtime) => runtime.scope.ownerId as string)
}

function eventRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function taskImageReference(value: unknown): OpenADETaskImageReference | null {
    const record = eventRecord(value)
    if (!record) return null
    if (typeof record.id !== "string" || typeof record.ext !== "string") return null
    if (!/^[a-zA-Z0-9_-]+$/.test(record.id)) return null
    const ext = record.ext.toLowerCase()
    if (!ALLOWED_TASK_IMAGE_EXTENSIONS.has(ext)) return null
    const mediaType = typeof record.mediaType === "string" && record.mediaType.startsWith("image/") ? record.mediaType : undefined
    return { id: record.id, ext, mediaType }
}

function taskImageReferences(value: unknown): OpenADETaskImageReference[] {
    if (!Array.isArray(value)) return []
    return value.map(taskImageReference).filter((image): image is OpenADETaskImageReference => image !== null)
}

function taskImageReferenceForTask(task: OpenADETask, imageId: string, ext: string): OpenADETaskImageReference | null {
    for (const event of task.events) {
        const record = eventRecord(event)
        if (!record || record.type !== "action") continue
        for (const image of taskImageReferences(record.images)) {
            if (image.id === imageId && image.ext === ext) return image
        }
    }

    for (const turn of task.queuedTurns ?? []) {
        for (const image of taskImageReferences(turn.images)) {
            if (image.id === imageId && image.ext === ext) return image
        }
    }

    return null
}

function snapshotEventForTask(task: OpenADETask, eventId: string): OpenADESnapshotEventRecord {
    for (const event of task.events) {
        const record = eventRecord(event)
        if (record?.type === "snapshot" && record.id === eventId) return record as OpenADESnapshotEventRecord
    }
    throw new Error(`Snapshot event ${eventId} not found`)
}

function repoUserParam(value: unknown): OpenADERepoCreateRequest["createdBy"] {
    const record = asRecord(value)
    return {
        id: stringParam(record, "id"),
        email: stringParam(record, "email"),
    }
}

function repoCreateParams(params: unknown): OpenADERepoCreateRequest {
    const record = asRecord(params)
    return {
        repoId: optionalStringParam(record, "repoId"),
        name: stringParam(record, "name"),
        path: stringParam(record, "path"),
        createdBy: repoUserParam(record.createdBy),
        createdAt: optionalStringParam(record, "createdAt"),
        createDirectory: booleanParam(record, "createDirectory"),
        initializeGit: booleanParam(record, "initializeGit"),
    }
}

function repoPathInspectParams(params: unknown): OpenADERepoPathInspectRequest {
    const record = asRecord(params)
    return {
        path: stringParam(record, "path"),
    }
}

function repoUpdateParams(params: unknown): OpenADERepoUpdateRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        name: optionalStringParam(record, "name"),
        path: optionalStringParam(record, "path"),
        archived: booleanParam(record, "archived"),
        updatedAt: optionalStringParam(record, "updatedAt"),
        initializeGit: booleanParam(record, "initializeGit"),
    }
}

function repoDeleteParams(params: unknown): OpenADERepoDeleteRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
    }
}

function taskCreateParams(params: unknown): OpenADETaskCreateRequest {
    const record = asRecord(params)
    const input = stringParamAllowEmpty(record, "input")
    if (input.length > 200_000) throw new Error("input is too long")
    return {
        repoId: stringParam(record, "repoId"),
        input,
        createdBy: userParam(record.createdBy),
        deviceId: stringParam(record, "deviceId"),
        title: optionalStringParam(record, "title"),
        taskId: optionalStringParam(record, "taskId"),
        slug: optionalStringParam(record, "slug"),
        createdAt: optionalStringParam(record, "createdAt"),
        isolationStrategy: record.isolationStrategy === undefined ? undefined : (record.isolationStrategy as OpenADETaskCreateRequest["isolationStrategy"]),
        enabledMcpServerIds: stringArrayParam(record, "enabledMcpServerIds"),
        deviceEnvironment: record.deviceEnvironment === undefined ? undefined : taskDeviceEnvironmentParam(record.deviceEnvironment),
        setupEvent: record.setupEvent === undefined ? undefined : setupEnvironmentEventParam(record.setupEvent),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function taskDeleteParams(params: unknown): OpenADETaskDeleteRequest {
    const record = asRecord(params)
    const options = asRecord(record.options)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        options:
            record.options === undefined
                ? undefined
                : {
                      deleteSnapshots: booleanParam(options, "deleteSnapshots"),
                      deleteImages: booleanParam(options, "deleteImages"),
                      deleteSessions: booleanParam(options, "deleteSessions"),
                      deleteWorktrees: booleanParam(options, "deleteWorktrees"),
                  },
    }
}

function turnParams(params: unknown): OpenADETurnStartRequest {
    const record = asRecord(params)
    const repoId = record.repoId
    const input = record.input
    if (typeof repoId !== "string" || repoId.length < 1) throw new Error("repoId is invalid")
    if (typeof input !== "string" || input.length > 200_000) throw new Error("input is invalid")
    const isExistingTurn = typeof record.inTaskId === "string" && record.inTaskId.length > 0
    if (!isExistingTurn && input.trim().length < 1) throw new Error("input is invalid")
    if (isExistingTurn && record.isolationStrategy !== undefined) throw new Error("isolationStrategy is only valid when creating a task")
    if (isExistingTurn && record.title !== undefined) throw new Error("title is only valid when creating a task")
    if (
        record.type !== "plan" &&
        record.type !== "do" &&
        record.type !== "ask" &&
        record.type !== "revise" &&
        record.type !== "run_plan" &&
        record.type !== "hyperplan"
    ) {
        throw new Error("type is invalid")
    }

    const request: OpenADETurnStartRequest = {
        repoId,
        type: record.type,
        input,
    }
    if (typeof record.clientRequestId === "string") request.clientRequestId = record.clientRequestId
    if (typeof record.appendSystemPrompt === "string") request.appendSystemPrompt = record.appendSystemPrompt
    if (record.inTaskId === null) request.inTaskId = null
    else if (typeof record.inTaskId === "string") request.inTaskId = record.inTaskId
    if (record.isolationStrategy !== undefined) {
        request.isolationStrategy = record.isolationStrategy as OpenADETurnStartRequest["isolationStrategy"]
    }
    if (Array.isArray(record.enabledMcpServerIds)) {
        request.enabledMcpServerIds = record.enabledMcpServerIds.filter((id): id is string => typeof id === "string")
    }
    if (typeof record.harnessId === "string") request.harnessId = record.harnessId
    if (typeof record.modelId === "string") request.modelId = record.modelId
    if (typeof record.label === "string") request.label = record.label
    if (typeof record.includeComments === "boolean") request.includeComments = record.includeComments
    if (Array.isArray(record.images)) request.images = record.images
    if (record.thinking === "low" || record.thinking === "med" || record.thinking === "high" || record.thinking === "max") {
        request.thinking = record.thinking
    }
    if (typeof record.fastMode === "boolean") request.fastMode = record.fastMode
    if (typeof record.title === "string") request.title = record.title
    const hyperplanStrategy = hyperplanStrategyParam(record.hyperplanStrategy)
    if (hyperplanStrategy) request.hyperplanStrategy = hyperplanStrategy
    return request
}

function reviewStartParams(params: unknown): OpenADEReviewStartRequest {
    const record = asRecord(params)
    const repoId = record.repoId
    const taskId = record.taskId
    const harnessId = record.harnessId
    const modelId = record.modelId
    if (typeof repoId !== "string" || repoId.length < 1) throw new Error("repoId is invalid")
    if (typeof taskId !== "string" || taskId.length < 1) throw new Error("taskId is invalid")
    if (record.reviewType !== "plan" && record.reviewType !== "work") throw new Error("reviewType is invalid")
    if (typeof harnessId !== "string" || harnessId.length < 1) throw new Error("harnessId is invalid")
    if (typeof modelId !== "string" || modelId.length < 1) throw new Error("modelId is invalid")
    return {
        repoId,
        taskId,
        reviewType: record.reviewType,
        harnessId,
        modelId,
        thinking:
            record.thinking === "low" || record.thinking === "med" || record.thinking === "high" || record.thinking === "max" ? record.thinking : undefined,
        fastMode: typeof record.fastMode === "boolean" ? record.fastMode : undefined,
        customInstructions: typeof record.customInstructions === "string" ? record.customInstructions : undefined,
        clientRequestId: typeof record.clientRequestId === "string" ? record.clientRequestId : undefined,
    }
}

function actionSourceParam(value: unknown): OpenADEActionEventCreateRequest["source"] {
    const source = asRecord(value)
    if (
        source.type !== "plan" &&
        source.type !== "revise" &&
        source.type !== "run_plan" &&
        source.type !== "do" &&
        source.type !== "ask" &&
        source.type !== "hyperplan" &&
        source.type !== "review"
    ) {
        throw new Error("source.type is invalid")
    }
    if (typeof source.userLabel !== "string" || source.userLabel.length < 1) throw new Error("source.userLabel is invalid")
    return source as OpenADEActionEventCreateRequest["source"]
}

function createActionEventParams(params: unknown): OpenADEActionEventCreateRequest {
    const record = asRecord(params)
    const userInput = stringParam(record, "userInput")
    if (userInput.length > 200_000) throw new Error("userInput is too long")
    return {
        taskId: stringParam(record, "taskId"),
        userInput,
        executionId: stringParam(record, "executionId"),
        harnessId: stringParam(record, "harnessId"),
        source: actionSourceParam(record.source),
        eventId: optionalStringParam(record, "eventId"),
        createdAt: optionalStringParam(record, "createdAt"),
        images: Array.isArray(record.images) ? record.images : undefined,
        includesCommentIds: stringArrayParam(record, "includesCommentIds"),
        modelId: optionalStringParam(record, "modelId"),
        fastMode: booleanParam(record, "fastMode"),
        gitRefsBefore: gitRefsParam(record.gitRefsBefore),
    }
}

function appendActionStreamEventParams(params: unknown): OpenADEActionStreamAppendRequest {
    const record = asRecord(params)
    const streamEvent = asRecord(record.streamEvent)
    const streamEventId = streamEvent.id
    if (typeof streamEventId !== "string" || streamEventId.length < 1) throw new Error("streamEvent.id is invalid")
    return {
        taskId: stringParam(record, "taskId"),
        eventId: stringParam(record, "eventId"),
        streamEvent: streamEvent as Record<string, unknown> & { id: string },
    }
}

function completeActionEventParams(params: unknown): OpenADEActionEventCompleteRequest {
    const record = asRecord(params)
    const success = record.success
    if (typeof success !== "boolean") throw new Error("success is invalid")
    return {
        taskId: stringParam(record, "taskId"),
        eventId: stringParam(record, "eventId"),
        success,
        completedAt: optionalStringParam(record, "completedAt"),
    }
}

function errorActionEventParams(params: unknown): OpenADEActionEventErrorRequest {
    const record = asRecord(params)
    return {
        taskId: stringParam(record, "taskId"),
        eventId: stringParam(record, "eventId"),
        completedAt: optionalStringParam(record, "completedAt"),
    }
}

function stoppedActionEventParams(params: unknown): OpenADEActionEventStoppedRequest {
    const record = asRecord(params)
    return {
        taskId: stringParam(record, "taskId"),
        eventId: stringParam(record, "eventId"),
        completedAt: optionalStringParam(record, "completedAt"),
        sessionId: optionalStringParam(record, "sessionId"),
        parentSessionId: optionalStringParam(record, "parentSessionId"),
    }
}

function reconcileActionEventRuntimeParams(params: unknown): OpenADEActionEventRuntimeReconcileRequest {
    const record = asRecord(params)
    const status = record.status
    if (status !== "completed" && status !== "failed" && status !== "stopped") throw new Error("status is invalid")
    const eventId = optionalStringParam(record, "eventId")
    const executionId = optionalStringParam(record, "executionId")
    if (!eventId && !executionId) throw new Error("eventId is invalid")
    return {
        taskId: stringParam(record, "taskId"),
        eventId,
        executionId,
        status,
        success: booleanParam(record, "success"),
        completedAt: optionalStringParam(record, "completedAt"),
    }
}

function actionExecutionUpdateParams(params: unknown): OpenADEActionExecutionUpdateRequest {
    const record = asRecord(params)
    return {
        taskId: stringParam(record, "taskId"),
        eventId: stringParam(record, "eventId"),
        sessionId: optionalStringParam(record, "sessionId"),
        parentSessionId: optionalStringParam(record, "parentSessionId"),
        gitRefsAfter: gitRefsParam(record.gitRefsAfter),
    }
}

function streamEventParam(value: unknown): Record<string, unknown> & { id: string } {
    const streamEvent = asRecord(value)
    const streamEventId = streamEvent.id
    if (typeof streamEventId !== "string" || streamEventId.length < 1) throw new Error("streamEvent.id is invalid")
    return streamEvent as Record<string, unknown> & { id: string }
}

function hyperplanSubExecutionParam(value: unknown): OpenADEHyperPlanSubExecutionAddRequest["subExecution"] {
    const record = asRecord(value)
    const primitive = record.primitive
    const status = record.status
    if (primitive !== "plan" && primitive !== "review" && primitive !== "reconcile" && primitive !== "revise") {
        throw new Error("subExecution.primitive is invalid")
    }
    if (status !== "in_progress" && status !== "completed" && status !== "error" && status !== "stopped") {
        throw new Error("subExecution.status is invalid")
    }
    return {
        stepId: stringParam(record, "stepId"),
        primitive,
        harnessId: stringParam(record, "harnessId"),
        modelId: stringParam(record, "modelId"),
        executionId: typeof record.executionId === "string" ? record.executionId : "",
        sessionId: optionalStringParam(record, "sessionId"),
        parentSessionId: optionalStringParam(record, "parentSessionId"),
        status,
        events: Array.isArray(record.events) ? record.events.map(streamEventParam) : [],
        resultText: optionalStringParam(record, "resultText"),
        error: optionalStringParam(record, "error"),
        reconcileLabel: optionalStringParam(record, "reconcileLabel"),
    }
}

function hyperplanSubExecutionAddParams(params: unknown): OpenADEHyperPlanSubExecutionAddRequest {
    const record = asRecord(params)
    return {
        taskId: stringParam(record, "taskId"),
        eventId: stringParam(record, "eventId"),
        subExecution: hyperplanSubExecutionParam(record.subExecution),
    }
}

function hyperplanSubExecutionStreamAppendParams(params: unknown): OpenADEHyperPlanSubExecutionStreamAppendRequest {
    const record = asRecord(params)
    return {
        taskId: stringParam(record, "taskId"),
        eventId: stringParam(record, "eventId"),
        stepId: stringParam(record, "stepId"),
        streamEvent: streamEventParam(record.streamEvent),
    }
}

function hyperplanSubExecutionUpdateParams(params: unknown): OpenADEHyperPlanSubExecutionUpdateRequest {
    const record = asRecord(params)
    const status = record.status
    if (status !== undefined && status !== "in_progress" && status !== "completed" && status !== "error" && status !== "stopped") {
        throw new Error("status is invalid")
    }
    return {
        taskId: stringParam(record, "taskId"),
        eventId: stringParam(record, "eventId"),
        stepId: stringParam(record, "stepId"),
        executionId: optionalStringParam(record, "executionId"),
        sessionId: optionalStringParam(record, "sessionId"),
        parentSessionId: optionalStringParam(record, "parentSessionId"),
        status,
        resultText: optionalStringParam(record, "resultText"),
        error: optionalStringParam(record, "error"),
        reconcileLabel: optionalStringParam(record, "reconcileLabel"),
    }
}

function hyperplanReconcileLabelsSetParams(params: unknown): OpenADEHyperPlanReconcileLabelsSetRequest {
    const record = asRecord(params)
    const mapping = Array.isArray(record.mapping)
        ? record.mapping.map((item) => {
              const row = asRecord(item)
              return {
                  stepId: stringParam(row, "stepId"),
                  label: stringParam(row, "label"),
              }
          })
        : []
    return {
        taskId: stringParam(record, "taskId"),
        eventId: stringParam(record, "eventId"),
        mapping,
    }
}

function numberParam(record: Record<string, unknown>, key: string): number {
    const value = record[key]
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} is invalid`)
    return value
}

function snapshotStatsParam(value: unknown): OpenADESnapshotEventCreateRequest["stats"] {
    const record = asRecord(value)
    return {
        filesChanged: numberParam(record, "filesChanged"),
        insertions: numberParam(record, "insertions"),
        deletions: numberParam(record, "deletions"),
    }
}

function snapshotFilesParam(value: unknown): OpenADESnapshotEventCreateRequest["files"] {
    if (!Array.isArray(value)) return undefined
    return value.map((item) => {
        const record = asRecord(item)
        const status = record.status
        if (status !== "added" && status !== "deleted" && status !== "modified" && status !== "renamed") throw new Error("snapshot file status is invalid")
        return {
            path: stringParam(record, "path"),
            status,
            oldPath: optionalStringParam(record, "oldPath"),
        }
    })
}

function snapshotEventCreateParams(params: unknown): OpenADESnapshotEventCreateRequest {
    const record = asRecord(params)
    return {
        taskId: stringParam(record, "taskId"),
        actionEventId: stringParam(record, "actionEventId"),
        referenceBranch: stringParam(record, "referenceBranch"),
        mergeBaseCommit: stringParam(record, "mergeBaseCommit"),
        fullPatch: typeof record.fullPatch === "string" ? record.fullPatch : "",
        patchFileId: optionalStringParam(record, "patchFileId"),
        stats: snapshotStatsParam(record.stats),
        files: snapshotFilesParam(record.files),
        eventId: optionalStringParam(record, "eventId"),
        createdAt: optionalStringParam(record, "createdAt"),
    }
}

function userParam(value: unknown): OpenADECommentCreateRequest["author"] {
    const record = asRecord(value)
    return {
        id: stringParam(record, "id"),
        email: stringParam(record, "email"),
    }
}

function selectedTextParam(value: unknown): OpenADECommentCreateRequest["selectedText"] {
    const record = asRecord(value)
    return {
        text: typeof record.text === "string" ? record.text : "",
        linesBefore: typeof record.linesBefore === "string" ? record.linesBefore : "",
        linesAfter: typeof record.linesAfter === "string" ? record.linesAfter : "",
    }
}

function commentCreateParams(params: unknown): OpenADECommentCreateRequest {
    const record = asRecord(params)
    const content = stringParam(record, "content")
    if (content.length > 200_000) throw new Error("content is too long")
    return {
        taskId: stringParam(record, "taskId"),
        content,
        source: asRecord(record.source),
        selectedText: selectedTextParam(record.selectedText),
        author: userParam(record.author),
        commentId: optionalStringParam(record, "commentId"),
        createdAt: optionalStringParam(record, "createdAt"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function commentEditParams(params: unknown): OpenADECommentEditRequest {
    const record = asRecord(params)
    const content = stringParam(record, "content")
    if (content.length > 200_000) throw new Error("content is too long")
    return {
        taskId: stringParam(record, "taskId"),
        commentId: stringParam(record, "commentId"),
        content,
        updatedAt: optionalStringParam(record, "updatedAt"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function commentDeleteParams(params: unknown): OpenADECommentDeleteRequest {
    const record = asRecord(params)
    return {
        taskId: stringParam(record, "taskId"),
        commentId: stringParam(record, "commentId"),
        updatedAt: optionalStringParam(record, "updatedAt"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function stringRecordParam(value: unknown): Record<string, string> | undefined {
    if (value === undefined) return undefined
    const record = asRecord(value)
    const result: Record<string, string> = {}
    for (const [key, nested] of Object.entries(record)) {
        if (typeof nested === "string") result[key] = nested
    }
    return result
}

function taskMetadataUpdateParams(params: unknown): OpenADETaskMetadataUpdateRequest {
    const record = asRecord(params)
    return {
        repoId: optionalStringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        title: optionalStringParam(record, "title"),
        closed: booleanParam(record, "closed"),
        lastViewedAt: optionalStringParam(record, "lastViewedAt"),
        lastEventAt: optionalStringParam(record, "lastEventAt"),
        cancelledPlanEventId: optionalStringParam(record, "cancelledPlanEventId"),
        usage:
            typeof record.usage === "object" && record.usage !== null && !Array.isArray(record.usage)
                ? (record.usage as OpenADETaskMetadataUpdateRequest["usage"])
                : undefined,
        enabledMcpServerIds: stringArrayParam(record, "enabledMcpServerIds"),
        sessionIds: stringRecordParam(record.sessionIds),
        updatedAt: optionalStringParam(record, "updatedAt"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function taskDeviceEnvironmentParam(value: unknown): OpenADETaskEnvironmentSetupRequest["deviceEnvironment"] {
    const record = asRecord(value)
    const setupComplete = record.setupComplete
    if (typeof setupComplete !== "boolean") throw new Error("deviceEnvironment.setupComplete is invalid")
    return {
        id: stringParam(record, "id"),
        deviceId: stringParam(record, "deviceId"),
        worktreeDir: optionalStringParam(record, "worktreeDir"),
        setupComplete,
        mergeBaseCommit: optionalStringParam(record, "mergeBaseCommit"),
        createdAt: stringParam(record, "createdAt"),
        lastUsedAt: stringParam(record, "lastUsedAt"),
    }
}

function setupEnvironmentEventParam(value: unknown): OpenADETaskEnvironmentSetupRequest["setupEvent"] {
    if (value === undefined) return undefined
    const record = asRecord(value)
    return {
        taskId: optionalStringParam(record, "taskId"),
        eventId: optionalStringParam(record, "eventId"),
        worktreeId: stringParam(record, "worktreeId"),
        deviceId: stringParam(record, "deviceId"),
        workingDir: stringParam(record, "workingDir"),
        setupOutput: optionalStringParam(record, "setupOutput"),
        createdAt: optionalStringParam(record, "createdAt"),
        completedAt: optionalStringParam(record, "completedAt"),
    }
}

function taskEnvironmentSetupParams(params: unknown): OpenADETaskEnvironmentSetupRequest {
    const record = asRecord(params)
    return {
        taskId: stringParam(record, "taskId"),
        deviceEnvironment: taskDeviceEnvironmentParam(record.deviceEnvironment),
        setupEvent: setupEnvironmentEventParam(record.setupEvent),
    }
}

function taskEnvironmentPrepareParams(params: unknown): OpenADETaskEnvironmentPrepareRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function legacyResourcesImportParams(params: unknown): OpenADELegacyResourcesImportRequest {
    const record = asRecord(params)
    const request: OpenADELegacyResourcesImportRequest = {
        dataDir: optionalStringParam(record, "dataDir"),
        imageDir: optionalStringParam(record, "imageDir"),
        snapshotDir: optionalStringParam(record, "snapshotDir"),
        importSessions: booleanParam(record, "importSessions"),
        claudeConfigDir: optionalStringParam(record, "claudeConfigDir"),
        codexHome: optionalStringParam(record, "codexHome"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
    if (
        request.dataDir === undefined &&
        request.imageDir === undefined &&
        request.snapshotDir === undefined &&
        request.importSessions !== true &&
        request.claudeConfigDir === undefined &&
        request.codexHome === undefined
    ) {
        throw new Error("dataDir, imageDir, snapshotDir, importSessions, claudeConfigDir, or codexHome is required")
    }
    return request
}

function dataDocumentOperationOptions(record: Record<string, unknown>): OpenADEYjsDocumentOperationOptions | undefined {
    const operation = optionalStringParam(record, "operation")
    if (operation === undefined) return undefined
    if (operation.length > 120 || /[^\x20-\x7E]/.test(operation)) throw new Error("operation is invalid")
    return { operation }
}

function dataDocumentReadParams(params: unknown): { id: string; options?: OpenADEYjsDocumentOperationOptions } {
    const record = asRecord(params)
    return { id: stringParam(record, "id"), options: dataDocumentOperationOptions(record) }
}

function dataDocumentIdParam(params: unknown): string {
    return stringParam(asRecord(params), "id")
}

function dataDocumentSaveParams(params: unknown): { id: string; data: string; options?: OpenADEYjsDocumentOperationOptions } {
    const record = asRecord(params)
    const id = stringParam(record, "id")
    const data = stringParam(record, "data")
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
        throw new Error("data is invalid")
    }
    return { id, data, options: dataDocumentOperationOptions(record) }
}

function taskListParams(params: unknown): { repoId: string } {
    const record = asRecord(params)
    return { repoId: stringParam(record, "repoId") }
}

function taskReadParams(params: unknown): OpenADETaskReadRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        hydrateSessionEvents: booleanParam(record, "hydrateSessionEvents"),
        eventLimit: optionalStrictPositiveIntegerParam(record, "eventLimit"),
    }
}

function turnInterruptParams(params: unknown): { taskId: string } {
    return { taskId: stringParam(asRecord(params), "taskId") }
}

function queuedTurnCancelParams(params: unknown): OpenADEQueuedTurnCancelRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        queuedTurnId: stringParam(record, "queuedTurnId"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function queuedTurnEnqueueParams(params: unknown): OpenADEQueuedTurnEnqueueRequest {
    const record = asRecord(params)
    const turnType = record.type
    const input = stringParam(record, "input")
    if (turnType !== "do" && turnType !== "ask" && turnType !== "hyperplan") throw new Error("type is invalid")
    if (input.length > 200_000) throw new Error("input is invalid")
    const hyperplanStrategy = turnType === "hyperplan" ? hyperplanStrategyParam(record.hyperplanStrategy) : undefined
    if (turnType === "hyperplan" && !hyperplanStrategy) throw new Error("hyperplanStrategy is invalid")
    const thinking = record.thinking
    if (thinking !== undefined && thinking !== "low" && thinking !== "med" && thinking !== "high" && thinking !== "max") {
        throw new Error("thinking is invalid")
    }

    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        type: turnType,
        input,
        queuedTurnId: optionalStringParam(record, "queuedTurnId"),
        createdAt: optionalStringParam(record, "createdAt"),
        eventId: optionalStringParam(record, "eventId"),
        appendSystemPrompt: optionalStringParam(record, "appendSystemPrompt"),
        enabledMcpServerIds: optionalStrictStringArrayParam(record, "enabledMcpServerIds"),
        harnessId: optionalStringParam(record, "harnessId"),
        modelId: optionalStringParam(record, "modelId"),
        label: optionalStringParam(record, "label"),
        includeComments: booleanParam(record, "includeComments"),
        images: Array.isArray(record.images) ? record.images : undefined,
        hyperplanStrategy,
        thinking,
        fastMode: booleanParam(record, "fastMode"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

function queuedTurnReorderParams(params: unknown): OpenADEQueuedTurnReorderRequest {
    const record = asRecord(params)
    const queuedTurnIds = optionalStrictStringArrayParam(record, "queuedTurnIds")
    if (!queuedTurnIds || queuedTurnIds.length < 1) throw new Error("queuedTurnIds is invalid")
    if (new Set(queuedTurnIds).size !== queuedTurnIds.length) throw new Error("queuedTurnIds must be unique")
    return {
        repoId: stringParam(record, "repoId"),
        taskId: stringParam(record, "taskId"),
        queuedTurnIds,
        updatedAt: optionalStringParam(record, "updatedAt"),
        clientRequestId: optionalStringParam(record, "clientRequestId"),
    }
}

export function createOpenADEModule(adapters: OpenADEModuleAdapters): RuntimeModule {
    const clientRequests = new Map<string, ClientRequestEntry>()
    const createId = adapters.createId ?? createFallbackId
    const clientRequestRetentionMs = adapters.clientRequestRetentionMs ?? DEFAULT_CLIENT_REQUEST_RETENTION_MS
    const scopedHostContextCache = createScopedHostContextCache()

    function clearScopedHostContextCache(): void {
        scopedHostContextCache.projects = null
        scopedHostContextCache.projectsRequest = null
        scopedHostContextCache.tasks.clear()
        scopedHostContextCache.taskRequests.clear()
    }

    async function readCachedScopedProjects(): Promise<OpenADEProject[]> {
        const now = Date.now()
        if (scopedHostContextCache.projects && scopedHostContextCache.projects.expiresAt > now) {
            return scopedHostContextCache.projects.value
        }
        if (scopedHostContextCache.projectsRequest) return scopedHostContextCache.projectsRequest

        const request = adapters
            .readProjects()
            .then((projects) => {
                scopedHostContextCache.projects = {
                    value: projects,
                    expiresAt: Date.now() + SCOPED_HOST_CONTEXT_CACHE_MS,
                }
                return projects
            })
            .finally(() => {
                if (scopedHostContextCache.projectsRequest === request) scopedHostContextCache.projectsRequest = null
            })
        scopedHostContextCache.projectsRequest = request
        return request
    }

    async function readCachedScopedTask(repoId: string, taskId: string): Promise<OpenADETask> {
        const key = scopedTaskCacheKey(repoId, taskId)
        const now = Date.now()
        const cached = scopedHostContextCache.tasks.get(key)
        if (cached && cached.expiresAt > now) return cached.value

        const existing = scopedHostContextCache.taskRequests.get(key)
        if (existing) return existing

        const request = adapters
            .readTask(repoId, taskId, {
                hydrateSessionEvents: false,
            })
            .then((task) => {
                scopedHostContextCache.tasks.set(key, {
                    value: task,
                    expiresAt: Date.now() + SCOPED_HOST_CONTEXT_CACHE_MS,
                })
                return task
            })
            .finally(() => {
                if (scopedHostContextCache.taskRequests.get(key) === request) scopedHostContextCache.taskRequests.delete(key)
            })
        scopedHostContextCache.taskRequests.set(key, request)
        return request
    }

    function runMutationAction<T>(invalidation: OpenADEYjsProjectionCacheInvalidation | undefined, action: () => Promise<T> | T): Promise<T> {
        return Promise.resolve()
            .then(action)
            .then((result) => {
                clearScopedHostContextCache()
                adapters.invalidateReadCache?.(invalidation)
                return result
            })
    }

    function runIdempotentMutation<T>(scope: string, params: unknown, action: () => Promise<T> | T): Promise<T> {
        const clientRequestId = stableClientRequestKey(params)
        const invalidation = mutationReadCacheInvalidation(scope, params)
        if (!clientRequestId) return runMutationAction(invalidation, action)

        const key = `mutation:${scope}:${clientRequestId}`
        const existing = clientRequests.get(key)
        if (existing) return existing.promise as Promise<T>

        let retainStableResult = false
        const request = runMutationAction(invalidation, action)
            .then((result) => {
                retainStableResult = true
                return result
            })
            .finally(() => {
                if (!retainStableResult) {
                    clientRequests.delete(key)
                    return
                }

                const entry = clientRequests.get(key)
                if (!entry || entry.promise !== request) return

                const cleanupTimer = setTimeout(() => {
                    if (clientRequests.get(key)?.promise === request) {
                        clientRequests.delete(key)
                    }
                }, clientRequestRetentionMs)
                unrefTimer(cleanupTimer)
                entry.cleanupTimer = cleanupTimer
            })

        clientRequests.set(key, { promise: request, cleanupTimer: null })
        return request
    }

    return {
        name: "openade",
        register(server) {
            server.registerNotification(OPENADE_NOTIFICATION.snapshotChanged)
            server.registerNotification(OPENADE_NOTIFICATION.repoUpdated)
            server.registerNotification(OPENADE_NOTIFICATION.repoDeleted)
            server.registerNotification(OPENADE_NOTIFICATION.taskPreviewChanged)
            server.registerNotification(OPENADE_NOTIFICATION.taskUpdated)
            server.registerNotification(OPENADE_NOTIFICATION.taskDeleted)
            server.registerNotification(OPENADE_NOTIFICATION.queuedTurnUpdated)
            server.registerNotification(OPENADE_NOTIFICATION.workingTasks)
            server.registerNotification(OPENADE_NOTIFICATION.remoteDeviceChanged)

            server.register(OPENADE_METHOD.snapshotRead, (_params, context) =>
                adapters.readSnapshot({
                    version: adapters.version?.() ?? "local",
                    workingTaskIds: activeOpenADETaskIds(context.server),
                })
            )
            server.register(OPENADE_METHOD.projectList, (_params, context) =>
                adapters.readProjects({
                    workingTaskIds: activeOpenADETaskIds(context.server),
                })
            )
            server.register(
                OPENADE_METHOD.taskList,
                (params, context) => {
                    const { repoId } = taskListParams(params)
                    return adapters.readTaskList(repoId, {
                        workingTaskIds: activeOpenADETaskIds(context.server),
                    })
                },
                { validateParams: validateWith(taskListParams) }
            )
            server.register(
                OPENADE_METHOD.taskRead,
                (params) => {
                    const { repoId, taskId, hydrateSessionEvents, eventLimit } = taskReadParams(params)
                    return adapters.readTask(repoId, taskId, {
                        hydrateSessionEvents,
                        eventLimit,
                    })
                },
                { validateParams: validateWith(taskReadParams) }
            )
            const writeTaskImage = adapters.writeTaskImage
            if (writeTaskImage) {
                server.register(
                    OPENADE_METHOD.taskImageWrite,
                    (params) => runIdempotentMutation(OPENADE_METHOD.taskImageWrite, params, () => writeTaskImage(taskImageWriteParams(params))),
                    { validateParams: validateWith(taskImageWriteParams) }
                )
            }
            const readStagedTaskImage = adapters.readStagedTaskImage
            if (readStagedTaskImage) {
                server.register(OPENADE_METHOD.taskImageStagedRead, (params) => readStagedTaskImage(taskImageStagedReadParams(params)), {
                    validateParams: validateWith(taskImageStagedReadParams),
                })
            }
            const importLegacyResources = adapters.importLegacyResources
            if (importLegacyResources) {
                server.register(
                    OPENADE_METHOD.importLegacyResources,
                    (params) =>
                        runIdempotentMutation(OPENADE_METHOD.importLegacyResources, params, () => importLegacyResources(legacyResourcesImportParams(params))),
                    {
                        validateParams: validateWith(legacyResourcesImportParams),
                    }
                )
            }
            const scopedHost = adapters.scopedHost
            if (scopedHost) {
                const readScopedProject = async (repoId: string): Promise<OpenADEProject> => {
                    const repo = (await readCachedScopedProjects()).find((project) => project.id === repoId)
                    if (!repo) throw new Error(`Repository ${repoId} not found`)
                    return repo
                }
                const readScopedProjectTask = async (repoId: string, taskId: string): Promise<{ repo: OpenADEProject; task: OpenADETask }> => {
                    const repo = await readScopedProject(repoId)
                    const task = await readCachedScopedTask(repo.id, taskId)
                    return { repo, task }
                }
                const readScopedProjectOptionalTask = async (repoId: string, taskId?: string): Promise<{ repo: OpenADEProject; task?: OpenADETask }> => {
                    const repo = await readScopedProject(repoId)
                    if (!taskId) return { repo }
                    const task = await readCachedScopedTask(repo.id, taskId)
                    return { repo, task }
                }
                server.register(
                    OPENADE_METHOD.projectFilesTree,
                    async (params) => {
                        const request = projectFilesTreeParams(params)
                        const { repo, task } = await readScopedProjectOptionalTask(request.repoId, request.taskId)
                        return scopedHost.listProjectFiles({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    { validateParams: validateWith(projectFilesTreeParams) }
                )
                server.register(
                    OPENADE_METHOD.projectFileRead,
                    async (params) => {
                        const request = projectFileReadParams(params)
                        const { repo, task } = await readScopedProjectOptionalTask(request.repoId, request.taskId)
                        return scopedHost.readProjectFile({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    { validateParams: validateWith(projectFileReadParams) }
                )
                server.register(
                    OPENADE_METHOD.projectFileWrite,
                    async (params) => {
                        const request = projectFileWriteParams(params)
                        const { repo, task } = await readScopedProjectOptionalTask(request.repoId, request.taskId)
                        return runIdempotentMutation(OPENADE_METHOD.projectFileWrite, params, () =>
                            scopedHost.writeProjectFile({
                                ...request,
                                repo,
                                task,
                            })
                        )
                    },
                    { validateParams: validateWith(projectFileWriteParams) }
                )
                server.register(
                    OPENADE_METHOD.projectFilesFuzzySearch,
                    async (params) => {
                        const request = projectFilesFuzzySearchParams(params)
                        const { repo, task } = await readScopedProjectOptionalTask(request.repoId, request.taskId)
                        return scopedHost.fuzzySearchProjectFiles({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    {
                        validateParams: validateWith(projectFilesFuzzySearchParams),
                    }
                )
                server.register(
                    OPENADE_METHOD.projectSearch,
                    async (params) => {
                        const request = projectSearchParams(params)
                        const { repo, task } = await readScopedProjectOptionalTask(request.repoId, request.taskId)
                        return scopedHost.searchProject({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    { validateParams: validateWith(projectSearchParams) }
                )
                const readProjectSdkCapabilities = scopedHost.readProjectSdkCapabilities
                if (readProjectSdkCapabilities) {
                    server.register(
                        OPENADE_METHOD.projectSdkCapabilitiesRead,
                        async (params) => {
                            const request = projectSdkCapabilitiesReadParams(params)
                            const { repo, task } = await readScopedProjectOptionalTask(request.repoId, request.taskId)
                            return readProjectSdkCapabilities({
                                ...request,
                                repo,
                                task,
                            })
                        },
                        {
                            validateParams: validateWith(projectSdkCapabilitiesReadParams),
                        }
                    )
                }
                server.register(
                    OPENADE_METHOD.projectGitInfoRead,
                    async (params) => {
                        const request = projectGitInfoParams(params)
                        const repo = await readScopedProject(request.repoId)
                        return scopedHost.readProjectGitInfo({
                            ...request,
                            repo,
                        })
                    },
                    { validateParams: validateWith(projectGitInfoParams) }
                )
                server.register(
                    OPENADE_METHOD.projectGitBranchesRead,
                    async (params) => {
                        const request = projectGitBranchesReadParams(params)
                        const repo = await readScopedProject(request.repoId)
                        return scopedHost.readProjectGitBranches({
                            ...request,
                            repo,
                        })
                    },
                    {
                        validateParams: validateWith(projectGitBranchesReadParams),
                    }
                )
                server.register(
                    OPENADE_METHOD.projectGitSummaryRead,
                    async (params) => {
                        const request = projectGitSummaryReadParams(params)
                        const repo = await readScopedProject(request.repoId)
                        return scopedHost.readProjectGitSummary({
                            ...request,
                            repo,
                        })
                    },
                    {
                        validateParams: validateWith(projectGitSummaryReadParams),
                    }
                )
                server.register(
                    OPENADE_METHOD.projectProcessList,
                    async (params) => {
                        const request = projectProcessListParams(params)
                        const { repo, task } = await readScopedProjectOptionalTask(request.repoId, request.taskId)
                        return scopedHost.listProjectProcesses({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    { validateParams: validateWith(projectProcessListParams) }
                )
                server.register(
                    OPENADE_METHOD.cronDefinitionsRead,
                    async (params) => {
                        const request = cronDefinitionsReadParams(params)
                        const { repo, task } = await readScopedProjectOptionalTask(request.repoId, request.taskId)
                        if (scopedHost.readCronDefinitions) {
                            return scopedHost.readCronDefinitions({
                                ...request,
                                repo,
                                task,
                            })
                        }
                        const processes = await scopedHost.listProjectProcesses({
                            ...request,
                            repo,
                            task,
                        })
                        return cronDefinitionsFromProcessList(processes)
                    },
                    { validateParams: validateWith(cronDefinitionsReadParams) }
                )
                server.register(
                    OPENADE_METHOD.projectProcessStart,
                    async (params) => {
                        const request = projectProcessStartParams(params)
                        const { repo, task } = await readScopedProjectOptionalTask(request.repoId, request.taskId)
                        return runIdempotentMutation(OPENADE_METHOD.projectProcessStart, params, () =>
                            scopedHost.startProjectProcess({
                                ...request,
                                repo,
                                task,
                            })
                        )
                    },
                    { validateParams: validateWith(projectProcessStartParams) }
                )
                server.register(
                    OPENADE_METHOD.projectProcessReconnect,
                    async (params) => {
                        const request = projectProcessReconnectParams(params)
                        const { repo, task } = await readScopedProjectOptionalTask(request.repoId, request.taskId)
                        return scopedHost.reconnectProjectProcess({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    {
                        validateParams: validateWith(projectProcessReconnectParams),
                    }
                )
                server.register(
                    OPENADE_METHOD.projectProcessStop,
                    async (params) => {
                        const request = projectProcessStopParams(params)
                        const { repo, task } = await readScopedProjectOptionalTask(request.repoId, request.taskId)
                        return runIdempotentMutation(OPENADE_METHOD.projectProcessStop, params, () =>
                            scopedHost.stopProjectProcess({
                                ...request,
                                repo,
                                task,
                            })
                        )
                    },
                    { validateParams: validateWith(projectProcessStopParams) }
                )
                server.register(
                    OPENADE_METHOD.taskTerminalStart,
                    async (params) => {
                        const request = taskTerminalStartParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return runIdempotentMutation(OPENADE_METHOD.taskTerminalStart, params, () =>
                            scopedHost.startTaskTerminal({
                                ...request,
                                repo,
                                task,
                            })
                        )
                    },
                    { validateParams: validateWith(taskTerminalStartParams) }
                )
                server.register(
                    OPENADE_METHOD.taskTerminalReconnect,
                    async (params) => {
                        const request = taskTerminalReconnectParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return scopedHost.reconnectTaskTerminal({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    {
                        validateParams: validateWith(taskTerminalReconnectParams),
                    }
                )
                server.register(
                    OPENADE_METHOD.taskTerminalWrite,
                    async (params) => {
                        const request = taskTerminalWriteParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return runIdempotentMutation(OPENADE_METHOD.taskTerminalWrite, params, () =>
                            scopedHost.writeTaskTerminal({
                                ...request,
                                repo,
                                task,
                            })
                        )
                    },
                    { validateParams: validateWith(taskTerminalWriteParams) }
                )
                server.register(
                    OPENADE_METHOD.taskTerminalResize,
                    async (params) => {
                        const request = taskTerminalResizeParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return runIdempotentMutation(OPENADE_METHOD.taskTerminalResize, params, () =>
                            scopedHost.resizeTaskTerminal({
                                ...request,
                                repo,
                                task,
                            })
                        )
                    },
                    { validateParams: validateWith(taskTerminalResizeParams) }
                )
                server.register(
                    OPENADE_METHOD.taskTerminalStop,
                    async (params) => {
                        const request = taskTerminalStopParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return runIdempotentMutation(OPENADE_METHOD.taskTerminalStop, params, () =>
                            scopedHost.stopTaskTerminal({
                                ...request,
                                repo,
                                task,
                            })
                        )
                    },
                    { validateParams: validateWith(taskTerminalStopParams) }
                )
                server.register(
                    OPENADE_METHOD.taskImageRead,
                    async (params) => {
                        const request = taskImageReadParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        const image = taskImageReferenceForTask(task, request.imageId, request.ext)
                        if (!image) return { ...request, data: null }
                        return scopedHost.readTaskImage({
                            ...request,
                            repo,
                            task,
                            image,
                        })
                    },
                    { validateParams: validateWith(taskImageReadParams) }
                )
                server.register(
                    OPENADE_METHOD.taskChangesRead,
                    async (params) => {
                        const request = taskChangesReadParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return scopedHost.readTaskChanges({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    { validateParams: validateWith(taskChangesReadParams) }
                )
                server.register(
                    OPENADE_METHOD.taskGitSummaryRead,
                    async (params) => {
                        const request = taskGitSummaryParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return scopedHost.readTaskGitSummary({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    { validateParams: validateWith(taskGitSummaryParams) }
                )
                server.register(
                    OPENADE_METHOD.taskGitScopesRead,
                    async (params) => {
                        const request = taskGitScopesReadParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return scopedHost.readTaskGitScopes({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    { validateParams: validateWith(taskGitScopesReadParams) }
                )
                server.register(
                    OPENADE_METHOD.taskDiffRead,
                    async (params) => {
                        const request = taskDiffReadParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return scopedHost.readTaskDiff({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    { validateParams: validateWith(taskDiffReadParams) }
                )
                server.register(
                    OPENADE_METHOD.taskFilePairRead,
                    async (params) => {
                        const request = taskFilePairReadParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return scopedHost.readTaskFilePair({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    { validateParams: validateWith(taskFilePairReadParams) }
                )
                server.register(
                    OPENADE_METHOD.taskGitLog,
                    async (params) => {
                        const request = taskGitLogParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return scopedHost.readTaskGitLog({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    { validateParams: validateWith(taskGitLogParams) }
                )
                server.register(
                    OPENADE_METHOD.taskGitCommitFilesRead,
                    async (params) => {
                        const request = taskGitCommitFilesParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return scopedHost.readTaskGitCommitFiles({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    { validateParams: validateWith(taskGitCommitFilesParams) }
                )
                server.register(
                    OPENADE_METHOD.taskGitFileAtTreeishRead,
                    async (params) => {
                        const request = taskGitFileAtTreeishParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return scopedHost.readTaskGitFileAtTreeish({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    {
                        validateParams: validateWith(taskGitFileAtTreeishParams),
                    }
                )
                server.register(
                    OPENADE_METHOD.taskGitCommitFilePatchRead,
                    async (params) => {
                        const request = taskGitCommitFilePatchParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return scopedHost.readTaskGitCommitFilePatch({
                            ...request,
                            repo,
                            task,
                        })
                    },
                    {
                        validateParams: validateWith(taskGitCommitFilePatchParams),
                    }
                )
                server.register(
                    OPENADE_METHOD.taskGitCommit,
                    async (params) => {
                        const request = taskGitCommitParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return runIdempotentMutation(OPENADE_METHOD.taskGitCommit, params, () =>
                            scopedHost.commitTaskGit({
                                ...request,
                                repo,
                                task,
                            })
                        )
                    },
                    { validateParams: validateWith(taskGitCommitParams) }
                )
                server.register(
                    OPENADE_METHOD.taskSnapshotPatchRead,
                    async (params) => {
                        const request = taskSnapshotPatchReadParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        const snapshotEvent = snapshotEventForTask(task, request.eventId)
                        return scopedHost.readTaskSnapshotPatch({
                            ...request,
                            repo,
                            task,
                            snapshotEvent,
                        })
                    },
                    {
                        validateParams: validateWith(taskSnapshotPatchReadParams),
                    }
                )
                server.register(
                    OPENADE_METHOD.taskSnapshotIndexRead,
                    async (params) => {
                        const request = taskSnapshotIndexReadParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        const snapshotEvent = snapshotEventForTask(task, request.eventId)
                        return scopedHost.readTaskSnapshotIndex({
                            ...request,
                            repo,
                            task,
                            snapshotEvent,
                        })
                    },
                    {
                        validateParams: validateWith(taskSnapshotIndexReadParams),
                    }
                )
                server.register(
                    OPENADE_METHOD.taskSnapshotPatchReadSlice,
                    async (params) => {
                        const request = taskSnapshotPatchSliceReadParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        const snapshotEvent = snapshotEventForTask(task, request.eventId)
                        return scopedHost.readTaskSnapshotPatchSlice({
                            ...request,
                            repo,
                            task,
                            snapshotEvent,
                        })
                    },
                    {
                        validateParams: validateWith(taskSnapshotPatchSliceReadParams),
                    }
                )
                server.register(
                    OPENADE_METHOD.taskResourceInventoryRead,
                    async (params, context) => {
                        const request = taskResourceInventoryReadParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        const isRunning = activeOpenADETaskIds(context.server).includes(task.id)
                        return scopedHost.readTaskResourceInventory({
                            ...request,
                            repo,
                            task,
                            isRunning,
                        })
                    },
                    {
                        validateParams: validateWith(taskResourceInventoryReadParams),
                    }
                )
                server.register(
                    OPENADE_METHOD.taskTitleGenerate,
                    async (params) => {
                        const request = taskTitleGenerateParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return runIdempotentMutation(OPENADE_METHOD.taskTitleGenerate, params, async () => {
                            const result = await scopedHost.generateTaskTitle({
                                ...request,
                                repo,
                                task,
                            })
                            const title = result.title.trim()
                            if (!title) throw new Error("Generated task title is empty")
                            await adapters.updateTaskMetadata({
                                taskId: task.id,
                                title,
                                clientRequestId: request.clientRequestId,
                            })
                            return { ...result, title }
                        })
                    },
                    { validateParams: validateWith(taskTitleGenerateParams) }
                )
                server.register(
                    OPENADE_METHOD.taskEnvironmentPrepare,
                    async (params) => {
                        const request = taskEnvironmentPrepareParams(params)
                        const { repo, task } = await readScopedProjectTask(request.repoId, request.taskId)
                        return runIdempotentMutation(OPENADE_METHOD.taskEnvironmentPrepare, params, async () => {
                            const result = await scopedHost.prepareTaskEnvironment({
                                ...request,
                                repo,
                                task,
                                createdAt: new Date().toISOString(),
                            })
                            await adapters.setupTaskEnvironment({
                                taskId: task.id,
                                deviceEnvironment: result.deviceEnvironment,
                                setupEvent: result.setupEvent,
                                clientRequestId: request.clientRequestId,
                            })
                            return result
                        })
                    },
                    {
                        validateParams: validateWith(taskEnvironmentPrepareParams),
                    }
                )
                server.register(
                    OPENADE_METHOD.repoPathInspect,
                    async (params) => {
                        if (!scopedHost.inspectRepoPath) throw new Error("Repo path inspection is unavailable")
                        return scopedHost.inspectRepoPath(repoPathInspectParams(params))
                    },
                    {
                        validateParams: validateWith(repoPathInspectParams),
                    }
                )
            }
            server.register(
                OPENADE_METHOD.repoCreate,
                (params) => runIdempotentMutation(OPENADE_METHOD.repoCreate, params, () => adapters.createRepo(repoCreateParams(params))),
                {
                    validateParams: validateWith(repoCreateParams),
                }
            )
            server.register(
                OPENADE_METHOD.repoUpdate,
                (params) => runIdempotentMutation(OPENADE_METHOD.repoUpdate, params, () => adapters.updateRepo(repoUpdateParams(params))),
                {
                    validateParams: validateWith(repoUpdateParams),
                }
            )
            server.register(
                OPENADE_METHOD.repoDelete,
                (params) => runIdempotentMutation(OPENADE_METHOD.repoDelete, params, () => adapters.deleteRepo(repoDeleteParams(params))),
                {
                    validateParams: validateWith(repoDeleteParams),
                }
            )
            server.register(
                OPENADE_METHOD.taskCreate,
                (params) => runIdempotentMutation(OPENADE_METHOD.taskCreate, params, () => adapters.createTask(taskCreateParams(params))),
                {
                    validateParams: validateWith(taskCreateParams),
                }
            )
            server.register(
                OPENADE_METHOD.turnStart,
                (params) => {
                    const stableKey = stableClientRequestKey(params)
                    const requestKey = stableKey ?? createId()
                    const clientKey = stableKey ? `${OPENADE_METHOD.turnStart}:${stableKey}` : requestKey
                    const existing = clientRequests.get(clientKey)
                    if (existing) return existing.promise

                    const runtimeId = `openade-turn:${requestKey}`
                    const current = server.supervisor.get(runtimeId)
                    if (!current) {
                        const record = asRecord(params)
                        const runtime = server.supervisor.create({
                            runtimeId,
                            kind: "agent",
                            status: "starting",
                            scope: {
                                ownerType: "openade-turn",
                                ownerId: requestKey,
                                repoPath: typeof record.repoPath === "string" ? record.repoPath : undefined,
                            },
                        })
                        server.notify("runtime/created", runtime)
                    }

                    let retainStableResult = false
                    const request = adapters
                        .startTurn(turnParams(params), {
                            runtimeId,
                            requestKey,
                        })
                        .then((result) => {
                            retainStableResult = true
                            const taskId = asRecord(result).taskId
                            const currentRuntime = server.supervisor.get(runtimeId)
                            if (!currentRuntime || currentRuntime.status === "starting" || currentRuntime.status === "running") {
                                const updated = server.supervisor.update(runtimeId, {
                                    status: "running",
                                    scope: {
                                        ...(currentRuntime?.scope ?? {}),
                                        ownerType: "openade-task",
                                        ownerId: typeof taskId === "string" ? taskId : requestKey,
                                    },
                                })
                                server.notify("runtime/updated", updated)
                            }
                            return result
                        })
                        .catch((error) => {
                            const updated = server.supervisor.update(runtimeId, {
                                status: "failed",
                                error: error instanceof Error ? error.message : "OpenADE turn failed",
                            })
                            server.notify("runtime/failed", updated)
                            throw error
                        })
                        .finally(() => {
                            if (!stableKey || !retainStableResult) {
                                clientRequests.delete(clientKey)
                                return
                            }

                            const entry = clientRequests.get(clientKey)
                            if (!entry || entry.promise !== request) return

                            const cleanupTimer = setTimeout(() => {
                                if (clientRequests.get(clientKey)?.promise === request) {
                                    clientRequests.delete(clientKey)
                                }
                            }, clientRequestRetentionMs)
                            unrefTimer(cleanupTimer)
                            entry.cleanupTimer = cleanupTimer
                        })
                    clientRequests.set(clientKey, {
                        promise: request,
                        cleanupTimer: null,
                    })
                    return request
                },
                { validateParams: validateWith(turnParams) }
            )
            server.register(
                OPENADE_METHOD.reviewStart,
                (params) => {
                    const stableKey = stableClientRequestKey(params)
                    const requestKey = stableKey ?? createId()
                    const clientKey = stableKey ? `${OPENADE_METHOD.reviewStart}:${stableKey}` : requestKey
                    const existing = clientRequests.get(clientKey)
                    if (existing) return existing.promise

                    const runtimeId = `openade-review:${requestKey}`
                    const current = server.supervisor.get(runtimeId)
                    if (!current) {
                        const record = asRecord(params)
                        const runtime = server.supervisor.create({
                            runtimeId,
                            kind: "composite",
                            status: "starting",
                            scope: {
                                ownerType: "openade-review",
                                ownerId: requestKey,
                                repoPath: typeof record.repoPath === "string" ? record.repoPath : undefined,
                            },
                        })
                        server.notify("runtime/created", runtime)
                    }

                    let retainStableResult = false
                    const request = adapters
                        .startReview(reviewStartParams(params), {
                            runtimeId,
                            requestKey,
                        })
                        .then((result) => {
                            retainStableResult = true
                            const taskId = asRecord(params).taskId
                            const currentRuntime = server.supervisor.get(runtimeId)
                            if (!currentRuntime || currentRuntime.status === "starting" || currentRuntime.status === "running") {
                                const updated = server.supervisor.update(runtimeId, {
                                    status: "running",
                                    scope: {
                                        ...(currentRuntime?.scope ?? {}),
                                        ownerType: "openade-task",
                                        ownerId: typeof taskId === "string" ? taskId : requestKey,
                                    },
                                })
                                server.notify("runtime/updated", updated)
                            }
                            return result
                        })
                        .catch((error) => {
                            const updated = server.supervisor.update(runtimeId, {
                                status: "failed",
                                error: error instanceof Error ? error.message : "OpenADE review failed",
                            })
                            server.notify("runtime/failed", updated)
                            throw error
                        })
                        .finally(() => {
                            if (!stableKey || !retainStableResult) {
                                clientRequests.delete(clientKey)
                                return
                            }

                            const entry = clientRequests.get(clientKey)
                            if (!entry || entry.promise !== request) return

                            const cleanupTimer = setTimeout(() => {
                                if (clientRequests.get(clientKey)?.promise === request) {
                                    clientRequests.delete(clientKey)
                                }
                            }, clientRequestRetentionMs)
                            unrefTimer(cleanupTimer)
                            entry.cleanupTimer = cleanupTimer
                        })
                    clientRequests.set(clientKey, {
                        promise: request,
                        cleanupTimer: null,
                    })
                    return request
                },
                { validateParams: validateWith(reviewStartParams) }
            )
            server.register(
                OPENADE_METHOD.turnInterrupt,
                (params) =>
                    runIdempotentMutation(OPENADE_METHOD.turnInterrupt, params, () => {
                        return adapters.interruptTurn(turnInterruptParams(params))
                    }),
                { validateParams: validateWith(turnInterruptParams) }
            )
            server.register(
                OPENADE_METHOD.queuedTurnEnqueue,
                (params) =>
                    runIdempotentMutation(OPENADE_METHOD.queuedTurnEnqueue, params, () => {
                        return adapters.enqueueQueuedTurn(queuedTurnEnqueueParams(params))
                    }),
                { validateParams: validateWith(queuedTurnEnqueueParams) }
            )
            server.register(
                OPENADE_METHOD.queuedTurnReorder,
                (params) =>
                    runIdempotentMutation(OPENADE_METHOD.queuedTurnReorder, params, () => {
                        return adapters.reorderQueuedTurns(queuedTurnReorderParams(params))
                    }),
                { validateParams: validateWith(queuedTurnReorderParams) }
            )
            server.register(
                OPENADE_METHOD.queuedTurnCancel,
                (params) =>
                    runIdempotentMutation(OPENADE_METHOD.queuedTurnCancel, params, () => {
                        return adapters.cancelQueuedTurn(queuedTurnCancelParams(params))
                    }),
                { validateParams: validateWith(queuedTurnCancelParams) }
            )
            server.register(
                OPENADE_METHOD.taskEnvironmentSetup,
                (params) =>
                    runIdempotentMutation(OPENADE_METHOD.taskEnvironmentSetup, params, () => adapters.setupTaskEnvironment(taskEnvironmentSetupParams(params))),
                { validateParams: validateWith(taskEnvironmentSetupParams) }
            )
            server.register(
                OPENADE_METHOD.actionCreate,
                (params) => runIdempotentMutation(OPENADE_METHOD.actionCreate, params, () => adapters.createActionEvent(createActionEventParams(params))),
                { validateParams: validateWith(createActionEventParams) }
            )
            server.register(
                OPENADE_METHOD.actionStreamAppend,
                (params) =>
                    runIdempotentMutation(OPENADE_METHOD.actionStreamAppend, params, () =>
                        adapters.appendActionStreamEvent(appendActionStreamEventParams(params))
                    ),
                { validateParams: validateWith(appendActionStreamEventParams) }
            )
            server.register(
                OPENADE_METHOD.actionComplete,
                (params) => runIdempotentMutation(OPENADE_METHOD.actionComplete, params, () => adapters.completeActionEvent(completeActionEventParams(params))),
                { validateParams: validateWith(completeActionEventParams) }
            )
            server.register(
                OPENADE_METHOD.actionError,
                (params) => runIdempotentMutation(OPENADE_METHOD.actionError, params, () => adapters.errorActionEvent(errorActionEventParams(params))),
                { validateParams: validateWith(errorActionEventParams) }
            )
            server.register(
                OPENADE_METHOD.actionStopped,
                (params) => runIdempotentMutation(OPENADE_METHOD.actionStopped, params, () => adapters.stoppedActionEvent(stoppedActionEventParams(params))),
                { validateParams: validateWith(stoppedActionEventParams) }
            )
            server.register(
                OPENADE_METHOD.actionReconcileRuntime,
                (params) =>
                    runIdempotentMutation(OPENADE_METHOD.actionReconcileRuntime, params, () =>
                        adapters.reconcileActionEventRuntime(reconcileActionEventRuntimeParams(params))
                    ),
                {
                    validateParams: validateWith(reconcileActionEventRuntimeParams),
                }
            )
            server.register(
                OPENADE_METHOD.actionExecutionUpdate,
                (params) =>
                    runIdempotentMutation(OPENADE_METHOD.actionExecutionUpdate, params, () =>
                        adapters.updateActionExecution(actionExecutionUpdateParams(params))
                    ),
                { validateParams: validateWith(actionExecutionUpdateParams) }
            )
            server.register(
                OPENADE_METHOD.hyperplanSubExecutionAdd,
                (params) =>
                    runIdempotentMutation(OPENADE_METHOD.hyperplanSubExecutionAdd, params, () =>
                        adapters.addHyperPlanSubExecution(hyperplanSubExecutionAddParams(params))
                    ),
                {
                    validateParams: validateWith(hyperplanSubExecutionAddParams),
                }
            )
            server.register(
                OPENADE_METHOD.hyperplanSubExecutionStreamAppend,
                (params) =>
                    runIdempotentMutation(OPENADE_METHOD.hyperplanSubExecutionStreamAppend, params, () =>
                        adapters.appendHyperPlanSubExecutionStreamEvent(hyperplanSubExecutionStreamAppendParams(params))
                    ),
                {
                    validateParams: validateWith(hyperplanSubExecutionStreamAppendParams),
                }
            )
            server.register(
                OPENADE_METHOD.hyperplanSubExecutionUpdate,
                (params) =>
                    runIdempotentMutation(OPENADE_METHOD.hyperplanSubExecutionUpdate, params, () =>
                        adapters.updateHyperPlanSubExecution(hyperplanSubExecutionUpdateParams(params))
                    ),
                {
                    validateParams: validateWith(hyperplanSubExecutionUpdateParams),
                }
            )
            server.register(
                OPENADE_METHOD.hyperplanReconcileLabelsSet,
                (params) =>
                    runIdempotentMutation(OPENADE_METHOD.hyperplanReconcileLabelsSet, params, () =>
                        adapters.setHyperPlanReconcileLabels(hyperplanReconcileLabelsSetParams(params))
                    ),
                {
                    validateParams: validateWith(hyperplanReconcileLabelsSetParams),
                }
            )
            server.register(
                OPENADE_METHOD.snapshotCreate,
                (params) => runIdempotentMutation(OPENADE_METHOD.snapshotCreate, params, () => adapters.createSnapshotEvent(snapshotEventCreateParams(params))),
                { validateParams: validateWith(snapshotEventCreateParams) }
            )
            server.register(
                OPENADE_METHOD.commentCreate,
                (params) => runIdempotentMutation(OPENADE_METHOD.commentCreate, params, () => adapters.createComment(commentCreateParams(params))),
                { validateParams: validateWith(commentCreateParams) }
            )
            server.register(
                OPENADE_METHOD.commentEdit,
                (params) => runIdempotentMutation(OPENADE_METHOD.commentEdit, params, () => adapters.editComment(commentEditParams(params))),
                { validateParams: validateWith(commentEditParams) }
            )
            server.register(
                OPENADE_METHOD.commentDelete,
                (params) => runIdempotentMutation(OPENADE_METHOD.commentDelete, params, () => adapters.deleteComment(commentDeleteParams(params))),
                { validateParams: validateWith(commentDeleteParams) }
            )
            server.register(
                OPENADE_METHOD.taskMetadataUpdate,
                (params) =>
                    runIdempotentMutation(OPENADE_METHOD.taskMetadataUpdate, params, () => adapters.updateTaskMetadata(taskMetadataUpdateParams(params))),
                { validateParams: validateWith(taskMetadataUpdateParams) }
            )
            const recalculateTaskUsage = adapters.recalculateTaskUsage
            if (recalculateTaskUsage) {
                server.register(
                    OPENADE_METHOD.taskUsageRecalculate,
                    (params) =>
                        runIdempotentMutation(OPENADE_METHOD.taskUsageRecalculate, params, () => recalculateTaskUsage(taskUsageRecalculateParams(params))),
                    {
                        validateParams: validateWith(taskUsageRecalculateParams),
                    }
                )
            }
            const backfillTaskUsage = adapters.backfillTaskUsage
            if (backfillTaskUsage) {
                server.register(
                    OPENADE_METHOD.taskUsageBackfill,
                    (params) => runIdempotentMutation(OPENADE_METHOD.taskUsageBackfill, params, () => backfillTaskUsage(taskUsageBackfillParams(params))),
                    { validateParams: validateWith(taskUsageBackfillParams) }
                )
            }
            server.register(
                OPENADE_METHOD.taskDelete,
                (params) => runIdempotentMutation(OPENADE_METHOD.taskDelete, params, () => adapters.deleteTask(taskDeleteParams(params))),
                { validateParams: validateWith(taskDeleteParams) }
            )
            server.register("data/yjs/list", () => adapters.listDataDocuments())
            server.register(
                "data/yjs/read",
                (params) => {
                    const { id, options } = dataDocumentReadParams(params)
                    return adapters.readDataDocumentBase64(id, options)
                },
                { validateParams: validateWith(dataDocumentReadParams) }
            )
            server.register(
                "data/yjs/save",
                (params) => {
                    return runIdempotentMutation("data/yjs/save", params, () => {
                        const { id, data, options } = dataDocumentSaveParams(params)
                        return adapters.saveDataDocumentBase64(id, data, options)
                    })
                },
                { validateParams: validateWith(dataDocumentSaveParams) }
            )
            server.register(
                "data/yjs/delete",
                (params) => runIdempotentMutation("data/yjs/delete", params, () => adapters.deleteDataDocument(dataDocumentIdParam(params))),
                { validateParams: validateWith(dataDocumentIdParam) }
            )
            const mcpSettings =
                adapters.readMcpServers && adapters.replaceMcpServers && adapters.upsertMcpServer && adapters.deleteMcpServer
                    ? {
                          readMcpServers: adapters.readMcpServers,
                          replaceMcpServers: adapters.replaceMcpServers,
                          upsertMcpServer: adapters.upsertMcpServer,
                          deleteMcpServer: adapters.deleteMcpServer,
                      }
                    : null
            if (mcpSettings) {
                server.register(OPENADE_METHOD.settingsMcpServersRead, async (_params, context) => {
                    const result = await mcpSettings.readMcpServers()
                    return canReadFullMcpServerSettings(context) ? result : sanitizeMcpServersReadResult(result)
                })
                server.register(
                    OPENADE_METHOD.settingsMcpServersReplace,
                    (params) =>
                        runIdempotentMutation(OPENADE_METHOD.settingsMcpServersReplace, params, () =>
                            mcpSettings.replaceMcpServers(mcpServersReplaceParams(params))
                        ),
                    { validateParams: validateWith(mcpServersReplaceParams) }
                )
                server.register(
                    OPENADE_METHOD.settingsMcpServersUpsert,
                    (params) =>
                        runIdempotentMutation(OPENADE_METHOD.settingsMcpServersUpsert, params, () =>
                            mcpSettings.upsertMcpServer(mcpServerUpsertParams(params))
                        ),
                    { validateParams: validateWith(mcpServerUpsertParams) }
                )
                server.register(
                    OPENADE_METHOD.settingsMcpServersDelete,
                    (params) =>
                        runIdempotentMutation(OPENADE_METHOD.settingsMcpServersDelete, params, () =>
                            mcpSettings.deleteMcpServer(mcpServerDeleteParams(params))
                        ),
                    { validateParams: validateWith(mcpServerDeleteParams) }
                )
            }
            const personalSettings =
                adapters.readPersonalSettings && adapters.replacePersonalSettings
                    ? {
                          readPersonalSettings: adapters.readPersonalSettings,
                          replacePersonalSettings: adapters.replacePersonalSettings,
                      }
                    : null
            if (personalSettings) {
                server.register(OPENADE_METHOD.settingsPersonalRead, () => personalSettings.readPersonalSettings())
                server.register(
                    OPENADE_METHOD.settingsPersonalReplace,
                    (params) =>
                        runIdempotentMutation(OPENADE_METHOD.settingsPersonalReplace, params, () =>
                            personalSettings.replacePersonalSettings(personalSettingsReplaceParams(params))
                        ),
                    {
                        validateParams: validateWith(personalSettingsReplaceParams),
                    }
                )
            }
            const cronInstallState =
                adapters.readCronInstallState && adapters.replaceCronInstallState
                    ? {
                          readCronInstallState: adapters.readCronInstallState,
                          replaceCronInstallState: adapters.replaceCronInstallState,
                      }
                    : null
            if (cronInstallState) {
                const listCronInstallStateRepos = adapters.listCronInstallStateRepos
                if (listCronInstallStateRepos) {
                    server.register(OPENADE_METHOD.cronInstallStateList, () => listCronInstallStateRepos())
                }
                server.register(OPENADE_METHOD.cronInstallStateRead, (params) => cronInstallState.readCronInstallState(cronInstallStateReadParams(params)), {
                    validateParams: validateWith(cronInstallStateReadParams),
                })
                server.register(
                    OPENADE_METHOD.cronInstallStateReplace,
                    (params) =>
                        runIdempotentMutation(OPENADE_METHOD.cronInstallStateReplace, params, () =>
                            cronInstallState.replaceCronInstallState(cronInstallStateReplaceParams(params))
                        ),
                    {
                        validateParams: validateWith(cronInstallStateReplaceParams),
                    }
                )
            }
            const runCron = adapters.runCron
            if (runCron) {
                server.register(
                    OPENADE_METHOD.cronRun,
                    (params) => runIdempotentMutation(OPENADE_METHOD.cronRun, params, () => runCron(cronRunParams(params))),
                    {
                        validateParams: validateWith(cronRunParams),
                    }
                )
            }
        },
    }
}

export function publishOpenADECompanionEvent(server: RuntimeServer, event: OpenADERuntimeBridgeEvent): void {
    switch (event.type) {
        case "snapshot_changed":
            server.notify(OPENADE_NOTIFICATION.snapshotChanged, event)
            break
        case "repo_changed":
            server.notify(OPENADE_NOTIFICATION.repoUpdated, event)
            server.notify(OPENADE_NOTIFICATION.snapshotChanged, event)
            break
        case "repo_deleted":
            server.notify(OPENADE_NOTIFICATION.repoDeleted, event)
            server.notify(OPENADE_NOTIFICATION.snapshotChanged, event)
            break
        case "task_changed":
            server.supervisor.touchByOwner("openade-task", event.taskId)
            server.notify(OPENADE_NOTIFICATION.taskUpdated, event)
            if (event.previewChanged !== false) server.notify(OPENADE_NOTIFICATION.taskPreviewChanged, event)
            break
        case "task_deleted":
            server.notify(OPENADE_NOTIFICATION.taskDeleted, event)
            server.notify(OPENADE_NOTIFICATION.taskPreviewChanged, event)
            server.notify(OPENADE_NOTIFICATION.snapshotChanged, event)
            break
        case "working_tasks":
            for (const runtime of server.supervisor.list({
                ownerType: "openade-task",
            })) {
                if (runtime.scope.ownerId && event.taskIds.includes(runtime.scope.ownerId)) {
                    const updated = server.supervisor.update(runtime.runtimeId, {
                        status: "running",
                    })
                    server.notify("runtime/updated", updated)
                } else if (runtime.status === "running" || runtime.status === "starting") {
                    const updated = server.supervisor.update(runtime.runtimeId, {
                        status: "completed",
                    })
                    server.notify("runtime/completed", updated)
                }
            }
            server.notify(OPENADE_NOTIFICATION.workingTasks, event)
            break
        case "devices_changed":
            server.notify(OPENADE_NOTIFICATION.remoteDeviceChanged, event)
            break
    }
}
