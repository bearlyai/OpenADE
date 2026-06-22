import type {
    OpenADEProject,
    OpenADEQueuedTurn,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskPreview,
    OpenADETaskResourceInventory,
    OpenADETaskResourceInventoryReadRequest,
    OpenADETaskReadOptions,
} from "./types"
import { buildOpenADETaskResourceInventory } from "./taskResourceInventory"
import type { OpenADEYjsProjection } from "./yjsProjection"

export interface OpenADELegacyYjsCoreParityClient {
    getSnapshot(): Promise<OpenADESnapshot>
    getTask(repoId: string, taskId: string, options?: OpenADETaskReadOptions): Promise<OpenADETask>
    readTaskResourceInventory(request: OpenADETaskResourceInventoryReadRequest): Promise<OpenADETaskResourceInventory>
}

export interface OpenADELegacyYjsCoreParityOptions {
    repoIds?: string[]
    taskIds?: string[]
    hydrateSessionEvents?: boolean
    workingTaskIds?: string[]
}

export type OpenADELegacyYjsCoreParityMismatchScope =
    | "snapshot"
    | "repo"
    | "taskPreview"
    | "task"
    | "resourceInventory"
    | "event"
    | "comment"
    | "queuedTurn"

export interface OpenADELegacyYjsCoreParityMismatch {
    scope: OpenADELegacyYjsCoreParityMismatchScope
    repoId?: string
    taskId?: string
    eventId?: string
    commentId?: string
    queuedTurnId?: string
    field: string
    legacy: unknown
    core: unknown
}

export interface OpenADELegacyYjsCoreParityReport {
    scannedRepos: number
    scannedTasks: number
    mismatches: OpenADELegacyYjsCoreParityMismatch[]
}

type NormalizedRecord = Record<string, unknown>

export async function compareOpenADELegacyYjsToCore(
    projection: OpenADEYjsProjection,
    core: OpenADELegacyYjsCoreParityClient,
    options: OpenADELegacyYjsCoreParityOptions = {}
): Promise<OpenADELegacyYjsCoreParityReport> {
    const repoFilter = options.repoIds ? new Set(options.repoIds) : null
    const taskFilter = options.taskIds ? new Set(options.taskIds) : null
    const legacySnapshot = await projection.readSnapshot({ workingTaskIds: options.workingTaskIds })
    const legacyProjects = legacySnapshot.repos.filter((project) => !repoFilter || repoFilter.has(project.id))
    const legacyProjectsById = new Map(legacyProjects.map((project) => [project.id, project]))
    const coreSnapshot = await core.getSnapshot()
    const coreProjects = new Map(coreSnapshot.repos.map((project) => [project.id, project]))
    const report: OpenADELegacyYjsCoreParityReport = {
        scannedRepos: legacyProjects.length,
        scannedTasks: 0,
        mismatches: [],
    }
    compareRecord(
        report,
        { scope: "snapshot" },
        snapshotComparable(legacySnapshot),
        snapshotComparable(coreSnapshot)
    )

    for (const coreProject of coreSnapshot.repos) {
        if (repoFilter && !repoFilter.has(coreProject.id)) continue
        if (!legacyProjectsById.has(coreProject.id)) {
            pushMismatch(report, {
                scope: "repo",
                repoId: coreProject.id,
                field: "repo",
                legacy: undefined,
                core: projectComparable(coreProject),
            })
        }
    }

    for (const legacyProject of legacyProjects) {
        const coreProject = coreProjects.get(legacyProject.id)
        if (!coreProject) {
            pushMismatch(report, { scope: "repo", repoId: legacyProject.id, field: "repo", legacy: projectComparable(legacyProject), core: undefined })
            continue
        }
        compareRecord(report, { scope: "repo", repoId: legacyProject.id }, projectComparable(legacyProject), projectComparable(coreProject))

        const corePreviews = new Map(coreProject.tasks.map((preview) => [preview.id, preview]))
        const legacyPreviewIds = new Set<string>()
        for (const legacyPreview of legacyProject.tasks) {
            if (taskFilter && !taskFilter.has(legacyPreview.id)) continue
            legacyPreviewIds.add(legacyPreview.id)
            report.scannedTasks += 1
            const corePreview = corePreviews.get(legacyPreview.id)
            if (!corePreview) {
                pushMismatch(report, {
                    scope: "taskPreview",
                    repoId: legacyProject.id,
                    taskId: legacyPreview.id,
                    field: "taskPreview",
                    legacy: taskPreviewComparable(legacyPreview),
                    core: undefined,
                })
                continue
            }
            compareRecord(
                report,
                { scope: "taskPreview", repoId: legacyProject.id, taskId: legacyPreview.id },
                taskPreviewComparable(legacyPreview),
                taskPreviewComparable(corePreview)
            )
            const legacyTask = await projection.readTask(legacyProject.id, legacyPreview.id, { hydrateSessionEvents: options.hydrateSessionEvents ?? true })
            const coreTask = await core.getTask(legacyProject.id, legacyPreview.id, { hydrateSessionEvents: options.hydrateSessionEvents ?? true })
            compareTask(report, legacyProject.id, legacyTask, coreTask)
            const legacyInventory = buildOpenADETaskResourceInventory({ task: legacyTask, isRunning: false })
            const coreInventory = await core.readTaskResourceInventory({ repoId: legacyProject.id, taskId: legacyPreview.id })
            compareRecord(
                report,
                { scope: "resourceInventory", repoId: legacyProject.id, taskId: legacyPreview.id },
                resourceInventoryComparable(legacyInventory),
                resourceInventoryComparable(coreInventory)
            )
        }
        for (const corePreview of coreProject.tasks) {
            if (taskFilter && !taskFilter.has(corePreview.id)) continue
            if (legacyPreviewIds.has(corePreview.id)) continue
            pushMismatch(report, {
                scope: "taskPreview",
                repoId: legacyProject.id,
                taskId: corePreview.id,
                field: "taskPreview",
                legacy: undefined,
                core: taskPreviewComparable(corePreview),
            })
        }
    }

    return report
}

