import { RuntimeLocalClient, type RuntimeLocalTransport } from "../../../runtime-client/src"
import type { RuntimeMessage } from "../../../runtime-protocol/src"

const localRuntimeTransport: RuntimeLocalTransport = {
    connect() {
        if (!window.openadeAPI?.runtime) throw new Error("Local runtime IPC is not available")
        return window.openadeAPI.runtime.connect()
    },
    disconnect() {
        return window.openadeAPI?.runtime.disconnect()
    },
    request(request) {
        if (!window.openadeAPI?.runtime) throw new Error("Local runtime IPC is not available")
        return window.openadeAPI.runtime.request(request)
    },
    onMessage(listener) {
        if (!window.openadeAPI?.runtime) throw new Error("Local runtime IPC is not available")
        return window.openadeAPI.runtime.onMessage((message) => listener(message as RuntimeMessage))
    },
}

export const localRuntimeClient = new RuntimeLocalClient(localRuntimeTransport, {
    clientName: "OpenADE Desktop",
    clientPlatform: "desktop",
})
