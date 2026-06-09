import type {
    OpenADEActionEventCreateRequest,
    OpenADEActionEventSource,
    OpenADEActionExecutionUpdateRequest,
    OpenADEActionStreamAppendRequest,
    OpenADECommentCreateRequest,
    OpenADEEventStatus,
    OpenADEGitRefs,
    OpenADEHyperPlanStepPrimitive,
    OpenADEHyperPlanSubExecution,
    OpenADEHyperPlanSubExecutionAddRequest,
    OpenADEHyperPlanSubExecutionStreamAppendRequest,
    OpenADEHyperPlanSubExecutionUpdateRequest,
    OpenADEProject,
    OpenADEQueuedTurnImportLegacyRequest,
    OpenADEQueuedTurnImportLegacyResult,
    OpenADERepoCreateRequest,
    OpenADERepoCreateResult,
    OpenADERepoUpdateRequest,
    OpenADESnapshotChangedFile,
    OpenADESnapshotEventCreateRequest,
    OpenADESnapshotEventCreateResult,
    OpenADETask,
    OpenADETaskCreateRequest,
    OpenADETaskCreateResult,
    OpenADETaskDeviceEnvironment,
    OpenADETaskMetadataUpdateRequest,
    OpenADETaskPreview,
    OpenADEUser,
} from "./types"
import type { OpenADEYjsProjection } from "./yjsProjection"

export interface OpenADELegacyYjsImportWriter {
    createRepo(params: OpenADERepoCreateRequest): Promise<OpenADERepoCreateResult>
    updateRepo(params: OpenADERepoUpdateRequest): Promise<unknown>
    createTask(params: OpenADETaskCreateRequest): Promise<OpenADETaskCreateResult>
    setupTaskEnvironment(params: OpenADETaskEnvironmentSetupImportRequest): Promise<unknown>
    createActionEvent(params: OpenADEActionEventCreateRequest): Promise<unknown>
    appendActionStreamEvent(params: OpenADEActionStreamAppendRequest): Promise<unknown>
    completeActionEvent(params: { taskId: string; eventId: string; success: boolean; completedAt?: string; clientRequestId?: string }): Promise<unknown>
    errorActionEvent(params: { taskId: string; eventId: string; completedAt?: string; clientRequestId?: string }): Promise<unknown>
    stoppedActionEvent(params: { taskId: string; eventId: string; completedAt?: string; sessionId?: string; parentSessionId?: string; clientRequestId?: string }): Promise<unknown>
    updateActionExecution(params: OpenADEActionExecutionUpdateRequest): Promise<unknown>
    addHyperPlanSubExecution(params: OpenADEHyperPlanSubExecutionAddRequest): Promise<unknown>
    appendHyperPlanSubExecutionStreamEvent(params: OpenADEHyperPlanSubExecutionStreamAppendRequest): Promise<unknown>
    updateHyperPlanSubExecution(params: OpenADEHyperPlanSubExecutionUpdateRequest): Promise<unknown>
    createSnapshotEvent(params: OpenADESnapshotEventCreateRequest): Promise<OpenADESnapshotEventCreateResult>
    createComment(params: OpenADECommentCreateRequest): Promise<unknown>
    importLegacyQueuedTurn?(params: OpenADEQueuedTurnImportLegacyRequest): Promise<OpenADEQueuedTurnImportLegacyResult>
    updateTaskMetadata(params: OpenADETaskMetadataUpdateRequest): Promise<unknown>
}

type OpenADETaskEnvironmentSetupImportRequest = {
    taskId: string
    deviceEnvironment: OpenADETaskDeviceEnvironment
    setupEvent?: {
        taskId?: string
        eventId?: string
        worktreeId: string
        deviceId: string
        workingDir: string
        setupOutput?: string
        createdAt?: string
        completedAt?: string
    }
    clientRequestId?: string
}

export interface OpenADELegacyYjsImportOptions {
    createdBy?: OpenADEUser
    deviceId?: string
    taskIds?: string[]
    repoIds?: string[]
}

