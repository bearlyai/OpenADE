import { describe, expect, it } from "vitest"
import { TASK_COMPOSER_COMMANDS, TASK_NEW_TASK_COMMANDS, canQueueTaskCommandWhileRunning, taskCommandLabel } from "./taskCommands"

describe("task command model", () => {
    it("keeps shared composer command order stable", () => {
        expect(TASK_COMPOSER_COMMANDS).toEqual(["do", "plan", "ask", "revise", "run_plan", "hyperplan"])
        expect(TASK_NEW_TASK_COMMANDS).toEqual(["do", "plan", "ask", "hyperplan"])
    })

    it("uses consistent labels for desktop and remote command controls", () => {
        expect(taskCommandLabel("do")).toBe("Do")
        expect(taskCommandLabel("do", { queued: true })).toBe("Do Next")
        expect(taskCommandLabel("ask", { queued: true })).toBe("Ask Next")
        expect(taskCommandLabel("revise")).toBe("Revise Plan")
        expect(taskCommandLabel("run_plan")).toBe("Run Plan")
        expect(taskCommandLabel("hyperplan")).toBe("HyperPlan")
    })

    it("allows prompt-like commands to queue while a task is running", () => {
        expect(canQueueTaskCommandWhileRunning("do")).toBe(true)
        expect(canQueueTaskCommandWhileRunning("ask")).toBe(true)
        expect(canQueueTaskCommandWhileRunning("hyperplan")).toBe(true)
        expect(canQueueTaskCommandWhileRunning("plan")).toBe(false)
        expect(canQueueTaskCommandWhileRunning("run_plan")).toBe(false)
    })
})
