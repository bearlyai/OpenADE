import type { OpenADETurnType } from "../../../../openade-module/src"

export type TaskCommandType = OpenADETurnType

export const TASK_COMPOSER_COMMANDS: readonly TaskCommandType[] = ["do", "plan", "ask", "revise", "run_plan", "hyperplan"] as const
export const TASK_NEW_TASK_COMMANDS: readonly TaskCommandType[] = ["do", "plan", "ask", "hyperplan"] as const

export function taskCommandLabel(type: TaskCommandType, options: { queued?: boolean } = {}): string {
    if (type === "do") return options.queued ? "Do Next" : "Do"
    if (type === "ask") return options.queued ? "Ask Next" : "Ask"
    if (type === "revise") return "Revise Plan"
    if (type === "run_plan") return "Run Plan"
    if (type === "hyperplan") return "HyperPlan"
    return "Plan"
}

export function canQueueTaskCommandWhileRunning(type: TaskCommandType): type is "do" | "ask" {
    return type === "do" || type === "ask"
}