export type OpenADELegacyYjsImportSkippedCode =
    | "task_unavailable"
    | "setup_event_missing_fields"
    | "action_event_missing_source"
    | "action_stream_event_missing_id"
    | "hyperplan_sub_execution_invalid"
    | "snapshot_event_missing_fields"
    | "snapshot_file_invalid"
    | "comment_missing_content"
    | "queued_turn_requires_non_executing_bulk_import"
    | "core_metadata_field_unsupported"
    | "unsupported_event_type"

export interface OpenADELegacyYjsImportSkippedItem {
    repoId?: string
    taskId?: string
    eventId?: string
    commentId?: string
    queuedTurnId?: string
    field?: string
    code: OpenADELegacyYjsImportSkippedCode
}

export interface OpenADELegacyYjsImportError {
    scope: "repo" | "task" | "event" | "comment" | "queuedTurn" | "metadata"
    repoId?: string
    taskId?: string
    eventId?: string
    commentId?: string
    queuedTurnId?: string
    code: string
    message: string
}

export interface OpenADELegacyYjsImportResult {
    scannedRepos: number
    importedRepos: number
    scannedTasks: number
    importedTasks: number
    importedSetupEvents: number
    importedActionEvents: number
    importedActionStreamEvents: number
    importedHyperPlanSubExecutions: number
    importedSnapshotEvents: number
    importedComments: number
    importedQueuedTurns: number
    skipped: OpenADELegacyYjsImportSkippedItem[]
    errors: OpenADELegacyYjsImportError[]
}

const fallbackUser: OpenADEUser = { id: "legacy-import", email: "legacy-import@openade.local" }
const fallbackTime = new Date(0).toISOString()

export async function importOpenADELegacyYjsData(
    projection: OpenADEYjsProjection,
    writer: OpenADELegacyYjsImportWriter,
    options: OpenADELegacyYjsImportOptions = {}
): Promise<OpenADELegacyYjsImportResult> {
    const result = emptyImportResult()
    const repoFilter = options.repoIds ? new Set(options.repoIds) : null
    const taskFilter = options.taskIds ? new Set(options.taskIds) : null
    const projects = (await projection.readProjects()).filter((project) => !repoFilter || repoFilter.has(project.id))
    result.scannedRepos = projects.length

    for (const project of projects) {
        const repoImported = await importRepo(writer, project, result, options)
        if (!repoImported) continue

        for (const preview of project.tasks) {
            if (taskFilter && !taskFilter.has(preview.id)) continue
            result.scannedTasks += 1
            let task: OpenADETask
            try {
                task = await projection.readTask(project.id, preview.id, { hydrateSessionEvents: true })
            } catch (error) {
                result.skipped.push({ repoId: project.id, taskId: preview.id, code: "task_unavailable" })
                pushImportError(result, "task", error, { repoId: project.id, taskId: preview.id })
                continue
            }
            await importTask(writer, project, preview, task, result, options)
        }
    }

    return result
}

function emptyImportResult(): OpenADELegacyYjsImportResult {
    return {
        scannedRepos: 0,
        importedRepos: 0,
        scannedTasks: 0,
        importedTasks: 0,
        importedSetupEvents: 0,
        importedActionEvents: 0,
        importedActionStreamEvents: 0,
        importedHyperPlanSubExecutions: 0,
        importedSnapshotEvents: 0,
        importedComments: 0,
        importedQueuedTurns: 0,
        skipped: [],
        errors: [],
    }
}

async function importRepo(
    writer: OpenADELegacyYjsImportWriter,
    project: OpenADEProject,
    result: OpenADELegacyYjsImportResult,
    options: OpenADELegacyYjsImportOptions
): Promise<boolean> {
    try {
        await writer.createRepo({
            repoId: project.id,
            name: project.name,
            path: project.path,
            createdBy: options.createdBy ?? fallbackUser,
            clientRequestId: importClientRequestId("repo", project.id),
        })
        if (project.archived !== undefined) {
            await writer.updateRepo({
                repoId: project.id,
                archived: project.archived,
                clientRequestId: importClientRequestId("repo-archive", project.id),
            })
        }
        result.importedRepos += 1
        return true
    } catch (error) {
        pushImportError(result, "repo", error, { repoId: project.id })
        return false
    }
}

