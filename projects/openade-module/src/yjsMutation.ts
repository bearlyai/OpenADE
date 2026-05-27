import * as Y from "yjs"
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
    OpenADEEventStatus,
    OpenADEHyperPlanReconcileLabelsSetRequest,
    OpenADEHyperPlanSubExecutionAddRequest,
    OpenADEHyperPlanSubExecutionStreamAppendRequest,
    OpenADEHyperPlanSubExecutionUpdateRequest,
    OpenADERepoCreateRequest,
    OpenADERepoCreateResult,
    OpenADERepoDeleteRequest,
    OpenADERepoUpdateRequest,
    OpenADESnapshotEventCreateRequest,
    OpenADESnapshotEventCreateResult,
    OpenADETaskDeleteRequest,
    OpenADETaskDeleteResult,
    OpenADETaskEnvironmentSetupRequest,
    OpenADETaskCreateRequest,
    OpenADETaskCreateResult,
    OpenADETaskMetadataUpdateRequest,
} from "./types"
import type { OpenADEYjsStorageAdapter } from "./yjsProjection"

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonRecord = { [key: string]: JsonValue }

export interface OpenADEYjsMutationStorageAdapter extends OpenADEYjsStorageAdapter {
    readDocumentUpdate(id: string): Promise<Uint8Array | null>
    saveDocumentUpdate(id: string, data: Uint8Array): Promise<void>
    deleteDocument(id: string): Promise<void>
}

export interface OpenADEYjsWriter {
    createRepo(request: OpenADERepoCreateRequest): Promise<OpenADERepoCreateResult>
    updateRepo(request: OpenADERepoUpdateRequest): Promise<void>
    deleteRepo(request: OpenADERepoDeleteRequest): Promise<void>
    createTask(request: OpenADETaskCreateRequest): Promise<OpenADETaskCreateResult>
    deleteTask(request: OpenADETaskDeleteRequest): Promise<OpenADETaskDeleteResult>
    setupTaskEnvironment(request: OpenADETaskEnvironmentSetupRequest): Promise<void>
    createActionEvent(request: OpenADEActionEventCreateRequest): Promise<OpenADEActionEventCreateResult>
    appendActionStreamEvent(request: OpenADEActionStreamAppendRequest): Promise<void>
    completeActionEvent(request: OpenADEActionEventCompleteRequest): Promise<void>
    errorActionEvent(request: OpenADEActionEventErrorRequest): Promise<void>
    stoppedActionEvent(request: OpenADEActionEventStoppedRequest): Promise<void>
    reconcileActionEventRuntime(request: OpenADEActionEventRuntimeReconcileRequest): Promise<OpenADEActionEventRuntimeReconcileResult>
    updateActionExecution(request: OpenADEActionExecutionUpdateRequest): Promise<void>
    addHyperPlanSubExecution(request: OpenADEHyperPlanSubExecutionAddRequest): Promise<void>
    appendHyperPlanSubExecutionStreamEvent(request: OpenADEHyperPlanSubExecutionStreamAppendRequest): Promise<void>
    updateHyperPlanSubExecution(request: OpenADEHyperPlanSubExecutionUpdateRequest): Promise<void>
    setHyperPlanReconcileLabels(request: OpenADEHyperPlanReconcileLabelsSetRequest): Promise<void>
    createSnapshotEvent(request: OpenADESnapshotEventCreateRequest): Promise<OpenADESnapshotEventCreateResult>
    createComment(request: OpenADECommentCreateRequest): Promise<OpenADECommentCreateResult>
    editComment(request: OpenADECommentEditRequest): Promise<void>
    deleteComment(request: OpenADECommentDeleteRequest): Promise<void>
    updateTaskMetadata(request: OpenADETaskMetadataUpdateRequest): Promise<void>
}

export interface OpenADEYjsWriterOptions {
    createId?: () => string
    createSlug?: () => string
    now?: () => string
}

