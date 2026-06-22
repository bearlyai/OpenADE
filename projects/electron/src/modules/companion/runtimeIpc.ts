import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import { validateRuntimeRequest, type RuntimeMessage } from "../../../../runtime-protocol/src"
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

function rawRuntimeIpcMessage(value: unknown): string {
    try {
        return JSON.stringify(value) ?? "undefined"
    } catch {
        return "{"
    }
}

async function handleInvalidRuntimeIpcRequest(request: unknown, connection: RuntimeConnection): Promise<RuntimeMessage> {
    let response: RuntimeMessage | null = null
    const protocolConnection: RuntimeConnection = {
        ...connection,
        send(message) {
            response = message
        },
    }
    await getRuntimeServer().handleMessage(protocolConnection, rawRuntimeIpcMessage(request))
    if (!response) throw new Error("Runtime protocol handler did not return a response")
    return response
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
        const validation = validateRuntimeRequest(request)
        const { connection } = connectionFor(event.sender)
        const response = validation.ok
            ? await getRuntimeServer().handleRequest(validation.value, connection, { requireInitialized: true, queuedAtMs })
            : await handleInvalidRuntimeIpcRequest(request, connection)
        try {
            return cloneRuntimeMessageForIpc(response)
        } catch (error) {
            const responseId = validation.ok ? validation.value.id : "serialization-error"
            return serializationErrorResponse(responseId, error)
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
