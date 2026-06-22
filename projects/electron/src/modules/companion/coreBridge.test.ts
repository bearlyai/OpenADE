import http from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WebSocket, WebSocketServer, type RawData } from "ws"
import { proxyPairRequestToCore } from "./coreBridge"
import { attachRuntimeSocketServer, type RuntimeSocketServer } from "./runtimeSocket"

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

interface StartedServer {
    server: http.Server
    baseUrl: string
}

const envKeys = ["OPENADE_CORE_RUNTIME_URL", "OPENADE_DISABLE_OPENADE_CORE"] as const

function jsonResponse(response: http.ServerResponse, statusCode: number, body: unknown): void {
    response.writeHead(statusCode, { "Content-Type": "application/json" })
    response.end(JSON.stringify(body))
}

function listen(server: http.Server): Promise<StartedServer> {
    return new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
            server.off("error", reject)
            const address = server.address()
            if (typeof address !== "object" || !address) {
                reject(new Error("Server did not expose an address"))
                return
            }
            resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` })
        })
    })
}

function closeServer(server: http.Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()))
}

function nextSocketMessage(socket: WebSocket): Promise<RawData> {
    return new Promise((resolve, reject) => {
        socket.once("message", resolve)
        socket.once("error", reject)
    })
}

function openSocket(url: string, token: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, [`bearer.${token}`])
        socket.once("open", () => resolve(socket))
        socket.once("error", reject)
    })
}

function httpBaseToRuntimeUrl(baseUrl: string): string {
    return `${baseUrl.replace(/^http:/, "ws:")}/v1/runtime`
}

describe("companion Core bridge", () => {
    afterEach(() => {
        for (const key of envKeys) Reflect.deleteProperty(process.env, key)
        storeState.data.clear()
    })

    it("proxies companion pairing exchanges to the configured Core HTTP endpoint", async () => {
        let forwardedBody: unknown = null
        const upstream = await listen(
            http.createServer(async (request, response) => {
                if (request.method !== "POST" || request.url !== "/v1/pair") {
                    jsonResponse(response, 404, { error: "not found" })
                    return
                }

                const chunks: Buffer[] = []
                for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
                forwardedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"))
                jsonResponse(response, 200, {
                    deviceToken: "core-device-token",
                    device: {
                        id: "core-device",
                        name: "Core Phone",
                        platform: "ios",
                        pairedAt: "2026-06-12T00:00:00.000Z",
                    },
                })
            })
        )

        try {
            process.env.OPENADE_CORE_RUNTIME_URL = httpBaseToRuntimeUrl(upstream.baseUrl)

            const result = await proxyPairRequestToCore({
                token: "core-pair-token",
                deviceName: "Core Phone",
                platform: "ios",
            })

            expect(result).toMatchObject({
                statusCode: 200,
                body: {
                    deviceToken: "core-device-token",
                    device: { id: "core-device", name: "Core Phone" },
                },
            })
            expect(forwardedBody).toEqual({
                token: "core-pair-token",
                deviceName: "Core Phone",
                platform: "ios",
            })
        } finally {
            await closeServer(upstream.server)
        }
    })

    it("bridges the public companion runtime socket to Core when Core is active", async () => {
        let downstreamRuntimeSocket: RuntimeSocketServer | null = null
        const upstreamProtocols: string[] = []
        const upstreamServer = http.createServer()
        const upstreamWebSockets = new WebSocketServer({ noServer: true })
        upstreamServer.on("upgrade", (request, socket, head) => {
            upstreamProtocols.push(String(request.headers["sec-websocket-protocol"] ?? ""))
            upstreamWebSockets.handleUpgrade(request, socket, head, (webSocket) => {
                webSocket.on("message", (data) => webSocket.send(`core:${String(data)}`))
            })
        })
        const upstream = await listen(upstreamServer)
        const downstreamServer = http.createServer()

        try {
            process.env.OPENADE_CORE_RUNTIME_URL = httpBaseToRuntimeUrl(upstream.baseUrl)
            downstreamRuntimeSocket = attachRuntimeSocketServer(downstreamServer)
            const downstream = await listen(downstreamServer)
            const client = await openSocket(httpBaseToRuntimeUrl(downstream.baseUrl), "core-device-token")

            client.send("ping")
            expect(String(await nextSocketMessage(client))).toBe("core:ping")
            expect(upstreamProtocols).toContain("bearer.core-device-token")

            client.close()
            await closeServer(downstream.server)
        } finally {
            downstreamRuntimeSocket?.close()
            upstreamWebSockets.close()
            await closeServer(upstream.server)
        }
    })
})
