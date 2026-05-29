import { cleanupRuntimeIpc, loadRuntimeIpc } from "./companion/runtimeIpc"

export function load(): void {
    loadRuntimeIpc()
}

export function cleanup(): void {
    cleanupRuntimeIpc()
}
