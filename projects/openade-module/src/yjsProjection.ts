import * as Y from "yjs"
import type {
    OpenADEIsolationStrategy,
    OpenADEProject,
    OpenADEQueuedTurn,
    OpenADESnapshot,
    OpenADETask,
    OpenADETaskPreview,
    OpenADETaskReadOptions,
} from "./types"

export interface OpenADEYjsDocumentOperationOptions {
    operation?: string
}

export interface OpenADEYjsProjectionCacheInvalidation {
    documentIds: readonly string[]
}

export interface OpenADEYjsStorageAdapter {
    hostName?: () => string | undefined
    listDocuments(): Promise<string[]>
    readDocumentUpdate?(id: string, options?: OpenADEYjsDocumentOperationOptions): Promise<Uint8Array | null>
    readDocumentBase64(id: string, options?: OpenADEYjsDocumentOperationOptions): Promise<{ id: string; data: string } | null>
    readMapObject(documentId: string, mapName: string): Promise<Record<string, unknown> | null>
    readOrderedArray<T extends Record<string, unknown>>(documentId: string, name: string): Promise<T[] | null>
}

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonRecord = { [key: string]: JsonValue }

interface ProjectedTaskDocument {
    meta: Record<string, unknown> | null
    events: Record<string, unknown>[] | null
    comments: Record<string, unknown>[] | null
    deviceEnvironments: Record<string, unknown>[] | null
}

interface ProjectedReposDocument {
    repos: Record<string, unknown>[]
}

interface CachedProjectedDocument<T> {
    data: Uint8Array
    value: T
    expiresAt: number
}

interface ProjectionReadCache {
    personalSettingsDocuments: Map<string, CachedProjectedDocument<Record<string, unknown>>>
    reposDocuments: Map<string, CachedProjectedDocument<ProjectedReposDocument>>
    taskDocuments: Map<string, CachedProjectedDocument<ProjectedTaskDocument>>
}

export interface OpenADEYjsProjection {
    readPersonalSettings(): Promise<Record<string, unknown>>
    readSnapshot(options?: { version?: string; hostName?: string; workingTaskIds?: string[] }): Promise<OpenADESnapshot>
    readProjects(options?: { workingTaskIds?: string[] }): Promise<OpenADEProject[]>
    readTaskList(repoId: string, options?: { workingTaskIds?: string[] }): Promise<OpenADETaskPreview[]>
    readTask(repoId: string, taskId: string, options?: OpenADETaskReadOptions): Promise<OpenADETask>
    listDataDocuments(): Promise<string[]>
    readDataDocumentBase64(id: string, options?: OpenADEYjsDocumentOperationOptions): Promise<{ id: string; data: string } | null>
    invalidateCache(invalidation?: OpenADEYjsProjectionCacheInvalidation): void
}

type OpenADETaskPreviewLastEvent = NonNullable<OpenADETaskPreview["lastEvent"]>

const themeLabels: Record<string, string> = {
    "code-theme-light": "Light",
    "code-theme-bright": "Bright",
    "code-theme-clean": "Clean",
    "code-theme-black": "Black",
    "code-theme-synthwave": "Synthwave",
    "code-theme-dracula": "Dracula",
}

