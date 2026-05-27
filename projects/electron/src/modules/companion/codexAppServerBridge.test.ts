import { once } from "node:events"
import net from "node:net"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocketServer, type WebSocket } from "ws"
import type { RuntimeMessage } from "../../../../runtime-protocol/src"
import { RuntimeServer } from "../../../../runtime/src"
import { registerRuntimeAgentModule, registerServerProtocolAgentBridge } from "./runtimeAgents"
import { createRuntimeNodeCodexAppServerBridge as createCodexAppServerBridge } from "../../../../runtime-node/src"

type RequestRecord = {
    id?: string | number
    method?: string
    params?: unknown
    result?: unknown
    error?: unknown
}

const servers: WebSocketServer[] = []

function connection() {
    const messages: RuntimeMessage[] = []
    return {
        messages,
        connection: {
            id: "test",
            send(message: RuntimeMessage) {
                messages.push(message)
            },
        },
    }
}

async function startCodexAppServerMock(handle: (request: RequestRecord, socket: WebSocket) => void): Promise<{ url: string; close(): Promise<void> }> {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    servers.push(server)
    await once(server, "listening")
    const address = server.address() as AddressInfo

    server.on("connection", (socket) => {
        socket.on("message", (data) => {
            handle(JSON.parse(data.toString()) as RequestRecord, socket)
        })
    })

    return {
        url: `ws://127.0.0.1:${address.port}`,
        async close() {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()))
            })
        },
    }
}

async function openPort(): Promise<number> {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as AddressInfo).port
    await new Promise<void>((resolve) => server.close(() => resolve()))
    return port
}

afterEach(async () => {
    await Promise.all(
        servers.splice(0).map((server) => {
            for (const client of server.clients) client.terminate()
            return new Promise<void>((resolve) => {
                server.close(() => resolve())
            })
        })
    )
})

