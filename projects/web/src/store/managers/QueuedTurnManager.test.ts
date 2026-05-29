import { describe, expect, it } from "vitest"
import type { QueuedTurn } from "../../types"
import { QueuedTurnManager } from "./QueuedTurnManager"

const queuedTurn: QueuedTurn = {
    id: "queued-1",
    type: "do",
    input: "ship it",
    status: "queued",
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
}

describe("QueuedTurnManager", () => {
    it("keeps accepted queued turns visible until server lifecycle state supersedes them", () => {
        const manager = new QueuedTurnManager()

        manager.acceptQueuedTurn("task-1", queuedTurn)

        expect(manager.queuedForTask("task-1", [])).toEqual([queuedTurn])

        manager.applyNotification({
            method: "openade/queuedTurn/updated",
            params: {
                repoId: "repo-1",
                taskId: "task-1",
                turn: { ...queuedTurn, status: "running", updatedAt: "2026-05-28T00:00:01.000Z" },
            },
        })

        expect(manager.queuedForTask("task-1", [queuedTurn])).toEqual([])
    })

    it("lets refreshed storage own matching queued turns", () => {
        const manager = new QueuedTurnManager()

        manager.acceptQueuedTurn("task-1", queuedTurn)
        manager.reconcileTaskWithStorage("task-1", [queuedTurn])

        expect(manager.queuedForTask("task-1", [queuedTurn])).toEqual([queuedTurn])
    })

    it("drops accepted local state once refreshed storage owns the queued turn id", () => {
        const manager = new QueuedTurnManager()

        manager.acceptQueuedTurn("task-1", queuedTurn)
        manager.reconcileTaskWithStorage("task-1", [{ ...queuedTurn, status: "running", updatedAt: "2026-05-28T00:00:01.000Z" }])

        expect(manager.queuedForTask("task-1", [])).toEqual([])
    })
})
