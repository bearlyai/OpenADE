import { describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import type { CodeStore } from "../store"
import { EventManager } from "./EventManager"

type MutableActionEvent = {
    id: string
    type: "action"
    status: "in_progress" | "completed" | "error" | "stopped"
    createdAt: string
    userInput: string
    source: { type: string; userLabel: string; reviewType?: "plan" | "work" }
    execution: { events: unknown[]; sessionId?: string; parentSessionId?: string }
    completedAt?: string
    result?: { success: boolean }
}

describe("EventManager.getLastEventSessionId", () => {
    it("skips review events when selecting parent session", () => {
        const events: MutableActionEvent[] = [
            {
                id: "event-main",
                type: "action",
                status: "completed",
                createdAt: new Date().toISOString(),
                userInput: "main action",
                source: { type: "do", userLabel: "Do" },
                execution: { events: [], sessionId: "main-session" },
            },
            {
                id: "event-review",
                type: "action",
                status: "completed",
                createdAt: new Date().toISOString(),
                userInput: "review action",
                source: { type: "review", userLabel: "Review", reviewType: "work" },
                execution: { events: [], sessionId: "review-session" },
            },
        ]

        const store = {
            tasks: { getTask: vi.fn(() => ({ events })) },
            repoStore: null,
        } as unknown as CodeStore

        const manager = new EventManager(store)
        const sessionId = manager.getLastEventSessionId("task-1")

        expect(sessionId).toBe("main-session")
    })
})

describe("EventManager.getLastEventSessionContext", () => {
    function createStoreForEvents(events: MutableActionEvent[]): CodeStore {
        return {
            tasks: { getTask: vi.fn(() => ({ events })) },
            repoStore: null,
        } as unknown as CodeStore
    }

    it("returns harness and model alongside session ID", () => {
        const events: MutableActionEvent[] = [
            {
                id: "event-hp",
                type: "action",
                status: "completed",
                createdAt: new Date().toISOString(),
                userInput: "plan task",
                source: { type: "hyperplan", userLabel: "HyperPlan" },
                execution: {
                    events: [],
                    sessionId: "reconciler-session",
                    harnessId: "codex",
                    modelId: "gpt-5.3-codex",
                } as unknown as MutableActionEvent["execution"],
            },
        ]

        const manager = new EventManager(createStoreForEvents(events))
        const ctx = manager.getLastEventSessionContext("task-1")

        expect(ctx).toEqual({
            sessionId: "reconciler-session",
            harnessId: "codex",
            modelId: "gpt-5.3-codex",
        })
    })

    it("skips review events and returns the correct context", () => {
        const events: MutableActionEvent[] = [
            {
                id: "event-hp",
                type: "action",
                status: "completed",
                createdAt: new Date().toISOString(),
                userInput: "plan task",
                source: { type: "hyperplan", userLabel: "HyperPlan" },
                execution: {
                    events: [],
                    sessionId: "reconciler-session",
                    harnessId: "codex",
                    modelId: "gpt-5.3-codex",
                } as unknown as MutableActionEvent["execution"],
            },
            {
                id: "event-review",
                type: "action",
                status: "completed",
                createdAt: new Date().toISOString(),
                userInput: "review",
                source: { type: "review", userLabel: "Review", reviewType: "plan" },
                execution: {
                    events: [],
                    sessionId: "review-session",
                    harnessId: "claude-code",
                    modelId: "opus",
                } as unknown as MutableActionEvent["execution"],
            },
        ]

        const manager = new EventManager(createStoreForEvents(events))
        const ctx = manager.getLastEventSessionContext("task-1")

        // Should skip the review event and return the hyperplan event's context
        expect(ctx).toEqual({
            sessionId: "reconciler-session",
            harnessId: "codex",
            modelId: "gpt-5.3-codex",
        })
    })

    it("returns undefined when no events have sessions", () => {
        const events: MutableActionEvent[] = [
            {
                id: "event-1",
                type: "action",
                status: "completed",
                createdAt: new Date().toISOString(),
                userInput: "test",
                source: { type: "do", userLabel: "Do" },
                execution: { events: [] },
            },
        ]

        const manager = new EventManager(createStoreForEvents(events))
        expect(manager.getLastEventSessionContext("task-1")).toBeUndefined()
    })
})

describe("EventManager.cancelPlan", () => {
    it("does not issue a metadata write when task metadata update is unavailable", async () => {
        const store = {
            tasks: { getTask: vi.fn(() => ({ id: "task-1", events: [] })) },
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => method !== OPENADE_METHOD.taskMetadataUpdate),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
        } as unknown as CodeStore

        const manager = new EventManager(store)

        await expect(manager.cancelPlan("task-1", "plan-1")).resolves.toBe(false)
        expect(store.updateProductTaskMetadata).not.toHaveBeenCalled()
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })

    it("does not refresh legacy task storage after cancel-plan metadata writes while Core owns product state", async () => {
        const store = {
            tasks: { getTask: vi.fn(() => ({ id: "task-1", events: [] })) },
            shouldUseRuntimeProductAPI: vi.fn(() => false),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => true),
            canUseProductMethodAfterConnect: vi.fn(async () => true),
            updateProductTaskMetadata: vi.fn(async () => undefined),
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
        } as unknown as CodeStore

        const manager = new EventManager(store)

        await expect(manager.cancelPlan("task-1", "plan-1")).resolves.toBe(true)
        expect(store.updateProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", cancelledPlanEventId: "plan-1" })
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })

    it("attaches Core metadata update before cancelling a plan", async () => {
        let runtimeProductAPIAvailable = false
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            runtimeProductAPIAvailable = method === OPENADE_METHOD.taskMetadataUpdate
            return runtimeProductAPIAvailable
        })
        const updateProductTaskMetadata = vi.fn(async () => undefined)
        const store = {
            tasks: { getTask: vi.fn(() => ({ id: "task-1", events: [] })) },
            shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && method === OPENADE_METHOD.taskMetadataUpdate),
            canUseProductMethodAfterConnect,
            updateProductTaskMetadata,
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
        } as unknown as CodeStore

        const manager = new EventManager(store)

        await expect(manager.cancelPlan("task-1", "plan-1")).resolves.toBe(true)
        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskMetadataUpdate)
        expect(updateProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", cancelledPlanEventId: "plan-1" })
    })

    it("does not refresh legacy task storage when only the runtime task route owns metadata", async () => {
        const updateProductTaskMetadata = vi.fn(async () => undefined)
        const store = {
            tasks: { getTask: vi.fn(() => ({ id: "task-1", events: [] })) },
            shouldUseRuntimeProductAPI: vi.fn(() => false),
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn(() => false),
            canUseProductMethodAfterConnect: vi.fn(async (method: string) => method === OPENADE_METHOD.taskMetadataUpdate),
            updateProductTaskMetadata,
            refreshProductStateAfterTaskMutation: vi.fn(async () => undefined),
        } as unknown as CodeStore

        const manager = new EventManager(store)

        await expect(manager.cancelPlan("task-1", "plan-1")).resolves.toBe(true)
        expect(updateProductTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", cancelledPlanEventId: "plan-1" })
        expect(store.refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })
})
