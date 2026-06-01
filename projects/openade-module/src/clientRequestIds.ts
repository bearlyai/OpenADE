import { createHash } from "node:crypto"

function scopedHash(scope: string, clientRequestId: string): string {
    return createHash("sha256").update(scope).update("\0").update(clientRequestId).digest("hex").slice(0, 26)
}

export function openADETaskIdForClientRequest(repoId: string, clientRequestId: string | undefined): string | undefined {
    if (!clientRequestId) return undefined
    return `task-${scopedHash(repoId, clientRequestId)}`
}

export function openADEQueuedTurnIdForClientRequest(taskId: string, clientRequestId: string | undefined): string | undefined {
    if (!clientRequestId) return undefined
    return `queued-${scopedHash(taskId, clientRequestId)}`
}
