import type http from "node:http"
import { URL } from "node:url"
import { WebSocket, type RawData } from "ws"
import { envFlag } from "../envFlag"

const MAX_PROXY_BUFFERED_BYTES = 16 * 1024 * 1024

export interface CorePairProxyResult {
    statusCode: number
    body: unknown
}

export function coreRuntimeEndpointFromEnv(env: NodeJS.ProcessEnv = process.env): URL | null {
    if (envFlag(env.OPENADE_DISABLE_OPENADE_CORE)) return null

    const rawUrl = env.OPENADE_CORE_RUNTIME_URL?.trim()
    if (!rawUrl) return null

    try {
        const url = new URL(rawUrl)
        return url.protocol === "ws:" || url.protocol === "wss:" ? url : null
    } catch {
        return null
    }
}

export function isCoreRuntimeBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return coreRuntimeEndpointFromEnv(env) !== null
}

export function corePairEndpointFromRuntimeEndpoint(runtimeEndpoint: URL): string {
    const url = new URL(runtimeEndpoint.toString())
    url.protocol = runtimeEndpoint.protocol === "wss:" ? "https:" : "http:"
    url.pathname = "/v1/pair"
    url.search = ""
    url.hash = ""
    return url.toString()
}

export async function proxyPairRequestToCore(body: unknown, env: NodeJS.ProcessEnv = process.env): Promise<CorePairProxyResult> {
    const runtimeEndpoint = coreRuntimeEndpointFromEnv(env)
    if (!runtimeEndpoint) throw new Error("OpenADE Core runtime endpoint is not configured")

    const response = await fetch(corePairEndpointFromRuntimeEndpoint(runtimeEndpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })
    const text = await response.text()
    return {
        statusCode: response.status,
        body: parseCoreJsonResponse(text),
    }
}

function parseCoreJsonResponse(text: string): unknown {
    if (!text.trim()) return {}
    try {
        return JSON.parse(text)
    } catch {
        return { error: "Core pairing response was not JSON" }
    }
}

function bearerProtocol(request: http.IncomingMessage): string | null {
    const protocolHeader = request.headers["sec-websocket-protocol"]
    const protocols = Array.isArray(protocolHeader) ? protocolHeader.flatMap((value) => value.split(",")) : (protocolHeader ?? "").split(",")
    return protocols.map((value) => value.trim()).find((value) => value.startsWith("bearer.")) ?? null
}

function rawDataByteLength(data: RawData): number {
    if (typeof data === "string") return Buffer.byteLength(data)
    if (Buffer.isBuffer(data)) return data.length
    if (Array.isArray(data)) return data.reduce((total, chunk) => total + chunk.length, 0)
    return data.byteLength
}

function safeCloseCode(code: number): number {
    return code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 && code !== 1015 ? code : 1011
}

function closeSocket(socket: WebSocket, code: number, reason: string): void {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(code, reason)
    }
}

export function attachCoreRuntimeSocketProxy(clientSocket: WebSocket, request: http.IncomingMessage, env: NodeJS.ProcessEnv = process.env): boolean {
    const runtimeEndpoint = coreRuntimeEndpointFromEnv(env)
    if (!runtimeEndpoint) return false

    const protocol = bearerProtocol(request)
    if (!protocol) {
        closeSocket(clientSocket, 1008, "missing runtime token")
        return true
    }

    const upstreamSocket = new WebSocket(runtimeEndpoint.toString(), [protocol])
    const pendingClientMessages: RawData[] = []
    let pendingBytes = 0

    const sendToUpstream = (data: RawData) => {
        if (upstreamSocket.readyState === WebSocket.OPEN) {
            upstreamSocket.send(data)
            return
        }
        if (upstreamSocket.readyState !== WebSocket.CONNECTING) {
            closeSocket(clientSocket, 1011, "core runtime unavailable")
            return
        }

        pendingBytes += rawDataByteLength(data)
        if (pendingBytes > MAX_PROXY_BUFFERED_BYTES) {
            closeSocket(clientSocket, 1013, "client is too far ahead")
            closeSocket(upstreamSocket, 1013, "client is too far ahead")
            return
        }
        pendingClientMessages.push(data)
    }

    upstreamSocket.once("open", () => {
        for (const data of pendingClientMessages.splice(0)) upstreamSocket.send(data)
        pendingBytes = 0
    })
    upstreamSocket.on("message", (data) => {
        if (clientSocket.readyState === WebSocket.OPEN) {
            if (clientSocket.bufferedAmount > MAX_PROXY_BUFFERED_BYTES) {
                closeSocket(clientSocket, 1013, "client is too far behind")
                closeSocket(upstreamSocket, 1013, "client is too far behind")
                return
            }
            clientSocket.send(data)
        }
    })
    upstreamSocket.once("close", (code, reason) => {
        closeSocket(clientSocket, safeCloseCode(code), reason.toString("utf8").slice(0, 120))
    })
    upstreamSocket.once("error", () => {
        closeSocket(clientSocket, 1011, "core runtime unavailable")
    })

    clientSocket.on("message", sendToUpstream)
    clientSocket.once("close", () => closeSocket(upstreamSocket, 1000, "client disconnected"))
    clientSocket.once("error", () => closeSocket(upstreamSocket, 1011, "client socket error"))

    return true
}
