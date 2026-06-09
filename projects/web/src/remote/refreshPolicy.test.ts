import { describe, expect, it } from "vitest"
import { remoteRefreshPlan } from "./refreshPolicy"

describe("remoteRefreshPlan", () => {
    it("refreshes only the open task for selected task update notifications", () => {
        expect(remoteRefreshPlan({ method: "openade/task/updated", params: { repoId: "repo-1", taskId: "task-1" } }, "task-1")).toEqual({
            type: "task",
            repoId: "repo-1",
            taskId: "task-1",
        })
    })

    it("does not refresh task details for unrelated task update notifications", () => {
        expect(remoteRefreshPlan({ method: "openade/task/updated", params: { repoId: "repo-1", taskId: "task-2" } }, "task-1")).toEqual({
            type: "none",
        })
    })

    it("refreshes only the open task for selected queued-turn update notifications", () => {
        expect(remoteRefreshPlan({ method: "openade/queuedTurn/updated", params: { repoId: "repo-1", taskId: "task-1" } }, "task-1")).toEqual({
            type: "task",
            repoId: "repo-1",
            taskId: "task-1",
        })
        expect(remoteRefreshPlan({ method: "openade/queuedTurn/updated", params: { repoId: "repo-1", taskId: "task-2" } }, "task-1")).toEqual({
            type: "none",
        })
    })

    it("uses snapshot refreshes for list-level notifications", () => {
        expect(remoteRefreshPlan({ method: "openade/task/previewChanged", params: { repoId: "repo-1", taskId: "task-1" } }, "task-1")).toEqual({
            type: "snapshot",
        })
        expect(remoteRefreshPlan({ method: "openade/workingTasks", params: { taskIds: ["task-1"] } }, "task-1")).toEqual({ type: "snapshot" })
    })

    it("treats lag as cache resync instead of connection status", () => {
        expect(remoteRefreshPlan({ method: "connection/lagged", params: { requestedCursor: "1" } }, "task-1")).toEqual({
            type: "snapshot-and-task",
            taskId: "task-1",
        })
    })
})