describe("CodexAppServerBridge", () => {
    it("redacts credentials from bridge status", () => {
        const bridge = createCodexAppServerBridge({
            websocketUrl: "wss://user:pass@example.test/socket?token=secret-token&api_key=secret-key&safe=value",
            authToken: "separate-secret",
        })

        expect(bridge.status().websocketUrl).toBe("wss://redacted:redacted@example.test/socket?token=redacted&api_key=redacted&safe=value")
        expect(bridge.status().websocketUrl).not.toContain("secret")
        expect(bridge.status().websocketUrl).not.toContain("pass")
    })

    it("speaks Codex app-server JSON-RPC over a real websocket", async () => {
        const requests: RequestRecord[] = []
        const approvalResponses: RequestRecord[] = []
        const mock = await startCodexAppServerMock((request, socket) => {
            if (request.id === "approval-1" && !request.method) {
                approvalResponses.push(request)
                return
            }
            requests.push(request)
            switch (request.method) {
                case "initialize":
                    socket.send(JSON.stringify({ id: request.id, result: { userAgent: "codex-app-server-test/1.2.3" } }))
                    break
                case "initialized":
                    break
                case "thread/start":
                    socket.send(JSON.stringify({ id: request.id, result: { thread: { id: "thr_1" } } }))
                    break
                case "turn/start":
                    socket.send(JSON.stringify({ id: request.id, result: { turn: { id: "turn_1" } } }))
                    socket.send(
                        JSON.stringify({
                            method: "item/agentMessage/delta",
                            params: { threadId: "thr_1", turnId: "turn_1", itemId: "item_1", delta: "hello" },
                        })
                    )
                    socket.send(
                        JSON.stringify({
                            id: "approval-1",
                            method: "item/commandExecution/requestApproval",
                            params: {
                                threadId: "thr_1",
                                turnId: "turn_1",
                                itemId: "cmd_1",
                                command: ["echo", "hi"],
                                cwd: "/tmp/openade",
                            },
                        })
                    )
                    break
                case "thread/goal/set":
                    socket.send(
                        JSON.stringify({
                            id: request.id,
                            result: {
                                goal: {
                                    threadId: "thr_1",
                                    objective: "Ship clean runtime",
                                    status: "active",
                                    tokenBudget: 1000,
                                    tokensUsed: 0,
                                    timeUsedSeconds: 0,
                                },
                            },
                        })
                    )
                    break
                case "thread/goal/get":
                    socket.send(JSON.stringify({ id: request.id, result: { goal: { threadId: "thr_1", objective: "Ship clean runtime", status: "active" } } }))
                    break
                case "thread/goal/clear":
                    socket.send(JSON.stringify({ id: request.id, result: { cleared: true } }))
                    break
                default:
                    socket.send(JSON.stringify({ id: request.id, error: { code: -32601, message: `unknown ${request.method}` } }))
            }
        })

        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        registerRuntimeAgentModule(runtime)
        const testConnection = connection()
        runtime.connect(testConnection.connection)
        const bridge = createCodexAppServerBridge({
            providerId: "codex-server",
            websocketUrl: mock.url,
            onNotification(method, params) {
                runtime.notify(method, params)
            },
        })
        const unregister = registerServerProtocolAgentBridge(bridge)

        try {
            await expect(runtime.handleRequest({ id: 1, method: "agent/thread/start", params: { providerId: "codex-server", cwd: "/tmp/openade" } }, testConnection.connection)).resolves.toMatchObject({
                result: { thread: { id: "thr_1" } },
            })
            await expect(
                runtime.handleRequest({ id: 2, method: "agent/turn/start", params: { providerId: "codex-server", threadId: "thr_1", input: "go" } }, testConnection.connection)
            ).resolves.toMatchObject({ result: { turn: { id: "turn_1" } } })
            await expect(
                runtime.handleRequest(
                    { id: 3, method: "agent/goal/set", params: { providerId: "codex-server", threadId: "thr_1", objective: "Ship clean runtime", status: "active", tokenBudget: 1000 } },
                    testConnection.connection
                )
            ).resolves.toMatchObject({ result: { goal: { threadId: "thr_1", status: "active" } } })
            await expect(runtime.handleRequest({ id: 4, method: "agent/goal/get", params: { providerId: "codex-server", threadId: "thr_1" } }, testConnection.connection)).resolves.toMatchObject({
                result: { goal: { objective: "Ship clean runtime" } },
            })
            await expect(runtime.handleRequest({ id: 5, method: "agent/goal/clear", params: { providerId: "codex-server", threadId: "thr_1" } }, testConnection.connection)).resolves.toMatchObject({
                result: { cleared: true },
            })

            expect(requests.map((request) => request.method)).toEqual(["initialize", "initialized", "thread/start", "turn/start", "thread/goal/set", "thread/goal/get", "thread/goal/clear"])
            expect(requests.find((request) => request.method === "turn/start")?.params).toMatchObject({
                threadId: "thr_1",
                input: [{ type: "text", text: "go" }],
            })
            expect(testConnection.messages).toContainEqual(expect.objectContaining({
                method: "agent/turn/delta",
                params: {
                    providerId: "codex-server",
                    method: "item/agentMessage/delta",
                    params: { threadId: "thr_1", turnId: "turn_1", itemId: "item_1", delta: "hello" },
                },
            }))
            expect(testConnection.messages).toContainEqual(expect.objectContaining({
                method: "agent/approval/requested",
                params: {
                    providerId: "codex-server",
                    requestId: "approval-1",
                    method: "item/commandExecution/requestApproval",
                    params: {
                        threadId: "thr_1",
                        turnId: "turn_1",
                        itemId: "cmd_1",
                        command: ["echo", "hi"],
                        cwd: "/tmp/openade",
                    },
                },
            }))
            await expect(runtime.handleRequest({ id: 6, method: "agent/approval/list", params: { providerId: "codex-server" } }, testConnection.connection)).resolves.toMatchObject({
                result: [
                    {
                        requestId: "approval-1",
                        method: "item/commandExecution/requestApproval",
                        params: {
                            command: ["echo", "hi"],
                        },
                    },
                ],
            })
            await expect(
                runtime.handleRequest(
                    {
                        id: 7,
                        method: "agent/approval/respond",
                        params: { providerId: "codex-server", requestId: "approval-1", response: { decision: "accept" } },
                    },
                    testConnection.connection
                )
            ).resolves.toMatchObject({ result: { ok: true } })
            await expect.poll(() => approvalResponses.length).toBe(1)
            expect(approvalResponses[0]).toMatchObject({
                id: "approval-1",
                result: { decision: "accept" },
            })
        } finally {
            unregister()
            await bridge.disconnect()
        }
    })

    it("can launch and connect to a configured managed Codex app-server process", async () => {
        const port = await openPort()
        const serverScript = `
            const http = require("http");
            const { WebSocketServer } = require("ws");
            const server = http.createServer((request, response) => {
                if (request.url === "/readyz") {
                    response.writeHead(200);
                    response.end("ok");
                    return;
                }
                response.writeHead(404);
                response.end("not found");
            });
            const wss = new WebSocketServer({ server });
            wss.on("connection", (socket) => {
                socket.on("message", (data) => {
                    const request = JSON.parse(data.toString());
                    if (request.method === "initialize") {
                        socket.send(JSON.stringify({ id: request.id, result: { userAgent: "managed-codex-test/1.0.0" } }));
                        return;
                    }
                    if (request.method === "initialized") return;
                    if (request.method === "thread/start") {
                        socket.send(JSON.stringify({ id: request.id, result: { thread: { id: "managed-thread" } } }));
                        return;
                    }
                    socket.send(JSON.stringify({ id: request.id, result: { ok: true } }));
                });
            });
            server.listen(Number(process.env.PORT), "127.0.0.1");
            process.on("SIGTERM", () => server.close(() => process.exit(0)));
        `
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        registerRuntimeAgentModule(runtime)
        const testConnection = connection()
        runtime.connect(testConnection.connection)
        const bridge = createCodexAppServerBridge({
            providerId: "codex-server",
            websocketUrl: `ws://127.0.0.1:${port}`,
            managedProcess: {
                command: process.execPath,
                args: ["-e", serverScript],
                cwd: process.cwd(),
                env: { PORT: String(port) },
                readyTimeoutMs: 5000,
            },
            onNotification(method, params) {
                runtime.notify(method, params)
            },
        })
        const unregister = registerServerProtocolAgentBridge(bridge)

        try {
            await expect(runtime.handleRequest({ id: 1, method: "agent/thread/start", params: { providerId: "codex-server" } }, testConnection.connection)).resolves.toMatchObject({
                result: { thread: { id: "managed-thread" } },
            })
            expect(bridge.status()).toMatchObject({
                state: "connected",
                managedProcess: {
                    command: process.execPath,
                    running: true,
                },
            })
        } finally {
            unregister()
            await bridge.disconnect()
        }
    })
})