const zeroTime = new Date(0).toISOString()
const LIGHTWEIGHT_TASK_EVENT_TAIL_COUNT = 80
const LIGHTWEIGHT_STREAM_EVENT_TASK_TAIL_COUNT = 20
const LIGHTWEIGHT_STREAM_EVENT_TAIL_COUNT = 120
const PROJECTED_TASK_DOCUMENT_CACHE_TTL_MS = 15_000
const PROJECTED_TASK_DOCUMENT_CACHE_MAX = 96
const PROJECTED_TASK_DOCUMENT_CACHE_MAX_BYTES = 160 * 1024 * 1024
const PROJECTED_SMALL_DOCUMENT_CACHE_TTL_MS = PROJECTED_TASK_DOCUMENT_CACHE_TTL_MS
const PROJECTED_SMALL_DOCUMENT_CACHE_MAX = 4

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toPlain(value: unknown): JsonValue | undefined {
    if (value instanceof Y.Map) {
        const result: JsonRecord = {}
        value.forEach((nested: unknown, key: string) => {
            const converted = toPlain(nested)
            if (converted !== undefined) result[key] = converted
        })
        return result
    }

    if (value instanceof Y.Array) {
        return value.toArray().map(toPlain).filter((nested): nested is JsonValue => nested !== undefined)
    }

    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined

    if (Array.isArray(value)) {
        return value.map(toPlain).filter((nested): nested is JsonValue => nested !== undefined)
    }

    if (isRecord(value)) {
        const result: JsonRecord = {}
        for (const [key, nested] of Object.entries(value)) {
            const converted = toPlain(nested)
            if (converted !== undefined) result[key] = converted
        }
        return result
    }

    return undefined
}

function applyYjsUpdate(data: Uint8Array): Y.Doc {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, data)
    return doc
}

function readMapObjectFromDoc(doc: Y.Doc, mapName: string): Record<string, unknown> {
    const value = toPlain(doc.getMap(mapName))
    return isRecord(value) ? value : {}
}

function readOrderedArrayFromDoc<T extends Record<string, unknown>>(doc: Y.Doc, name: string): T[] {
    const dataMap = doc.getMap(`${name}:data`)
    const orderArray = doc.getArray<string>(`${name}:order`)
    const rows: T[] = []

    for (const id of orderArray.toArray()) {
        const row = toPlain(dataMap.get(id))
        if (isRecord(row)) rows.push(row as T)
    }

    return rows
}

function stringValue(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined
}

function stringRecord(value: unknown): Record<string, string> | undefined {
    if (!isRecord(value)) return undefined
    const result: Record<string, string> = {}
    for (const [key, nested] of Object.entries(value)) {
        if (typeof nested === "string" && nested.length > 0) result[key] = nested
    }
    return result
}

function queuedTurns(value: unknown): OpenADEQueuedTurn[] | undefined {
    if (!Array.isArray(value)) return undefined
    const result = value.filter((item): item is OpenADEQueuedTurn => {
        if (!isRecord(item)) return false
        return typeof item.id === "string" && (item.type === "do" || item.type === "ask") && typeof item.input === "string" && typeof item.status === "string"
    })
    return result.length > 0 ? result : undefined
}

function boundedStreamEvents(value: unknown, keepTail: boolean): { events: unknown[]; omittedEventCount?: number } {
    const events = Array.isArray(value) ? value : []
    const keepCount = keepTail ? LIGHTWEIGHT_STREAM_EVENT_TAIL_COUNT : 0
    if (events.length <= keepCount) return { events }

    return {
        events: keepCount > 0 ? events.slice(-keepCount) : [],
        omittedEventCount: events.length - keepCount,
    }
}

function boundedExecution(value: unknown, keepTail: boolean): unknown {
    if (!isRecord(value)) return value

    const bounded = boundedStreamEvents(value.events, keepTail)
    if (bounded.events === value.events && !bounded.omittedEventCount) return value

    return {
        ...value,
        events: bounded.events,
        ...(bounded.omittedEventCount ? { omittedEventCount: bounded.omittedEventCount } : {}),
    }
}

function boundedHyperPlanSubExecution(value: unknown, keepTail: boolean): unknown {
    if (!isRecord(value)) return value

    const bounded = boundedStreamEvents(value.events, keepTail)
    if (bounded.events === value.events && !bounded.omittedEventCount) return value

    return {
        ...value,
        events: bounded.events,
        ...(bounded.omittedEventCount ? { omittedEventCount: bounded.omittedEventCount } : {}),
    }
}

