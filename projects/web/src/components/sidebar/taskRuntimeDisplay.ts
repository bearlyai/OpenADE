import type { OpenADETaskPreview } from "../../../../openade-module/src"

type OpenADETaskPreviewLastEvent = NonNullable<OpenADETaskPreview["lastEvent"]>

const zeroTime = new Date(0).toISOString()

export function runtimeFirstTaskDisplayEvent(lastEvent: OpenADETaskPreviewLastEvent | undefined, isRunning: boolean): OpenADETaskPreviewLastEvent | null {
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
