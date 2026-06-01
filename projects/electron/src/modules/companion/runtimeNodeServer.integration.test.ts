import { afterEach, describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { once } from "node:events"
import fs from "node:fs/promises"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { WebSocket, WebSocketServer } from "ws"
import * as Y from "yjs"
import { registerRuntimeNodeOpenADEModule } from "../../../../openade-module/src/node"
import { RuntimeServer } from "../../../../runtime/src"
import {
    createRuntimeNodeCheckpointStore,
    serveRuntimeNodeHttp,
    startRuntimeNodeServe,
    type RuntimeNodeAgentExecutor,
} from "../../../../runtime-node/src"

const servers: Array<{ close: () => Promise<void> }> = []
const tmpDirs: string[] = []
const sockets: WebSocket[] = []

type RequestRecord = {
    id?: string | number
    method?: string
    params?: unknown
    result?: unknown
    error?: unknown
}

const OPENADE_PRODUCT_METHOD_SEGMENTS = new Set(["do", "ask", "plan", "run", "run_plan", "review", "revise", "hyperplan"])

function expectNoOpenADEProductMethodSegments(methods: string[]): void {
    expect(methods.filter((method) => method.split("/").some((segment) => OPENADE_PRODUCT_METHOD_SEGMENTS.has(segment)))).toEqual([])
}

function expectedTaskId(repoId: string, clientRequestId: string): string {
    return `task-${createHash("sha256").update(repoId).update("\0").update(clientRequestId).digest("hex").slice(0, 26)}`
}

function waitForOpen(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        socket.once("open", () => resolve())
        socket.once("error", reject)
    })
}

function waitForRejected(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        socket.once("error", () => resolve())
        socket.once("open", () => reject(new Error("socket unexpectedly opened")))
    })
}

function closeSocket(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
    return new Promise((resolve) => {
        const timeout = setTimeout(() => onDone(), 1000)
        timeout.unref?.()
        const onDone = () => {
            clearTimeout(timeout)
            socket.off("close", onDone)
            socket.off("error", onDone)
            resolve()
        }
        socket.once("close", onDone)
        socket.once("error", onDone)
        socket.terminate()
    })
}

function nextJson(socket: WebSocket): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            socket.off("message", onMessage)
            socket.off("error", onError)
            socket.off("close", onClose)
        }
        const onMessage = (data: Buffer) => {
            cleanup()
            try {
                resolve(JSON.parse(data.toString("utf8")))
            } catch (error) {
                reject(error)
            }
        }
        const onError = (error: Error) => {
            cleanup()
            reject(error)
        }
        const onClose = () => {
            cleanup()
            reject(new Error("socket closed before message"))
        }
        socket.once("message", onMessage)
        socket.once("error", onError)
        socket.once("close", onClose)
    })
}

class SocketInbox {
    private readonly queue: unknown[] = []
    private readonly waiters: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = []

    constructor(socket: WebSocket) {
        socket.on("message", (data) => {
            let parsed: unknown
            try {
                parsed = JSON.parse(data.toString("utf8"))
            } catch (error) {
                this.reject(error instanceof Error ? error : new Error(String(error)))
                return
            }
            const waiter = this.waiters.shift()
            if (waiter) waiter.resolve(parsed)
            else this.queue.push(parsed)
        })
        socket.on("error", (error) => this.reject(error instanceof Error ? error : new Error(String(error))))
        socket.on("close", () => this.reject(new Error("socket closed before message")))
    }

    nextJson(): Promise<unknown> {
        const queued = this.queue.shift()
        if (queued !== undefined) return Promise.resolve(queued)
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
    }

    private reject(error: Error): void {
        for (const waiter of this.waiters.splice(0)) waiter.reject(error)
    }
}

async function readResponse(source: WebSocket | SocketInbox, id: number, notifications: unknown[] = []): Promise<unknown> {
    return Promise.race([
        (async () => {
            while (true) {
                const message = source instanceof WebSocket ? await nextJson(source) : await source.nextJson()
                if (typeof message === "object" && message !== null && "id" in message && (message as { id?: unknown }).id === id) return message
                notifications.push(message)
            }
        })(),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`timed out waiting for response ${id}`)), 5000)),
    ])
}

async function readNotification(source: SocketInbox, method: string, notifications: unknown[] = []): Promise<unknown> {
    return Promise.race([
        (async () => {
            while (true) {
                const message = await source.nextJson()
                if (typeof message === "object" && message !== null && (message as { method?: unknown }).method === method) return message
                notifications.push(message)
            }
        })(),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`timed out waiting for notification ${method}`)), 5000)),
    ])
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function terminalRuntimeNotifications(messages: unknown[], runtimeId: string): unknown[] {
    return messages.filter((message) => {
        if (typeof message !== "object" || message === null) return false
        const record = message as { method?: unknown; params?: { runtimeId?: unknown } }
        return (
            (record.method === "runtime/completed" || record.method === "runtime/failed" || record.method === "runtime/stopped") &&
            record.params?.runtimeId === runtimeId
        )
    })
}

function runtimeConnection() {
    return {
        id: "test",
        send() {},
    }
}

async function startCodexAppServerMock(handle: (request: RequestRecord, socket: WebSocket) => void): Promise<{ url: string; close(): Promise<void> }> {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    await once(server, "listening")
    const address = server.address() as AddressInfo

    server.on("connection", (socket) => {
        socket.on("message", (data) => {
            handle(JSON.parse(data.toString("utf8")) as RequestRecord, socket)
        })
    })

    return {
        url: `ws://127.0.0.1:${address.port}`,
        async close() {
            for (const client of server.clients) client.terminate()
            await new Promise<void>((resolve) => server.close(() => resolve()))
        },
    }
}

function fakeAgentExecutor(options: { stopWhenExecutionIdIncludes?: string; holdOpen?: boolean; onInterrupt?: (executionId: string) => void } = {}): RuntimeNodeAgentExecutor {
    return {
        providers: () => [
            {
                providerId: "claude-code",
                label: "Fake Claude Code",
                kind: "process",
                capabilities: {
                    execution: true,
                    streaming: true,
                    sessions: true,
                    steering: false,
                    interrupt: true,
                    goals: false,
                    approvals: false,
                    filesystem: true,
                    processExec: false,
                },
            },
        ],
        async status() {
            return {
                installed: true,
                authenticated: true,
                authType: "none",
            }
        },
        async start(params, callbacks) {
            queueMicrotask(() => {
                callbacks?.onSpawn?.({
                    executionId: params.executionId,
                    pid: process.pid,
                    pgid: process.platform === "win32" ? undefined : process.pid,
                    processLabel: params.processLabel,
                    processStartedAt: new Date().toISOString(),
                })
                callbacks?.onEvent?.({
                    id: "event-session",
                    direction: "execution",
                    executionId: params.executionId,
                    harnessId: params.harnessId,
                    type: "session_started",
                    sessionId: "session-headless",
                })
                if (options.holdOpen) return
                if (options.stopWhenExecutionIdIncludes && params.executionId.includes(options.stopWhenExecutionIdIncludes)) {
                    callbacks?.onSettled?.({ executionId: params.executionId, status: "stopped", sessionId: "session-headless" })
                    return
                }
                callbacks?.onEvent?.({
                    id: "event-message",
                    direction: "execution",
                    executionId: params.executionId,
                    harnessId: params.harnessId,
                    type: "raw_message",
                    message: { type: "result", result: "done from fake agent" },
                })
                callbacks?.onEvent?.({
                    id: "event-complete",
                    direction: "execution",
                    executionId: params.executionId,
                    harnessId: params.harnessId,
                    type: "complete",
                })
                callbacks?.onSettled?.({ executionId: params.executionId, status: "completed", sessionId: "session-headless" })
            })
            return { ok: true }
        },
        interrupt(executionId) {
            options.onInterrupt?.(executionId)
            return { ok: true }
        },
    }
}

