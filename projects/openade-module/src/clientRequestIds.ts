import { sha256Hex } from "./sha256"

function scopedHash(scope: string, clientRequestId: string): string {
    return sha256Hex(`${scope}\0${clientRequestId}`).slice(0, 26)
}

export function openADETaskIdForClientRequest(repoId: string, clientRequestId: string | undefined): string | undefined {
    if (!clientRequestId) return undefined
    return `task-${scopedHash(repoId, clientRequestId)}`
}

export function openADEQueuedTurnIdForClientRequest(taskId: string, clientRequestId: string | undefined): string | undefined {
    if (!clientRequestId) return undefined
    return `queued-${scopedHash(taskId, clientRequestId)}`
}
