import http from "node:http"
import { createHash, randomUUID } from "node:crypto"
import { isIP } from "node:net"
import { URL } from "node:url"
import { WebSocket, WebSocketServer, type RawData } from "ws"
import { RuntimeServer, type RuntimeConnection, type RuntimeServerOptions } from "../../runtime/src"
import { createRuntimeNodeLivenessProbe } from "./liveness"

export interface RuntimeNodeServerOptions extends Omit<RuntimeServerOptions, "livenessProbe"> {
    livenessProbe?: RuntimeServerOptions["livenessProbe"]
}

export interface RuntimeNodeHttpServerOptions {
    runtime?: RuntimeServer
    runtimeOptions?: RuntimeNodeServerOptions
    host?: string
    port?: number
    path?: string
    token?: string
    permissions?: string[]
    allowUnauthenticatedLoopback?: boolean
    maxBufferedBytes?: number
    heartbeatMs?: number
}

export interface RuntimeNodeHttpServer {
    runtime: RuntimeServer
    httpServer: http.Server
    url: string
    close(): Promise<void>
}

function rawText(data: RawData): string {
    if (typeof data === "string") return data
    if (Buffer.isBuffer(data)) return data.toString("utf8")
    if (Array.isArray(data)) return Buffer.concat(data).toString("utf8")
    return Buffer.from(data).toString("utf8")
}

function tokenFromRequest(request: http.IncomingMessage): string | null {
    const protocolHeader = request.headers["sec-websocket-protocol"]
    const protocols = Array.isArray(protocolHeader) ? protocolHeader.flatMap((value) => value.split(",")) : (protocolHeader ?? "").split(",")
    const bearer = protocols.map((value) => value.trim()).find((value) => value.startsWith("bearer."))
    return bearer?.slice("bearer.".length) ?? null
}

function clientRequestPrincipalFromRequest(request: http.IncomingMessage): string | undefined {
    const token = tokenFromRequest(request)
    if (!token) return undefined
    const tokenHash = createHash("sha256").update(token).digest("hex")
    return `runtime-token:${tokenHash}`
}

function isLoopbackHost(host: string): boolean {
    if (host === "localhost") return true
    if (host === "::1") return true
    if (host.startsWith("127.")) return true
    const ipVersion = isIP(host)
    return ipVersion === 6 && host === "::1"
}

function isAuthorized(request: http.IncomingMessage, options: Required<Pick<RuntimeNodeHttpServerOptions, "allowUnauthenticatedLoopback">> & Pick<RuntimeNodeHttpServerOptions, "host" | "token">): boolean {
    const token = tokenFromRequest(request)
    if (options.token) return token === options.token
    return options.allowUnauthenticatedLoopback && isLoopbackHost(options.host ?? "127.0.0.1")
}

function attachSocket(runtime: RuntimeServer, socket: WebSocket, request: http.IncomingMessage, options: RuntimeNodeHttpServerOptions): void {
    const connectionId = `node:${randomUUID()}`
    const maxBufferedBytes = options.maxBufferedBytes ?? 16 * 1024 * 1024
    const heartbeatMs = options.heartbeatMs ?? 30_000
    let alive = true
    let disposed = false
    let heartbeat: ReturnType<typeof setInterval>

    const connection: RuntimeConnection = {
        id: connectionId,
        permissions: options.permissions,
        metadata: {
            clientRequestPrincipal: clientRequestPrincipalFromRequest(request),
        },
        send(message) {
            if (socket.readyState !== WebSocket.OPEN) return
            if (socket.bufferedAmount > maxBufferedBytes) {
                socket.close(1013, "client is too far behind")
                runtime.notify("connection/lagged", { connectionId, bufferedAmount: socket.bufferedAmount })
                return
            }
            socket.send(JSON.stringify(message))
        },
        close() {
            socket.close()
        },
    }

    const disposeRuntimeConnection = runtime.connect(connection)
    const disposeOnce = () => {
        if (disposed) return
        disposed = true
        clearInterval(heartbeat)
        disposeRuntimeConnection()
    }

    heartbeat = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) {
            disposeOnce()
            return
        }
        if (!alive) {
            socket.terminate()
            disposeOnce()
            return
        }
        alive = false
        socket.ping()
    }, heartbeatMs)
    ;(heartbeat as { unref?: () => void }).unref?.()

    socket.on("message", (data) => {
        void runtime.handleMessage(connection, rawText(data))
    })
    socket.on("pong", () => {
        alive = true
    })
    socket.on("close", disposeOnce)
    socket.on("error", disposeOnce)
}

export function createRuntimeNodeServer(options: RuntimeNodeServerOptions): RuntimeServer {
    return new RuntimeServer({
        ...options,
        livenessProbe: options.livenessProbe ?? createRuntimeNodeLivenessProbe(),
    })
}

export async function serveRuntimeNodeHttp(options: RuntimeNodeHttpServerOptions = {}): Promise<RuntimeNodeHttpServer> {
    const host = options.host ?? "127.0.0.1"
    const port = options.port ?? 0
    const path = options.path ?? "/v1/runtime"
    const runtime =
        options.runtime ??
        createRuntimeNodeServer({
            serverName: "runtime-node",
            ...options.runtimeOptions,
        })
    const httpServer = http.createServer((_request, response) => {
        response.writeHead(404)
        response.end("not found")
    })
    const socketServer = new WebSocketServer({ noServer: true })

    httpServer.on("upgrade", (request, socket, head) => {
        const url = new URL(request.url ?? "/", `http://${host}`)
        if (url.pathname !== path) return

        if (!isAuthorized(request, { host, token: options.token, allowUnauthenticatedLoopback: options.allowUnauthenticatedLoopback ?? true })) {
            socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")
            socket.destroy()
            return
        }

        socketServer.handleUpgrade(request, socket, head, (webSocket) => {
            attachSocket(runtime, webSocket, request, options)
        })
    })

    await new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject)
        httpServer.listen(port, host, () => {
            httpServer.off("error", reject)
            resolve()
        })
    })

    const address = httpServer.address()
    const actualPort = typeof address === "object" && address ? address.port : port
    return {
        runtime,
        httpServer,
        url: `ws://${host}:${actualPort}${path}`,
        close: () =>
            new Promise<void>((resolve, reject) => {
                socketServer.close()
                httpServer.close((error) => {
                    if (error) reject(error)
                    else resolve()
                })
            }),
    }
}
