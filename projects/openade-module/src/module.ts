import type { RuntimeModule, RuntimeServer } from "../../runtime/src"
import type { RuntimeValidationResult } from "../../runtime-protocol/src"
import type {
    OpenADEActionEventCompleteRequest,
    OpenADEActionEventCreateRequest,
    OpenADEActionEventErrorRequest,
    OpenADEActionEventRuntimeReconcileRequest,
    OpenADEActionEventRuntimeReconcileResult,
    OpenADEActionEventStoppedRequest,
    OpenADEActionExecutionUpdateRequest,
    OpenADEActionStreamAppendRequest,
    OpenADECommentCreateRequest,
    OpenADECommentDeleteRequest,
    OpenADECommentEditRequest,
    OpenADEHyperPlanReconcileLabelsSetRequest,
    OpenADEHyperPlanStepPrimitive,
    OpenADEHyperPlanStrategy,
    OpenADEHyperPlanSubExecutionAddRequest,
    OpenADEHyperPlanSubExecutionStreamAppendRequest,
    OpenADEHyperPlanSubExecutionUpdateRequest,
    OpenADERepoCreateRequest,
    OpenADERepoCreateResult,
    OpenADERepoDeleteRequest,
    OpenADERepoUpdateRequest,
    OpenADEProject,
    OpenADEQueuedTurnCancelRequest,
    OpenADEQueuedTurnCancelResult,
    OpenADESnapshotEventCreateRequest,
    OpenADESnapshot,
    OpenADESnapshotEventCreateResult,
    OpenADETask,
    OpenADETaskReadOptions,
    OpenADETaskReadRequest,
    OpenADETaskDeleteRequest,
    OpenADETaskDeleteResult,
    OpenADETaskEnvironmentSetupRequest,
    OpenADETaskPreview,
    OpenADETaskMetadataUpdateRequest,
    OpenADEReviewStartRequest,
    OpenADETurnStartRequest,
} from "./types"

export type OpenADERuntimeBridgeEvent =
    | { type: "snapshot_changed"; at: string }
    | { type: "task_changed"; repoId: string; taskId: string; previewChanged?: boolean; at: string }
    | { type: "task_deleted"; repoId: string; taskId: string; at: string }
    | { type: "repo_changed"; repoId: string; at: string }
    | { type: "repo_deleted"; repoId: string; at: string }
    | { type: "working_tasks"; taskIds: string[]; at: string }
    | { type: "devices_changed"; at: string }

export interface OpenADEReadAdapter {
    readSnapshot(options?: { version?: string; hostName?: string; workingTaskIds?: string[] }): Promise<OpenADESnapshot>
    readProjects(options?: { workingTaskIds?: string[] }): Promise<OpenADEProject[]>
    readTaskList(repoId: string, options?: { workingTaskIds?: string[] }): Promise<OpenADETaskPreview[]>
    readTask(repoId: string, taskId: string, options?: OpenADETaskReadOptions): Promise<OpenADETask>
    listDataDocuments(): Promise<string[]>
    readDataDocumentBase64(id: string): Promise<{ id: string; data: string } | null>
}

export interface OpenADEWriteAdapter {
    saveDataDocumentBase64(id: string, data: string): Promise<unknown>
    deleteDataDocument(id: string): Promise<unknown>
    createRepo(params: OpenADERepoCreateRequest): Promise<OpenADERepoCreateResult>
    updateRepo(params: OpenADERepoUpdateRequest): Promise<unknown>
    deleteRepo(params: OpenADERepoDeleteRequest): Promise<unknown>
    startTurn(params: OpenADETurnStartRequest, context?: OpenADETurnStartContext): Promise<unknown>
    startReview(params: OpenADEReviewStartRequest, context?: OpenADETurnStartContext): Promise<unknown>
    interruptTurn(params: { taskId: string }): Promise<unknown>
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
}

export interface OpenADETurnStartContext {
    runtimeId: string
    requestKey: string
}

export interface OpenADEModuleAdapters extends OpenADEReadAdapter, OpenADEWriteAdapter {
    version?: () => string | undefined
    createId?: () => string
    clientRequestRetentionMs?: number
}

interface ClientRequestEntry {
    promise: Promise<unknown>
    cleanupTimer: ReturnType<typeof setTimeout> | null
}

const DEFAULT_CLIENT_REQUEST_RETENTION_MS = 10 * 60 * 1000

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

function optionalStringParam(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key]
    return typeof value === "string" && value.length > 0 ? value : undefined
}

function booleanParam(record: Record<string, unknown>, key: string): boolean | undefined {
    const value = record[key]
    return typeof value === "boolean" ? value : undefined
}

