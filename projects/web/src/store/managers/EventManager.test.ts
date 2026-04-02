import { describe, expect, it, vi } from "vitest"
import type { CodeStore } from "../store"
import { EventManager } from "./EventManager"

type MutableActionEvent = {
    id: string
    type: "action"
    status: "in_progress" | "completed" | "error" | "stopped"
    createdAt: string
    userInput: string
    source: { type: string; userLabel: string }
    execution: { events: unknown[] }
    completedAt?: string
    result?: { success: boolean }
}

function createStoreForEvent(event: MutableActionEvent): CodeStore {
    const events = [event]
    const taskStore = {
        events: {
            update: (eventId: string, updater: (draft: MutableActionEvent) => void) => {
                const target = events.find((e) => e.id === eventId)
                if (target) updater(target)
            },
            all: () => events,
        },
        meta: {
            current: { repoId: "repo-1" },
            update: vi.fn(),
        },
    }

    const store = {
        getCachedTaskStore: vi.fn(() => taskStore),
        repoStore: null,
    } as unknown as CodeStore

    return store
}

describe("EventManager.completeActionEvent", () => {
    it("does not overwrite a stopped event", () => {
        const event: MutableActionEvent = {
            id: "event-1",
            type: "action",
            status: "stopped",
            createdAt: new Date().toISOString(),
            userInput: "test",
            source: { type: "do", userLabel: "Do" },
            execution: { events: [] },
        }

        const manager = new EventManager(createStoreForEvent(event))
        manager.completeActionEvent({ taskId: "task-1", eventId: "event-1", success: true })

        expect(event.status).toBe("stopped")
        expect(event.result).toBeUndefined()
    })

    it("completes an in-progress event and persists success", () => {
        const event: MutableActionEvent = {
            id: "event-2",
            type: "action",
            status: "in_progress",
            createdAt: new Date().toISOString(),
            userInput: "test",
            source: { type: "do", userLabel: "Do" },
            execution: { events: [] },
        }

        const manager = new EventManager(createStoreForEvent(event))
        manager.completeActionEvent({ taskId: "task-1", eventId: "event-2", success: false })

        expect(event.status).toBe("completed")
        expect(event.result).toEqual({ success: false })
    })
})
