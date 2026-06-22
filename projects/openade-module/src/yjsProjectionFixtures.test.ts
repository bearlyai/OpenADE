import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as Y from "yjs"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createOpenADENodeYjsStorage } from "./nodeYjsStorage"
import { OPENADE_YJS_FIXTURE_V1 } from "./testing/yjsProjectionFixtures"
import { createOpenADEYjsProjection } from "./yjsProjection"

let storageDir = ""
let storage: ReturnType<typeof createOpenADENodeYjsStorage>

async function installFixture(): Promise<void> {
    for (const [id, data] of Object.entries(OPENADE_YJS_FIXTURE_V1)) {
        await storage.saveDocumentUpdate(id, Buffer.from(data, "base64"))
    }
}

function eventId(event: unknown): string {
    if (typeof event !== "object" || event === null || !("id" in event)) {
        return ""
    }
    const id = event.id
    return typeof id === "string" ? id : ""
}

function record(value: unknown): Record<string, unknown> | null {
    return isRecord(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toYValue(value: unknown): unknown {
    if (value === undefined) return undefined
    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined

    if (Array.isArray(value)) {
        const array = new Y.Array<unknown>()
        const values = value.map(toYValue).filter((nested) => nested !== undefined)
        if (values.length > 0) array.push(values)
        return array
    }

    if (isRecord(value)) {
        const map = new Y.Map<unknown>()
        for (const [key, nested] of Object.entries(value)) {
            const converted = toYValue(nested)
            if (converted !== undefined) map.set(key, converted)
        }
        return map
    }

    return undefined
}

async function installSparseLegacyTaskFixture(): Promise<void> {
    const updatedAt = "2026-05-06T00:00:00.000Z"
    const reposDoc = new Y.Doc()
    const reposData = await storage.readDocumentUpdate("code:repos")
    if (!reposData) throw new Error("Fixture repo document is missing")
    Y.applyUpdate(reposDoc, reposData)

    try {
        const repoMap = reposDoc.getMap<Y.Map<unknown>>("repos:data").get("repo-fixture")
        if (!(repoMap instanceof Y.Map)) throw new Error("Fixture repo is missing")
        const tasks = repoMap.get("tasks")
        if (!(tasks instanceof Y.Array)) throw new Error("Fixture repo tasks are missing")

        reposDoc.transact(() => {
            tasks.push([
                toYValue({
                    id: "task-sparse",
                    slug: "sparse-task",
                    title: "Sparse preview title",
                    createdAt: updatedAt,
                }),
            ])
            repoMap.set("updatedAt", updatedAt)
        })
        await storage.saveDocumentUpdate("code:repos", Y.encodeStateAsUpdate(reposDoc))
    } finally {
        reposDoc.destroy()
    }

    const taskDoc = new Y.Doc()
    try {
        const meta = taskDoc.getMap<unknown>("task:meta")
        taskDoc.transact(() => {
            meta.set("id", "task-sparse")
            meta.set("repoId", "repo-fixture")
            meta.set("title", "Sparse meta title")
            meta.set("isolationStrategy", toYValue({ type: "worktree" }))
            meta.set("queuedTurns", toYValue([{ id: "bad-queued-turn", type: "do", input: 42, status: "queued" }]))
        })
        await storage.saveDocumentUpdate("code:task:task-sparse", Y.encodeStateAsUpdate(taskDoc))
    } finally {
        taskDoc.destroy()
    }
}

function streamEvent(index: number): Record<string, unknown> & { id: string } {
    return {
        id: `stream-${index}`,
        type: "stderr",
        executionId: "exec-large",
        harnessId: "codex",
        direction: "execution",
        data: `stderr ${index}`,
    }
}

function actionEvent(index: number, streamEventCount: number): Record<string, unknown> & { id: string } {
    return {
        id: `event-${index}`,
        type: "action",
        status: "completed",
        createdAt: "2026-05-07T00:00:00.000Z",
        completedAt: "2026-05-07T00:00:01.000Z",
        userInput: `Prompt ${index}`,
        execution: {
            harnessId: "codex",
            executionId: `exec-${index}`,
            events: Array.from({ length: streamEventCount }, (_, streamIndex) => streamEvent(streamIndex)),
        },
        source: { type: "do", userLabel: "Do" },
        includesCommentIds: [],
        result: { success: true },
    }
}

async function installLargeSessionTaskFixture(): Promise<void> {
    const updatedAt = "2026-05-07T00:00:00.000Z"
    const reposDoc = new Y.Doc()
    const reposData = await storage.readDocumentUpdate("code:repos")
    if (!reposData) throw new Error("Fixture repo document is missing")
    Y.applyUpdate(reposDoc, reposData)

    try {
        const repoMap = reposDoc.getMap<Y.Map<unknown>>("repos:data").get("repo-fixture")
        if (!(repoMap instanceof Y.Map)) throw new Error("Fixture repo is missing")
        const tasks = repoMap.get("tasks")
        if (!(tasks instanceof Y.Array)) throw new Error("Fixture repo tasks are missing")

        reposDoc.transact(() => {
            tasks.push([
                toYValue({
                    id: "task-large-session",
                    slug: "large-session-task",
                    title: "Large session task",
                    createdAt: updatedAt,
                    lastEventAt: updatedAt,
                    lastEvent: {
                        type: "action",
                        status: "completed",
                        sourceType: "do",
                        sourceLabel: "Do",
                        at: updatedAt,
                    },
                }),
            ])
            repoMap.set("updatedAt", updatedAt)
        })
        await storage.saveDocumentUpdate("code:repos", Y.encodeStateAsUpdate(reposDoc))
    } finally {
        reposDoc.destroy()
    }

    const taskDoc = new Y.Doc()
    try {
        const meta = taskDoc.getMap<unknown>("task:meta")
        const eventData = taskDoc.getMap<unknown>("task:events:data")
        const eventOrder = taskDoc.getArray<string>("task:events:order")

        taskDoc.transact(() => {
            meta.set("id", "task-large-session")
            meta.set("repoId", "repo-fixture")
            meta.set("slug", "large-session-task")
            meta.set("title", "Large session task")
            meta.set("description", "Task with large stored session arrays.")
            meta.set("isolationStrategy", toYValue({ type: "head" }))
            meta.set("createdAt", updatedAt)
            meta.set("updatedAt", updatedAt)
            meta.set("lastEventAt", updatedAt)

            for (let index = 0; index < 82; index++) {
                const event = actionEvent(index, index === 81 ? 365 : 1)
                eventData.set(event.id, toYValue(event))
                eventOrder.push([event.id])
            }
        })
        await storage.saveDocumentUpdate("code:task:task-large-session", Y.encodeStateAsUpdate(taskDoc))
    } finally {
        taskDoc.destroy()
    }
}

async function installTinyTaskFixture(taskId: string): Promise<void> {
    const updatedAt = "2026-05-08T00:00:00.000Z"
    const reposDoc = new Y.Doc()
    const reposData = await storage.readDocumentUpdate("code:repos")
    if (!reposData) throw new Error("Fixture repo document is missing")
    Y.applyUpdate(reposDoc, reposData)

    try {
        const repoMap = reposDoc.getMap<Y.Map<unknown>>("repos:data").get("repo-fixture")
        if (!(repoMap instanceof Y.Map)) throw new Error("Fixture repo is missing")
        const tasks = repoMap.get("tasks")
        if (!(tasks instanceof Y.Array)) throw new Error("Fixture repo tasks are missing")

        reposDoc.transact(() => {
            tasks.push([
                toYValue({
                    id: taskId,
                    slug: taskId,
                    title: `Task ${taskId}`,
                    createdAt: updatedAt,
                    lastEventAt: updatedAt,
                }),
            ])
            repoMap.set("updatedAt", updatedAt)
        })
        await storage.saveDocumentUpdate("code:repos", Y.encodeStateAsUpdate(reposDoc))
    } finally {
        reposDoc.destroy()
    }

    const taskDoc = new Y.Doc()
    try {
        const meta = taskDoc.getMap<unknown>("task:meta")
        taskDoc.transact(() => {
            meta.set("id", taskId)
            meta.set("repoId", "repo-fixture")
            meta.set("slug", taskId)
            meta.set("title", `Task ${taskId}`)
            meta.set("description", "")
            meta.set("isolationStrategy", toYValue({ type: "head" }))
            meta.set("createdAt", updatedAt)
            meta.set("updatedAt", updatedAt)
            meta.set("lastEventAt", updatedAt)
        })
        await storage.saveDocumentUpdate(`code:task:${taskId}`, Y.encodeStateAsUpdate(taskDoc))
    } finally {
        taskDoc.destroy()
    }
}

describe("createOpenADEYjsProjection fixtures", () => {
    beforeEach(async () => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-module-projection-fixture-"))
        storage = createOpenADENodeYjsStorage(storageDir, { legacyNestedRootDir: null })
        await installFixture()
    })

    afterEach(() => {
        fs.rmSync(storageDir, { recursive: true, force: true })
    })

    it("projects committed old Yjs repo data into the OpenADE snapshot contract", async () => {
        const projection = createOpenADEYjsProjection({
            ...storage,
            hostName: () => "fixture-host",
        })

        const snapshot = await projection.readSnapshot({
            version: "fixture-version",
            workingTaskIds: ["task-action"],
        })
        const documentIds = await projection.listDataDocuments()

        expect(documentIds.sort()).toEqual(Object.keys(OPENADE_YJS_FIXTURE_V1).sort())
        expect(snapshot.server).toEqual({
            version: "fixture-version",
            hostName: "fixture-host",
            theme: {
                setting: "code-theme-synthwave",
                className: "code-theme-synthwave",
                label: "Synthwave",
            },
        })
        expect(snapshot.workingTaskIds).toEqual(["task-action"])
        expect(snapshot.repos).toHaveLength(1)
        expect(snapshot.repos[0]).toMatchObject({
            id: "repo-fixture",
            name: "Fixture Repo",
            path: "/tmp/openade-fixture-repo",
            archived: false,
        })
        expect(snapshot.repos[0].tasks.map((task) => task.id)).toEqual([
            "task-action",
            "task-missing",
            "task-mismatch",
            "task-old-open",
            "task-closed",
        ])
        expect(snapshot.repos[0].tasks.find((task) => task.id === "task-action")).toMatchObject({
            title: "Action task",
            usage: {
                usageVersion: 1,
                inputTokens: 3,
                outputTokens: 5,
                totalCostUsd: 0.01,
                eventCount: 1,
                costByModel: { "gpt-test": 0.01 },
            },
            lastEvent: {
                type: "action",
                status: "completed",
                sourceType: "do",
                sourceLabel: "Do",
                at: "2026-05-02T01:00:00.000Z",
            },
        })
    })

    it("keeps project and task-list reads on the same lightweight preview contract", async () => {
        const projection = createOpenADEYjsProjection(storage)

        const snapshot = await projection.readSnapshot({ workingTaskIds: ["task-action"] })
        const projects = await projection.readProjects({ workingTaskIds: ["task-action"] })
        const taskList = await projection.readTaskList("repo-fixture", { workingTaskIds: ["task-action"] })

        expect(projects[0]).toMatchObject({
            id: snapshot.repos[0].id,
            name: snapshot.repos[0].name,
            path: snapshot.repos[0].path,
            archived: snapshot.repos[0].archived,
        })
        expect(taskList).toEqual(projects[0].tasks)
        expect(taskList.map((task) => task.id)).toEqual([
            "task-action",
            "task-mismatch",
            "task-missing",
            "task-old-open",
            "task-closed",
        ])
        expect(taskList[0]).toMatchObject({
            id: "task-action",
            lastEvent: {
                type: "action",
                status: "completed",
                sourceType: "do",
                sourceLabel: "Do",
            },
        })
    })

    it("keeps project-list reads on the lightweight repos document path", async () => {
        const rawUpdateReads: string[] = []
        const mapReads: string[] = []
        const arrayReads: string[] = []
        const projection = createOpenADEYjsProjection({
            ...storage,
            readDocumentUpdate: async (id) => {
                rawUpdateReads.push(id)
                return storage.readDocumentUpdate(id)
            },
            readMapObject: async (documentId, mapName) => {
                mapReads.push(`${documentId}:${mapName}`)
                return storage.readMapObject(documentId, mapName)
            },
            readOrderedArray: async <T extends Record<string, unknown>>(documentId: string, name: string): Promise<T[] | null> => {
                arrayReads.push(`${documentId}:${name}`)
                return storage.readOrderedArray<T>(documentId, name)
            },
        })

        const projects = await projection.readProjects({ workingTaskIds: ["task-action"] })

        expect(projects.map((project) => project.id)).toEqual(["repo-fixture"])
        expect(projects[0].tasks.map((task) => task.id)).toEqual([
            "task-action",
            "task-mismatch",
            "task-missing",
            "task-old-open",
            "task-closed",
        ])
        expect(rawUpdateReads).toEqual(["code:repos"])
        expect(arrayReads).toEqual([])
        expect(mapReads).toEqual([])
    })

    it("projects task detail while preserving missing and mismatched task behavior", async () => {
        const projection = createOpenADEYjsProjection(storage)

        const task = await projection.readTask("repo-fixture", "task-action")
        const missing = await projection.readTask("repo-fixture", "task-missing")

        await expect(projection.readTask("repo-fixture", "task-mismatch")).rejects.toThrow(
            "Task document task-mismatch has mismatched metadata id wrong-task-id"
        )

        expect(task).toMatchObject({
            id: "task-action",
            repoId: "repo-fixture",
            slug: "action-task",
            title: "Action task",
            description: "Legacy fixture action task.",
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            enabledMcpServerIds: ["mcp-a"],
            sessionIds: { codex: "session-a" },
            cancelledPlanEventId: "event-plan-cancelled",
            queuedTurns: [
                {
                    id: "queued-a",
                    type: "do",
                    input: "Queued work",
                    status: "queued",
                    createdAt: "2026-05-02T02:00:00.000Z",
                    updatedAt: "2026-05-02T02:00:00.000Z",
                },
            ],
            deviceEnvironments: [
                {
                    id: "env-a",
                    deviceId: "device-a",
                    worktreeDir: "/tmp/openade-fixture-repo/.worktrees/action-task",
                    setupComplete: true,
                    mergeBaseCommit: "abc123",
                },
            ],
            comments: [
                {
                    id: "comment-a",
                    content: "Comment content",
                    source: { type: "llm_output", eventId: "event-action", lineStart: 1, lineEnd: 1 },
                    selectedText: { text: "selected", linesBefore: "", linesAfter: "" },
                    author: { id: "user-fixture", email: "fixture@example.com" },
                },
            ],
        })
        expect(task.events.map(eventId)).toEqual(["event-setup", "event-action", "event-snapshot"])
        expect(missing).toMatchObject({
            id: "task-missing",
            repoId: "repo-fixture",
            slug: "missing-task",
            title: "Missing task doc",
            description: "",
            isolationStrategy: { type: "head" },
            unavailableReason: "Task data is unavailable on the desktop host.",
            events: [],
            comments: [],
            deviceEnvironments: [],
        })
    })

    it("loads a task document once when the storage adapter exposes raw document updates", async () => {
        const rawUpdateReads: string[] = []
        const mapReads: string[] = []
        const arrayReads: string[] = []
        const projection = createOpenADEYjsProjection({
            ...storage,
            readDocumentUpdate: async (id) => {
                rawUpdateReads.push(id)
                return storage.readDocumentUpdate(id)
            },
            readMapObject: async (documentId, mapName) => {
                mapReads.push(`${documentId}:${mapName}`)
                return storage.readMapObject(documentId, mapName)
            },
            readOrderedArray: async <T extends Record<string, unknown>>(documentId: string, name: string): Promise<T[] | null> => {
                arrayReads.push(`${documentId}:${name}`)
                return storage.readOrderedArray<T>(documentId, name)
            },
        })

        await expect(projection.readTask("repo-fixture", "task-action", { hydrateSessionEvents: false })).resolves.toMatchObject({
            id: "task-action",
        })

        expect(rawUpdateReads).toEqual(["code:task:task-action"])
        expect(mapReads).toEqual([])
        expect(arrayReads).toEqual([])
        expect(rawUpdateReads.filter((id) => id === "code:task:task-action")).toHaveLength(1)
        expect(mapReads.filter((read) => read.startsWith("code:task:task-action:"))).toHaveLength(0)
        expect(arrayReads.filter((read) => read.startsWith("code:task:task-action:"))).toHaveLength(0)
    })

    it("reuses fresh projected task documents without repeated raw reads", async () => {
        const rawUpdateReads: string[] = []
        const projection = createOpenADEYjsProjection({
            ...storage,
            readDocumentUpdate: async (id) => {
                rawUpdateReads.push(id)
                const data = await storage.readDocumentUpdate(id)
                return data ? new Uint8Array(data) : data
            },
        })

        const first = await projection.readTask("repo-fixture", "task-action", { hydrateSessionEvents: true })
        const second = await projection.readTask("repo-fixture", "task-action", { hydrateSessionEvents: true })

        expect(rawUpdateReads).toEqual(["code:task:task-action"])
        expect(second.events).toBe(first.events)
        expect(second.comments).toBe(first.comments)
        expect(second.deviceEnvironments).toBe(first.deviceEnvironments)

        projection.invalidateCache()
        await projection.readTask("repo-fixture", "task-action", { hydrateSessionEvents: true })
        expect(rawUpdateReads).toEqual(["code:task:task-action", "code:task:task-action"])
    })

    it("scopes projected document cache invalidation to changed documents", async () => {
        const rawUpdateReads: string[] = []
        const projection = createOpenADEYjsProjection({
            ...storage,
            readDocumentUpdate: async (id) => {
                rawUpdateReads.push(id)
                const data = await storage.readDocumentUpdate(id)
                return data ? new Uint8Array(data) : data
            },
        })

        await projection.readPersonalSettings()
        await projection.readProjects()
        await projection.readTask("repo-fixture", "task-action", { hydrateSessionEvents: true })
        rawUpdateReads.length = 0

        projection.invalidateCache({ documentIds: ["code:task:task-action"] })
        await projection.readPersonalSettings()
        await projection.readProjects()
        await projection.readTask("repo-fixture", "task-action", { hydrateSessionEvents: true })
        expect(rawUpdateReads).toEqual(["code:task:task-action"])

        rawUpdateReads.length = 0
        projection.invalidateCache()
        await projection.readPersonalSettings()
        await projection.readProjects()
        expect(rawUpdateReads).toEqual(["code:personal_settings", "code:repos"])
    })

    it("keeps projected task documents through a broad task-open burst", async () => {
        for (let index = 0; index < 80; index++) {
            await installTinyTaskFixture(`task-cache-burst-${index}`)
        }
        const projection = createOpenADEYjsProjection({
            ...storage,
            readDocumentUpdate: async (id) => {
                const data = await storage.readDocumentUpdate(id)
                return data ? new Uint8Array(data) : data
            },
        })

        const first = await projection.readTask("repo-fixture", "task-action", { hydrateSessionEvents: true })
        for (let index = 0; index < 80; index++) {
            await projection.readTask("repo-fixture", `task-cache-burst-${index}`, { hydrateSessionEvents: true })
        }
        const second = await projection.readTask("repo-fixture", "task-action", { hydrateSessionEvents: true })

        expect(second.events).toBe(first.events)
        expect(second.comments).toBe(first.comments)
        expect(second.deviceEnvironments).toBe(first.deviceEnvironments)
    })

    it("projects repo and settings documents from raw updates without collection fallback reads", async () => {
        const rawUpdateReads: string[] = []
        const mapReads: string[] = []
        const arrayReads: string[] = []
        const projection = createOpenADEYjsProjection({
            ...storage,
            readDocumentUpdate: async (id) => {
                rawUpdateReads.push(id)
                const data = await storage.readDocumentUpdate(id)
                return data ? new Uint8Array(data) : data
            },
            readMapObject: async (documentId, mapName) => {
                mapReads.push(`${documentId}:${mapName}`)
                return storage.readMapObject(documentId, mapName)
            },
            readOrderedArray: async <T extends Record<string, unknown>>(documentId: string, name: string): Promise<T[] | null> => {
                arrayReads.push(`${documentId}:${name}`)
                return storage.readOrderedArray<T>(documentId, name)
            },
        })

        await projection.readSnapshot({ version: "fixture-version" })
        await projection.readProjects()
        await projection.readTaskList("repo-fixture")

        expect(rawUpdateReads).toContain("code:personal_settings")
        expect(rawUpdateReads).toContain("code:repos")
        expect(rawUpdateReads.filter((id) => id === "code:personal_settings")).toHaveLength(1)
        expect(rawUpdateReads.filter((id) => id === "code:repos")).toHaveLength(1)
        expect(mapReads.filter((read) => read.startsWith("code:personal_settings:"))).toHaveLength(0)
        expect(arrayReads.filter((read) => read.startsWith("code:repos:"))).toHaveLength(0)
    })

    it("bounds stored session arrays on lightweight task reads and restores them when explicitly hydrated", async () => {
        await installLargeSessionTaskFixture()
        const projection = createOpenADEYjsProjection(storage)

        const lightweightTask = await projection.readTask("repo-fixture", "task-large-session", { hydrateSessionEvents: false })
        const limitedTask = await projection.readTask("repo-fixture", "task-large-session", { hydrateSessionEvents: false, eventLimit: 12 })
        const hydratedTask = await projection.readTask("repo-fixture", "task-large-session", { hydrateSessionEvents: true })

        const olderAction = record(lightweightTask.events[0])
        const olderExecution = record(olderAction?.execution)
        expect(Array.isArray(olderExecution?.events) ? olderExecution.events : []).toHaveLength(0)
        expect(olderExecution?.omittedEventCount).toBe(1)

        const middleAction = record(lightweightTask.events[40])
        const middleExecution = record(middleAction?.execution)
        expect(Array.isArray(middleExecution?.events) ? middleExecution.events : []).toHaveLength(0)
        expect(middleExecution?.omittedEventCount).toBe(1)

        const latestAction = record(lightweightTask.events[81])
        const latestExecution = record(latestAction?.execution)
        expect(Array.isArray(latestExecution?.events) ? latestExecution.events : []).toHaveLength(120)
        expect(latestExecution?.omittedEventCount).toBe(245)

        expect(limitedTask.events).toHaveLength(12)
        expect(limitedTask.events.map(eventId)).toEqual(Array.from({ length: 12 }, (_, index) => `event-${index + 70}`))

        const hydratedLatestAction = record(hydratedTask.events[81])
        const hydratedLatestExecution = record(hydratedLatestAction?.execution)
        expect(Array.isArray(hydratedLatestExecution?.events) ? hydratedLatestExecution.events : []).toHaveLength(365)
        expect(hydratedLatestExecution?.omittedEventCount).toBeUndefined()
    })

    it("normalizes sparse legacy task metadata into a valid task DTO", async () => {
        await installSparseLegacyTaskFixture()
        const projection = createOpenADEYjsProjection(storage)

        const task = await projection.readTask("repo-fixture", "task-sparse")

        expect(task).toMatchObject({
            id: "task-sparse",
            repoId: "repo-fixture",
            slug: "sparse-task",
            title: "Sparse meta title",
            description: "",
            isolationStrategy: { type: "worktree", sourceBranch: "HEAD" },
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
            deviceEnvironments: [],
            events: [],
            comments: [],
        })
        expect(task.queuedTurns).toBeUndefined()
    })
})