function compareTask(report: OpenADELegacyYjsCoreParityReport, repoId: string, legacyTask: OpenADETask, coreTask: OpenADETask): void {
    compareRecord(
        report,
        { scope: "task", repoId, taskId: legacyTask.id },
        taskComparable(legacyTask),
        taskComparable(coreTask)
    )
    compareRecordList(report, {
        scope: "queuedTurn",
        repoId,
        taskId: legacyTask.id,
        idField: "id",
        idName: "queuedTurnId",
        field: "queuedTurns",
        legacy: (legacyTask.queuedTurns ?? []).map(queuedTurnComparable),
        core: (coreTask.queuedTurns ?? []).map(queuedTurnComparable),
    })
    compareRecordList(report, {
        scope: "comment",
        repoId,
        taskId: legacyTask.id,
        idField: "id",
        idName: "commentId",
        field: "comments",
        legacy: legacyTask.comments.map(commentComparable).filter(isRecord),
        core: coreTask.comments.map(commentComparable).filter(isRecord),
    })
    compareRecordList(report, {
        scope: "event",
        repoId,
        taskId: legacyTask.id,
        idField: "id",
        idName: "eventId",
        field: "events",
        legacy: legacyTask.events.map(eventComparable).filter(isRecord),
        core: coreTask.events.map(eventComparable).filter(isRecord),
    })
}

function projectComparable(project: OpenADEProject): NormalizedRecord {
    return compactRecord({
        id: project.id,
        name: project.name,
        path: project.path,
        archived: project.archived,
    })
}

function snapshotComparable(snapshot: OpenADESnapshot): NormalizedRecord {
    return compactRecord({
        workingTaskIds: [...snapshot.workingTaskIds].sort(),
    })
}

function taskPreviewComparable(preview: OpenADETaskPreview): NormalizedRecord {
    return compactRecord({
        id: preview.id,
        slug: preview.slug,
        title: preview.title,
        closed: preview.closed,
        createdAt: preview.createdAt,
        lastViewedAt: preview.lastViewedAt,
        lastEventAt: preview.lastEventAt,
        lastEvent: taskPreviewLastEventComparable(preview.lastEvent),
        usage: preview.usage,
    })
}

function taskComparable(task: OpenADETask): NormalizedRecord {
    return compactRecord({
        id: task.id,
        repoId: task.repoId,
        slug: task.slug,
        title: task.title,
        description: task.description,
        isolationStrategy: task.isolationStrategy,
        enabledMcpServerIds: task.enabledMcpServerIds,
        createdBy: task.createdBy,
        sessionIds: task.sessionIds,
        cancelledPlanEventId: task.cancelledPlanEventId,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        lastViewedAt: task.lastViewedAt,
        lastEventAt: task.lastEventAt,
        closed: task.closed,
        pullRequest: task.pullRequest,
        deviceEnvironments: task.deviceEnvironments.map((environment) =>
            compactRecord({
                id: environment.id,
                deviceId: environment.deviceId,
                setupComplete: environment.setupComplete,
                createdAt: environment.createdAt,
                lastUsedAt: environment.lastUsedAt,
                worktreeDir: environment.worktreeDir,
                mergeBaseCommit: environment.mergeBaseCommit,
            })
        ),
    })
}

