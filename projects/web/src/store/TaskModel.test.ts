import { describe, expect, it } from "vitest"
import { getDefaultModelForHarness } from "../constants"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import type { ActionEvent, Task } from "../types"
import { TaskModel } from "./TaskModel"
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
    it("hydrates harness/model from latest action event", () => {
        const task = createTask([
            createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "opus" }),
            createActionEvent({ id: "a2", harnessId: "codex", modelId: "gpt-5.3-codex" }),
        ])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("codex")
        expect(model.model).toBe("gpt-5.3-codex")
    })

    it("maps persisted full model IDs to harness aliases", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "claude-opus-4-6" })])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("opus")
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
                modelId: "claude-opus-4-6",
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
})
