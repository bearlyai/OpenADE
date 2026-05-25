import { ipcMain } from "electron"
import { randomUUID } from "node:crypto"
import { currentExecutor } from "../../executor"
import type { CompanionEvent, CompanionRequest, CompanionResponse } from "../../../../shared/companion/src"
import type { CompanionEventHub } from "./events"
import { configurePowerKeeper } from "./powerKeeper"

const REQUEST_TIMEOUT_MS = 30_000

interface PendingRequest {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
}

let pendingRequests = new Map<string, PendingRequest>()
let eventHub: CompanionEventHub | null = null

function parseJsonIpcPayload<T>(payload: unknown): T {
    return typeof payload === "string" ? (JSON.parse(payload) as T) : (payload as T)
}

export function setCompanionEventHub(next: CompanionEventHub | null): void {
    eventHub = next
}

export function callRenderer(method: CompanionRequest["method"], params?: unknown): Promise<unknown> {
    const window = currentExecutor().window
    if (!window || window.isDestroyed()) {
        return Promise.reject(new Error("OpenADE window is not ready"))
    }

    const id = randomUUID()
    const request = { id, method, params } as CompanionRequest

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingRequests.delete(id)
            reject(new Error(`Renderer timed out handling ${method}`))
        }, REQUEST_TIMEOUT_MS)

        pendingRequests.set(id, { resolve, reject, timeout })
        window.webContents.send("companion:request", request)
    })
}

export function loadRendererBridge(): void {
    ipcMain.handle("companion:response", (event, payload: unknown) => {
        const window = currentExecutor().window
        if (!window || event.sender !== window.webContents) return
        const response = parseJsonIpcPayload<CompanionResponse>(payload)

        const pending = pendingRequests.get(response.id)
        if (!pending) return
        pendingRequests.delete(response.id)
        clearTimeout(pending.timeout)

        if (response.ok) {
            pending.resolve(response.result)
        } else {
            pending.reject(new Error(response.error))
        }
    })

    ipcMain.handle("companion:event", (event, payload: unknown) => {
        const window = currentExecutor().window
        if (!window || event.sender !== window.webContents) return
        const companionEvent = parseJsonIpcPayload<CompanionEvent>(payload)

        if (companionEvent.type === "working_tasks") {
            configurePowerKeeper({ runningTaskCount: companionEvent.taskIds.length })
        }
        eventHub?.publish(companionEvent)
    })
}

export function cleanupRendererBridge(): void {
    ipcMain.removeHandler("companion:response")
    ipcMain.removeHandler("companion:event")
    for (const pending of pendingRequests.values()) {
        clearTimeout(pending.timeout)
        pending.reject(new Error("Companion bridge is shutting down"))
    }
    pendingRequests = new Map()
    eventHub = null
}
