import { describe, expect, it } from "vitest"
import type { RuntimeListParams, RuntimeRecord, RuntimeStatus } from "../../../../runtime-protocol/src"
import { RuntimeManager } from "./RuntimeManager"

const startedAt = "2026-05-26T00:00:00.000Z"

function runtime(status: RuntimeStatus = "running"): RuntimeRecord {
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

function runtimeWithId(runtimeId: string, status: RuntimeStatus, ownerId = "task-1"): RuntimeRecord {
    return {
        ...runtime(status),
        runtimeId,
        scope: {
            ...runtime(status).scope,
            ownerId,
        },
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

    it("hydrates OpenADE task runtime state with active status filters", async () => {
        const manager = new RuntimeManager()
        const calls: RuntimeListParams[] = []
        const source = {
            listRuntimes: async (params: RuntimeListParams): Promise<RuntimeRecord[]> => {
                calls.push(params)
                return params.statuses?.includes("running") ? [runtime("running")] : []
            },
        }

        const removed = await manager.hydrateOpenADETasks(source)

        expect(removed).toEqual([])
        expect(calls).toEqual([{ ownerType: "openade-task", statuses: ["starting", "running"] }])
        expect(manager.isTaskRunning("task-1")).toBe(true)
    })

    it("hydrates active runtime state without dropping terminal task runtime records", async () => {
        const manager = new RuntimeManager()
        manager.applyNotification({ method: "runtime/updated", params: runtimeWithId("runtime-orphaned", "orphaned") })
        manager.applyNotification({ method: "runtime/updated", params: runtimeWithId("runtime-stale-running", "running", "task-stale") })

        const source = {
            listRuntimes: async (params: RuntimeListParams): Promise<RuntimeRecord[]> =>
                params.statuses?.includes("running") ? [runtimeWithId("runtime-active-running", "running", "task-active")] : [],
        }

        const removed = await manager.hydrateOpenADETasks(source)

        expect(removed).toEqual(["task-stale"])
        expect(manager.isTaskOrphaned("task-1")).toBe(true)
        expect(manager.isTaskRunning("task-stale")).toBe(false)
        expect(manager.isTaskRunning("task-active")).toBe(true)
    })
})
