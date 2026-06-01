import { describe, expect, it } from "vitest"
import { buildTaskShellCommandDescriptors } from "./taskCommandModel"
import type { TaskShellCommandContext } from "./taskCommandModel"

const idleContext: TaskShellCommandContext = {
    repeatActive: false,
    closed: false,
    working: false,
    activePlan: false,
    feedback: true,
    input: true,
    retryable: false,
    actionHistory: true,
    gitWorkingChanges: false,
    unpushedCommits: false,
    commitAndPushInProgress: false,
}

function ids(context: TaskShellCommandContext): string[] {
    return buildTaskShellCommandDescriptors(context).map((command) => command.id)
}

describe("buildTaskShellCommandDescriptors", () => {
    it("keeps running no-plan tasks queueable through Do and Ask while exposing Stop and Interrupt", () => {
        const commands = buildTaskShellCommandDescriptors({ ...idleContext, working: true, activePlan: false })

        expect(commands.map((command) => command.id)).toEqual(["stop", "interrupt", "do", "ask"])
        expect(commands.find((command) => command.id === "do")).toMatchObject({ label: "Do Next", enabled: true })
        expect(commands.find((command) => command.id === "ask")).toMatchObject({ label: "Ask Next", enabled: true })
    })

    it("shows plan lifecycle commands when an active plan is idle", () => {
        expect(ids({ ...idleContext, activePlan: true })).toEqual(["runPlan", "revise", "cancelPlan", "reviewPlan", "ask", "close"])
    })

    it("shows review, repeat, and commit controls only when their production state is present", () => {
        expect(ids({ ...idleContext, actionHistory: false, input: false })).toEqual(["do", "plan", "ask", "repeat", "close"])
        expect(buildTaskShellCommandDescriptors({ ...idleContext, gitWorkingChanges: true }).map((command) => command.id)).toContain("commitAndPush")
        expect(buildTaskShellCommandDescriptors({ ...idleContext, unpushedCommits: true }).map((command) => command.id)).toContain("commitAndPush")
    })

    it("uses repeat-specific controls while repeat mode owns the task", () => {
        expect(ids({ ...idleContext, repeatActive: true })).toEqual(["repeatStop", "close"])
    })

    it("reopens closed tasks and hides close", () => {
        expect(ids({ ...idleContext, closed: true })).toContain("reopen")
        expect(ids({ ...idleContext, closed: true })).not.toContain("close")
    })
})