async function importTask(
    writer: OpenADELegacyYjsImportWriter,
    project: OpenADEProject,
    preview: OpenADETaskPreview,
    task: OpenADETask,
    result: OpenADELegacyYjsImportResult,
    options: OpenADELegacyYjsImportOptions
): Promise<void> {
    const deviceEnvironment = firstDeviceEnvironment(task.deviceEnvironments)
    const deviceId = deviceEnvironment?.deviceId ?? options.deviceId ?? "legacy-import-device"
    try {
        await writer.createTask({
            repoId: project.id,
            taskId: task.id,
            slug: task.slug || preview.slug || task.id,
            title: task.title || preview.title || "Untitled task",
            input: task.description,
            createdBy: task.createdBy ?? options.createdBy ?? fallbackUser,
            deviceId,
            createdAt: task.createdAt,
            isolationStrategy: task.isolationStrategy,
            enabledMcpServerIds: task.enabledMcpServerIds,
            deviceEnvironment,
            clientRequestId: importClientRequestId("task", project.id, task.id),
        })
        result.importedTasks += 1
    } catch (error) {
        pushImportError(result, "task", error, { repoId: project.id, taskId: task.id })
        return
    }

    await importTaskEvents(writer, task, result)
    await importTaskComments(writer, task, result, options)
    await importQueuedTurns(writer, project.id, task, result)
    await importSupportedTaskMetadata(writer, task, preview, result)
}

async function importTaskEvents(writer: OpenADELegacyYjsImportWriter, task: OpenADETask, result: OpenADELegacyYjsImportResult): Promise<void> {
    for (const event of task.events) {
        if (!isRecord(event)) continue
        const type = stringValue(event.type)
        if (type === "setup_environment") {
            await importSetupEvent(writer, task, event, result)
        } else if (type === "action") {
            await importActionEvent(writer, task, event, result)
        } else if (type === "snapshot") {
            await importSnapshotEvent(writer, task, event, result)
        } else {
            result.skipped.push({ taskId: task.id, eventId: optionalString(event.id), code: "unsupported_event_type" })
        }
    }
}

async function importSetupEvent(
    writer: OpenADELegacyYjsImportWriter,
    task: OpenADETask,
    event: Record<string, unknown>,
    result: OpenADELegacyYjsImportResult
): Promise<void> {
    const eventId = optionalString(event.id)
    const deviceId = optionalString(event.deviceId)
    const workingDir = optionalString(event.workingDir)
    const worktreeId = optionalString(event.worktreeId)
    if (!eventId || !deviceId || !workingDir || !worktreeId) {
        result.skipped.push({ taskId: task.id, eventId, code: "setup_event_missing_fields" })
        return
    }
    const createdAt = optionalString(event.createdAt) ?? fallbackTime
    const environment =
        task.deviceEnvironments.find((candidate) => candidate.deviceId === deviceId || candidate.id === deviceId) ??
        fallbackDeviceEnvironment(deviceId, createdAt)
    try {
        await writer.setupTaskEnvironment({
            taskId: task.id,
            deviceEnvironment: environment,
            setupEvent: {
                taskId: task.id,
                eventId,
                worktreeId,
                deviceId,
                workingDir,
                setupOutput: optionalString(event.setupOutput),
                createdAt,
                completedAt: optionalString(event.completedAt) ?? createdAt,
            },
            clientRequestId: importClientRequestId("setup", task.id, eventId),
        })
        result.importedSetupEvents += 1
    } catch (error) {
        pushImportError(result, "event", error, { taskId: task.id, eventId })
    }
}

async function importActionEvent(
    writer: OpenADELegacyYjsImportWriter,
    task: OpenADETask,
    event: Record<string, unknown>,
    result: OpenADELegacyYjsImportResult
): Promise<void> {
    const eventId = optionalString(event.id)
    const execution = isRecord(event.execution) ? event.execution : {}
    const source = actionSource(event.source)
    if (!eventId || !source) {
        result.skipped.push({ taskId: task.id, eventId, code: "action_event_missing_source" })
        return
    }

    try {
        await writer.createActionEvent({
            taskId: task.id,
            eventId,
            createdAt: optionalString(event.createdAt),
            userInput: stringValue(event.userInput, "Imported legacy action"),
            executionId: optionalString(execution.executionId) ?? `legacy-execution-${eventId}`,
            harnessId: optionalString(execution.harnessId) ?? "legacy-import",
            source,
            images: arrayValue(event.images),
            includesCommentIds: stringArray(event.includesCommentIds),
            modelId: optionalString(execution.modelId),
            fastMode: optionalBoolean(execution.fastMode),
            gitRefsBefore: gitRefs(execution.gitRefsBefore),
            clientRequestId: importClientRequestId("action", task.id, eventId),
        })
        result.importedActionEvents += 1
    } catch (error) {
        pushImportError(result, "event", error, { taskId: task.id, eventId })
        return
    }

    await importActionStreamEvents(writer, task.id, eventId, execution, result)
    await importHyperPlanSubExecutions(writer, task.id, eventId, event, result)
    await updateImportedActionExecution(writer, task.id, eventId, execution, result)
    await settleImportedAction(writer, task.id, eventId, event, execution, result)
}