describe("runtime-node WebSocket server", () => {
    afterEach(async () => {
        await Promise.all(sockets.splice(0).map((socket) => closeSocket(socket)))
        await Promise.all(servers.splice(0).map((server) => server.close()))
        await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
    })

    it("serves a RuntimeServer over a real WebSocket outside Electron", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        runtime.register("test/ping", () => ({ pong: true }))

        const server = await serveRuntimeNodeHttp({ runtime, token: "secret", heartbeatMs: 5_000 })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(nextJson(socket)).resolves.toMatchObject({
            id: 1,
            result: {
                protocolVersion: 1,
                serverName: "test-runtime",
            },
        })

        socket.send(JSON.stringify({ id: 2, method: "test/ping" }))
        await expect(nextJson(socket)).resolves.toEqual({ id: 2, result: { pong: true } })

        socket.close()
    })

    it("replays retained notifications by cursor over the real WebSocket API", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        runtime.registerNotification("test/changed")

        const server = await serveRuntimeNodeHttp({ runtime, token: "secret", heartbeatMs: 5_000 })
        servers.push(server)

        runtime.notify("test/changed", { value: 1 })
        runtime.notify("test/changed", { value: 2 })

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1)).resolves.toMatchObject({ id: 1, result: expect.objectContaining({ protocolVersion: 1 }) })

        socket.send(JSON.stringify({ id: 2, method: "subscription/update", params: { methods: ["test/changed"], cursor: "1" } }))

        await expect(inbox.nextJson()).resolves.toMatchObject({
            method: "test/changed",
            params: { value: 2 },
            cursor: "2",
        })
        await expect(readResponse(inbox, 2)).resolves.toMatchObject({ id: 2, result: { ok: true } })
    })

    it("reports lag over WebSocket when replay cursor fell out of retention", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime", notificationLogSize: 1 })
        runtime.registerNotification("test/changed")

        const server = await serveRuntimeNodeHttp({ runtime, token: "secret", heartbeatMs: 5_000 })
        servers.push(server)

        runtime.notify("test/changed", { value: 1 })
        runtime.notify("test/changed", { value: 2 })

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1)).resolves.toMatchObject({ id: 1, result: expect.objectContaining({ protocolVersion: 1 }) })

        socket.send(JSON.stringify({ id: 2, method: "subscription/update", params: { methods: ["test/changed"], cursor: "0" } }))

        await expect(inbox.nextJson()).resolves.toMatchObject({
            method: "connection/lagged",
            params: {
                requestedCursor: "0",
                oldestCursor: "2",
            },
        })
        await expect(inbox.nextJson()).resolves.toMatchObject({
            method: "test/changed",
            params: { value: 2 },
            cursor: "2",
        })
        await expect(readResponse(inbox, 2)).resolves.toMatchObject({ id: 2, result: { ok: true } })
    })

    it("closes sockets that exceed the configured buffered-send threshold", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const server = await serveRuntimeNodeHttp({ runtime, token: "secret", heartbeatMs: 5_000, maxBufferedBytes: -1 })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        const [code, reason] = (await once(socket, "close")) as [number, Buffer]

        expect(code).toBe(1013)
        expect(reason.toString("utf8")).toBe("client is too far behind")
    })

    it("rejects unauthorized sockets when a token is configured", async () => {
        const server = await serveRuntimeNodeHttp({ token: "secret", heartbeatMs: 5_000 })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.wrong"])
        sockets.push(socket)
        await expect(waitForRejected(socket)).resolves.toBeUndefined()
    })

    it("does not accept runtime tokens in the WebSocket URL query string", async () => {
        const server = await serveRuntimeNodeHttp({ token: "secret", heartbeatMs: 5_000 })
        servers.push(server)

        const url = new URL(server.url)
        url.searchParams.set("token", "secret")
        const socket = new WebSocket(url.toString())
        sockets.push(socket)
        await expect(waitForRejected(socket)).resolves.toBeUndefined()
    })

    it("retains clientRequestId results across token-authenticated reconnects", async () => {
        const runtime = new RuntimeServer({ serverName: "token-principal-runtime" })
        let count = 0
        runtime.register("test/start", () => {
            count += 1
            return { count }
        })
        const server = await serveRuntimeNodeHttp({ runtime, token: "secret", heartbeatMs: 5_000 })
        servers.push(server)

        const first = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(first)
        await waitForOpen(first)
        const firstInbox = new SocketInbox(first)
        first.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(firstInbox, 1)).resolves.toMatchObject({ id: 1, result: { serverName: "token-principal-runtime" } })
        first.send(JSON.stringify({ id: 2, method: "test/start", params: { clientRequestId: "same-request" } }))
        await expect(readResponse(firstInbox, 2)).resolves.toMatchObject({ id: 2, result: { count: 1 } })
        first.close()
        await once(first, "close")

        const second = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(second)
        await waitForOpen(second)
        const secondInbox = new SocketInbox(second)
        second.send(JSON.stringify({ id: 3, method: "initialize" }))
        await expect(readResponse(secondInbox, 3)).resolves.toMatchObject({ id: 3, result: { serverName: "token-principal-runtime" } })
        second.send(JSON.stringify({ id: 4, method: "test/start", params: { clientRequestId: "same-request" } }))
        await expect(readResponse(secondInbox, 4)).resolves.toMatchObject({ id: 4, result: { count: 1 } })
        expect(count).toBe(1)
    })

    it("starts the headless server with concrete filesystem, watcher, process, and PTY host adapters", async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "openade-runtime-node-host-"))
        tmpDirs.push(workspace)
        await fs.writeFile(path.join(workspace, "note.txt"), "hello runtime\n", "utf8")

        const server = await startRuntimeNodeServe({
            token: "secret",
            checkpointFile: path.join(workspace, "checkpoint.json"),
        })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)
        const notifications: unknown[] = []

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        const initialize = await readResponse(inbox, 1, notifications)
        expect(initialize).toMatchObject({
            id: 1,
            result: {
                capabilities: {
                    methods: expect.arrayContaining([
                        "fs/path/describe",
                        "fs/file/read",
                        "fs/file/write",
                        "fs/directory/create",
                        "fs/path/copy",
                        "fs/path/remove",
                        "fs/watch/start",
                        "fs/watch/list",
                        "fs/watch/stop",
                        "git/repo/init",
                        "git/directory/read",
                        "process/command/start",
                        "pty/spawn",
                    ]),
                },
            },
        })
        expectNoOpenADEProductMethodSegments((initialize as { result: { capabilities: { methods: string[] } } }).result.capabilities.methods)

        socket.send(JSON.stringify({ id: 2, method: "fs/path/describe", params: { path: path.join(workspace, "note.txt"), readContents: true } }))
        await expect(readResponse(inbox, 2, notifications)).resolves.toMatchObject({
            id: 2,
            result: { type: "file", content: "hello runtime\n" },
        })

        const createdDir = path.join(workspace, "created")
        const createdFile = path.join(createdDir, "runtime.txt")
        socket.send(JSON.stringify({ id: 3, method: "fs/directory/create", params: { path: createdDir, recursive: true, clientRequestId: "mkdir-1" } }))
        await expect(readResponse(inbox, 3, notifications)).resolves.toMatchObject({ id: 3, result: { ok: true, path: createdDir } })

        socket.send(
            JSON.stringify({
                id: 4,
                method: "fs/file/write",
                params: { path: createdFile, content: "created over runtime\n", encoding: "utf8", clientRequestId: "write-1" },
            })
        )
        await expect(readResponse(inbox, 4, notifications)).resolves.toMatchObject({ id: 4, result: { ok: true, path: createdFile, encoding: "utf8" } })

        socket.send(JSON.stringify({ id: 5, method: "fs/file/read", params: { path: createdFile, encoding: "utf8" } }))
        await expect(readResponse(inbox, 5, notifications)).resolves.toMatchObject({
            id: 5,
            result: { type: "file", content: "created over runtime\n", encoding: "utf8", tooLarge: false },
        })

        const copiedFile = path.join(workspace, "copied.txt")
        socket.send(JSON.stringify({ id: 6, method: "fs/path/copy", params: { from: createdFile, to: copiedFile, clientRequestId: "copy-1" } }))
        await expect(readResponse(inbox, 6, notifications)).resolves.toMatchObject({ id: 6, result: { ok: true, from: createdFile, to: copiedFile } })

        socket.send(JSON.stringify({ id: 7, method: "fs/path/remove", params: { path: copiedFile, clientRequestId: "remove-1" } }))
        await expect(readResponse(inbox, 7, notifications)).resolves.toMatchObject({ id: 7, result: { ok: true, path: copiedFile } })
        await expect(fs.stat(copiedFile)).rejects.toMatchObject({ code: "ENOENT" })

        socket.send(JSON.stringify({ id: 8, method: "process/command/start", params: { cmd: process.execPath, args: ["-e", "console.log('host adapter ok')"], cwd: workspace } }))
        const started = await readResponse(inbox, 8, notifications)
        expect(started).toMatchObject({ id: 8, result: { processId: expect.any(String), runtimeId: expect.stringMatching(/^process:/) } })
        await expect(readNotification(inbox, "process/exit", notifications)).resolves.toMatchObject({
            method: "process/exit",
            params: { exitCode: 0 },
        })

        socket.send(JSON.stringify({ id: 9, method: "git/repo/init", params: { directory: workspace } }))
        await expect(readResponse(inbox, 9, notifications)).resolves.toMatchObject({
            id: 9,
            result: { success: true },
        })

        socket.send(JSON.stringify({ id: 10, method: "git/directory/read", params: { directory: workspace } }))
        const realWorkspace = await fs.realpath(workspace)
        await expect(readResponse(inbox, 10, notifications)).resolves.toMatchObject({
            id: 10,
            result: { isGitDirectory: true, repoRoot: realWorkspace },
        })

        socket.send(JSON.stringify({ id: 11, method: "pty/spawn", params: { ptyId: "test-pty", cwd: workspace, cols: 80, rows: 24 } }))
        await expect(readResponse(inbox, 11, notifications)).resolves.toMatchObject({
            id: 11,
            result: { ok: true, ptyId: "test-pty", runtimeId: "pty:test-pty" },
        })

        socket.send(
            JSON.stringify({ id: 12, method: "pty/write", params: { ptyId: "test-pty", data: Buffer.from("echo pty-adapter-ok\nexit\n", "utf8").toString("base64") } })
        )
        await expect(readResponse(inbox, 12, notifications)).resolves.toMatchObject({ id: 12, result: { ok: true } })

        await expect(readNotification(inbox, "pty/exit", notifications)).resolves.toMatchObject({
            method: "pty/exit",
            params: { ptyId: "test-pty", exitCode: 0 },
        })
        socket.send(JSON.stringify({ id: 13, method: "pty/reconnect", params: { ptyId: "test-pty" } }))
        const reconnectedPty = (await readResponse(inbox, 13, notifications)) as { result: { output: Array<{ data: string }> } }
        const ptyOutput = reconnectedPty.result.output.map((chunk) => Buffer.from(chunk.data, "base64").toString("utf8")).join("")
        expect(ptyOutput).toContain("pty-adapter-ok")
    })

    it("publishes terminal runtime state when killing all headless processes", async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "openade-runtime-node-kill-all-"))
        tmpDirs.push(workspace)

        const server = await startRuntimeNodeServe({
            token: "secret",
            checkpointFile: path.join(workspace, "checkpoint.json"),
        })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)
        const notifications: unknown[] = []

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1, notifications)).resolves.toMatchObject({ id: 1, result: { serverName: "runtime-node" } })

        socket.send(
            JSON.stringify({
                id: 2,
                method: "process/command/start",
                params: {
                    cmd: process.execPath,
                    args: ["-e", "setInterval(() => {}, 1000)"],
                    cwd: workspace,
                },
            })
        )
        const started = (await readResponse(inbox, 2, notifications)) as { result: { runtimeId: string; processId: string } }

        socket.send(JSON.stringify({ id: 3, method: "process/killAll" }))
        const killNotifications: unknown[] = []
        await expect(readResponse(inbox, 3, killNotifications)).resolves.toMatchObject({ id: 3, result: { ok: true } })

        expect(killNotifications).toContainEqual(
            expect.objectContaining({
                method: "runtime/stopped",
                params: expect.objectContaining({ runtimeId: started.result.runtimeId, status: "stopped" }),
            })
        )
        expect(killNotifications).toContainEqual(
            expect.objectContaining({
                method: "process/exit",
                params: expect.objectContaining({ processId: started.result.processId, signal: "SIGKILL" }),
            })
        )
    })

    it("does not publish duplicate terminal runtime state after directly killing a headless process", async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "openade-runtime-node-kill-"))
        tmpDirs.push(workspace)

        const server = await startRuntimeNodeServe({
            token: "secret",
            checkpointFile: path.join(workspace, "checkpoint.json"),
        })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)
        const notifications: unknown[] = []

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1, notifications)).resolves.toMatchObject({ id: 1, result: { serverName: "runtime-node" } })

        socket.send(
            JSON.stringify({
                id: 2,
                method: "process/command/start",
                params: {
                    cmd: process.execPath,
                    args: ["-e", "setInterval(() => {}, 1000)"],
                    cwd: workspace,
                },
            })
        )
        const started = (await readResponse(inbox, 2, notifications)) as { result: { runtimeId: string; processId: string } }

        socket.send(JSON.stringify({ id: 3, method: "process/kill", params: { processId: started.result.processId } }))
        const killNotifications: unknown[] = []
        await expect(readResponse(inbox, 3, killNotifications)).resolves.toMatchObject({ id: 3, result: { ok: true } })

        const exitNotifications: unknown[] = []
        await expect(readNotification(inbox, "process/exit", exitNotifications)).resolves.toMatchObject({
            method: "process/exit",
            params: expect.objectContaining({ processId: started.result.processId }),
        })

        await delay(100)
        socket.send(JSON.stringify({ id: 4, method: "runtime/read", params: { runtimeId: started.result.runtimeId } }))
        const laterNotifications: unknown[] = []
        await expect(readResponse(inbox, 4, laterNotifications)).resolves.toMatchObject({
            id: 4,
            result: expect.objectContaining({ runtimeId: started.result.runtimeId, status: "stopped" }),
        })

        expect(terminalRuntimeNotifications([...killNotifications, ...exitNotifications, ...laterNotifications], started.result.runtimeId)).toHaveLength(1)
    })

    it("does not publish duplicate terminal runtime state after runtime/stop kills a headless process", async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "openade-runtime-node-runtime-stop-"))
        tmpDirs.push(workspace)

        const server = await startRuntimeNodeServe({
            token: "secret",
            checkpointFile: path.join(workspace, "checkpoint.json"),
        })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)
        const notifications: unknown[] = []

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1, notifications)).resolves.toMatchObject({ id: 1, result: { serverName: "runtime-node" } })

        socket.send(
            JSON.stringify({
                id: 2,
                method: "process/command/start",
                params: {
                    cmd: process.execPath,
                    args: ["-e", "setInterval(() => {}, 1000)"],
                    cwd: workspace,
                },
            })
        )
        const started = (await readResponse(inbox, 2, notifications)) as { result: { runtimeId: string; processId: string } }

        socket.send(JSON.stringify({ id: 3, method: "runtime/stop", params: { runtimeId: started.result.runtimeId, reason: "test stop" } }))
        const stopNotifications: unknown[] = []
        await expect(readResponse(inbox, 3, stopNotifications)).resolves.toMatchObject({
            id: 3,
            result: expect.objectContaining({ runtimeId: started.result.runtimeId, status: "stopped", error: "test stop" }),
        })

        const exitNotifications: unknown[] = []
        await expect(readNotification(inbox, "process/exit", exitNotifications)).resolves.toMatchObject({
            method: "process/exit",
            params: expect.objectContaining({ processId: started.result.processId }),
        })

        await delay(100)
        socket.send(JSON.stringify({ id: 4, method: "runtime/read", params: { runtimeId: started.result.runtimeId } }))
        const laterNotifications: unknown[] = []
        await expect(readResponse(inbox, 4, laterNotifications)).resolves.toMatchObject({
            id: 4,
            result: expect.objectContaining({ runtimeId: started.result.runtimeId, status: "stopped" }),
        })

        expect(terminalRuntimeNotifications([...stopNotifications, ...exitNotifications, ...laterNotifications], started.result.runtimeId)).toHaveLength(1)
    })

    it("publishes stopped runtime state when killing all headless PTYs without later terminal churn", async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "openade-runtime-node-pty-kill-all-"))
        tmpDirs.push(workspace)

        const server = await startRuntimeNodeServe({
            token: "secret",
            checkpointFile: path.join(workspace, "checkpoint.json"),
        })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)
        const notifications: unknown[] = []

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1, notifications)).resolves.toMatchObject({ id: 1, result: { serverName: "runtime-node" } })

        socket.send(
            JSON.stringify({
                id: 2,
                method: "pty/spawn",
                params: {
                    ptyId: "test-pty",
                    cwd: workspace,
                },
            })
        )
        const started = (await readResponse(inbox, 2, notifications)) as { result: { runtimeId: string; ptyId: string } }

        socket.send(JSON.stringify({ id: 3, method: "pty/killAll" }))
        const killNotifications: unknown[] = []
        await expect(readResponse(inbox, 3, killNotifications)).resolves.toMatchObject({ id: 3, result: { ok: true } })

        expect(killNotifications).toContainEqual(
            expect.objectContaining({
                method: "runtime/stopped",
                params: expect.objectContaining({ runtimeId: started.result.runtimeId, status: "stopped" }),
            })
        )
        expect(killNotifications).toContainEqual(
            expect.objectContaining({
                method: "pty/killed",
                params: expect.objectContaining({ ptyId: started.result.ptyId }),
            })
        )

        await delay(100)
        socket.send(JSON.stringify({ id: 4, method: "runtime/read", params: { runtimeId: started.result.runtimeId } }))
        const laterNotifications: unknown[] = []
        await expect(readResponse(inbox, 4, laterNotifications)).resolves.toMatchObject({
            id: 4,
            result: expect.objectContaining({ runtimeId: started.result.runtimeId, status: "stopped" }),
        })
        expect(laterNotifications).not.toContainEqual(
            expect.objectContaining({
                method: expect.stringMatching(/^runtime\/(completed|failed)$/),
                params: expect.objectContaining({ runtimeId: started.result.runtimeId }),
            })
        )
    })

    it("does not publish duplicate terminal runtime state after directly killing a headless PTY", async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "openade-runtime-node-pty-kill-"))
        tmpDirs.push(workspace)

        const server = await startRuntimeNodeServe({
            token: "secret",
            checkpointFile: path.join(workspace, "checkpoint.json"),
        })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)
        const notifications: unknown[] = []

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1, notifications)).resolves.toMatchObject({ id: 1, result: { serverName: "runtime-node" } })

        socket.send(JSON.stringify({ id: 2, method: "pty/spawn", params: { ptyId: "direct-kill-pty", cwd: workspace } }))
        const started = (await readResponse(inbox, 2, notifications)) as { result: { runtimeId: string; ptyId: string } }

        socket.send(JSON.stringify({ id: 3, method: "pty/kill", params: { ptyId: started.result.ptyId } }))
        const killNotifications: unknown[] = []
        await expect(readResponse(inbox, 3, killNotifications)).resolves.toMatchObject({ id: 3, result: { ok: true } })

        await delay(100)
        socket.send(JSON.stringify({ id: 4, method: "runtime/read", params: { runtimeId: started.result.runtimeId } }))
        const laterNotifications: unknown[] = []
        await expect(readResponse(inbox, 4, laterNotifications)).resolves.toMatchObject({
            id: 4,
            result: expect.objectContaining({ runtimeId: started.result.runtimeId, status: "stopped" }),
        })

        expect(killNotifications).toContainEqual(
            expect.objectContaining({
                method: "pty/killed",
                params: expect.objectContaining({ ptyId: started.result.ptyId }),
            })
        )
        expect(terminalRuntimeNotifications([...killNotifications, ...laterNotifications], started.result.runtimeId)).toHaveLength(1)
    })

    it("does not publish duplicate terminal runtime state after runtime/stop kills a headless PTY", async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "openade-runtime-node-pty-runtime-stop-"))
        tmpDirs.push(workspace)

        const server = await startRuntimeNodeServe({
            token: "secret",
            checkpointFile: path.join(workspace, "checkpoint.json"),
        })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)
        const notifications: unknown[] = []

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1, notifications)).resolves.toMatchObject({ id: 1, result: { serverName: "runtime-node" } })

        socket.send(JSON.stringify({ id: 2, method: "pty/spawn", params: { ptyId: "runtime-stop-pty", cwd: workspace } }))
        const started = (await readResponse(inbox, 2, notifications)) as { result: { runtimeId: string; ptyId: string } }

        socket.send(JSON.stringify({ id: 3, method: "runtime/stop", params: { runtimeId: started.result.runtimeId, reason: "test stop" } }))
        const stopNotifications: unknown[] = []
        await expect(readResponse(inbox, 3, stopNotifications)).resolves.toMatchObject({
            id: 3,
            result: expect.objectContaining({ runtimeId: started.result.runtimeId, status: "stopped" }),
        })

        await delay(100)
        socket.send(JSON.stringify({ id: 4, method: "runtime/read", params: { runtimeId: started.result.runtimeId } }))
        const laterNotifications: unknown[] = []
        await expect(readResponse(inbox, 4, laterNotifications)).resolves.toMatchObject({
            id: 4,
            result: expect.objectContaining({ runtimeId: started.result.runtimeId, status: "stopped" }),
        })

        expect(stopNotifications).toContainEqual(
            expect.objectContaining({
                method: "pty/killed",
                params: expect.objectContaining({ ptyId: started.result.ptyId }),
            })
        )
        expect(terminalRuntimeNotifications([...stopNotifications, ...laterNotifications], started.result.runtimeId)).toHaveLength(1)
    })

    it("keeps headless process adapter state isolated between server instances", async () => {
        const firstWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "openade-runtime-node-first-"))
        const secondWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "openade-runtime-node-second-"))
        tmpDirs.push(firstWorkspace, secondWorkspace)

        const firstServer = await startRuntimeNodeServe({
            token: "first-secret",
            checkpointFile: path.join(firstWorkspace, "checkpoint.json"),
        })
        const secondServer = await startRuntimeNodeServe({
            token: "second-secret",
            checkpointFile: path.join(secondWorkspace, "checkpoint.json"),
        })
        servers.push(firstServer, secondServer)

        const firstSocket = new WebSocket(firstServer.url, ["bearer.first-secret"])
        const secondSocket = new WebSocket(secondServer.url, ["bearer.second-secret"])
        sockets.push(firstSocket, secondSocket)
        await Promise.all([waitForOpen(firstSocket), waitForOpen(secondSocket)])
        const firstInbox = new SocketInbox(firstSocket)
        const secondInbox = new SocketInbox(secondSocket)
        const firstNotifications: unknown[] = []
        const secondNotifications: unknown[] = []

        firstSocket.send(JSON.stringify({ id: 1, method: "initialize" }))
        secondSocket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(firstInbox, 1, firstNotifications)).resolves.toMatchObject({ id: 1, result: { serverName: "runtime-node" } })
        await expect(readResponse(secondInbox, 1, secondNotifications)).resolves.toMatchObject({ id: 1, result: { serverName: "runtime-node" } })

        firstSocket.send(
            JSON.stringify({
                id: 2,
                method: "process/command/start",
                params: { cmd: process.execPath, args: ["-e", "setTimeout(() => {}, 3000)"], cwd: firstWorkspace },
            })
        )
        const processStarted = (await readResponse(firstInbox, 2, firstNotifications)) as { result: { processId: string } }
        expect(processStarted).toMatchObject({
            id: 2,
            result: { processId: expect.any(String), runtimeId: expect.stringMatching(/^process:/) },
        })

        secondSocket.send(JSON.stringify({ id: 3, method: "process/list" }))
        await expect(readResponse(secondInbox, 3, secondNotifications)).resolves.toEqual({
            id: 3,
            result: { processes: [] },
        })
        firstSocket.send(JSON.stringify({ id: 10, method: "process/kill", params: { processId: processStarted.result.processId } }))
        await expect(readResponse(firstInbox, 10, firstNotifications)).resolves.toMatchObject({ id: 10, result: { ok: true } })

    })

    it("routes generic server-protocol agent providers through runtime-node over real WebSockets", async () => {
        const codexRequests: RequestRecord[] = []
        const codexMock = await startCodexAppServerMock((request, socket) => {
            codexRequests.push(request)
            switch (request.method) {
                case "initialize":
                    socket.send(JSON.stringify({ id: request.id, result: { userAgent: "codex-app-server-test/1.0.0" } }))
                    break
                case "initialized":
                    break
                case "thread/start":
                    socket.send(JSON.stringify({ id: request.id, result: { thread: { id: "thread-1" } } }))
                    break
                case "turn/start":
                    socket.send(
                        JSON.stringify({
                            method: "item/agentMessage/delta",
                            params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "hello" },
                        })
                    )
                    socket.send(JSON.stringify({ id: request.id, result: { turn: { id: "turn-1" } } }))
                    break
                case "thread/goal/set": {
                    const params = typeof request.params === "object" && request.params !== null ? (request.params as Record<string, unknown>) : {}
                    socket.send(JSON.stringify({ id: request.id, result: { goal: { threadId: "thread-1", objective: params.objective ?? "Keep runtime generic", status: params.status ?? "active" } } }))
                    break
                }
                case "thread/goal/get":
                    socket.send(JSON.stringify({ id: request.id, result: { goal: { threadId: "thread-1", objective: "Keep runtime generic", status: "blocked" } } }))
                    break
                case "thread/goal/clear":
                    socket.send(JSON.stringify({ id: request.id, result: { cleared: true } }))
                    break
                default:
                    socket.send(JSON.stringify({ id: request.id, error: { code: -32601, message: `unknown ${request.method}` } }))
            }
        })
        servers.push(codexMock)

        const checkpointDir = await fs.mkdtemp(path.join(os.tmpdir(), "openade-runtime-node-checkpoint-"))
        tmpDirs.push(checkpointDir)
        const server = await startRuntimeNodeServe({
            token: "secret",
            checkpointFile: path.join(checkpointDir, "checkpoint.json"),
            codexAppServers: [
                {
                    providerId: "codex-server",
                    label: "Codex Server Protocol",
                    websocketUrl: codexMock.url,
                },
            ],
        })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)
        const notifications: unknown[] = []

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1, notifications)).resolves.toMatchObject({
            id: 1,
            result: {
                capabilities: {
                    agentProviders: expect.arrayContaining([
                        expect.objectContaining({
                            providerId: "claude-code",
                            kind: "process",
                        }),
                        expect.objectContaining({
                            providerId: "codex-server",
                            kind: "serverProtocol",
                            capabilities: expect.objectContaining({ goals: true, steering: true }),
                        }),
                    ]),
                },
            },
        })

        socket.send(JSON.stringify({ id: 2, method: "agent/provider/list" }))
        await expect(readResponse(inbox, 2, notifications)).resolves.toMatchObject({
            id: 2,
            result: expect.arrayContaining([
                expect.objectContaining({
                    providerId: "codex-server",
                    kind: "serverProtocol",
                }),
            ]),
        })

        socket.send(JSON.stringify({ id: 3, method: "agent/thread/start", params: { providerId: "codex-server", cwd: "/tmp/openade" } }))
        await expect(readResponse(inbox, 3, notifications)).resolves.toMatchObject({ id: 3, result: { thread: { id: "thread-1" } } })

        socket.send(JSON.stringify({ id: 4, method: "agent/turn/start", params: { providerId: "codex-server", threadId: "thread-1", input: "go" } }))
        await expect(readResponse(inbox, 4, notifications)).resolves.toMatchObject({ id: 4, result: { turn: { id: "turn-1" } } })
        socket.send(JSON.stringify({ id: 40, method: "runtime/list", params: { ownerType: "agent-server-turn", ownerId: "thread-1" } }))
        await expect(readResponse(inbox, 40, notifications)).resolves.toMatchObject({
            id: 40,
            result: [
                expect.objectContaining({
                    kind: "agent",
                    status: "running",
                    nativeId: "turn-1",
                    scope: expect.objectContaining({
                        ownerType: "agent-server-turn",
                        ownerId: "thread-1",
                        labels: expect.objectContaining({ providerId: "codex-server", turnId: "turn-1" }),
                    }),
                }),
            ],
        })

        socket.send(
            JSON.stringify({
                id: 5,
                method: "agent/goal/set",
                params: { providerId: "codex-server", threadId: "thread-1", objective: "Keep runtime generic", status: "active" },
            })
        )
        await expect(readResponse(inbox, 5, notifications)).resolves.toMatchObject({ id: 5, result: { goal: { threadId: "thread-1", status: "active" } } })

        socket.send(
            JSON.stringify({
                id: 6,
                method: "agent/goal/block",
                params: { providerId: "codex-server", threadId: "thread-1" },
            })
        )
        await expect(readResponse(inbox, 6, notifications)).resolves.toMatchObject({ id: 6, result: { goal: { threadId: "thread-1", status: "blocked" } } })

        socket.send(JSON.stringify({ id: 7, method: "agent/goal/get", params: { providerId: "codex-server", threadId: "thread-1" } }))
        await expect(readResponse(inbox, 7, notifications)).resolves.toMatchObject({ id: 7, result: { goal: { threadId: "thread-1", status: "blocked" } } })

        socket.send(JSON.stringify({ id: 8, method: "agent/goal/clear", params: { providerId: "codex-server", threadId: "thread-1" } }))
        await expect(readResponse(inbox, 8, notifications)).resolves.toMatchObject({ id: 8, result: { cleared: true } })

        expect(codexRequests.map((request) => request.method)).toEqual([
            "initialize",
            "initialized",
            "thread/start",
            "turn/start",
            "thread/goal/set",
            "thread/goal/set",
            "thread/goal/get",
            "thread/goal/clear",
        ])
        expect(codexRequests.find((request) => request.method === "turn/start")?.params).toMatchObject({
            threadId: "thread-1",
            input: [{ type: "text", text: "go" }],
        })
        expect(notifications).toContainEqual(
            expect.objectContaining({
                method: "agent/turn/delta",
                params: {
                    providerId: "codex-server",
                    method: "item/agentMessage/delta",
                    params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "hello" },
                },
            })
        )

        socket.close()
    })

    it("keeps server-protocol agent bridges scoped to their runtime server", async () => {
        const codexMock = await startCodexAppServerMock((request, socket) => {
            if (request.method === "initialize") {
                socket.send(JSON.stringify({ id: request.id, result: { userAgent: "codex-app-server-test/1.0.0" } }))
                return
            }
            if (request.method === "initialized") return
            socket.send(JSON.stringify({ id: request.id, result: {} }))
        })
        servers.push(codexMock)

        const firstCheckpointDir = await fs.mkdtemp(path.join(os.tmpdir(), "openade-runtime-node-bridge-first-"))
        const secondCheckpointDir = await fs.mkdtemp(path.join(os.tmpdir(), "openade-runtime-node-bridge-second-"))
        tmpDirs.push(firstCheckpointDir, secondCheckpointDir)

        const firstServer = await startRuntimeNodeServe({
            token: "first-secret",
            checkpointFile: path.join(firstCheckpointDir, "checkpoint.json"),
            codexAppServers: [
                {
                    providerId: "codex-server",
                    label: "Codex Server Protocol",
                    websocketUrl: codexMock.url,
                },
            ],
        })
        const secondServer = await startRuntimeNodeServe({
            token: "second-secret",
            checkpointFile: path.join(secondCheckpointDir, "checkpoint.json"),
        })
        servers.push(firstServer, secondServer)

        const firstSocket = new WebSocket(firstServer.url, ["bearer.first-secret"])
        const secondSocket = new WebSocket(secondServer.url, ["bearer.second-secret"])
        sockets.push(firstSocket, secondSocket)
        await Promise.all([waitForOpen(firstSocket), waitForOpen(secondSocket)])
        const firstInbox = new SocketInbox(firstSocket)
        const secondInbox = new SocketInbox(secondSocket)
        const firstNotifications: unknown[] = []
        const secondNotifications: unknown[] = []

        firstSocket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(firstInbox, 1, firstNotifications)).resolves.toMatchObject({
            id: 1,
            result: {
                capabilities: {
                    agentProviders: expect.arrayContaining([expect.objectContaining({ providerId: "codex-server", kind: "serverProtocol" })]),
                },
            },
        })

        secondSocket.send(JSON.stringify({ id: 1, method: "initialize" }))
        const secondInitialize = (await readResponse(secondInbox, 1, secondNotifications)) as { result: { capabilities: { agentProviders: Array<{ providerId: string }> } } }
        expect(secondInitialize.result.capabilities.agentProviders.map((provider) => provider.providerId)).not.toContain("codex-server")

        secondSocket.send(JSON.stringify({ id: 2, method: "agent/provider/status", params: { providerId: "codex-server" } }))
        await expect(readResponse(secondInbox, 2, secondNotifications)).resolves.toMatchObject({
            id: 2,
            result: { providerId: "codex-server", connected: false, state: "unavailable" },
        })
    })

    it("loads the OpenADE module in headless mode with file-backed Yjs data", async () => {
        const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-yjs-"))
        const checkpointDir = await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-checkpoint-"))
        tmpDirs.push(dataDir, checkpointDir)

        const runtime = new RuntimeServer({
            serverName: "headless-yjs-runtime",
            checkpointStore: createRuntimeNodeCheckpointStore(path.join(checkpointDir, "checkpoint.json")),
        })
        registerRuntimeNodeOpenADEModule(runtime, { dataDir, hostName: "headless-test" })
        const server = await serveRuntimeNodeHttp({ runtime, token: "secret" })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1)).resolves.toMatchObject({
            id: 1,
            result: {
                capabilities: {
                    methods: expect.arrayContaining(["data/yjs/read", "data/yjs/save", "openade/project/list", "openade/repo/create", "openade/snapshot/read"]),
                },
            },
        })

        socket.send(
            JSON.stringify({
                id: 2,
                method: "openade/repo/create",
                params: {
                    repoId: "repo-1",
                    name: "Headless Repo",
                    path: "/tmp/headless-repo",
                    createdBy: { id: "user-1", email: "user@example.com" },
                },
            })
        )
        await expect(readResponse(inbox, 2)).resolves.toMatchObject({ id: 2, result: { repoId: "repo-1" } })

        socket.send(JSON.stringify({ id: 3, method: "openade/project/list" }))
        await expect(readResponse(inbox, 3)).resolves.toMatchObject({
            id: 3,
            result: [expect.objectContaining({ id: "repo-1", name: "Headless Repo", path: "/tmp/headless-repo" })],
        })

        const doc = new Y.Doc()
        doc.getMap("headless").set("ok", true)
        const data = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64")
        doc.destroy()

        socket.send(JSON.stringify({ id: 4, method: "data/yjs/save", params: { id: "code:headless-test", data } }))
        await expect(readResponse(inbox, 4)).resolves.toEqual({ id: 4, result: null })

        socket.send(JSON.stringify({ id: 5, method: "data/yjs/read", params: { id: "code:headless-test" } }))
        await expect(readResponse(inbox, 5)).resolves.toMatchObject({ id: 5, result: { id: "code:headless-test", data: expect.any(String) } })

        socket.close()
    })

    it("starts a headless OpenADE turn over the real WebSocket runtime API", async () => {
        const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-turn-yjs-"))
        tmpDirs.push(dataDir)

        const runtime = new RuntimeServer({ serverName: "headless-turn-runtime" })
        registerRuntimeNodeOpenADEModule(runtime, {
            dataDir,
            hostName: "headless-test",
            agentExecutor: fakeAgentExecutor(),
        })
        const server = await serveRuntimeNodeHttp({ runtime, token: "secret", heartbeatMs: 5_000 })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1)).resolves.toMatchObject({
            id: 1,
            result: {
                capabilities: {
                    methods: expect.arrayContaining(["agent/execution/start", "openade/turn/start", "openade/task/read"]),
                },
            },
        })

        const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-turn-repo-"))
        tmpDirs.push(repoPath)
        socket.send(
            JSON.stringify({
                id: 2,
                method: "openade/repo/create",
                params: {
                    repoId: "repo-turn",
                    name: "Turn Repo",
                    path: repoPath,
                    createdBy: { id: "user-1", email: "user@example.com" },
                },
            })
        )
        await expect(readResponse(inbox, 2)).resolves.toMatchObject({ id: 2, result: { repoId: "repo-turn" } })

        socket.send(
            JSON.stringify({
                id: 3,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-turn",
                    type: "ask",
                    input: "what changed?",
                    harnessId: "claude-code",
                    clientRequestId: "turn-1",
                },
            })
        )
        const startResponse = (await readResponse(inbox, 3)) as { result: { taskId: string; eventId: string } }
        const expectedTurnTaskId = expectedTaskId("repo-turn", "turn-1")
        expect(startResponse).toMatchObject({ id: 3, result: { taskId: expectedTurnTaskId, eventId: expect.any(String) } })

        await new Promise((resolve) => setTimeout(resolve, 20))
        socket.send(JSON.stringify({ id: 4, method: "runtime/list", params: { ownerType: "openade-task", ownerId: startResponse.result.taskId } }))
        await expect(readResponse(inbox, 4)).resolves.toMatchObject({
            id: 4,
            result: [
                expect.objectContaining({
                    pid: process.pid,
                    pgid: process.platform === "win32" ? undefined : process.pid,
                    processLabel: `OpenADE ${startResponse.result.taskId}`,
                }),
            ],
        })

        let taskResponse:
            | {
                  result?: {
                      id?: string
                      events?: Array<{
                          id?: string
                          status?: string
                          execution?: { sessionId?: string; events?: Array<{ id?: string; type?: string }> }
                      }>
                  }
              }
            | undefined
        for (let attempt = 0; attempt < 20; attempt++) {
            socket.send(JSON.stringify({ id: 50 + attempt, method: "openade/task/read", params: { repoId: "repo-turn", taskId: startResponse.result.taskId } }))
            taskResponse = (await readResponse(inbox, 50 + attempt)) as typeof taskResponse
            const action = taskResponse?.result?.events?.find((event) => event.id === startResponse.result.eventId)
            if (action?.status === "completed" && action.execution?.events?.some((event) => event.id === "event-complete")) break
            await delay(25)
        }

        expect(taskResponse).toMatchObject({
            result: {
                id: expectedTurnTaskId,
                events: [
                    expect.objectContaining({
                        id: startResponse.result.eventId,
                        status: "completed",
                        execution: expect.objectContaining({
                            sessionId: "session-headless",
                            events: expect.arrayContaining([
                                expect.objectContaining({ id: "event-session", type: "session_started" }),
                                expect.objectContaining({ id: "event-message", type: "raw_message" }),
                                expect.objectContaining({ id: "event-complete", type: "complete" }),
                            ]),
                        }),
                    }),
                ],
            },
        })

        socket.close()
    })

    it("stops a headless OpenADE turn through runtime/stop and persists stopped task state", async () => {
        const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-stop-yjs-"))
        tmpDirs.push(dataDir)
        const interrupted: string[] = []

        const runtime = new RuntimeServer({ serverName: "headless-stop-runtime" })
        registerRuntimeNodeOpenADEModule(runtime, {
            dataDir,
            hostName: "headless-test",
            agentExecutor: fakeAgentExecutor({ holdOpen: true, onInterrupt: (executionId) => interrupted.push(executionId) }),
        })
        const server = await serveRuntimeNodeHttp({ runtime, token: "secret", heartbeatMs: 5_000 })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1)).resolves.toMatchObject({ id: 1, result: { serverName: "headless-stop-runtime" } })

        const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-stop-repo-"))
        tmpDirs.push(repoPath)
        socket.send(
            JSON.stringify({
                id: 2,
                method: "openade/repo/create",
                params: {
                    repoId: "repo-stop",
                    name: "Stop Repo",
                    path: repoPath,
                    createdBy: { id: "user-1", email: "user@example.com" },
                },
            })
        )
        await expect(readResponse(inbox, 2)).resolves.toMatchObject({ id: 2, result: { repoId: "repo-stop" } })

        socket.send(
            JSON.stringify({
                id: 3,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-stop",
                    type: "ask",
                    input: "keep running",
                    harnessId: "claude-code",
                    clientRequestId: "stop-turn-1",
                },
            })
        )
        const started = (await readResponse(inbox, 3)) as { result: { taskId: string; eventId: string } }
        await delay(20)

        socket.send(JSON.stringify({ id: 4, method: "runtime/list", params: { ownerType: "openade-task", ownerId: started.result.taskId } }))
        const listed = (await readResponse(inbox, 4)) as { result: Array<{ runtimeId: string }> }
        const runtimeId = listed.result[0]?.runtimeId

        socket.send(JSON.stringify({ id: 5, method: "runtime/stop", params: { runtimeId, reason: "user stop" } }))
        await expect(readResponse(inbox, 5)).resolves.toMatchObject({ id: 5, result: { runtimeId, status: "stopped" } })

        socket.send(JSON.stringify({ id: 6, method: "openade/task/read", params: { repoId: "repo-stop", taskId: started.result.taskId } }))
        await expect(readResponse(inbox, 6)).resolves.toMatchObject({
            id: 6,
            result: {
                id: started.result.taskId,
                events: [
                    expect.objectContaining({
                        id: started.result.eventId,
                        status: "stopped",
                    }),
                ],
            },
        })
        expect(interrupted).toEqual([expect.stringContaining(started.result.taskId)])

        socket.close()
    })

    it("reconciles checkpointed terminal OpenADE runtimes into task history on startup", async () => {
        const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-reconcile-yjs-"))
        const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-reconcile-repo-"))
        const checkpointPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-reconcile-checkpoint-")), "runtime.json")
        tmpDirs.push(dataDir, repoPath, path.dirname(checkpointPath))

        const firstRuntime = new RuntimeServer({ serverName: "headless-reconcile-seed" })
        registerRuntimeNodeOpenADEModule(firstRuntime, {
            dataDir,
            hostName: "headless-test",
            agentExecutor: fakeAgentExecutor({ holdOpen: true }),
        })
        const connection = runtimeConnection()
        await expect(
            firstRuntime.handleRequest(
                {
                    id: 1,
                    method: "openade/repo/create",
                    params: {
                        repoId: "repo-reconcile",
                        name: "Reconcile Repo",
                        path: repoPath,
                        createdBy: { id: "user-1", email: "user@example.com" },
                    },
                },
                connection
            )
        ).resolves.toMatchObject({ id: 1, result: { repoId: "repo-reconcile" } })
        const started = await firstRuntime.handleRequest(
            {
                id: 2,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-reconcile",
                    type: "ask",
                    input: "keep running until checkpoint",
                    harnessId: "claude-code",
                    clientRequestId: "reconcile-turn-1",
                },
            },
            connection
        )
        const { taskId, eventId } = started.result as { taskId: string; eventId: string }
        const [runtimeRecord] = firstRuntime.supervisor.list({ ownerType: "openade-task", ownerId: taskId })
        expect(runtimeRecord?.scope.labels).toMatchObject({ eventId })

        await fs.writeFile(
            checkpointPath,
            JSON.stringify(
                [
                    {
                        ...runtimeRecord,
                        status: "failed",
                        error: "Runtime process is no longer alive",
                        updatedAt: new Date().toISOString(),
                    },
                ],
                null,
                2
            )
        )

        const restartedRuntime = new RuntimeServer({
            serverName: "headless-reconcile-restart",
            checkpointStore: createRuntimeNodeCheckpointStore(checkpointPath),
        })
        registerRuntimeNodeOpenADEModule(restartedRuntime, {
            dataDir,
            hostName: "headless-test",
            agentExecutor: fakeAgentExecutor(),
        })

        await expect
            .poll(async () => {
                const task = await restartedRuntime.handleRequest(
                    { id: 3, method: "openade/task/read", params: { repoId: "repo-reconcile", taskId } },
                    connection
                )
                const events = (task.result as { events: Array<{ id: string; status: string; completedAt?: string }> }).events
                return events.find((event) => event.id === eventId)
            })
            .toMatchObject({ id: eventId, status: "error", completedAt: expect.any(String) })

        const retry = await restartedRuntime.handleRequest(
            {
                id: 4,
                method: "openade/action/reconcileRuntime",
                params: { taskId, eventId, status: "failed" },
            },
            connection
        )
        expect(retry).toMatchObject({ id: 4, result: { changed: false, reason: "already_terminal", status: "error" } })
    })

    it("starts a headless OpenADE review and persists the reviewer follow-up turn", async () => {
        const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-review-yjs-"))
        tmpDirs.push(dataDir)

        const runtime = new RuntimeServer({ serverName: "headless-review-runtime" })
        registerRuntimeNodeOpenADEModule(runtime, {
            dataDir,
            hostName: "headless-test",
            agentExecutor: fakeAgentExecutor(),
        })
        const server = await serveRuntimeNodeHttp({ runtime, token: "secret", heartbeatMs: 5_000 })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1)).resolves.toMatchObject({
            id: 1,
            result: {
                capabilities: {
                    methods: expect.arrayContaining(["openade/turn/start", "openade/review/start", "openade/task/read"]),
                },
            },
        })

        const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-review-repo-"))
        tmpDirs.push(repoPath)
        socket.send(
            JSON.stringify({
                id: 2,
                method: "openade/repo/create",
                params: {
                    repoId: "repo-review",
                    name: "Review Repo",
                    path: repoPath,
                    createdBy: { id: "user-1", email: "user@example.com" },
                },
            })
        )
        await expect(readResponse(inbox, 2)).resolves.toMatchObject({ id: 2, result: { repoId: "repo-review" } })

        socket.send(
            JSON.stringify({
                id: 3,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-review",
                    type: "plan",
                    input: "make a plan",
                    harnessId: "claude-code",
                    modelId: "fake-model",
                    clientRequestId: "review-plan-1",
                },
            })
        )
        const planResponse = (await readResponse(inbox, 3)) as { result: { taskId: string; eventId: string } }
        await delay(30)

        socket.send(
            JSON.stringify({
                id: 4,
                method: "openade/review/start",
                params: {
                    repoId: "repo-review",
                    taskId: planResponse.result.taskId,
                    reviewType: "plan",
                    harnessId: "claude-code",
                    modelId: "fake-model",
                    clientRequestId: "review-1",
                },
            })
        )
        const reviewResponse = (await readResponse(inbox, 4)) as { result: { taskId: string; eventId: string } }
        expect(reviewResponse).toMatchObject({ id: 4, result: { taskId: planResponse.result.taskId, eventId: expect.any(String) } })

        let taskResponse: { result?: { events?: Array<Record<string, unknown>> } } | undefined
        for (let attempt = 0; attempt < 20; attempt++) {
            socket.send(
                JSON.stringify({
                    id: 10 + attempt,
                    method: "openade/task/read",
                    params: { repoId: "repo-review", taskId: planResponse.result.taskId },
                })
            )
            taskResponse = (await readResponse(inbox, 10 + attempt)) as { result?: { events?: Array<Record<string, unknown>> } }
            const actionEvents = taskResponse.result?.events?.filter((event) => event.type === "action") ?? []
            if (actionEvents.length >= 3 && actionEvents.every((event) => event.status === "completed")) break
            await delay(25)
        }

        const actionEvents = taskResponse?.result?.events?.filter((event) => event.type === "action") ?? []
        expect(actionEvents).toEqual([
            expect.objectContaining({ source: expect.objectContaining({ type: "plan" }), status: "completed" }),
            expect.objectContaining({ id: reviewResponse.result.eventId, source: expect.objectContaining({ type: "review" }), status: "completed" }),
            expect.objectContaining({
                source: expect.objectContaining({ type: "ask", origin: "review_follow_up" }),
                status: "completed",
            }),
        ])

        socket.close()
    })

    it("runs a headless OpenADE HyperPlan strategy over the real WebSocket runtime API", async () => {
        const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-hyperplan-yjs-"))
        tmpDirs.push(dataDir)

        const runtime = new RuntimeServer({ serverName: "headless-hyperplan-runtime" })
        registerRuntimeNodeOpenADEModule(runtime, {
            dataDir,
            hostName: "headless-test",
            agentExecutor: fakeAgentExecutor(),
        })
        const server = await serveRuntimeNodeHttp({ runtime, token: "secret", heartbeatMs: 5_000 })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1)).resolves.toMatchObject({
            id: 1,
            result: {
                capabilities: {
                    methods: expect.arrayContaining(["openade/turn/start", "openade/task/read"]),
                },
            },
        })

        const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-hyperplan-repo-"))
        tmpDirs.push(repoPath)
        socket.send(
            JSON.stringify({
                id: 2,
                method: "openade/repo/create",
                params: {
                    repoId: "repo-hyperplan",
                    name: "HyperPlan Repo",
                    path: repoPath,
                    createdBy: { id: "user-1", email: "user@example.com" },
                },
            })
        )
        await expect(readResponse(inbox, 2)).resolves.toMatchObject({ id: 2, result: { repoId: "repo-hyperplan" } })

        socket.send(
            JSON.stringify({
                id: 3,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-hyperplan",
                    type: "hyperplan",
                    input: "make a robust plan",
                    harnessId: "claude-code",
                    modelId: "fake-model",
                    clientRequestId: "hyperplan-1",
                    hyperplanStrategy: {
                        id: "ensemble",
                        name: "Ensemble",
                        description: "Two planners reconcile",
                        steps: [
                            { id: "plan_a", primitive: "plan", agent: { harnessId: "claude-code", modelId: "fake-model" }, inputs: [] },
                            { id: "plan_b", primitive: "plan", agent: { harnessId: "claude-code", modelId: "fake-model" }, inputs: [] },
                            {
                                id: "reconcile_0",
                                primitive: "reconcile",
                                agent: { harnessId: "claude-code", modelId: "fake-model" },
                                inputs: ["plan_a", "plan_b"],
                            },
                        ],
                        terminalStepId: "reconcile_0",
                    },
                },
            })
        )
        const hyperPlanResponse = (await readResponse(inbox, 3)) as { result: { taskId: string; eventId: string } }
        expect(hyperPlanResponse).toMatchObject({ id: 3, result: { taskId: expectedTaskId("repo-hyperplan", "hyperplan-1"), eventId: expect.any(String) } })

        let taskResponse:
            | {
                  result?: {
                      events?: Array<{
                          type?: string
                          status?: string
                          source?: { type?: string; strategyId?: string }
                          result?: { success?: boolean }
                          hyperplanSubExecutions?: Array<{ status?: string; resultText?: string; reconcileLabel?: string }>
                          execution?: { events?: unknown[]; sessionId?: string }
                      }>
                  }
              }
            | undefined
        for (let attempt = 0; attempt < 20; attempt++) {
            socket.send(
                JSON.stringify({
                    id: 40 + attempt,
                    method: "openade/task/read",
                    params: { repoId: "repo-hyperplan", taskId: hyperPlanResponse.result.taskId },
                })
            )
            taskResponse = (await readResponse(inbox, 40 + attempt)) as typeof taskResponse
            const action = taskResponse?.result?.events?.find((event) => event.type === "action")
            if (action?.status === "completed" && action.hyperplanSubExecutions?.every((sub) => sub.status === "completed")) break
            await delay(25)
        }

        const action = taskResponse?.result?.events?.find((event) => event.type === "action")
        expect(action).toMatchObject({
            type: "action",
            status: "completed",
            source: { type: "hyperplan", strategyId: "ensemble" },
            result: { success: true },
        })
        expect(action?.hyperplanSubExecutions).toHaveLength(2)
        expect(action?.hyperplanSubExecutions?.map((sub) => sub.status)).toEqual(["completed", "completed"])
        expect(action?.hyperplanSubExecutions?.every((sub) => sub.resultText === "done from fake agent")).toBe(true)
        expect(action?.hyperplanSubExecutions?.filter((sub) => sub.reconcileLabel).length).toBe(2)
        expect(action?.execution?.events?.length).toBeGreaterThan(0)
        expect(action?.execution?.sessionId).toBeTruthy()

        socket.close()
    })

    it("preserves stopped HyperPlan child status in the headless OpenADE runtime", async () => {
        const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-hyperplan-stopped-yjs-"))
        tmpDirs.push(dataDir)

        const runtime = new RuntimeServer({ serverName: "headless-hyperplan-stopped-runtime" })
        registerRuntimeNodeOpenADEModule(runtime, {
            dataDir,
            hostName: "headless-test",
            agentExecutor: fakeAgentExecutor({ stopWhenExecutionIdIncludes: "-plan_a-" }),
        })
        const server = await serveRuntimeNodeHttp({ runtime, token: "secret", heartbeatMs: 5_000 })
        servers.push(server)

        const socket = new WebSocket(server.url, ["bearer.secret"])
        sockets.push(socket)
        await waitForOpen(socket)
        const inbox = new SocketInbox(socket)

        socket.send(JSON.stringify({ id: 1, method: "initialize" }))
        await expect(readResponse(inbox, 1)).resolves.toMatchObject({ id: 1, result: { serverName: "headless-hyperplan-stopped-runtime" } })

        const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "openade-headless-hyperplan-stopped-repo-"))
        tmpDirs.push(repoPath)
        socket.send(
            JSON.stringify({
                id: 2,
                method: "openade/repo/create",
                params: {
                    repoId: "repo-hyperplan-stopped",
                    name: "HyperPlan Stopped Repo",
                    path: repoPath,
                    createdBy: { id: "user-1", email: "user@example.com" },
                },
            })
        )
        await expect(readResponse(inbox, 2)).resolves.toMatchObject({ id: 2, result: { repoId: "repo-hyperplan-stopped" } })

        socket.send(
            JSON.stringify({
                id: 3,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-hyperplan-stopped",
                    type: "hyperplan",
                    input: "preserve stopped child",
                    harnessId: "claude-code",
                    modelId: "fake-model",
                    clientRequestId: "hyperplan-stopped-1",
                    hyperplanStrategy: {
                        id: "ensemble",
                        name: "Ensemble",
                        description: "Two planners reconcile",
                        steps: [
                            { id: "plan_a", primitive: "plan", agent: { harnessId: "claude-code", modelId: "fake-model" }, inputs: [] },
                            { id: "plan_b", primitive: "plan", agent: { harnessId: "claude-code", modelId: "fake-model" }, inputs: [] },
                            {
                                id: "reconcile_0",
                                primitive: "reconcile",
                                agent: { harnessId: "claude-code", modelId: "fake-model" },
                                inputs: ["plan_a", "plan_b"],
                            },
                        ],
                        terminalStepId: "reconcile_0",
                    },
                },
            })
        )
        const hyperPlanResponse = (await readResponse(inbox, 3)) as { result: { taskId: string; eventId: string } }
        expect(hyperPlanResponse).toMatchObject({ id: 3, result: { taskId: expect.any(String), eventId: expect.any(String) } })

        let taskResponse:
            | {
                  result?: {
                      events?: Array<{
                          type?: string
                          status?: string
                          hyperplanSubExecutions?: Array<{ stepId?: string; status?: string }>
                      }>
                  }
              }
            | undefined
        for (let attempt = 0; attempt < 20; attempt++) {
            socket.send(
                JSON.stringify({
                    id: 30 + attempt,
                    method: "openade/task/read",
                    params: { repoId: "repo-hyperplan-stopped", taskId: hyperPlanResponse.result.taskId },
                })
            )
            taskResponse = (await readResponse(inbox, 30 + attempt)) as typeof taskResponse
            const action = taskResponse?.result?.events?.find((event) => event.type === "action")
            if (action?.status === "stopped") break
            await delay(25)
        }

        const action = taskResponse?.result?.events?.find((event) => event.type === "action")
        expect(action).toMatchObject({ type: "action", status: "stopped" })
        expect(action?.hyperplanSubExecutions?.map((sub) => [sub.stepId, sub.status])).toEqual([
            ["plan_a", "stopped"],
            ["plan_b", "completed"],
        ])

        socket.close()
    })
})
