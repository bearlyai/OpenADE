import { describe, expect, it, vi } from "vitest"
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

        const taskStore = {
            events: {
                all: () => events,
                update: vi.fn(),
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

        const manager = new EventManager(store)
        const sessionId = manager.getLastEventSessionId("task-1")

        expect(sessionId).toBe("main-session")
    })
})

describe("EventManager.getLastEventSessionContext", () => {
    function createStoreForEvents(events: MutableActionEvent[]): CodeStore {
        const taskStore = {
            events: {
                all: () => events,
                update: vi.fn(),
            },
            meta: {
                current: { repoId: "repo-1" },
                update: vi.fn(),
            },
        }
        return {
            getCachedTaskStore: vi.fn(() => taskStore),
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
