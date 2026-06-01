import { describe, expect, it } from "vitest"
import type { OpenADETask } from "../../../../openade-module/src"
import { taskEventBlocks } from "./taskEventPresentation"

function openADETask(events: unknown[], overrides: Partial<OpenADETask> = {}): OpenADETask {
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

describe("taskEventBlocks", () => {
    it("renders Codex assistant text and compact activity groups", () => {
        const blocks = taskEventBlocks(
            openADETask([
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

        expect(blocks).toMatchObject([
            {
                kind: "action",
                userInput: "Check the tests",
                groups: [
                    { type: "text", label: "Assistant", detail: "The tests are passing." },
                    { type: "bash", label: "npm test", detail: "npm test" },
                ],
            },
        ])
    })

    it("renders queued turn metadata so remote users can see pending follow-ups", () => {
        const blocks = taskEventBlocks(
            openADETask([], {
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

        expect(blocks).toContainEqual(
            expect.objectContaining({
                id: "queued-1:queued-turn",
                kind: "queued",
                title: "Queued Do",
                status: "queued",
                body: "Continue after this finishes",
            })
        )
        expect(blocks).toContainEqual(
            expect.objectContaining({
                id: "queued-2:queued-turn",
                kind: "queued",
                title: "Queued Ask",
                status: "queued",
                body: "Summarize after this finishes",
            })
        )
    })

    it("renders unknown task events with raw details instead of hiding them", () => {
        const blocks = taskEventBlocks(
            openADETask([
                {
                    id: "future-1",
                    type: "future_event",
                    payload: { value: 42 },
                },
            ])
        )

        expect(blocks).toContainEqual(
            expect.objectContaining({
                id: "future-1",
                kind: "unknown",
                title: "future_event",
                body: expect.stringContaining('"value": 42'),
            })
        )
    })
})