async function importActionStreamEvents(
    writer: OpenADELegacyYjsImportWriter,
    taskId: string,
    eventId: string,
    execution: Record<string, unknown>,
    result: OpenADELegacyYjsImportResult
): Promise<void> {
    const events = arrayValue(execution.events)
    for (const streamEvent of events) {
        if (!isRecord(streamEvent) || typeof streamEvent.id !== "string" || streamEvent.id.length < 1) {
            result.skipped.push({ taskId, eventId, code: "action_stream_event_missing_id" })
            continue
        }
        try {
            await writer.appendActionStreamEvent({
                taskId,
                eventId,
                streamEvent: { ...streamEvent, id: streamEvent.id },
                clientRequestId: importClientRequestId("action-stream", taskId, eventId, streamEvent.id),
            })
            result.importedActionStreamEvents += 1
        } catch (error) {
            pushImportError(result, "event", error, { taskId, eventId })
        }
    }
}

async function importHyperPlanSubExecutions(
    writer: OpenADELegacyYjsImportWriter,
    taskId: string,
    eventId: string,
    event: Record<string, unknown>,
    result: OpenADELegacyYjsImportResult
): Promise<void> {
    for (const rawSubExecution of arrayValue(event.hyperplanSubExecutions)) {
        const subExecution = hyperPlanSubExecution(rawSubExecution)
        if (!subExecution) {
            result.skipped.push({ taskId, eventId, code: "hyperplan_sub_execution_invalid" })
            continue
        }
        try {
            await writer.addHyperPlanSubExecution({
                taskId,
                eventId,
                subExecution: { ...subExecution, events: [] },
                clientRequestId: importClientRequestId("hyperplan-sub", taskId, eventId, subExecution.stepId),
            })
            result.importedHyperPlanSubExecutions += 1
        } catch (error) {
            pushImportError(result, "event", error, { taskId, eventId })
            continue
        }
        for (const streamEvent of subExecution.events) {
            try {
                await writer.appendHyperPlanSubExecutionStreamEvent({
                    taskId,
                    eventId,
                    stepId: subExecution.stepId,
                    streamEvent,
                    clientRequestId: importClientRequestId("hyperplan-sub-stream", taskId, eventId, subExecution.stepId, streamEvent.id),
                })
            } catch (error) {
                pushImportError(result, "event", error, { taskId, eventId })
            }
        }
        try {
            await writer.updateHyperPlanSubExecution({
                taskId,
                eventId,
                stepId: subExecution.stepId,
                executionId: subExecution.executionId,
                sessionId: subExecution.sessionId,
                parentSessionId: subExecution.parentSessionId,
                status: subExecution.status,
                resultText: subExecution.resultText,
                error: subExecution.error,
                reconcileLabel: subExecution.reconcileLabel,
                clientRequestId: importClientRequestId("hyperplan-sub-update", taskId, eventId, subExecution.stepId),
            })
        } catch (error) {
            pushImportError(result, "event", error, { taskId, eventId })
        }
    }
}

async function updateImportedActionExecution(
    writer: OpenADELegacyYjsImportWriter,
    taskId: string,
    eventId: string,
    execution: Record<string, unknown>,
    result: OpenADELegacyYjsImportResult
): Promise<void> {
    const update: OpenADEActionExecutionUpdateRequest = {
        taskId,
        eventId,
        sessionId: optionalString(execution.sessionId),
        parentSessionId: optionalString(execution.parentSessionId),
        gitRefsAfter: gitRefs(execution.gitRefsAfter),
        clientRequestId: importClientRequestId("action-execution", taskId, eventId),
    }
    if (!update.sessionId && !update.parentSessionId && !update.gitRefsAfter) return
    try {
        await writer.updateActionExecution(update)
    } catch (error) {
        pushImportError(result, "event", error, { taskId, eventId })
    }
}

