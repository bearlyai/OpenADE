import { OPENADE_NOTIFICATION } from "../../../openade-client/src"
import type { RuntimeNotification } from "../../../runtime-protocol/src"

export type RemoteRefreshPlan =
    | { type: "none" }
    | { type: "snapshot" }
    | { type: "project-task-list"; repoId?: string }
    | { type: "task"; repoId?: string; taskId: string }
    | { type: "snapshot-and-task"; repoId?: string; taskId?: string }
    | { type: "working-tasks"; taskIds: string[] }
    | { type: "sessions" }

function paramsRecord(notification: RuntimeNotification): Record<string, unknown> {
    return typeof notification.params === "object" && notification.params !== null ? (notification.params as Record<string, unknown>) : {}
}

function stringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null
    const result = value.filter((item): item is string => typeof item === "string")
    return result.length === value.length ? result : null
}

export function remoteRefreshPlan(notification: RuntimeNotification, selectedTaskId: string | null): RemoteRefreshPlan {
    const params = paramsRecord(notification)
    const repoId = typeof params.repoId === "string" ? params.repoId : undefined
    const taskId = typeof params.taskId === "string" ? params.taskId : undefined
    const bridgeEventType = typeof params.type === "string" ? params.type : undefined

    switch (notification.method) {
        case OPENADE_NOTIFICATION.taskUpdated:
        case OPENADE_NOTIFICATION.queuedTurnUpdated:
            if (taskId && taskId === selectedTaskId) return { type: "task", repoId, taskId }
            return { type: "none" }
        case OPENADE_NOTIFICATION.taskPreviewChanged:
            return repoId ? { type: "project-task-list", repoId } : { type: "snapshot" }
        case OPENADE_NOTIFICATION.workingTasks: {
            const taskIds = stringArray(params.taskIds)
            return taskIds ? { type: "working-tasks", taskIds } : { type: "snapshot" }
        }
        case OPENADE_NOTIFICATION.snapshotChanged:
            if (bridgeEventType === "task_deleted" && repoId) return { type: "project-task-list", repoId }
            return { type: "snapshot" }
        case OPENADE_NOTIFICATION.repoUpdated:
        case OPENADE_NOTIFICATION.repoDeleted:
            return { type: "snapshot" }
        case OPENADE_NOTIFICATION.taskDeleted:
            return repoId ? { type: "project-task-list", repoId } : { type: "snapshot-and-task", repoId, taskId }
        case "connection/lagged":
            return { type: "none" }
        case OPENADE_NOTIFICATION.remoteDeviceChanged:
            return { type: "sessions" }
        default:
            return { type: "none" }
    }
}