function boundedHyperPlanSubExecutions(value: unknown, keepTail: boolean): unknown {
    if (!Array.isArray(value)) return value
    return value.map((subExecution) => boundedHyperPlanSubExecution(subExecution, keepTail))
}

function boundedTaskEvent(value: Record<string, unknown>, keepTail: boolean): Record<string, unknown> {
    if (value.type !== "action") return value

    const execution = boundedExecution(value.execution, keepTail)
    const hyperplanSubExecutions = boundedHyperPlanSubExecutions(value.hyperplanSubExecutions, keepTail)
    if (execution === value.execution && hyperplanSubExecutions === value.hyperplanSubExecutions) return value

    return {
        ...value,
        execution,
        ...(hyperplanSubExecutions !== value.hyperplanSubExecutions ? { hyperplanSubExecutions } : {}),
    }
}

function boundTaskSessionPayloads(events: Record<string, unknown>[], options: OpenADETaskReadOptions | undefined): Record<string, unknown>[] {
    if (options?.hydrateSessionEvents) return events

    const requestedEventLimit = options?.eventLimit
    const taskEventLimit =
        typeof requestedEventLimit === "number" && Number.isFinite(requestedEventLimit) && requestedEventLimit > 0
            ? Math.min(Math.floor(requestedEventLimit), LIGHTWEIGHT_TASK_EVENT_TAIL_COUNT)
            : LIGHTWEIGHT_TASK_EVENT_TAIL_COUNT
    const taskTailStart = Math.max(0, events.length - taskEventLimit)
    const streamTailStart = Math.max(0, events.length - LIGHTWEIGHT_STREAM_EVENT_TASK_TAIL_COUNT)
    const selectedEvents = requestedEventLimit === undefined ? events : events.slice(taskTailStart)
    const selectedStartIndex = requestedEventLimit === undefined ? 0 : taskTailStart
    return selectedEvents.map((event, index) => {
        const sourceIndex = selectedStartIndex + index
        return sourceIndex >= taskTailStart ? boundedTaskEvent(event, sourceIndex >= streamTailStart) : boundedTaskEvent(event, false)
    })
}

function sameDocumentData(left: Uint8Array, right: Uint8Array): boolean {
    if (left === right) return true
    if (left.byteLength !== right.byteLength) return false
    for (let index = 0; index < left.byteLength; index += 1) {
        if (left[index] !== right[index]) return false
    }
    return true
}

function rememberProjectedDocument<T>(
    documents: Map<string, CachedProjectedDocument<T>>,
    documentId: string,
    data: Uint8Array,
    value: T,
    ttlMs: number,
    maxDocuments: number,
    maxBytes?: number
): void {
    documents.delete(documentId)
    documents.set(documentId, {
        data,
        value,
        expiresAt: Date.now() + ttlMs,
    })

    while (documents.size > maxDocuments || (maxBytes !== undefined && projectedDocumentCacheBytes(documents) > maxBytes)) {
        const oldestKey = documents.keys().next().value
        if (typeof oldestKey !== "string") break
        documents.delete(oldestKey)
    }
}

function projectedDocumentCacheBytes<T>(documents: Map<string, CachedProjectedDocument<T>>): number {
    let bytes = 0
    for (const document of documents.values()) bytes += document.data.byteLength
    return bytes
}

function cachedProjectedDocument<T>(documents: Map<string, CachedProjectedDocument<T>>, documentId: string, data: Uint8Array, ttlMs: number): T | null {
    const cached = documents.get(documentId)
    if (!cached) return null
    if (cached.expiresAt <= Date.now() || !sameDocumentData(cached.data, data)) {
        documents.delete(documentId)
        return null
    }

    documents.delete(documentId)
    documents.set(documentId, {
        ...cached,
        expiresAt: Date.now() + ttlMs,
    })
    return cached.value
}

function freshProjectedDocument<T>(documents: Map<string, CachedProjectedDocument<T>>, documentId: string): T | null {
    const cached = documents.get(documentId)
    if (!cached) return null
    if (cached.expiresAt <= Date.now()) return null
    return cached.value
}

