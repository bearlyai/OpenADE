import { describe, expect, it } from "vitest"
import type { HarnessStreamEvent } from "../electronAPI/harnessEventTypes"
import type { ActionEvent, ActionEventSource, Task } from "../types"
import { buildTaskThreadMarkdown } from "./taskThreadMarkdown"

function rawMessageEvent(executionId: string, message: Record<string, unknown>): HarnessStreamEvent {
    return {
        id: crypto.randomUUID(),
        type: "raw_message",
        executionId,
        harnessId: "claude-code",
        direction: "execution",
        message,
    } as unknown as HarnessStreamEvent
}

function createActionEvent({
    id,
    userInput,
    source = { type: "do", userLabel: "Do" },
    events,
}: {
    id: string
    userInput: string
    source?: ActionEventSource
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
            harnessId: "claude-code",
            executionId: `${id}-exec`,
            modelId: "opus",
            sessionId: `${id}-session`,
            events,
        },
        source,
        includesCommentIds: [],
        result: { success: true },
    }
}

function createTask(events: ActionEvent[]): Task {
    return {
        id: "task-1",
        repoId: "repo-1",
        slug: "task-1",
        title: "My Task",
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

const assistantWithToolCall = (executionId: string) =>
    rawMessageEvent(executionId, {
        type: "assistant",
        message: {
            content: [
                { type: "thinking", thinking: "Let me run the tests." },
                { type: "text", text: "Running the tests now." },
                { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "yarn test" } },
            ],
        },
    })

const toolResult = (executionId: string) =>
    rawMessageEvent(executionId, {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "All tests passed", is_error: false }] },
    })

describe("buildTaskThreadMarkdown", () => {
    it("includes only user input and agent output by default, delimited by ## User / ## Agent", () => {
        const action = createActionEvent({
            id: "a1",
            userInput: "Run the tests",
            events: [assistantWithToolCall("a1-exec"), toolResult("a1-exec")],
        })
        const md = buildTaskThreadMarkdown(createTask([action]))

        expect(md).toContain("## User (Do)")
        expect(md).toContain("Run the tests")
        expect(md).toContain("## Agent")
        expect(md).toContain("Running the tests now.")

        // Defaults exclude thinking, function calls, and function results.
        expect(md).not.toContain("**Thinking**")
        expect(md).not.toContain("**Function call:")
        expect(md).not.toContain("**Function result:")
        expect(md).not.toContain("yarn test")
    })

    it("labels the user heading from the turn source type", () => {
        const md = buildTaskThreadMarkdown(
            createTask([createActionEvent({ id: "a1", userInput: "Explore the auth flow", source: { type: "ask", userLabel: "Ask" }, events: [] })])
        )
        expect(md).toContain("## User (Ask)")
    })

    it("includes function calls and their params when enabled", () => {
        const action = createActionEvent({
            id: "a1",
            userInput: "Run the tests",
            events: [assistantWithToolCall("a1-exec"), toolResult("a1-exec")],
        })
        const md = buildTaskThreadMarkdown(createTask([action]), { includeFunctionInputs: true })

        expect(md).toContain("**Function call: `Bash`**")
        expect(md).toContain('"command": "yarn test"')
        // Results still excluded unless their own flag is set.
        expect(md).not.toContain("**Function result:")
    })

    it("includes function results when enabled", () => {
        const action = createActionEvent({
            id: "a1",
            userInput: "Run the tests",
            events: [assistantWithToolCall("a1-exec"), toolResult("a1-exec")],
        })
        const md = buildTaskThreadMarkdown(createTask([action]), { includeFunctionOutputs: true })

        expect(md).toContain("**Function result: `Bash`**")
        expect(md).toContain("All tests passed")
    })

    it("includes thinking when enabled", () => {
        const action = createActionEvent({
            id: "a1",
            userInput: "Run the tests",
            events: [assistantWithToolCall("a1-exec"), toolResult("a1-exec")],
        })
        const md = buildTaskThreadMarkdown(createTask([action]), { includeThinking: true })

        expect(md).toContain("**Thinking**")
        expect(md).toContain("Let me run the tests.")
    })

    it("escapes embedded code fences so they cannot break out of the block", () => {
        const action = createActionEvent({
            id: "a1",
            userInput: "Format this",
            events: [
                rawMessageEvent("a1-exec", {
                    type: "assistant",
                    message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "echo '```'" } }] },
                }),
            ],
        })
        const md = buildTaskThreadMarkdown(createTask([action]), { includeFunctionInputs: true })

        // The opening fence must be longer than the 3-backtick run inside the JSON payload.
        expect(md).toContain("````json")
    })

    it("renders a heading per turn for multi-turn tasks", () => {
        const md = buildTaskThreadMarkdown(
            createTask([
                createActionEvent({ id: "a1", userInput: "First", source: { type: "plan", userLabel: "Plan" }, events: [] }),
                createActionEvent({ id: "a2", userInput: "Second", source: { type: "do", userLabel: "Do" }, events: [] }),
            ])
        )

        expect(md).toContain("## User (Plan)")
        expect(md).toContain("## User (Do)")
        expect(md.match(/## Agent/g)).toHaveLength(2)
    })
})
