import { RuntimeLocalClient, type RuntimeLocalTransport } from "../../../runtime-client/src"
import type { RuntimeMessage, RuntimeRequest } from "../../../runtime-protocol/src"

const localRuntimeTransport: RuntimeLocalTransport = {
    connect() {
        if (!window.openadeAPI?.runtime) throw new Error("Local runtime IPC is not available")
        return window.openadeAPI.runtime.connect()
    },
    disconnect() {
        return window.openadeAPI?.runtime?.disconnect()
    },
    request(request) {
        if (!window.openadeAPI?.runtime) throw new Error("Local runtime IPC is not available")
        return window.openadeAPI.runtime.request(cloneRuntimeRequestForIpc(request))
    },
    onMessage(listener) {
        if (!window.openadeAPI?.runtime) throw new Error("Local runtime IPC is not available")
        return window.openadeAPI.runtime.onMessage((message) => listener(message as RuntimeMessage))
    },
}

export function cloneRuntimeRequestForIpc(request: RuntimeRequest): RuntimeRequest {
    const serialized = JSON.stringify(request)
    if (serialized === undefined) throw new Error("Runtime request must be JSON serializable")
    return JSON.parse(serialized) as RuntimeRequest
}

export const localRuntimeClient = new RuntimeLocalClient(localRuntimeTransport, {
    clientName: "OpenADE Desktop",
    clientPlatform: "desktop",
})