async function readProjectedTaskDocument(
    storage: OpenADEYjsStorageAdapter,
    documentId: string,
    cache: ProjectionReadCache
): Promise<ProjectedTaskDocument> {
    const fresh = freshProjectedDocument(cache.taskDocuments, documentId)
    if (fresh) return fresh

    const data = await storage.readDocumentUpdate?.(documentId, { operation: "OpenADEYjsProjection.readTask" })
    if (data) {
        const cached = cachedProjectedDocument(cache.taskDocuments, documentId, data, PROJECTED_TASK_DOCUMENT_CACHE_TTL_MS)
        if (cached) return cached

        const doc = applyYjsUpdate(data)
        try {
            const value = {
                meta: readMapObjectFromDoc(doc, "task:meta"),
                events: readOrderedArrayFromDoc<Record<string, unknown>>(doc, "task:events"),
                comments: readOrderedArrayFromDoc<Record<string, unknown>>(doc, "task:comments"),
                deviceEnvironments: readOrderedArrayFromDoc<Record<string, unknown>>(doc, "task:deviceEnvironments"),
            }
            rememberProjectedDocument(
                cache.taskDocuments,
                documentId,
                data,
                value,
                PROJECTED_TASK_DOCUMENT_CACHE_TTL_MS,
                PROJECTED_TASK_DOCUMENT_CACHE_MAX,
                PROJECTED_TASK_DOCUMENT_CACHE_MAX_BYTES
            )
            return value
        } finally {
            doc.destroy()
        }
    }

    if (data === null) {
        cache.taskDocuments.delete(documentId)
        return {
            meta: null,
            events: null,
            comments: null,
            deviceEnvironments: null,
        }
    }

    const [meta, events, comments, deviceEnvironments] = await Promise.all([
        storage.readMapObject(documentId, "task:meta"),
        storage.readOrderedArray<Record<string, unknown>>(documentId, "task:events"),
        storage.readOrderedArray<Record<string, unknown>>(documentId, "task:comments"),
        storage.readOrderedArray<Record<string, unknown>>(documentId, "task:deviceEnvironments"),
    ])

    return { meta, events, comments, deviceEnvironments }
}

function isolationStrategy(value: unknown): OpenADEIsolationStrategy {
    if (!isRecord(value)) return { type: "head" }
    if (value.type === "head") return { type: "head" }
    if (value.type === "worktree") {
        return {
            type: "worktree",
            sourceBranch: stringValue(value.sourceBranch, "HEAD"),
        }
    }
    return { type: "head" }
}

function lastEventTime(task: OpenADETaskPreview): string {
    return task.lastEvent?.at ?? task.createdAt ?? zeroTime
}

function sortTasksLikeSidebar(tasks: OpenADETaskPreview[], workingTaskIds: Iterable<string>, pinnedTaskIds: Iterable<string>): OpenADETaskPreview[] {
    const working = new Set(workingTaskIds)
    const pinned = new Set(pinnedTaskIds)
    const byRecent = (a: OpenADETaskPreview, b: OpenADETaskPreview) => lastEventTime(b).localeCompare(lastEventTime(a))
    const withRunningFirst = (items: OpenADETaskPreview[]) => [
        ...items.filter((task) => working.has(task.id)),
        ...items.filter((task) => !working.has(task.id)),
    ]
    const open = tasks.filter((task) => !task.closed).sort(byRecent)
    const closed = tasks.filter((task) => task.closed).sort(byRecent)

    return [
        ...withRunningFirst(open.filter((task) => pinned.has(task.id))),
        ...withRunningFirst(open.filter((task) => !pinned.has(task.id))),
        ...closed.filter((task) => pinned.has(task.id)),
        ...closed.filter((task) => !pinned.has(task.id)),
    ]
}

