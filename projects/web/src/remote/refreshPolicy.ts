import type { RuntimeNotification } from "../../../runtime-protocol/src"

export type RemoteRefreshPlan =
    | { type: "none" }
    | { type: "snapshot" }
    | { type: "task"; repoId?: string; taskId: string }
    | { type: "snapshot-and-task"; repoId?: string; taskId?: string }
    | { type: "sessions" }

function paramsRecord(notification: RuntimeNotification): Record<string, unknown> {
    return typeof notification.params === "object" && notification.params !== null ? (notification.params as Record<string, unknown>) : {}
}

export function remoteRefreshPlan(notification: RuntimeNotification, selectedTaskId: string | null): RemoteRefreshPlan {
    const params = paramsRecord(notification)
    const repoId = typeof params.repoId === "string" ? params.repoId : undefined
    const taskId = typeof params.taskId === "string" ? params.taskId : undefined

    switch (notification.method) {
        case "openade/task/updated":
        case "openade/queuedTurn/updated":
            if (taskId && taskId === selectedTaskId) return { type: "task", repoId, taskId }
            return { type: "none" }
        case "openade/task/previewChanged":
        case "openade/workingTasks":
        case "openade/snapshotChanged":
        case "openade/repo/updated":
        case "openade/repo/deleted":
            return { type: "snapshot" }
        case "openade/task/deleted":
            return { type: "snapshot-and-task", repoId, taskId }
        case "connection/lagged":
            return { type: "snapshot-and-task", repoId, taskId: selectedTaskId ?? undefined }
        case "remote/device/changed":
            return { type: "sessions" }
        default:
            return { type: "none" }
    }
}
