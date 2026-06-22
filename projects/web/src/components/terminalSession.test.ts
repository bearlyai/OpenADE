import { describe, expect, it, vi } from "vitest"
import { OpenADEClient } from "../../../openade-client/src"
import type {
    OpenADETaskTerminalReconnectRequest,
    OpenADETaskTerminalResizeRequest,
    OpenADETaskTerminalStartRequest,
    OpenADETaskTerminalStopRequest,
    OpenADETaskTerminalWriteRequest,
} from "../../../openade-module/src"
import { RuntimeLocalClient, type RuntimeLocalTransport } from "../../../runtime-client/src"
import type { RuntimeMessage, RuntimeRequest } from "../../../runtime-protocol/src"
import { RuntimeServer, type RuntimeConnection } from "../../../runtime/src"
import type { TaskTerminalProductAccess } from "./terminalSession"
import { ProductTaskTerminalSession } from "./terminalSession"

function createProductAccess(overrides: Partial<TaskTerminalProductAccess> = {}): TaskTerminalProductAccess {
    return {
        repoId: "repo-1",
        taskId: "task-1",
        capabilities: {
            canStart: true,
            canReconnect: true,
            canWrite: true,
            canResize: true,
            canStop: true,
        },
        startTaskTerminal: vi.fn(async (params) => ({
            repoId: "repo-1",
            taskId: "task-1",
            terminalId: "terminal-1",
            runtimeId: "pty:terminal-1",
            ok: true,
            ...params,
        })),
        reconnectTaskTerminal: vi.fn(async (params) => ({
            repoId: "repo-1",
            taskId: "task-1",
            terminalId: params.terminalId ?? "terminal-1",
            found: false,
            output: [],
        })),
        writeTaskTerminal: vi.fn(async (params) => ({ repoId: "repo-1", taskId: "task-1", terminalId: params.terminalId, ok: true })),
        resizeTaskTerminal: vi.fn(async (params) => ({ repoId: "repo-1", taskId: "task-1", terminalId: params.terminalId, ok: true })),
        stopTaskTerminal: vi.fn(async (params) => ({ repoId: "repo-1", taskId: "task-1", terminalId: params.terminalId, ok: true })),
        ...overrides,
    }
}

