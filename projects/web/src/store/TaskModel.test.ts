import { describe, expect, it, vi } from "vitest"
import { DEFAULT_MODEL, getDefaultModelForHarness } from "../constants"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import type { ActionEvent, Task } from "../types"
import { TaskModel } from "./TaskModel"
import { EventManager } from "./managers/EventManager"
import type { CodeStore } from "./store"

function createActionEvent({
    id,
    harnessId,
    modelId,
}: {
    id: string
    harnessId: HarnessId
    modelId?: string
}): ActionEvent {
    return {
        id,
        type: "action",
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
        userInput: "test",
        execution: {
            harnessId,
            executionId: `${id}-exec`,
            modelId,
            events: [],
        },
        source: { type: "do", userLabel: "Do" },
        includesCommentIds: [],
        result: { success: true },
    }
}

function createTask(events: ActionEvent[]): Task {
    return {
        id: "task-1",
        repoId: "repo-1",
        slug: "task-1",
        title: "Task",
        description: "desc",
        isolationStrategy: { type: "head" },
        deviceEnvironments: [],
        createdBy: { id: "u1", email: "u1@example.com" },
        events,
        comments: [],
        sessionIds: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    }
}

function createStore(task: Task): CodeStore {
    return {
        execution: {
            onAfterEvent: () => () => {},
        },
        tasks: {
            getTask: (taskId: string) => (taskId === task.id ? task : null),
        },
    } as unknown as CodeStore
}

describe("TaskModel harness lock", () => {
    it("exposes closed state from task metadata", () => {
        const task = { ...createTask([]), closed: true }

        const model = new TaskModel(createStore(task), task.id)

        expect(model.isClosed).toBe(true)
    })

    it("hydrates harness/model from latest action event", () => {
        const task = createTask([
            createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "opus" }),
            createActionEvent({ id: "a2", harnessId: "codex", modelId: "gpt-5.3-codex" }),
        ])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("codex")
        expect(model.model).toBe("gpt-5.3-codex")
    })

    it("skips review events when restoring harness/model from history", () => {
        const primaryEvent = createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "opus" })
        const reviewEvent = {
            ...createActionEvent({ id: "a2", harnessId: "codex", modelId: "gpt-5.3-codex" }),
            source: { type: "review" as const, userLabel: "Review", reviewType: "work" as const },
        }
        const task = createTask([primaryEvent, reviewEvent])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("opus")
    })

    it("maps persisted exact Opus full model IDs to versioned aliases", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "claude-opus-4-7" })])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("opus-4-7")
    })

    it("maps persisted Opus 4.6 full model IDs to versioned aliases", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "claude-opus-4-6" })])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("opus-4-6")
    })

    it("maps future Claude full model IDs to stable aliases", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "claude-opus-4-8" })])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("opus")
    })

    it("maps future Claude Sonnet full model IDs to stable aliases", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "claude-sonnet-4-7-20260601" })])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("sonnet")
    })

    it("does not allow harness switching once action history exists", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "codex", modelId: "gpt-5.3-codex" })])

        const model = new TaskModel(createStore(task), task.id)
        model.setHarnessId("claude-code")

        expect(model.harnessId).toBe("codex")
        expect(model.model).toBe("gpt-5.3-codex")
    })

    it("allows model switching while harness remains locked", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "opus" })])

        const model = new TaskModel(createStore(task), task.id)
        model.setHarnessId("codex")
        model.setModel("sonnet")

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("sonnet")
    })

    it("allows harness switching for tasks without action history", () => {
        const task = createTask([])

        const model = new TaskModel(createStore(task), task.id)
        model.setHarnessId("codex")

        expect(model.harnessId).toBe("codex")
        expect(model.model).toBe(getDefaultModelForHarness("codex"))
    })

    it("v1 compat: reads harnessId from legacy `type` field", () => {
        // Pre-harness tasks stored `type: "claude-code"` instead of `harnessId`
        const legacyEvent = {
            id: "a1",
            type: "action" as const,
            status: "completed" as const,
            createdAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:01.000Z",
            userInput: "test",
            execution: {
                type: "claude-code",
                executionId: "a1-exec",
                modelId: "claude-opus-4-7",
                events: [],
            },
            source: { type: "do" as const, userLabel: "Do" },
            includesCommentIds: [],
            result: { success: true },
        } as unknown as ActionEvent

        const task = createTask([legacyEvent])
        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("opus-4-7")
    })

    it("v1 compat: defaults to claude-code when neither harnessId nor type exists", () => {
        const legacyEvent = {
            id: "a1",
            type: "action" as const,
            status: "completed" as const,
            createdAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:01.000Z",
            userInput: "test",
            execution: {
                executionId: "a1-exec",
                modelId: "opus",
                events: [],
            },
            source: { type: "do" as const, userLabel: "Do" },
            includesCommentIds: [],
            result: { success: true },
        } as unknown as ActionEvent

        const task = createTask([legacyEvent])
        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("opus")
    })

    it("serializes task threads as JSON and XML", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "opus" })])

        const model = new TaskModel(createStore(task), task.id)

        const threadJson = model.getThreadJson()
        expect(threadJson?.task.id).toBe(task.id)
        expect(threadJson?.events).toHaveLength(1)

        const threadXml = model.getThreadXml()
        expect(threadXml).toContain(`<task id="${task.id}"`)
        expect(threadXml).toContain(`<event id="a1"`)
    })
})