async function settleImportedAction(
    writer: OpenADELegacyYjsImportWriter,
    taskId: string,
    eventId: string,
    event: Record<string, unknown>,
    execution: Record<string, unknown>,
    result: OpenADELegacyYjsImportResult
): Promise<void> {
    const status = eventStatus(event.status)
    if (!status || status === "in_progress") return
    const completedAt = optionalString(event.completedAt) ?? optionalString(event.createdAt)
    try {
        if (status === "completed") {
            await writer.completeActionEvent({
                taskId,
                eventId,
                success: actionSuccess(event.result),
                completedAt,
                clientRequestId: importClientRequestId("action-complete", taskId, eventId),
            })
        } else if (status === "error") {
            await writer.errorActionEvent({
                taskId,
                eventId,
                completedAt,
                clientRequestId: importClientRequestId("action-error", taskId, eventId),
            })
        } else {
            await writer.stoppedActionEvent({
                taskId,
                eventId,
                completedAt,
                sessionId: optionalString(execution.sessionId),
                parentSessionId: optionalString(execution.parentSessionId),
                clientRequestId: importClientRequestId("action-stopped", taskId, eventId),
            })
        }
    } catch (error) {
        pushImportError(result, "event", error, { taskId, eventId })
    }
}

async function importSnapshotEvent(
    writer: OpenADELegacyYjsImportWriter,
    task: OpenADETask,
    event: Record<string, unknown>,
    result: OpenADELegacyYjsImportResult
): Promise<void> {
    const eventId = optionalString(event.id)
    const actionEventId = optionalString(event.actionEventId)
    const referenceBranch = optionalString(event.referenceBranch)
    const mergeBaseCommit = optionalString(event.mergeBaseCommit)
    const stats = snapshotStats(event.stats)
    const files = snapshotFiles(event.files, result, task.id, eventId)
    if (!eventId || !actionEventId || !referenceBranch || !mergeBaseCommit || !stats) {
        result.skipped.push({ taskId: task.id, eventId, code: "snapshot_event_missing_fields" })
        return
    }
    try {
        await writer.createSnapshotEvent({
            taskId: task.id,
            actionEventId,
            referenceBranch,
            mergeBaseCommit,
            fullPatch: stringValue(event.fullPatch),
            patchFileId: optionalString(event.patchFileId),
            stats,
            files,
            eventId,
            createdAt: optionalString(event.createdAt),
            clientRequestId: importClientRequestId("snapshot", task.id, eventId),
        })
        result.importedSnapshotEvents += 1
    } catch (error) {
        pushImportError(result, "event", error, { taskId: task.id, eventId })
    }
}

async function importTaskComments(
    writer: OpenADELegacyYjsImportWriter,
    task: OpenADETask,
    result: OpenADELegacyYjsImportResult,
    options: OpenADELegacyYjsImportOptions
): Promise<void> {
    for (const comment of task.comments) {
        if (!isRecord(comment)) continue
        const commentId = optionalString(comment.id)
        const content = optionalString(comment.content)
        if (!content) {
            result.skipped.push({ taskId: task.id, commentId, code: "comment_missing_content" })
            continue
        }
        const request: OpenADECommentCreateRequest = {
            taskId: task.id,
            commentId,
            content,
            source: isRecord(comment.source) ? comment.source : {},
            selectedText: selectedText(comment.selectedText),
            author: user(comment.author) ?? options.createdBy ?? fallbackUser,
            createdAt: optionalString(comment.createdAt),
            clientRequestId: importClientRequestId("comment", task.id, commentId ?? content),
        }
        try {
            await writer.createComment(request)
            result.importedComments += 1
        } catch (error) {
            pushImportError(result, "comment", error, { taskId: task.id, commentId })
        }
    }
}

