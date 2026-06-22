import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import * as Y from "yjs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WebSocket, type RawData } from "ws"
import type { RuntimeMessage } from "../../../../runtime-protocol/src"
import type { RemoteDeviceDropAllResult, RemoteDeviceListResult, RemoteDeviceRevokeResult } from "../../../../shared/companion/src"
import { saveYjsDocument } from "../code/yjsStorage"
import { startPairing } from "./auth"
import { createCompanionRequestHandler } from "./server"
import { attachRuntimeSocketServer, type RuntimeSocketServer } from "./runtimeSocket"
import { getRuntimeServer, resetRuntimeServer } from "./runtimeGateway"

const storeState = vi.hoisted(() => ({
    data: new Map<string, unknown>(),
}))

vi.mock("electron-store", () => ({
    default: class MockStore {
        get(key: string) {
            return storeState.data.get(key)
        }
        set(key: string, value: unknown) {
            storeState.data.set(key, value)
        }
    },
}))

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

interface TestServer {
    baseUrl: string
    server: http.Server
    runtimeSocket: RuntimeSocketServer
}

interface SocketQueue {
    messages: RuntimeMessage[]
    waiters: Array<{
        resolve(message: RuntimeMessage): void
        reject(error: Error): void
    }>
}

const socketQueues = new WeakMap<WebSocket, SocketQueue>()

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

async function seedOpenADEFixture(repoPath: string): Promise<void> {
    await saveDoc("code:personal_settings", (doc) => {
        setObject(doc.getMap("personal_settings"), {
            envVars: {},
            theme: "code-theme-black",
            pinnedTaskIds: [],
        })
    })
    await saveDoc("code:repos", (doc) => {
        pushOrdered(doc, "repos", [
            {
                id: "repo-1",
                name: "Companion Repo",
                path: repoPath,
                archived: false,
                createdAt: "2026-05-31T00:00:00.000Z",
                updatedAt: "2026-05-31T00:00:00.000Z",
                createdBy: { id: "user-1", email: "user@example.com" },
                tasks: [
                    {
                        id: "task-1",
                        slug: "task-one",
                        title: "Companion Task",
                        closed: false,
                        createdAt: "2026-05-31T00:00:00.000Z",
                    },
                ],
            },
        ])
    })
    await saveDoc("code:task:task-1", (doc) => {
        setObject(doc.getMap("task:meta"), {
            id: "task-1",
            repoId: "repo-1",
            slug: "task-one",
            title: "Companion Task",
            description: "A paired device can mutate this task through product methods.",
            isolationStrategy: { type: "head" },
            sessionIds: {},
            createdBy: { id: "user-1", email: "user@example.com" },
            createdAt: "2026-05-31T00:00:00.000Z",
            updatedAt: "2026-05-31T00:00:00.000Z",
        })
        pushOrdered(doc, "task:events", [
            {
                id: "event-1",
                type: "action",
                status: "completed",
                userInput: "Prompt with image",
                source: { type: "do", userLabel: "Do" },
                images: [{ id: "phone-image", ext: "png", mediaType: "image/png", originalWidth: 1, originalHeight: 1, resizedWidth: 1, resizedHeight: 1 }],
                createdAt: "2026-05-31T00:00:30.000Z",
                completedAt: "2026-05-31T00:00:31.000Z",
            },
            {
                id: "snapshot-1",
                type: "snapshot",
                actionEventId: "event-1",
                referenceBranch: "main",
                mergeBaseCommit: "HEAD",
                patchFileId: "snapshot-1",
                fullPatch: "",
                stats: { filesChanged: 1, insertions: 1, deletions: 0 },
                createdAt: "2026-05-31T00:01:00.000Z",
            },
        ])
    })
}

function execGit(cwd: string, args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "pipe" })
}

function gitOutput(cwd: string, args: string[]): string {
    return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).trim()
}

function initializeGitRepo(repoPath: string): void {
    execGit(repoPath, ["init"])
    execGit(repoPath, ["config", "user.email", "companion@example.com"])
    execGit(repoPath, ["config", "user.name", "Companion Test"])
    execGit(repoPath, ["add", "README.md"])
    execGit(repoPath, ["commit", "-m", "Initial companion fixture"])
    execGit(repoPath, ["branch", "-M", "main"])
}

async function saveRuntimeSnapshotFixture(): Promise<void> {
    const patch = "diff --git a/README.md b/README.md\n+scoped snapshot patch\n"
    const response = await getRuntimeServer().handleRequest(
        {
            id: "snapshot-fixture",
            method: "snapshot/bundle/save",
            params: {
                id: "snapshot-1",
                patch,
                index: {
                    version: 1,
                    patchSize: patch.length,
                    files: [
                        {
                            id: "0",
                            path: "README.md",
                            status: "modified",
                            binary: false,
                            insertions: 1,
                            deletions: 0,
                            changedLines: 1,
                            hunkCount: 0,
                            patchStart: 0,
                            patchEnd: patch.length,
                        },
                    ],
                },
            },
        },
        { id: "trusted-snapshot-fixture", send() {} }
    )
    expect(response.error).toBeUndefined()
}

async function saveRuntimeImageFixture(): Promise<void> {
    const response = await getRuntimeServer().handleRequest(
        {
            id: "image-fixture",
            method: "data/file/save",
            params: {
                folder: "images",
                id: "phone-image",
                ext: "png",
                data: Buffer.from("paired image bytes").toString("base64"),
            },
        },
        { id: "trusted-image-fixture", send() {} }
    )
    expect(response.error).toBeUndefined()
}

async function deleteRuntimeImageFixture(): Promise<void> {
    const response = await getRuntimeServer().handleRequest(
        {
            id: "image-fixture-delete",
            method: "data/file/delete",
            params: { folder: "images", id: "phone-image", ext: "png" },
        },
        { id: "trusted-image-fixture-delete", send() {} }
    )
    expect(response.error).toBeUndefined()
}

function listen(server: http.Server): Promise<string> {
    return new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
            const address = server.address()
            if (typeof address !== "object" || !address) {
                reject(new Error("Server did not expose an address"))
                return
            }
            resolve(`http://127.0.0.1:${address.port}`)
        })
    })
}

async function startTestServer(): Promise<TestServer> {
    const server = http.createServer(createCompanionRequestHandler())
    const runtimeSocket = attachRuntimeSocketServer(server)
    const baseUrl = await listen(server)
    return { baseUrl, server, runtimeSocket }
}

function closeTestServer(server: TestServer): Promise<void> {
    server.runtimeSocket.close()
    return new Promise((resolve) => server.server.close(() => resolve()))
}