function stringArrayParam(record: Record<string, unknown>, key: string): string[] | undefined {
    const value = record[key]
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined
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
    }
}

function repoDeleteParams(params: unknown): OpenADERepoDeleteRequest {
    const record = asRecord(params)
    return {
        repoId: stringParam(record, "repoId"),
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

    return {
        repoId,
        type: record.type,
        input,
        clientRequestId: typeof record.clientRequestId === "string" ? record.clientRequestId : undefined,
        appendSystemPrompt: typeof record.appendSystemPrompt === "string" ? record.appendSystemPrompt : undefined,
        inTaskId: record.inTaskId === null ? null : typeof record.inTaskId === "string" ? record.inTaskId : undefined,
        isolationStrategy: record.isolationStrategy as OpenADETurnStartRequest["isolationStrategy"],
        enabledMcpServerIds: Array.isArray(record.enabledMcpServerIds) ? record.enabledMcpServerIds.filter((id): id is string => typeof id === "string") : undefined,
        harnessId: typeof record.harnessId === "string" ? record.harnessId : undefined,
        modelId: typeof record.modelId === "string" ? record.modelId : undefined,
        label: typeof record.label === "string" ? record.label : undefined,
        includeComments: typeof record.includeComments === "boolean" ? record.includeComments : undefined,
        images: Array.isArray(record.images) ? record.images : undefined,
        thinking: record.thinking === "low" || record.thinking === "med" || record.thinking === "high" || record.thinking === "max" ? record.thinking : undefined,
        fastMode: typeof record.fastMode === "boolean" ? record.fastMode : undefined,
        title: typeof record.title === "string" ? record.title : undefined,
        hyperplanStrategy: hyperplanStrategyParam(record.hyperplanStrategy),
    }
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
    }
}