function createLocalRuntimeClient(server: RuntimeServer): RuntimeLocalClient {
    const listeners = new Set<(message: RuntimeMessage) => void>()
    let dispose: (() => void) | null = null
    const connection: RuntimeConnection = {
        id: "terminal-session-test",
        send(message) {
            for (const listener of listeners) listener(message)
        },
    }
    const transport: RuntimeLocalTransport = {
        connect() {
            dispose = server.connect(connection)
        },
        disconnect() {
            dispose?.()
            dispose = null
        },
        request(request: RuntimeRequest) {
            return server.handleRequest(request, connection, {
                requireInitialized: true,
            })
        },
        onMessage(listener: (message: RuntimeMessage) => void) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
    return new RuntimeLocalClient(transport, {
        clientName: "terminal-session-test",
        clientPlatform: "web",
    })
}

describe("ProductTaskTerminalSession", () => {
    it("reconnects by repo and task without client-side terminal id derivation", async () => {
        const access = createProductAccess({
            reconnectTaskTerminal: vi.fn(async (params) => ({
                repoId: "repo-1",
                taskId: "task-1",
                terminalId: params.terminalId ?? "terminal-1",
                found: true,
                outputCount: 2,
                output: [
                    { data: "hello", timestamp: 1 },
                    { data: " world", timestamp: 2 },
                ],
            })),
        })

        const session = await ProductTaskTerminalSession.connect(access, 80, 24, { pollIntervalMs: 0 })
        if (!session) throw new Error("Expected product terminal session")
        const output: string[] = []
        session.on("output", (chunk) => output.push(chunk))

        expect(access.reconnectTaskTerminal).toHaveBeenCalledWith({})
        expect(access.startTaskTerminal).not.toHaveBeenCalled()
        expect(output).toEqual(["hello", " world"])
    })

    it("starts a product terminal when reconnect does not find one and reuses the returned terminal id", async () => {
        const access = createProductAccess()
        const session = await ProductTaskTerminalSession.connect(access, 80, 24, { pollIntervalMs: 0 })
        if (!session) throw new Error("Expected product terminal session")

        await session.write("pwd\n")
        await session.resize(100, 30)
        await session.kill()

        expect(access.reconnectTaskTerminal).toHaveBeenCalledWith({})
        expect(access.startTaskTerminal).toHaveBeenCalledWith({ cols: 80, rows: 24 })
        expect(access.writeTaskTerminal).toHaveBeenCalledWith({ terminalId: "terminal-1", data: "pwd\n" })
        expect(access.resizeTaskTerminal).toHaveBeenCalledWith({ terminalId: "terminal-1", cols: 100, rows: 30 })
        expect(access.stopTaskTerminal).toHaveBeenCalledWith({ terminalId: "terminal-1" })
    })

    it("uses reconnect-only product access without issuing denied terminal mutations", async () => {
        const access = createProductAccess({
            capabilities: {
                canStart: false,
                canReconnect: true,
                canWrite: false,
                canResize: false,
                canStop: false,
            },
            reconnectTaskTerminal: vi.fn(async (params) => ({
                repoId: "repo-1",
                taskId: "task-1",
                terminalId: params.terminalId ?? "terminal-1",
                found: true,
                outputCount: 1,
                output: [{ data: "read-only output", timestamp: 1 }],
            })),
        })

        const session = await ProductTaskTerminalSession.connect(access, 80, 24, { pollIntervalMs: 0 })
        if (!session) throw new Error("Expected product terminal session")
        const output: string[] = []
        session.on("output", (chunk) => output.push(chunk))

        await session.write("ignored\n")
        await session.resize(100, 30)
        await session.kill()

        expect(output).toEqual(["read-only output"])
        expect(access.reconnectTaskTerminal).toHaveBeenCalledWith({})
        expect(access.startTaskTerminal).not.toHaveBeenCalled()
        expect(access.writeTaskTerminal).not.toHaveBeenCalled()
        expect(access.resizeTaskTerminal).not.toHaveBeenCalled()
        expect(access.stopTaskTerminal).not.toHaveBeenCalled()
        expect(session.exited).toBe(false)
    })

    it("polls only new product output and emits exit once", async () => {
        const reconnectTaskTerminal: TaskTerminalProductAccess["reconnectTaskTerminal"] = vi
            .fn()
            .mockResolvedValueOnce({
                repoId: "repo-1",
                taskId: "task-1",
                terminalId: "terminal-1",
                found: true,
                outputCount: 1,
                output: [{ data: "first", timestamp: 1 }],
            })
            .mockResolvedValueOnce({
                repoId: "repo-1",
                taskId: "task-1",
                terminalId: "terminal-1",
                found: true,
                exited: true,
                exitCode: 0,
                outputCount: 3,
                output: [
                    { data: "first", timestamp: 1 },
                    { data: " second", timestamp: 2 },
                    { data: " third", timestamp: 3 },
                ],
            })
        const access = createProductAccess({ reconnectTaskTerminal })

        const session = await ProductTaskTerminalSession.connect(access, 80, 24, { pollIntervalMs: 0 })
        if (!session) throw new Error("Expected product terminal session")
        const output: string[] = []
        const exit = vi.fn()
        session.on("output", (chunk) => output.push(chunk))
        session.on("exit", exit)

        await session.pollOnce()
        await session.pollOnce()

        expect(output).toEqual(["first", " second", " third"])
        expect(exit).toHaveBeenCalledTimes(1)
        expect(reconnectTaskTerminal).toHaveBeenCalledTimes(2)
    })

    it("drives product terminal mutations through a real runtime client", async () => {
        const server = new RuntimeServer({
            serverName: "terminal-session-runtime-test",
            protocolVersion: 1,
        })
        const terminalId = "terminal-runtime-1"
        const starts: OpenADETaskTerminalStartRequest[] = []
        const reconnects: OpenADETaskTerminalReconnectRequest[] = []
        const writes: OpenADETaskTerminalWriteRequest[] = []
        const resizes: OpenADETaskTerminalResizeRequest[] = []
        const stops: OpenADETaskTerminalStopRequest[] = []
        let started = false

        server.register("openade/task/terminal/reconnect", (rawParams) => {
            const params = rawParams as OpenADETaskTerminalReconnectRequest
            reconnects.push(params)
            if (!started) {
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    terminalId,
                    found: false,
                    output: [],
                    outputCount: 0,
                }
            }
            return {
                repoId: params.repoId,
                taskId: params.taskId,
                terminalId,
                found: true,
                output: [
                    { data: "runtime ", timestamp: 1 },
                    { data: "output", timestamp: 2 },
                ],
                outputCount: 2,
            }
        })
        server.register("openade/task/terminal/start", (rawParams) => {
            const params = rawParams as OpenADETaskTerminalStartRequest
            starts.push(params)
            started = true
            return {
                repoId: params.repoId,
                taskId: params.taskId,
                terminalId,
                runtimeId: `pty:${terminalId}`,
                ok: true,
            }
        })
        server.register("openade/task/terminal/write", (rawParams) => {
            const params = rawParams as OpenADETaskTerminalWriteRequest
            writes.push(params)
            return { repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId, ok: true }
        })
        server.register("openade/task/terminal/resize", (rawParams) => {
            const params = rawParams as OpenADETaskTerminalResizeRequest
            resizes.push(params)
            return { repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId, ok: true }
        })
        server.register("openade/task/terminal/stop", (rawParams) => {
            const params = rawParams as OpenADETaskTerminalStopRequest
            stops.push(params)
            return { repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId, ok: true }
        })

        const runtime = createLocalRuntimeClient(server)
        const client = new OpenADEClient({
            runtime,
            clientName: "terminal-session-openade-test",
            clientPlatform: "web",
        })
        const access: TaskTerminalProductAccess = {
            repoId: "repo-runtime",
            taskId: "task-runtime",
            capabilities: {
                canStart: true,
                canReconnect: true,
                canWrite: true,
                canResize: true,
                canStop: true,
            },
            startTaskTerminal: (args) =>
                client.startTaskTerminal({ repoId: "repo-runtime", taskId: "task-runtime", ...args }, { clientRequestId: "terminal-start" }),
            reconnectTaskTerminal: (args) => client.reconnectTaskTerminal({ repoId: "repo-runtime", taskId: "task-runtime", ...args }),
            writeTaskTerminal: (args) =>
                client.writeTaskTerminal({ repoId: "repo-runtime", taskId: "task-runtime", ...args }, { clientRequestId: "terminal-write" }),
            resizeTaskTerminal: (args) =>
                client.resizeTaskTerminal({ repoId: "repo-runtime", taskId: "task-runtime", ...args }, { clientRequestId: "terminal-resize" }),
            stopTaskTerminal: (args) =>
                client.stopTaskTerminal({ repoId: "repo-runtime", taskId: "task-runtime", ...args }, { clientRequestId: "terminal-stop" }),
        }

        try {
            const session = await ProductTaskTerminalSession.connect(access, 80, 24, { pollIntervalMs: 0 })
            if (!session) throw new Error("Expected product terminal session")
            const output: string[] = []
            const exit = vi.fn()
            session.on("output", (chunk) => output.push(chunk))
            session.on("exit", exit)

            await session.write("echo runtime\n")
            await session.resize(100, 30)
            await session.pollOnce()
            await session.kill()
            await session.write("ignored after stop\n")
            await session.resize(120, 40)
            await session.kill()

            expect(output).toEqual(["runtime ", "output"])
            expect(exit).toHaveBeenCalledTimes(1)
            expect(reconnects).toEqual([
                { repoId: "repo-runtime", taskId: "task-runtime" },
                { repoId: "repo-runtime", taskId: "task-runtime", terminalId },
            ])
            expect(starts).toEqual([{ repoId: "repo-runtime", taskId: "task-runtime", cols: 80, rows: 24, clientRequestId: "terminal-start" }])
            expect(writes).toEqual([{ repoId: "repo-runtime", taskId: "task-runtime", terminalId, data: "echo runtime\n", clientRequestId: "terminal-write" }])
            expect(resizes).toEqual([{ repoId: "repo-runtime", taskId: "task-runtime", terminalId, cols: 100, rows: 30, clientRequestId: "terminal-resize" }])
            expect(stops).toEqual([{ repoId: "repo-runtime", taskId: "task-runtime", terminalId, clientRequestId: "terminal-stop" }])
        } finally {
            await runtime.close()
        }
    })
})