async function importSupportedTaskMetadata(
    writer: OpenADELegacyYjsImportWriter,
    task: OpenADETask,
    preview: OpenADETaskPreview,
    result: OpenADELegacyYjsImportResult
): Promise<void> {
    const update: OpenADETaskMetadataUpdateRequest = {
        taskId: task.id,
        title: task.title || preview.title,
        closed: task.closed,
        lastViewedAt: task.lastViewedAt ?? preview.lastViewedAt,
        lastEventAt: task.lastEventAt ?? preview.lastEventAt,
        cancelledPlanEventId: task.cancelledPlanEventId,
        sessionIds: task.sessionIds,
        usage: preview.usage,
        updatedAt: task.updatedAt,
        clientRequestId: importClientRequestId("task-metadata", task.id),
    }
    if (
        update.title === undefined &&
            update.closed === undefined &&
            update.lastViewedAt === undefined &&
            update.lastEventAt === undefined &&
            update.cancelledPlanEventId === undefined &&
            update.sessionIds === undefined &&
            update.usage === undefined &&
            update.updatedAt === undefined
    ) {
        return
    }
    try {
        await writer.updateTaskMetadata(update)
    } catch (error) {
        pushImportError(result, "metadata", error, { taskId: task.id })
    }
}

async function importQueuedTurns(
    writer: OpenADELegacyYjsImportWriter,
    repoId: string,
    task: OpenADETask,
    result: OpenADELegacyYjsImportResult
): Promise<void> {
    for (const [index, turn] of (task.queuedTurns ?? []).entries()) {
        if (!writer.importLegacyQueuedTurn) {
            result.skipped.push({
                taskId: task.id,
                queuedTurnId: turn.id,
                code: "queued_turn_requires_non_executing_bulk_import",
            })
            continue
        }
        try {
            const imported = await writer.importLegacyQueuedTurn({
                repoId,
                taskId: task.id,
                turn,
                position: index + 1,
                clientRequestId: importClientRequestId("queued-turn", task.id, turn.id),
            })
            if (imported.imported) result.importedQueuedTurns += 1
        } catch (error) {
            pushImportError(result, "queuedTurn", error, { repoId, taskId: task.id, queuedTurnId: turn.id })
        }
    }
}

function firstDeviceEnvironment(environments: OpenADETaskDeviceEnvironment[]): OpenADETaskDeviceEnvironment | undefined {
    return environments.find((environment) => environment.id.length > 0 && environment.deviceId.length > 0)
}

function fallbackDeviceEnvironment(deviceId: string, createdAt: string): OpenADETaskDeviceEnvironment {
    return {
        id: deviceId,
        deviceId,
        setupComplete: true,
        createdAt,
        lastUsedAt: createdAt,
    }
}

function actionSource(value: unknown): OpenADEActionEventSource | null {
    if (!isRecord(value)) return null
    const userLabel = optionalString(value.userLabel)
    if (!userLabel) return null

    if (value.type === "plan") return { type: "plan", userLabel }
    if (value.type === "do") return { type: "do", userLabel }
    if (value.type === "ask") {
        const origin = value.origin === "review_follow_up" ? "review_follow_up" : undefined
        return { type: "ask", userLabel, origin }
    }
    if (value.type === "revise") {
        const parentEventId = optionalString(value.parentEventId)
        return parentEventId ? { type: "revise", userLabel, parentEventId } : null
    }
    if (value.type === "run_plan") {
        const planEventId = optionalString(value.planEventId)
        return planEventId ? { type: "run_plan", userLabel, planEventId } : null
    }
    if (value.type === "hyperplan") {
        const strategyId = optionalString(value.strategyId)
        return strategyId ? { type: "hyperplan", userLabel, strategyId } : null
    }
    if (value.type === "review") {
        if (value.reviewType !== "plan" && value.reviewType !== "work") return null
        return {
            type: "review",
            userLabel,
            reviewType: value.reviewType,
            userInstructions: optionalString(value.userInstructions),
        }
    }
    return null
}

function eventStatus(value: unknown): OpenADEEventStatus | null {
    return value === "in_progress" || value === "completed" || value === "error" || value === "stopped" ? value : null
}

function actionSuccess(value: unknown): boolean {
    return isRecord(value) && typeof value.success === "boolean" ? value.success : true
}

