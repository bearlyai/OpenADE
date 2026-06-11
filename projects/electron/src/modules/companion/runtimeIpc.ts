import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import type { RuntimeMessage, RuntimeRequest } from "../../../../runtime-protocol/src"
import type { RuntimeConnection } from "../../../../runtime/src"
import { getRuntimeServer } from "./runtimeGateway"
import { cloneRuntimeMessageForIpc, serializationErrorResponse } from "./runtimeIpcSerialization"

interface RendererRuntimeConnection {
    connection: RuntimeConnection
    dispose: () => void
}

const rendererConnections = new Map<number, RendererRuntimeConnection>()
let loaded = false

function connectionFor(webContents: WebContents): RendererRuntimeConnection {
    const existing = rendererConnections.get(webContents.id)
    if (existing) return existing

    const runtime = getRuntimeServer()
    const connection: RuntimeConnection = {
        id: `renderer:${webContents.id}`,
        send(message: RuntimeMessage) {
            if (!webContents.isDestroyed()) {
                try {
                    webContents.send("runtime:message", cloneRuntimeMessageForIpc(message))
                } catch (error) {
                    console.warn("[RuntimeIpc] Dropping non-serializable runtime message:", error)
                }
            }
        },
    }
    const disposeRuntime = runtime.connect(connection)
    const dispose = () => {
        disposeRuntime()
        rendererConnections.delete(webContents.id)
    }

    webContents.once("destroyed", dispose)
    const entry = { connection, dispose }
    rendererConnections.set(webContents.id, entry)
    return entry
}

function isRuntimeRequest(value: unknown): value is RuntimeRequest {
    if (typeof value !== "object" || value === null) return false
    const record = value as Record<string, unknown>
    return (typeof record.id === "string" || typeof record.id === "number") && typeof record.method === "string"
}

export function loadRuntimeIpc(): void {
    if (loaded) return
    ipcMain.handle("runtime:connect", (event: IpcMainInvokeEvent) => {
        connectionFor(event.sender)
        return { ok: true }
    })
    ipcMain.handle("runtime:disconnect", (event: IpcMainInvokeEvent) => {
        rendererConnections.get(event.sender.id)?.dispose()
        return { ok: true }
    })
    ipcMain.handle("runtime:request", async (event: IpcMainInvokeEvent, request: unknown) => {
        const queuedAtMs = Date.now()
        if (!isRuntimeRequest(request)) throw new Error("Invalid runtime request")
        const { connection } = connectionFor(event.sender)
        const response = await getRuntimeServer().handleRequest(request, connection, { requireInitialized: true, queuedAtMs })
        try {
            return cloneRuntimeMessageForIpc(response)
        } catch (error) {
            return serializationErrorResponse(request.id, error)
        }
    })
    loaded = true
}

export function cleanupRuntimeIpc(): void {
    if (!loaded) return
    ipcMain.removeHandler("runtime:connect")
    ipcMain.removeHandler("runtime:disconnect")
    ipcMain.removeHandler("runtime:request")
    for (const entry of rendererConnections.values()) {
        entry.dispose()
    }
    rendererConnections.clear()
    loaded = false
}
