import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket, WebSocketServer } from "ws"
import { RuntimeClient, RuntimeLocalClient, type RuntimeClientStatus } from "../../../../runtime-client/src"
import type { RuntimeNotification, RuntimeRequest } from "../../../../runtime-protocol/src"

const originalWebSocket = globalThis.WebSocket
const cleanupFns: Array<() => Promise<void> | void> = []

type Deferred<T> = {
    promise: Promise<T>
    resolve: (value: T) => void
    reject: (error: Error) => void
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((innerResolve, innerReject) => {
        resolve = innerResolve
        reject = innerReject
    })
    return { promise, resolve, reject }
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), 5000)
        promise.then(
            (value) => {
                clearTimeout(timer)
                resolve(value)
            },
            (error) => {
                clearTimeout(timer)
                reject(error)
            }
        )
    })
}

function runtimeInitializeResult() {
    return {
        protocolVersion: 1,
        serverName: "runtime-client-test",
        capabilities: {
            methods: [],
            notifications: [],
            agentProviders: [],
        },
    }
}

async function listen(server: Server): Promise<number> {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    return (server.address() as AddressInfo).port
}

afterEach(async () => {
    globalThis.WebSocket = originalWebSocket
    while (cleanupFns.length > 0) {
        await cleanupFns.pop()?.()
    }
})

describe("RuntimeClient WebSocket reconnect", () => {
    it("rejects instead of hanging when the socket closes before initialize completes", async () => {
        globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket

        const httpServer = createServer()
        const wsServer = new WebSocketServer({ server: httpServer })
        cleanupFns.push(
            () =>
                new Promise<void>((resolve) => {
                    wsServer.close(() => httpServer.close(() => resolve()))
                })
        )

        wsServer.on("connection", (socket) => {
            socket.close()
        })

        const port = await listen(httpServer)
        const client = new RuntimeClient({
            url: `ws://127.0.0.1:${port}/v1/runtime`,
            token: "test-token",
            reconnect: false,
        })
        cleanupFns.push(() => client.close())

        await expect(withTimeout(client.request("runtime/list"), "connect hung after pre-initialize close")).rejects.toThrow(
            /closed before initialization|Runtime socket failed/
        )
    })

    it("retries when the socket closes before initialize and reconnect is enabled", async () => {
        globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket

        const httpServer = createServer()
        const wsServer = new WebSocketServer({ server: httpServer })
        cleanupFns.push(
            () =>
                new Promise<void>((resolve) => {
                    wsServer.close(() => httpServer.close(() => resolve()))
                })
        )

        let connectionCount = 0
        wsServer.on("connection", (socket) => {
            connectionCount += 1
            if (connectionCount === 1) {
                socket.close()
                return
            }

            socket.on("message", (raw) => {
                const request = JSON.parse(raw.toString()) as RuntimeRequest
                if (request.method === "initialize") {
                    socket.send(JSON.stringify({ id: request.id, result: runtimeInitializeResult() }))
                    return
                }
                socket.send(JSON.stringify({ id: request.id, result: { ok: true } }))
            })
        })

        const port = await listen(httpServer)
        const statuses: RuntimeClientStatus[] = []
        const client = new RuntimeClient({
            url: `ws://127.0.0.1:${port}/v1/runtime`,
            token: "test-token",
            reconnect: true,
            onStatus: (status) => statuses.push(status),
        })
        cleanupFns.push(() => client.close())

        await expect(withTimeout(client.request("runtime/list"), "client did not reconnect after pre-initialize close")).resolves.toEqual({ ok: true })

        expect(connectionCount).toBe(2)
        expect(statuses).toContain("reconnecting")
        expect(statuses.at(-1)).toBe("connected")
    })

    it("reconnects with the last notification cursor so the server can replay missed notifications", async () => {
        globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket

        const httpServer = createServer()
        const wsServer = new WebSocketServer({ server: httpServer })
        cleanupFns.push(
            () =>
                new Promise<void>((resolve) => {
                    wsServer.close(() => httpServer.close(() => resolve()))
                })
        )

        const firstNotification = deferred<RuntimeNotification>()
        const replayedNotification = deferred<RuntimeNotification>()
        let connectionCount = 0
        let replayCursor: unknown

        wsServer.on("connection", (socket) => {
            connectionCount += 1
            const connectionNumber = connectionCount

            socket.on("message", (raw) => {
                const request = JSON.parse(raw.toString()) as RuntimeRequest
                if (request.method === "initialize") {
                    socket.send(JSON.stringify({ id: request.id, result: runtimeInitializeResult() }))
                    if (connectionNumber === 1) {
                        setTimeout(() => {
                            socket.send(JSON.stringify({ method: "test/event", params: { step: 1 }, cursor: "1" }))
                            setTimeout(() => socket.close(), 0)
                        }, 25)
                    }
                    return
                }
                if (request.method === "subscription/update") {
                    replayCursor = (request.params as { cursor?: unknown } | undefined)?.cursor
                    socket.send(JSON.stringify({ method: "test/event", params: { step: 2 }, cursor: "2" }))
                    socket.send(JSON.stringify({ id: request.id, result: { ok: true } }))
                }
            })
        })

        const port = await listen(httpServer)
        const statuses: RuntimeClientStatus[] = []
        const client = new RuntimeClient({
            url: `ws://127.0.0.1:${port}/v1/runtime`,
            token: "test-token",
            reconnect: true,
            onStatus: (status) => statuses.push(status),
        })
        cleanupFns.push(() => client.close())

        client.subscribe((notification) => {
            if (notification.cursor === "1") firstNotification.resolve(notification)
            if (notification.cursor === "2") replayedNotification.resolve(notification)
        })

        await withTimeout(firstNotification.promise, "first notification was not delivered")
        await withTimeout(replayedNotification.promise, "replayed notification was not delivered after reconnect")

        expect(replayCursor).toBe("1")
        expect(connectionCount).toBeGreaterThanOrEqual(2)
        expect(statuses).toContain("reconnecting")
        expect(statuses.at(-1)).toBe("connected")
    })
})

