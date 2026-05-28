import { describe, expect, it } from "vitest"
import type { RemoteTask } from "../../../shared/companion/src"
import { taskMessages } from "./messagePresentation"

function remoteTask(events: unknown[], overrides: Partial<RemoteTask> = {}): RemoteTask {
    return {
        id: "task-1",
        repoId: "repo-1",
        slug: "task-1",
        title: "Task",
        description: "",
        events,
        comments: [],
        deviceEnvironments: [],
        ...overrides,
    }
}

describe("taskMessages", () => {
    it("renders Codex assistant text and compact activity breadcrumbs", () => {
        const messages = taskMessages(
            remoteTask([
                {
                    id: "event-1",
                    type: "action",
                    status: "completed",
                    source: { type: "do", userLabel: "Do" },
                    userInput: "Check the tests",
                    execution: {
                        harnessId: "codex",
                        executionId: "exec-1",
                        events: [
                            {
                                id: "msg-1",
                                direction: "execution",
                                type: "raw_message",
                                executionId: "exec-1",
                                harnessId: "codex",
                                message: {
                                    type: "item.completed",
                                    item: {
                                        id: "agent-1",
                                        type: "agent_message",
                                        text: "The tests are passing.",
                                    },
                                },
                            },
                            {
                                id: "msg-2",
                                direction: "execution",
                                type: "raw_message",
                                executionId: "exec-1",
                                harnessId: "codex",
                                message: {
                                    type: "item.completed",
                                    item: {
                                        id: "cmd-1",
                                        type: "command_execution",
                                        command: "npm test",
                                        aggregated_output: "ok",
                                        exit_code: 0,
                                        status: "completed",
                                    },
                                },
                            },
                        ],
                    },
                },
            ])
        )

        expect(messages).toMatchObject([
            { kind: "user", body: "Check the tests" },
            { kind: "assistant", body: "The tests are passing." },
            {
                kind: "activity",
                activity: [
                    {
                        label: "Shell",
                        detail: "npm test",
                    },
                ],
            },
        ])
    })

    it("renders queued turn metadata so mobile users can see pending follow-ups", () => {
        const messages = taskMessages(
            remoteTask([], {
                queuedTurns: [
                    {
                        id: "queued-1",
                        type: "do",
                        input: "Continue after this finishes",
                        status: "queued",
                        createdAt: "2026-05-28T00:00:00.000Z",
                        updatedAt: "2026-05-28T00:00:00.000Z",
                    },
                    {
                        id: "queued-2",
                        type: "ask",
                        input: "Summarize after this finishes",
                        status: "queued",
                        createdAt: "2026-05-28T00:00:00.000Z",
                        updatedAt: "2026-05-28T00:00:00.000Z",
                    },
                ],
            })
        )

        expect(messages).toContainEqual(
            expect.objectContaining({
                id: "queued-1:queued-turn",
                kind: "system",
                title: "Queued Do",
                status: "queued",
                body: "Continue after this finishes",
            })
        )
        expect(messages).toContainEqual(
            expect.objectContaining({
                id: "queued-2:queued-turn",
                kind: "system",
                title: "Queued Ask",
                status: "queued",
                body: "Summarize after this finishes",
            })
        )
    })

    it("renders unknown task events with raw details instead of hiding them", () => {
        const messages = taskMessages(
            remoteTask([
                {
                    id: "future-1",
                    type: "future_event",
                    payload: { value: 42 },
                },
            ])
        )

        expect(messages).toContainEqual(
            expect.objectContaining({
                id: "future-1:event",
                kind: "system",
                title: "future_event",
                body: expect.stringContaining('"value": 42'),
            })
        )
    })
})