describe("HyperPlan handoff consistency", () => {
    /**
     * Regression test: after HyperPlan completes, follow-up actions must use
     * the terminal step's (reconciler's) harness+model. Without a fix, the
     * TaskModel retains whatever harness+model it had before HyperPlan ran,
     * leading to a mismatch between the session being resumed and the
     * harness/model used to resume it.
     *
     * The real-world flow:
     * 1. TaskModel constructed (defaults to claude-code + DEFAULT_MODEL)
     * 2. HyperPlan runs — reconciler uses e.g. codex + o3
     * 3. Reconciler's session ID saved on the ActionEvent
     * 4. User clicks "Run Plan" — runAction reads taskModel.harnessId/model
     *    AND getLastEventSessionId() for the session
     * 5. BUG: harnessId/model are stale defaults, but session is the reconciler's
     */

    function createHyperPlanEvent({
        id,
        harnessId,
        modelId,
        sessionId,
    }: {
        id: string
        harnessId: HarnessId
        modelId: string
        sessionId: string
    }): ActionEvent {
        return {
            id,
            type: "action",
            status: "completed",
            createdAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:01.000Z",
            userInput: "Implement dark mode",
            execution: {
                harnessId,
                executionId: `${id}-exec`,
                modelId,
                sessionId,
                events: [],
            },
            source: { type: "hyperplan", userLabel: "HyperPlan", strategyId: "ensemble" },
            includesCommentIds: [],
            result: { success: true },
        }
    }

    function createEventManager(events: ActionEvent[]): EventManager {
        const eventStore = {
            events: {
                all: () => events,
                update: vi.fn(),
            },
            meta: { current: { repoId: "repo-1" }, update: vi.fn() },
        }
        return new EventManager({ getCachedTaskStore: () => eventStore } as unknown as CodeStore)
    }

    it("syncHarnessFromHistory updates TaskModel after HyperPlan (cross-harness)", () => {
        // Simulates the real flow: TaskModel exists before HyperPlan, then
        // HyperPlan adds an event with a different harness/model.
        const task = createTask([])
        const store = createStore(task)
        const model = new TaskModel(store, task.id)

        // Starts with defaults
        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe(DEFAULT_MODEL)

        // HyperPlan completes — reconciler used codex
        const hyperplanEvent = createHyperPlanEvent({
            id: "hp-1",
            harnessId: "codex",
            modelId: "gpt-5.3-codex",
            sessionId: "reconciler-session-abc",
        })
        task.events.push(hyperplanEvent)

        // Before sync: TaskModel is stale
        expect(model.harnessId).toBe("claude-code")

        // After sync: TaskModel matches the reconciler
        model.syncHarnessFromHistory()
        expect(model.harnessId).toBe("codex")
        expect(model.model).toBe("gpt-5.3-codex")
    })

    it("syncHarnessFromHistory updates TaskModel after HyperPlan (same-harness, different model)", () => {
        const task = createTask([])
        const store = createStore(task)
        const model = new TaskModel(store, task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe(DEFAULT_MODEL)

        // HyperPlan reconciler used claude-code + sonnet (same harness, different model)
        task.events.push(
            createHyperPlanEvent({
                id: "hp-1",
                harnessId: "claude-code",
                modelId: "sonnet",
                sessionId: "reconciler-session-456",
            })
        )

        // Before sync: model is still the default
        expect(model.model).toBe(DEFAULT_MODEL)

        // After sync: model matches the reconciler
        model.syncHarnessFromHistory()
        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("sonnet")
    })

    it("getLastEventSessionContext returns harness/model with session ID", () => {
        const hyperplanEvent = createHyperPlanEvent({
            id: "hp-1",
            harnessId: "codex",
            modelId: "gpt-5.3-codex",
            sessionId: "reconciler-session-xyz",
        })
        const task = createTask([hyperplanEvent])
        const eventManager = createEventManager(task.events as ActionEvent[])

        const ctx = eventManager.getLastEventSessionContext(task.id)
        expect(ctx).toEqual({
            sessionId: "reconciler-session-xyz",
            harnessId: "codex",
            modelId: "gpt-5.3-codex",
        })
    })

    it("session context and TaskModel agree after construction with HyperPlan event", () => {
        const hyperplanEvent = createHyperPlanEvent({
            id: "hp-1",
            harnessId: "codex",
            modelId: "gpt-5.3-codex",
            sessionId: "reconciler-session-xyz",
        })
        const task = createTask([hyperplanEvent])

        const eventManager = createEventManager(task.events as ActionEvent[])
        const ctx = eventManager.getLastEventSessionContext(task.id)!

        // TaskModel constructed after event — picks up reconciler values
        const store = createStore(task)
        const model = new TaskModel(store, task.id)

        // Both agree: the session was created by codex/gpt-5.3-codex
        expect(model.harnessId).toBe(ctx.harnessId)
        expect(model.model).toBe(ctx.modelId)
    })

    it("runAction resolution: session context drives harness/model when resuming (regression)", () => {
        // This replicates the exact resolution logic from ExecutionManager.runAction:
        //
        //   const sessionContext = freshSession ? undefined : store.events.getLastEventSessionContext(taskId)
        //   const parentSessionId = sessionContext?.sessionId
        //   const effectiveHarnessId = overrideHarnessId ?? (parentSessionId ? sessionContext.harnessId : taskModel.harnessId)
        //   const effectiveModel = overrideModel ?? (parentSessionId ? (sessionContext.modelId ?? taskModel.model) : taskModel.model)
        //
        // The bug was: this used to be just `taskModel.harnessId` / `taskModel.model`
        // regardless of the session, causing cross-harness session resume failures.

        const task = createTask([])
        const store = createStore(task)
        const taskModel = new TaskModel(store, task.id)

        // TaskModel starts with defaults
        expect(taskModel.harnessId).toBe("claude-code")
        expect(taskModel.model).toBe(DEFAULT_MODEL)

        // HyperPlan adds event with different harness
        task.events.push(
            createHyperPlanEvent({
                id: "hp-1",
                harnessId: "codex",
                modelId: "gpt-5.3-codex",
                sessionId: "reconciler-session-abc",
            })
        )

        const eventManager = createEventManager(task.events as ActionEvent[])
        const sessionContext = eventManager.getLastEventSessionContext(task.id)

        // Replicate runAction resolution — the fix:
        const parentSessionId = sessionContext?.sessionId
        const effectiveHarnessId = parentSessionId ? sessionContext!.harnessId : taskModel.harnessId
        const effectiveModel = parentSessionId ? (sessionContext!.modelId ?? taskModel.model) : taskModel.model

        // Session exists, so harness/model come from the session context, NOT the stale TaskModel
        expect(parentSessionId).toBe("reconciler-session-abc")
        expect(effectiveHarnessId).toBe("codex")
        expect(effectiveModel).toBe("gpt-5.3-codex")

        // The old broken behavior would have been:
        //   effectiveHarnessId = taskModel.harnessId = "claude-code"  (WRONG)
        //   effectiveModel = taskModel.model = DEFAULT_MODEL           (WRONG)
        // Verify these are indeed different to confirm the fix matters:
        expect(taskModel.harnessId).not.toBe(effectiveHarnessId)
        expect(taskModel.model).not.toBe(effectiveModel)
    })
})

describe("TaskModel environment loading", () => {
    it("coalesces concurrent loadEnvironment calls", async () => {
        const task: Task = {
            ...createTask([]),
            deviceEnvironments: [
                {
                    id: "device-1",
                    deviceId: "test-device",
                    setupComplete: true,
                    createdAt: "2026-01-01T00:00:00.000Z",
                    lastUsedAt: "2026-01-01T00:00:00.000Z",
                },
            ],
        }

        const repo = {
            id: "repo-1",
            name: "Repo",
            path: "/tmp/repo/subdir",
            createdBy: { id: "u1", email: "u1@example.com" },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        }

        const getGitInfo = vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25))
            return null
        })

        const store = {
            execution: {
                onAfterEvent: () => () => {},
            },
            tasks: {
                getTask: (taskId: string) => (taskId === task.id ? task : null),
            },
            repos: {
                getRepo: (repoId: string) => (repoId === repo.id ? repo : undefined),
                getGitInfo,
            },
        } as unknown as CodeStore

        localStorage.setItem("openade-device-id", "test-device")

        try {
            const model = new TaskModel(store, task.id)
            const [first, second] = await Promise.all([model.loadEnvironment(), model.loadEnvironment()])
            expect(first).toBeTruthy()
            expect(first).toBe(second)
            expect(getGitInfo).toHaveBeenCalledTimes(1)
        } finally {
            localStorage.removeItem("openade-device-id")
        }
    })
})