function toOpenADETaskPreview(value: Record<string, unknown>): OpenADETaskPreview | null {
    const id = stringValue(value.id)
    if (!id) return null

    const lastEvent = isRecord(value.lastEvent)
        ? {
              type: stringValue(value.lastEvent.type) as OpenADETaskPreviewLastEvent["type"],
              status: stringValue(value.lastEvent.status) as OpenADETaskPreviewLastEvent["status"],
              sourceType: optionalString(value.lastEvent.sourceType) as OpenADETaskPreviewLastEvent["sourceType"],
              sourceLabel: stringValue(value.lastEvent.sourceLabel),
              at: stringValue(value.lastEvent.at),
          }
        : undefined

    return {
        id,
        slug: stringValue(value.slug),
        title: stringValue(value.title, "Untitled task"),
        closed: optionalBoolean(value.closed),
        createdAt: stringValue(value.createdAt, zeroTime),
        lastEvent,
        usage: isRecord(value.usage) ? (value.usage as unknown as OpenADETaskPreview["usage"]) : undefined,
        lastViewedAt: optionalString(value.lastViewedAt),
        lastEventAt: optionalString(value.lastEventAt),
    }
}

function toOpenADEProject(value: Record<string, unknown>, options: { workingTaskIds: string[]; pinnedTaskIds: string[] }): OpenADEProject | null {
    const id = stringValue(value.id)
    if (!id) return null

    const rawTasks = Array.isArray(value.tasks) ? value.tasks : []
    const tasks = rawTasks
        .map((task) => (isRecord(task) ? toOpenADETaskPreview(task) : null))
        .filter((task): task is OpenADETaskPreview => task !== null)

    return {
        id,
        name: stringValue(value.name, "Untitled project"),
        path: stringValue(value.path),
        archived: optionalBoolean(value.archived),
        tasks: sortTasksLikeSidebar(tasks, options.workingTaskIds, options.pinnedTaskIds),
    }
}

async function readPersonalSettings(storage: OpenADEYjsStorageAdapter, cache: ProjectionReadCache): Promise<Record<string, unknown>> {
    const documentId = "code:personal_settings"
    const fresh = freshProjectedDocument(cache.personalSettingsDocuments, documentId)
    if (fresh) return fresh

    const data = await storage.readDocumentUpdate?.(documentId, { operation: "OpenADEYjsProjection.readPersonalSettings" })
    if (data) {
        const cached = cachedProjectedDocument(cache.personalSettingsDocuments, documentId, data, PROJECTED_SMALL_DOCUMENT_CACHE_TTL_MS)
        if (cached) return cached

        const doc = applyYjsUpdate(data)
        try {
            const value = readMapObjectFromDoc(doc, "personal_settings")
            rememberProjectedDocument(
                cache.personalSettingsDocuments,
                documentId,
                data,
                value,
                PROJECTED_SMALL_DOCUMENT_CACHE_TTL_MS,
                PROJECTED_SMALL_DOCUMENT_CACHE_MAX
            )
            return value
        } finally {
            doc.destroy()
        }
    }

    if (data === null) {
        cache.personalSettingsDocuments.delete(documentId)
        return {}
    }

    return (await storage.readMapObject("code:personal_settings", "personal_settings")) ?? {}
}

async function readRepoRows(storage: OpenADEYjsStorageAdapter, cache: ProjectionReadCache): Promise<Record<string, unknown>[]> {
    const documentId = "code:repos"
    const fresh = freshProjectedDocument(cache.reposDocuments, documentId)
    if (fresh) return fresh.repos

    const data = await storage.readDocumentUpdate?.(documentId, { operation: "OpenADEYjsProjection.readRepos" })
    if (data) {
        const cached = cachedProjectedDocument(cache.reposDocuments, documentId, data, PROJECTED_SMALL_DOCUMENT_CACHE_TTL_MS)
        if (cached) return cached.repos

        const doc = applyYjsUpdate(data)
        try {
            const value: ProjectedReposDocument = {
                repos: readOrderedArrayFromDoc<Record<string, unknown>>(doc, "repos"),
            }
            rememberProjectedDocument(cache.reposDocuments, documentId, data, value, PROJECTED_SMALL_DOCUMENT_CACHE_TTL_MS, PROJECTED_SMALL_DOCUMENT_CACHE_MAX)
            return value.repos
        } finally {
            doc.destroy()
        }
    }

    if (data === null) {
        cache.reposDocuments.delete(documentId)
        return []
    }

    return (await storage.readOrderedArray<Record<string, unknown>>(documentId, "repos")) ?? []
}

