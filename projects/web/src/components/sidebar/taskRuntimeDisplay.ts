import type { TaskPreviewLastEvent } from "@/persistence/repoStore"

const zeroTime = new Date(0).toISOString()

export function runtimeFirstTaskDisplayEvent(lastEvent: TaskPreviewLastEvent | undefined, isRunning: boolean): TaskPreviewLastEvent | null {
    if (lastEvent?.status === "in_progress") return lastEvent
    if (!isRunning) return null

    if (lastEvent) {
        return {
            ...lastEvent,
            status: "in_progress",
        }
    }

    return {
        type: "action",
        status: "in_progress",
        sourceLabel: "Running",
        at: zeroTime,
    }
}