describe("RuntimeLocalClient", () => {
    it("initializes the local transport before the first domain request", async () => {
        const requests: RuntimeRequest[] = []
        const client = new RuntimeLocalClient(
            {
                connect: () => undefined,
                disconnect: () => undefined,
                onMessage: () => () => undefined,
                request: (request) => {
                    requests.push(request)
                    return {
                        id: request.id,
                        result:
                            request.method === "initialize"
                                ? runtimeInitializeResult()
                                : {
                                      ok: true,
                                  },
                    }
                },
            },
            {
                clientName: "local-test",
                clientPlatform: "desktop",
            }
        )

        await expect(client.request("runtime/list")).resolves.toEqual({ ok: true })

        expect(requests.map((request) => request.method)).toEqual(["initialize", "runtime/list"])
        expect(requests[0]).toMatchObject({
            method: "initialize",
            params: {
                clientName: "local-test",
                clientPlatform: "desktop",
                protocolVersion: 1,
            },
        })
    })

    it("coalesces concurrent local initialization requests", async () => {
        const requests: RuntimeRequest[] = []
        const client = new RuntimeLocalClient({
            connect: () => undefined,
            disconnect: () => undefined,
            onMessage: () => () => undefined,
            request: async (request) => {
                requests.push(request)
                await new Promise((resolve) => setTimeout(resolve, 5))
                return {
                    id: request.id,
                    result: request.method === "initialize" ? runtimeInitializeResult() : { ok: true },
                }
            },
        })

        await expect(Promise.all([client.request("runtime/list"), client.request("runtime/read", { runtimeId: "runtime-1" })])).resolves.toEqual([
            { ok: true },
            { ok: true },
        ])

        expect(requests.map((request) => request.method)).toEqual(["initialize", "runtime/list", "runtime/read"])
    })
})
