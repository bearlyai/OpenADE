import type { OpenADERequestOptions, OpenADETurnStartOptions } from "../../../openade-client/src"
import type {
    OpenADEActionEventSource,
    OpenADECommentCreateRequest,
    OpenADECommentCreateResult,
    OpenADECommentDeleteRequest,
    OpenADECommentEditRequest,
    OpenADECronDefinitionsReadRequest,
    OpenADECronDefinitionsReadResult,
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
    OpenADEProjectProcessInstance,
    OpenADEProjectProcessReconnectRequest,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectProcessStartRequest,
    OpenADEProjectProcessStartResult,
    OpenADEProjectProcessStopRequest,
    OpenADEProjectProcessStopResult,
    OpenADEProjectSearchRequest,
    OpenADEProjectSearchResult,
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
    OpenADERepoUpdateRequest,
    OpenADEReviewStartRequest,
    OpenADEReviewStartResult,
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

const LIGHTWEIGHT_TASK_READ_OPTIONS: OpenADETaskReadOptions = {
    hydrateSessionEvents: false,
}
const SNAPSHOT_CACHE_TTL_MS = 1_000
const PROJECT_LIST_CACHE_TTL_MS = 1_000
const LIGHTWEIGHT_TASK_CACHE_TTL_MS = 1_000
const RUNTIME_LIST_CACHE_TTL_MS = 1_000
const PROJECT_FILE_CACHE_TTL_MS = 1_000
const PROCESS_LIST_CACHE_TTL_MS = 1_000
const CRON_INSTALL_STATE_CACHE_TTL_MS = 1_000
const PROJECT_SEARCH_CACHE_TTL_MS = 1_000
const PROJECT_GIT_INFO_CACHE_TTL_MS = 1_000
const PROJECT_GIT_BRANCHES_CACHE_TTL_MS = 1_000
const GIT_SUMMARY_CACHE_TTL_MS = 1_000
const TASK_GIT_READ_CACHE_TTL_MS = 1_000
const TASK_SNAPSHOT_ARTIFACT_CACHE_TTL_MS = 1_000
const TASK_IMAGE_CACHE_TTL_MS = 1_000
const TASK_RESOURCE_INVENTORY_CACHE_TTL_MS = 1_000
const PRODUCT_SETTINGS_CACHE_TTL_MS = 1_000
const TASK_UPDATE_NOTIFICATION_COALESCE_MS = 150
const ACCEPTED_ACTION_START_NOTIFICATION_SUPPRESS_MS = 2_000
const ACCEPTED_MUTATION_NOTIFICATION_SUPPRESS_MS = 2_000
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
    private snapshotLoadedAt = 0
    private projectListLoadedAt = 0
    private readonly taskLoadedAt = new Map<string, number>()
    private readonly runtimeListCache = new Map<string, CachedRuntimeList>()
    private readonly runtimeListRequestsInFlight = new Map<string, Promise<RuntimeRecord[]>>()
    private runtimeListReadGeneration = 0
    private readonly processListCache = new Map<string, CachedProcessList>()
    private readonly cronDefinitionsCache = new Map<string, CachedCronDefinitions>()
    private readonly cronInstallStateCache = new Map<string, CachedCronInstallState>()
    private readonly projectFilesTreeCache = new Map<string, CachedProjectFilesTree>()
    private readonly projectFileReadCache = new Map<string, CachedProjectFileRead>()
    private readonly fuzzySearchCache = new Map<string, CachedFuzzySearch>()
    private readonly projectSearchCache = new Map<string, CachedProjectSearch>()
    private readonly projectGitInfoCache = new Map<string, CachedProjectGitInfo>()
    private readonly projectGitBranchesCache = new Map<string, CachedProjectGitBranches>()
    private readonly projectGitSummaryCache = new Map<string, CachedProjectGitSummary>()
    private readonly taskGitSummaryCache = new Map<string, CachedTaskGitSummary>()
    private readonly taskGitScopesCache = new Map<string, CachedTaskGitScopes>()
    private readonly taskGitLogCache = new Map<string, CachedTaskGitLog>()
    private readonly taskGitCommitFilesCache = new Map<string, CachedTaskGitCommitFiles>()
    private readonly taskGitFileAtTreeishCache = new Map<string, CachedTaskGitFileAtTreeish>()
    private readonly taskGitCommitFilePatchCache = new Map<string, CachedTaskGitCommitFilePatch>()
    private readonly taskChangesCache = new Map<string, CachedTaskChanges>()
    private readonly taskDiffCache = new Map<string, CachedTaskDiff>()
    private readonly taskFilePairCache = new Map<string, CachedTaskFilePair>()
    private readonly taskSnapshotPatchCache = new Map<string, CachedTaskSnapshotPatch>()
    private readonly taskSnapshotIndexCache = new Map<string, CachedTaskSnapshotIndex>()
    private readonly taskSnapshotPatchSliceCache = new Map<string, CachedTaskSnapshotPatchSlice>()
    private readonly taskImageCache = new Map<string, CachedTaskImage>()
    private readonly stagedTaskImageCache = new Map<string, CachedStagedTaskImage>()
    private readonly taskResourceInventoryCache = new Map<string, CachedTaskResourceInventory>()
    private mcpServersCache: CachedMcpServers | null = null
    private personalSettingsCache: CachedPersonalSettings | null = null
    private readonly pendingTaskUpdateNotifications = new Map<string, RuntimeNotification>()
    private readonly taskUpdateNotificationTimers = new Map<string, ReturnType<typeof setTimeout>>()
    private readonly acceptedActionStartNotifications = new Map<string, number>()
    private readonly acceptedMutationNotifications = new Map<string, number>()
    private unsubscribe: (() => void) | null = null

    constructor(
        private readonly client: OpenADEProductClient,
        private readonly legacyYjsImportWriter: OpenADELegacyYjsImportWriter | null = null
    ) {}

    getCachedTask(repoId: string, taskId: string): OpenADETask | null {
        return this.tasks.get(taskKey(repoId, taskId)) ?? null
    }

    getCachedProjects(): OpenADEProject[] | null {
        return this.projects
    }

    private hasCachedTask(repoId: string, taskId: string): boolean {
        return this.tasks.has(taskKey(repoId, taskId))
    }

    async refreshSnapshot(options: OpenADEProductReadOptions = {}): Promise<OpenADESnapshot> {
        if (!options.bypassCache && this.snapshot && Date.now() - this.snapshotLoadedAt < SNAPSHOT_CACHE_TTL_MS) return this.snapshot

        const snapshot = await this.client.getSnapshot()
        this.snapshot = snapshot
        this.snapshotLoadedAt = Date.now()
        this.projects = snapshot.repos
        this.projectListLoadedAt = this.snapshotLoadedAt
        return snapshot
    }

    async listProjects(options: OpenADEProductReadOptions = {}): Promise<OpenADEProject[]> {
        if (!options.bypassCache && this.projects && Date.now() - this.projectListLoadedAt < PROJECT_LIST_CACHE_TTL_MS) return this.projects

        const projects = await this.client.listProjects()
        this.projects = projects
        this.projectListLoadedAt = Date.now()
        return projects
    }

    async listTasks(repoId: string, options: OpenADEProductReadOptions = {}): Promise<OpenADETaskPreview[]> {
        const cachedProject = this.projects?.find((repo) => repo.id === repoId)
        if (!options.bypassCache && cachedProject && Date.now() - this.projectListLoadedAt < PROJECT_LIST_CACHE_TTL_MS) return cachedProject.tasks

        const tasks = await this.client.listTasks(repoId)
        this.applyTaskList(repoId, tasks)
        return tasks
    }

    private async refreshProjectProjection(options: OpenADEProductReadOptions = {}): Promise<void> {
        if (this.snapshot) {
            await this.refreshSnapshot(options)
            return
        }
        await this.listProjects(options)
    }

    private clearRuntimeListReads(): void {
        this.runtimeListCache.clear()
        this.runtimeListRequestsInFlight.clear()
        this.runtimeListReadGeneration += 1
    }

    async listRuntimes(args: RuntimeListParams = {}): Promise<RuntimeRecord[]> {
        const key = stableRuntimeListCacheKey(args)
        const cached = this.runtimeListCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const inFlight = this.runtimeListRequestsInFlight.get(key)
        if (inFlight) return inFlight

        const readGeneration = this.runtimeListReadGeneration
        const request = this.client
            .listRuntimes(args)
            .then((runtimes) => {
                const target = readGeneration === this.runtimeListReadGeneration ? this.runtimes : new RuntimeRecordCache()
                target.replace(runtimes, args)
                const result = target.list(args)
                if (readGeneration === this.runtimeListReadGeneration) {
                    this.runtimeListCache.set(key, {
                        result,
                        expiresAt: Date.now() + RUNTIME_LIST_CACHE_TTL_MS,
                    })
                }
                return result
            })
            .finally(() => {
                if (this.runtimeListRequestsInFlight.get(key) === request) {
                    this.runtimeListRequestsInFlight.delete(key)
                }
            })
        this.runtimeListRequestsInFlight.set(key, request)
        return request
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
        const key = stableProjectReadCacheKey("tree", args)
        const cached = this.projectFilesTreeCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.listProjectFiles(args)
        this.projectFilesTreeCache.set(key, {
            result,
            expiresAt: Date.now() + PROJECT_FILE_CACHE_TTL_MS,
        })
        return result
    }

    async readProjectFile(args: OpenADEProjectFileReadRequest): Promise<OpenADEProjectFileReadResult> {
        const key = stableProjectReadCacheKey("file", args)
        const cached = this.projectFileReadCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readProjectFile(args)
        this.projectFileReadCache.set(key, {
            result,
            expiresAt: Date.now() + PROJECT_FILE_CACHE_TTL_MS,
        })
        return result
    }

    async fuzzySearchProjectFiles(args: OpenADEProjectFilesFuzzySearchRequest): Promise<OpenADEProjectFilesFuzzySearchResult> {
        const key = stableProjectReadCacheKey("fuzzy", args)
        const cached = this.fuzzySearchCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.fuzzySearchProjectFiles(args)
        this.fuzzySearchCache.set(key, {
            result,
            expiresAt: Date.now() + PROJECT_SEARCH_CACHE_TTL_MS,
        })
        return result
    }

    async writeProjectFile(args: OpenADEProjectFileWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectFileWriteResult> {
        const result = await this.client.writeProjectFile(args, options)
        this.clearProjectReadCachesForScope(args.repoId, args.taskId)
        this.clearGitSummaryCacheForScope(args.repoId, args.taskId)
        if (isOpenADETomlPath(args.path)) this.clearProcessListCacheForScope(args.repoId, args.taskId)
        return result
    }

    async searchProject(args: OpenADEProjectSearchRequest): Promise<OpenADEProjectSearchResult> {
        const key = stableProjectReadCacheKey("content", args)
        const cached = this.projectSearchCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.searchProject(args)
        this.projectSearchCache.set(key, {
            result,
            expiresAt: Date.now() + PROJECT_SEARCH_CACHE_TTL_MS,
        })
        return result
    }

    async readProjectGitInfo(args: OpenADEProjectGitInfoRequest): Promise<OpenADEProjectGitInfoResult> {
        const cached = this.projectGitInfoCache.get(args.repoId)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readProjectGitInfo(args)
        this.projectGitInfoCache.set(args.repoId, {
            result,
            expiresAt: Date.now() + PROJECT_GIT_INFO_CACHE_TTL_MS,
        })
        return result
    }

    async readProjectGitBranches(args: OpenADEProjectGitBranchesReadRequest): Promise<OpenADEProjectGitBranchesReadResult> {
        const key = projectGitBranchesCacheKey(args)
        const cached = this.projectGitBranchesCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readProjectGitBranches(args)
        this.projectGitBranchesCache.set(key, {
            result,
            expiresAt: Date.now() + PROJECT_GIT_BRANCHES_CACHE_TTL_MS,
        })
        return result
    }

    async readProjectGitSummary(
        args: OpenADEProjectGitSummaryReadRequest,
        options: OpenADEProductReadOptions = {}
    ): Promise<OpenADEProjectGitSummaryReadResult> {
        const cached = this.projectGitSummaryCache.get(args.repoId)
        if (!options.bypassCache && cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readProjectGitSummary(args)
        this.projectGitSummaryCache.set(args.repoId, {
            result,
            expiresAt: Date.now() + GIT_SUMMARY_CACHE_TTL_MS,
        })
        return result
    }

    async listProjectProcesses(args: OpenADEProjectProcessListRequest): Promise<OpenADEProjectProcessListResult> {
        const key = processListCacheKey(args.repoId, args.taskId)
        const cached = this.processListCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.listProjectProcesses(args)
        this.processListCache.set(key, {
            result,
            expiresAt: Date.now() + PROCESS_LIST_CACHE_TTL_MS,
        })
        return result
    }

    async readCronDefinitions(args: OpenADECronDefinitionsReadRequest): Promise<OpenADECronDefinitionsReadResult> {
        const key = processListCacheKey(args.repoId, args.taskId)
        const cached = this.cronDefinitionsCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readCronDefinitions(args)
        this.cronDefinitionsCache.set(key, {
            result,
            expiresAt: Date.now() + PROCESS_LIST_CACHE_TTL_MS,
        })
        return result
    }

    async startProjectProcess(args: OpenADEProjectProcessStartRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectProcessStartResult> {
        const result = await this.client.startProjectProcess(args, options)
        this.clearRuntimeListReads()
        this.applyAcceptedProjectProcessStarted(args, result)
        return result
    }

    async reconnectProjectProcess(args: OpenADEProjectProcessReconnectRequest): Promise<OpenADEProjectProcessReconnectResult> {
        return this.client.reconnectProjectProcess(args)
    }

    async stopProjectProcess(args: OpenADEProjectProcessStopRequest, options: OpenADERequestOptions = {}): Promise<OpenADEProjectProcessStopResult> {
        const result = await this.client.stopProjectProcess(args, options)
        this.clearRuntimeListReads()
        this.applyAcceptedProjectProcessStopped(args, result)
        return result
    }

    async readCronInstallState(args: OpenADECronInstallStateReadRequest): Promise<OpenADECronInstallStateReadResult> {
        const cached = this.cronInstallStateCache.get(args.repoId)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readCronInstallState(args)
        this.cronInstallStateCache.set(args.repoId, {
            result,
            expiresAt: Date.now() + CRON_INSTALL_STATE_CACHE_TTL_MS,
        })
        return result
    }

    async replaceCronInstallState(
        args: OpenADECronInstallStateReplaceRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADECronInstallStateReplaceResult> {
        const result = await this.client.replaceCronInstallState(args, options)
        this.cronInstallStateCache.set(args.repoId, {
            result,
            expiresAt: Date.now() + CRON_INSTALL_STATE_CACHE_TTL_MS,
        })
        return result
    }

    async readTaskChanges(args: OpenADETaskChangesReadRequest): Promise<OpenADETaskChangesReadResult> {
        const key = stableTaskGitReadCacheKey("changes", args)
        const cached = this.taskChangesCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskChanges(args)
        this.taskChangesCache.set(key, {
            result,
            expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
        })
        return result
    }

    async readTaskGitSummary(args: OpenADETaskGitSummaryRequest, options: OpenADEProductReadOptions = {}): Promise<OpenADETaskGitSummaryResult> {
        const key = taskKey(args.repoId, args.taskId)
        const cached = this.taskGitSummaryCache.get(key)
        if (!options.bypassCache && cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskGitSummary(args)
        this.taskGitSummaryCache.set(key, {
            result,
            expiresAt: Date.now() + GIT_SUMMARY_CACHE_TTL_MS,
        })
        return result
    }

    async readTaskGitScopes(args: OpenADETaskGitScopesReadRequest): Promise<OpenADETaskGitScopesReadResult> {
        const key = stableTaskGitReadCacheKey("scopes", args)
        const cached = this.taskGitScopesCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskGitScopes(args)
        this.taskGitScopesCache.set(key, {
            result,
            expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
        })
        return result
    }

    async readTaskDiff(args: OpenADETaskDiffReadRequest): Promise<OpenADETaskDiffReadResult> {
        const key = stableTaskGitReadCacheKey("diff", args)
        const cached = this.taskDiffCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskDiff(args)
        this.taskDiffCache.set(key, {
            result,
            expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
        })
        return result
    }

    async readTaskFilePair(args: OpenADETaskFilePairReadRequest): Promise<OpenADETaskFilePairReadResult> {
        const key = stableTaskGitReadCacheKey("filePair", args)
        const cached = this.taskFilePairCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskFilePair(args)
        this.taskFilePairCache.set(key, {
            result,
            expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
        })
        return result
    }

    async readTaskGitLog(args: OpenADETaskGitLogRequest): Promise<OpenADETaskGitLogResult> {
        const key = stableTaskGitReadCacheKey("log", args)
        const cached = this.taskGitLogCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskGitLog(args)
        this.taskGitLogCache.set(key, {
            result,
            expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
        })
        return result
    }

    async readTaskGitCommitFiles(args: OpenADETaskGitCommitFilesRequest): Promise<OpenADETaskGitCommitFilesResult> {
        const key = stableTaskGitReadCacheKey("commitFiles", args)
        const cached = this.taskGitCommitFilesCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskGitCommitFiles(args)
        this.taskGitCommitFilesCache.set(key, {
            result,
            expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
        })
        return result
    }

    async readTaskGitFileAtTreeish(args: OpenADETaskGitFileAtTreeishRequest): Promise<OpenADETaskGitFileAtTreeishResult> {
        const key = stableTaskGitReadCacheKey("fileAtTreeish", args)
        const cached = this.taskGitFileAtTreeishCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskGitFileAtTreeish(args)
        this.taskGitFileAtTreeishCache.set(key, {
            result,
            expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
        })
        return result
    }

    async readTaskGitCommitFilePatch(args: OpenADETaskGitCommitFilePatchRequest): Promise<OpenADETaskGitCommitFilePatchResult> {
        const key = stableTaskGitReadCacheKey("commitFilePatch", args)
        const cached = this.taskGitCommitFilePatchCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskGitCommitFilePatch(args)
        this.taskGitCommitFilePatchCache.set(key, {
            result,
            expiresAt: Date.now() + TASK_GIT_READ_CACHE_TTL_MS,
        })
        return result
    }

    async commitTaskGit(args: OpenADETaskGitCommitRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskGitCommitResult> {
        this.clearGitSummaryCacheForScope(args.repoId, args.taskId)
        const result = await this.client.commitTaskGit(args, options)
        this.clearGitSummaryCacheForScope(args.repoId, args.taskId)
        return result
    }

    async startTaskTerminal(args: OpenADETaskTerminalStartRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTerminalStartResult> {
        const result = await this.client.startTaskTerminal(args, options)
        this.clearRuntimeListReads()
        return result
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
        const result = await this.client.stopTaskTerminal(args, options)
        this.clearRuntimeListReads()
        return result
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
        const key = taskImageCacheKey(args)
        const cached = this.taskImageCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskImage(args)
        this.taskImageCache.set(key, {
            result,
            expiresAt: Date.now() + TASK_IMAGE_CACHE_TTL_MS,
        })
        return result
    }

    async readStagedTaskImage(args: OpenADETaskImageStagedReadRequest): Promise<OpenADETaskImageStagedReadResult> {
        const key = stagedTaskImageCacheKey(args)
        const cached = this.stagedTaskImageCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readStagedTaskImage(args)
        this.stagedTaskImageCache.set(key, {
            result,
            expiresAt: Date.now() + TASK_IMAGE_CACHE_TTL_MS,
        })
        return result
    }

    async writeTaskImage(args: OpenADETaskImageWriteRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskImageWriteResult> {
        this.stagedTaskImageCache.delete(stagedTaskImageCacheKey(args))
        const result = await this.client.writeTaskImage(args, options)
        this.stagedTaskImageCache.set(stagedTaskImageCacheKey(args), {
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
        const key = taskKey(args.repoId, args.taskId)
        const cached = this.taskResourceInventoryCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskResourceInventory(args)
        this.taskResourceInventoryCache.set(key, {
            result,
            expiresAt: Date.now() + TASK_RESOURCE_INVENTORY_CACHE_TTL_MS,
        })
        return result
    }

    async readMcpServers(): Promise<OpenADEMCPServersReadResult> {
        if (this.mcpServersCache && this.mcpServersCache.expiresAt > Date.now()) return this.mcpServersCache.result

        const result = await this.client.readMcpServers()
        this.mcpServersCache = {
            result,
            expiresAt: Date.now() + PRODUCT_SETTINGS_CACHE_TTL_MS,
        }
        return result
    }

    async replaceMcpServers(args: OpenADEMCPServersReplaceRequest, options: OpenADERequestOptions = {}): Promise<OpenADEMCPServersReplaceResult> {
        this.mcpServersCache = null
        const result = await this.client.replaceMcpServers(args, options)
        this.mcpServersCache = {
            result: { servers: result.servers },
            expiresAt: Date.now() + PRODUCT_SETTINGS_CACHE_TTL_MS,
        }
        return result
    }

    async upsertMcpServer(args: OpenADEMCPServerUpsertRequest, options: OpenADERequestOptions = {}): Promise<OpenADEMCPServerUpsertResult> {
        const previous = this.mcpServersCache?.result
        this.mcpServersCache = null
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
        const previous = this.mcpServersCache?.result
        this.mcpServersCache = null
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
        if (this.personalSettingsCache && this.personalSettingsCache.expiresAt > Date.now()) return this.personalSettingsCache.result

        const result = await this.client.readPersonalSettings()
        this.personalSettingsCache = {
            result,
            expiresAt: Date.now() + PRODUCT_SETTINGS_CACHE_TTL_MS,
        }
        return result
    }

    async replacePersonalSettings(
        args: OpenADEPersonalSettingsReplaceRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADEPersonalSettingsReplaceResult> {
        this.personalSettingsCache = null
        const result = await this.client.replacePersonalSettings(args, options)
        this.personalSettingsCache = {
            result: { settings: result.settings },
            expiresAt: Date.now() + PRODUCT_SETTINGS_CACHE_TTL_MS,
        }
        return result
    }

    async generateTaskTitle(args: OpenADETaskTitleGenerateRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskTitleGenerateResult> {
        const result = await this.client.generateTaskTitle(args, options)
        this.clearTaskResourceInventoryCachesForScope(args.repoId, args.taskId)
        this.applyTaskMetadataUpdate({
            taskId: result.taskId,
            title: result.title,
        })
        return result
    }

    async readTaskSnapshotPatch(args: OpenADETaskSnapshotPatchReadRequest): Promise<OpenADETaskSnapshotPatchReadResult> {
        const key = taskSnapshotArtifactCacheKey("patch", args)
        const cached = this.taskSnapshotPatchCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskSnapshotPatch(args)
        this.taskSnapshotPatchCache.set(key, {
            result,
            expiresAt: Date.now() + TASK_SNAPSHOT_ARTIFACT_CACHE_TTL_MS,
        })
        return result
    }

    async readTaskSnapshotIndex(args: OpenADETaskSnapshotIndexReadRequest): Promise<OpenADETaskSnapshotIndexReadResult> {
        const key = taskSnapshotArtifactCacheKey("index", args)
        const cached = this.taskSnapshotIndexCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskSnapshotIndex(args)
        this.taskSnapshotIndexCache.set(key, {
            result,
            expiresAt: Date.now() + TASK_SNAPSHOT_ARTIFACT_CACHE_TTL_MS,
        })
        return result
    }

    async readTaskSnapshotPatchSlice(args: OpenADETaskSnapshotPatchSliceReadRequest): Promise<OpenADETaskSnapshotPatchSliceReadResult> {
        const key = taskSnapshotArtifactCacheKey("slice", args)
        const cached = this.taskSnapshotPatchSliceCache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = await this.client.readTaskSnapshotPatchSlice(args)
        this.taskSnapshotPatchSliceCache.set(key, {
            result,
            expiresAt: Date.now() + TASK_SNAPSHOT_ARTIFACT_CACHE_TTL_MS,
        })
        return result
    }

    async createRepo(args: OpenADERepoCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADERepoCreateResult> {
        const result = await this.client.createRepo(args, options)
        this.applyRepoCreated(args, result)
        return result
    }

    async createTask(args: OpenADETaskCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskCreateResult> {
        const result = await this.client.createTask(args, options)
        this.applyPlainTaskCreated(args, result)
        return result
    }

    async updateRepo(args: OpenADERepoUpdateRequest, options: OpenADERequestOptions = {}): Promise<void> {
        this.clearProjectGitMetadataCaches(args.repoId)
        this.clearGitSummaryCacheForScope(args.repoId)
        await this.client.updateRepo(args, options)
        this.clearProjectGitMetadataCaches(args.repoId)
        this.clearGitSummaryCacheForScope(args.repoId)
        this.applyRepoUpdated(args)
    }

    async deleteRepo(args: OpenADERepoDeleteRequest, options: OpenADERequestOptions = {}): Promise<void> {
        this.clearProjectGitMetadataCaches(args.repoId)
        this.clearGitSummaryCacheForScope(args.repoId)
        await this.client.deleteRepo(args, options)
        this.clearProjectGitMetadataCaches(args.repoId)
        this.clearGitSummaryCacheForScope(args.repoId)
        this.applyRepoDeleted(args.repoId)
    }

    async startTurn(args: OpenADETurnStartRequest, options: OpenADETurnStartOptions = {}): Promise<OpenADETurnStartResult> {
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
            const event = actionEventFromAcceptedTurn(args, result, this.getCachedTask(args.repoId, result.taskId) ?? undefined)
            if (event) {
                this.applyAcceptedActionStarted(args.repoId, result.taskId, event)
                return result
            }
        }
        await this.refreshSnapshot({ bypassCache: true })
        if (result.taskId) await this.refreshTask(args.repoId, result.taskId)
        return result
    }

    async startReview(args: OpenADEReviewStartRequest, options: OpenADETurnStartOptions = {}): Promise<OpenADEReviewStartResult> {
        const result = await this.client.startReview(args, options)
        this.clearRuntimeListReads()
        this.clearTaskResourceInventoryCachesForScope(args.repoId, result.taskId)
        const event = actionEventFromAcceptedReview(args, result)
        if (event) {
            this.applyAcceptedActionStarted(args.repoId, result.taskId, event)
            return result
        }
        await this.refreshTask(args.repoId, result.taskId)
        return result
    }

    async interruptTurn(taskId: string, options: OpenADERequestOptions = {}): Promise<void> {
        await this.client.interruptTurn(taskId, options)
        this.clearRuntimeListReads()
    }

    async cancelQueuedTurn(args: OpenADEQueuedTurnCancelRequest, options: OpenADERequestOptions = {}): Promise<OpenADEQueuedTurnCancelResult> {
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
        const taggedArgs = withProductStoreClientRequestId(args, options)
        this.trackAcceptedMutationNotification(taggedArgs.clientRequestId)
        try {
            await this.client.updateTaskMetadata(taggedArgs, options)
            this.clearTaskResourceInventoryCachesForTaskId(taggedArgs.taskId)
            this.applyTaskMetadataUpdate(taggedArgs)
        } catch (error) {
            this.acceptedMutationNotifications.delete(taggedArgs.clientRequestId)
            throw error
        }
    }

    patchTaskMetadata(args: OpenADETaskMetadataUpdateRequest): void {
        this.applyTaskMetadataUpdate(args)
    }

    async backfillTaskUsage(args: OpenADETaskUsageBackfillRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskUsageBackfillResult> {
        const result = await this.client.backfillTaskUsage(args, options)
        this.applyUsageBackfill(result)
        return result
    }

    async recalculateTaskUsage(args: OpenADETaskUsageRecalculateRequest, options: OpenADERequestOptions = {}): Promise<OpenADETaskUsageRecalculateResult> {
        const result = await this.client.recalculateTaskUsage(args, options)
        this.applyUsageUpdate(args.repoId, args.taskId, result.usage)
        return result
    }

    async createComment(args: OpenADECommentCreateRequest, options: OpenADERequestOptions = {}): Promise<OpenADECommentCreateResult> {
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
        const result = await this.client.deleteTask(args, options)
        this.applyTaskDeleted(args.repoId, args.taskId)
        return result
    }

    async setupTaskEnvironment(args: OpenADETaskEnvironmentSetupRequest, options: OpenADERequestOptions = {}): Promise<void> {
        await this.client.setupTaskEnvironment(args, options)
        this.applyTaskEnvironmentSetup(args)
    }

    async prepareTaskEnvironment(
        args: OpenADETaskEnvironmentPrepareRequest,
        options: OpenADERequestOptions = {}
    ): Promise<OpenADETaskEnvironmentPrepareResult> {
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
        const repoId = typeof params.repoId === "string" ? params.repoId : undefined
        const taskId = typeof params.taskId === "string" ? params.taskId : undefined

        if (
            notification.method === "openade/snapshotChanged" ||
            notification.method === "openade/repo/updated" ||
            notification.method === "openade/repo/deleted"
        ) {
            if (notification.method === "openade/repo/updated" && repoId) this.clearRepoReadCachesForScope(repoId)
            if (notification.method === "openade/repo/deleted" && repoId) this.applyRepoDeleted(repoId)
            await this.refreshProjectProjection({ bypassCache: true })
            return true
        }

        if (notification.method === "openade/task/deleted" && repoId && taskId) {
            this.clearTaskCache(repoId, taskId)
            await this.refreshProjectProjection({ bypassCache: true })
            return true
        }

        if (notification.method === "openade/task/previewChanged") {
            await this.refreshProjectProjection({ bypassCache: true })
            return true
        }

        if ((notification.method === "openade/task/updated" || notification.method === "openade/queuedTurn/updated") && repoId && taskId) {
            this.clearProjectReadCachesForScope(repoId, taskId)
            this.clearGitSummaryCacheForScope(repoId, taskId)
            this.clearTaskImageCachesForScope(repoId, taskId)
            this.clearTaskResourceInventoryCachesForScope(repoId, taskId)
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
        this.clearRuntimeListReads()
        this.processListCache.clear()
        this.cronDefinitionsCache.clear()
        this.cronInstallStateCache.clear()
        this.projectFilesTreeCache.clear()
        this.projectFileReadCache.clear()
        this.fuzzySearchCache.clear()
        this.projectSearchCache.clear()
        this.projectGitInfoCache.clear()
        this.projectGitBranchesCache.clear()
        this.projectGitSummaryCache.clear()
        this.taskGitSummaryCache.clear()
        this.taskGitScopesCache.clear()
        this.taskGitLogCache.clear()
        this.taskGitCommitFilesCache.clear()
        this.taskGitFileAtTreeishCache.clear()
        this.taskGitCommitFilePatchCache.clear()
        this.taskChangesCache.clear()
        this.taskDiffCache.clear()
        this.taskFilePairCache.clear()
        this.taskSnapshotPatchCache.clear()
        this.taskSnapshotIndexCache.clear()
        this.taskSnapshotPatchSliceCache.clear()
        this.taskImageCache.clear()
        this.stagedTaskImageCache.clear()
        this.taskResourceInventoryCache.clear()
        this.mcpServersCache = null
        this.personalSettingsCache = null
        this.acceptedActionStartNotifications.clear()
        this.acceptedMutationNotifications.clear()
        this.runtimes.clear()
    }

    private scheduleTaskUpdateNotification(notification: RuntimeNotification): boolean {
        if (notification.method !== "openade/task/updated" && notification.method !== "openade/queuedTurn/updated") return false
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

    private cancelPendingTaskUpdateNotification(notification: RuntimeNotification): boolean {
        if (this.consumeAcceptedMutationNotification(notification)) return true
        if (notification.method !== "openade/task/previewChanged" && notification.method !== "openade/task/deleted") return false

        const key = taskNotificationKey(notification)
        if (!key) return false

        const timer = this.taskUpdateNotificationTimers.get(key)
        if (timer) clearTimeout(timer)
        this.taskUpdateNotificationTimers.delete(key)
        this.pendingTaskUpdateNotifications.delete(key)
        return false
    }

    private clearPendingTaskUpdateNotifications(): void {
        for (const timer of this.taskUpdateNotificationTimers.values()) clearTimeout(timer)
        this.taskUpdateNotificationTimers.clear()
        this.pendingTaskUpdateNotifications.clear()
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
        if (notification.method !== "openade/task/updated") return false
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
            this.processListCache.delete(processListCacheKey(repoId, taskId))
            this.cronDefinitionsCache.delete(processListCacheKey(repoId, taskId))
            return
        }
        for (const key of this.processListCache.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.processListCache.delete(key)
        }
        for (const key of this.cronDefinitionsCache.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.cronDefinitionsCache.delete(key)
        }
    }

    private clearProjectReadCachesForScope(repoId: string, taskId?: string): void {
        clearProjectScopedCache(this.projectFilesTreeCache, repoId, taskId)
        clearProjectScopedCache(this.projectFileReadCache, repoId, taskId)
        clearProjectScopedCache(this.fuzzySearchCache, repoId, taskId)
        clearProjectScopedCache(this.projectSearchCache, repoId, taskId)
    }

    private clearRepoReadCachesForScope(repoId: string): void {
        this.clearProjectReadCachesForScope(repoId)
        this.clearProcessListCacheForScope(repoId)
        this.clearProjectGitMetadataCaches(repoId)
        this.clearGitSummaryCacheForScope(repoId)
        this.clearTaskResourceInventoryCachesForScope(repoId)
        this.cronInstallStateCache.delete(repoId)
    }

    private clearTaskResourceInventoryCachesForScope(repoId: string, taskId?: string): void {
        if (taskId !== undefined) {
            this.taskResourceInventoryCache.delete(taskKey(repoId, taskId))
            return
        }
        for (const key of this.taskResourceInventoryCache.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.taskResourceInventoryCache.delete(key)
        }
    }

    private clearTaskResourceInventoryCachesForTaskId(taskId: string): void {
        for (const key of this.taskResourceInventoryCache.keys()) {
            if (key.endsWith(`\0${taskId}`)) this.taskResourceInventoryCache.delete(key)
        }
    }

    private clearTaskCache(repoId: string, taskId: string): void {
        const key = taskKey(repoId, taskId)
        this.tasks.delete(key)
        this.taskLoadedAt.delete(key)
        this.clearProjectReadCachesForScope(repoId, taskId)
        this.clearTaskSnapshotArtifactCachesForScope(repoId, taskId)
        this.clearTaskImageCachesForScope(repoId, taskId)
        this.clearTaskResourceInventoryCachesForScope(repoId, taskId)
    }

    private clearProjectGitMetadataCaches(repoId: string): void {
        this.projectGitInfoCache.delete(repoId)
        for (const key of this.projectGitBranchesCache.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.projectGitBranchesCache.delete(key)
        }
    }

    private clearGitSummaryCacheForScope(repoId: string, taskId?: string): void {
        this.projectGitSummaryCache.delete(repoId)
        if (taskId !== undefined) {
            this.taskGitSummaryCache.delete(taskKey(repoId, taskId))
            this.clearTaskGitReadCachesForScope(repoId, taskId)
            return
        }
        for (const key of this.taskGitSummaryCache.keys()) {
            if (key.startsWith(`${repoId}\0`)) this.taskGitSummaryCache.delete(key)
        }
        this.clearTaskGitReadCachesForScope(repoId)
    }

    private clearTaskGitReadCachesForScope(repoId: string, taskId?: string): void {
        const scope = taskId === undefined ? `${repoId}\0` : `${repoId}\0${taskId}\0`
        for (const key of this.taskGitScopesCache.keys()) {
            if (key.startsWith(scope)) this.taskGitScopesCache.delete(key)
        }
        for (const key of this.taskGitLogCache.keys()) {
            if (key.startsWith(scope)) this.taskGitLogCache.delete(key)
        }
        for (const key of this.taskGitCommitFilesCache.keys()) {
            if (key.startsWith(scope)) this.taskGitCommitFilesCache.delete(key)
        }
        for (const key of this.taskGitFileAtTreeishCache.keys()) {
            if (key.startsWith(scope)) this.taskGitFileAtTreeishCache.delete(key)
        }
        for (const key of this.taskGitCommitFilePatchCache.keys()) {
            if (key.startsWith(scope)) this.taskGitCommitFilePatchCache.delete(key)
        }
        for (const key of this.taskChangesCache.keys()) {
            if (key.startsWith(scope)) this.taskChangesCache.delete(key)
        }
        for (const key of this.taskDiffCache.keys()) {
            if (key.startsWith(scope)) this.taskDiffCache.delete(key)
        }
        for (const key of this.taskFilePairCache.keys()) {
            if (key.startsWith(scope)) this.taskFilePairCache.delete(key)
        }
    }

    private clearTaskSnapshotArtifactCachesForScope(repoId: string, taskId?: string): void {
        const scope = taskId === undefined ? `${repoId}\0` : `${repoId}\0${taskId}\0`
        for (const key of this.taskSnapshotPatchCache.keys()) {
            if (key.startsWith(scope)) this.taskSnapshotPatchCache.delete(key)
        }
        for (const key of this.taskSnapshotIndexCache.keys()) {
            if (key.startsWith(scope)) this.taskSnapshotIndexCache.delete(key)
        }
        for (const key of this.taskSnapshotPatchSliceCache.keys()) {
            if (key.startsWith(scope)) this.taskSnapshotPatchSliceCache.delete(key)
        }
    }

    private clearTaskImageCachesForScope(repoId: string, taskId?: string): void {
        const scope = taskId === undefined ? `${repoId}\0` : `${repoId}\0${taskId}\0`
        for (const key of this.taskImageCache.keys()) {
            if (key.startsWith(scope)) this.taskImageCache.delete(key)
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
            if (key.startsWith(`${repoId}\0`)) this.tasks.delete(key)
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
    args: OpenADEProjectFilesTreeRequest | OpenADEProjectFileReadRequest | OpenADEProjectFilesFuzzySearchRequest | OpenADEProjectSearchRequest
): string {
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
    listProjects(): Promise<OpenADEProject[]>
    listTasks(repoId: string): Promise<OpenADETaskPreview[]>
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
    readCronDefinitions(args: OpenADECronDefinitionsReadRequest): Promise<OpenADECronDefinitionsReadResult>
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
