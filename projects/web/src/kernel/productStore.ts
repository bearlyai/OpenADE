import { OPENADE_METHOD, OPENADE_NOTIFICATION, type OpenADEMethod, type OpenADERequestOptions, type OpenADETurnStartOptions } from "../../../openade-client/src"
import type {
    OpenADEActionEventSource,
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
    OpenADEProjectProcessInstance,
    OpenADEProjectProcessReconnectRequest,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectProcessStartRequest,
    OpenADEProjectProcessStartResult,
    OpenADEProjectProcessStopRequest,
    OpenADEProjectProcessStopResult,
    OpenADEProjectSearchRequest,
    OpenADEProjectSearchResult,
    OpenADEProjectSdkCapabilitiesReadRequest,
    OpenADEProject,
    OpenADEQueuedTurnCancelRequest,
    OpenADEQueuedTurnCancelResult,
    OpenADEQueuedTurnEnqueueRequest,
    OpenADEQueuedTurnEnqueueResult,
    OpenADEQueuedTurn,
    OpenADEQueuedTurnReorderRequest,
    OpenADEQueuedTurnReorderResult,
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
    OpenADETaskPreviewUsage,
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
import { RuntimeClientError, RuntimeRecordCache } from "../../../runtime-client/src"
import type { RuntimeListParams, RuntimeNotification, RuntimeRecord } from "../../../runtime-protocol/src"

function taskKey(repoId: string, taskId: string): string {
    return `${repoId}\0${taskId}`
}

function isLimitedLightweightTaskRead(options: OpenADETaskReadOptions): boolean {
    return options.hydrateSessionEvents !== true && options.eventLimit !== undefined
}

function taskReadOptionsKey(options: OpenADETaskReadOptions): string {
    if (options.hydrateSessionEvents === true) return "full"
    return `light:${options.eventLimit ?? "default"}`
}

function cachedTaskReadOptions(options: OpenADETaskReadOptions): OpenADETaskReadOptions {
    if (options.hydrateSessionEvents === true) return { hydrateSessionEvents: true }
    return options.eventLimit === undefined ? { hydrateSessionEvents: false } : { hydrateSessionEvents: false, eventLimit: options.eventLimit }
}

function notificationTaskReadOptions(options: OpenADETaskReadOptions | undefined): OpenADETaskReadOptions {
    if (options?.hydrateSessionEvents === true) return { hydrateSessionEvents: true }
    if (options?.eventLimit !== undefined) return cachedTaskReadOptions(options)
    return NOTIFICATION_LIGHTWEIGHT_TASK_READ_OPTIONS
}

function clearTaskRequestsInFlight(requestsInFlight: Map<string, Promise<OpenADETask>>, key: string): void {
    for (const requestKey of requestsInFlight.keys()) {
        if (requestKey.startsWith(`${key}\0`)) requestsInFlight.delete(requestKey)
    }
}

function notificationRecord(notification: RuntimeNotification): Record<string, unknown> {
    return typeof notification.params === "object" && notification.params !== null && !Array.isArray(notification.params)
        ? (notification.params as Record<string, unknown>)
        : {}
}

function taskNotificationNeedsScopedHostInvalidation(notification: RuntimeNotification): boolean {
    if (notification.method === OPENADE_NOTIFICATION.queuedTurnUpdated) return false
    const params = notificationRecord(notification)
    if (params.previewChanged === false) return false
    if (params.eventStatus === "in_progress") return false
    return true
}

function taskPreviewNotificationKey(notification: RuntimeNotification): string | null {
    if (notification.method !== OPENADE_NOTIFICATION.taskPreviewChanged) return null
    const params = notificationRecord(notification)
    const repoId = typeof params.repoId === "string" ? params.repoId : ""
    return repoId || GLOBAL_TASK_PREVIEW_NOTIFICATION_KEY
}

const LIGHTWEIGHT_TASK_READ_OPTIONS: OpenADETaskReadOptions = {
    hydrateSessionEvents: false,
}
const NOTIFICATION_LIGHTWEIGHT_TASK_READ_OPTIONS: OpenADETaskReadOptions = {
    hydrateSessionEvents: false,
    eventLimit: 12,
}
const SNAPSHOT_CACHE_TTL_MS = 1_000
const PROJECT_LIST_CACHE_TTL_MS = 10_000
const LIGHTWEIGHT_TASK_CACHE_TTL_MS = 15_000
const RUNTIME_LIST_CACHE_TTL_MS = 1_000
const RUNTIME_LIST_METHOD = "runtime/list"
type TaskCacheReadMode = "lightweight" | "hydrated"
type DeferredTaskRefreshListener = (task: OpenADETask, readOptions: OpenADETaskReadOptions) => void
const PROJECT_FILE_CACHE_TTL_MS = 15_000
const PROCESS_LIST_CACHE_TTL_MS = 15_000
const CRON_INSTALL_STATE_CACHE_TTL_MS = 5_000
const PROJECT_SEARCH_CACHE_TTL_MS = 15_000
const SDK_CAPABILITIES_CACHE_TTL_MS = 60_000
const PROJECT_GIT_INFO_CACHE_TTL_MS = 15_000
const PROJECT_GIT_BRANCHES_CACHE_TTL_MS = 15_000
const GIT_SUMMARY_CACHE_TTL_MS = 15_000
const TASK_GIT_READ_CACHE_TTL_MS = 15_000
const TASK_SNAPSHOT_ARTIFACT_CACHE_TTL_MS = 1_000
const TASK_IMAGE_CACHE_TTL_MS = 1_000
const TASK_RESOURCE_INVENTORY_CACHE_TTL_MS = 1_000
const PRODUCT_SETTINGS_CACHE_TTL_MS = 1_000
const TASK_UPDATE_NOTIFICATION_COALESCE_MS = 150
const TASK_PREVIEW_NOTIFICATION_COALESCE_MS = 150
const TASK_PREVIEW_NOTIFICATION_MIN_REFRESH_MS = 10_000
const TASK_UPDATE_NOTIFICATION_MIN_REFRESH_MS = 2_000
const TASK_IN_PROGRESS_NOTIFICATION_MIN_REFRESH_MS = 15_000
const ACCEPTED_ACTION_START_NOTIFICATION_SUPPRESS_MS = 2_000
const ACCEPTED_MUTATION_NOTIFICATION_SUPPRESS_MS = 2_000
const GLOBAL_TASK_PREVIEW_NOTIFICATION_KEY = "\0snapshot"
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

function canFallbackProjectListToSnapshot(error: unknown): boolean {
    return error instanceof RuntimeClientError && (error.code === "method_not_found" || error.code === "permission_denied")
}

function isOpenADEMethodUnavailableError(error: unknown, method: OpenADEMethod): boolean {
    return isRuntimeMethodUnavailableError(error, method)
}

function isRuntimeMethodUnavailableError(error: unknown, method: string): boolean {
    return error instanceof Error && error.message === `OpenADE runtime method unavailable: ${method}`
}

interface CachedProcessList {
    expiresAt: number
    result: OpenADEProjectProcessListResult
}

interface CachedCronDefinitions {
    expiresAt: number
    result: OpenADECronDefinitionsReadResult
}

interface CachedRuntimeList {
    expiresAt: number
    result: RuntimeRecord[]
}

interface CachedCronInstallState {
    expiresAt: number
    result: OpenADECronInstallStateReadResult
}

interface CachedCronInstallStateList {
    expiresAt: number
    result: OpenADECronInstallStateListResult
}

interface CachedProjectFilesTree {
    expiresAt: number
    result: OpenADEProjectFilesTreeResult
}

interface CachedProjectFileRead {
    expiresAt: number
    result: OpenADEProjectFileReadResult
}

interface CachedFuzzySearch {
    expiresAt: number
    result: OpenADEProjectFilesFuzzySearchResult
}

interface CachedProjectSearch {
    expiresAt: number
    result: OpenADEProjectSearchResult
}

interface CachedSdkCapabilities {
    expiresAt: number
    result: OpenADESdkCapabilities
}

interface CachedProjectGitInfo {
    expiresAt: number
    result: OpenADEProjectGitInfoResult
}

interface CachedProjectGitBranches {
    expiresAt: number
    result: OpenADEProjectGitBranchesReadResult
}

interface CachedProjectGitSummary {
    expiresAt: number
    result: OpenADEProjectGitSummaryReadResult
}

interface CachedTaskGitSummary {
    expiresAt: number
    result: OpenADETaskGitSummaryResult
}

interface CachedTaskGitScopes {
    expiresAt: number
    result: OpenADETaskGitScopesReadResult
}

interface CachedTaskGitLog {
    expiresAt: number
    result: OpenADETaskGitLogResult
}

interface CachedTaskGitCommitFiles {
    expiresAt: number
    result: OpenADETaskGitCommitFilesResult
}

interface CachedTaskGitFileAtTreeish {
    expiresAt: number
    result: OpenADETaskGitFileAtTreeishResult
}

interface CachedTaskGitCommitFilePatch {
    expiresAt: number
    result: OpenADETaskGitCommitFilePatchResult
}

interface CachedTaskChanges {
    expiresAt: number
    result: OpenADETaskChangesReadResult
}

interface CachedTaskDiff {
    expiresAt: number
    result: OpenADETaskDiffReadResult
}

interface CachedTaskFilePair {
    expiresAt: number
    result: OpenADETaskFilePairReadResult
}

interface CachedTaskSnapshotPatch {
    expiresAt: number
    result: OpenADETaskSnapshotPatchReadResult
}

interface CachedTaskSnapshotIndex {
    expiresAt: number
    result: OpenADETaskSnapshotIndexReadResult
}

interface CachedTaskSnapshotPatchSlice {
    expiresAt: number
    result: OpenADETaskSnapshotPatchSliceReadResult
}

interface CachedTaskImage {
    expiresAt: number
    result: OpenADETaskImageReadResult
}

interface CachedStagedTaskImage {
    expiresAt: number
    result: OpenADETaskImageStagedReadResult
}

interface CachedTaskResourceInventory {
    expiresAt: number
    result: OpenADETaskResourceInventoryReadResult
}

interface CachedMcpServers {
    expiresAt: number
    result: OpenADEMCPServersReadResult
}

interface CachedPersonalSettings {
    expiresAt: number
    result: OpenADEPersonalSettingsReadResult
}

function coalescedRead<Result>(
    requestsInFlight: Map<string, Promise<Result>>,
    key: string,
    read: () => Promise<Result>,
    cacheResult?: (result: Result) => void
): Promise<Result> {
    const inFlight = requestsInFlight.get(key)
    if (inFlight) return inFlight

    const request = read()
        .then((result) => {
            if (requestsInFlight.get(key) === request) cacheResult?.(result)
            return result
        })
        .finally(() => {
            if (requestsInFlight.get(key) === request) requestsInFlight.delete(key)
        })
    requestsInFlight.set(key, request)
    return request
}

function cronDefinitionsFromProcessList(result: OpenADEProjectProcessListResult): OpenADECronDefinitionsReadResult | null {
    if (!result.configs) return null
    return {
        repoId: result.repoId,
        taskId: result.taskId,
        repoRoot: result.repoRoot,
        searchRoot: result.searchRoot,
        isWorktree: result.isWorktree,
        worktreeRoot: result.worktreeRoot,
        configs: result.configs.map((config) => ({
            relativePath: config.relativePath,
            crons: config.crons,
        })),
        errors: result.errors,
    }
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
        preview: task.preview ? taskPreviewWithMetadataUpdate(task.preview, args) : task.preview,
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

function createProductStoreClientRequestId(): string {
    const crypto = globalThis.crypto
    if (crypto?.randomUUID) return crypto.randomUUID()
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function withProductStoreClientRequestId<T extends { clientRequestId?: string }>(args: T, options: OpenADERequestOptions): T & { clientRequestId: string } {
    return {
        ...args,
        clientRequestId: options.clientRequestId ?? args.clientRequestId ?? createProductStoreClientRequestId(),
    }
}

function stableJSONValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableJSONValue)
    if (typeof value !== "object" || value === null) return value
    const record = value as Record<string, unknown>
    return Object.fromEntries(
        Object.keys(record)
            .sort()
            .map((key) => [key, stableJSONValue(record[key])])
    )
}

function taskMetadataUpdateRequestKey(args: OpenADETaskMetadataUpdateRequest, options: OpenADERequestOptions): string {
    const clientRequestId = options.clientRequestId ?? args.clientRequestId ?? ""
    return `${args.taskId}\0${clientRequestId}\0${JSON.stringify(stableJSONValue({ ...args, clientRequestId }))}`
}

function projectFromAcceptedCreate(args: OpenADERepoCreateRequest, result: OpenADERepoCreateResult): OpenADEProject {
    return {
        id: result.repoId,
        name: args.name,
        path: args.path,
        tasks: [],
    }
}

function projectWithAcceptedUpdate(project: OpenADEProject, args: OpenADERepoUpdateRequest): OpenADEProject {
    return {
        ...project,
        name: args.name ?? project.name,
        path: args.path ?? project.path,
        archived: args.archived ?? project.archived,
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRecordWithStringId(value: unknown): value is Record<string, unknown> & { id: string } {
    return isRecord(value) && typeof value.id === "string"
}

function commentFromAcceptedCreate(args: OpenADECommentCreateRequest, result: OpenADECommentCreateResult): Record<string, unknown> {
    return {
        id: result.commentId,
        content: args.content,
        source: args.source,
        selectedText: args.selectedText,
        author: args.author,
        createdAt: result.createdAt,
    }
}

function queuedTurnsWithCancelledTurn(task: OpenADETask, queuedTurnId: string): OpenADETask["queuedTurns"] {
    return task.queuedTurns?.map((turn) => (turn.id === queuedTurnId ? { ...turn, status: "cancelled" } : turn))
}

function queuedTurnsWithAcceptedTurn(task: OpenADETask, turn: OpenADEQueuedTurn): OpenADETask["queuedTurns"] {
    const existing = task.queuedTurns ?? []
    const withoutTurn = existing.filter((candidate) => candidate.id !== turn.id)
    return [...withoutTurn, turn]
}

function queuedTurnsWithReorderedTurns(task: OpenADETask, turns: OpenADEQueuedTurn[]): OpenADETask["queuedTurns"] {
    const reordered = new Map(turns.map((turn) => [turn.id, turn]))
    const remaining = (task.queuedTurns ?? []).filter((turn) => !reordered.has(turn.id))
    return [...turns, ...remaining]
}

function latestCompletedPlanEventId(task?: OpenADETask): string | undefined {
    const events = task?.events ?? []
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index]
        if (!isRecordWithStringId(event) || event.type !== "action" || event.status !== "completed") continue
        const source = isRecord(event.source) ? event.source : null
        if (source?.type === "plan" || source?.type === "revise" || source?.type === "hyperplan") return event.id
    }
    return undefined
}

function actionSourceFromAcceptedTurn(args: OpenADETurnStartRequest, task?: OpenADETask): OpenADEActionEventSource | null {
    const userLabel = args.label ?? args.type
    if (args.type === "plan") return { type: "plan", userLabel }
    if (args.type === "do") return { type: "do", userLabel }
    if (args.type === "ask") return { type: "ask", userLabel }
    if (args.type === "hyperplan") return null

    const planEventId = latestCompletedPlanEventId(task)
    if (args.type === "revise") {
        return planEventId ? { type: "revise", userLabel, parentEventId: planEventId } : { type: "plan", userLabel }
    }
    if (args.type === "run_plan" && planEventId) return { type: "run_plan", userLabel, planEventId }
    return null
}

function reviewUserLabel(reviewType: OpenADEReviewStartRequest["reviewType"]): string {
    return reviewType === "plan" ? "Review Plan" : "Review"
}

type ActionPreviewSourceType = Exclude<NonNullable<OpenADETaskPreview["lastEvent"]>["sourceType"], undefined>

function actionPreviewSourceType(value: unknown): ActionPreviewSourceType | undefined {
    switch (value) {
        case "plan":
        case "revise":
        case "run_plan":
        case "do":
        case "ask":
        case "hyperplan":
        case "review":
            return value
        default:
            return undefined
    }
}

function actionEventFromAcceptedTurn(
    args: OpenADETurnStartRequest,
    result: OpenADETurnStartResult,
    task?: OpenADETask
): (Record<string, unknown> & { id: string }) | null {
    if (!result.eventId || result.queued) return null
    const source = actionSourceFromAcceptedTurn(args, task)
    if (!source) return null
    const createdAt = result.createdAt ?? new Date().toISOString()
    return {
        id: result.eventId,
        type: "action",
        status: "in_progress",
        createdAt,
        userInput: args.input,
        execution: {
            harnessId: args.harnessId ?? "claude-code",
            executionId: result.executionId ?? "",
            modelId: args.modelId,
            fastMode: args.fastMode,
            events: [],
        },
        source,
        includesCommentIds: [],
        images: args.images,
    }
}

function actionEventFromAcceptedReview(args: OpenADEReviewStartRequest, result: OpenADEReviewStartResult): (Record<string, unknown> & { id: string }) | null {
    if (!result.eventId) return null
    const userLabel = reviewUserLabel(args.reviewType)
    const createdAt = result.createdAt ?? new Date().toISOString()
    return {
        id: result.eventId,
        type: "action",
        status: "in_progress",
        createdAt,
        userInput: args.customInstructions ? `${userLabel}: ${args.customInstructions}` : userLabel,
        execution: {
            harnessId: args.harnessId,
            executionId: result.executionId ?? "",
            modelId: args.modelId,
            fastMode: args.fastMode,
            events: [],
        },
        source: {
            type: "review",
            userLabel,
            reviewType: args.reviewType,
            userInstructions: args.customInstructions,
        },
        includesCommentIds: [],
    }
}

function actionPreviewEvent(event: Record<string, unknown> & { id: string }): OpenADETaskPreview["lastEvent"] | null {
    const source = isRecord(event.source) ? event.source : null
    const status = event.status
    const sourceType = actionPreviewSourceType(source?.type)
    if (!source || !sourceType || typeof source.userLabel !== "string") return null
    if (status !== "in_progress" && status !== "completed" && status !== "error" && status !== "stopped") return null
    return {
        type: "action",
        status,
        sourceType,
        sourceLabel: source.userLabel,
        at: typeof event.createdAt === "string" ? event.createdAt : new Date().toISOString(),
    }
}

function setupEnvironmentEventFromAcceptedSetup(
    setupEvent: OpenADETaskEnvironmentSetupRequest["setupEvent"]
): (Record<string, unknown> & { id: string }) | null {
    if (!setupEvent?.eventId) return null
    const createdAt = setupEvent.createdAt ?? setupEvent.completedAt ?? new Date().toISOString()
    return {
        id: setupEvent.eventId,
        type: "setup_environment",
        status: "completed",
        createdAt,
        completedAt: setupEvent.completedAt ?? createdAt,
        userInput: "Environment setup",
        worktreeId: setupEvent.worktreeId,
        deviceId: setupEvent.deviceId,
        workingDir: setupEvent.workingDir,
        setupOutput: setupEvent.setupOutput,
    }
}

function setupEnvironmentPreviewEvent(setupEvent: OpenADETaskEnvironmentSetupRequest["setupEvent"]): OpenADETaskPreview["lastEvent"] | undefined {
    if (!setupEvent) return undefined
    const at = setupEvent.completedAt ?? setupEvent.createdAt
    if (!at) return undefined
    return {
        type: "setup_environment",
        status: "completed",
        sourceLabel: "Setup",
        at,
    }
}

export class OpenADEProductStore {
    snapshot: OpenADESnapshot | null = null
    readonly runtimes = new RuntimeRecordCache()
    private projects: OpenADEProject[] | null = null
    private readonly tasks = new Map<string, OpenADETask>()
    private readonly taskReadModes = new Map<string, TaskCacheReadMode>()
    private readonly taskReadOptions = new Map<string, OpenADETaskReadOptions>()
    private readonly taskNotificationRefreshLoadedAt = new Map<string, number>()
    private snapshotLoadedAt = 0
    private projectListLoadedAt = 0
    private readonly taskLoadedAt = new Map<string, number>()
    private snapshotRequestInFlight: Promise<OpenADESnapshot> | null = null
    private projectListRequestInFlight: Promise<OpenADEProject[]> | null = null
    private readonly taskListRequestsInFlight = new Map<string, Promise<OpenADETaskPreview[]>>()
    private readonly taskRequestsInFlight = new Map<string, Promise<OpenADETask>>()
    private readonly taskMetadataUpdatesInFlight = new Map<string, Promise<void>>()
    private readonly runtimeListCache = new Map<string, CachedRuntimeList>()
    private readonly runtimeListRequestsInFlight = new Map<string, Promise<RuntimeRecord[]>>()
    private runtimeListReadGeneration = 0
    private readonly processListCache = new Map<string, CachedProcessList>()
    private readonly processListRequestsInFlight = new Map<string, Promise<OpenADEProjectProcessListResult>>()
    private readonly cronDefinitionsCache = new Map<string, CachedCronDefinitions>()
    private readonly cronDefinitionsRequestsInFlight = new Map<string, Promise<OpenADECronDefinitionsReadResult>>()
    private readonly cronInstallStateCache = new Map<string, CachedCronInstallState>()
    private readonly cronInstallStateRequestsInFlight = new Map<string, Promise<OpenADECronInstallStateReadResult>>()
    private cronInstallStateListCache: CachedCronInstallStateList | null = null
    private cronInstallStateListRequestInFlight: Promise<OpenADECronInstallStateListResult> | null = null
    private readonly projectFilesTreeCache = new Map<string, CachedProjectFilesTree>()
    private readonly projectFilesTreeRequestsInFlight = new Map<string, Promise<OpenADEProjectFilesTreeResult>>()
    private readonly projectFileReadCache = new Map<string, CachedProjectFileRead>()
    private readonly projectFileReadRequestsInFlight = new Map<string, Promise<OpenADEProjectFileReadResult>>()
    private readonly fuzzySearchCache = new Map<string, CachedFuzzySearch>()
    private readonly fuzzySearchRequestsInFlight = new Map<string, Promise<OpenADEProjectFilesFuzzySearchResult>>()
    private readonly projectSearchCache = new Map<string, CachedProjectSearch>()
    private readonly projectSearchRequestsInFlight = new Map<string, Promise<OpenADEProjectSearchResult>>()
    private readonly sdkCapabilitiesCache = new Map<string, CachedSdkCapabilities>()
    private readonly sdkCapabilitiesRequestsInFlight = new Map<string, Promise<OpenADESdkCapabilities>>()
    private readonly projectGitInfoCache = new Map<string, CachedProjectGitInfo>()
    private readonly projectGitInfoRequestsInFlight = new Map<string, Promise<OpenADEProjectGitInfoResult>>()
    private readonly projectGitBranchesCache = new Map<string, CachedProjectGitBranches>()
    private readonly projectGitBranchesRequestsInFlight = new Map<string, Promise<OpenADEProjectGitBranchesReadResult>>()
    private readonly projectGitSummaryCache = new Map<string, CachedProjectGitSummary>()
    private readonly projectGitSummaryRequestsInFlight = new Map<string, Promise<OpenADEProjectGitSummaryReadResult>>()
    private readonly taskGitSummaryCache = new Map<string, CachedTaskGitSummary>()
    private readonly taskGitSummaryRequestsInFlight = new Map<string, Promise<OpenADETaskGitSummaryResult>>()
    private readonly taskGitScopesCache = new Map<string, CachedTaskGitScopes>()
    private readonly taskGitScopesRequestsInFlight = new Map<string, Promise<OpenADETaskGitScopesReadResult>>()
    private readonly taskGitLogCache = new Map<string, CachedTaskGitLog>()
    private readonly taskGitLogRequestsInFlight = new Map<string, Promise<OpenADETaskGitLogResult>>()
    private readonly taskGitCommitFilesCache = new Map<string, CachedTaskGitCommitFiles>()
    private readonly taskGitCommitFilesRequestsInFlight = new Map<string, Promise<OpenADETaskGitCommitFilesResult>>()
    private readonly taskGitFileAtTreeishCache = new Map<string, CachedTaskGitFileAtTreeish>()
    private readonly taskGitFileAtTreeishRequestsInFlight = new Map<string, Promise<OpenADETaskGitFileAtTreeishResult>>()
    private readonly taskGitCommitFilePatchCache = new Map<string, CachedTaskGitCommitFilePatch>()
    private readonly taskGitCommitFilePatchRequestsInFlight = new Map<string, Promise<OpenADETaskGitCommitFilePatchResult>>()
    private readonly taskChangesCache = new Map<string, CachedTaskChanges>()
    private readonly taskChangesRequestsInFlight = new Map<string, Promise<OpenADETaskChangesReadResult>>()
    private readonly taskDiffCache = new Map<string, CachedTaskDiff>()
    private readonly taskDiffRequestsInFlight = new Map<string, Promise<OpenADETaskDiffReadResult>>()
    private readonly taskFilePairCache = new Map<string, CachedTaskFilePair>()
    private readonly taskFilePairRequestsInFlight = new Map<string, Promise<OpenADETaskFilePairReadResult>>()
    private readonly taskSnapshotPatchCache = new Map<string, CachedTaskSnapshotPatch>()
    private readonly taskSnapshotPatchRequestsInFlight = new Map<string, Promise<OpenADETaskSnapshotPatchReadResult>>()
    private readonly taskSnapshotIndexCache = new Map<string, CachedTaskSnapshotIndex>()
    private readonly taskSnapshotIndexRequestsInFlight = new Map<string, Promise<OpenADETaskSnapshotIndexReadResult>>()
    private readonly taskSnapshotPatchSliceCache = new Map<string, CachedTaskSnapshotPatchSlice>()
    private readonly taskSnapshotPatchSliceRequestsInFlight = new Map<string, Promise<OpenADETaskSnapshotPatchSliceReadResult>>()
    private readonly taskImageCache = new Map<string, CachedTaskImage>()
    private readonly taskImageRequestsInFlight = new Map<string, Promise<OpenADETaskImageReadResult>>()
    private readonly stagedTaskImageCache = new Map<string, CachedStagedTaskImage>()
    private readonly stagedTaskImageRequestsInFlight = new Map<string, Promise<OpenADETaskImageStagedReadResult>>()
    private readonly taskResourceInventoryCache = new Map<string, CachedTaskResourceInventory>()
    private readonly taskResourceInventoryRequestsInFlight = new Map<string, Promise<OpenADETaskResourceInventoryReadResult>>()
    private mcpServersCache: CachedMcpServers | null = null
    private readonly mcpServersRequestsInFlight = new Map<string, Promise<OpenADEMCPServersReadResult>>()
    private personalSettingsCache: CachedPersonalSettings | null = null
    private readonly personalSettingsRequestsInFlight = new Map<string, Promise<OpenADEPersonalSettingsReadResult>>()
    private readonly pendingTaskUpdateNotifications = new Map<string, RuntimeNotification>()
    private readonly taskUpdateNotificationTimers = new Map<string, ReturnType<typeof setTimeout>>()
    private readonly pendingTaskPreviewNotifications = new Map<string, RuntimeNotification>()
    private readonly taskPreviewNotificationTimers = new Map<string, ReturnType<typeof setTimeout>>()
    private readonly taskPreviewNotificationLoadedAt = new Map<string, number>()
    private readonly deferredTaskRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
    private readonly deferredTaskRefreshListeners = new Set<DeferredTaskRefreshListener>()
    private readonly acceptedActionStartNotifications = new Map<string, number>()
    private readonly acceptedMutationNotifications = new Map<string, number>()
    private unsubscribe: (() => void) | null = null

    constructor(
        private readonly client: OpenADEProductClient,
        private readonly legacyYjsImportWriter: OpenADELegacyYjsImportWriter | null = null
    ) {}

    canUseMethod(method: OpenADEMethod): boolean {
        return this.client.hasMethod(method)
    }

    async canUseMethodAfterConnect(method: OpenADEMethod): Promise<boolean> {
        if (this.client.hasMethod(method)) return true
        try {
            await this.client.ensureMethodAvailable(method)
            return true
        } catch (error) {
            if (isOpenADEMethodUnavailableError(error, method)) return false
            throw error
        }
    }

    private async canUseRuntimeMethodAfterConnect(method: string): Promise<boolean> {
        if (this.client.hasRuntimeMethod(method)) return true
        try {
            await this.client.ensureRuntimeMethodAvailable(method)
            return true
        } catch (error) {
            if (isRuntimeMethodUnavailableError(error, method)) return false
            throw error
        }
    }

    private async ensureCanUseMethod(method: OpenADEMethod): Promise<void> {
        await this.client.ensureMethodAvailable(method)
    }

    getCachedTask(repoId: string, taskId: string): OpenADETask | null {
        return this.tasks.get(taskKey(repoId, taskId)) ?? null
    }

    getCachedLightweightTask(repoId: string, taskId: string): OpenADETask | null {
        const key = taskKey(repoId, taskId)
        return this.taskReadModes.get(key) === "lightweight" ? (this.tasks.get(key) ?? null) : null
    }

    onDeferredTaskRefresh(listener: DeferredTaskRefreshListener): () => void {
        this.deferredTaskRefreshListeners.add(listener)
        return () => this.deferredTaskRefreshListeners.delete(listener)
    }

    getCachedProjects(): OpenADEProject[] | null {
        return this.projects
    }

    private hasProjectProjectionForRepo(repoId: string): boolean {
        return Boolean(this.snapshot?.repos.some((repo) => repo.id === repoId) || this.projects?.some((repo) => repo.id === repoId))
    }

    private hasProjectProjection(): boolean {
        return this.snapshot !== null || this.projects !== null
    }

    private hasCachedTask(repoId: string, taskId: string): boolean {
        return this.tasks.has(taskKey(repoId, taskId))
    }

    async refreshSnapshot(options: OpenADEProductReadOptions = {}): Promise<OpenADESnapshot> {
        await this.ensureCanUseMethod(OPENADE_METHOD.snapshotRead)
        if (!options.bypassCache && this.snapshot && Date.now() - this.snapshotLoadedAt < SNAPSHOT_CACHE_TTL_MS) return this.snapshot

        if (this.snapshotRequestInFlight) return this.snapshotRequestInFlight

        const request = this.client
            .getSnapshot()
            .then((snapshot) => {
                this.snapshot = snapshot
                this.snapshotLoadedAt = Date.now()
                this.projects = snapshot.repos
                this.projectListLoadedAt = this.snapshotLoadedAt
                return snapshot
            })
            .finally(() => {
                if (this.snapshotRequestInFlight === request) this.snapshotRequestInFlight = null
            })
        this.snapshotRequestInFlight = request
        return request
    }

    async listProjects(options: OpenADEProductReadOptions = {}): Promise<OpenADEProject[]> {
        await this.ensureCanUseMethod(OPENADE_METHOD.projectList)
        if (!options.bypassCache && this.projects && Date.now() - this.projectListLoadedAt < PROJECT_LIST_CACHE_TTL_MS) return this.projects

        if (this.projectListRequestInFlight) return this.projectListRequestInFlight

        const request = this.client
            .listProjects()
            .then((projects) => {
                this.projects = projects
                this.projectListLoadedAt = Date.now()
                return projects
            })
            .finally(() => {
                if (this.projectListRequestInFlight === request) this.projectListRequestInFlight = null
            })
        this.projectListRequestInFlight = request
        return request
    }

    async listTasks(repoId: string, options: OpenADEProductReadOptions = {}): Promise<OpenADETaskPreview[]> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskList)
        const cachedProject = this.projects?.find((repo) => repo.id === repoId)
        if (!options.bypassCache && cachedProject && Date.now() - this.projectListLoadedAt < PROJECT_LIST_CACHE_TTL_MS) return cachedProject.tasks

        return coalescedRead(
            this.taskListRequestsInFlight,
            repoId,
            () => this.client.listTasks(repoId),
            (tasks) => {
                this.applyTaskList(repoId, tasks)
            }
        )
    }

    private async refreshProjectProjection(options: OpenADEProductReadOptions = {}): Promise<void> {
        if (this.snapshot) {
            try {
                const repos = await this.listProjects(options)
                this.snapshot = {
                    ...this.snapshot,
                    repos,
                }
                this.snapshotLoadedAt = Date.now()
            } catch (error) {
                if (!canFallbackProjectListToSnapshot(error)) throw error
                await this.refreshSnapshot(options)
            }
            return
        }
        await this.listProjects(options)
    }

    private async refreshTaskListProjection(repoId: string, options: OpenADEProductReadOptions = {}): Promise<void> {
        await this.listTasks(repoId, options)
    }

    private async refreshTaskListProjectionOrSnapshot(repoId: string, options: OpenADEProductReadOptions = {}): Promise<void> {
        try {
            await this.refreshTaskListProjection(repoId, options)
        } catch (error) {
            if (!canFallbackProjectListToSnapshot(error)) throw error
            await this.refreshSnapshot(options)
        }
    }

    private clearRuntimeListReads(): void {
        this.runtimeListCache.clear()
        this.runtimeListRequestsInFlight.clear()
        this.runtimeListReadGeneration += 1
    }

    async listRuntimes(args: RuntimeListParams = {}): Promise<RuntimeRecord[]> {
        if (!(await this.canUseRuntimeMethodAfterConnect(RUNTIME_LIST_METHOD))) return []

        const key = stableRuntimeListCacheKey(args)
        const cached = this.runtimeListCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const readGeneration = this.runtimeListReadGeneration
        return coalescedRead(
            this.runtimeListRequestsInFlight,
            key,
            async () => {
                const runtimes = await this.client.listRuntimes(args)
                const target = readGeneration === this.runtimeListReadGeneration ? this.runtimes : new RuntimeRecordCache()
                target.replace(runtimes, args)
                return target.list(args)
            },
            (result) => {
                if (readGeneration !== this.runtimeListReadGeneration) return
                this.runtimeListCache.set(key, {
                    result,
                    expiresAt: Date.now() + RUNTIME_LIST_CACHE_TTL_MS,
                })
            }
        )
    }

    async getTask(
        repoId: string,
        taskId: string,
        options: OpenADETaskReadOptions = LIGHTWEIGHT_TASK_READ_OPTIONS,
        readOptions: OpenADEProductReadOptions = {}
    ): Promise<OpenADETask> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskRead)
        const key = taskKey(repoId, taskId)
        const limitedLightweightRead = isLimitedLightweightTaskRead(options)
        if (options.hydrateSessionEvents !== true && !limitedLightweightRead && !readOptions.bypassCache) {
            const loadedAt = this.taskLoadedAt.get(key) ?? 0
            const cached = this.getCachedLightweightTask(repoId, taskId)
            if (cached && Date.now() - loadedAt < LIGHTWEIGHT_TASK_CACHE_TTL_MS) return cached
        }

        const requestKey = `${key}\0${taskReadOptionsKey(options)}`
        return coalescedRead(
            this.taskRequestsInFlight,
            requestKey,
            () => this.client.getTask(repoId, taskId, options),
            (task) => {
                this.tasks.set(key, task)
                if (options.hydrateSessionEvents === true) {
                    this.taskLoadedAt.delete(key)
                    this.taskNotificationRefreshLoadedAt.delete(key)
                    this.taskReadModes.set(key, "hydrated")
                    this.taskReadOptions.delete(key)
                } else {
                    this.taskNotificationRefreshLoadedAt.set(key, Date.now())
                    if (limitedLightweightRead) {
                        this.taskLoadedAt.delete(key)
                    } else {
                        this.taskLoadedAt.set(key, Date.now())
                    }
                    this.taskReadModes.set(key, "lightweight")
                    this.taskReadOptions.set(key, cachedTaskReadOptions(options))
                }
                this.cancelDeferredTaskRefresh(repoId, taskId)
                if (task.preview) this.applyTaskPreview(repoId, task.preview)
            }
        )
    }

    async refreshTask(repoId: string, taskId: string, options: OpenADETaskReadOptions = LIGHTWEIGHT_TASK_READ_OPTIONS): Promise<OpenADETask> {
        return this.getTask(repoId, taskId, options, { bypassCache: true })
    }

    async listProjectFiles(args: OpenADEProjectFilesTreeRequest): Promise<OpenADEProjectFilesTreeResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.projectFilesTree)
        const key = stableProjectReadCacheKey("tree", args)
        const cached = this.projectFilesTreeCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.projectFilesTreeRequestsInFlight,
            key,
            () => this.client.listProjectFiles(args),
            (result) => {
                this.projectFilesTreeCache.set(key, {
                    result,
                    expiresAt: Date.now() + PROJECT_FILE_CACHE_TTL_MS,
                })
            }
        )
    }

    async readProjectFile(args: OpenADEProjectFileReadRequest): Promise<OpenADEProjectFileReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.projectFileRead)
        const key = stableProjectReadCacheKey("file", args)
        const cached = this.projectFileReadCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.projectFileReadRequestsInFlight,
            key,
            () => this.client.readProjectFile(args),
            (result) => {
                this.projectFileReadCache.set(key, {
                    result,
                    expiresAt: Date.now() + PROJECT_FILE_CACHE_TTL_MS,
                })
            }
        )
    }

    async fuzzySearchProjectFiles(args: OpenADEProjectFilesFuzzySearchRequest): Promise<OpenADEProjectFilesFuzzySearchResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.projectFilesFuzzySearch)
        const key = stableFuzzySearchCacheKey(args)
        const cached = this.fuzzySearchCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.fuzzySearchRequestsInFlight,
            key,
            () => this.client.fuzzySearchProjectFiles(args),
            (result) => {
                this.fuzzySearchCache.set(key, {
                    result,
                    expiresAt: Date.now() + PROJECT_SEARCH_CACHE_TTL_MS,
                })
            }
        )
    }

    async writeProjectFile(args: OpenADEProjectFileWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectFileWriteResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.projectFileWrite)
        const result = await this.client.writeProjectFile(args, options)
        this.clearProjectReadCachesForScope(args.repoId, args.taskId)
        this.clearGitSummaryCacheForScope(args.repoId, args.taskId)
        if (isOpenADETomlPath(args.path)) this.clearProcessListCacheForScope(args.repoId, args.taskId)
        return result
    }

    async searchProject(args: OpenADEProjectSearchRequest): Promise<OpenADEProjectSearchResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.projectSearch)
        const key = stableProjectReadCacheKey("content", args)
        const cached = this.projectSearchCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.projectSearchRequestsInFlight,
            key,
            () => this.client.searchProject(args),
            (result) => {
                this.projectSearchCache.set(key, {
                    result,
                    expiresAt: Date.now() + PROJECT_SEARCH_CACHE_TTL_MS,
                })
            }
        )
    }

    async readProjectSdkCapabilities(args: OpenADEProjectSdkCapabilitiesReadRequest): Promise<OpenADESdkCapabilities> {
        await this.ensureCanUseMethod(OPENADE_METHOD.projectSdkCapabilitiesRead)
        const key = stableProjectReadCacheKey("sdkCapabilities", args)
        const cached = this.sdkCapabilitiesCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.sdkCapabilitiesRequestsInFlight,
            key,
            () => this.client.readProjectSdkCapabilities(args),
            (result) => {
                this.sdkCapabilitiesCache.set(key, {
                    result,
                    expiresAt: Date.now() + SDK_CAPABILITIES_CACHE_TTL_MS,
                })
            }
        )
    }

    async readProjectGitInfo(args: OpenADEProjectGitInfoRequest): Promise<OpenADEProjectGitInfoResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.projectGitInfoRead)
        const cached = this.projectGitInfoCache.get(args.repoId)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.projectGitInfoRequestsInFlight,
            args.repoId,
            () => this.client.readProjectGitInfo(args),
            (result) => {
                this.projectGitInfoCache.set(args.repoId, {
                    result,
                    expiresAt: Date.now() + PROJECT_GIT_INFO_CACHE_TTL_MS,
                })
            }
        )
    }

    async readProjectGitBranches(args: OpenADEProjectGitBranchesReadRequest): Promise<OpenADEProjectGitBranchesReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.projectGitBranchesRead)
        const key = projectGitBranchesCacheKey(args)
        const cached = this.projectGitBranchesCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.projectGitBranchesRequestsInFlight,
            key,
            () => this.client.readProjectGitBranches(args),
            (result) => {
                this.projectGitBranchesCache.set(key, {
                    result,
                    expiresAt: Date.now() + PROJECT_GIT_BRANCHES_CACHE_TTL_MS,
                })
            }
        )
    }

    async readProjectGitSummary(
        args: OpenADEProjectGitSummaryReadRequest,
        options: OpenADEProductReadOptions = {}
    ): Promise<OpenADEProjectGitSummaryReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.projectGitSummaryRead)
        const cached = this.projectGitSummaryCache.get(args.repoId)
        if (!options.bypassCache && cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.projectGitSummaryRequestsInFlight,
            args.repoId,
            () => this.client.readProjectGitSummary(args),
            (result) => {
                this.projectGitSummaryCache.set(args.repoId, {
                    result,
                    expiresAt: Date.now() + GIT_SUMMARY_CACHE_TTL_MS,
                })
            }
        )
    }

    async listProjectProcesses(args: OpenADEProjectProcessListRequest, options: OpenADEProductReadOptions = {}): Promise<OpenADEProjectProcessListResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.projectProcessList)
        const key = processListCacheKey(args.repoId, args.taskId)
        const cached = this.processListCache.get(key)
        if (!options.bypassCache && cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.processListRequestsInFlight,
            key,
            () => this.client.listProjectProcesses(args),
            (result) => {
                this.processListCache.set(key, {
                    result,
                    expiresAt: Date.now() + PROCESS_LIST_CACHE_TTL_MS,
                })
                this.cacheCronDefinitionsFromProcessList(key, result)
            }
        )
    }

    async readCronDefinitions(args: OpenADECronDefinitionsReadRequest): Promise<OpenADECronDefinitionsReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.cronDefinitionsRead)
        const key = processListCacheKey(args.repoId, args.taskId)
        const cached = this.cronDefinitionsCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result
        const processListCached = this.processListCache.get(key)
        if (processListCached && processListCached.expiresAt > Date.now()) {
            const derived = this.cacheCronDefinitionsFromProcessList(key, processListCached.result)
            if (derived) return derived
        }

        const processListInFlight = this.processListRequestsInFlight.get(key)
        if (processListInFlight) {
            try {
                const processListResult = await processListInFlight
                const derived = this.cacheCronDefinitionsFromProcessList(key, processListResult)
                if (derived) return derived
            } catch {
                // Fall through to the narrower cron endpoint; the process list caller owns its error.
            }
        }

        return coalescedRead(
            this.cronDefinitionsRequestsInFlight,
            key,
            () => this.client.readCronDefinitions(args),
            (result) => {
                this.cronDefinitionsCache.set(key, {
                    result,
                    expiresAt: Date.now() + PROCESS_LIST_CACHE_TTL_MS,
                })
            }
        )
    }

    private cacheCronDefinitionsFromProcessList(key: string, processList: OpenADEProjectProcessListResult): OpenADECronDefinitionsReadResult | null {
        const result = cronDefinitionsFromProcessList(processList)
        if (!result) return null
        this.cronDefinitionsCache.set(key, {
            result,
            expiresAt: Date.now() + PROCESS_LIST_CACHE_TTL_MS,
        })
        return result
    }

    async startProjectProcess(args: OpenADEProjectProcessStartRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectProcessStartResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.projectProcessStart)
        const result = await this.client.startProjectProcess(args, options)
        this.clearRuntimeListReads()
        this.applyAcceptedProjectProcessStarted(args, result)
        return result
    }

    async reconnectProjectProcess(args: OpenADEProjectProcessReconnectRequest): Promise<OpenADEProjectProcessReconnectResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.projectProcessReconnect)
        return this.client.reconnectProjectProcess(args)
    }

    async stopProjectProcess(args: OpenADEProjectProcessStopRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectProcessStopResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.projectProcessStop)
        const result = await this.client.stopProjectProcess(args, options)
        this.clearRuntimeListReads()
        this.applyAcceptedProjectProcessStopped(args, result)
        return result
    }

    async readCronInstallState(args: OpenADECronInstallStateReadRequest): Promise<OpenADECronInstallStateReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.cronInstallStateRead)
        const cached = this.cronInstallStateCache.get(args.repoId)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.cronInstallStateRequestsInFlight,
            args.repoId,
            () => this.client.readCronInstallState(args),
            (result) => {
                this.cronInstallStateCache.set(args.repoId, {
                    result,
                    expiresAt: Date.now() + CRON_INSTALL_STATE_CACHE_TTL_MS,
                })
            }
        )
    }

    async listCronInstallStateRepos(): Promise<OpenADECronInstallStateListResult | null> {
        if (!this.canUseMethod(OPENADE_METHOD.cronInstallStateList)) return null
        await this.ensureCanUseMethod(OPENADE_METHOD.cronInstallStateList)
        if (this.cronInstallStateListCache && this.cronInstallStateListCache.expiresAt > Date.now()) {
            return this.cronInstallStateListCache.result
        }
        if (this.cronInstallStateListRequestInFlight) return this.cronInstallStateListRequestInFlight

        const request = this.client
            .listCronInstallStateRepos()
            .then((result) => {
                this.cronInstallStateListCache = {
                    result,
                    expiresAt: Date.now() + CRON_INSTALL_STATE_CACHE_TTL_MS,
                }
                return result
            })
            .finally(() => {
                if (this.cronInstallStateListRequestInFlight === request) this.cronInstallStateListRequestInFlight = null
            })
        this.cronInstallStateListRequestInFlight = request
        return request
    }

    async replaceCronInstallState(
        args: OpenADECronInstallStateReplaceRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADECronInstallStateReplaceResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.cronInstallStateReplace)
        this.cronInstallStateRequestsInFlight.delete(args.repoId)
        const result = await this.client.replaceCronInstallState(args, options)
        this.cronInstallStateListCache = null
        this.cronInstallStateListRequestInFlight = null
        this.cronInstallStateCache.set(args.repoId, {
            result,
            expiresAt: Date.now() + CRON_INSTALL_STATE_CACHE_TTL_MS,
        })
        return result
    }

    async runCron(args: OpenADECronRunRequest, options: OpenADERequestOptions = {}): Promise<OpenADECronRunResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.cronRun)
        this.cronInstallStateRequestsInFlight.delete(args.repoId)
        const result = await this.client.runCron(args, options)
        if (result.installation) {
            this.cronInstallStateListCache = null
            this.cronInstallStateListRequestInFlight = null
            const cached = this.cronInstallStateCache.get(result.repoId)
            const installations = {
                ...(cached?.result.installations ?? {}),
                [result.cronId]: result.installation,
            }
            this.cronInstallStateCache.set(result.repoId, {
                result: {
                    repoId: result.repoId,
                    installations,
                },
                expiresAt: Date.now() + CRON_INSTALL_STATE_CACHE_TTL_MS,
            })
        }
        return result
    }

    async readTaskChanges(args: OpenADETaskChangesReadRequest): Promise<OpenADETaskChangesReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskChangesRead)
        const key = stableTaskGitReadCacheKey("changes", args)
        const cached = this.taskChangesCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.taskChangesRequestsInFlight,
            key,
            () => this.client.readTaskChanges(args),
            (result) => {
                this.taskChangesCache.set(key, {
                    result,
                    expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
                })
            }
        )
    }

    async readTaskGitSummary(args: OpenADETaskGitSummaryRequest, options: OpenADEProductReadOptions = {}): Promise<OpenADETaskGitSummaryResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskGitSummaryRead)
        const key = taskKey(args.repoId, args.taskId)
        const cached = this.taskGitSummaryCache.get(key)
        if (!options.bypassCache && cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.taskGitSummaryRequestsInFlight,
            key,
            () => this.client.readTaskGitSummary(args),
            (result) => {
                this.taskGitSummaryCache.set(key, {
                    result,
                    expiresAt: Date.now() + GIT_SUMMARY_CACHE_TTL_MS,
                })
            }
        )
    }

    async readTaskGitScopes(args: OpenADETaskGitScopesReadRequest): Promise<OpenADETaskGitScopesReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskGitScopesRead)
        const key = stableTaskGitReadCacheKey("scopes", args)
        const cached = this.taskGitScopesCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.taskGitScopesRequestsInFlight,
            key,
            () => this.client.readTaskGitScopes(args),
            (result) => {
                this.taskGitScopesCache.set(key, {
                    result,
                    expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
                })
            }
        )
    }

    async readTaskDiff(args: OpenADETaskDiffReadRequest): Promise<OpenADETaskDiffReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskDiffRead)
        const key = stableTaskGitReadCacheKey("diff", args)
        const cached = this.taskDiffCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.taskDiffRequestsInFlight,
            key,
            () => this.client.readTaskDiff(args),
            (result) => {
                this.taskDiffCache.set(key, {
                    result,
                    expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
                })
            }
        )
    }

    async readTaskFilePair(args: OpenADETaskFilePairReadRequest): Promise<OpenADETaskFilePairReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskFilePairRead)
        const key = stableTaskGitReadCacheKey("filePair", args)
        const cached = this.taskFilePairCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.taskFilePairRequestsInFlight,
            key,
            () => this.client.readTaskFilePair(args),
            (result) => {
                this.taskFilePairCache.set(key, {
                    result,
                    expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
                })
            }
        )
    }

    async readTaskGitLog(args: OpenADETaskGitLogRequest): Promise<OpenADETaskGitLogResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskGitLog)
        const key = stableTaskGitReadCacheKey("log", args)
        const cached = this.taskGitLogCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.taskGitLogRequestsInFlight,
            key,
            () => this.client.readTaskGitLog(args),
            (result) => {
                this.taskGitLogCache.set(key, {
                    result,
                    expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
                })
            }
        )
    }

    async readTaskGitCommitFiles(args: OpenADETaskGitCommitFilesRequest): Promise<OpenADETaskGitCommitFilesResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskGitCommitFilesRead)
        const key = stableTaskGitReadCacheKey("commitFiles", args)
        const cached = this.taskGitCommitFilesCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.taskGitCommitFilesRequestsInFlight,
            key,
            () => this.client.readTaskGitCommitFiles(args),
            (result) => {
                this.taskGitCommitFilesCache.set(key, {
                    result,
                    expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
                })
            }
        )
    }

    async readTaskGitFileAtTreeish(args: OpenADETaskGitFileAtTreeishRequest): Promise<OpenADETaskGitFileAtTreeishResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskGitFileAtTreeishRead)
        const key = stableTaskGitReadCacheKey("fileAtTreeish", args)
        const cached = this.taskGitFileAtTreeishCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.taskGitFileAtTreeishRequestsInFlight,
            key,
            () => this.client.readTaskGitFileAtTreeish(args),
            (result) => {
                this.taskGitFileAtTreeishCache.set(key, {
                    result,
                    expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
                })
            }
        )
    }

    async readTaskGitCommitFilePatch(args: OpenADETaskGitCommitFilePatchRequest): Promise<OpenADETaskGitCommitFilePatchResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskGitCommitFilePatchRead)
        const key = stableTaskGitReadCacheKey("commitFilePatch", args)
        const cached = this.taskGitCommitFilePatchCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.taskGitCommitFilePatchRequestsInFlight,
            key,
            () => this.client.readTaskGitCommitFilePatch(args),
            (result) => {
                this.taskGitCommitFilePatchCache.set(key, {
                    result,
                    expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
                })
            }
        )
    }

    async commitTaskGit(args: OpenADETaskGitCommitRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskGitCommitResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskGitCommit)
        this.clearGitSummaryCacheForScope(args.repoId, args.taskId)
        const result = await this.client.commitTaskGit(args, options)
        this.clearGitSummaryCacheForScope(args.repoId, args.taskId)
        return result
    }

    async startTaskTerminal(args: OpenADETaskTerminalStartRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalStartResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskTerminalStart)
        const result = await this.client.startTaskTerminal(args, options)
        this.clearRuntimeListReads()
        return result
    }

    async reconnectTaskTerminal(args: OpenADETaskTerminalReconnectRequest): Promise<OpenADETaskTerminalReconnectResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskTerminalReconnect)
        return this.client.reconnectTaskTerminal(args)
    }

    async writeTaskTerminal(args: OpenADETaskTerminalWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskTerminalWrite)
        return this.client.writeTaskTerminal(args, options)
    }

    async resizeTaskTerminal(args: OpenADETaskTerminalResizeRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskTerminalResize)
        return this.client.resizeTaskTerminal(args, options)
    }

    async stopTaskTerminal(args: OpenADETaskTerminalStopRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalMutationResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskTerminalStop)
        const result = await this.client.stopTaskTerminal(args, options)
        this.clearRuntimeListReads()
        return result
    }

    async importLegacyResources(args: OpenADELegacyResourcesImportRequest, options: OpenADERequestOptions = {}): Promise<OpenADELegacyResourcesImportResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.importLegacyResources)
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
        await this.ensureCanUseMethod(OPENADE_METHOD.taskImageRead)
        const key = taskImageCacheKey(args)
        const cached = this.taskImageCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.taskImageRequestsInFlight,
            key,
            () => this.client.readTaskImage(args),
            (result) => {
                this.taskImageCache.set(key, {
                    result,
                    expiresAt: Date.now() + TASK_IMAGE_CACHE_TTL_MS,
                })
            }
        )
    }

    async readStagedTaskImage(args: OpenADETaskImageStagedReadRequest): Promise<OpenADETaskImageStagedReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskImageStagedRead)
        const key = stagedTaskImageCacheKey(args)
        const cached = this.stagedTaskImageCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.stagedTaskImageRequestsInFlight,
            key,
            () => this.client.readStagedTaskImage(args),
            (result) => {
                this.stagedTaskImageCache.set(key, {
                    result,
                    expiresAt: Date.now() + TASK_IMAGE_CACHE_TTL_MS,
                })
            }
        )
    }

    async writeTaskImage(args: OpenADETaskImageWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskImageWriteResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskImageWrite)
        const stagedKey = stagedTaskImageCacheKey(args)
        this.stagedTaskImageCache.delete(stagedKey)
        this.stagedTaskImageRequestsInFlight.delete(stagedKey)
        const result = await this.client.writeTaskImage(args, options)
        this.stagedTaskImageCache.set(stagedKey, {
            result: {
                imageId: result.imageId,
                ext: result.ext,
                mediaType: result.mediaType,
                data: args.data,
            },
            expiresAt: Date.now() + TASK_IMAGE_CACHE_TTL_MS,
        })
        return result
    }

    async readTaskResourceInventory(args: OpenADETaskResourceInventoryReadRequest): Promise<OpenADETaskResourceInventoryReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskResourceInventoryRead)
        const key = taskKey(args.repoId, args.taskId)
        const cached = this.taskResourceInventoryCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.taskResourceInventoryRequestsInFlight,
            key,
            () => this.client.readTaskResourceInventory(args),
            (result) => {
                this.taskResourceInventoryCache.set(key, {
                    result,
                    expiresAt: Date.now() + TASK_RESOURCE_INVENTORY_CACHE_TTL_MS,
                })
            }
        )
    }

    async readMcpServers(): Promise<OpenADEMCPServersReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.settingsMcpServersRead)
        if (this.mcpServersCache && this.mcpServersCache.expiresAt > Date.now()) return this.mcpServersCache.result

        return coalescedRead(
            this.mcpServersRequestsInFlight,
            "mcpServers",
            () => this.client.readMcpServers(),
            (result) => {
                this.mcpServersCache = {
                    result,
                    expiresAt: Date.now() + PRODUCT_SETTINGS_CACHE_TTL_MS,
                }
            }
        )
    }

    async replaceMcpServers(args: OpenADEMCPServersReplaceRequest, options: OpenADERequestOptions = {}): Promise<OpenADEMCPServersReplaceResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.settingsMcpServersReplace)
        this.mcpServersCache = null
        this.mcpServersRequestsInFlight.delete("mcpServers")
        const result = await this.client.replaceMcpServers(args, options)
        this.mcpServersCache = {
            result: { servers: result.servers },
            expiresAt: Date.now() + PRODUCT_SETTINGS_CACHE_TTL_MS,
        }
        return result
    }

    async upsertMcpServer(args: OpenADEMCPServerUpsertRequest, options: OpenADERequestOptions = {}): Promise<OpenADEMCPServerUpsertResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.settingsMcpServersUpsert)
        const previous = this.mcpServersCache?.result
        this.mcpServersCache = null
        this.mcpServersRequestsInFlight.delete("mcpServers")
        const result = await this.client.upsertMcpServer(args, options)
        if (previous) {
            const exists = previous.servers.some((server) => server.id === result.server.id)
            this.mcpServersCache = {
                result: {
                    servers: exists
                        ? previous.servers.map((server) => (server.id === result.server.id ? result.server : server))
                        : [...previous.servers, result.server],
                },
                expiresAt: Date.now() + PRODUCT_SETTINGS_CACHE_TTL_MS,
            }
        }
        return result
    }

    async deleteMcpServer(args: OpenADEMCPServerDeleteRequest, options: OpenADERequestOptions = {}): Promise<OpenADEMCPServerDeleteResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.settingsMcpServersDelete)
        const previous = this.mcpServersCache?.result
        this.mcpServersCache = null
        this.mcpServersRequestsInFlight.delete("mcpServers")
        const result = await this.client.deleteMcpServer(args, options)
        if (previous) {
            this.mcpServersCache = {
                result: {
                    servers: result.deleted ? previous.servers.filter((server) => server.id !== result.serverId) : previous.servers,
                },
                expiresAt: Date.now() + PRODUCT_SETTINGS_CACHE_TTL_MS,
            }
        }
        return result
    }

    async readPersonalSettings(): Promise<OpenADEPersonalSettingsReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.settingsPersonalRead)
        if (this.personalSettingsCache && this.personalSettingsCache.expiresAt > Date.now()) return this.personalSettingsCache.result

        return coalescedRead(
            this.personalSettingsRequestsInFlight,
            "personalSettings",
            () => this.client.readPersonalSettings(),
            (result) => {
                this.personalSettingsCache = {
                    result,
                    expiresAt: Date.now() + PRODUCT_SETTINGS_CACHE_TTL_MS,
                }
            }
        )
    }

    async replacePersonalSettings(
        args: OpenADEPersonalSettingsReplaceRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEPersonalSettingsReplaceResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.settingsPersonalReplace)
        this.personalSettingsCache = null
        this.personalSettingsRequestsInFlight.delete("personalSettings")
        const result = await this.client.replacePersonalSettings(args, options)
        this.personalSettingsCache = {
            result: { settings: result.settings },
            expiresAt: Date.now() + PRODUCT_SETTINGS_CACHE_TTL_MS,
        }
        return result
    }

    async generateTaskTitle(args: OpenADETaskTitleGenerateRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTitleGenerateResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskTitleGenerate)
        const result = await this.client.generateTaskTitle(args, options)
        this.clearTaskResourceInventoryCachesForScope(args.repoId, args.taskId)
        this.applyTaskMetadataUpdate({
            taskId: result.taskId,
            title: result.title,
        })
        return result
    }

    async readTaskSnapshotPatch(args: OpenADETaskSnapshotPatchReadRequest): Promise<OpenADETaskSnapshotPatchReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskSnapshotPatchRead)
        const key = taskSnapshotArtifactCacheKey("patch", args)
        const cached = this.taskSnapshotPatchCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.taskSnapshotPatchRequestsInFlight,
            key,
            () => this.client.readTaskSnapshotPatch(args),
            (result) => {
                this.taskSnapshotPatchCache.set(key, {
                    result,
                    expiresAt: Date.now() + TASK_SNAPSHOT_ARTIFACT_CACHE_TTL_MS,
                })
            }
        )
    }

    async readTaskSnapshotIndex(args: OpenADETaskSnapshotIndexReadRequest): Promise<OpenADETaskSnapshotIndexReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskSnapshotIndexRead)
        const key = taskSnapshotArtifactCacheKey("index", args)
        const cached = this.taskSnapshotIndexCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.taskSnapshotIndexRequestsInFlight,
            key,
            () => this.client.readTaskSnapshotIndex(args),
            (result) => {
                this.taskSnapshotIndexCache.set(key, {
                    result,
                    expiresAt: Date.now() + TASK_SNAPSHOT_ARTIFACT_CACHE_TTL_MS,
                })
            }
        )
    }

    async readTaskSnapshotPatchSlice(args: OpenADETaskSnapshotPatchSliceReadRequest): Promise<OpenADETaskSnapshotPatchSliceReadResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskSnapshotPatchReadSlice)
        const key = taskSnapshotArtifactCacheKey("slice", args)
        const cached = this.taskSnapshotPatchSliceCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        return coalescedRead(
            this.taskSnapshotPatchSliceRequestsInFlight,
            key,
            () => this.client.readTaskSnapshotPatchSlice(args),
            (result) => {
                this.taskSnapshotPatchSliceCache.set(key, {
                    result,
                    expiresAt: Date.now() + TASK_SNAPSHOT_ARTIFACT_CACHE_TTL_MS,
                })
            }
        )
    }

    async createRepo(args: OpenADERepoCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADERepoCreateResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.repoCreate)
        const result = await this.client.createRepo(args, options)
        this.applyRepoCreated(args, result)
        return result
    }

    async inspectRepoPath(args: OpenADERepoPathInspectRequest): Promise<OpenADERepoPathInspectResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.repoPathInspect)
        return this.client.inspectRepoPath(args)
    }

    async createTask(args: OpenADETaskCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskCreateResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskCreate)
        const result = await this.client.createTask(args, options)
        this.applyPlainTaskCreated(args, result)
        return result
    }

    async updateRepo(args: OpenADERepoUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.ensureCanUseMethod(OPENADE_METHOD.repoUpdate)
        this.clearProjectGitMetadataCaches(args.repoId)
        this.clearGitSummaryCacheForScope(args.repoId)
        await this.client.updateRepo(args, options)
        this.clearProjectGitMetadataCaches(args.repoId)
        this.clearGitSummaryCacheForScope(args.repoId)
        this.applyRepoUpdated(args)
    }

    async deleteRepo(args: OpenADERepoDeleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.ensureCanUseMethod(OPENADE_METHOD.repoDelete)
        this.clearProjectGitMetadataCaches(args.repoId)
        this.clearGitSummaryCacheForScope(args.repoId)
        await this.client.deleteRepo(args, options)
        this.clearProjectGitMetadataCaches(args.repoId)
        this.clearGitSummaryCacheForScope(args.repoId)
        this.applyRepoDeleted(args.repoId)
    }

    async startTurn(args: OpenADETurnStartRequest, options: OpenADETurnStartOptions = {}): Promise<OpenADETurnStartResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.turnStart)
        const result = await this.client.startTurn(args, options)
        this.clearRuntimeListReads()
        const acceptedTaskId = result.taskId || args.inTaskId || undefined
        this.clearGitSummaryCacheForScope(args.repoId, acceptedTaskId)
        if (acceptedTaskId) this.clearTaskResourceInventoryCachesForScope(args.repoId, acceptedTaskId)
        if (!args.inTaskId && result.task && result.preview) {
            this.applyAcceptedTaskCreated(args.repoId, result.task, result.preview)
            if (result.eventId) {
                this.trackAcceptedActionStartNotification(args.repoId, result.task.id, result.eventId)
                this.cancelPendingAcceptedTaskCreationNotification(args.repoId, result.task.id, result.eventId)
            }
            return result
        }
        if (args.inTaskId && result.taskId) {
            if (result.eventId) {
                this.trackAcceptedActionStartNotification(args.repoId, result.taskId, result.eventId)
                this.cancelPendingAcceptedActionStartNotification(args.repoId, result.taskId, result.eventId)
            }
            const event = actionEventFromAcceptedTurn(args, result, this.getCachedTask(args.repoId, result.taskId) ?? undefined)
            if (event) {
                this.applyAcceptedActionStarted(args.repoId, result.taskId, event)
                return result
            }
        }
        const taskIdToRefresh = result.taskId ?? args.inTaskId
        if (args.inTaskId && taskIdToRefresh && !this.hasProjectProjectionForRepo(args.repoId)) {
            await this.refreshTask(args.repoId, taskIdToRefresh, NOTIFICATION_LIGHTWEIGHT_TASK_READ_OPTIONS)
            return result
        }

        await Promise.all([
            this.refreshTaskListProjectionOrSnapshot(args.repoId, { bypassCache: true }),
            taskIdToRefresh ? this.refreshTask(args.repoId, taskIdToRefresh, NOTIFICATION_LIGHTWEIGHT_TASK_READ_OPTIONS) : Promise.resolve(),
        ])
        return result
    }

    async startReview(args: OpenADEReviewStartRequest, options: OpenADETurnStartOptions = {}): Promise<OpenADEReviewStartResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.reviewStart)
        const result = await this.client.startReview(args, options)
        this.clearRuntimeListReads()
        this.clearTaskResourceInventoryCachesForScope(args.repoId, result.taskId)
        const event = actionEventFromAcceptedReview(args, result)
        if (event) {
            this.applyAcceptedActionStarted(args.repoId, result.taskId, event)
            return result
        }
        await this.refreshTask(args.repoId, result.taskId, NOTIFICATION_LIGHTWEIGHT_TASK_READ_OPTIONS)
        return result
    }

    async interruptTurn(taskId: string, options: OpenADERequestOptions = {}): Promise<void> {
        await this.ensureCanUseMethod(OPENADE_METHOD.turnInterrupt)
        await this.client.interruptTurn(taskId, options)
        this.clearRuntimeListReads()
    }

    async cancelQueuedTurn(args: OpenADEQueuedTurnCancelRequest, options: OpenADERequestOptions = {}): Promise<OpenADEQueuedTurnCancelResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.queuedTurnCancel)
        const taggedArgs = withProductStoreClientRequestId(args, options)
        this.trackAcceptedMutationNotification(taggedArgs.clientRequestId)
        try {
            const result = await this.client.cancelQueuedTurn(taggedArgs, options)
            this.applyQueuedTurnCancelled(taggedArgs)
            return result
        } catch (error) {
            this.acceptedMutationNotifications.delete(taggedArgs.clientRequestId)
            throw error
        }
    }

    async enqueueQueuedTurn(args: OpenADEQueuedTurnEnqueueRequest, options: OpenADERequestOptions = {}): Promise<OpenADEQueuedTurnEnqueueResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.queuedTurnEnqueue)
        const taggedArgs = withProductStoreClientRequestId(args, options)
        this.trackAcceptedMutationNotification(taggedArgs.clientRequestId)
        try {
            const result = await this.client.enqueueQueuedTurn(taggedArgs, options)
            this.applyQueuedTurnEnqueued(taggedArgs, result.turn)
            return result
        } catch (error) {
            this.acceptedMutationNotifications.delete(taggedArgs.clientRequestId)
            throw error
        }
    }

    async reorderQueuedTurns(args: OpenADEQueuedTurnReorderRequest, options: OpenADERequestOptions = {}): Promise<OpenADEQueuedTurnReorderResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.queuedTurnReorder)
        const taggedArgs = withProductStoreClientRequestId(args, options)
        this.trackAcceptedMutationNotification(taggedArgs.clientRequestId)
        try {
            const result = await this.client.reorderQueuedTurns(taggedArgs, options)
            this.applyQueuedTurnsReordered(taggedArgs, result.turns)
            return result
        } catch (error) {
            this.acceptedMutationNotifications.delete(taggedArgs.clientRequestId)
            throw error
        }
    }

    async updateTaskMetadata(args: OpenADETaskMetadataUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskMetadataUpdate)
        const requestKey = taskMetadataUpdateRequestKey(args, options)
        const inFlight = this.taskMetadataUpdatesInFlight.get(requestKey)
        if (inFlight) return inFlight

        const taggedArgs = withProductStoreClientRequestId(args, options)
        this.trackAcceptedMutationNotification(taggedArgs.clientRequestId)
        const request = this.client
            .updateTaskMetadata(taggedArgs, options)
            .then(() => {
                this.clearTaskResourceInventoryCachesForTaskId(taggedArgs.taskId)
                this.applyTaskMetadataUpdate(taggedArgs)
            })
            .catch((error: unknown) => {
                this.acceptedMutationNotifications.delete(taggedArgs.clientRequestId)
                throw error
            })
            .finally(() => {
                if (this.taskMetadataUpdatesInFlight.get(requestKey) === request) this.taskMetadataUpdatesInFlight.delete(requestKey)
            })
        this.taskMetadataUpdatesInFlight.set(requestKey, request)
        return request
    }

    patchTaskMetadata(args: OpenADETaskMetadataUpdateRequest): void {
        this.applyTaskMetadataUpdate(args)
    }

    async backfillTaskUsage(args: OpenADETaskUsageBackfillRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskUsageBackfillResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskUsageBackfill)
        const result = await this.client.backfillTaskUsage(args, options)
        this.applyUsageBackfill(result)
        return result
    }

    async recalculateTaskUsage(args: OpenADETaskUsageRecalculateRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskUsageRecalculateResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskUsageRecalculate)
        const result = await this.client.recalculateTaskUsage(args, options)
        this.applyUsageUpdate(args.repoId, args.taskId, result.usage)
        return result
    }

    async createComment(args: OpenADECommentCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADECommentCreateResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.commentCreate)
        const taggedArgs = withProductStoreClientRequestId(args, options)
        this.trackAcceptedMutationNotification(taggedArgs.clientRequestId)
        try {
            const result = await this.client.createComment(taggedArgs, options)
            this.applyCommentCreated(taggedArgs, result)
            return result
        } catch (error) {
            this.acceptedMutationNotifications.delete(taggedArgs.clientRequestId)
            throw error
        }
    }

    async editComment(args: OpenADECommentEditRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.ensureCanUseMethod(OPENADE_METHOD.commentEdit)
        const taggedArgs = withProductStoreClientRequestId(args, options)
        this.trackAcceptedMutationNotification(taggedArgs.clientRequestId)
        try {
            await this.client.editComment(taggedArgs, options)
            this.applyCommentEdited(taggedArgs)
        } catch (error) {
            this.acceptedMutationNotifications.delete(taggedArgs.clientRequestId)
            throw error
        }
    }

    async deleteComment(args: OpenADECommentDeleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.ensureCanUseMethod(OPENADE_METHOD.commentDelete)
        const taggedArgs = withProductStoreClientRequestId(args, options)
        this.trackAcceptedMutationNotification(taggedArgs.clientRequestId)
        try {
            await this.client.deleteComment(taggedArgs, options)
            this.applyCommentDeleted(taggedArgs)
        } catch (error) {
            this.acceptedMutationNotifications.delete(taggedArgs.clientRequestId)
            throw error
        }
    }

    async deleteTask(args: OpenADETaskDeleteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskDeleteResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskDelete)
        const result = await this.client.deleteTask(args, options)
        this.applyTaskDeleted(args.repoId, args.taskId)
        return result
    }

    async setupTaskEnvironment(args: OpenADETaskEnvironmentSetupRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskEnvironmentSetup)
        await this.client.setupTaskEnvironment(args, options)
        this.applyTaskEnvironmentSetup(args)
    }

    async prepareTaskEnvironment(
        args: OpenADETaskEnvironmentPrepareRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskEnvironmentPrepareResult> {
        await this.ensureCanUseMethod(OPENADE_METHOD.taskEnvironmentPrepare)
        const result = await this.client.prepareTaskEnvironment(args, options)
        this.applyTaskEnvironmentSetup(
            {
                taskId: result.taskId,
                deviceEnvironment: result.deviceEnvironment,
                setupEvent: result.setupEvent,
            },
            result.repoId
        )
        return result
    }

    async handleNotification(notification: RuntimeNotification): Promise<boolean> {
        if (this.runtimes.applyNotification(notification)) {
            this.clearRuntimeListReads()
            this.taskResourceInventoryCache.clear()
        }
        if (this.consumeAcceptedMutationNotification(notification)) return true
        if (this.consumeAcceptedActionStartNotification(notification)) return true

        const params = notificationRecord(notification)
        const taskId = typeof params.taskId === "string" ? params.taskId : undefined
        const repoId = typeof params.repoId === "string" ? params.repoId : taskId ? this.cachedRepoIdForTask(taskId) : undefined
        const bridgeEventType = typeof params.type === "string" ? params.type : undefined

        if (notification.method === OPENADE_NOTIFICATION.snapshotChanged && bridgeEventType === "task_deleted" && repoId) {
            if (taskId) this.clearTaskCache(repoId, taskId)
            if (this.hasProjectProjectionForRepo(repoId)) {
                await this.refreshTaskListProjection(repoId, { bypassCache: true })
            }
            return true
        }

        if (
            notification.method === OPENADE_NOTIFICATION.snapshotChanged ||
            notification.method === OPENADE_NOTIFICATION.repoUpdated ||
            notification.method === OPENADE_NOTIFICATION.repoDeleted
        ) {
            if (notification.method === OPENADE_NOTIFICATION.repoUpdated && repoId) this.clearRepoReadCachesForScope(repoId)
            if (notification.method === OPENADE_NOTIFICATION.repoDeleted && repoId) this.applyRepoDeleted(repoId)
            if (this.hasProjectProjection()) {
                await this.refreshProjectProjection({ bypassCache: true })
            }
            return true
        }

        if (notification.method === OPENADE_NOTIFICATION.taskDeleted && repoId && taskId) {
            this.clearTaskCache(repoId, taskId)
            this.cancelDeferredTaskRefresh(repoId, taskId)
            if (this.hasProjectProjectionForRepo(repoId)) {
                await this.refreshTaskListProjection(repoId, { bypassCache: true })
            }
            return true
        }

        if (notification.method === OPENADE_NOTIFICATION.taskPreviewChanged && repoId) {
            if (this.hasProjectProjectionForRepo(repoId)) {
                await this.refreshTaskListProjection(repoId, { bypassCache: true })
            } else if (taskId && this.hasCachedTask(repoId, taskId)) {
                await this.refreshCachedTaskAfterNotification(repoId, taskId, notification)
            }
            return true
        }

        if (notification.method === OPENADE_NOTIFICATION.taskPreviewChanged) {
            if (this.hasProjectProjection()) {
                await this.refreshProjectProjection({ bypassCache: true })
            }
            return true
        }

        if ((notification.method === OPENADE_NOTIFICATION.taskUpdated || notification.method === OPENADE_NOTIFICATION.queuedTurnUpdated) && taskId && !repoId) {
            return true
        }

        if ((notification.method === OPENADE_NOTIFICATION.taskUpdated || notification.method === OPENADE_NOTIFICATION.queuedTurnUpdated) && repoId && taskId) {
            if (taskNotificationNeedsScopedHostInvalidation(notification)) {
                this.clearProjectReadCachesForScope(repoId, taskId)
                this.clearGitSummaryCacheForScope(repoId, taskId)
            }
            this.clearTaskImageCachesForScope(repoId, taskId)
            this.clearTaskResourceInventoryCachesForScope(repoId, taskId)
            if (this.hasCachedTask(repoId, taskId)) {
                await this.refreshCachedTaskAfterNotification(repoId, taskId, notification)
            }
            return true
        }

        return false
    }

    private applyTaskMetadataUpdate(args: OpenADETaskMetadataUpdateRequest): void {
        for (const [key, task] of this.tasks) {
            if (task.id === args.taskId) this.tasks.set(key, taskWithMetadataUpdate(task, args))
        }

        if (this.projects) {
            this.projects = this.projects.map((repo) => ({
                ...repo,
                tasks: repo.tasks.map((task) => (task.id === args.taskId ? taskPreviewWithMetadataUpdate(task, args) : task)),
            }))
            this.projectListLoadedAt = Date.now()
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

    private applyQueuedTurnCancelled(args: OpenADEQueuedTurnCancelRequest): void {
        this.patchCachedTaskById(args.taskId, (task) => ({
            ...task,
            queuedTurns: queuedTurnsWithCancelledTurn(task, args.queuedTurnId),
        }))
    }

    private applyQueuedTurnEnqueued(args: OpenADEQueuedTurnEnqueueRequest, turn: OpenADEQueuedTurn): void {
        this.patchCachedTaskById(args.taskId, (task) => ({
            ...task,
            queuedTurns: queuedTurnsWithAcceptedTurn(task, turn),
        }))
    }

    private applyQueuedTurnsReordered(args: OpenADEQueuedTurnReorderRequest, turns: OpenADEQueuedTurn[]): void {
        this.patchCachedTaskById(args.taskId, (task) => ({
            ...task,
            queuedTurns: queuedTurnsWithReorderedTurns(task, turns),
        }))
    }

    private applyUsageBackfill(result: OpenADETaskUsageBackfillResult): void {
        for (const task of result.tasks) {
            this.applyUsageUpdate(task.repoId, task.taskId, task.usage)
        }
    }

    private applyUsageUpdate(repoId: string, taskId: string, usage: OpenADETaskPreviewUsage): void {
        if (this.projects) {
            this.projects = this.projects.map((repo) =>
                repo.id === repoId
                    ? {
                          ...repo,
                          tasks: repo.tasks.map((task) => (task.id === taskId ? { ...task, usage } : task)),
                      }
                    : repo
            )
            this.projectListLoadedAt = Date.now()
        }
        if (!this.snapshot) return
        this.snapshot = {
            ...this.snapshot,
            repos: this.snapshot.repos.map((repo) =>
                repo.id === repoId
                    ? {
                          ...repo,
                          tasks: repo.tasks.map((task) => (task.id === taskId ? { ...task, usage } : task)),
                      }
                    : repo
            ),
        }
        this.snapshotLoadedAt = Date.now()
    }

    private applyTaskDeleted(repoId: string, taskId: string): void {
        this.clearTaskCache(repoId, taskId)
        this.clearGitSummaryCacheForScope(repoId, taskId)
        if (this.projects) {
            this.projects = this.projects.map((repo) => (repo.id === repoId ? { ...repo, tasks: repo.tasks.filter((task) => task.id !== taskId) } : repo))
            this.projectListLoadedAt = Date.now()
        }
        if (!this.snapshot) return
        this.snapshot = {
            ...this.snapshot,
            repos: this.snapshot.repos.map((repo) => (repo.id === repoId ? { ...repo, tasks: repo.tasks.filter((task) => task.id !== taskId) } : repo)),
            workingTaskIds: this.snapshot.workingTaskIds.filter((id) => id !== taskId),
        }
        this.snapshotLoadedAt = Date.now()
    }

    private applyTaskList(repoId: string, tasks: OpenADETaskPreview[]): void {
        const loadedAt = Date.now()
        const previousTaskIds = new Set(
            (this.snapshot?.repos.find((repo) => repo.id === repoId) ?? this.projects?.find((repo) => repo.id === repoId))?.tasks.map((task) => task.id) ?? []
        )
        const nextTaskIds = new Set(tasks.map((task) => task.id))
        if (this.projects) {
            this.projects = this.projects.map((repo) => (repo.id === repoId ? { ...repo, tasks } : repo))
            this.projectListLoadedAt = loadedAt
        }
        if (!this.snapshot) return
        this.snapshot = {
            ...this.snapshot,
            repos: this.snapshot.repos.map((repo) => (repo.id === repoId ? { ...repo, tasks } : repo)),
            workingTaskIds: this.snapshot.workingTaskIds.filter((taskId) => !previousTaskIds.has(taskId) || nextTaskIds.has(taskId)),
        }
        this.snapshotLoadedAt = loadedAt
    }

    private applyTaskPreview(repoId: string, preview: OpenADETaskPreview): void {
        const loadedAt = Date.now()
        if (this.projects) {
            this.projects = this.projects.map((repo) =>
                repo.id === repoId
                    ? {
                          ...repo,
                          tasks: repo.tasks.map((task) => (task.id === preview.id ? preview : task)),
                      }
                    : repo
            )
            this.projectListLoadedAt = loadedAt
        }
        if (!this.snapshot) return
        this.snapshot = {
            ...this.snapshot,
            repos: this.snapshot.repos.map((repo) =>
                repo.id === repoId
                    ? {
                          ...repo,
                          tasks: repo.tasks.map((task) => (task.id === preview.id ? preview : task)),
                      }
                    : repo
            ),
        }
        this.snapshotLoadedAt = loadedAt
    }

    private applyPlainTaskCreated(args: OpenADETaskCreateRequest, result: OpenADETaskCreateResult): void {
        const repoId = args.repoId
        const loadedAt = Date.now()
        const key = taskKey(repoId, result.taskId)
        const preview: OpenADETaskPreview = {
            id: result.taskId,
            slug: result.slug,
            title: result.title,
            createdAt: result.createdAt,
            closed: false,
        }
        const task: OpenADETask = {
            id: result.taskId,
            repoId,
            slug: result.slug,
            title: result.title,
            description: args.input,
            isolationStrategy: args.isolationStrategy,
            enabledMcpServerIds: args.enabledMcpServerIds,
            createdBy: args.createdBy,
            deviceEnvironments: args.deviceEnvironment ? [args.deviceEnvironment] : [],
            events: [],
            comments: [],
            closed: false,
            createdAt: result.createdAt,
            updatedAt: result.createdAt,
        }
        this.tasks.set(key, task)
        this.taskLoadedAt.set(key, loadedAt)
        this.taskReadModes.set(key, "lightweight")
        this.taskReadOptions.set(key, LIGHTWEIGHT_TASK_READ_OPTIONS)
        if (this.projects) {
            this.projects = this.projects.map((repo) =>
                repo.id === repoId
                    ? {
                          ...repo,
                          tasks: [...repo.tasks.filter((candidate) => candidate.id !== preview.id), preview],
                      }
                    : repo
            )
            this.projectListLoadedAt = loadedAt
        }

        if (!this.snapshot) return
        this.snapshot = {
            ...this.snapshot,
            repos: this.snapshot.repos.map((repo) =>
                repo.id === repoId
                    ? {
                          ...repo,
                          tasks: [...repo.tasks.filter((candidate) => candidate.id !== preview.id), preview],
                      }
                    : repo
            ),
        }
        this.snapshotLoadedAt = loadedAt
    }

    private applyTaskEnvironmentSetup(args: OpenADETaskEnvironmentSetupRequest, repoId = this.cachedRepoIdForTask(args.taskId)): void {
        const setupEvent = setupEnvironmentEventFromAcceptedSetup(args.setupEvent)
        const lastEvent = setupEnvironmentPreviewEvent(args.setupEvent)
        const lastEventAt = lastEvent?.at
        if (repoId) {
            this.clearProjectReadCachesForScope(repoId, args.taskId)
            this.clearProcessListCacheForScope(repoId, args.taskId)
            this.clearGitSummaryCacheForScope(repoId, args.taskId)
            this.clearTaskResourceInventoryCachesForScope(repoId, args.taskId)
        }

        this.patchCachedTaskById(args.taskId, (task) => ({
            ...task,
            deviceEnvironments: [...task.deviceEnvironments.filter((environment) => environment.id !== args.deviceEnvironment.id), args.deviceEnvironment],
            events: setupEvent ? [...task.events.filter((event) => !isRecordWithStringId(event) || event.id !== setupEvent.id), setupEvent] : task.events,
            lastEventAt: lastEventAt ?? task.lastEventAt,
            updatedAt: lastEventAt ?? task.updatedAt,
        }))

        if (!this.snapshot || !lastEvent) return
        this.snapshot = {
            ...this.snapshot,
            repos: this.snapshot.repos.map((repo) =>
                repoId === undefined || repo.id === repoId
                    ? {
                          ...repo,
                          tasks: repo.tasks.map((task) =>
                              task.id === args.taskId
                                  ? {
                                        ...task,
                                        lastEvent,
                                        lastEventAt: lastEvent.at,
                                    }
                                  : task
                          ),
                      }
                    : repo
            ),
        }
        this.snapshotLoadedAt = Date.now()
    }

    private applyAcceptedTaskCreated(repoId: string, task: OpenADETask, preview: OpenADETaskPreview): void {
        const loadedAt = Date.now()
        const key = taskKey(repoId, task.id)
        this.tasks.set(key, task)
        this.taskLoadedAt.set(key, loadedAt)
        this.taskReadModes.set(key, "lightweight")
        this.taskReadOptions.set(key, LIGHTWEIGHT_TASK_READ_OPTIONS)
        if (this.projects) {
            this.projects = this.projects.map((repo) =>
                repo.id === repoId
                    ? {
                          ...repo,
                          tasks: [...repo.tasks.filter((candidate) => candidate.id !== preview.id), preview],
                      }
                    : repo
            )
            this.projectListLoadedAt = loadedAt
        }

        if (!this.snapshot) return
        this.snapshot = {
            ...this.snapshot,
            repos: this.snapshot.repos.map((repo) =>
                repo.id === repoId
                    ? {
                          ...repo,
                          tasks: [...repo.tasks.filter((candidate) => candidate.id !== preview.id), preview],
                      }
                    : repo
            ),
            workingTaskIds: this.snapshot.workingTaskIds.includes(task.id) ? this.snapshot.workingTaskIds : [...this.snapshot.workingTaskIds, task.id],
        }
        this.snapshotLoadedAt = loadedAt
    }

    private applyAcceptedActionStarted(repoId: string, taskId: string, event: Record<string, unknown> & { id: string }): void {
        const lastEvent = actionPreviewEvent(event)
        this.trackAcceptedActionStartNotification(repoId, taskId, event.id)
        this.cancelPendingAcceptedActionStartNotification(repoId, taskId, event.id)
        this.patchCachedTaskById(taskId, (task) => ({
            ...task,
            events: [...task.events.filter((candidate) => !isRecordWithStringId(candidate) || candidate.id !== event.id), event],
            lastEventAt: lastEvent?.at ?? task.lastEventAt,
            updatedAt: lastEvent?.at ?? task.updatedAt,
        }))

        if (!this.snapshot || !lastEvent) return
        this.snapshot = {
            ...this.snapshot,
            repos: this.snapshot.repos.map((repo) =>
                repo.id === repoId
                    ? {
                          ...repo,
                          tasks: repo.tasks.map((task) =>
                              task.id === taskId
                                  ? {
                                        ...task,
                                        lastEvent,
                                        lastEventAt: lastEvent.at,
                                    }
                                  : task
                          ),
                      }
                    : repo
            ),
            workingTaskIds: this.snapshot.workingTaskIds.includes(taskId) ? this.snapshot.workingTaskIds : [...this.snapshot.workingTaskIds, taskId],
        }
        this.snapshotLoadedAt = Date.now()
    }

    private applyAcceptedProjectProcessStarted(args: OpenADEProjectProcessStartRequest, result: OpenADEProjectProcessStartResult): void {
        const key = processListCacheKey(args.repoId, args.taskId)
        this.processListRequestsInFlight.delete(key)
        const cached = this.processListCache.get(key)
        if (!cached) {
            this.clearProcessListCacheForScope(args.repoId, args.taskId)
            return
        }

        const definition = cached.result.processes.find((candidate) => candidate.id === result.definitionId)
        const instance: OpenADEProjectProcessInstance = {
            processId: result.processId,
            definitionId: result.definitionId,
            repoId: result.repoId,
            ...(result.taskId !== undefined ? { taskId: result.taskId } : {}),
            cwd: definition?.cwd ?? cached.result.searchRoot,
            completed: false,
            exitCode: null,
            signal: null,
        }
        this.processListCache.set(key, {
            expiresAt: Date.now() + PROCESS_LIST_CACHE_TTL_MS,
            result: {
                ...cached.result,
                instances: [...cached.result.instances.filter((candidate) => candidate.processId !== result.processId), instance],
            },
        })
    }

    private applyAcceptedProjectProcessStopped(args: OpenADEProjectProcessStopRequest, result: OpenADEProjectProcessStopResult): void {
        const key = processListCacheKey(args.repoId, args.taskId)
        this.processListRequestsInFlight.delete(key)
        const cached = this.processListCache.get(key)
        if (!cached || !result.ok) {
            this.clearProcessListCacheForScope(args.repoId, args.taskId)
            return
        }

        this.processListCache.set(key, {
            expiresAt: Date.now() + PROCESS_LIST_CACHE_TTL_MS,
            result: {
                ...cached.result,
                instances: cached.result.instances.filter((candidate) => candidate.processId !== result.processId),
            },
        })
    }

    private cachedRepoIdForTask(taskId: string): string | undefined {
        for (const task of this.tasks.values()) {
            if (task.id === taskId) return task.repoId
        }
        for (const repo of this.projects ?? []) {
            if (repo.tasks.some((task) => task.id === taskId)) return repo.id
        }
        for (const repo of this.snapshot?.repos ?? []) {
            if (repo.tasks.some((task) => task.id === taskId)) return repo.id
        }
        return undefined
    }

    private patchCachedTaskById(taskId: string, patchTask: (task: OpenADETask) => OpenADETask): void {
        const patchedAt = Date.now()
        for (const [key, task] of this.tasks) {
            if (task.id !== taskId) continue
            this.tasks.set(key, patchTask(task))
            this.taskLoadedAt.set(key, patchedAt)
        }
    }

    private applyCommentCreated(args: OpenADECommentCreateRequest, result: OpenADECommentCreateResult): void {
        const comment = commentFromAcceptedCreate(args, result)
        this.patchCachedTaskById(args.taskId, (task) => ({
            ...task,
            comments: [...task.comments.filter((candidate) => !isRecordWithStringId(candidate) || candidate.id !== result.commentId), comment],
            updatedAt: result.createdAt ?? task.updatedAt,
        }))
    }

    private applyCommentEdited(args: OpenADECommentEditRequest): void {
        this.patchCachedTaskById(args.taskId, (task) => ({
            ...task,
            comments: task.comments.map((comment) => {
                if (!isRecordWithStringId(comment) || comment.id !== args.commentId) return comment
                return {
                    ...comment,
                    content: args.content,
                    ...(args.updatedAt !== undefined ? { updatedAt: args.updatedAt } : {}),
                }
            }),
            updatedAt: args.updatedAt ?? task.updatedAt,
        }))
    }

    private applyCommentDeleted(args: OpenADECommentDeleteRequest): void {
        this.patchCachedTaskById(args.taskId, (task) => ({
            ...task,
            comments: task.comments.filter((comment) => !isRecordWithStringId(comment) || comment.id !== args.commentId),
            updatedAt: args.updatedAt ?? task.updatedAt,
        }))
    }

    subscribe(): () => void {
        if (this.unsubscribe) return this.unsubscribe
        const unsubscribeClient = this.client.subscribeToChanges((notification) => {
            if (this.scheduleTaskUpdateNotification(notification)) return
            if (this.cancelPendingTaskUpdateNotification(notification)) return
            this.cancelPendingTaskPreviewNotification(notification)
            if (this.scheduleTaskPreviewNotification(notification)) return
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
        this.deferredTaskRefreshListeners.clear()
        this.snapshotRequestInFlight = null
        this.projectListRequestInFlight = null
        this.taskListRequestsInFlight.clear()
        this.taskRequestsInFlight.clear()
        this.taskMetadataUpdatesInFlight.clear()
        this.tasks.clear()
        this.taskLoadedAt.clear()
        this.taskNotificationRefreshLoadedAt.clear()
        this.taskReadModes.clear()
        this.taskReadOptions.clear()
        this.clearDeferredTaskRefreshes()
        this.clearRuntimeListReads()
        this.processListCache.clear()
        this.processListRequestsInFlight.clear()
        this.cronDefinitionsCache.clear()
        this.cronDefinitionsRequestsInFlight.clear()
        this.cronInstallStateCache.clear()
        this.cronInstallStateRequestsInFlight.clear()
        this.cronInstallStateListCache = null
        this.cronInstallStateListRequestInFlight = null
        this.projectFilesTreeCache.clear()
        this.projectFilesTreeRequestsInFlight.clear()
        this.projectFileReadCache.clear()
        this.projectFileReadRequestsInFlight.clear()
        this.fuzzySearchCache.clear()
        this.fuzzySearchRequestsInFlight.clear()
        this.projectSearchCache.clear()
        this.projectSearchRequestsInFlight.clear()
        this.projectGitInfoCache.clear()
        this.projectGitInfoRequestsInFlight.clear()
        this.projectGitBranchesCache.clear()
        this.projectGitBranchesRequestsInFlight.clear()
        this.projectGitSummaryCache.clear()
        this.projectGitSummaryRequestsInFlight.clear()
        this.taskGitSummaryCache.clear()
        this.taskGitSummaryRequestsInFlight.clear()
        this.taskGitScopesCache.clear()
        this.taskGitScopesRequestsInFlight.clear()
        this.taskGitLogCache.clear()
        this.taskGitLogRequestsInFlight.clear()
        this.taskGitCommitFilesCache.clear()
        this.taskGitCommitFilesRequestsInFlight.clear()
        this.taskGitFileAtTreeishCache.clear()
        this.taskGitFileAtTreeishRequestsInFlight.clear()
        this.taskGitCommitFilePatchCache.clear()
        this.taskGitCommitFilePatchRequestsInFlight.clear()
        this.taskChangesCache.clear()
        this.taskChangesRequestsInFlight.clear()
        this.taskDiffCache.clear()
        this.taskDiffRequestsInFlight.clear()
        this.taskFilePairCache.clear()
        this.taskFilePairRequestsInFlight.clear()
        this.taskSnapshotPatchCache.clear()
        this.taskSnapshotPatchRequestsInFlight.clear()
        this.taskSnapshotIndexCache.clear()
        this.taskSnapshotIndexRequestsInFlight.clear()
        this.taskSnapshotPatchSliceCache.clear()
        this.taskSnapshotPatchSliceRequestsInFlight.clear()
        this.taskImageCache.clear()
        this.taskImageRequestsInFlight.clear()
        this.stagedTaskImageCache.clear()
        this.stagedTaskImageRequestsInFlight.clear()
        this.taskResourceInventoryCache.clear()
        this.taskResourceInventoryRequestsInFlight.clear()
        this.mcpServersCache = null
        this.mcpServersRequestsInFlight.clear()
        this.personalSettingsCache = null
        this.personalSettingsRequestsInFlight.clear()
        this.acceptedActionStartNotifications.clear()
        this.acceptedMutationNotifications.clear()
        this.runtimes.clear()
    }

    private scheduleTaskUpdateNotification(notification: RuntimeNotification): boolean {
        if (notification.method !== OPENADE_NOTIFICATION.taskUpdated && notification.method !== OPENADE_NOTIFICATION.queuedTurnUpdated) return false
        if (this.consumeAcceptedMutationNotification(notification)) return true
        if (this.consumeAcceptedActionStartNotification(notification)) return true

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

    private scheduleTaskPreviewNotification(notification: RuntimeNotification): boolean {
        const key = taskPreviewNotificationKey(notification)
        if (!key) return false

        this.pendingTaskPreviewNotifications.set(key, notification)
        if (this.taskPreviewNotificationTimers.has(key)) return true

        const loadedAt = this.taskPreviewNotificationLoadedAt.get(key) ?? 0
        const elapsedMs = Date.now() - loadedAt
        const delayMs =
            loadedAt > 0 && elapsedMs < TASK_PREVIEW_NOTIFICATION_MIN_REFRESH_MS
                ? Math.max(TASK_PREVIEW_NOTIFICATION_MIN_REFRESH_MS - elapsedMs, TASK_PREVIEW_NOTIFICATION_COALESCE_MS)
                : TASK_PREVIEW_NOTIFICATION_COALESCE_MS

        const timer = setTimeout(() => {
            this.taskPreviewNotificationTimers.delete(key)
            const pending = this.pendingTaskPreviewNotifications.get(key)
            this.pendingTaskPreviewNotifications.delete(key)
            if (pending) {
                this.taskPreviewNotificationLoadedAt.set(key, Date.now())
                void this.handleNotification(pending)
            }
        }, delayMs)
        this.taskPreviewNotificationTimers.set(key, timer)
        return true
    }

    private cancelPendingTaskUpdateNotification(notification: RuntimeNotification): boolean {
        if (this.consumeAcceptedMutationNotification(notification)) return true
        if (notification.method !== OPENADE_NOTIFICATION.taskPreviewChanged && notification.method !== OPENADE_NOTIFICATION.taskDeleted) return false

        const key = taskNotificationKey(notification)
        if (!key) return false

        const timer = this.taskUpdateNotificationTimers.get(key)
        if (timer) clearTimeout(timer)
        this.taskUpdateNotificationTimers.delete(key)
        this.pendingTaskUpdateNotifications.delete(key)
        return false
    }

    private cancelPendingTaskPreviewNotification(notification: RuntimeNotification): void {
        const params = notificationRecord(notification)
        const repoId = typeof params.repoId === "string" ? params.repoId : ""

        if (notification.method === OPENADE_NOTIFICATION.snapshotChanged) {
            this.clearPendingTaskPreviewNotifications()
            return
        }

        if (
            notification.method !== OPENADE_NOTIFICATION.taskDeleted &&
            notification.method !== OPENADE_NOTIFICATION.repoUpdated &&
            notification.method !== OPENADE_NOTIFICATION.repoDeleted
        ) {
            return
        }

        if (repoId) {
            this.clearPendingTaskPreviewNotification(repoId)
            if (notification.method === OPENADE_NOTIFICATION.repoUpdated || notification.method === OPENADE_NOTIFICATION.repoDeleted) {
                this.clearPendingTaskPreviewNotification(GLOBAL_TASK_PREVIEW_NOTIFICATION_KEY)
            }
            return
        }
        this.clearPendingTaskPreviewNotifications()
    }

    private clearPendingTaskUpdateNotifications(): void {
        for (const timer of this.taskUpdateNotificationTimers.values()) clearTimeout(timer)
        this.taskUpdateNotificationTimers.clear()
        this.pendingTaskUpdateNotifications.clear()
        this.clearPendingTaskPreviewNotifications()
        this.clearDeferredTaskRefreshes()
    }

    private clearPendingTaskPreviewNotification(key: string): void {
        const timer = this.taskPreviewNotificationTimers.get(key)
        if (timer) clearTimeout(timer)
        this.taskPreviewNotificationTimers.delete(key)
        this.pendingTaskPreviewNotifications.delete(key)
        this.taskPreviewNotificationLoadedAt.delete(key)
    }

    private clearPendingTaskPreviewNotifications(): void {
        for (const timer of this.taskPreviewNotificationTimers.values()) clearTimeout(timer)
        this.taskPreviewNotificationTimers.clear()
        this.pendingTaskPreviewNotifications.clear()
        this.taskPreviewNotificationLoadedAt.clear()
    }

    private taskNotificationRefreshMinMs(repoId: string, taskId: string, notification: RuntimeNotification): number {
        const params = notificationRecord(notification)
        const eventId = typeof params.eventId === "string" ? params.eventId : ""
        if (
            notification.method !== OPENADE_NOTIFICATION.taskUpdated ||
            params.previewChanged !== false ||
            params.eventStatus !== "in_progress" ||
            !eventId
        ) {
            return TASK_UPDATE_NOTIFICATION_MIN_REFRESH_MS
        }

        const task = this.getCachedLightweightTask(repoId, taskId)
        const hasVisibleInProgressEvent = task?.events.some((event) => event.id === eventId && event.type === "action" && event.status === "in_progress") ?? false
        return hasVisibleInProgressEvent ? TASK_IN_PROGRESS_NOTIFICATION_MIN_REFRESH_MS : TASK_UPDATE_NOTIFICATION_MIN_REFRESH_MS
    }

    private async refreshCachedTaskAfterNotification(repoId: string, taskId: string, notification: RuntimeNotification): Promise<void> {
        const key = taskKey(repoId, taskId)
        const readOptions = notificationTaskReadOptions(this.taskReadOptions.get(key))
        const minRefreshMs = this.taskNotificationRefreshMinMs(repoId, taskId, notification)
        const loadedAt = this.taskNotificationRefreshLoadedAt.get(key) ?? this.taskLoadedAt.get(key) ?? 0
        const elapsedMs = Date.now() - loadedAt
        if (elapsedMs >= minRefreshMs) {
            this.cancelDeferredTaskRefresh(repoId, taskId)
            await this.refreshTask(repoId, taskId, readOptions)
            return
        }

        if (this.deferredTaskRefreshTimers.has(key)) return
        const delayMs = Math.max(minRefreshMs - elapsedMs, TASK_UPDATE_NOTIFICATION_COALESCE_MS)
        const timer = setTimeout(() => {
            this.deferredTaskRefreshTimers.delete(key)
            if (!this.hasCachedTask(repoId, taskId)) return
            this.refreshTask(repoId, taskId, readOptions)
                .then((task) => {
                    for (const listener of this.deferredTaskRefreshListeners) listener(task, readOptions)
                })
                .catch((err) => {
                    console.warn("[OpenADEProductStore] Deferred task refresh failed:", err)
                })
        }, delayMs)
        this.deferredTaskRefreshTimers.set(key, timer)
    }

    private cancelDeferredTaskRefresh(repoId: string, taskId: string): void {
        const key = taskKey(repoId, taskId)
        const timer = this.deferredTaskRefreshTimers.get(key)
        if (!timer) return
        clearTimeout(timer)
        this.deferredTaskRefreshTimers.delete(key)
    }

    private clearDeferredTaskRefreshes(): void {
        for (const timer of this.deferredTaskRefreshTimers.values()) clearTimeout(timer)
        this.deferredTaskRefreshTimers.clear()
    }

    private trackAcceptedActionStartNotification(repoId: string, taskId: string, eventId: string): void {
        this.cleanupAcceptedActionStartNotifications()
        this.acceptedActionStartNotifications.set(
            acceptedActionStartNotificationKey(repoId, taskId, eventId),
            Date.now() + ACCEPTED_ACTION_START_NOTIFICATION_SUPPRESS_MS
        )
    }

    private trackAcceptedMutationNotification(clientRequestId: string): void {
        this.cleanupAcceptedMutationNotifications()
        this.acceptedMutationNotifications.set(clientRequestId, Date.now() + ACCEPTED_MUTATION_NOTIFICATION_SUPPRESS_MS)
    }

    private cleanupAcceptedActionStartNotifications(): void {
        const now = Date.now()
        for (const [key, expiresAt] of this.acceptedActionStartNotifications) {
            if (expiresAt <= now) this.acceptedActionStartNotifications.delete(key)
        }
    }

    private cleanupAcceptedMutationNotifications(): void {
        const now = Date.now()
        for (const [clientRequestId, expiresAt] of this.acceptedMutationNotifications) {
            if (expiresAt <= now) this.acceptedMutationNotifications.delete(clientRequestId)
        }
    }

    private consumeAcceptedActionStartNotification(notification: RuntimeNotification): boolean {
        if (notification.method !== OPENADE_NOTIFICATION.taskUpdated) return false
        const params = notificationRecord(notification)
        const repoId = typeof params.repoId === "string" ? params.repoId : ""
        const taskId = typeof params.taskId === "string" ? params.taskId : ""
        const eventId = typeof params.eventId === "string" ? params.eventId : ""
        if (!repoId || !taskId || !eventId || params.eventStatus !== "in_progress") return false

        this.cleanupAcceptedActionStartNotifications()
        const key = acceptedActionStartNotificationKey(repoId, taskId, eventId)
        if (!this.acceptedActionStartNotifications.has(key)) return false
        this.acceptedActionStartNotifications.delete(key)
        return true
    }

    private consumeAcceptedMutationNotification(notification: RuntimeNotification): boolean {
        const params = notificationRecord(notification)
        const clientRequestId = typeof params.clientRequestId === "string" ? params.clientRequestId : ""
        if (!clientRequestId) return false

        this.cleanupAcceptedMutationNotifications()
        return this.acceptedMutationNotifications.has(clientRequestId)
    }

    private cancelPendingAcceptedActionStartNotification(repoId: string, taskId: string, eventId: string): void {
        const key = taskKey(repoId, taskId)
        const pending = this.pendingTaskUpdateNotifications.get(key)
        if (!pending) return

        const params = notificationRecord(pending)
        if (params.eventId !== eventId || params.eventStatus !== "in_progress") return

        const timer = this.taskUpdateNotificationTimers.get(key)
        if (timer) clearTimeout(timer)
        this.taskUpdateNotificationTimers.delete(key)
        this.pendingTaskUpdateNotifications.delete(key)
        this.acceptedActionStartNotifications.delete(acceptedActionStartNotificationKey(repoId, taskId, eventId))
    }

    private cancelPendingAcceptedTaskCreationNotification(repoId: string, taskId: string, eventId: string): void {
        const key = taskKey(repoId, taskId)
        const pending = this.pendingTaskUpdateNotifications.get(key)
        if (!pending) return

        const params = notificationRecord(pending)
        const pendingEventId = typeof params.eventId === "string" ? params.eventId : ""
        const pendingEventStatus = typeof params.eventStatus === "string" ? params.eventStatus : ""
        if (pendingEventId && pendingEventId !== eventId) return
        if (pendingEventStatus && pendingEventStatus !== "in_progress") return

        const timer = this.taskUpdateNotificationTimers.get(key)
        if (timer) clearTimeout(timer)
        this.taskUpdateNotificationTimers.delete(key)
        this.pendingTaskUpdateNotifications.delete(key)
        this.acceptedActionStartNotifications.delete(acceptedActionStartNotificationKey(repoId, taskId, eventId))
    }

    private clearProcessListCacheForScope(repoId: string, taskId?: string): void {
        if (taskId !== undefined) {
            const key = processListCacheKey(repoId, taskId)
            this.processListCache.delete(key)
            this.processListRequestsInFlight.delete(key)
            this.cronDefinitionsCache.delete(key)
            this.cronDefinitionsRequestsInFlight.delete(key)
            return
        }
        for (const key of this.processListCache.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.processListCache.delete(key)
        }
        for (const key of this.processListRequestsInFlight.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.processListRequestsInFlight.delete(key)
        }
        for (const key of this.cronDefinitionsCache.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.cronDefinitionsCache.delete(key)
        }
        for (const key of this.cronDefinitionsRequestsInFlight.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.cronDefinitionsRequestsInFlight.delete(key)
        }
    }

    private clearProjectReadCachesForScope(repoId: string, taskId?: string): void {
        clearProjectScopedCache(this.projectFilesTreeCache, repoId, taskId)
        clearProjectScopedCache(this.projectFilesTreeRequestsInFlight, repoId, taskId)
        clearProjectScopedCache(this.projectFileReadCache, repoId, taskId)
        clearProjectScopedCache(this.projectFileReadRequestsInFlight, repoId, taskId)
        clearProjectScopedCache(this.fuzzySearchCache, repoId, taskId)
        clearProjectScopedCache(this.fuzzySearchRequestsInFlight, repoId, taskId)
        clearProjectScopedCache(this.projectSearchCache, repoId, taskId)
        clearProjectScopedCache(this.projectSearchRequestsInFlight, repoId, taskId)
    }

    private clearRepoReadCachesForScope(repoId: string): void {
        this.clearProjectReadCachesForScope(repoId)
        this.clearProcessListCacheForScope(repoId)
        this.clearProjectGitMetadataCaches(repoId)
        this.clearGitSummaryCacheForScope(repoId)
        this.clearTaskResourceInventoryCachesForScope(repoId)
        this.cronInstallStateCache.delete(repoId)
        this.cronInstallStateRequestsInFlight.delete(repoId)
        this.cronInstallStateListCache = null
        this.cronInstallStateListRequestInFlight = null
    }

    private clearTaskResourceInventoryCachesForScope(repoId: string, taskId?: string): void {
        if (taskId !== undefined) {
            const key = taskKey(repoId, taskId)
            this.taskResourceInventoryCache.delete(key)
            this.taskResourceInventoryRequestsInFlight.delete(key)
            return
        }
        for (const key of this.taskResourceInventoryCache.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.taskResourceInventoryCache.delete(key)
        }
        for (const key of this.taskResourceInventoryRequestsInFlight.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.taskResourceInventoryRequestsInFlight.delete(key)
        }
    }

    private clearTaskResourceInventoryCachesForTaskId(taskId: string): void {
        for (const key of this.taskResourceInventoryCache.keys()) {
            if (key.endsWith(`\0${taskId}`)) this.taskResourceInventoryCache.delete(key)
        }
        for (const key of this.taskResourceInventoryRequestsInFlight.keys()) {
            if (key.endsWith(`\0${taskId}`)) this.taskResourceInventoryRequestsInFlight.delete(key)
        }
    }

    private clearTaskCache(repoId: string, taskId: string): void {
        const key = taskKey(repoId, taskId)
        this.cancelDeferredTaskRefresh(repoId, taskId)
        this.tasks.delete(key)
        this.taskLoadedAt.delete(key)
        this.taskNotificationRefreshLoadedAt.delete(key)
        this.taskReadModes.delete(key)
        this.taskReadOptions.delete(key)
        clearTaskRequestsInFlight(this.taskRequestsInFlight, key)
        this.clearProjectReadCachesForScope(repoId, taskId)
        this.clearTaskSnapshotArtifactCachesForScope(repoId, taskId)
        this.clearTaskImageCachesForScope(repoId, taskId)
        this.clearTaskResourceInventoryCachesForScope(repoId, taskId)
    }

    private clearProjectGitMetadataCaches(repoId: string): void {
        this.projectGitInfoCache.delete(repoId)
        this.projectGitInfoRequestsInFlight.delete(repoId)
        for (const key of this.projectGitBranchesCache.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.projectGitBranchesCache.delete(key)
        }
        for (const key of this.projectGitBranchesRequestsInFlight.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.projectGitBranchesRequestsInFlight.delete(key)
        }
    }

    private clearGitSummaryCacheForScope(repoId: string, taskId?: string): void {
        this.projectGitSummaryCache.delete(repoId)
        this.projectGitSummaryRequestsInFlight.delete(repoId)
        if (taskId !== undefined) {
            const key = taskKey(repoId, taskId)
            this.taskGitSummaryCache.delete(key)
            this.taskGitSummaryRequestsInFlight.delete(key)
            this.clearTaskGitReadCachesForScope(repoId, taskId)
            return
        }
        for (const key of this.taskGitSummaryCache.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.taskGitSummaryCache.delete(key)
        }
        for (const key of this.taskGitSummaryRequestsInFlight.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.taskGitSummaryRequestsInFlight.delete(key)
        }
        this.clearTaskGitReadCachesForScope(repoId)
    }

    private clearTaskGitReadCachesForScope(repoId: string, taskId?: string): void {
        const scope = taskId === undefined ? `${repoId}\0` : `${repoId}\0${taskId}\0`
        for (const key of this.taskGitScopesCache.keys()) {
            if (key.startsWith(scope)) this.taskGitScopesCache.delete(key)
        }
        for (const key of this.taskGitScopesRequestsInFlight.keys()) {
            if (key.startsWith(scope)) this.taskGitScopesRequestsInFlight.delete(key)
        }
        for (const key of this.taskGitLogCache.keys()) {
            if (key.startsWith(scope)) this.taskGitLogCache.delete(key)
        }
        for (const key of this.taskGitLogRequestsInFlight.keys()) {
            if (key.startsWith(scope)) this.taskGitLogRequestsInFlight.delete(key)
        }
        for (const key of this.taskGitCommitFilesCache.keys()) {
            if (key.startsWith(scope)) this.taskGitCommitFilesCache.delete(key)
        }
        for (const key of this.taskGitCommitFilesRequestsInFlight.keys()) {
            if (key.startsWith(scope)) this.taskGitCommitFilesRequestsInFlight.delete(key)
        }
        for (const key of this.taskGitFileAtTreeishCache.keys()) {
            if (key.startsWith(scope)) this.taskGitFileAtTreeishCache.delete(key)
        }
        for (const key of this.taskGitFileAtTreeishRequestsInFlight.keys()) {
            if (key.startsWith(scope)) this.taskGitFileAtTreeishRequestsInFlight.delete(key)
        }
        for (const key of this.taskGitCommitFilePatchCache.keys()) {
            if (key.startsWith(scope)) this.taskGitCommitFilePatchCache.delete(key)
        }
        for (const key of this.taskGitCommitFilePatchRequestsInFlight.keys()) {
            if (key.startsWith(scope)) this.taskGitCommitFilePatchRequestsInFlight.delete(key)
        }
        for (const key of this.taskChangesCache.keys()) {
            if (key.startsWith(scope)) this.taskChangesCache.delete(key)
        }
        for (const key of this.taskChangesRequestsInFlight.keys()) {
            if (key.startsWith(scope)) this.taskChangesRequestsInFlight.delete(key)
        }
        for (const key of this.taskDiffCache.keys()) {
            if (key.startsWith(scope)) this.taskDiffCache.delete(key)
        }
        for (const key of this.taskDiffRequestsInFlight.keys()) {
            if (key.startsWith(scope)) this.taskDiffRequestsInFlight.delete(key)
        }
        for (const key of this.taskFilePairCache.keys()) {
            if (key.startsWith(scope)) this.taskFilePairCache.delete(key)
        }
        for (const key of this.taskFilePairRequestsInFlight.keys()) {
            if (key.startsWith(scope)) this.taskFilePairRequestsInFlight.delete(key)
        }
    }

    private clearTaskSnapshotArtifactCachesForScope(repoId: string, taskId?: string): void {
        const scope = taskId === undefined ? `${repoId}\0` : `${repoId}\0${taskId}\0`
        for (const key of this.taskSnapshotPatchCache.keys()) {
            if (key.startsWith(scope)) this.taskSnapshotPatchCache.delete(key)
        }
        for (const key of this.taskSnapshotPatchRequestsInFlight.keys()) {
            if (key.startsWith(scope)) this.taskSnapshotPatchRequestsInFlight.delete(key)
        }
        for (const key of this.taskSnapshotIndexCache.keys()) {
            if (key.startsWith(scope)) this.taskSnapshotIndexCache.delete(key)
        }
        for (const key of this.taskSnapshotIndexRequestsInFlight.keys()) {
            if (key.startsWith(scope)) this.taskSnapshotIndexRequestsInFlight.delete(key)
        }
        for (const key of this.taskSnapshotPatchSliceCache.keys()) {
            if (key.startsWith(scope)) this.taskSnapshotPatchSliceCache.delete(key)
        }
        for (const key of this.taskSnapshotPatchSliceRequestsInFlight.keys()) {
            if (key.startsWith(scope)) this.taskSnapshotPatchSliceRequestsInFlight.delete(key)
        }
    }

    private clearTaskImageCachesForScope(repoId: string, taskId?: string): void {
        const scope = taskId === undefined ? `${repoId}\0` : `${repoId}\0${taskId}\0`
        for (const key of this.taskImageCache.keys()) {
            if (key.startsWith(scope)) this.taskImageCache.delete(key)
        }
        for (const key of this.taskImageRequestsInFlight.keys()) {
            if (key.startsWith(scope)) this.taskImageRequestsInFlight.delete(key)
        }
    }

    private applyRepoCreated(args: OpenADERepoCreateRequest, result: OpenADERepoCreateResult): void {
        const project = projectFromAcceptedCreate(args, result)
        const projects = this.projects ?? []
        this.projects = projects.some((repo) => repo.id === project.id)
            ? projects.map((repo) => (repo.id === project.id ? { ...repo, name: project.name, path: project.path } : repo))
            : [...projects, project]
        this.projectListLoadedAt = Date.now()
        if (!this.snapshot) return
        const exists = this.snapshot.repos.some((repo) => repo.id === project.id)
        this.snapshot = {
            ...this.snapshot,
            repos: exists
                ? this.snapshot.repos.map((repo) => (repo.id === project.id ? { ...repo, name: project.name, path: project.path } : repo))
                : [...this.snapshot.repos, project],
        }
        this.snapshotLoadedAt = Date.now()
    }

    private applyRepoUpdated(args: OpenADERepoUpdateRequest): void {
        this.clearRepoReadCachesForScope(args.repoId)
        if (this.projects) {
            this.projects = this.projects.map((repo) => (repo.id === args.repoId ? projectWithAcceptedUpdate(repo, args) : repo))
            this.projectListLoadedAt = Date.now()
        }
        if (!this.snapshot) return
        this.snapshot = {
            ...this.snapshot,
            repos: this.snapshot.repos.map((repo) => (repo.id === args.repoId ? projectWithAcceptedUpdate(repo, args) : repo)),
        }
        this.snapshotLoadedAt = Date.now()
    }

    private applyRepoDeleted(repoId: string): void {
        this.clearRepoReadCachesForScope(repoId)
        this.clearTaskSnapshotArtifactCachesForScope(repoId)
        this.clearTaskImageCachesForScope(repoId)
        const deletedTaskIds = new Set(this.snapshot?.repos.find((repo) => repo.id === repoId)?.tasks.map((task) => task.id) ?? [])
        for (const key of this.tasks.keys()) {
            if (key.startsWith(`${repoId}\0`)) {
                this.tasks.delete(key)
                this.taskReadModes.delete(key)
                this.taskReadOptions.delete(key)
                clearTaskRequestsInFlight(this.taskRequestsInFlight, key)
            }
        }
        for (const key of this.taskLoadedAt.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.taskLoadedAt.delete(key)
        }
        this.clearPendingNotificationsForRepo(repoId)
        if (this.projects) {
            this.projects = this.projects.filter((repo) => repo.id !== repoId)
            this.projectListLoadedAt = Date.now()
        }
        if (!this.snapshot) return
        this.snapshot = {
            ...this.snapshot,
            repos: this.snapshot.repos.filter((repo) => repo.id !== repoId),
            workingTaskIds: this.snapshot.workingTaskIds.filter((taskId) => !deletedTaskIds.has(taskId)),
        }
        this.snapshotLoadedAt = Date.now()
    }

    private clearPendingNotificationsForRepo(repoId: string): void {
        for (const [key, timer] of this.taskUpdateNotificationTimers) {
            if (!key.startsWith(`${repoId}\0`)) continue
            clearTimeout(timer)
            this.taskUpdateNotificationTimers.delete(key)
            this.pendingTaskUpdateNotifications.delete(key)
        }
        this.clearPendingTaskPreviewNotification(repoId)
    }
}

function processListCacheKey(repoId: string, taskId?: string): string {
    return `${repoId}\0${taskId ?? ""}`
}

function stableRuntimeListCacheKey(args: RuntimeListParams): string {
    const sorted = Object.fromEntries(
        Object.keys(args)
            .sort()
            .map((key) => [key, args[key as keyof RuntimeListParams]])
    )
    return JSON.stringify(sorted)
}

function projectGitBranchesCacheKey(args: OpenADEProjectGitBranchesReadRequest): string {
    return `${args.repoId}\0${args.includeRemote === true ? "remote" : "local"}`
}

function stableTaskGitReadCacheKey(
    prefix: string,
    args:
        | OpenADETaskChangesReadRequest
        | OpenADETaskDiffReadRequest
        | OpenADETaskFilePairReadRequest
        | OpenADETaskGitScopesReadRequest
        | OpenADETaskGitLogRequest
        | OpenADETaskGitCommitFilesRequest
        | OpenADETaskGitFileAtTreeishRequest
        | OpenADETaskGitCommitFilePatchRequest
): string {
    const sorted = Object.fromEntries(
        Object.keys(args)
            .sort()
            .map((key) => [key, args[key as keyof typeof args]])
    )
    return `${args.repoId}\0${args.taskId}\0${prefix}\0${JSON.stringify(sorted)}`
}

function taskSnapshotArtifactCacheKey(
    prefix: string,
    args: OpenADETaskSnapshotPatchReadRequest | OpenADETaskSnapshotIndexReadRequest | OpenADETaskSnapshotPatchSliceReadRequest
): string {
    const slice = "start" in args || "end" in args ? `\0${"start" in args ? args.start : ""}\0${"end" in args ? args.end : ""}` : ""
    return `${args.repoId}\0${args.taskId}\0${prefix}\0${args.eventId}${slice}`
}

function taskImageCacheKey(args: OpenADETaskImageReadRequest): string {
    return `${args.repoId}\0${args.taskId}\0${args.imageId}\0${args.ext}`
}

function stagedTaskImageCacheKey(args: OpenADETaskImageStagedReadRequest): string {
    return `${args.imageId}\0${args.ext}`
}

function taskNotificationKey(notification: RuntimeNotification): string | null {
    const params = notificationRecord(notification)
    const repoId = typeof params.repoId === "string" ? params.repoId : null
    const taskId = typeof params.taskId === "string" ? params.taskId : null
    return repoId && taskId ? taskKey(repoId, taskId) : null
}

function acceptedActionStartNotificationKey(repoId: string, taskId: string, eventId: string): string {
    return `${repoId}\0${taskId}\0${eventId}`
}

function isOpenADETomlPath(path: string): boolean {
    const normalized = path.replace(/\\/g, "/")
    const segments = normalized.split("/")
    return segments[segments.length - 1] === "openade.toml"
}

function stableProjectReadCacheKey(
    prefix: string,
    args:
        | OpenADEProjectFilesTreeRequest
        | OpenADEProjectFileReadRequest
        | OpenADEProjectFilesFuzzySearchRequest
        | OpenADEProjectSearchRequest
        | OpenADEProjectSdkCapabilitiesReadRequest
): string {
    const sorted = Object.fromEntries(
        Object.keys(args)
            .sort()
            .map((key) => [key, args[key as keyof typeof args]])
    )
    return `${prefix}\0${args.repoId}\0${args.taskId ?? ""}\0${JSON.stringify(sorted)}`
}

function stableFuzzySearchCacheKey(args: OpenADEProjectFilesFuzzySearchRequest): string {
    return `fuzzy\0${args.repoId}\0${args.taskId ?? ""}\0${JSON.stringify({
        repoId: args.repoId,
        taskId: args.taskId ?? null,
        query: args.query,
        matchDirs: args.matchDirs === true,
        limit: args.limit ?? null,
        includeHidden: args.includeHidden === true,
        includeGenerated: args.includeGenerated === true,
    })}`
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
    hasMethod(method: OpenADEMethod): boolean
    ensureMethodAvailable(method: OpenADEMethod): Promise<void>
    hasRuntimeMethod(method: string): boolean
    ensureRuntimeMethodAvailable(method: string): Promise<void>
    getSnapshot(): Promise<OpenADESnapshot>
    listProjects(): Promise<OpenADEProject[]>
    listTasks(repoId: string): Promise<OpenADETaskPreview[]>
    listRuntimes(args?: RuntimeListParams): Promise<RuntimeRecord[]>
    getTask(repoId: string, taskId: string, options?: OpenADETaskReadOptions): Promise<OpenADETask>
    listProjectFiles(args: OpenADEProjectFilesTreeRequest): Promise<OpenADEProjectFilesTreeResult>
    readProjectFile(args: OpenADEProjectFileReadRequest): Promise<OpenADEProjectFileReadResult>
    fuzzySearchProjectFiles(args: OpenADEProjectFilesFuzzySearchRequest): Promise<OpenADEProjectFilesFuzzySearchResult>
    writeProjectFile(args: OpenADEProjectFileWriteRequest, options?: OpenADERequestOptions): Promise<OpenADEProjectFileWriteResult>
    searchProject(args: OpenADEProjectSearchRequest): Promise<OpenADEProjectSearchResult>
    readProjectSdkCapabilities(args: OpenADEProjectSdkCapabilitiesReadRequest): Promise<OpenADESdkCapabilities>
    readProjectGitInfo(args: OpenADEProjectGitInfoRequest): Promise<OpenADEProjectGitInfoResult>
    readProjectGitBranches(args: OpenADEProjectGitBranchesReadRequest): Promise<OpenADEProjectGitBranchesReadResult>
    readProjectGitSummary(args: OpenADEProjectGitSummaryReadRequest): Promise<OpenADEProjectGitSummaryReadResult>
    listProjectProcesses(args: OpenADEProjectProcessListRequest): Promise<OpenADEProjectProcessListResult>
    readCronDefinitions(args: OpenADECronDefinitionsReadRequest): Promise<OpenADECronDefinitionsReadResult>
    startProjectProcess(args: OpenADEProjectProcessStartRequest, options?: OpenADERequestOptions): Promise<OpenADEProjectProcessStartResult>
    reconnectProjectProcess(args: OpenADEProjectProcessReconnectRequest): Promise<OpenADEProjectProcessReconnectResult>
    stopProjectProcess(args: OpenADEProjectProcessStopRequest, options?: OpenADERequestOptions): Promise<OpenADEProjectProcessStopResult>
    listCronInstallStateRepos(): Promise<OpenADECronInstallStateListResult>
    readCronInstallState(args: OpenADECronInstallStateReadRequest): Promise<OpenADECronInstallStateReadResult>
    replaceCronInstallState(args: OpenADECronInstallStateReplaceRequest, options?: OpenADERequestOptions): Promise<OpenADECronInstallStateReplaceResult>
    runCron(args: OpenADECronRunRequest, options?: OpenADERequestOptions): Promise<OpenADECronRunResult>
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
    inspectRepoPath(args: OpenADERepoPathInspectRequest): Promise<OpenADERepoPathInspectResult>
    createRepo(args: OpenADERepoCreateRequest, options?: OpenADERequestOptions): Promise<OpenADERepoCreateResult>
    createTask(args: OpenADETaskCreateRequest, options?: OpenADERequestOptions): Promise<OpenADETaskCreateResult>
    updateRepo(args: OpenADERepoUpdateRequest, options?: OpenADERequestOptions): Promise<void>
    deleteRepo(args: OpenADERepoDeleteRequest, options?: OpenADERequestOptions): Promise<void>
    startTurn(args: OpenADETurnStartRequest, options?: OpenADETurnStartOptions): Promise<OpenADETurnStartResult>
    startReview(args: OpenADEReviewStartRequest, options?: OpenADETurnStartOptions): Promise<OpenADEReviewStartResult>
    interruptTurn(taskId: string, options?: OpenADERequestOptions): Promise<void>
    cancelQueuedTurn(args: OpenADEQueuedTurnCancelRequest, options?: OpenADERequestOptions): Promise<OpenADEQueuedTurnCancelResult>
    enqueueQueuedTurn(args: OpenADEQueuedTurnEnqueueRequest, options?: OpenADERequestOptions): Promise<OpenADEQueuedTurnEnqueueResult>
    reorderQueuedTurns(args: OpenADEQueuedTurnReorderRequest, options?: OpenADERequestOptions): Promise<OpenADEQueuedTurnReorderResult>
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