function createFallbackId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function createFallbackSlug(): string {
    return `task-${Math.random().toString(36).slice(2, 10)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toYValue(value: unknown): unknown {
    if (value === undefined) return undefined
    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined

    if (Array.isArray(value)) {
        const yArray = new Y.Array<unknown>()
        const values = value.map(toYValue).filter((nested) => nested !== undefined)
        if (values.length > 0) yArray.push(values)
        return yArray
    }

    if (isRecord(value)) {
        const yMap = new Y.Map<unknown>()
        for (const [key, nested] of Object.entries(value)) {
            const converted = toYValue(nested)
            if (converted !== undefined) yMap.set(key, converted)
        }
        return yMap
    }

    return undefined
}

function toPlain(value: unknown): JsonValue | undefined {
    if (value instanceof Y.Map) {
        const result: JsonRecord = {}
        const map = value as Y.Map<unknown>
        map.forEach((nested: unknown, key: string) => {
            const converted = toPlain(nested)
            if (converted !== undefined) result[key] = converted
        })
        return result
    }

    if (value instanceof Y.Array) {
        const array = value as Y.Array<unknown>
        return array.toArray().map(toPlain).filter((nested): nested is JsonValue => nested !== undefined)
    }

    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined
    return undefined
}

function setMapObject(map: Y.Map<unknown>, value: Record<string, unknown>): void {
    for (const [key, nested] of Object.entries(value)) {
        const converted = toYValue(nested)
        if (converted !== undefined) map.set(key, converted)
    }
}

function ensureYArray(map: Y.Map<unknown>, key: string): Y.Array<unknown> {
    const existing = map.get(key)
    if (existing instanceof Y.Array) return existing

    const created = new Y.Array<unknown>()
    map.set(key, created)
    return created
}

function ensureYMap(map: Y.Map<unknown>, key: string): Y.Map<unknown> {
    const existing = map.get(key)
    if (existing instanceof Y.Map) return existing

    const created = new Y.Map<unknown>()
    map.set(key, created)
    return created
}

function hasOrderedItem(doc: Y.Doc, name: string, id: string): boolean {
    return doc.getMap(`${name}:data`).has(id)
}

function getOrderedItemMap(doc: Y.Doc, name: string, id: string): Y.Map<unknown> | null {
    const item = doc.getMap<Y.Map<unknown>>(`${name}:data`).get(id)
    return item instanceof Y.Map ? item : null
}

function deleteOrderedItem(doc: Y.Doc, name: string, id: string): void {
    doc.getMap<Y.Map<unknown>>(`${name}:data`).delete(id)
    const orderArray = doc.getArray<string>(`${name}:order`)
    const index = orderArray.toArray().indexOf(id)
    if (index !== -1) orderArray.delete(index, 1)
}

function pushOrderedItem(doc: Y.Doc, name: string, item: Record<string, unknown> & { id: string }): void {
    const dataMap = doc.getMap<Y.Map<unknown>>(`${name}:data`)
    const orderArray = doc.getArray<string>(`${name}:order`)
    if (dataMap.has(item.id)) return

    dataMap.set(item.id, toYValue(item) as Y.Map<unknown>)
    if (!orderArray.toArray().includes(item.id)) orderArray.push([item.id])
}

function upsertOrderedItem(doc: Y.Doc, name: string, item: Record<string, unknown> & { id: string }): void {
    const existing = getOrderedItemMap(doc, name, item.id)
    if (existing) {
        setMapObject(existing, item)
        return
    }

    pushOrderedItem(doc, name, item)
}

async function loadDoc(storage: OpenADEYjsMutationStorageAdapter, id: string): Promise<Y.Doc> {
    const doc = new Y.Doc()
    const data = await storage.readDocumentUpdate(id)
    if (data) Y.applyUpdate(doc, data)
    return doc
}

async function saveDoc(storage: OpenADEYjsMutationStorageAdapter, id: string, doc: Y.Doc): Promise<void> {
    await storage.saveDocumentUpdate(id, Y.encodeStateAsUpdate(doc))
}

function findRepoMap(doc: Y.Doc, repoId: string): Y.Map<unknown> | null {
    const repos = doc.getMap<Y.Map<unknown>>("repos:data")
    const repo = repos.get(repoId)
    return repo instanceof Y.Map ? repo : null
}

function ensureTaskPreview(repoMap: Y.Map<unknown>, preview: { id: string; slug: string; title: string; createdAt: string }, updatedAt: string): void {
    const tasks = ensureYArray(repoMap, "tasks")
    const existing = tasks.toArray().some((task) => {
        const plain = toPlain(task)
        return isRecord(plain) && plain.id === preview.id
    })
    if (!existing) tasks.push([toYValue(preview)])
    repoMap.set("updatedAt", updatedAt)
}

function deleteTaskPreview(repoMap: Y.Map<unknown>, taskId: string, updatedAt: string): boolean {
    const tasks = ensureYArray(repoMap, "tasks")
    const index = tasks.toArray().findIndex((task) => {
        const plain = toPlain(task)
        return isRecord(plain) && plain.id === taskId
    })
    if (index === -1) return false

    tasks.delete(index, 1)
    repoMap.set("updatedAt", updatedAt)
    return true
}

function stringValue(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback
}

function assertTaskMeta(meta: Y.Map<unknown>, taskId: string): void {
    const metaId = meta.get("id")
    if (typeof metaId !== "string" || !metaId) throw new Error(`Task ${taskId} not found`)
    if (metaId !== taskId) throw new Error(`Task document ${taskId} has mismatched metadata id ${metaId}`)
}

function getActionEventMap(doc: Y.Doc, taskId: string, eventId: string): Y.Map<unknown> {
    const event = getOrderedItemMap(doc, "task:events", eventId)
    if (!event) throw new Error(`Event ${eventId} not found in task ${taskId}`)
    if (event.get("type") !== "action") throw new Error(`Event ${eventId} is not an action event`)
    return event
}

function findActionEventForRuntime(
    doc: Y.Doc,
    request: OpenADEActionEventRuntimeReconcileRequest
): { event: Y.Map<unknown>; eventId: string } | null {
    if (request.eventId) {
        const event = getOrderedItemMap(doc, "task:events", request.eventId)
        if (event?.get("type") === "action") return { event, eventId: request.eventId }
        return null
    }

    if (!request.executionId) return null

    const order = doc.getArray<string>("task:events:order").toArray()
    for (let index = order.length - 1; index >= 0; index--) {
        const eventId = order[index]
        const event = getOrderedItemMap(doc, "task:events", eventId)
        if (!event || event.get("type") !== "action") continue
        const execution = event.get("execution")
        if (!(execution instanceof Y.Map)) continue
        if (execution.get("executionId") === request.executionId) return { event, eventId }
    }

    return null
}

function hasArrayItemWithId(array: Y.Array<unknown>, id: string): boolean {
    return array.toArray().some((item) => {
        const plain = toPlain(item)
        return isRecord(plain) && plain.id === id
    })
}

function getHyperPlanSubExecutionMap(event: Y.Map<unknown>, stepId: string): Y.Map<unknown> | null {
    const subExecutions = event.get("hyperplanSubExecutions")
    if (!(subExecutions instanceof Y.Array)) return null

    for (const item of subExecutions.toArray()) {
        if (!(item instanceof Y.Map)) continue
        if (item.get("stepId") === stepId) return item
    }

    return null
}

function updateTaskPreview(
    repoMap: Y.Map<unknown>,
    taskId: string,
    updates: Record<string, unknown>,
    updatedAt: string
): void {
    const tasks = ensureYArray(repoMap, "tasks")
    const items = tasks.toArray()
    const index = items.findIndex((task) => {
        const plain = toPlain(task)
        return isRecord(plain) && plain.id === taskId
    })

    if (index === -1) return

    const task = items[index]
    const taskMap = task instanceof Y.Map ? task : new Y.Map<unknown>()
    if (!(task instanceof Y.Map) && isRecord(toPlain(task))) setMapObject(taskMap, toPlain(task) as Record<string, unknown>)
    setMapObject(taskMap, updates)
    if (!(task instanceof Y.Map)) {
        tasks.delete(index, 1)
        tasks.insert(index, [taskMap])
    }
    repoMap.set("updatedAt", updatedAt)
}

function getEventPreview(event: Y.Map<unknown>, at: string): Record<string, unknown> {
    const source = event.get("source")
    const sourceMap = source instanceof Y.Map ? source : null
    return {
        type: "action",
        status: event.get("status") as OpenADEEventStatus,
        sourceType: sourceMap?.get("type"),
        sourceLabel: stringValue(sourceMap?.get("userLabel"), "Action"),
        at,
    }
}

function getLastNonSnapshotEvent(taskDoc: Y.Doc): Y.Map<unknown> | null {
    const order = taskDoc.getArray<string>("task:events:order").toArray()
    for (let index = order.length - 1; index >= 0; index--) {
        const event = getOrderedItemMap(taskDoc, "task:events", order[index])
        if (!event) continue
        if (event.get("type") !== "snapshot") return event
    }
    return null
}

function getNonSnapshotEventPreview(event: Y.Map<unknown>, at: string): Record<string, unknown> {
    if (event.get("type") === "action") return getEventPreview(event, at)
    return {
        type: event.get("type"),
        status: event.get("status"),
        sourceLabel: event.get("type") === "setup_environment" ? "Setup" : "Snapshot",
        at,
    }
}

async function syncTaskMetadataPreview(
    storage: OpenADEYjsMutationStorageAdapter,
    taskId: string,
    taskDoc: Y.Doc,
    updatedAt: string,
    usage?: unknown
): Promise<void> {
    const meta = taskDoc.getMap("task:meta")
    const repoId = stringValue(meta.get("repoId"))
    if (!repoId) throw new Error(`Task ${taskId} is missing repoId`)

    const reposDoc = await loadDoc(storage, "code:repos")
    try {
        const repoMap = findRepoMap(reposDoc, repoId)
        if (!repoMap) throw new Error(`Repository ${repoId} not found`)
        const lastNonSnapshot = getLastNonSnapshotEvent(taskDoc)
        const lastEventAt = typeof meta.get("lastEventAt") === "string" ? (meta.get("lastEventAt") as string) : undefined
        const lastEvent = lastNonSnapshot ? getNonSnapshotEventPreview(lastNonSnapshot, lastEventAt ?? stringValue(lastNonSnapshot.get("createdAt"), updatedAt)) : undefined
        reposDoc.transact(() => {
            updateTaskPreview(
                repoMap,
                taskId,
                {
                    title: stringValue(meta.get("title"), "Untitled task"),
                    closed: meta.get("closed"),
                    lastViewedAt: meta.get("lastViewedAt"),
                    lastEventAt,
                    lastEvent,
                    ...(usage !== undefined ? { usage } : {}),
                },
                updatedAt
            )
        })
        await saveDoc(storage, "code:repos", reposDoc)
    } finally {
        reposDoc.destroy()
    }
}

async function syncActionEventPreview(
    storage: OpenADEYjsMutationStorageAdapter,
    taskId: string,
    taskDoc: Y.Doc,
    event: Y.Map<unknown>,
    at: string
): Promise<void> {
    const meta = taskDoc.getMap("task:meta")
    const repoId = stringValue(meta.get("repoId"))
    if (!repoId) throw new Error(`Task ${taskId} is missing repoId`)

    const reposDoc = await loadDoc(storage, "code:repos")
    try {
        const repoMap = findRepoMap(reposDoc, repoId)
        if (!repoMap) throw new Error(`Repository ${repoId} not found`)
        reposDoc.transact(() => {
            updateTaskPreview(
                repoMap,
                taskId,
                {
                    title: stringValue(meta.get("title"), "Untitled task"),
                    closed: meta.get("closed"),
                    lastViewedAt: meta.get("lastViewedAt"),
                    lastEventAt: meta.get("lastEventAt"),
                    lastEvent: getEventPreview(event, at),
                },
                stringValue(meta.get("updatedAt"), at)
            )
        })
        await saveDoc(storage, "code:repos", reposDoc)
    } finally {
        reposDoc.destroy()
    }
}

export function createOpenADEYjsWriter(storage: OpenADEYjsMutationStorageAdapter, options: OpenADEYjsWriterOptions = {}): OpenADEYjsWriter {
    const createId = options.createId ?? createFallbackId
    const createSlug = options.createSlug ?? createFallbackSlug
    const now = options.now ?? (() => new Date().toISOString())

    return {
        async createRepo(request) {
            const repoId = request.repoId ?? createId()
            const createdAt = request.createdAt ?? now()
            const reposDoc = await loadDoc(storage, "code:repos")

            try {
                if (findRepoMap(reposDoc, repoId)) {
                    return { repoId, createdAt }
                }

                reposDoc.transact(() => {
                    pushOrderedItem(reposDoc, "repos", {
                        id: repoId,
                        name: request.name,
                        path: request.path,
                        createdBy: request.createdBy,
                        createdAt,
                        updatedAt: createdAt,
                        tasks: [],
                    })
                })
                await saveDoc(storage, "code:repos", reposDoc)
                return { repoId, createdAt }
            } finally {
                reposDoc.destroy()
            }
        },

        async updateRepo(request) {
            const updatedAt = request.updatedAt ?? now()
            const reposDoc = await loadDoc(storage, "code:repos")

            try {
                const repoMap = findRepoMap(reposDoc, request.repoId)
                if (!repoMap) throw new Error(`Repository ${request.repoId} not found`)

                reposDoc.transact(() => {
                    if (request.name !== undefined) repoMap.set("name", request.name)
                    if (request.path !== undefined) repoMap.set("path", request.path)
                    if (request.archived !== undefined) repoMap.set("archived", request.archived)
                    repoMap.set("updatedAt", updatedAt)
                })
                await saveDoc(storage, "code:repos", reposDoc)
            } finally {
                reposDoc.destroy()
            }
        },

        async deleteRepo(request) {
            const reposDoc = await loadDoc(storage, "code:repos")

            try {
                reposDoc.transact(() => {
                    deleteOrderedItem(reposDoc, "repos", request.repoId)
                })
                await saveDoc(storage, "code:repos", reposDoc)
            } finally {
                reposDoc.destroy()
            }
        },

        async createTask(request) {
            const isolationStrategy = request.isolationStrategy ?? { type: "head" }
            const taskId = request.taskId ?? createId()
            const slug = request.slug ?? createSlug()
            const createdAt = request.createdAt ?? now()
            const title = request.title ?? "New task"
            const reposDoc = await loadDoc(storage, "code:repos")
            const taskDoc = await loadDoc(storage, `code:task:${taskId}`)

            try {
                const repoMap = findRepoMap(reposDoc, request.repoId)
                if (!repoMap) throw new Error(`Repository ${request.repoId} not found`)

                const meta = taskDoc.getMap("task:meta")
                const existingMetaId = meta.get("id")
                if (typeof existingMetaId === "string" && existingMetaId && existingMetaId !== taskId) {
                    throw new Error(`Task document ${taskId} has mismatched metadata id ${existingMetaId}`)
                }

                if (!existingMetaId) {
                    taskDoc.transact(() => {
                        setMapObject(meta, {
                            id: taskId,
                            repoId: request.repoId,
                            slug,
                            title,
                            description: request.input,
                            isolationStrategy,
                            sessionIds: {},
                            createdBy: request.createdBy,
                            createdAt,
                            updatedAt: createdAt,
                            ...(request.enabledMcpServerIds && request.enabledMcpServerIds.length > 0
                                ? { enabledMcpServerIds: request.enabledMcpServerIds }
                                : {}),
                        })

                        if (!hasOrderedItem(taskDoc, "task:deviceEnvironments", request.deviceId)) {
                            pushOrderedItem(taskDoc, "task:deviceEnvironments", (request.deviceEnvironment ?? {
                                id: request.deviceId,
                                deviceId: request.deviceId,
                                setupComplete: true,
                                createdAt,
                                lastUsedAt: createdAt,
                            }) as unknown as Record<string, unknown> & { id: string })
                        }
                        if (request.setupEvent) {
                            pushOrderedItem(taskDoc, "task:events", {
                                id: request.setupEvent.eventId ?? createId(),
                                type: "setup_environment",
                                status: "completed",
                                createdAt: request.setupEvent.createdAt ?? createdAt,
                                completedAt: request.setupEvent.completedAt ?? request.setupEvent.createdAt ?? createdAt,
                                userInput: "Environment setup",
                                worktreeId: request.setupEvent.worktreeId,
                                deviceId: request.setupEvent.deviceId,
                                workingDir: request.setupEvent.workingDir,
                                setupOutput: request.setupEvent.setupOutput,
                            })
                        }
                    })
                    await saveDoc(storage, `code:task:${taskId}`, taskDoc)
                }

                reposDoc.transact(() => {
                    ensureTaskPreview(repoMap, { id: taskId, slug, title, createdAt }, createdAt)
                })
                await saveDoc(storage, "code:repos", reposDoc)

                return { taskId, slug, title, createdAt }
            } finally {
                reposDoc.destroy()
                taskDoc.destroy()
            }
        },

        async deleteTask(request) {
            const updatedAt = now()
            const documentId = `code:task:${request.taskId}`
            const reposDoc = await loadDoc(storage, "code:repos")
            const taskData = await storage.readDocumentUpdate(documentId)
            const taskDoc = new Y.Doc()
            if (taskData) Y.applyUpdate(taskDoc, taskData)

            try {
                const repoMap = findRepoMap(reposDoc, request.repoId)
                if (!repoMap) throw new Error(`Repository ${request.repoId} not found`)

                if (taskData) {
                    const meta = taskDoc.getMap("task:meta")
                    assertTaskMeta(meta, request.taskId)
                    const metaRepoId = meta.get("repoId")
                    if (metaRepoId !== request.repoId) {
                        throw new Error(`Task ${request.taskId} belongs to repository ${String(metaRepoId)}`)
                    }
                }

                let removedPreview = false
                reposDoc.transact(() => {
                    removedPreview = deleteTaskPreview(repoMap, request.taskId, updatedAt)
                })
                if (!removedPreview && !taskData) throw new Error(`Task ${request.taskId} not found`)

                await saveDoc(storage, "code:repos", reposDoc)
                if (taskData) await storage.deleteDocument(documentId)
                return { repoId: request.repoId, taskId: request.taskId, deleted: true }
            } finally {
                reposDoc.destroy()
                taskDoc.destroy()
            }
        },

        async setupTaskEnvironment(request) {
            const updatedAt = now()
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)
                taskDoc.transact(() => {
                    upsertOrderedItem(taskDoc, "task:deviceEnvironments", request.deviceEnvironment as unknown as Record<string, unknown> & { id: string })
                    if (request.setupEvent) {
                        pushOrderedItem(taskDoc, "task:events", {
                            id: request.setupEvent.eventId ?? createId(),
                            type: "setup_environment",
                            status: "completed",
                            createdAt: request.setupEvent.createdAt ?? updatedAt,
                            completedAt: request.setupEvent.completedAt ?? request.setupEvent.createdAt ?? updatedAt,
                            userInput: "Environment setup",
                            worktreeId: request.setupEvent.worktreeId,
                            deviceId: request.setupEvent.deviceId,
                            workingDir: request.setupEvent.workingDir,
                            setupOutput: request.setupEvent.setupOutput,
                        })
                    }
                    meta.set("updatedAt", updatedAt)
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)
                await syncTaskMetadataPreview(storage, request.taskId, taskDoc, updatedAt)
            } finally {
                taskDoc.destroy()
            }
        },

        async createActionEvent(request) {
            const eventId = request.eventId ?? createId()
            const createdAt = request.createdAt ?? now()
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)

                taskDoc.transact(() => {
                    if (!hasOrderedItem(taskDoc, "task:events", eventId)) {
                        const execution: Record<string, unknown> = {
                            harnessId: request.harnessId,
                            executionId: request.executionId,
                            modelId: request.modelId,
                            fastMode: request.fastMode,
                            events: [],
                            gitRefsBefore: request.gitRefsBefore,
                        }
                        pushOrderedItem(taskDoc, "task:events", {
                            id: eventId,
                            type: "action",
                            status: "in_progress",
                            createdAt,
                            userInput: request.userInput,
                            ...(request.images && request.images.length > 0 ? { images: request.images } : {}),
                            execution,
                            source: request.source,
                            includesCommentIds: request.includesCommentIds ?? [],
                        })
                    }
                    meta.set("updatedAt", createdAt)
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)

                return { eventId, createdAt }
            } finally {
                taskDoc.destroy()
            }
        },

        async appendActionStreamEvent(request) {
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)
                const event = getActionEventMap(taskDoc, request.taskId, request.eventId)

                taskDoc.transact(() => {
                    const execution = ensureYMap(event, "execution")
                    const events = ensureYArray(execution, "events")
                    if (!hasArrayItemWithId(events, request.streamEvent.id)) {
                        const converted = toYValue(request.streamEvent)
                        if (converted !== undefined) events.push([converted])
                    }
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)
            } finally {
                taskDoc.destroy()
            }
        },

        async completeActionEvent(request) {
            const completedAt = request.completedAt ?? now()
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)
                const event = getActionEventMap(taskDoc, request.taskId, request.eventId)

                taskDoc.transact(() => {
                    if (event.get("status") === "stopped") return
                    event.set("status", "completed")
                    event.set("completedAt", completedAt)
                    event.set("result", toYValue({ success: request.success }))
                    meta.set("updatedAt", completedAt)
                    meta.set("lastEventAt", completedAt)
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)
                await syncActionEventPreview(storage, request.taskId, taskDoc, event, completedAt)
            } finally {
                taskDoc.destroy()
            }
        },

        async errorActionEvent(request) {
            const completedAt = request.completedAt ?? now()
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)
                const event = getActionEventMap(taskDoc, request.taskId, request.eventId)

                taskDoc.transact(() => {
                    event.set("status", "error")
                    event.set("completedAt", completedAt)
                    meta.set("updatedAt", completedAt)
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)
                await syncActionEventPreview(storage, request.taskId, taskDoc, event, stringValue(meta.get("lastEventAt"), event.get("createdAt") as string))
            } finally {
                taskDoc.destroy()
            }
        },

        async stoppedActionEvent(request) {
            const completedAt = request.completedAt ?? now()
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)
                const event = getActionEventMap(taskDoc, request.taskId, request.eventId)

                taskDoc.transact(() => {
                    event.set("status", "stopped")
                    event.set("completedAt", completedAt)
                    const execution = ensureYMap(event, "execution")
                    if (request.sessionId) execution.set("sessionId", request.sessionId)
                    if (request.parentSessionId) execution.set("parentSessionId", request.parentSessionId)
                    meta.set("updatedAt", completedAt)
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)
                await syncActionEventPreview(storage, request.taskId, taskDoc, event, stringValue(meta.get("lastEventAt"), event.get("createdAt") as string))
            } finally {
                taskDoc.destroy()
            }
        },

        async reconcileActionEventRuntime(request) {
            const completedAt = request.completedAt ?? now()
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)
                const repoId = stringValue(meta.get("repoId")) || undefined
                const match = findActionEventForRuntime(taskDoc, request)
                if (!match) {
                    return { taskId: request.taskId, repoId, changed: false, reason: "event_not_found" }
                }

                const { event, eventId } = match
                const currentStatus = event.get("status")
                if (currentStatus !== "in_progress") {
                    return {
                        taskId: request.taskId,
                        repoId,
                        eventId,
                        status: currentStatus as OpenADEEventStatus,
                        changed: false,
                        reason: "already_terminal",
                    }
                }

                const nextStatus: OpenADEEventStatus = request.status === "completed" ? "completed" : request.status === "stopped" ? "stopped" : "error"
                taskDoc.transact(() => {
                    if (request.status === "completed") {
                        event.set("status", "completed")
                        event.set("completedAt", completedAt)
                        event.set("result", toYValue({ success: request.success ?? true }))
                        meta.set("lastEventAt", completedAt)
                    } else if (request.status === "stopped") {
                        event.set("status", "stopped")
                        event.set("completedAt", completedAt)
                    } else {
                        event.set("status", "error")
                        event.set("completedAt", completedAt)
                    }
                    meta.set("updatedAt", completedAt)
                })

                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)
                await syncActionEventPreview(
                    storage,
                    request.taskId,
                    taskDoc,
                    event,
                    nextStatus === "completed" ? completedAt : stringValue(meta.get("lastEventAt"), event.get("createdAt") as string)
                )
                return { taskId: request.taskId, repoId, eventId, status: nextStatus, changed: true }
            } finally {
                taskDoc.destroy()
            }
        },

        async updateActionExecution(request) {
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)
                const event = getActionEventMap(taskDoc, request.taskId, request.eventId)

                taskDoc.transact(() => {
                    const execution = ensureYMap(event, "execution")
                    if (request.sessionId) execution.set("sessionId", request.sessionId)
                    if (request.parentSessionId) execution.set("parentSessionId", request.parentSessionId)
                    if (request.gitRefsAfter) execution.set("gitRefsAfter", toYValue(request.gitRefsAfter))
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)
            } finally {
                taskDoc.destroy()
            }
        },

        async addHyperPlanSubExecution(request) {
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)
                const event = getActionEventMap(taskDoc, request.taskId, request.eventId)

                taskDoc.transact(() => {
                    const subExecutions = ensureYArray(event, "hyperplanSubExecutions")
                    if (getHyperPlanSubExecutionMap(event, request.subExecution.stepId)) return
                    const converted = toYValue(request.subExecution)
                    if (converted !== undefined) subExecutions.push([converted])
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)
            } finally {
                taskDoc.destroy()
            }
        },

        async appendHyperPlanSubExecutionStreamEvent(request) {
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)
                const event = getActionEventMap(taskDoc, request.taskId, request.eventId)

                taskDoc.transact(() => {
                    const sub = getHyperPlanSubExecutionMap(event, request.stepId)
                    if (!sub) return
                    const events = ensureYArray(sub, "events")
                    if (!hasArrayItemWithId(events, request.streamEvent.id)) {
                        const converted = toYValue(request.streamEvent)
                        if (converted !== undefined) events.push([converted])
                    }
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)
            } finally {
                taskDoc.destroy()
            }
        },

        async updateHyperPlanSubExecution(request) {
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)
                const event = getActionEventMap(taskDoc, request.taskId, request.eventId)

                taskDoc.transact(() => {
                    const sub = getHyperPlanSubExecutionMap(event, request.stepId)
                    if (!sub) return
                    if (request.executionId !== undefined) sub.set("executionId", request.executionId)
                    if (request.sessionId !== undefined) sub.set("sessionId", request.sessionId)
                    if (request.parentSessionId !== undefined) sub.set("parentSessionId", request.parentSessionId)
                    if (request.status !== undefined) sub.set("status", request.status)
                    if (request.resultText !== undefined) sub.set("resultText", request.resultText)
                    if (request.error !== undefined) sub.set("error", request.error)
                    if (request.reconcileLabel !== undefined) sub.set("reconcileLabel", request.reconcileLabel)
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)
            } finally {
                taskDoc.destroy()
            }
        },

        async setHyperPlanReconcileLabels(request) {
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)
                const event = getActionEventMap(taskDoc, request.taskId, request.eventId)

                taskDoc.transact(() => {
                    for (const { stepId, label } of request.mapping) {
                        const sub = getHyperPlanSubExecutionMap(event, stepId)
                        if (sub) sub.set("reconcileLabel", label)
                    }
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)
            } finally {
                taskDoc.destroy()
            }
        },

        async createSnapshotEvent(request) {
            const eventId = request.eventId ?? createId()
            const createdAt = request.createdAt ?? now()
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)

                taskDoc.transact(() => {
                    if (!hasOrderedItem(taskDoc, "task:events", eventId)) {
                        pushOrderedItem(taskDoc, "task:events", {
                            id: eventId,
                            type: "snapshot",
                            status: "completed",
                            createdAt,
                            completedAt: createdAt,
                            userInput: "",
                            actionEventId: request.actionEventId,
                            referenceBranch: request.referenceBranch,
                            mergeBaseCommit: request.mergeBaseCommit,
                            fullPatch: request.fullPatch,
                            patchFileId: request.patchFileId,
                            stats: request.stats,
                            files: request.files,
                        })
                    }
                    meta.set("updatedAt", createdAt)
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)

                return { eventId, createdAt }
            } finally {
                taskDoc.destroy()
            }
        },

        async createComment(request) {
            const commentId = request.commentId ?? createId()
            const createdAt = request.createdAt ?? now()
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)

                taskDoc.transact(() => {
                    if (!hasOrderedItem(taskDoc, "task:comments", commentId)) {
                        pushOrderedItem(taskDoc, "task:comments", {
                            id: commentId,
                            content: request.content,
                            source: request.source,
                            selectedText: request.selectedText,
                            author: request.author,
                            createdAt,
                        })
                    }
                    meta.set("updatedAt", createdAt)
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)

                return { commentId, createdAt }
            } finally {
                taskDoc.destroy()
            }
        },

        async editComment(request) {
            const updatedAt = request.updatedAt ?? now()
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)
                const comment = getOrderedItemMap(taskDoc, "task:comments", request.commentId)
                if (!comment) throw new Error(`Comment ${request.commentId} not found in task ${request.taskId}`)

                taskDoc.transact(() => {
                    comment.set("content", request.content)
                    comment.set("updatedAt", updatedAt)
                    meta.set("updatedAt", updatedAt)
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)
            } finally {
                taskDoc.destroy()
            }
        },

        async deleteComment(request) {
            const updatedAt = request.updatedAt ?? now()
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)

                taskDoc.transact(() => {
                    deleteOrderedItem(taskDoc, "task:comments", request.commentId)
                    meta.set("updatedAt", updatedAt)
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)
            } finally {
                taskDoc.destroy()
            }
        },

        async updateTaskMetadata(request) {
            const updatedAt = request.updatedAt ?? now()
            const taskDoc = await loadDoc(storage, `code:task:${request.taskId}`)

            try {
                const meta = taskDoc.getMap("task:meta")
                assertTaskMeta(meta, request.taskId)

                taskDoc.transact(() => {
                    if (request.title !== undefined) {
                        const trimmed = request.title.trim()
                        if (trimmed) meta.set("title", trimmed)
                    }
                    if (request.closed !== undefined) meta.set("closed", request.closed)
                    if (request.lastViewedAt !== undefined) meta.set("lastViewedAt", request.lastViewedAt)
                    if (request.lastEventAt !== undefined) meta.set("lastEventAt", request.lastEventAt)
                    if (request.cancelledPlanEventId !== undefined) meta.set("cancelledPlanEventId", request.cancelledPlanEventId)
                    if (request.enabledMcpServerIds !== undefined) {
                        if (request.enabledMcpServerIds.length > 0) {
                            meta.set("enabledMcpServerIds", toYValue(request.enabledMcpServerIds))
                        } else {
                            meta.delete("enabledMcpServerIds")
                        }
                    }
                    if (request.sessionIds) {
                        const sessionIds = ensureYMap(meta, "sessionIds")
                        for (const [key, sessionId] of Object.entries(request.sessionIds)) {
                            if (sessionId) sessionIds.set(key, sessionId)
                        }
                    }
                    meta.set("updatedAt", updatedAt)
                })
                await saveDoc(storage, `code:task:${request.taskId}`, taskDoc)
                await syncTaskMetadataPreview(storage, request.taskId, taskDoc, updatedAt, request.usage)
            } finally {
                taskDoc.destroy()
            }
        },
    }
}