async function readRepos(
    storage: OpenADEYjsStorageAdapter,
    cache: ProjectionReadCache,
    options: { workingTaskIds: string[]; pinnedTaskIds: string[] }
): Promise<OpenADEProject[]> {
    const repos = await readRepoRows(storage, cache)
    return repos.map((repo) => toOpenADEProject(repo, options)).filter((repo): repo is OpenADEProject => repo !== null)
}

function resolveTheme(settings: Record<string, unknown>): OpenADESnapshot["server"]["theme"] {
    const setting = stringValue(settings.theme, "system")
    const className = setting.startsWith("code-theme-") ? setting : "code-theme-light"
    return {
        setting,
        className,
        label: themeLabels[className],
    }
}

export function createOpenADEYjsProjection(storage: OpenADEYjsStorageAdapter): OpenADEYjsProjection {
    const cache: ProjectionReadCache = {
        personalSettingsDocuments: new Map(),
        reposDocuments: new Map(),
        taskDocuments: new Map(),
    }

    function invalidateCache(invalidation?: OpenADEYjsProjectionCacheInvalidation): void {
        if (invalidation) {
            for (const documentId of invalidation.documentIds) {
                if (documentId === "code:personal_settings") cache.personalSettingsDocuments.delete(documentId)
                if (documentId === "code:repos") cache.reposDocuments.delete(documentId)
                if (documentId.startsWith("code:task:")) cache.taskDocuments.delete(documentId)
            }
            return
        }

        cache.personalSettingsDocuments.clear()
        cache.reposDocuments.clear()
        cache.taskDocuments.clear()
    }

    async function readSnapshot(options: { version?: string; hostName?: string; workingTaskIds?: string[] } = {}): Promise<OpenADESnapshot> {
        const settings = await readPersonalSettings(storage, cache)
        const workingTaskIds = options.workingTaskIds ?? []
        const pinnedTaskIds = Array.isArray(settings.pinnedTaskIds)
            ? settings.pinnedTaskIds.filter((id): id is string => typeof id === "string")
            : []

        return {
            server: {
                version: options.version ?? "local",
                hostName: options.hostName ?? storage.hostName?.() ?? "OpenADE",
                theme: resolveTheme(settings),
            },
            repos: await readRepos(storage, cache, { workingTaskIds, pinnedTaskIds }),
            workingTaskIds,
        }
    }

    async function readProjects(options: { workingTaskIds?: string[] } = {}): Promise<OpenADEProject[]> {
        return readRepos(storage, cache, { workingTaskIds: options.workingTaskIds ?? [], pinnedTaskIds: [] })
    }

    async function readTaskList(repoId: string, options: { workingTaskIds?: string[] } = {}): Promise<OpenADETaskPreview[]> {
        const repos = await readProjects(options)
        return repos.find((repo) => repo.id === repoId)?.tasks ?? []
    }

    async function readTaskPreview(repoId: string, taskId: string): Promise<OpenADETaskPreview | undefined> {
        const repos = await readRepos(storage, cache, { workingTaskIds: [], pinnedTaskIds: [] })
        return repos.find((repo) => repo.id === repoId)?.tasks.find((task) => task.id === taskId)
    }

    async function readTask(repoId: string, taskId: string, options: OpenADETaskReadOptions = {}): Promise<OpenADETask> {
        const documentId = `code:task:${taskId}`
        const taskDocument = await readProjectedTaskDocument(storage, documentId, cache)
        const { meta, events, comments, deviceEnvironments } = taskDocument

        if (!meta) {
            const fallbackPreview = await readTaskPreview(repoId, taskId)
            if (!fallbackPreview) throw new Error(`Task ${taskId} not found`)
            return {
                id: fallbackPreview.id,
                repoId,
                slug: fallbackPreview.slug,
                title: fallbackPreview.title,
                description: "",
                isolationStrategy: { type: "head" },
                closed: fallbackPreview.closed,
                createdAt: fallbackPreview.createdAt,
                updatedAt: fallbackPreview.lastEventAt ?? fallbackPreview.createdAt,
                lastViewedAt: fallbackPreview.lastViewedAt,
                lastEventAt: fallbackPreview.lastEventAt,
                unavailableReason: "Task data is unavailable on the desktop host.",
                deviceEnvironments: [],
                events: [],
                comments: [],
            }
        }

        const metaId = stringValue(meta.id)
        if (metaId !== taskId) {
            throw new Error(`Task document ${taskId} has mismatched metadata id ${metaId || "<empty>"}`)
        }

        const metaSlug = optionalString(meta.slug)
        const metaTitle = optionalString(meta.title)
        const metaCreatedAt = optionalString(meta.createdAt)
        const metaUpdatedAt = optionalString(meta.updatedAt)
        const metaLastEventAt = optionalString(meta.lastEventAt)
        const preview = metaTitle === undefined || (metaSlug === undefined && metaCreatedAt === undefined) ? await readTaskPreview(repoId, taskId) : undefined

        return {
            id: metaId,
            repoId: stringValue(meta.repoId, repoId),
            slug: metaSlug ?? preview?.slug ?? "",
            title: metaTitle ?? preview?.title ?? "Untitled task",
            description: stringValue(meta.description),
            isolationStrategy: isolationStrategy(meta.isolationStrategy),
            enabledMcpServerIds: Array.isArray(meta.enabledMcpServerIds)
                ? meta.enabledMcpServerIds.filter((id): id is string => typeof id === "string")
                : undefined,
            sessionIds: stringRecord(meta.sessionIds),
            queuedTurns: queuedTurns(meta.queuedTurns),
            cancelledPlanEventId: optionalString(meta.cancelledPlanEventId),
            deviceEnvironments: (deviceEnvironments ?? []) as unknown as OpenADETask["deviceEnvironments"],
            createdBy: isRecord(meta.createdBy) ? (meta.createdBy as unknown as OpenADETask["createdBy"]) : undefined,
            createdAt: metaCreatedAt ?? preview?.createdAt ?? zeroTime,
            updatedAt: metaUpdatedAt ?? metaLastEventAt ?? preview?.lastEventAt ?? preview?.createdAt ?? metaCreatedAt ?? zeroTime,
            lastViewedAt: optionalString(meta.lastViewedAt),
            lastEventAt: metaLastEventAt,
            closed: optionalBoolean(meta.closed),
            pullRequest: isRecord(meta.pullRequest) ? (meta.pullRequest as OpenADETask["pullRequest"]) : undefined,
            events: boundTaskSessionPayloads(events ?? [], options),
            comments: comments ?? [],
        }
    }

    async function listDataDocuments(): Promise<string[]> {
        return storage.listDocuments()
    }

    async function readDataDocumentBase64(
        id: string,
        options?: OpenADEYjsDocumentOperationOptions
    ): Promise<{ id: string; data: string } | null> {
        return storage.readDocumentBase64(id, options)
    }

    return {
        readPersonalSettings: () => readPersonalSettings(storage, cache),
        readSnapshot,
        readProjects,
        readTaskList,
        readTask,
        listDataDocuments,
        readDataDocumentBase64,
        invalidateCache,
    }
}
