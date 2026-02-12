import { describe, it, expect } from "vitest"
import { parseCodexEvent } from "../../harnesses/codex/types.js"

describe("parseCodexEvent", () => {
    it("parses thread.started event", () => {
        const raw = { type: "thread.started", thread_id: "thread-abc" }
        const event = parseCodexEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("thread.started")
        if (event!.type === "thread.started") {
            expect(event!.thread_id).toBe("thread-abc")
        }
    })

    it("parses turn.started event", () => {
        const raw = { type: "turn.started" }
        const event = parseCodexEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("turn.started")
    })

    it("parses turn.completed event with usage", () => {
        const raw = {
            type: "turn.completed",
            usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 20 },
        }
        const event = parseCodexEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("turn.completed")
        if (event!.type === "turn.completed") {
            expect(event!.usage.input_tokens).toBe(100)
            expect(event!.usage.output_tokens).toBe(50)
            expect(event!.usage.cached_input_tokens).toBe(20)
        }
    })

    it("parses turn.failed event", () => {
        const raw = {
            type: "turn.failed",
            error: { message: "rate limit exceeded", code: "rate_limited" },
        }
        const event = parseCodexEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("turn.failed")
        if (event!.type === "turn.failed") {
            expect(event!.error.message).toBe("rate limit exceeded")
        }
    })

    it("parses error event", () => {
        const raw = { type: "error", message: "Something broke" }
        const event = parseCodexEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("error")
        if (event!.type === "error") {
            expect(event!.message).toBe("Something broke")
        }
    })

    it("parses item.started with reasoning item", () => {
        const raw = {
            type: "item.started",
            item: { id: "item-1", type: "reasoning", text: "Let me think..." },
        }
        const event = parseCodexEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("item.started")
        if (event!.type === "item.started") {
            expect(event!.item.type).toBe("reasoning")
        }
    })

    it("parses item.completed with agent_message item", () => {
        const raw = {
            type: "item.completed",
            item: { id: "item-2", type: "agent_message", text: "Here is the answer" },
        }
        const event = parseCodexEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("item.completed")
        if (event!.type === "item.completed") {
            expect(event!.item.type).toBe("agent_message")
        }
    })

    it("parses item.completed with command_execution item", () => {
        const raw = {
            type: "item.completed",
            item: {
                id: "item-3",
                type: "command_execution",
                command: "ls -la",
                aggregated_output: "total 0\n...",
                exit_code: 0,
                status: "completed",
            },
        }
        const event = parseCodexEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("item.completed")
        if (event!.type === "item.completed" && event!.item.type === "command_execution") {
            expect(event!.item.command).toBe("ls -la")
            expect(event!.item.exit_code).toBe(0)
        }
    })

    it("parses item.started with command_execution in_progress", () => {
        const raw = {
            type: "item.started",
            item: {
                id: "item-3",
                type: "command_execution",
                command: "npm test",
                aggregated_output: "",
                exit_code: null,
                status: "in_progress",
            },
        }
        const event = parseCodexEvent(raw)
        expect(event).not.toBeNull()
        if (event!.type === "item.started" && event!.item.type === "command_execution") {
            expect(event!.item.status).toBe("in_progress")
            expect(event!.item.exit_code).toBeNull()
        }
    })

    it("returns null for unknown event type", () => {
        const raw = { type: "future.event", data: "something new" }
        const event = parseCodexEvent(raw)
        expect(event).toBeNull()
    })

    it("returns null for null input", () => {
        expect(parseCodexEvent(null)).toBeNull()
    })

    it("returns null for non-object input", () => {
        expect(parseCodexEvent("string")).toBeNull()
        expect(parseCodexEvent(42)).toBeNull()
    })

    it("returns null for object without type", () => {
        expect(parseCodexEvent({ data: "no type" })).toBeNull()
    })

    it("handles extra fields gracefully (forward-compatible)", () => {
        const raw = {
            type: "thread.started",
            thread_id: "t-1",
            new_future_field: "extra data",
        }
        const event = parseCodexEvent(raw)
        expect(event).not.toBeNull()
        expect((event as Record<string, unknown>).new_future_field).toBe("extra data")
    })

    it("handles turn.failed with extra error fields", () => {
        const raw = {
            type: "turn.failed",
            error: {
                message: "failed",
                code: "internal_error",
                extra: { detail: "more info" },
            },
        }
        const event = parseCodexEvent(raw)
        expect(event).not.toBeNull()
        if (event!.type === "turn.failed") {
            expect(event!.error.message).toBe("failed")
            expect((event!.error as Record<string, unknown>).code).toBe("internal_error")
        }
    })
})