function queueFor(socket: WebSocket): SocketQueue {
    const existing = socketQueues.get(socket)
    if (existing) return existing

    const queue: SocketQueue = { messages: [], waiters: [] }
    socketQueues.set(socket, queue)
    socket.on("message", (data: RawData) => {
        let message: RuntimeMessage
        try {
            message = JSON.parse(String(data)) as RuntimeMessage
        } catch (error) {
            const parseError = error instanceof Error ? error : new Error("Failed to parse runtime socket message")
            const waiter = queue.waiters.shift()
            if (waiter) waiter.reject(parseError)
            return
        }

        const waiter = queue.waiters.shift()
        if (waiter) {
            waiter.resolve(message)
            return
        }
        queue.messages.push(message)
    })
    socket.on("error", (error: Error) => {
        for (const waiter of queue.waiters.splice(0)) waiter.reject(error)
    })
    return queue
}

function nextMessage(socket: WebSocket): Promise<RuntimeMessage> {
    const queue = queueFor(socket)
    const message = queue.messages.shift()
    if (message) return Promise.resolve(message)

    return new Promise((resolve, reject) => {
        queue.waiters.push({ resolve, reject })
    })
}

async function nextResponse(socket: WebSocket, id: string | number): Promise<RuntimeMessage> {
    for (;;) {
        const message = await nextMessage(socket)
        if ("id" in message && message.id === id) return message
    }
}

function openRuntimeSocket(baseUrl: string, token: string): Promise<WebSocket> {
    const runtimeUrl = baseUrl.replace(/^http:/, "ws:") + "/v1/runtime"
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(runtimeUrl, [`bearer.${token}`])
        socket.once("open", () => resolve(socket))
        socket.once("error", reject)
    })
}

function expectRuntimeSocketRejected(runtimeUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(runtimeUrl)
        socket.once("open", () => {
            socket.close()
            reject(new Error("socket unexpectedly opened"))
        })
        socket.once("error", () => resolve())
    })
}