function resourceInventoryComparable(inventory: OpenADETaskResourceInventory): NormalizedRecord {
    return compactRecord({
        repoId: inventory.repoId,
        taskId: inventory.taskId,
        taskTitle: inventory.taskTitle,
        snapshotIds: [...inventory.snapshotIds].sort(),
        images: inventory.images
            .map((image) => compactRecord({ id: image.id, ext: image.ext }))
            .sort((left, right) => resourceSortKey(left).localeCompare(resourceSortKey(right))),
        sessions: inventory.sessions
            .map((session) => compactRecord({ sessionId: session.sessionId, harnessId: session.harnessId }))
            .sort((left, right) => resourceSortKey(left).localeCompare(resourceSortKey(right))),
        worktree: inventory.worktree
            ? compactRecord({
                  slug: inventory.worktree.slug,
                  branchName: inventory.worktree.branchName,
                  sourceBranch: inventory.worktree.sourceBranch,
              })
            : null,
    })
}

function taskPreviewLastEventComparable(value: unknown): unknown {
    if (!isRecord(value)) return value
    const type = stringValue(value.type)
    const source = isRecord(value.source) ? value.source : null
    return compactRecord({
        type,
        status: stringValue(value.status),
        sourceType: stringValue(value.sourceType) ?? stringValue(source?.type),
        sourceLabel: stringValue(value.sourceLabel) ?? stringValue(source?.userLabel),
        at: stringValue(value.at) ?? stringValue(value.completedAt) ?? stringValue(value.createdAt),
    })
}

function queuedTurnComparable(turn: OpenADEQueuedTurn): NormalizedRecord {
    return compactRecord({
        id: turn.id,
        clientRequestId: turn.clientRequestId,
        type: turn.type,
        input: turn.input,
        status: turn.status,
        createdAt: turn.createdAt,
        updatedAt: turn.updatedAt,
        eventId: turn.eventId,
        appendSystemPrompt: turn.appendSystemPrompt,
        enabledMcpServerIds: turn.enabledMcpServerIds,
        harnessId: turn.harnessId,
        modelId: turn.modelId,
        label: turn.label,
        includeComments: turn.includeComments,
        images: turn.images,
        thinking: turn.thinking,
        fastMode: turn.fastMode,
    })
}

function commentComparable(value: unknown): NormalizedRecord | null {
    if (!isRecord(value)) return null
    const content = stringValue(value.content) ?? stringValue(value.body)
    const createdAt = stringValue(value.createdAt)
    return compactRecord({
        id: stringValue(value.id),
        content,
        source: value.source,
        selectedText: value.selectedText,
        author: value.author,
        createdAt,
        updatedAt: stringValue(value.updatedAt) ?? createdAt,
    })
}

function eventComparable(value: unknown): NormalizedRecord | null {
    if (!isRecord(value)) return null
    const type = stringValue(value.type)
    const id = stringValue(value.id)
    if (!type || !id) return null
    if (type === "setup_environment") return setupEventComparable(value)
    if (type === "action") return actionEventComparable(value)
    if (type === "snapshot") return snapshotEventComparable(value)
    return compactRecord({
        id,
        type,
        status: stringValue(value.status),
        createdAt: stringValue(value.createdAt),
        completedAt: stringValue(value.completedAt),
    })
}

function setupEventComparable(value: NormalizedRecord): NormalizedRecord {
    return compactRecord({
        id: stringValue(value.id),
        type: "setup_environment",
        status: stringValue(value.status),
        worktreeId: stringValue(value.worktreeId),
        deviceId: stringValue(value.deviceId),
        workingDir: stringValue(value.workingDir),
        setupOutput: stringValue(value.setupOutput),
        createdAt: stringValue(value.createdAt),
        completedAt: stringValue(value.completedAt),
    })
}

function actionEventComparable(value: NormalizedRecord): NormalizedRecord {
    const execution = isRecord(value.execution) ? value.execution : emptyRecord()
    return compactRecord({
        id: stringValue(value.id),
        type: "action",
        status: stringValue(value.status),
        userInput: stringValue(value.userInput),
        source: actionSourceComparable(value.source),
        createdAt: stringValue(value.createdAt),
        completedAt: stringValue(value.completedAt),
        result: value.result,
        execution: compactRecord({
            executionId: stringValue(execution.executionId),
            harnessId: stringValue(execution.harnessId),
            modelId: stringValue(execution.modelId),
            sessionId: stringValue(execution.sessionId),
            parentSessionId: stringValue(execution.parentSessionId),
            gitRefsBefore: execution.gitRefsBefore,
            gitRefsAfter: execution.gitRefsAfter,
            events: arrayValue(execution.events).map(streamEventComparable),
        }),
    })
}

