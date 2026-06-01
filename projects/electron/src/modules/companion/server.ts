import http, { type IncomingMessage, type ServerResponse } from "node:http"
import { URL } from "node:url"
import logger from "electron-log"
import type { CompanionEvent, PairRequest, RemotePlatform } from "../../../../shared/companion/src"
import { pairDevice } from "./auth"
import { getCompanionBindAddresses } from "./network"
import { publishCompanionRuntimeEvent, resetRuntimeServer } from "./runtimeGateway"
import { attachRuntimeSocketServer, type RuntimeSocketServer } from "./runtimeSocket"

const MAX_BODY_BYTES = 2 * 1024 * 1024
const PAIR_RATE_LIMIT_WINDOW_MS = 60 * 1000
const PAIR_RATE_LIMIT_MAX_ATTEMPTS = 20

interface RunningServer {
    server: http.Server
    runtimeSocket: RuntimeSocketServer
    url: string
}

let runningServers: RunningServer[] = []
const pairAttempts = new Map<string, { count: number; resetAt: number }>()

function setCors(response: ServerResponse): void {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
    setCors(response)
    response.writeHead(statusCode, { "Content-Type": "application/json" })
    response.end(JSON.stringify(body))
}

function sendError(response: ServerResponse, statusCode: number, message: string): void {
    sendJson(response, statusCode, { error: message })
}

function sendHtml(response: ServerResponse, statusCode: number, body: string): void {
    response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" })
    response.end(body)
}

function escapeHtml(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
}

function statusForError(error: unknown): number {
    const message = error instanceof Error ? error.message : "Unknown error"
    return message.includes("too large") ? 413 : message.includes("JSON") || message.includes("invalid") || message.includes("required") ? 400 : 500
}

function pairingPage(url: URL): string {
    const token = url.searchParams.get("token") ?? ""
    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenADE Companion Pairing</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #111; background: #fff; }
        code { display: block; padding: 10px; border: 1px solid #ddd; overflow-wrap: anywhere; }
    </style>
</head>
<body>
    <h1>OpenADE Companion Pairing</h1>
    <p>Open the OpenADE Companion app, tap Scan QR, or enter these values manually.</p>
    <h2>Host</h2>
    <code>${escapeHtml(url.origin)}</code>
    <h2>Pairing token</h2>
    <code>${escapeHtml(token)}</code>
</body>
</html>`
}

function pairAttemptKey(request: IncomingMessage): string {
    return request.socket.remoteAddress ?? "unknown"
}

function allowPairAttempt(request: IncomingMessage): boolean {
    const now = Date.now()
    const key = pairAttemptKey(request)
    const current = pairAttempts.get(key)
    if (!current || current.resetAt <= now) {
        pairAttempts.set(key, { count: 1, resetAt: now + PAIR_RATE_LIMIT_WINDOW_MS })
        return true
    }

    if (current.count >= PAIR_RATE_LIMIT_MAX_ATTEMPTS) return false
    current.count += 1
    return true
}

function clearPairAttempts(request: IncomingMessage): void {
    pairAttempts.delete(pairAttemptKey(request))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    let size = 0

    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > MAX_BODY_BYTES) throw new Error("Request body is too large")
        chunks.push(buffer)
    }

    const raw = Buffer.concat(chunks).toString("utf8")
    if (!raw.trim()) return {}
    return JSON.parse(raw)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function parsePairRequest(body: unknown): PairRequest {
    if (!isRecord(body)) throw new Error("Request body must be an object")
    const token = body.token
    const deviceName = body.deviceName
    const platform = body.platform ?? "unknown"
    if (typeof token !== "string" || token.length < 16) throw new Error("token is invalid")
    if (typeof deviceName !== "string" || deviceName.length < 1 || deviceName.length > 120) throw new Error("deviceName is invalid")
    if (platform !== "ios" && platform !== "android" && platform !== "web" && platform !== "unknown") throw new Error("platform is invalid")
    return { token, deviceName, platform: platform as RemotePlatform }
}

function publish(event: CompanionEvent): void {
    publishCompanionRuntimeEvent(event)
}

export function createCompanionRequestHandler(): http.RequestListener {
    return async (request, response) => {
        try {
            setCors(response)

            if (request.method === "OPTIONS") {
                response.writeHead(204)
                response.end()
                return
            }

            const url = new URL(request.url ?? "/", "http://127.0.0.1")

            if (request.method === "GET" && url.pathname === "/v1/health") {
                sendJson(response, 200, {
                    ok: true,
                })
                return
            }

            if (request.method === "GET" && url.pathname === "/pair") {
                sendHtml(response, 200, pairingPage(url))
                return
            }

            if (request.method === "POST" && url.pathname === "/v1/pair") {
                if (!allowPairAttempt(request)) {
                    sendError(response, 429, "Too many pairing attempts")
                    return
                }

                try {
                    const body = parsePairRequest(await readJson(request))
                    const result = pairDevice(body)
                    clearPairAttempts(request)
                    publish({ type: "devices_changed", at: new Date().toISOString() })
                    sendJson(response, 200, result)
                } catch (error) {
                    logger.warn("[Companion] pair failed", pairAttemptKey(request))
                    sendError(response, statusForError(error), "Pairing failed")
                }
                return
            }

            sendError(response, 404, "Not found")
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error"
            const statusCode = statusForError(error)
            logger.warn("[Companion] request failed", message)
            sendError(response, statusCode, message)
        }
    }
}

export async function startCompanionServer(port: number): Promise<string[]> {
    if (runningServers.length > 0) return runningServers.map((entry) => entry.url)

    const handler = createCompanionRequestHandler()
    const addresses = getCompanionBindAddresses()
    const nextServers: RunningServer[] = []

    try {
        for (const address of addresses) {
            const server = http.createServer(handler)
            const runtimeSocket = attachRuntimeSocketServer(server)
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject)
                server.listen(port, address.host, () => {
                    server.off("error", reject)
                    resolve()
                })
            })
            nextServers.push({ server, runtimeSocket, url: `http://${address.host}:${port}` })
        }
    } catch (error) {
        await stopServers(nextServers)
        throw error
    }

    runningServers = nextServers
    return runningServers.map((entry) => entry.url)
}

export async function stopCompanionServer(): Promise<void> {
    resetRuntimeServer()
    await stopServers(runningServers)
    runningServers = []
}

export function getBoundUrls(): string[] {
    return runningServers.map((entry) => entry.url)
}

async function stopServers(servers: RunningServer[]): Promise<void> {
    await Promise.all(
        servers.map(
            (entry) =>
                new Promise<void>((resolve) => {
                    entry.runtimeSocket.close()
                    entry.server.close(() => resolve())
                })
        )
    )
}
