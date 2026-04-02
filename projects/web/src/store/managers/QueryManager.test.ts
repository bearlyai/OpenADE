import { describe, expect, it, vi } from "vitest"
import type { HarnessQuery } from "../../electronAPI/harnessQuery"
import type { CodeStore } from "../store"
import { QueryManager } from "./QueryManager"

function createStoreStub(eventById: Map<string, unknown>) {
    const stoppedEvent = vi.fn()
    const setTaskWorking = vi.fn()

    const store = {
        events: {
            stoppedEvent,
        },
        setTaskWorking,
        getCachedTaskStore: vi.fn(() => ({
            events: {
                get: (eventId: string) => eventById.get(eventId),
            },
        })),
    } as unknown as CodeStore

    return { store, stoppedEvent, setTaskWorking }
}

describe("QueryManager abortTask", () => {
    it("aborts harness runs and marks the event as stopped", async () => {
        const eventById = new Map<string, unknown>([
            [
                "event-1",
                {
                    type: "action",
                    execution: { events: [] },
                },
            ],
        ])
        const { store, stoppedEvent, setTaskWorking } = createStoreStub(eventById)
        const manager = new QueryManager(store)

        const abort = vi.fn().mockResolvedValue(undefined)
        const query = {
            id: "exec-1",
            sessionId: "session-1",
            abort,
        } as unknown as HarnessQuery

        manager.setActiveQuery("task-1", query, "event-1", "parent-1")
        await manager.abortTask("task-1")

        expect(abort).toHaveBeenCalledTimes(1)
        expect(stoppedEvent).toHaveBeenCalledWith({
            taskId: "task-1",
            eventId: "event-1",
            sessionId: "session-1",
            parentSessionId: "parent-1",
        })
        expect(setTaskWorking).toHaveBeenCalledWith("task-1", false)
        expect(manager.getActiveQuery("task-1")).toBeNull()
    })

    it("aborts custom runs and marks the event as stopped once eventId is attached", async () => {
        const eventById = new Map<string, unknown>([
            [
                "event-2",
                {
                    type: "action",
                    execution: { events: [] },
                },
            ],
        ])
        const { store, stoppedEvent, setTaskWorking } = createStoreStub(eventById)
        const manager = new QueryManager(store)

        const abort = vi.fn().mockResolvedValue(undefined)
        const cleanup = vi.fn()

        manager.setActiveCustomRun("task-2", {
            eventId: null,
            abort,
            sessionId: () => "session-2",
            cleanup,
        })
        manager.updateActiveRunEvent("task-2", "event-2", "parent-2")
        await manager.abortTask("task-2")

        expect(abort).toHaveBeenCalledTimes(1)
        expect(cleanup).toHaveBeenCalledTimes(1)
        expect(stoppedEvent).toHaveBeenCalledWith({
            taskId: "task-2",
            eventId: "event-2",
            sessionId: "session-2",
            parentSessionId: "parent-2",
        })
        expect(setTaskWorking).toHaveBeenCalledWith("task-2", false)
    })

    it("is a no-op when no active run exists", async () => {
        const eventById = new Map<string, unknown>()
        const { store, stoppedEvent, setTaskWorking } = createStoreStub(eventById)
        const manager = new QueryManager(store)

        await expect(manager.abortTask("missing-task")).resolves.toBeUndefined()
        expect(stoppedEvent).not.toHaveBeenCalled()
        expect(setTaskWorking).not.toHaveBeenCalled()
    })
})
