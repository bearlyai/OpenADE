import { describe, expect, it } from "vitest"
import { getTaskCreationPhaseLabel } from "./taskCreationPhaseLabel"

describe("getTaskCreationPhaseLabel", () => {
    it("does not call head-mode task startup finalization", () => {
        expect(getTaskCreationPhaseLabel("completing", { type: "head" })).toBe("Starting task")
    })

    it("calls worktree startup workspace creation while server-owned startTurn is running", () => {
        expect(getTaskCreationPhaseLabel("completing", { type: "worktree", sourceBranch: "main" })).toBe("Creating workspace")
    })
})
