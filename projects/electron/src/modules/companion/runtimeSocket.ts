import type http from "node:http"
import { randomUUID } from "node:crypto"
import { URL } from "node:url"
import { COMPANION_RUNTIME_NOTIFICATION_PERMISSIONS, COMPANION_RUNTIME_PERMISSIONS } from "../../../../shared/companion/src"
import { WebSocket, WebSocketServer, type RawData } from "ws"
import { authenticateDevice } from "./auth"
import { attachCoreRuntimeSocketProxy, isCoreRuntimeBridgeEnabled } from "./coreBridge"
import { getRuntimeServer } from "./runtimeGateway"
import { registerRemoteDeviceStreamCloser } from "./runtimeDeviceStreams"

export interface RuntimeSocketServer {
    close(): void
    closeDevice(deviceId: string): void
    closeAll(): void
}

function socketToken(request: http.IncomingMessage): string | undefined {
    const protocolHeader = request.headers["sec-websocket-protocol"]
    const protocols = Array.isArray(protocolHeader) ? protocolHeader.flatMap((value) => value.split(",")) : (protocolHeader ?? "").split(",")
    const bearer = protocols.map((value) => value.trim()).find((value) => value.startsWith("bearer."))
    return bearer?.slice("bearer.".length)
}

function rawText(data: RawData): string {
    if (typeof data === "string") return data
    if (Buffer.isBuffer(data)) return data.toString("utf8")
    if (Array.isArray(data)) return Buffer.concat(data).toString("utf8")
    return Buffer.from(data).toString("utf8")
}

export function attachRuntimeSocketServer(server: http.Server): RuntimeSocketServer {
    const socketServer = new WebSocketServer({ noServer: true })
    const socketsByDeviceId = new Map<string, Set<WebSocket>>()
    const coreProxySockets = new Set<WebSocket>()
    const closeFromThisServer = (deviceId?: string) => {
        if (deviceId) {
            closeDeviceSockets(socketsByDeviceId, deviceId)
            return
        }
        closeAllDeviceSockets(socketsByDeviceId)
        closeSockets(coreProxySockets)
        coreProxySockets.clear()
    }
    const unregisterStreamCloser = registerRemoteDeviceStreamCloser(closeFromThisServer)

    const unregister = (deviceId: string, webSocket: WebSocket) => {
        const sockets = socketsByDeviceId.get(deviceId)
        if (!sockets) return
        sockets.delete(webSocket)
        if (sockets.size === 0) socketsByDeviceId.delete(deviceId)
    }

    server.on("upgrade", (request, socket, head) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1")
        if (url.pathname !== "/v1/runtime") return

        if (isCoreRuntimeBridgeEnabled()) {
            socketServer.handleUpgrade(request, socket, head, (webSocket) => {
                coreProxySockets.add(webSocket)
                webSocket.once("close", () => coreProxySockets.delete(webSocket))
                webSocket.once("error", () => coreProxySockets.delete(webSocket))
                attachCoreRuntimeSocketProxy(webSocket, request)
            })
            return
        }

        const device = authenticateDevice(socketToken(request))
        if (!device) {
            socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")
            socket.destroy()
            return
        }

        socketServer.handleUpgrade(request, socket, head, (webSocket) => {
            const sockets = socketsByDeviceId.get(device.id) ?? new Set<WebSocket>()
            sockets.add(webSocket)
            socketsByDeviceId.set(device.id, sockets)
            webSocket.once("close", () => unregister(device.id, webSocket))
            webSocket.once("error", () => unregister(device.id, webSocket))
            attachRuntimeSocket(webSocket, device.id)
        })
    })

    return {
        closeDevice(deviceId: string) {
            closeFromThisServer(deviceId)
        },
        closeAll() {
            closeFromThisServer()
        },
        close() {
            unregisterStreamCloser()
            closeFromThisServer()
            socketServer.close()
        },
    }
}

const MAX_BUFFERED_BYTES = 16 * 1024 * 1024
const HEARTBEAT_MS = 30_000
type DeviceSocketMap = Map<string, Set<WebSocket>>

function closeSockets(sockets: Iterable<WebSocket>) {
    for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
            socket.close(1008, "device disconnected")
        }
    }
}

function closeDeviceSockets(group: DeviceSocketMap, deviceId: string): void {
    closeSockets(group.get(deviceId) ?? [])
    group.delete(deviceId)
}

function closeAllDeviceSockets(group: DeviceSocketMap): void {
    for (const sockets of group.values()) closeSockets(sockets)
    group.clear()
}

function attachRuntimeSocket(webSocket: WebSocket, deviceId: string): void {
    const runtime = getRuntimeServer()
    const connectionId = `${deviceId}:${randomUUID()}`
    let alive = true
    let disposed = false
    let heartbeat: ReturnType<typeof setInterval>
    const connection = {
        id: connectionId,
        metadata: { deviceId },
        permissions: [...COMPANION_RUNTIME_PERMISSIONS],
        notificationPermissions: [...COMPANION_RUNTIME_NOTIFICATION_PERMISSIONS],
        send(message: unknown) {
            if (webSocket.readyState === WebSocket.OPEN) {
                if (webSocket.bufferedAmount > MAX_BUFFERED_BYTES) {
                    webSocket.close(1013, "client is too far behind")
                    runtime.notify("connection/lagged", { connectionId, deviceId, bufferedAmount: webSocket.bufferedAmount })
                    return
                }
                webSocket.send(JSON.stringify(message))
            }
        },
        close() {
            webSocket.close()
        },
    }
    const dispose = runtime.connect(connection)
    const disposeOnce = () => {
        if (disposed) return
        disposed = true
        clearInterval(heartbeat)
        dispose()
    }
    heartbeat = setInterval(() => {
        if (webSocket.readyState !== WebSocket.OPEN) {
            disposeOnce()
            return
        }
        if (!alive) {
            webSocket.terminate()
            disposeOnce()
            return
        }
        alive = false
        webSocket.ping()
    }, HEARTBEAT_MS)

    webSocket.on("message", (data) => {
        void runtime.handleMessage(connection, rawText(data))
    })
    webSocket.on("pong", () => {
        alive = true
    })
    webSocket.on("close", disposeOnce)
    webSocket.on("error", disposeOnce)
}
