import type { OpenADEProject, OpenADEQueuedTurn, OpenADESnapshot, OpenADETask, OpenADETaskPreview } from "./types"

export interface OpenADEYjsStorageAdapter {
    hostName?: () => string | undefined
    listDocuments(): Promise<string[]>
    readDocumentBase64(id: string): Promise<{ id: string; data: string } | null>
    readMapObject(documentId: string, mapName: string): Promise<Record<string, unknown> | null>
    readOrderedArray<T extends Record<string, unknown>>(documentId: string, name: string): Promise<T[] | null>
}

export interface OpenADEYjsProjection {
    readPersonalSettings(): Promise<Record<string, unknown>>
    readSnapshot(options?: { version?: string; hostName?: string; workingTaskIds?: string[] }): Promise<OpenADESnapshot>
    readProjects(options?: { workingTaskIds?: string[] }): Promise<OpenADEProject[]>
    readTaskList(repoId: string, options?: { workingTaskIds?: string[] }): Promise<OpenADETaskPreview[]>
    readTask(repoId: string, taskId: string): Promise<OpenADETask>
    listDataDocuments(): Promise<string[]>
    readDataDocumentBase64(id: string): Promise<{ id: string; data: string } | null>
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
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

async function readPersonalSettings(storage: OpenADEYjsStorageAdapter): Promise<Record<string, unknown>> {
    return (await storage.readMapObject("code:personal_settings", "personal_settings")) ?? {}
}

async function readRepos(storage: OpenADEYjsStorageAdapter, options: { workingTaskIds: string[]; pinnedTaskIds: string[] }): Promise<OpenADEProject[]> {
    const repos = (await storage.readOrderedArray<Record<string, unknown>>("code:repos", "repos")) ?? []
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
    async function readSnapshot(options: { version?: string; hostName?: string; workingTaskIds?: string[] } = {}): Promise<OpenADESnapshot> {
        const settings = await readPersonalSettings(storage)
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
            repos: await readRepos(storage, { workingTaskIds, pinnedTaskIds }),
            workingTaskIds,
        }
    }

    async function readProjects(options: { workingTaskIds?: string[] } = {}): Promise<OpenADEProject[]> {
        const snapshot = await readSnapshot(options)
        return snapshot.repos
    }

    async function readTaskList(repoId: string, options: { workingTaskIds?: string[] } = {}): Promise<OpenADETaskPreview[]> {
        const repos = await readProjects(options)
        return repos.find((repo) => repo.id === repoId)?.tasks ?? []
    }

    async function readTask(repoId: string, taskId: string): Promise<OpenADETask> {
        const documentId = `code:task:${taskId}`
        const [meta, events, comments, deviceEnvironments, preview] = await Promise.all([
            storage.readMapObject(documentId, "task:meta"),
            storage.readOrderedArray<Record<string, unknown>>(documentId, "task:events"),
            storage.readOrderedArray<Record<string, unknown>>(documentId, "task:comments"),
            storage.readOrderedArray<Record<string, unknown>>(documentId, "task:deviceEnvironments"),
            readTaskList(repoId).then((tasks) => tasks.find((task) => task.id === taskId)),
        ])

        if (!meta) {
            if (!preview) throw new Error(`Task ${taskId} not found`)
            return {
                id: preview.id,
                repoId,
                slug: preview.slug,
                title: preview.title,
                description: "",
                isolationStrategy: { type: "head" },
                closed: preview.closed,
                createdAt: preview.createdAt,
                updatedAt: preview.lastEventAt ?? preview.createdAt,
                lastViewedAt: preview.lastViewedAt,
                lastEventAt: preview.lastEventAt,
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

        return {
            id: metaId,
            repoId: stringValue(meta.repoId, repoId),
            slug: stringValue(meta.slug, preview?.slug ?? ""),
            title: stringValue(meta.title, preview?.title ?? "Untitled task"),
            description: stringValue(meta.description),
            isolationStrategy: isRecord(meta.isolationStrategy)
                ? (meta.isolationStrategy as OpenADETask["isolationStrategy"])
                : { type: "head" },
            enabledMcpServerIds: Array.isArray(meta.enabledMcpServerIds)
                ? meta.enabledMcpServerIds.filter((id): id is string => typeof id === "string")
                : undefined,
            sessionIds: stringRecord(meta.sessionIds),
            queuedTurns: queuedTurns(meta.queuedTurns),
            cancelledPlanEventId: optionalString(meta.cancelledPlanEventId),
            deviceEnvironments: (deviceEnvironments ?? []) as unknown as OpenADETask["deviceEnvironments"],
            createdBy: isRecord(meta.createdBy) ? (meta.createdBy as unknown as OpenADETask["createdBy"]) : undefined,
            createdAt: stringValue(meta.createdAt, preview?.createdAt ?? zeroTime),
            updatedAt: stringValue(meta.updatedAt, preview?.lastEventAt ?? preview?.createdAt ?? zeroTime),
            lastViewedAt: optionalString(meta.lastViewedAt),
            lastEventAt: optionalString(meta.lastEventAt),
            closed: optionalBoolean(meta.closed),
            pullRequest: isRecord(meta.pullRequest) ? (meta.pullRequest as OpenADETask["pullRequest"]) : undefined,
            events: events ?? [],
            comments: comments ?? [],
        }
    }

    async function listDataDocuments(): Promise<string[]> {
        return storage.listDocuments()
    }

    async function readDataDocumentBase64(id: string): Promise<{ id: string; data: string } | null> {
        return storage.readDocumentBase64(id)
    }

    return {
        readPersonalSettings: () => readPersonalSettings(storage),
        readSnapshot,
        readProjects,
        readTaskList,
        readTask,
        listDataDocuments,
        readDataDocumentBase64,
    }
}
