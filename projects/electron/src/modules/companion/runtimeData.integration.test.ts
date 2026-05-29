import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as Y from "yjs"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createOpenADEYjsWriter } from "../../../../openade-module/src"
import { type RuntimeMessage } from "../../../../runtime-protocol/src"
import { saveYjsDocument } from "../code/yjsStorage"
import { getRuntimeServer, resetRuntimeServer } from "./runtimeGateway"
import { createOpenADEYjsStorageAdapter } from "./runtimeYjsAdapter"

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

let storageDir = ""

function toY(value: JsonValue): JsonValue | Y.Map<unknown> | Y.Array<unknown> {
    if (Array.isArray(value)) {
        const yArray = new Y.Array<unknown>()
        yArray.push(value.map(toY))
        return yArray
    }

    if (value && typeof value === "object") {
        const yMap = new Y.Map<unknown>()
        for (const [key, nested] of Object.entries(value)) {
            yMap.set(key, toY(nested))
        }
        return yMap
    }

    return value
}

function setObject(yMap: Y.Map<unknown>, value: Record<string, JsonValue>): void {
    for (const [key, nested] of Object.entries(value)) {
        yMap.set(key, toY(nested))
    }
}

function pushOrdered(doc: Y.Doc, name: string, rows: Array<Record<string, JsonValue> & { id: string }>): void {
    const dataMap = doc.getMap<Y.Map<unknown>>(`${name}:data`)
    const orderArray = doc.getArray<string>(`${name}:order`)
    for (const row of rows) {
        dataMap.set(row.id, toY(row) as Y.Map<unknown>)
        orderArray.push([row.id])
    }
}

async function saveDoc(id: string, build: (doc: Y.Doc) => void): Promise<void> {
    const doc = new Y.Doc()
    try {
        build(doc)
        await saveYjsDocument(id, Y.encodeStateAsUpdate(doc))
    } finally {
        doc.destroy()
    }
}

function connection() {
    const messages: RuntimeMessage[] = []
    return {
        messages,
        connection: {
            id: "trusted-runtime-data-test",
            send(message: RuntimeMessage) {
                messages.push(message)
            },
        },
    }
}