function commentDeleteParams(params: unknown): OpenADECommentDeleteRequest {
    const record = asRecord(params)
    return {
        taskId: stringParam(record, "taskId"),
        commentId: stringParam(record, "commentId"),
        updatedAt: optionalStringParam(record, "updatedAt"),
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

function dataDocumentIdParam(params: unknown): string {
    return stringParam(asRecord(params), "id")
}

function dataDocumentSaveParams(params: unknown): { id: string; data: string } {
    const record = asRecord(params)
    const id = stringParam(record, "id")
    const data = stringParam(record, "data")
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
        throw new Error("data is invalid")
    }
    return { id, data }
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

export function createOpenADEModule(adapters: OpenADEModuleAdapters): RuntimeModule {
    const clientRequests = new Map<string, ClientRequestEntry>()
    const createId = adapters.createId ?? createFallbackId
    const clientRequestRetentionMs = adapters.clientRequestRetentionMs ?? DEFAULT_CLIENT_REQUEST_RETENTION_MS

    function runIdempotentMutation<T>(scope: string, params: unknown, action: () => Promise<T> | T): Promise<T> {
        const clientRequestId = stableClientRequestKey(params)
        if (!clientRequestId) return Promise.resolve().then(action)

        const key = `mutation:${scope}:${clientRequestId}`
        const existing = clientRequests.get(key)
        if (existing) return existing.promise as Promise<T>

        let retainStableResult = false
        const request = Promise.resolve()
            .then(action)
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
            server.registerNotification("openade/snapshotChanged")
            server.registerNotification("openade/repo/updated")
            server.registerNotification("openade/repo/deleted")
            server.registerNotification("openade/task/previewChanged")
            server.registerNotification("openade/task/updated")
            server.registerNotification("openade/task/deleted")
            server.registerNotification("openade/workingTasks")
            server.registerNotification("remote/device/changed")

            server.register("openade/snapshot/read", (_params, context) =>
                adapters.readSnapshot({
                    version: adapters.version?.() ?? "local",
                    workingTaskIds: activeOpenADETaskIds(context.server),
                })
            )
            server.register("openade/project/list", (_params, context) =>
                adapters.readProjects({ workingTaskIds: activeOpenADETaskIds(context.server) })
            )
            server.register("openade/task/list", (params, context) => {
                const { repoId } = taskListParams(params)
                return adapters.readTaskList(repoId, { workingTaskIds: activeOpenADETaskIds(context.server) })
            }, { validateParams: validateWith(taskListParams) })
            server.register("openade/task/read", (params) => {
                const { repoId, taskId, hydrateSessionEvents } = taskReadParams(params)
                return adapters.readTask(repoId, taskId, { hydrateSessionEvents })
            }, { validateParams: validateWith(taskReadParams) })
            server.register("openade/repo/create", (params) => runIdempotentMutation("openade/repo/create", params, () => adapters.createRepo(repoCreateParams(params))), {
                validateParams: validateWith(repoCreateParams),
            })
            server.register("openade/repo/update", (params) => runIdempotentMutation("openade/repo/update", params, () => adapters.updateRepo(repoUpdateParams(params))), {
                validateParams: validateWith(repoUpdateParams),
            })
            server.register("openade/repo/delete", (params) => runIdempotentMutation("openade/repo/delete", params, () => adapters.deleteRepo(repoDeleteParams(params))), {
                validateParams: validateWith(repoDeleteParams),
            })
            server.register("openade/turn/start", (params) => {
                const stableKey = stableClientRequestKey(params)
                const requestKey = stableKey ?? createId()
                const clientKey = stableKey ? `openade/turn/start:${stableKey}` : requestKey
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
                    .startTurn(turnParams(params), { runtimeId, requestKey })
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
                clientRequests.set(clientKey, { promise: request, cleanupTimer: null })
                return request
            }, { validateParams: validateWith(turnParams) })
            server.register("openade/review/start", (params) => {
                const stableKey = stableClientRequestKey(params)
                const requestKey = stableKey ?? createId()
                const clientKey = stableKey ? `openade/review/start:${stableKey}` : requestKey
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
                    .startReview(reviewStartParams(params), { runtimeId, requestKey })
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
                clientRequests.set(clientKey, { promise: request, cleanupTimer: null })
                return request
            }, { validateParams: validateWith(reviewStartParams) })
            server.register("openade/turn/interrupt", (params) => runIdempotentMutation("openade/turn/interrupt", params, () => {
                return adapters.interruptTurn(turnInterruptParams(params))
            }), { validateParams: validateWith(turnInterruptParams) })
            server.register("openade/queued-turn/cancel", (params) => runIdempotentMutation("openade/queued-turn/cancel", params, () => {
                return adapters.cancelQueuedTurn(queuedTurnCancelParams(params))
            }), { validateParams: validateWith(queuedTurnCancelParams) })
            server.register("openade/task/environment/setup", (params) =>
                runIdempotentMutation("openade/task/environment/setup", params, () => adapters.setupTaskEnvironment(taskEnvironmentSetupParams(params)))
            , { validateParams: validateWith(taskEnvironmentSetupParams) })
            server.register("openade/action/create", (params) =>
                runIdempotentMutation("openade/action/create", params, () => adapters.createActionEvent(createActionEventParams(params)))
            , { validateParams: validateWith(createActionEventParams) })
            server.register("openade/action/stream/append", (params) =>
                runIdempotentMutation("openade/action/stream/append", params, () => adapters.appendActionStreamEvent(appendActionStreamEventParams(params)))
            , { validateParams: validateWith(appendActionStreamEventParams) })
            server.register("openade/action/complete", (params) =>
                runIdempotentMutation("openade/action/complete", params, () => adapters.completeActionEvent(completeActionEventParams(params)))
            , { validateParams: validateWith(completeActionEventParams) })
            server.register("openade/action/error", (params) =>
                runIdempotentMutation("openade/action/error", params, () => adapters.errorActionEvent(errorActionEventParams(params)))
            , { validateParams: validateWith(errorActionEventParams) })
            server.register("openade/action/stopped", (params) =>
                runIdempotentMutation("openade/action/stopped", params, () => adapters.stoppedActionEvent(stoppedActionEventParams(params)))
            , { validateParams: validateWith(stoppedActionEventParams) })
            server.register("openade/action/reconcileRuntime", (params) =>
                runIdempotentMutation("openade/action/reconcileRuntime", params, () =>
                    adapters.reconcileActionEventRuntime(reconcileActionEventRuntimeParams(params))
                )
            , { validateParams: validateWith(reconcileActionEventRuntimeParams) })
            server.register("openade/action/execution/update", (params) =>
                runIdempotentMutation("openade/action/execution/update", params, () => adapters.updateActionExecution(actionExecutionUpdateParams(params)))
            , { validateParams: validateWith(actionExecutionUpdateParams) })
            server.register("openade/hyperplan/subExecution/add", (params) =>
                runIdempotentMutation("openade/hyperplan/subExecution/add", params, () => adapters.addHyperPlanSubExecution(hyperplanSubExecutionAddParams(params)))
            , { validateParams: validateWith(hyperplanSubExecutionAddParams) })
            server.register("openade/hyperplan/subExecution/stream/append", (params) =>
                runIdempotentMutation("openade/hyperplan/subExecution/stream/append", params, () =>
                    adapters.appendHyperPlanSubExecutionStreamEvent(hyperplanSubExecutionStreamAppendParams(params))
                )
            , { validateParams: validateWith(hyperplanSubExecutionStreamAppendParams) })
            server.register("openade/hyperplan/subExecution/update", (params) =>
                runIdempotentMutation("openade/hyperplan/subExecution/update", params, () =>
                    adapters.updateHyperPlanSubExecution(hyperplanSubExecutionUpdateParams(params))
                )
            , { validateParams: validateWith(hyperplanSubExecutionUpdateParams) })
            server.register("openade/hyperplan/reconcileLabels/set", (params) =>
                runIdempotentMutation("openade/hyperplan/reconcileLabels/set", params, () =>
                    adapters.setHyperPlanReconcileLabels(hyperplanReconcileLabelsSetParams(params))
                )
            , { validateParams: validateWith(hyperplanReconcileLabelsSetParams) })
            server.register("openade/snapshot/create", (params) =>
                runIdempotentMutation("openade/snapshot/create", params, () => adapters.createSnapshotEvent(snapshotEventCreateParams(params)))
            , { validateParams: validateWith(snapshotEventCreateParams) })
            server.register("openade/comment/create", (params) =>
                runIdempotentMutation("openade/comment/create", params, () => adapters.createComment(commentCreateParams(params)))
            , { validateParams: validateWith(commentCreateParams) })
            server.register("openade/comment/edit", (params) =>
                runIdempotentMutation("openade/comment/edit", params, () => adapters.editComment(commentEditParams(params)))
            , { validateParams: validateWith(commentEditParams) })
            server.register("openade/comment/delete", (params) =>
                runIdempotentMutation("openade/comment/delete", params, () => adapters.deleteComment(commentDeleteParams(params)))
            , { validateParams: validateWith(commentDeleteParams) })
            server.register("openade/task/metadata/update", (params) =>
                runIdempotentMutation("openade/task/metadata/update", params, () => adapters.updateTaskMetadata(taskMetadataUpdateParams(params)))
            , { validateParams: validateWith(taskMetadataUpdateParams) })
            server.register("openade/task/delete", (params) =>
                runIdempotentMutation("openade/task/delete", params, () => adapters.deleteTask(taskDeleteParams(params)))
            , { validateParams: validateWith(taskDeleteParams) })
            server.register("data/yjs/list", () => adapters.listDataDocuments())
            server.register("data/yjs/read", (params) => {
                return adapters.readDataDocumentBase64(dataDocumentIdParam(params))
            }, { validateParams: validateWith(dataDocumentIdParam) })
            server.register("data/yjs/save", (params) => {
                return runIdempotentMutation("data/yjs/save", params, () => {
                    const { id, data } = dataDocumentSaveParams(params)
                    return adapters.saveDataDocumentBase64(id, data)
                })
            }, { validateParams: validateWith(dataDocumentSaveParams) })
            server.register("data/yjs/delete", (params) =>
                runIdempotentMutation("data/yjs/delete", params, () => adapters.deleteDataDocument(dataDocumentIdParam(params)))
            , { validateParams: validateWith(dataDocumentIdParam) })
        },
    }
}

export function publishOpenADECompanionEvent(server: RuntimeServer, event: OpenADERuntimeBridgeEvent): void {
    switch (event.type) {
        case "snapshot_changed":
            server.notify("openade/snapshotChanged", event)
            break
        case "repo_changed":
            server.notify("openade/repo/updated", event)
            server.notify("openade/snapshotChanged", event)
            break
        case "repo_deleted":
            server.notify("openade/repo/deleted", event)
            server.notify("openade/snapshotChanged", event)
            break
        case "task_changed":
            server.supervisor.touchByOwner("openade-task", event.taskId)
            server.notify("openade/task/updated", event)
            if (event.previewChanged !== false) server.notify("openade/task/previewChanged", event)
            break
        case "task_deleted":
            server.notify("openade/task/deleted", event)
            server.notify("openade/task/previewChanged", event)
            server.notify("openade/snapshotChanged", event)
            break
        case "working_tasks":
            for (const runtime of server.supervisor.list({ ownerType: "openade-task" })) {
                if (runtime.scope.ownerId && event.taskIds.includes(runtime.scope.ownerId)) {
                    const updated = server.supervisor.update(runtime.runtimeId, { status: "running" })
                    server.notify("runtime/updated", updated)
                } else if (runtime.status === "running" || runtime.status === "starting") {
                    const updated = server.supervisor.update(runtime.runtimeId, { status: "completed" })
                    server.notify("runtime/completed", updated)
                }
            }
            server.notify("openade/workingTasks", event)
            break
        case "devices_changed":
            server.notify("remote/device/changed", event)
            break
    }
}
