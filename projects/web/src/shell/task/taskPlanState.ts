import type { OpenADETask } from "../../../../openade-module/src"

function recordValue(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null
}

function eventSourceType(event: Record<string, unknown>): string | null {
    const source = recordValue(event.source)
    return typeof source?.type === "string" ? source.type : null
}

export function latestActivePlanEventId(task: Pick<OpenADETask, "events" | "cancelledPlanEventId"> | null | undefined): string | null {
    if (!task) return null
    const latestPlanIndex = (() => {
        for (let index = task.events.length - 1; index >= 0; index -= 1) {
            const event = recordValue(task.events[index])
            if (!event || event.type !== "action" || event.status !== "completed" || typeof event.id !== "string") continue
            const sourceType = eventSourceType(event)
            if (sourceType === "plan" || sourceType === "revise" || sourceType === "hyperplan") return index
        }
        return -1
    })()
    if (latestPlanIndex < 0) return null

    const latestPlan = recordValue(task.events[latestPlanIndex])
    const latestPlanId = typeof latestPlan?.id === "string" ? latestPlan.id : null
    if (!latestPlanId || latestPlanId === task.cancelledPlanEventId) return null

    for (let index = latestPlanIndex + 1; index < task.events.length; index += 1) {
        const event = recordValue(task.events[index])
        if (!event || event.type !== "action") continue
        const sourceType = eventSourceType(event)
        if (sourceType === "run_plan" || sourceType === "do") return null
    }
    return latestPlanId
}

export function taskHasActivePlan(task: Pick<OpenADETask, "events" | "cancelledPlanEventId"> | null | undefined): boolean {
    return latestActivePlanEventId(task) !== null
}

export function taskHasRetryableLastAction(task: Pick<OpenADETask, "events"> | null | undefined): boolean {
    const lastEvent = task?.events.at(-1)
    const event = recordValue(lastEvent)
    return event?.type === "action" && event.status === "error"
}
