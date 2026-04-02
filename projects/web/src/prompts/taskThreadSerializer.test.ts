import { describe, expect, it } from "vitest"
import type { ActionEvent, Task } from "../types"
import type { HarnessStreamEvent } from "../electronAPI/harnessEventTypes"
import { buildTaskThreadJson, buildTaskThreadXml, DEFAULT_TASK_THREAD_FORMAT } from "./taskThreadSerializer"

function rawMessageEvent({
    executionId,
    harnessId,
    message,
}: {
    executionId: string
    harnessId: "claude-code" | "codex"
    message: Record<string, unknown>
}): HarnessStreamEvent {
    return {
        id: crypto.randomUUID(),
        type: "raw_message",
        executionId,
        harnessId,
        direction: "execution",
        message,
    } as unknown as HarnessStreamEvent
}

function createActionEvent({
    id,
    userInput,
    harnessId,
    events,
}: {
    id: string
    userInput: string
    harnessId: "claude-code" | "codex"
    events: HarnessStreamEvent[]
}): ActionEvent {
    return {
        id,
        type: "action",
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:10.000Z",
        userInput,
        execution: {
            harnessId,
            executionId: `${id}-exec`,
            modelId: harnessId === "claude-code" ? "opus" : "gpt-5.3-codex",
            sessionId: `${id}-session`,
            events,
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
        title: "Task title",
        description: "Task description",
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

describe("buildTaskThreadJson", () => {
    it("serializes Claude thread data with message/tool/result items", () => {
        const executionId = "a1-exec"
        const action = createActionEvent({
            id: "a1",
            userInput: "Run tests",
            harnessId: "claude-code",
            events: [
                rawMessageEvent({
                    executionId,
                    harnessId: "claude-code",
                    message: {
                        type: "assistant",
                        message: {
                            content: [
                                { type: "thinking", thinking: "I should run tests first." },
                                { type: "text", text: "Running tests now." },
                                { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "yarn test" } },
                            ],
                        },
                    },
                }),
                rawMessageEvent({
                    executionId,
                    harnessId: "claude-code",
                    message: {
                        type: "user",
                        message: {
                            content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok", is_error: false }],
                        },
                    },
                }),
                rawMessageEvent({
                    executionId,
                    harnessId: "claude-code",
                    message: {
                        type: "result",
                        subtype: "success",
                        duration_ms: 1500,
                        total_cost_usd: 0.01,
                        usage: { input_tokens: 100, output_tokens: 50 },
                        is_error: false,
                    },
                }),
            ],
        })

        const task = createTask([action])
        const json = buildTaskThreadJson(task)
        const items = json.events[0].items

        expect(json.format).toEqual(DEFAULT_TASK_THREAD_FORMAT)
        expect(items.find((item) => item.kind === "message" && item.role === "user")).toBeTruthy()
        expect(items.find((item) => item.kind === "message" && item.role === "assistant")).toBeTruthy()
        expect(items.find((item) => item.kind === "thinking")).toBeFalsy()

        const callItem = items.find((item) => item.kind === "functionCall" && item.name === "Bash")
        expect(callItem).toBeTruthy()
        if (callItem && callItem.kind === "functionCall") {
            expect(callItem.callId).toBe("tool-1")
            expect(callItem.input).toMatchObject({ command: "yarn test" })
        }

        const outputItem = items.find((item) => item.kind === "functionOutput" && item.name === "Bash")
        expect(outputItem).toBeTruthy()
        if (outputItem && outputItem.kind === "functionOutput") {
            expect(outputItem.output).toBe("ok")
            expect(outputItem.isError).toBe(false)
        }

        expect(items.find((item) => item.kind === "result")).toBeTruthy()
    })

    it("applies include flags for thinking and function outputs", () => {
        const executionId = "a2-exec"
        const action = createActionEvent({
            id: "a2",
            userInput: "Do something",
            harnessId: "claude-code",
            events: [
                rawMessageEvent({
                    executionId,
                    harnessId: "claude-code",
                    message: {
                        type: "assistant",
                        message: {
                            content: [
                                { type: "thinking", thinking: "internal" },
                                { type: "tool_use", id: "tool-2", name: "Bash", input: { command: "pwd" } },
                            ],
                        },
                    },
                }),
                rawMessageEvent({
                    executionId,
                    harnessId: "claude-code",
                    message: {
                        type: "user",
                        message: {
                            content: [{ type: "tool_result", tool_use_id: "tool-2", content: "/tmp", is_error: false }],
                        },
                    },
                }),
            ],
        })
        const task = createTask([action])

        const withoutThinking = buildTaskThreadJson(task, { includeThinking: false, includeFunctionOutputs: false })
        expect(withoutThinking.events[0].items.some((item) => item.kind === "thinking")).toBe(false)
        expect(withoutThinking.events[0].items.some((item) => item.kind === "functionOutput")).toBe(false)

        const withThinking = buildTaskThreadJson(task, { includeThinking: true })
        expect(withThinking.events[0].items.some((item) => item.kind === "thinking")).toBe(true)
    })

    it("serializes Codex command executions into function call/output items", () => {
        const executionId = "c1-exec"
        const action = createActionEvent({
            id: "c1",
            userInput: "Check cwd",
            harnessId: "codex",
            events: [
                rawMessageEvent({
                    executionId,
                    harnessId: "codex",
                    message: {
                        type: "item.completed",
                        item: {
                            id: "cmd-1",
                            type: "command_execution",
                            command: "pwd",
                            aggregated_output: "/repo\n",
                            exit_code: 0,
                            status: "completed",
                        },
                    },
                }),
                rawMessageEvent({
                    executionId,
                    harnessId: "codex",
                    message: {
                        type: "turn.completed",
                        usage: { input_tokens: 12, output_tokens: 6 },
                    },
                }),
            ],
        })
        const task = createTask([action])
        const json = buildTaskThreadJson(task)
        const items = json.events[0].items

        const call = items.find((item) => item.kind === "functionCall" && item.name === "Bash")
        expect(call).toBeTruthy()
        if (call && call.kind === "functionCall") {
            expect(call.callId).toBe("cmd-1")
            expect(call.input).toMatchObject({ command: "pwd" })
        }

        const output = items.find((item) => item.kind === "functionOutput" && item.name === "Bash")
        expect(output).toBeTruthy()
        if (output && output.kind === "functionOutput") {
            expect(output.output).toContain("/repo")
        }
    })
})

describe("buildTaskThreadXml", () => {
    it("renders task thread XML with nested event and item tags", () => {
        const executionId = "a3-exec"
        const action = createActionEvent({
            id: "a3",
            userInput: "Run lint",
            harnessId: "claude-code",
            events: [
                rawMessageEvent({
                    executionId,
                    harnessId: "claude-code",
                    message: {
                        type: "assistant",
                        message: {
                            content: [{ type: "tool_use", id: "tool-3", name: "Bash", input: { command: "yarn lint" } }],
                        },
                    },
                }),
                rawMessageEvent({
                    executionId,
                    harnessId: "claude-code",
                    message: {
                        type: "user",
                        message: {
                            content: [{ type: "tool_result", tool_use_id: "tool-3", content: "done", is_error: false }],
                        },
                    },
                }),
            ],
        })

        const xml = buildTaskThreadXml(createTask([action]), { includeThinking: true })

        expect(xml).toContain(`<task id="task-1"`)
        expect(xml).toContain(`<event id="a3"`)
        expect(xml).toContain(`<agent harnessId="claude-code"`)
        expect(xml).toContain(`<functionCall name="Bash" callId="tool-3"`)
        expect(xml).toContain("<functionInput>")
        expect(xml).toContain(`"command": "yarn lint"`)
        expect(xml).toContain(`<functionOutput name="Bash" callId="tool-3" isError="false">done</functionOutput>`)
    })
})