describe("OpenADE runtime data integration", () => {
    beforeEach(async () => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-runtime-data-"))
        process.env.OPENADE_YJS_STORAGE_DIR = storageDir
        process.env.OPENADE_RUNTIME_CHECKPOINT_FILE = path.join(storageDir, "runtime-checkpoints.json")
        resetRuntimeServer()

        await saveDoc("code:personal_settings", (doc) => {
            setObject(doc.getMap("personal_settings"), {
                envVars: {},
                theme: "code-theme-black",
                pinnedTaskIds: ["task-2"],
            })
        })
        await saveDoc("code:repos", (doc) => {
            pushOrdered(doc, "repos", [
                {
                    id: "repo-1",
                    name: "Runtime Repo",
                    path: "/tmp/runtime-repo",
                    archived: false,
                    createdAt: "2026-05-26T00:00:00.000Z",
                    updatedAt: "2026-05-26T00:00:00.000Z",
                    createdBy: { id: "user-1", email: "user@example.com" },
                    tasks: [
                        {
                            id: "task-1",
                            slug: "task-one",
                            title: "Older open task",
                            closed: false,
                            createdAt: "2026-05-26T00:00:00.000Z",
                            lastEvent: {
                                type: "action",
                                status: "completed",
                                sourceType: "do",
                                sourceLabel: "Do",
                                at: "2026-05-26T01:00:00.000Z",
                            },
                        },
                        {
                            id: "task-2",
                            slug: "task-two",
                            title: "Pinned running task",
                            closed: false,
                            createdAt: "2026-05-26T00:00:00.000Z",
                            lastEvent: {
                                type: "action",
                                status: "in_progress",
                                sourceType: "plan",
                                sourceLabel: "Plan",
                                at: "2026-05-26T00:30:00.000Z",
                            },
                        },
                    ],
                },
            ])
        })
        await saveDoc("code:task:task-2", (doc) => {
            setObject(doc.getMap("task:meta"), {
                id: "task-2",
                repoId: "repo-1",
                slug: "task-two",
                title: "Pinned running task",
                description: "A task persisted as Yjs.",
                isolationStrategy: { type: "head" },
                sessionIds: {},
                createdBy: { id: "user-1", email: "user@example.com" },
                createdAt: "2026-05-26T00:00:00.000Z",
                updatedAt: "2026-05-26T00:30:00.000Z",
            })
            pushOrdered(doc, "task:events", [
                {
                    id: "event-1",
                    type: "action",
                    status: "in_progress",
                    createdAt: "2026-05-26T00:30:00.000Z",
                    source: { type: "plan", userLabel: "Plan" },
                    content: "Test event",
                },
            ])
            pushOrdered(doc, "task:comments", [
                {
                    id: "comment-1",
                    body: "A real persisted comment.",
                    createdAt: "2026-05-26T00:40:00.000Z",
                    createdBy: { id: "user-1", email: "user@example.com" },
                },
            ])
        })
    })

    afterEach(() => {
        resetRuntimeServer()
        delete process.env.OPENADE_YJS_STORAGE_DIR
        delete process.env.OPENADE_RUNTIME_CHECKPOINT_FILE
        fs.rmSync(storageDir, { recursive: true, force: true })
    })

    it("serves project and task reads from Yjs storage through the runtime protocol", async () => {
        const runtime = getRuntimeServer()
        runtime.supervisor.create({
            runtimeId: "openade-task:task-2",
            kind: "agent",
            status: "running",
            scope: {
                ownerType: "openade-task",
                ownerId: "task-2",
            },
        })
        const testConnection = connection()

        const snapshot = await runtime.handleRequest({ id: 1, method: "openade/snapshot/read" }, testConnection.connection)
        expect(snapshot.error).toBeUndefined()
        expect(snapshot.result).toMatchObject({
            server: {
                theme: {
                    setting: "code-theme-black",
                    className: "code-theme-black",
                    label: "Black",
                },
            },
            workingTaskIds: ["task-2"],
            repos: [
                {
                    id: "repo-1",
                    tasks: [
                        { id: "task-2", title: "Pinned running task" },
                        { id: "task-1", title: "Older open task" },
                    ],
                },
            ],
        })

        const task = await runtime.handleRequest(
            { id: 2, method: "openade/task/read", params: { repoId: "repo-1", taskId: "task-2" } },
            testConnection.connection
        )
        expect(task.error).toBeUndefined()
        expect(task.result).toMatchObject({
            id: "task-2",
            repoId: "repo-1",
            title: "Pinned running task",
            description: "A task persisted as Yjs.",
            events: [{ id: "event-1", content: "Test event" }],
            comments: [{ id: "comment-1", body: "A real persisted comment." }],
        })
    })

    it("keeps raw Yjs backup reads trusted-runtime only", async () => {
        const runtime = getRuntimeServer()
        const remoteConnection = {
            id: "remote-phone",
            permissions: ["initialize", "openade/*"],
            send(_message: RuntimeMessage) {},
        }
        const trustedConnection = connection().connection

        const denied = await runtime.handleRequest({ id: 1, method: "data/yjs/list" }, remoteConnection)
        const allowed = await runtime.handleRequest({ id: 2, method: "data/yjs/list" }, trustedConnection)
        const raw = await runtime.handleRequest({ id: 3, method: "data/yjs/read", params: { id: "code:repos" } }, trustedConnection)

        expect(denied.error?.code).toBe("permission_denied")
        expect(allowed.result).toEqual(expect.arrayContaining(["code:repos", "code:personal_settings"]))
        expect(raw.error).toBeUndefined()
        expect(raw.result).toMatchObject({ id: "code:repos", data: expect.any(String) })
    })

    it("keeps raw Yjs backup writes trusted-runtime only", async () => {
        const runtime = getRuntimeServer()
        const remoteConnection = {
            id: "remote-phone",
            permissions: ["initialize", "openade/*"],
            send(_message: RuntimeMessage) {},
        }
        const trustedConnection = connection().connection
        const doc = new Y.Doc()
        doc.getMap("example").set("value", "saved-through-runtime")
        const data = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64")
        doc.destroy()

        const deniedSave = await runtime.handleRequest({ id: 1, method: "data/yjs/save", params: { id: "code:test", data } }, remoteConnection)
        const saved = await runtime.handleRequest({ id: 2, method: "data/yjs/save", params: { id: "code:test", data } }, trustedConnection)
        const raw = await runtime.handleRequest({ id: 3, method: "data/yjs/read", params: { id: "code:test" } }, trustedConnection)
        const deniedDelete = await runtime.handleRequest({ id: 4, method: "data/yjs/delete", params: { id: "code:test" } }, remoteConnection)
        const deleted = await runtime.handleRequest({ id: 5, method: "data/yjs/delete", params: { id: "code:test" } }, trustedConnection)
        const missing = await runtime.handleRequest({ id: 6, method: "data/yjs/read", params: { id: "code:test" } }, trustedConnection)

        expect(deniedSave.error?.code).toBe("permission_denied")
        expect(saved.error).toBeUndefined()
        expect(raw.result).toMatchObject({ id: "code:test", data: expect.any(String) })
        expect(deniedDelete.error?.code).toBe("permission_denied")
        expect(deleted.error).toBeUndefined()
        expect(missing.result).toBeNull()
    })

    it("keeps blob and snapshot storage trusted-runtime only", async () => {
        const runtime = getRuntimeServer()
        const remoteConnection = {
            id: "remote-phone",
            permissions: ["initialize", "openade/*"],
            send(_message: RuntimeMessage) {},
        }
        const trustedConnection = connection().connection
        const data = Buffer.from("runtime blob").toString("base64")

        const deniedBlob = await runtime.handleRequest(
            { id: 1, method: "data/file/save", params: { folder: "cron", id: "repo-1", ext: "json", data } },
            remoteConnection
        )
        const savedBlob = await runtime.handleRequest(
            { id: 2, method: "data/file/save", params: { folder: "cron", id: "repo-1", ext: "json", data } },
            trustedConnection
        )
        const loadedBlob = await runtime.handleRequest(
            { id: 3, method: "data/file/load", params: { folder: "cron", id: "repo-1", ext: "json" } },
            trustedConnection
        )
        const deniedSnapshot = await runtime.handleRequest(
            {
                id: 4,
                method: "snapshot/bundle/save",
                params: {
                    id: "snapshot-1",
                    patch: "diff --git a/file.txt b/file.txt\n+hello\n",
                    index: { version: 1, patchSize: 40, files: [] },
                },
            },
            remoteConnection
        )
        const savedSnapshot = await runtime.handleRequest(
            {
                id: 5,
                method: "snapshot/bundle/save",
                params: {
                    id: "snapshot-1",
                    patch: "diff --git a/file.txt b/file.txt\n+hello\n",
                    index: { version: 1, patchSize: 40, files: [] },
                },
            },
            trustedConnection
        )
        const loadedPatch = await runtime.handleRequest({ id: 6, method: "snapshot/patch/read", params: { id: "snapshot-1" } }, trustedConnection)
        const loadedIndex = await runtime.handleRequest({ id: 7, method: "snapshot/index/read", params: { id: "snapshot-1" } }, trustedConnection)
        const deletedSnapshot = await runtime.handleRequest({ id: 8, method: "snapshot/bundle/delete", params: { id: "snapshot-1" } }, trustedConnection)

        expect(deniedBlob.error?.code).toBe("permission_denied")
        expect(savedBlob.error).toBeUndefined()
        expect(Buffer.from((loadedBlob.result as { data: string }).data, "base64").toString("utf8")).toBe("runtime blob")
        expect(deniedSnapshot.error?.code).toBe("permission_denied")
        expect(savedSnapshot.error).toBeUndefined()
        expect(loadedPatch.result).toContain("+hello")
        expect(loadedIndex.result).toMatchObject({ version: 1, files: [] })
        expect(deletedSnapshot.error).toBeUndefined()
    })

    it("keeps host capability probes trusted-runtime only", async () => {
        const runtime = getRuntimeServer()
        const remoteConnection = {
            id: "remote-phone",
            permissions: ["initialize", "openade/*"],
            send(_message: RuntimeMessage) {},
        }
        const trustedConnection = connection().connection

        const denied = await runtime.handleRequest({ id: 1, method: "host/capabilities/read" }, remoteConnection)
        const allowed = await runtime.handleRequest({ id: 2, method: "host/capabilities/read" }, trustedConnection)

        expect(denied.error?.code).toBe("permission_denied")
        expect(allowed.result).toMatchObject({ enabled: true, version: expect.any(String) })
    })

    it("keeps host utility methods trusted-runtime only", async () => {
        const runtime = getRuntimeServer()
        const remoteConnection = {
            id: "remote-phone",
            permissions: ["initialize", "openade/*"],
            send(_message: RuntimeMessage) {},
        }
        const trustedConnection = connection().connection
        const repoDir = path.join(storageDir, "repo")
        const configPath = path.join(repoDir, "openade.toml")
        fs.mkdirSync(repoDir, { recursive: true })
        fs.writeFileSync(
            configPath,
            [
                "[[process]]",
                'name = "Dev"',
                'type = "daemon"',
                'command = "npm run dev"',
                "",
            ].join("\n")
        )

        const deniedPlatform = await runtime.handleRequest({ id: 1, method: "host/platform/info" }, remoteConnection)
        const platform = await runtime.handleRequest({ id: 2, method: "host/platform/info" }, trustedConnection)
        const deniedProcs = await runtime.handleRequest({ id: 3, method: "host/procs/read", params: { path: repoDir } }, remoteConnection)
        const procs = await runtime.handleRequest({ id: 4, method: "host/procs/read", params: { path: repoDir } }, trustedConnection)
        const raw = await runtime.handleRequest({ id: 5, method: "host/procs/file/read", params: { filePath: configPath } }, trustedConnection)
        const serialized = await runtime.handleRequest(
            {
                id: 6,
                method: "host/procs/editable/serialize",
                params: {
                    processes: [{ name: "Check", command: "npm run typecheck", type: "check" }],
                    crons: [],
                },
            },
            trustedConnection
        )
        const envBefore = process.env.OPENADE_RUNTIME_DATA_TEST_ENV
        const setEnv = await runtime.handleRequest(
            { id: 7, method: "host/subprocess/setGlobalEnv", params: { env: { OPENADE_RUNTIME_DATA_TEST_ENV: "runtime" } } },
            trustedConnection
        )
        const checkedBinary = await runtime.handleRequest(
            { id: 8, method: "host/system/checkBinary", params: { binary: "definitely-missing-openade-runtime-test" } },
            trustedConnection
        )
        const createDirPath = path.join(storageDir, "created", "nested")
        const deniedCreateDir = await runtime.handleRequest(
            { id: 9, method: "host/shell/createDirectory", params: { path: createDirPath } },
            remoteConnection
        )
        const createdDir = await runtime.handleRequest(
            { id: 10, method: "host/shell/createDirectory", params: { path: createDirPath } },
            trustedConnection
        )
        const deniedMcp = await runtime.handleRequest(
            { id: 11, method: "host/mcp/testConnection", params: { config: { type: "stdio", command: "echo" } } },
            remoteConnection
        )
        const mcp = await runtime.handleRequest(
            { id: 12, method: "host/mcp/testConnection", params: { config: { type: "stdio", command: "echo" } } },
            trustedConnection
        )

        expect(deniedPlatform.error?.code).toBe("permission_denied")
        expect(platform.result).toMatchObject({ platform: process.platform, homeDir: expect.any(String) })
        expect(deniedProcs.error?.code).toBe("permission_denied")
        expect(procs.result).toMatchObject({
            repoRoot: repoDir,
            configs: [expect.objectContaining({ relativePath: "openade.toml" })],
        })
        expect(raw.result).toContain("npm run dev")
        expect(serialized.result).toMatchObject({ rawContent: expect.stringContaining("npm run typecheck") })
        expect(setEnv.result).toEqual({ success: true })
        expect(process.env.OPENADE_RUNTIME_DATA_TEST_ENV).toBe("runtime")
        expect(checkedBinary.result).toMatchObject({ installed: false })
        expect(deniedCreateDir.error?.code).toBe("permission_denied")
        expect(createdDir.result).toMatchObject({ success: true })
        expect(fs.existsSync(createDirPath)).toBe(true)
        expect(deniedMcp.error?.code).toBe("permission_denied")
        expect(mcp.result).toMatchObject({ success: true, error: "Stdio servers are validated at runtime" })

        const restoredEnv = await runtime.handleRequest({ id: 13, method: "host/subprocess/setGlobalEnv", params: { env: {} } }, trustedConnection)
        expect(restoredEnv.result).toEqual({ success: true })

        expect(process.env.OPENADE_RUNTIME_DATA_TEST_ENV).toBe(envBefore)
    })

    it("mutates repos and deletes tasks through OpenADE runtime methods", async () => {
        const runtime = getRuntimeServer()
        const testConnection = connection()
        runtime.connect(testConnection.connection)

        const created = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/repo/create",
                params: {
                    repoId: "repo-runtime-created",
                    name: "Runtime Created Repo",
                    path: "/tmp/runtime-created",
                    createdBy: { id: "user-1", email: "user@example.com" },
                },
            },
            testConnection.connection
        )
        expect(created.error).toBeUndefined()
        expect(created.result).toMatchObject({ repoId: "repo-runtime-created" })

        const updated = await runtime.handleRequest(
            {
                id: 2,
                method: "openade/repo/update",
                params: { repoId: "repo-runtime-created", name: "Runtime Updated Repo", archived: true },
            },
            testConnection.connection
        )
        expect(updated.error).toBeUndefined()

        const deletedTask = await runtime.handleRequest(
            {
                id: 3,
                method: "openade/task/delete",
                params: { repoId: "repo-1", taskId: "task-2", options: { deleteSnapshots: true, deleteImages: true, deleteSessions: true } },
            },
            testConnection.connection
        )
        expect(deletedTask.error).toBeUndefined()
        expect(deletedTask.result).toMatchObject({ repoId: "repo-1", taskId: "task-2", deleted: true })

        const snapshot = await runtime.handleRequest({ id: 4, method: "openade/snapshot/read" }, testConnection.connection)
        expect(snapshot.error).toBeUndefined()
        const repos = (snapshot.result as { repos: Array<{ id: string; name: string; archived?: boolean; tasks: Array<{ id: string }> }> }).repos
        expect(repos).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: "repo-runtime-created", name: "Runtime Updated Repo", archived: true })])
        )
        expect(repos.find((repo) => repo.id === "repo-1")?.tasks.map((task) => task.id)).not.toContain("task-2")

        const missingTask = await runtime.handleRequest(
            { id: 5, method: "openade/task/read", params: { repoId: "repo-1", taskId: "task-2" } },
            testConnection.connection
        )
        expect(missingTask.error?.message).toContain("Task task-2 not found")

        const deletedRepo = await runtime.handleRequest(
            { id: 6, method: "openade/repo/delete", params: { repoId: "repo-runtime-created" } },
            testConnection.connection
        )
        expect(deletedRepo.error).toBeUndefined()

        const finalSnapshot = await runtime.handleRequest({ id: 7, method: "openade/snapshot/read" }, testConnection.connection)
        const finalRepos = (finalSnapshot.result as { repos: Array<{ id: string }> }).repos
        expect(finalRepos.map((repo) => repo.id)).not.toContain("repo-runtime-created")
    })

    it("creates head-mode task documents through the OpenADE Yjs writer", async () => {
        const storage = createOpenADEYjsStorageAdapter()
        const writer = createOpenADEYjsWriter(storage, {
            createId: () => "task-created",
            createSlug: () => "task-created-slug",
            now: () => "2026-05-26T02:00:00.000Z",
        })

        await writer.createTask({
            repoId: "repo-1",
            input: "Create this task from the runtime module",
            title: "Runtime Created Task",
            createdBy: { id: "local-user", email: "local@openade.dev" },
            deviceId: "device-1",
            enabledMcpServerIds: ["mcp-1"],
        })

        const runtime = getRuntimeServer()
        const testConnection = connection()
        const snapshot = await runtime.handleRequest({ id: 1, method: "openade/snapshot/read" }, testConnection.connection)
        const task = await runtime.handleRequest(
            { id: 2, method: "openade/task/read", params: { repoId: "repo-1", taskId: "task-created" } },
            testConnection.connection
        )
        const deviceEnvironments = await storage.readOrderedArray("code:task:task-created", "task:deviceEnvironments")

        expect(snapshot.error).toBeUndefined()
        const repos = (snapshot.result as { repos: Array<{ id: string; tasks: Array<{ id: string; title: string }> }> }).repos
        expect(repos.find((repo) => repo.id === "repo-1")?.tasks).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: "task-created", title: "Runtime Created Task" })])
        )
        expect(task.error).toBeUndefined()
        expect(task.result).toMatchObject({
            id: "task-created",
            repoId: "repo-1",
            slug: "task-created-slug",
            title: "Runtime Created Task",
            description: "Create this task from the runtime module",
            events: [],
            comments: [],
        })
        expect(deviceEnvironments).toEqual([
            {
                id: "device-1",
                deviceId: "device-1",
                setupComplete: true,
                createdAt: "2026-05-26T02:00:00.000Z",
                lastUsedAt: "2026-05-26T02:00:00.000Z",
            },
        ])
    })

    it("writes action events and stream updates through the OpenADE runtime protocol", async () => {
        const runtime = getRuntimeServer()
        const testConnection = connection()
        runtime.connect(testConnection.connection)

        const created = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/action/create",
                params: {
                    taskId: "task-2",
                    eventId: "event-created",
                    createdAt: "2026-05-26T02:10:00.000Z",
                    userInput: "Run this from the runtime module",
                    executionId: "execution-1",
                    harnessId: "codex",
                    modelId: "gpt-5-codex",
                    fastMode: true,
                    source: { type: "do", userLabel: "Do" },
                    includesCommentIds: ["comment-1"],
                    gitRefsBefore: { sha: "abc123", branch: "main" },
                },
            },
            testConnection.connection
        )

        await runtime.handleRequest(
            {
                id: 2,
                method: "openade/action/stream/append",
                params: {
                    taskId: "task-2",
                    eventId: "event-created",
                    streamEvent: {
                        id: "stream-1",
                        direction: "execution",
                        type: "stderr",
                        executionId: "execution-1",
                        harnessId: "codex",
                        data: "working",
                    },
                },
            },
            testConnection.connection
        )
        await runtime.handleRequest(
            {
                id: 3,
                method: "openade/action/stream/append",
                params: {
                    taskId: "task-2",
                    eventId: "event-created",
                    streamEvent: {
                        id: "stream-1",
                        direction: "execution",
                        type: "stderr",
                        executionId: "execution-1",
                        harnessId: "codex",
                        data: "working",
                    },
                },
            },
            testConnection.connection
        )
        await runtime.handleRequest(
            {
                id: 4,
                method: "openade/action/execution/update",
                params: {
                    taskId: "task-2",
                    eventId: "event-created",
                    sessionId: "session-1",
                    parentSessionId: "session-parent",
                    gitRefsAfter: { sha: "def456", branch: "main" },
                },
            },
            testConnection.connection
        )
        await runtime.handleRequest(
            {
                id: 5,
                method: "openade/action/complete",
                params: {
                    taskId: "task-2",
                    eventId: "event-created",
                    success: true,
                    completedAt: "2026-05-26T02:15:00.000Z",
                },
            },
            testConnection.connection
        )
        const snapshotCreated = await runtime.handleRequest(
            {
                id: 6,
                method: "openade/snapshot/create",
                params: {
                    taskId: "task-2",
                    eventId: "snapshot-created",
                    createdAt: "2026-05-26T02:16:00.000Z",
                    actionEventId: "event-created",
                    referenceBranch: "uncommitted",
                    mergeBaseCommit: "HEAD",
                    fullPatch: "diff --git a/file.txt b/file.txt",
                    stats: { filesChanged: 1, insertions: 2, deletions: 0 },
                    files: [{ path: "file.txt", status: "modified" }],
                },
            },
            testConnection.connection
        )
        const commentCreated = await runtime.handleRequest(
            {
                id: 7,
                method: "openade/comment/create",
                params: {
                    taskId: "task-2",
                    commentId: "comment-runtime",
                    createdAt: "2026-05-26T02:17:00.000Z",
                    content: "Please consider this note.",
                    source: { type: "llm_output", eventId: "event-created", lineStart: 1, lineEnd: 2 },
                    selectedText: { text: "selected", linesBefore: "before", linesAfter: "after" },
                    author: { id: "user-2", email: "runtime@example.com" },
                },
            },
            testConnection.connection
        )
        await runtime.handleRequest(
            {
                id: 8,
                method: "openade/comment/edit",
                params: {
                    taskId: "task-2",
                    commentId: "comment-runtime",
                    content: "Please consider this updated note.",
                    updatedAt: "2026-05-26T02:18:00.000Z",
                },
            },
            testConnection.connection
        )
        await runtime.handleRequest(
            {
                id: 9,
                method: "openade/comment/create",
                params: {
                    taskId: "task-2",
                    commentId: "comment-delete",
                    createdAt: "2026-05-26T02:19:00.000Z",
                    content: "Delete me.",
                    source: { type: "llm_output", eventId: "event-created", lineStart: 1, lineEnd: 1 },
                    selectedText: { text: "", linesBefore: "", linesAfter: "" },
                    author: { id: "user-2", email: "runtime@example.com" },
                },
            },
            testConnection.connection
        )
        await runtime.handleRequest(
            {
                id: 10,
                method: "openade/comment/delete",
                params: {
                    taskId: "task-2",
                    commentId: "comment-delete",
                    updatedAt: "2026-05-26T02:20:00.000Z",
                },
            },
            testConnection.connection
        )
        await runtime.handleRequest(
            {
                id: 11,
                method: "openade/task/metadata/update",
                params: {
                    taskId: "task-2",
                    title: "Runtime Updated Task",
                    closed: true,
                    lastViewedAt: "2026-05-26T02:21:00.000Z",
                    cancelledPlanEventId: "event-created",
                    usage: {
                        usageVersion: 1,
                        inputTokens: 10,
                        outputTokens: 20,
                        totalCostUsd: 0.03,
                        eventCount: 1,
                        costByModel: { "gpt-5-codex": 0.03 },
                        durationMs: 5000,
                    },
                    enabledMcpServerIds: ["mcp-runtime"],
                    sessionIds: { codex: "session-1" },
                    updatedAt: "2026-05-26T02:21:00.000Z",
                },
            },
            testConnection.connection
        )

        const task = await runtime.handleRequest(
            { id: 12, method: "openade/task/read", params: { repoId: "repo-1", taskId: "task-2" } },
            testConnection.connection
        )
        const snapshot = await runtime.handleRequest({ id: 13, method: "openade/snapshot/read" }, testConnection.connection)
        const meta = await createOpenADEYjsStorageAdapter().readMapObject("code:task:task-2", "task:meta")

        expect(created.error).toBeUndefined()
        expect(created.result).toEqual({ eventId: "event-created", createdAt: "2026-05-26T02:10:00.000Z" })
        expect(snapshotCreated.error).toBeUndefined()
        expect(snapshotCreated.result).toEqual({ eventId: "snapshot-created", createdAt: "2026-05-26T02:16:00.000Z" })
        expect(commentCreated.error).toBeUndefined()
        expect(commentCreated.result).toEqual({ commentId: "comment-runtime", createdAt: "2026-05-26T02:17:00.000Z" })
        expect(task.error).toBeUndefined()
        expect(task.result).toMatchObject({
            id: "task-2",
            title: "Runtime Updated Task",
            closed: true,
            cancelledPlanEventId: "event-created",
        })
        expect(meta).toMatchObject({
            cancelledPlanEventId: "event-created",
            enabledMcpServerIds: ["mcp-runtime"],
            sessionIds: { codex: "session-1" },
        })
        const event = (task.result as { events: Array<Record<string, unknown>> }).events.find((item) => item.id === "event-created")
        const snapshotEvent = (task.result as { events: Array<Record<string, unknown>> }).events.find((item) => item.id === "snapshot-created")
        const comments = (task.result as { comments: Array<Record<string, unknown>> }).comments
        expect(event).toMatchObject({
            id: "event-created",
            type: "action",
            status: "completed",
            createdAt: "2026-05-26T02:10:00.000Z",
            completedAt: "2026-05-26T02:15:00.000Z",
            userInput: "Run this from the runtime module",
            source: { type: "do", userLabel: "Do" },
            includesCommentIds: ["comment-1"],
            result: { success: true },
            execution: {
                harnessId: "codex",
                executionId: "execution-1",
                sessionId: "session-1",
                parentSessionId: "session-parent",
                modelId: "gpt-5-codex",
                fastMode: true,
                gitRefsBefore: { sha: "abc123", branch: "main" },
                gitRefsAfter: { sha: "def456", branch: "main" },
                events: [
                    {
                        id: "stream-1",
                        direction: "execution",
                        type: "stderr",
                        executionId: "execution-1",
                        harnessId: "codex",
                        data: "working",
                    },
                ],
            },
        })
        expect(snapshotEvent).toMatchObject({
            id: "snapshot-created",
            type: "snapshot",
            status: "completed",
            createdAt: "2026-05-26T02:16:00.000Z",
            completedAt: "2026-05-26T02:16:00.000Z",
            actionEventId: "event-created",
            referenceBranch: "uncommitted",
            mergeBaseCommit: "HEAD",
            fullPatch: "diff --git a/file.txt b/file.txt",
            stats: { filesChanged: 1, insertions: 2, deletions: 0 },
            files: [{ path: "file.txt", status: "modified" }],
        })
        expect(comments.find((comment) => comment.id === "comment-runtime")).toMatchObject({
            id: "comment-runtime",
            content: "Please consider this updated note.",
            updatedAt: "2026-05-26T02:18:00.000Z",
            source: { type: "llm_output", eventId: "event-created", lineStart: 1, lineEnd: 2 },
            selectedText: { text: "selected", linesBefore: "before", linesAfter: "after" },
            author: { id: "user-2", email: "runtime@example.com" },
        })
        expect(comments.find((comment) => comment.id === "comment-delete")).toBeUndefined()

        expect(snapshot.error).toBeUndefined()
        const repos = (snapshot.result as { repos: Array<{ id: string; tasks: Array<{ id: string; lastEvent?: Record<string, unknown>; lastEventAt?: string }> }> }).repos
        expect(repos.find((repo) => repo.id === "repo-1")?.tasks.find((item) => item.id === "task-2")).toMatchObject({
            id: "task-2",
            title: "Runtime Updated Task",
            closed: true,
            lastViewedAt: "2026-05-26T02:21:00.000Z",
            usage: {
                usageVersion: 1,
                inputTokens: 10,
                outputTokens: 20,
                totalCostUsd: 0.03,
                eventCount: 1,
                costByModel: { "gpt-5-codex": 0.03 },
                durationMs: 5000,
            },
            lastEventAt: "2026-05-26T02:15:00.000Z",
            lastEvent: {
                type: "action",
                status: "completed",
                sourceType: "do",
                sourceLabel: "Do",
                at: "2026-05-26T02:15:00.000Z",
            },
        })
        expect(testConnection.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    method: "openade/task/updated",
                    params: expect.objectContaining({ repoId: "repo-1", taskId: "task-2" }),
                }),
                expect.objectContaining({
                    method: "openade/task/previewChanged",
                    params: expect.objectContaining({ repoId: "repo-1", taskId: "task-2" }),
                }),
            ])
        )
    })

    it("reconciles a terminal runtime into a matching in-progress OpenADE action without guessing missing events", async () => {
        const runtime = getRuntimeServer()
        const testConnection = connection()
        runtime.connect(testConnection.connection)

        const reconciled = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/action/reconcileRuntime",
                params: {
                    taskId: "task-2",
                    eventId: "event-1",
                    status: "failed",
                    completedAt: "2026-05-26T02:20:00.000Z",
                },
            },
            testConnection.connection
        )
        const repeated = await runtime.handleRequest(
            {
                id: 2,
                method: "openade/action/reconcileRuntime",
                params: {
                    taskId: "task-2",
                    eventId: "event-1",
                    status: "failed",
                    completedAt: "2026-05-26T02:21:00.000Z",
                },
            },
            testConnection.connection
        )
        const missing = await runtime.handleRequest(
            {
                id: 3,
                method: "openade/action/reconcileRuntime",
                params: {
                    taskId: "task-2",
                    eventId: "missing-event",
                    status: "failed",
                    completedAt: "2026-05-26T02:22:00.000Z",
                },
            },
            testConnection.connection
        )
        const task = await runtime.handleRequest(
            { id: 4, method: "openade/task/read", params: { repoId: "repo-1", taskId: "task-2" } },
            testConnection.connection
        )
        const snapshot = await runtime.handleRequest({ id: 5, method: "openade/snapshot/read" }, testConnection.connection)

        expect(reconciled.error).toBeUndefined()
        expect(reconciled.result).toMatchObject({ taskId: "task-2", eventId: "event-1", status: "error", changed: true })
        expect(repeated.result).toMatchObject({ taskId: "task-2", eventId: "event-1", status: "error", changed: false, reason: "already_terminal" })
        expect(missing.result).toMatchObject({ taskId: "task-2", changed: false, reason: "event_not_found" })
        expect(task.result).toMatchObject({
            events: [expect.objectContaining({ id: "event-1", status: "error", completedAt: "2026-05-26T02:20:00.000Z" })],
        })
        const repos = (snapshot.result as { repos: Array<{ id: string; tasks: Array<{ id: string; lastEvent?: { status: string } }> }> }).repos
        expect(repos.find((repo) => repo.id === "repo-1")?.tasks.find((item) => item.id === "task-2")?.lastEvent?.status).toBe("error")
    })
})