function hyperPlanSubExecution(value: unknown): OpenADEHyperPlanSubExecution | null {
    if (!isRecord(value)) return null
    const stepId = optionalString(value.stepId)
    const primitive = hyperPlanPrimitive(value.primitive)
    const harnessId = optionalString(value.harnessId)
    const modelId = optionalString(value.modelId)
    const executionId = optionalString(value.executionId)
    const status = value.status === "completed" || value.status === "error" || value.status === "stopped" ? value.status : value.status === "in_progress" ? "in_progress" : null
    if (!stepId || !primitive || !harnessId || !modelId || !executionId || !status) return null
    const events = arrayValue(value.events)
        .filter((event): event is Record<string, unknown> & { id: string } => isRecord(event) && typeof event.id === "string" && event.id.length > 0)
        .map((event) => ({ ...event, id: event.id }))
    return {
        stepId,
        primitive,
        harnessId,
        modelId,
        executionId,
        sessionId: optionalString(value.sessionId),
        parentSessionId: optionalString(value.parentSessionId),
        status,
        events,
        resultText: optionalString(value.resultText),
        error: optionalString(value.error),
        reconcileLabel: optionalString(value.reconcileLabel),
    }
}

function hyperPlanPrimitive(value: unknown): OpenADEHyperPlanStepPrimitive | null {
    return value === "plan" || value === "review" || value === "reconcile" || value === "revise" ? value : null
}

function snapshotStats(value: unknown): OpenADESnapshotEventCreateRequest["stats"] | null {
    if (!isRecord(value)) return null
    const filesChanged = finiteNumber(value.filesChanged)
    const insertions = finiteNumber(value.insertions)
    const deletions = finiteNumber(value.deletions)
    if (filesChanged === null || insertions === null || deletions === null) return null
    return { filesChanged, insertions, deletions }
}

function snapshotFiles(
    value: unknown,
    result: OpenADELegacyYjsImportResult,
    taskId: string,
    eventId: string | undefined
): OpenADESnapshotChangedFile[] | undefined {
    const files = arrayValue(value)
    if (files.length === 0) return undefined
    const normalized: OpenADESnapshotChangedFile[] = []
    for (const file of files) {
        if (!isRecord(file) || typeof file.path !== "string" || !snapshotFileStatus(file.status)) {
            result.skipped.push({ taskId, eventId, code: "snapshot_file_invalid" })
            continue
        }
        normalized.push({
            path: file.path,
            status: file.status,
            oldPath: optionalString(file.oldPath),
        })
    }
    return normalized.length > 0 ? normalized : undefined
}

function snapshotFileStatus(value: unknown): value is OpenADESnapshotChangedFile["status"] {
    return value === "added" || value === "deleted" || value === "modified" || value === "renamed"
}

function selectedText(value: unknown): OpenADECommentCreateRequest["selectedText"] {
    if (!isRecord(value)) return { text: "", linesBefore: "", linesAfter: "" }
    return {
        text: stringValue(value.text),
        linesBefore: stringValue(value.linesBefore),
        linesAfter: stringValue(value.linesAfter),
    }
}

function user(value: unknown): OpenADEUser | null {
    if (!isRecord(value)) return null
    const id = optionalString(value.id)
    const email = optionalString(value.email)
    return id && email ? { id, email } : null
}

function gitRefs(value: unknown): OpenADEGitRefs | undefined {
    if (!isRecord(value)) return undefined
    const sha = optionalString(value.sha)
    if (!sha) return undefined
    return { sha, branch: optionalString(value.branch) }
}

function importClientRequestId(kind: string, ...parts: string[]): string {
    return ["legacy-yjs-import", kind, ...parts].join(":")
}

function pushImportError(
    result: OpenADELegacyYjsImportResult,
    scope: OpenADELegacyYjsImportError["scope"],
    error: unknown,
    context: Omit<OpenADELegacyYjsImportError, "scope" | "code" | "message">
): void {
    result.errors.push({
        ...context,
        scope,
        code: errorCode(error),
        message: errorMessage(error),
    })
}

function errorCode(error: unknown): string {
    if (isRecord(error) && typeof error.code === "string") return error.code
    return "error"
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    if (isRecord(error) && typeof error.message === "string") return error.message
    return String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined
}

function arrayValue(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
}

function stringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined
    const strings = value.filter((item): item is string => typeof item === "string")
    return strings.length > 0 ? strings : undefined
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}
