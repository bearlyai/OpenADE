import http, { type IncomingMessage, type ServerResponse } from "node:http"
import { URL } from "node:url"
import logger from "electron-log"
import type { CompanionEvent, PairRequest, RemotePlatform, RemoteRunRequest } from "../../../../shared/companion/src"
import { authenticateDevice, pairDevice } from "./auth"
import { CompanionEventHub } from "./events"
import { getCompanionBindAddresses } from "./network"
import { callRenderer, setCompanionEventHub } from "./rendererBridge"

const MAX_BODY_BYTES = 2 * 1024 * 1024
const PAIR_RATE_LIMIT_WINDOW_MS = 60 * 1000
const PAIR_RATE_LIMIT_MAX_ATTEMPTS = 20

interface RunningServer {
    server: http.Server
    url: string
}

let runningServers: RunningServer[] = []
let eventHub = new CompanionEventHub()
const pairAttempts = new Map<string, { count: number; resetAt: number }>()

function setCors(response: ServerResponse): void {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Last-Event-ID")
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

function bearerToken(request: IncomingMessage): string | undefined {
    const header = request.headers.authorization
    if (!header) return undefined
    const match = /^Bearer\s+(.+)$/i.exec(header)
    return match?.[1]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function asOptionalString(value: unknown, field: string, maxLength: number): string | undefined {
    if (value === undefined) return undefined
    if (typeof value !== "string" || value.length > maxLength) throw new Error(`${field} is invalid`)
    return value
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

function parseRunRequest(body: unknown): RemoteRunRequest {
    if (!isRecord(body)) throw new Error("Request body must be an object")
    const repoId = body.repoId
    const type = body.type
    const input = body.input

    if (typeof repoId !== "string" || repoId.length < 1) throw new Error("repoId is invalid")
    if (type !== "plan" && type !== "do" && type !== "ask" && type !== "hyperplan") throw new Error("type is invalid")
    if (typeof input !== "string" || input.length < 1 || input.length > 200_000) throw new Error("input is invalid")

    const request: RemoteRunRequest = {
        repoId,
        type,
        input,
        appendSystemPrompt: asOptionalString(body.appendSystemPrompt, "appendSystemPrompt", 50_000),
        inTaskId: body.inTaskId === null ? null : asOptionalString(body.inTaskId, "inTaskId", 200),
        harnessId: asOptionalString(body.harnessId, "harnessId", 100),
        thinking: body.thinking === "low" || body.thinking === "med" || body.thinking === "high" || body.thinking === "max" ? body.thinking : undefined,
        fastMode: typeof body.fastMode === "boolean" ? body.fastMode : undefined,
        title: asOptionalString(body.title, "title", 200),
    }

    if (body.thinking !== undefined && request.thinking === undefined) throw new Error("thinking is invalid")
    if (body.fastMode !== undefined && typeof body.fastMode !== "boolean") throw new Error("fastMode is invalid")

    if (body.enabledMcpServerIds !== undefined) {
        if (!Array.isArray(body.enabledMcpServerIds) || body.enabledMcpServerIds.length > 50 || body.enabledMcpServerIds.some((id) => typeof id !== "string" || id.length < 1)) {
            throw new Error("enabledMcpServerIds is invalid")
        }
        request.enabledMcpServerIds = body.enabledMcpServerIds
    }

    if (body.isolationStrategy !== undefined) {
        if (!isRecord(body.isolationStrategy)) throw new Error("isolationStrategy is invalid")
        if (body.isolationStrategy.type === "head") {
            request.isolationStrategy = { type: "head" }
        } else if (body.isolationStrategy.type === "worktree" && typeof body.isolationStrategy.sourceBranch === "string" && body.isolationStrategy.sourceBranch.length > 0) {
            request.isolationStrategy = { type: "worktree", sourceBranch: body.isolationStrategy.sourceBranch }
        } else {
            throw new Error("isolationStrategy is invalid")
        }
    }

    return request
}

function lastEventId(request: IncomingMessage): number | undefined {
    const raw = request.headers["last-event-id"]
    const value = Array.isArray(raw) ? raw[0] : raw
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
}

function publish(event: CompanionEvent): void {
    eventHub.publish(event)
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
            const pathParts = url.pathname.split("/").filter(Boolean)

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

            const device = authenticateDevice(bearerToken(request))
            if (!device) {
                sendError(response, 401, "Unauthorized")
                return
            }

            if (request.method === "GET" && url.pathname === "/v1/events") {
                eventHub.addClient(device.id, response, lastEventId(request))
                return
            }

            if (request.method === "GET" && url.pathname === "/v1/snapshot") {
                const snapshot = await callRenderer("getSnapshot")
                sendJson(response, 200, snapshot)
                return
            }

            if (request.method === "POST" && url.pathname === "/v1/run") {
                const body = parseRunRequest(await readJson(request))
                const result = await callRenderer("run", body)
                sendJson(response, 200, result)
                return
            }

            if (request.method === "GET" && pathParts[0] === "v1" && pathParts[1] === "tasks" && pathParts[2]) {
                const repoId = url.searchParams.get("repoId")
                if (!repoId) {
                    sendError(response, 400, "repoId is required")
                    return
                }

                const task = await callRenderer("getTask", { repoId, taskId: pathParts[2] })
                sendJson(response, 200, task)
                return
            }

            if (request.method === "POST" && pathParts[0] === "v1" && pathParts[1] === "tasks" && pathParts[2] && pathParts[3] === "abort") {
                await callRenderer("abort", { taskId: pathParts[2] })
                sendJson(response, 200, { ok: true })
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

    eventHub = new CompanionEventHub()
    setCompanionEventHub(eventHub)

    const handler = createCompanionRequestHandler()
    const addresses = getCompanionBindAddresses()
    const nextServers: RunningServer[] = []

    try {
        for (const address of addresses) {
            const server = http.createServer(handler)
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject)
                server.listen(port, address.host, () => {
                    server.off("error", reject)
                    resolve()
                })
            })
            nextServers.push({ server, url: `http://${address.host}:${port}` })
        }
    } catch (error) {
        await stopServers(nextServers)
        setCompanionEventHub(null)
        throw error
    }

    runningServers = nextServers
    return runningServers.map((entry) => entry.url)
}

export async function stopCompanionServer(): Promise<void> {
    eventHub.closeAll()
    setCompanionEventHub(null)
    await stopServers(runningServers)
    runningServers = []
}

export function getBoundUrls(): string[] {
    return runningServers.map((entry) => entry.url)
}

export function closeCompanionStreams(deviceId?: string): void {
    if (deviceId) {
        eventHub.closeDevice(deviceId)
        return
    }
    eventHub.closeAll()
}

async function stopServers(servers: RunningServer[]): Promise<void> {
    await Promise.all(
        servers.map(
            (entry) =>
                new Promise<void>((resolve) => {
                    entry.server.close(() => resolve())
                })
        )
    )
}
