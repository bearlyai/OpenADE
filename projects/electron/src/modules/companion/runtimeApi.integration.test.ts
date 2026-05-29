import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WebSocket, type RawData } from "ws"
import { type RuntimeMessage } from "../../../../runtime-protocol/src"
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

interface TestServer {
    baseUrl: string
    server: http.Server
    runtimeSocket: RuntimeSocketServer
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

function nextMessage(socket: WebSocket): Promise<RuntimeMessage> {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            socket.off("message", onMessage)
            socket.off("error", onError)
        }
        const onMessage = (data: RawData) => {
            try {
                cleanup()
                resolve(JSON.parse(String(data)) as RuntimeMessage)
            } catch (error) {
                cleanup()
                reject(error)
            }
        }
        const onError = (error: Error) => {
            cleanup()
            reject(error)
        }
        socket.on("message", onMessage)
        socket.on("error", onError)
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
                    methods: expect.arrayContaining(["openade/snapshot/read", "openade/turn/start", "remote/device/selfRevoke"]),
                },
            },
        })
        const methods = (initialized as { result: { capabilities: { methods: string[] } } }).result.capabilities.methods
        expect(methods).not.toEqual(expect.arrayContaining(["runtime/list", "runtime/read", "runtime/reconcile", "process/list"]))

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
        expect(statusMethods).not.toEqual(expect.arrayContaining(["runtime/list", "runtime/read", "process/list", "host/platform/info"]))

        const deniedMethods: Array<[number, string, unknown?]> = [
            [2, "runtime/list"],
            [3, "runtime/read", { runtimeId: "runtime-1" }],
            [4, "runtime/reconcile", { runtimeId: "runtime-1" }],
            [5, "process/list"],
            [6, "agent/execution/start", { executionId: "blocked" }],
            [7, "agent/provider/connect", { providerId: "codex-server" }],
            [8, "openade/action/create", { taskId: "task-1" }],
            [9, "openade/action/reconcileRuntime", { taskId: "task-1", eventId: "event-1", status: "failed" }],
            [10, "openade/repo/delete", { repoId: "repo-1" }],
            [11, "openade/task/delete", { repoId: "repo-1", taskId: "task-1" }],
            [12, "openade/task/metadata/update", { taskId: "task-1", patch: { title: "remote edit" } }],
            [13, "fs/path/describe", { path: os.tmpdir(), readContents: false }],
            [14, "fs/file/write", { path: path.join(os.tmpdir(), "blocked.txt"), content: "blocked" }],
            [15, "fs/path/remove", { path: path.join(os.tmpdir(), "blocked.txt"), force: true }],
            [16, "process/command/start", { cmd: process.execPath, args: ["-e", "console.log('blocked')"], cwd: os.tmpdir() }],
            [17, "process/script/start", { script: "echo blocked", cwd: os.tmpdir() }],
            [18, "pty/spawn", { ptyId: "blocked-pty", cwd: os.tmpdir(), cols: 80, rows: 24 }],
            [19, "git/status/read", { repoDir: os.tmpdir() }],
            [20, "git/worktree/commit", { worktreePath: os.tmpdir(), message: "blocked" }],
            [21, "data/yjs/read", { id: "code:repos" }],
            [22, "host/platform/info"],
            [23, "snapshot/bundle/save", { id: "snapshot-1", patch: "", index: { files: [] } }],
        ]
        for (const [id, method, params] of deniedMethods) {
            await expectDenied(socket, id, method, params)
        }

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
