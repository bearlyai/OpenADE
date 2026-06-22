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

    it("uses scoped task-list refreshes for task preview notifications", () => {
        expect(remoteRefreshPlan({ method: "openade/task/previewChanged", params: { repoId: "repo-1", taskId: "task-1" } }, "task-1")).toEqual({
            type: "project-task-list",
            repoId: "repo-1",
        })
        expect(remoteRefreshPlan({ method: "openade/task/previewChanged", params: { taskId: "task-1" } }, "task-1")).toEqual({
            type: "snapshot",
        })
    })

    it("uses scoped task-list refreshes for repo-scoped task deletion notifications", () => {
        expect(remoteRefreshPlan({ method: "openade/task/deleted", params: { repoId: "repo-1", taskId: "task-1" } }, "task-1")).toEqual({
            type: "project-task-list",
            repoId: "repo-1",
        })
        expect(
            remoteRefreshPlan({ method: "openade/snapshotChanged", params: { type: "task_deleted", repoId: "repo-1", taskId: "task-1" } }, "task-1")
        ).toEqual({
            type: "project-task-list",
            repoId: "repo-1",
        })
        expect(remoteRefreshPlan({ method: "openade/task/deleted", params: { taskId: "task-1" } }, "task-1")).toEqual({
            type: "snapshot-and-task",
            taskId: "task-1",
        })
    })

    it("patches working task ids when the notification carries a complete list", () => {
        expect(remoteRefreshPlan({ method: "openade/workingTasks", params: { taskIds: ["task-1", "task-2"] } }, "task-1")).toEqual({
            type: "working-tasks",
            taskIds: ["task-1", "task-2"],
        })
        expect(remoteRefreshPlan({ method: "openade/workingTasks", params: { taskIds: ["task-1", 2] } }, "task-1")).toEqual({ type: "snapshot" })
    })

    it("does not force broad repair reads when the connection is already lagged", () => {
        expect(remoteRefreshPlan({ method: "connection/lagged", params: { requestedCursor: "1" } }, "task-1")).toEqual({
            type: "none",
        })
    })
})