async function pairTestDevice(baseUrl: string, deviceName: string): Promise<{ device: { id: string }; deviceToken: string }> {
    const pairing = startPairing(baseUrl)
    const response = await fetch(`${baseUrl}/v1/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pairing.token, deviceName, platform: "ios" }),
    })
    expect(response.status).toBe(200)
    return (await response.json()) as { device: { id: string }; deviceToken: string }
}

async function expectDenied(socket: WebSocket, id: number, method: string, params?: unknown): Promise<void> {
    socket.send(JSON.stringify(params === undefined ? { id, method } : { id, method, params }))
    expect(await nextResponse(socket, id)).toMatchObject({
        id,
        error: { code: "permission_denied" },
    })
}

async function runtimeRequest(socket: WebSocket, id: number, method: string, params?: unknown): Promise<RuntimeMessage> {
    socket.send(JSON.stringify(params === undefined ? { id, method } : { id, method, params }))
    return nextResponse(socket, id)
}

function runtimeResult<T>(message: RuntimeMessage, id: number): T {
    expect(message).toMatchObject({ id })
    if (!("result" in message)) {
        throw new Error(`Expected runtime response ${id} to contain a result`)
    }
    return message.result as T
}

async function trustedRuntimeResult<T>(id: string, method: string, params?: unknown): Promise<T> {
    const response = await getRuntimeServer().handleRequest(
        params === undefined ? { id, method } : { id, method, params },
        { id: `trusted:${id}`, send() {} }
    )
    expect(response).toMatchObject({ id })
    if (response.error) {
        throw new Error(`Expected trusted runtime response ${id} to contain a result: ${response.error.message}`)
    }
    return response.result as T
}

function waitForClose(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        socket.once("close", () => resolve())
        socket.once("error", reject)
    })
}

describe("companion runtime API integration", () => {
    let server: TestServer | null = null
    let checkpointDir = ""

    beforeEach(() => {
        checkpointDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-runtime-api-"))
        process.env.OPENADE_RUNTIME_CHECKPOINT_FILE = path.join(checkpointDir, "runtime-checkpoints.json")
        process.env.OPENADE_YJS_STORAGE_DIR = path.join(checkpointDir, "yjs")
        storeState.data.clear()
        resetRuntimeServer()
    })

    afterEach(async () => {
        if (server) {
            await closeTestServer(server)
            server = null
        }
        resetRuntimeServer()
        Reflect.deleteProperty(process.env, "OPENADE_RUNTIME_CHECKPOINT_FILE")
        Reflect.deleteProperty(process.env, "OPENADE_YJS_STORAGE_DIR")
        fs.rmSync(checkpointDir, { recursive: true, force: true })
    })

    it("pairs over HTTP and speaks runtime protocol over authenticated WebSocket", async () => {
        server = await startTestServer()
        const pairing = startPairing(server.baseUrl)

        const pairResponse = await fetch(`${server.baseUrl}/v1/pair`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: pairing.token, deviceName: "Integration Phone", platform: "ios" }),
        })
        expect(pairResponse.status).toBe(200)
        const paired = (await pairResponse.json()) as { deviceToken: string }

        const socket = await openRuntimeSocket(server.baseUrl, paired.deviceToken)
        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        const initialized = await nextMessage(socket)

        expect(initialized).toMatchObject({
            id: 1,
            result: {
                serverName: "openade-runtime",
                capabilities: {
                    methods: expect.arrayContaining([
                        "openade/snapshot/read",
                        "openade/project/files/tree",
                        "openade/project/files/fuzzySearch",
                        "openade/project/file/read",
                        "openade/project/search",
                        "openade/project/git/info/read",
                        "openade/project/git/branches/read",
                        "openade/project/git/summary/read",
                        "openade/project/process/list",
                        "openade/project/process/reconnect",
                        "openade/cron/definitions/read",
                        "openade/task/changes/read",
                        "openade/task/diff/read",
                        "openade/task/create",
                        "openade/task/filePair/read",
                        "openade/task/git/summary/read",
                        "openade/task/git/log",
                        "openade/task/git/scopes/read",
                        "openade/task/git/commit/files/read",
                        "openade/task/git/fileAtTreeish/read",
                        "openade/task/git/commit/filePatch/read",
                        "openade/task/image/read",
                        "openade/task/image/write",
                        "openade/task/resourceInventory/read",
                        "openade/task/snapshot/patch/read",
                        "openade/task/snapshot/index/read",
                        "openade/task/snapshot/patch/readSlice",
                        "openade/turn/start",
                        "openade/review/start",
                        "openade/turn/interrupt",
                        "openade/queued-turn/enqueue",
                        "openade/queued-turn/reorder",
                        "openade/queued-turn/cancel",
                        "openade/comment/create",
                        "openade/comment/edit",
                        "openade/comment/delete",
                        "openade/task/metadata/update",
                        "openade/task/delete",
                        "remote/device/selfRevoke",
                    ]),
                },
            },
        })
        const capabilities = (initialized as { result: { capabilities: { methods: string[]; notifications: string[] } } }).result.capabilities
        const methods = capabilities.methods
        expect(methods).not.toEqual(
            expect.arrayContaining([
                "runtime/list",
                "runtime/read",
                "runtime/reconcile",
                "process/list",
                "process/reconnect",
                "process/kill",
                "agent/provider/list",
                "agent/provider/status",
                "agent/provider/connect",
                "agent/serverProtocol/list",
                "agent/approval/list",
                "agent/approval/respond",
                "agent/approval/reject",
                "openade/repo/create",
                "openade/repo/update",
                "openade/repo/delete",
                "openade/project/process/start",
                "openade/project/process/stop",
                "openade/task/terminal/start",
                "openade/task/terminal/write",
                "openade/task/terminal/reconnect",
                "openade/task/terminal/resize",
                "openade/task/terminal/stop",
                "openade/task/git/commit",
                "remote/device/list",
                "remote/device/revoke",
                "remote/device/dropAll",
                "openade/action/create",
                "openade/action/reconcileRuntime",
                "openade/task/environment/setup",
                "openade/task/environment/prepare",
                "openade/snapshot/create",
                "data/yjs/read",
                "host/platform/info",
                "host/core/legacyYjsMigration/accept",
                "host/core/legacyYjsMigration/revoke",
                "fs/path/describe",
                "git/status/read",
                "pty/spawn",
            ])
        )
        expect(capabilities.notifications).not.toEqual(expect.arrayContaining(["runtime/updated", "process/output", "agent/approval/requested", "host/mcp/oauthComplete"]))

        socket.send(JSON.stringify({ id: 24, method: "server/status/read" }))
        const status = await nextResponse(socket, 24)
        expect(status).toMatchObject({
            id: 24,
            result: {
                serverName: "openade-runtime",
                capabilities: {
                    methods: expect.arrayContaining(["openade/snapshot/read", "remote/device/selfRevoke"]),
                },
            },
        })
        const statusMethods = (status as { result: { capabilities: { methods: string[] } } }).result.capabilities.methods
        expect(statusMethods).not.toEqual(
            expect.arrayContaining([
                "runtime/list",
                "runtime/read",
                "process/list",
                "agent/provider/list",
                "agent/provider/status",
                "agent/serverProtocol/list",
                "host/platform/info",
                "data/yjs/read",
                "remote/device/list",
                "remote/device/revoke",
                "remote/device/dropAll",
            ])
        )

        const deniedMethods: Array<[number, string, unknown?]> = [
            [2, "runtime/list"],
            [3, "runtime/read", { runtimeId: "runtime-1" }],
            [4, "runtime/reconcile", { runtimeId: "runtime-1" }],
            [5, "process/list"],
            [6, "agent/execution/start", { executionId: "blocked" }],
            [7, "agent/provider/connect", { providerId: "codex-server" }],
            [52, "agent/provider/list"],
            [53, "agent/provider/status", { providerId: "codex-server" }],
            [54, "agent/serverProtocol/list"],
            [55, "agent/approval/list", { providerId: "codex-server" }],
            [56, "agent/approval/respond", { providerId: "codex-server", requestId: "approval-1", response: { decision: "accept" } }],
            [57, "agent/approval/reject", { providerId: "codex-server", requestId: "approval-2", message: "blocked" }],
            [8, "openade/action/create", { taskId: "task-1" }],
            [9, "openade/action/reconcileRuntime", { taskId: "task-1", eventId: "event-1", status: "failed" }],
            [10, "openade/task/environment/setup", { taskId: "task-1" }],
            [36, "openade/task/environment/prepare", { repoId: "repo-1", taskId: "task-1" }],
            [11, "openade/snapshot/create", { taskId: "task-1" }],
            [45, "openade/repo/create", { repoId: "blocked-repo", name: "Blocked Repo", path: os.tmpdir() }],
            [46, "openade/repo/update", { repoId: "blocked-repo", name: "Blocked Repo" }],
            [47, "openade/repo/delete", { repoId: "blocked-repo" }],
            [12, "data/file/save", { folder: "images", id: "blocked", ext: "txt", data: "blocked" }],
            [35, "data/file/load", { folder: "images", id: "phone-image", ext: "png" }],
            [13, "fs/path/describe", { path: os.tmpdir(), readContents: false }],
            [14, "fs/file/write", { path: path.join(os.tmpdir(), "blocked.txt"), content: "blocked" }],
            [15, "fs/path/remove", { path: path.join(os.tmpdir(), "blocked.txt"), force: true }],
            [16, "process/command/start", { cmd: process.execPath, args: ["-e", "console.log('blocked')"], cwd: os.tmpdir() }],
            [17, "process/script/start", { script: "echo blocked", cwd: os.tmpdir() }],
            [28, "process/reconnect", { processId: "blocked" }],
            [29, "process/kill", { processId: "blocked" }],
            [50, "openade/project/process/start", { repoId: "repo-1", definitionId: "openade.toml::Phone Echo", clientRequestId: "blocked-process-start" }],
            [51, "openade/project/process/stop", { repoId: "repo-1", processId: "blocked-process", clientRequestId: "blocked-process-stop" }],
            [18, "pty/spawn", { ptyId: "blocked-pty", cwd: os.tmpdir(), cols: 80, rows: 24 }],
            [19, "git/status/read", { repoDir: os.tmpdir() }],
            [20, "git/worktree/commit", { worktreePath: os.tmpdir(), message: "blocked" }],
            [21, "data/yjs/read", { id: "code:repos" }],
            [22, "host/platform/info"],
            [49, "host/core/legacyYjsMigration/accept"],
            [58, "host/core/legacyYjsMigration/revoke"],
            [23, "snapshot/bundle/save", { id: "snapshot-1", patch: "", index: { files: [] } }],
            [25, "snapshot/patch/read", { id: "snapshot-1" }],
            [26, "snapshot/index/read", { id: "snapshot-1" }],
            [27, "snapshot/patch/readSlice", { id: "snapshot-1", start: 0, end: 1 }],
            [30, "openade/task/terminal/start", { repoId: "repo-1", taskId: "task-1", cols: 80, rows: 24 }],
            [31, "openade/task/terminal/write", { repoId: "repo-1", taskId: "task-1", terminalId: "blocked", data: "pwd\n" }],
            [32, "openade/task/terminal/reconnect", { repoId: "repo-1", taskId: "task-1", terminalId: "blocked" }],
            [33, "openade/task/terminal/resize", { repoId: "repo-1", taskId: "task-1", terminalId: "blocked", cols: 100, rows: 30 }],
            [34, "openade/task/terminal/stop", { repoId: "repo-1", taskId: "task-1", terminalId: "blocked" }],
            [37, "openade/task/git/commit", { repoId: "repo-1", taskId: "task-1", message: "blocked" }],
            [48, "openade/task/title/generate", { repoId: "repo-1", taskId: "task-1" }],
            [38, "remote/device/list"],
            [39, "remote/device/revoke", { deviceId: "blocked-device" }],
            [40, "remote/device/dropAll"],
            [41, "host/mcp/testConnection", { config: { type: "stdio", command: "echo" } }],
            [42, "host/mcp/initiateOAuth", { serverId: "blocked-mcp", serverUrl: "https://example.com/mcp" }],
            [43, "host/mcp/cancelOAuth", { serverId: "blocked-mcp" }],
            [44, "host/mcp/refreshOAuth", { serverId: "blocked-mcp", serverUrl: "https://example.com/mcp", refreshToken: "blocked" }],
        ]
        for (const [id, method, params] of deniedMethods) {
            await expectDenied(socket, id, method, params)
        }

        socket.close()
    })

    it("lets paired devices perform product mutations without raw host or storage powers", async () => {
        const repoPath = path.join(checkpointDir, "repo")
        fs.mkdirSync(repoPath, { recursive: true })
        fs.writeFileSync(path.join(repoPath, "README.md"), "hello from scoped project search\n")
        fs.writeFileSync(
            path.join(repoPath, "openade.toml"),
            [
                "[[process]]",
                'name = "Phone Echo"',
                'command = "printf \'paired scoped process ok\\n\'"',
                'type = "task"',
                "",
                "[[cron]]",
                'name = "Nightly Phone"',
                'schedule = "0 9 * * 1"',
                'type = "ask"',
                'prompt = "Summarize paired-device progress"',
                "",
            ].join("\n")
        )
        initializeGitRepo(repoPath)
        await seedOpenADEFixture(repoPath)
        server = await startTestServer()
        await saveRuntimeSnapshotFixture()
        await saveRuntimeImageFixture()
        const paired = await pairTestDevice(server.baseUrl, "Product Phone")
        const socket = await openRuntimeSocket(server.baseUrl, paired.deviceToken)

        expect(await runtimeRequest(socket, 1, "initialize")).toMatchObject({ id: 1, result: { serverName: "openade-runtime" } })
        expect(
            runtimeResult<{ entries: Array<{ path: string; type: string }> }>(
                await runtimeRequest(socket, 19, "openade/project/files/tree", { repoId: "repo-1", maxDepth: 2 }),
                19
            )
        ).toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ path: "README.md", type: "file" })]) })
        expect(
            runtimeResult<{ path: string; encoding: string; content: string | null }>(
                await runtimeRequest(socket, 20, "openade/project/file/read", { repoId: "repo-1", path: "README.md" }),
                20
            )
        ).toMatchObject({ path: "README.md", encoding: "utf8", content: "hello from scoped project search\n" })
        expect(
            runtimeResult<{ matches: Array<{ path: string; line: number; content: string }> }>(
                await runtimeRequest(socket, 21, "openade/project/search", { repoId: "repo-1", query: "scoped" }),
                21
            )
        ).toMatchObject({
            matches: expect.arrayContaining([expect.objectContaining({ path: "README.md", line: 1, content: "hello from scoped project search" })]),
        })
        expect(
            runtimeResult<{ results: string[] }>(
                await runtimeRequest(socket, 221, "openade/project/files/fuzzySearch", { repoId: "repo-1", query: "readme", limit: 5 }),
                221
            )
        ).toMatchObject({ results: expect.arrayContaining(["README.md"]) })
        expect(
            runtimeResult<{ isGitRepo: boolean; mainBranch?: string }>(
                await runtimeRequest(socket, 222, "openade/project/git/info/read", { repoId: "repo-1" }),
                222
            )
        ).toMatchObject({ isGitRepo: true, mainBranch: "main" })
        expect(
            runtimeResult<{ defaultBranch: string; branches: Array<{ name: string; isDefault: boolean }> }>(
                await runtimeRequest(socket, 223, "openade/project/git/branches/read", { repoId: "repo-1", includeRemote: true }),
                223
            )
        ).toMatchObject({
            defaultBranch: "main",
            branches: [expect.objectContaining({ name: "main", isDefault: true })],
        })
        expect(
            runtimeResult<{ branch: string | null; hasChanges: boolean; untracked: Array<{ path: string }> }>(
                await runtimeRequest(socket, 224, "openade/project/git/summary/read", { repoId: "repo-1" }),
                224
            )
        ).toMatchObject({
            branch: "main",
            hasChanges: true,
            untracked: [expect.objectContaining({ path: "openade.toml" })],
        })
        expect(
            runtimeResult<{ processes: Array<{ id: string; name: string; cwd: string }> }>(
                await runtimeRequest(socket, 32, "openade/project/process/list", { repoId: "repo-1" }),
                32
            )
        ).toMatchObject({
            processes: [expect.objectContaining({ id: "openade.toml::Phone Echo", name: "Phone Echo", cwd: fs.realpathSync(repoPath) })],
        })
        expect(
            runtimeResult<{ configs: Array<{ relativePath: string; crons: Array<{ id: string; name: string; prompt: string }> }> }>(
                await runtimeRequest(socket, 321, "openade/cron/definitions/read", { repoId: "repo-1" }),
                321
            )
        ).toMatchObject({
            configs: [
                expect.objectContaining({
                    relativePath: "openade.toml",
                    crons: [expect.objectContaining({ id: "openade.toml::Nightly Phone", name: "Nightly Phone", prompt: "Summarize paired-device progress" })],
                }),
            ],
        })
        const createdTask = runtimeResult<{ taskId: string; slug: string; title: string }>(
            await runtimeRequest(socket, 322, "openade/task/create", {
                repoId: "repo-1",
                taskId: "task-phone-created",
                slug: "phone-created",
                title: "Phone created task",
                input: "Created by a paired device without starting execution",
                createdBy: { id: "phone", email: "phone@example.com" },
                deviceId: "phone-device",
                isolationStrategy: { type: "head" },
                clientRequestId: "paired-task-create",
            }),
            322
        )
        expect(createdTask).toMatchObject({
            taskId: "task-phone-created",
            slug: "phone-created",
            title: "Phone created task",
        })
        expect(
            runtimeResult<{ id: string; title: string; description: string }>(
                await runtimeRequest(socket, 323, "openade/task/read", { repoId: "repo-1", taskId: "task-phone-created" }),
                323
            )
        ).toMatchObject({
            id: "task-phone-created",
            title: "Phone created task",
            description: "Created by a paired device without starting execution",
        })
        expect(
            await runtimeRequest(socket, 33, "openade/project/process/start", {
                repoId: "repo-1",
                definitionId: "openade.toml::Phone Echo",
                clientRequestId: "phone-process-start",
            })
        ).toMatchObject({ id: 33, error: expect.objectContaining({ code: "permission_denied" }) })
        expect(
            await runtimeRequest(socket, 34, "openade/project/process/stop", {
                repoId: "repo-1",
                processId: "phone-process",
                clientRequestId: "phone-process-stop",
            })
        ).toMatchObject({ id: 34, error: expect.objectContaining({ code: "permission_denied" }) })
        expect(
            await runtimeRequest(socket, 36, "openade/project/process/start", {
                repoId: "repo-1",
                definitionId: "openade.toml::Phone Echo",
                clientRequestId: "phone-process-outside",
            })
        ).toMatchObject({ id: 36, error: expect.objectContaining({ code: "permission_denied" }) })

        fs.writeFileSync(path.join(repoPath, "README.md"), "hello from scoped project search\npaired task git change\n")
        fs.writeFileSync(path.join(repoPath, "phone.txt"), "paired device can inspect scoped task git\n")
        expect(
            runtimeResult<{ files: Array<{ path: string; status: string }>; fromTreeish: string }>(
                await runtimeRequest(socket, 22, "openade/task/changes/read", { repoId: "repo-1", taskId: "task-1" }),
                22
            )
        ).toMatchObject({
            fromTreeish: "HEAD",
            files: expect.arrayContaining([
                expect.objectContaining({ path: "README.md", status: "modified" }),
                expect.objectContaining({ path: "phone.txt", status: "added" }),
            ]),
        })
        const taskDiff = runtimeResult<{ patch: string; stats: { insertions: number; deletions: number; changedLines: number } }>(
            await runtimeRequest(socket, 23, "openade/task/diff/read", { repoId: "repo-1", taskId: "task-1", filePath: "README.md" }),
            23
        )
        expect(taskDiff).toMatchObject({ stats: { insertions: 1, deletions: 0, changedLines: 1 } })
        expect(taskDiff.patch).toContain("+paired task git change")
        expect(
            runtimeResult<{ before: string; after: string; filePath: string }>(
                await runtimeRequest(socket, 40, "openade/task/filePair/read", { repoId: "repo-1", taskId: "task-1", filePath: "README.md" }),
                40
            )
        ).toMatchObject({
            filePath: "README.md",
            before: "hello from scoped project search\n",
            after: "hello from scoped project search\npaired task git change\n",
        })
        expect(
            runtimeResult<{ commits: Array<{ message: string; author: string }> }>(
                await runtimeRequest(socket, 24, "openade/task/git/log", { repoId: "repo-1", taskId: "task-1", limit: 3 }),
                24
            )
        ).toMatchObject({ commits: [expect.objectContaining({ message: "Initial companion fixture", author: "Companion Test" })] })
        expect(
            runtimeResult<{ defaultBranch: string; scopes: Array<{ id: string; type: string; name?: string }> }>(
                await runtimeRequest(socket, 241, "openade/task/git/scopes/read", { repoId: "repo-1", taskId: "task-1", includeRemote: true }),
                241
            )
        ).toMatchObject({
            defaultBranch: "main",
            scopes: expect.arrayContaining([
                expect.objectContaining({ id: "branch:HEAD", type: "branch", name: "HEAD" }),
                expect.objectContaining({ id: "branch:main", type: "branch", name: "main" }),
            ]),
        })
        const initialCommit = gitOutput(repoPath, ["rev-parse", "HEAD"])
        expect(
            runtimeResult<{ branch: string | null; hasChanges: boolean; untracked: Array<{ path: string }> }>(
                await runtimeRequest(socket, 242, "openade/task/git/summary/read", { repoId: "repo-1", taskId: "task-1" }),
                242
            )
        ).toMatchObject({
            branch: "main",
            hasChanges: true,
            untracked: expect.arrayContaining([expect.objectContaining({ path: "openade.toml" }), expect.objectContaining({ path: "phone.txt" })]),
        })
        expect(
            runtimeResult<{ repoId: string; taskId: string; commit: string; files: Array<{ path: string; status: string }> }>(
                await runtimeRequest(socket, 243, "openade/task/git/commit/files/read", {
                    repoId: "repo-1",
                    taskId: "task-1",
                    commit: initialCommit,
                }),
                243
            )
        ).toMatchObject({
            repoId: "repo-1",
            taskId: "task-1",
            commit: initialCommit,
            files: [expect.objectContaining({ path: "README.md", status: "added" })],
        })
        expect(
            runtimeResult<{ repoId: string; taskId: string; treeish: string; filePath: string; content: string; exists: boolean }>(
                await runtimeRequest(socket, 244, "openade/task/git/fileAtTreeish/read", {
                    repoId: "repo-1",
                    taskId: "task-1",
                    treeish: initialCommit,
                    filePath: "README.md",
                }),
                244
            )
        ).toMatchObject({
            repoId: "repo-1",
            taskId: "task-1",
            treeish: initialCommit,
            filePath: "README.md",
            content: "hello from scoped project search\n",
            exists: true,
        })
        const pairedCommitPatch = runtimeResult<{
            repoId: string
            taskId: string
            commit: string
            filePath: string
            patch: string
            stats: { insertions: number; deletions: number; changedLines: number; hunkCount: number }
        }>(
            await runtimeRequest(socket, 245, "openade/task/git/commit/filePatch/read", {
                repoId: "repo-1",
                taskId: "task-1",
                commit: initialCommit,
                filePath: "README.md",
                contextLines: 3,
            }),
            245
        )
        expect(pairedCommitPatch).toMatchObject({
            repoId: "repo-1",
            taskId: "task-1",
            commit: initialCommit,
            filePath: "README.md",
            stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
        })
        expect(pairedCommitPatch.patch).toContain("+hello from scoped project search")
        const trustedCommit = await getRuntimeServer().handleRequest(
            {
                id: "trusted-git-commit",
                method: "openade/task/git/commit",
                params: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    message: "Trusted scoped companion commit",
                    clientRequestId: "trusted-git-commit",
                },
            },
            { id: "trusted-git-commit", send() {} }
        )
        expect(trustedCommit.error).toBeUndefined()
        expect(trustedCommit.result).toMatchObject({ repoId: "repo-1", taskId: "task-1", committed: true, status: "committed" })
        expect(gitOutput(repoPath, ["log", "-1", "--format=%s"])).toBe("Trusted scoped companion commit")
        expect(
            runtimeResult<{ index: { files: Array<{ path: string; insertions: number }> } }>(
                await runtimeRequest(socket, 28, "openade/task/snapshot/index/read", { repoId: "repo-1", taskId: "task-1", eventId: "snapshot-1" }),
                28
            )
        ).toMatchObject({ index: { files: [expect.objectContaining({ path: "README.md", insertions: 1 })] } })
        expect(
            runtimeResult<{ patch: string | null }>(
                await runtimeRequest(socket, 29, "openade/task/snapshot/patch/read", { repoId: "repo-1", taskId: "task-1", eventId: "snapshot-1" }),
                29
            )
        ).toMatchObject({ patch: expect.stringContaining("+scoped snapshot patch") })
        expect(
            runtimeResult<{ patch: string | null }>(
                await runtimeRequest(socket, 30, "openade/task/snapshot/patch/readSlice", {
                    repoId: "repo-1",
                    taskId: "task-1",
                    eventId: "snapshot-1",
                    start: 35,
                    end: 58,
                }),
                30
            )
        ).toMatchObject({ patch: "+scoped snapshot patch\n" })
        expect(
            runtimeResult<{ imageId: string; mediaType?: string; data: string | null }>(
                await runtimeRequest(socket, 37, "openade/task/image/read", { repoId: "repo-1", taskId: "task-1", imageId: "phone-image", ext: "png" }),
                37
            )
        ).toMatchObject({
            imageId: "phone-image",
            mediaType: "image/png",
            data: Buffer.from("paired image bytes").toString("base64"),
        })
        const pairedUploadBytes = Buffer.from("paired uploaded image")
        expect(
            runtimeResult<{ imageId: string; ext: string; mediaType: string; size: number; sha256: string }>(
                await runtimeRequest(socket, 42, "openade/task/image/write", {
                    imageId: "phone-uploaded-image",
                    ext: "png",
                    mediaType: "image/png",
                    data: pairedUploadBytes.toString("base64"),
                    clientRequestId: "paired-image-upload",
                }),
                42
            )
        ).toMatchObject({
            imageId: "phone-uploaded-image",
            ext: "png",
            mediaType: "image/png",
            size: pairedUploadBytes.byteLength,
        })
        expect(
            runtimeResult<{ taskId: string; snapshotIds: string[]; images: Array<{ id: string; ext: string }>; worktree: null }>(
                await runtimeRequest(socket, 40, "openade/task/resourceInventory/read", { repoId: "repo-1", taskId: "task-1" }),
                40
            )
        ).toMatchObject({
            taskId: "task-1",
            snapshotIds: ["snapshot-1"],
            images: [{ id: "phone-image", ext: "png" }],
            worktree: null,
        })
        expect(
            runtimeResult<{ data: string | null }>(
                await runtimeRequest(socket, 38, "openade/task/image/read", { repoId: "repo-1", taskId: "task-1", imageId: "not-attached", ext: "png" }),
                38
            )
        ).toMatchObject({ data: null })
        expect(await runtimeRequest(socket, 39, "openade/task/image/read", { repoId: "repo-1", taskId: "task-1", imageId: "../phone-image", ext: "png" })).toMatchObject({
            id: 39,
            error: { code: "invalid_params" },
        })
        expect(await runtimeRequest(socket, 31, "openade/task/snapshot/patch/read", { repoId: "repo-1", taskId: "task-1", eventId: "../snapshot-1" })).toMatchObject({
            id: 31,
            error: expect.objectContaining({ code: "handler_error" }),
        })

        expect(await runtimeRequest(socket, 25, "openade/project/file/read", { repoId: "repo-1", path: "../secret.txt" })).toMatchObject({
            id: 25,
            error: { code: "invalid_params" },
        })
        expect(await runtimeRequest(socket, 26, "openade/task/diff/read", { repoId: "repo-1", taskId: "task-1", filePath: "../secret.txt" })).toMatchObject({
            id: 26,
            error: { code: "invalid_params" },
        })
        expect(await runtimeRequest(socket, 41, "openade/task/filePair/read", { repoId: "repo-1", taskId: "task-1", filePath: "../secret.txt" })).toMatchObject({
            id: 41,
            error: { code: "invalid_params" },
        })
        expect(await runtimeRequest(socket, 27, "openade/project/file/write", { repoId: "repo-1", path: "README.md", content: "phone write" })).toMatchObject({
            id: 27,
            error: { code: "permission_denied" },
        })
        expect(
            await runtimeRequest(socket, 2, "openade/repo/create", {
                repoId: "repo-phone",
                name: "Phone Created Repo",
                path: path.join(checkpointDir, "phone-repo"),
                createdBy: { id: "phone", email: "phone@example.com" },
                createdAt: "2026-05-31T00:10:00.000Z",
            })
        ).toMatchObject({ id: 2, error: { code: "permission_denied" } })
        expect(
            await runtimeRequest(socket, 3, "openade/repo/update", {
                repoId: "repo-phone",
                name: "Phone Updated Repo",
                archived: true,
                updatedAt: "2026-05-31T00:11:00.000Z",
            })
        ).toMatchObject({ id: 3, error: { code: "permission_denied" } })
        expect(await runtimeRequest(socket, 4, "openade/comment/create", {
            taskId: "task-1",
            commentId: "comment-phone",
            content: "Created from the paired device.",
            source: { type: "llm_output", eventId: "event-1", lineStart: 1, lineEnd: 1 },
            selectedText: { text: "selection", linesBefore: "", linesAfter: "" },
            author: { id: "phone", email: "phone@example.com" },
            createdAt: "2026-05-31T00:12:00.000Z",
        })).toMatchObject({ id: 4, result: { commentId: "comment-phone", createdAt: "2026-05-31T00:12:00.000Z" } })
        expect(await runtimeRequest(socket, 5, "openade/comment/edit", {
            taskId: "task-1",
            commentId: "comment-phone",
            content: "Updated from the paired device.",
            updatedAt: "2026-05-31T00:13:00.000Z",
        })).toMatchObject({ id: 5, result: null })
        expect(await runtimeRequest(socket, 6, "openade/task/metadata/update", {
            taskId: "task-1",
            title: "Phone Updated Task",
            closed: true,
            updatedAt: "2026-05-31T00:14:00.000Z",
        })).toMatchObject({ id: 6, result: null })

        const task = runtimeResult<{ title: string; closed: boolean; comments: Array<{ id: string; content?: string }> }>(
            await runtimeRequest(socket, 7, "openade/task/read", { repoId: "repo-1", taskId: "task-1" }),
            7
        )
        expect(task).toMatchObject({
            title: "Phone Updated Task",
            closed: true,
            comments: [expect.objectContaining({ id: "comment-phone", content: "Updated from the paired device." })],
        })

        const queuedFirst = runtimeResult<{ taskId: string; queuedTurnId: string; queued: boolean; turn: { id: string; input: string; status: string } }>(
            await runtimeRequest(socket, 101, "openade/queued-turn/enqueue", {
                repoId: "repo-1",
                taskId: "task-1",
                type: "ask",
                input: "Queued from paired device",
                clientRequestId: "paired-queued-first",
            }),
            101
        )
        expect(queuedFirst).toMatchObject({
            taskId: "task-1",
            queued: true,
            turn: expect.objectContaining({ input: "Queued from paired device", status: "queued" }),
        })
        const queuedSecond = runtimeResult<{ queuedTurnId: string; turn: { id: string; input: string; status: string } }>(
            await runtimeRequest(socket, 102, "openade/queued-turn/enqueue", {
                repoId: "repo-1",
                taskId: "task-1",
                type: "do",
                input: "Second paired queued turn",
                clientRequestId: "paired-queued-second",
            }),
            102
        )
        expect(
            runtimeResult<{ reordered: boolean; turns: Array<{ id: string; input: string; status: string }> }>(
                await runtimeRequest(socket, 103, "openade/queued-turn/reorder", {
                    repoId: "repo-1",
                    taskId: "task-1",
                    queuedTurnIds: [queuedSecond.queuedTurnId, queuedFirst.queuedTurnId],
                    clientRequestId: "paired-queue-reorder",
                }),
                103
            )
        ).toMatchObject({
            reordered: true,
            turns: [
                expect.objectContaining({ id: queuedSecond.queuedTurnId, input: "Second paired queued turn", status: "queued" }),
                expect.objectContaining({ id: queuedFirst.queuedTurnId, input: "Queued from paired device", status: "queued" }),
            ],
        })
        const queuedTask = runtimeResult<{ queuedTurns: Array<{ id: string }> }>(
            await runtimeRequest(socket, 104, "openade/task/read", { repoId: "repo-1", taskId: "task-1" }),
            104
        )
        expect(queuedTask.queuedTurns.map((turn) => turn.id).slice(0, 2)).toEqual([queuedSecond.queuedTurnId, queuedFirst.queuedTurnId])

        expect(await runtimeRequest(socket, 8, "openade/comment/delete", {
            taskId: "task-1",
            commentId: "comment-phone",
            updatedAt: "2026-05-31T00:15:00.000Z",
        })).toMatchObject({ id: 8, result: null })
        expect(
            await runtimeRequest(socket, 105, "openade/task/delete", {
                repoId: "repo-1",
                taskId: "task-phone-created",
                options: { deleteSnapshots: false, deleteImages: false, deleteSessions: false, deleteWorktrees: false },
            })
        ).toMatchObject({ id: 105, result: { repoId: "repo-1", taskId: "task-phone-created", deleted: true } })
        expect(await runtimeRequest(socket, 9, "openade/task/delete", {
            repoId: "repo-1",
            taskId: "task-1",
            options: { deleteSnapshots: false, deleteImages: false, deleteSessions: false, deleteWorktrees: false },
        })).toMatchObject({ id: 9, result: { repoId: "repo-1", taskId: "task-1", deleted: true } })
        expect(await runtimeRequest(socket, 10, "openade/repo/delete", { repoId: "repo-phone" })).toMatchObject({
            id: 10,
            error: { code: "permission_denied" },
        })

        const snapshot = runtimeResult<{ repos: Array<{ id: string; tasks: Array<{ id: string }> }> }>(
            await runtimeRequest(socket, 11, "openade/snapshot/read"),
            11
        )
        expect(snapshot.repos.find((repo) => repo.id === "repo-1")?.tasks.map((taskItem) => taskItem.id)).not.toContain("task-1")

        await expectDenied(socket, 12, "data/yjs/read", { id: "code:repos" })
        await expectDenied(socket, 13, "host/platform/info")

        await deleteRuntimeImageFixture()
        socket.close()
    })

    it("rejects long-lived device tokens in the runtime WebSocket URL query string", async () => {
        server = await startTestServer()
        const paired = await pairTestDevice(server.baseUrl, "Query Token Phone")
        const runtimeUrl = `${server.baseUrl.replace(/^http:/, "ws:")}/v1/runtime?token=${encodeURIComponent(paired.deviceToken)}`

        await expect(expectRuntimeSocketRejected(runtimeUrl)).resolves.toBeUndefined()
    })

    it("filters raw runtime and host notifications from paired device sockets", async () => {
        server = await startTestServer()
        const paired = await pairTestDevice(server.baseUrl, "Filtered Phone")
        const socket = await openRuntimeSocket(server.baseUrl, paired.deviceToken)

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        expect(await nextResponse(socket, 1)).toMatchObject({ id: 1, result: { serverName: "openade-runtime" } })

        socket.send(JSON.stringify({ id: 2, method: "subscription/update", params: { methods: ["*"] } }))
        expect(await nextResponse(socket, 2)).toMatchObject({ id: 2, result: { ok: true } })

        const runtime = getRuntimeServer()
        runtime.registerNotification("remote/debug")
        runtime.registerNotification("connection/recovered")

        getRuntimeServer().notify("runtime/updated", {
            runtimeId: "runtime-secret",
            kind: "process",
            status: "running",
            scope: { ownerType: "process", ownerId: "secret-process", rootPath: os.tmpdir() },
            startedAt: "2026-05-27T00:00:00.000Z",
            updatedAt: "2026-05-27T00:00:00.000Z",
            lastActivityAt: "2026-05-27T00:00:00.000Z",
        })
        runtime.notify("process/output", { processId: "secret-process", output: "hidden" })
        runtime.notify("remote/debug", { secret: "hidden" })
        runtime.notify("remote/device/changed", { type: "devices_changed", at: "2026-05-27T00:00:01.000Z" })
        runtime.notify("connection/recovered", { ok: true })
        runtime.notify("openade/task/updated", { repoId: "repo-1", taskId: "task-1" })

        expect(await nextMessage(socket)).toMatchObject({
            method: "remote/device/changed",
            params: { type: "devices_changed" },
        })
        expect(await nextMessage(socket)).toMatchObject({
            method: "connection/recovered",
            params: { ok: true },
        })
        expect(await nextMessage(socket)).toMatchObject({
            method: "openade/task/updated",
            params: { repoId: "repo-1", taskId: "task-1" },
        })

        socket.close()
    })

    it("keeps MCP OAuth completion notifications on trusted local clients only", async () => {
        server = await startTestServer()
        const paired = await pairTestDevice(server.baseUrl, "OAuth Filtered Phone")
        const liveSocket = await openRuntimeSocket(server.baseUrl, paired.deviceToken)

        expect(await runtimeRequest(liveSocket, 1, "initialize")).toMatchObject({ id: 1, result: { serverName: "openade-runtime" } })
        expect(await runtimeRequest(liveSocket, 2, "subscription/update", { methods: ["*"] })).toMatchObject({ id: 2, result: { ok: true } })

        const runtime = getRuntimeServer()
        const trustedMessages: RuntimeMessage[] = []
        const trustedConnection = {
            id: "trusted-mcp-oauth-listener",
            send(message: RuntimeMessage) {
                trustedMessages.push(message)
            },
        }
        const disposeTrusted = runtime.connect(trustedConnection)

        try {
            const trustedStatus = await runtime.handleRequest({ id: "trusted-status", method: "server/status/read" }, trustedConnection)
            expect(trustedStatus).toMatchObject({
                id: "trusted-status",
                result: {
                    capabilities: {
                        methods: expect.arrayContaining(["host/mcp/testConnection", "host/mcp/initiateOAuth", "host/mcp/cancelOAuth", "host/mcp/refreshOAuth"]),
                        notifications: expect.arrayContaining(["host/mcp/oauthComplete"]),
                    },
                },
            })

            runtime.notify("host/mcp/oauthComplete", {
                serverId: "mcp-private",
                tokens: {
                    accessToken: "trusted-access-token",
                    refreshToken: "trusted-refresh-token",
                    tokenType: "Bearer",
                    expiresAt: "2026-06-01T01:00:00.000Z",
                },
            })
            runtime.notify("openade/task/updated", { repoId: "repo-1", taskId: "task-1" })

            expect(trustedMessages).toEqual([
                expect.objectContaining({
                    method: "host/mcp/oauthComplete",
                    params: expect.objectContaining({ serverId: "mcp-private" }),
                }),
                expect.objectContaining({
                    method: "openade/task/updated",
                    params: { repoId: "repo-1", taskId: "task-1" },
                }),
            ])
            expect(await nextMessage(liveSocket)).toMatchObject({
                method: "openade/task/updated",
                params: { repoId: "repo-1", taskId: "task-1" },
            })

            const replaySocket = await openRuntimeSocket(server.baseUrl, paired.deviceToken)
            expect(await runtimeRequest(replaySocket, 3, "initialize")).toMatchObject({ id: 3, result: { serverName: "openade-runtime" } })
            replaySocket.send(JSON.stringify({ id: 4, method: "subscription/update", params: { methods: ["*"], cursor: "0" } }))
            expect(await nextMessage(replaySocket)).toMatchObject({
                method: "openade/task/updated",
                params: { repoId: "repo-1", taskId: "task-1" },
            })
            expect(await nextResponse(replaySocket, 4)).toMatchObject({ id: 4, result: { ok: true } })

            replaySocket.close()
        } finally {
            disposeTrusted()
            liveSocket.close()
        }
    })

    it("closes only the revoked device runtime socket", async () => {
        server = await startTestServer()
        const first = await pairTestDevice(server.baseUrl, "First Phone")
        const second = await pairTestDevice(server.baseUrl, "Second Phone")
        const firstSocket = await openRuntimeSocket(server.baseUrl, first.deviceToken)
        const secondSocket = await openRuntimeSocket(server.baseUrl, second.deviceToken)
        const firstClosed = waitForClose(firstSocket)

        server.runtimeSocket.closeDevice(first.device.id)
        await firstClosed

        expect(firstSocket.readyState).toBe(WebSocket.CLOSED)
        expect(secondSocket.readyState).toBe(WebSocket.OPEN)

        secondSocket.send(JSON.stringify({ id: 1, method: "initialize" }))
        expect(await nextMessage(secondSocket)).toMatchObject({
            id: 1,
            result: { serverName: "openade-runtime" },
        })

        secondSocket.close()
    })

    it("lets trusted local runtime revoke one device and leaves other device streams alive", async () => {
        server = await startTestServer()
        const first = await pairTestDevice(server.baseUrl, "First Admin Target")
        const second = await pairTestDevice(server.baseUrl, "Second Admin Target")
        const firstSocket = await openRuntimeSocket(server.baseUrl, first.deviceToken)
        const secondSocket = await openRuntimeSocket(server.baseUrl, second.deviceToken)
        const firstClosed = waitForClose(firstSocket)

        const before = await trustedRuntimeResult<RemoteDeviceListResult>("device-list-before", "remote/device/list")
        expect(before.devices.map((device) => device.id)).toEqual(expect.arrayContaining([first.device.id, second.device.id]))

        const revoked = await trustedRuntimeResult<RemoteDeviceRevokeResult>("device-revoke-one", "remote/device/revoke", {
            deviceId: first.device.id,
        })
        expect(revoked).toMatchObject({ ok: true, revoked: true })
        expect(revoked.devices.find((device) => device.id === first.device.id)?.revokedAt).toBeTruthy()
        expect(revoked.devices.find((device) => device.id === second.device.id)?.revokedAt).toBeUndefined()

        await firstClosed
        expect(firstSocket.readyState).toBe(WebSocket.CLOSED)
        expect(secondSocket.readyState).toBe(WebSocket.OPEN)

        secondSocket.send(JSON.stringify({ id: 1, method: "initialize" }))
        expect(await nextResponse(secondSocket, 1)).toMatchObject({
            id: 1,
            result: { serverName: "openade-runtime" },
        })
        await expect(openRuntimeSocket(server.baseUrl, first.deviceToken)).rejects.toThrow()

        secondSocket.close()
    })

    it("lets trusted local runtime drop all devices and closes every device stream", async () => {
        server = await startTestServer()
        const first = await pairTestDevice(server.baseUrl, "First Drop Target")
        const second = await pairTestDevice(server.baseUrl, "Second Drop Target")
        const firstSocket = await openRuntimeSocket(server.baseUrl, first.deviceToken)
        const secondSocket = await openRuntimeSocket(server.baseUrl, second.deviceToken)
        const firstClosed = waitForClose(firstSocket)
        const secondClosed = waitForClose(secondSocket)

        const dropped = await trustedRuntimeResult<RemoteDeviceDropAllResult>("device-drop-all", "remote/device/dropAll")
        expect(dropped).toMatchObject({ ok: true })
        expect(dropped.devices.every((device) => !!device.revokedAt)).toBe(true)

        await Promise.all([firstClosed, secondClosed])
        expect(firstSocket.readyState).toBe(WebSocket.CLOSED)
        expect(secondSocket.readyState).toBe(WebSocket.CLOSED)
        await expect(openRuntimeSocket(server.baseUrl, first.deviceToken)).rejects.toThrow()
        await expect(openRuntimeSocket(server.baseUrl, second.deviceToken)).rejects.toThrow()
    })

    it("lets a paired device revoke itself over the runtime protocol", async () => {
        server = await startTestServer()
        const paired = await pairTestDevice(server.baseUrl, "Self Revoking Phone")
        const socket = await openRuntimeSocket(server.baseUrl, paired.deviceToken)
        const closed = waitForClose(socket)

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        expect(await nextResponse(socket, 1)).toMatchObject({
            id: 1,
            result: { serverName: "openade-runtime" },
        })

        socket.send(JSON.stringify({ id: 2, method: "remote/device/selfRevoke" }))
        expect(await nextResponse(socket, 2)).toMatchObject({
            id: 2,
            result: { ok: true, revoked: true },
        })

        await closed
        await expect(openRuntimeSocket(server.baseUrl, paired.deviceToken)).rejects.toThrow()
    })
})
