import { describe, expect, it } from "vitest"
import type { RuntimeStatus } from "../../../../runtime-protocol/src"
import { RuntimeManager } from "./RuntimeManager"

const startedAt = "2026-05-26T00:00:00.000Z"

function runtime(status: RuntimeStatus = "running") {
    return {
        runtimeId: "runtime-1",
        kind: "agent",
        status,
        scope: {
            ownerType: "openade-task",
            ownerId: "task-1",
        },
        startedAt,
        updatedAt: startedAt,
        lastActivityAt: startedAt,
    }
}

describe("RuntimeManager", () => {
    it("accepts scoped runtime notifications and ignores legacy flat owner payloads", () => {
        const manager = new RuntimeManager()

        expect(manager.applyNotification({ method: "runtime/updated", params: runtime() })).toEqual([])
        expect(manager.isTaskRunning("task-1")).toBe(true)

        expect(
            manager.applyNotification({
                method: "runtime/updated",
                params: {
                    runtimeId: "runtime-2",
                    kind: "agent",
                    status: "running",
                    ownerType: "openade-task",
                    ownerId: "task-2",
                    startedAt,
                    updatedAt: startedAt,
                    lastActivityAt: startedAt,
                },
            })
        ).toEqual([])
        expect(manager.isTaskRunning("task-2")).toBe(false)

        expect(manager.applyNotification({ method: "runtime/completed", params: runtime("completed") })).toEqual(["task-1"])
        expect(manager.isTaskRunning("task-1")).toBe(false)
    })

    it("keeps orphaned task state derived from runtime records", () => {
        const manager = new RuntimeManager()

        expect(manager.applyNotification({ method: "runtime/updated", params: runtime("orphaned") })).toEqual([])

        expect(manager.isTaskOrphaned("task-1")).toBe(true)
        expect(manager.isTaskRunning("task-1")).toBe(false)
    })
})