function snapshotEventComparable(value: NormalizedRecord): NormalizedRecord {
    return compactRecord({
        id: stringValue(value.id),
        type: "snapshot",
        status: stringValue(value.status),
        actionEventId: stringValue(value.actionEventId),
        referenceBranch: stringValue(value.referenceBranch),
        mergeBaseCommit: stringValue(value.mergeBaseCommit),
        patchFileId: stringValue(value.patchFileId) ?? stringValue(value.id),
        stats: value.stats,
        files: value.files,
        createdAt: stringValue(value.createdAt),
    })
}

function actionSourceComparable(value: unknown): unknown {
    if (!isRecord(value)) return value
    return compactRecord({
        type: stringValue(value.type),
        userLabel: stringValue(value.userLabel),
        parentEventId: stringValue(value.parentEventId),
        planEventId: stringValue(value.planEventId),
        strategyId: stringValue(value.strategyId),
        reviewType: stringValue(value.reviewType),
        origin: stringValue(value.origin),
    })
}

function streamEventComparable(value: unknown): unknown {
    if (!isRecord(value)) return value
    return compactRecord({
        id: stringValue(value.id),
        type: stringValue(value.type),
        direction: stringValue(value.direction),
        executionId: stringValue(value.executionId),
        harnessId: stringValue(value.harnessId),
        message: value.message,
        text: value.text,
    })
}

function compareRecord(
    report: OpenADELegacyYjsCoreParityReport,
    context: Omit<OpenADELegacyYjsCoreParityMismatch, "field" | "legacy" | "core">,
    legacy: NormalizedRecord,
    core: NormalizedRecord
): void {
    const fields = new Set([...Object.keys(legacy), ...Object.keys(core)])
    for (const field of [...fields].sort()) {
        const legacyValue = normalizeComparableValue(legacy[field])
        const coreValue = normalizeComparableValue(core[field])
        if (!sameComparableValue(legacyValue, coreValue)) {
            pushMismatch(report, { ...context, field, legacy: legacyValue, core: coreValue })
        }
    }
}

function compareRecordList(
    report: OpenADELegacyYjsCoreParityReport,
    input: {
        scope: OpenADELegacyYjsCoreParityMismatchScope
        repoId: string
        taskId: string
        idField: string
        idName: "eventId" | "commentId" | "queuedTurnId"
        field: string
        legacy: NormalizedRecord[]
        core: NormalizedRecord[]
    }
): void {
    const legacyRows = recordsById(input.legacy, input.idField)
    const coreRows = recordsById(input.core, input.idField)
    const ids = new Set([...legacyRows.keys(), ...coreRows.keys()])
    for (const id of [...ids].sort()) {
        const legacy = legacyRows.get(id)
        const core = coreRows.get(id)
        const context = recordListContext(input.scope, input.repoId, input.taskId, input.idName, id)
        if (!legacy || !core) {
            pushMismatch(report, {
                ...context,
                field: input.field,
                legacy,
                core,
            })
            continue
        }
        compareRecord(report, context, legacy, core)
    }
}

function recordsById(rows: NormalizedRecord[], idField: string): Map<string, NormalizedRecord> {
    const result = new Map<string, NormalizedRecord>()
    for (const row of rows) {
        const id = String(row[idField] ?? "")
        if (id.length > 0) result.set(id, row)
    }
    return result
}

function recordListContext(
    scope: OpenADELegacyYjsCoreParityMismatchScope,
    repoId: string,
    taskId: string,
    idName: "eventId" | "commentId" | "queuedTurnId",
    id: string
): Omit<OpenADELegacyYjsCoreParityMismatch, "field" | "legacy" | "core"> {
    if (idName === "eventId") return { scope, repoId, taskId, eventId: id }
    if (idName === "commentId") return { scope, repoId, taskId, commentId: id }
    return { scope, repoId, taskId, queuedTurnId: id }
}

function pushMismatch(report: OpenADELegacyYjsCoreParityReport, mismatch: OpenADELegacyYjsCoreParityMismatch): void {
    report.mismatches.push(mismatch)
}

function compactRecord(input: Record<string, unknown>): NormalizedRecord {
    const result: NormalizedRecord = {}
    for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) result[key] = value
    }
    return result
}

function normalizeComparableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalizeComparableValue)
    if (value === null || value === "") return undefined
    if (typeof value === "string" && value.includes("T")) {
        const parsed = Date.parse(value)
        if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
    }
    if (!isRecord(value)) return value
    const result: NormalizedRecord = {}
    for (const [key, nested] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
        const normalized = normalizeComparableValue(nested)
        if (normalized !== undefined) result[key] = normalized
    }
    return Object.keys(result).length > 0 ? result : undefined
}

function sameComparableValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right)
}

function arrayValue(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined
}

function emptyRecord(): NormalizedRecord {
    return {}
}

function resourceSortKey(value: NormalizedRecord): string {
    return JSON.stringify(normalizeComparableValue(value)) ?? ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}
