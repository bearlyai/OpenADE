import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import * as Y from "yjs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WebSocket, type RawData } from "ws"
import { type RuntimeMessage } from "../../../../runtime-protocol/src"
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

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

async function waitForProjectProcessOutput(socket: WebSocket, startId: number, repoId: string, processId: string): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt++) {
        const result = runtimeResult<{ found: boolean; completed?: boolean; output?: Array<{ data: string }> }>(
            await runtimeRequest(socket, startId + attempt, "openade/project/process/reconnect", { repoId, processId }),
            startId + attempt
        )
        if (result.found && result.completed) return result.output?.map((chunk) => chunk.data).join("") ?? ""
        await delay(20)
    }
    throw new Error(`Project process ${processId} did not complete`)
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
        delete process.env.OPENADE_RUNTIME_CHECKPOINT_FILE
        delete process.env.OPENADE_YJS_STORAGE_DIR
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
                        "openade/project/file/read",
                        "openade/project/search",
                        "openade/project/process/list",
                        "openade/project/process/start",
                        "openade/project/process/reconnect",
                        "openade/project/process/stop",
                        "openade/task/changes/read",
                        "openade/task/diff/read",
                        "openade/task/filePair/read",
                        "openade/task/git/log",
                        "openade/task/image/read",
                        "openade/task/snapshot/patch/read",
                        "openade/task/snapshot/index/read",
                        "openade/task/snapshot/patch/readSlice",
                        "openade/repo/create",
                        "openade/repo/update",
                        "openade/repo/delete",
                        "openade/turn/start",
                        "openade/review/start",
                        "openade/turn/interrupt",
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
                "openade/snapshot/create",
                "data/yjs/read",
                "host/platform/info",
                "fs/path/describe",
                "git/status/read",
                "pty/spawn",
            ])
        )
        expect(capabilities.notifications).not.toEqual(expect.arrayContaining(["runtime/updated", "process/output", "host/mcp/oauthComplete"]))

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
            [8, "openade/action/create", { taskId: "task-1" }],
            [9, "openade/action/reconcileRuntime", { taskId: "task-1", eventId: "event-1", status: "failed" }],
            [10, "openade/task/environment/setup", { taskId: "task-1" }],
            [11, "openade/snapshot/create", { taskId: "task-1" }],
            [12, "data/file/save", { folder: "images", id: "blocked", ext: "txt", data: "blocked" }],
            [35, "data/file/load", { folder: "images", id: "phone-image", ext: "png" }],
            [13, "fs/path/describe", { path: os.tmpdir(), readContents: false }],
            [14, "fs/file/write", { path: path.join(os.tmpdir(), "blocked.txt"), content: "blocked" }],
            [15, "fs/path/remove", { path: path.join(os.tmpdir(), "blocked.txt"), force: true }],
            [16, "process/command/start", { cmd: process.execPath, args: ["-e", "console.log('blocked')"], cwd: os.tmpdir() }],
            [17, "process/script/start", { script: "echo blocked", cwd: os.tmpdir() }],
            [28, "process/reconnect", { processId: "blocked" }],
            [29, "process/kill", { processId: "blocked" }],
            [18, "pty/spawn", { ptyId: "blocked-pty", cwd: os.tmpdir(), cols: 80, rows: 24 }],
            [19, "git/status/read", { repoDir: os.tmpdir() }],
            [20, "git/worktree/commit", { worktreePath: os.tmpdir(), message: "blocked" }],
            [21, "data/yjs/read", { id: "code:repos" }],
            [22, "host/platform/info"],
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
            '[[process]]\nname = "Phone Echo"\ncommand = "printf \'paired scoped process ok\\n\'"\ntype = "task"\n'
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
            runtimeResult<{ processes: Array<{ id: string; name: string; cwd: string }> }>(
                await runtimeRequest(socket, 32, "openade/project/process/list", { repoId: "repo-1" }),
                32
            )
        ).toMatchObject({
            processes: [expect.objectContaining({ id: "openade.toml::Phone Echo", name: "Phone Echo", cwd: fs.realpathSync(repoPath) })],
        })
        const processStarted = runtimeResult<{ processId: string; runtimeId: string }>(
            await runtimeRequest(socket, 33, "openade/project/process/start", {
                repoId: "repo-1",
                definitionId: "openade.toml::Phone Echo",
                clientRequestId: "phone-process-start",
            }),
            33
        )
        expect(processStarted.runtimeId).toBe(`process:${processStarted.processId}`)
        await expect(waitForProjectProcessOutput(socket, 100, "repo-1", processStarted.processId)).resolves.toContain("paired scoped process ok")
        expect(
            await runtimeRequest(socket, 34, "openade/project/process/stop", {
                repoId: "repo-1",
                processId: processStarted.processId,
                clientRequestId: "phone-process-stop",
            })
        ).toMatchObject({ id: 34, result: { ok: true } })
        fs.appendFileSync(
            path.join(repoPath, "openade.toml"),
            '\n[[process]]\nname = "Outside"\ncommand = "printf nope"\nwork_dir = "../outside"\ntype = "task"\n'
        )
        expect(
            runtimeResult<{ errors: Array<{ relativePath: string; error: string }> }>(
                await runtimeRequest(socket, 35, "openade/project/process/list", { repoId: "repo-1" }),
                35
            )
        ).toMatchObject({
            errors: expect.arrayContaining([expect.objectContaining({ relativePath: "openade.toml", error: expect.stringContaining("outside the repository") })]),
        })
        expect(
            await runtimeRequest(socket, 36, "openade/project/process/start", {
                repoId: "repo-1",
                definitionId: "openade.toml::Outside",
                clientRequestId: "phone-process-outside",
            })
        ).toMatchObject({ id: 36, error: expect.objectContaining({ code: "handler_error" }) })

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
        expect(await runtimeRequest(socket, 2, "openade/repo/create", {
            repoId: "repo-phone",
            name: "Phone Created Repo",
            path: path.join(checkpointDir, "phone-repo"),
            createdBy: { id: "phone", email: "phone@example.com" },
            createdAt: "2026-05-31T00:10:00.000Z",
        })).toMatchObject({ id: 2, result: { repoId: "repo-phone", createdAt: "2026-05-31T00:10:00.000Z" } })
        expect(await runtimeRequest(socket, 3, "openade/repo/update", {
            repoId: "repo-phone",
            name: "Phone Updated Repo",
            archived: true,
            updatedAt: "2026-05-31T00:11:00.000Z",
        })).toMatchObject({ id: 3, result: null })
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

        expect(await runtimeRequest(socket, 8, "openade/comment/delete", {
            taskId: "task-1",
            commentId: "comment-phone",
            updatedAt: "2026-05-31T00:15:00.000Z",
        })).toMatchObject({ id: 8, result: null })
        expect(await runtimeRequest(socket, 9, "openade/task/delete", {
            repoId: "repo-1",
            taskId: "task-1",
            options: { deleteSnapshots: false, deleteImages: false, deleteSessions: false, deleteWorktrees: false },
        })).toMatchObject({ id: 9, result: { repoId: "repo-1", taskId: "task-1", deleted: true } })
        expect(await runtimeRequest(socket, 10, "openade/repo/delete", { repoId: "repo-phone" })).toMatchObject({ id: 10, result: null })

        const snapshot = runtimeResult<{ repos: Array<{ id: string; tasks: Array<{ id: string }> }> }>(
            await runtimeRequest(socket, 11, "openade/snapshot/read"),
            11
        )
        expect(snapshot.repos.map((repo) => repo.id)).not.toContain("repo-phone")
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

        getRuntimeServer().notify("runtime/updated", {
            runtimeId: "runtime-secret",
            kind: "process",
            status: "running",
            scope: { ownerType: "process", ownerId: "secret-process", rootPath: os.tmpdir() },
            startedAt: "2026-05-27T00:00:00.000Z",
            updatedAt: "2026-05-27T00:00:00.000Z",
            lastActivityAt: "2026-05-27T00:00:00.000Z",
        })
        getRuntimeServer().notify("process/output", { processId: "secret-process", output: "hidden" })
        getRuntimeServer().notify("openade/task/updated", { repoId: "repo-1", taskId: "task-1" })

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
