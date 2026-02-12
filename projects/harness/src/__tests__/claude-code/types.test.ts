import { describe, it, expect } from "vitest"
import { parseClaudeEvent } from "../../harnesses/claude-code/types.js"

describe("parseClaudeEvent", () => {
    it("parses system:init event", () => {
        const raw = {
            type: "system",
            subtype: "init",
            model: "claude-sonnet-4-20250514",
            tools: ["Bash", "Read", "Write"],
            mcp_servers: [],
            session_id: "test-session-123",
            slash_commands: ["/help"],
            skills: ["design"],
            plugins: [],
        }

        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("system")
        if (event!.type === "system" && event!.subtype === "init") {
            expect(event!.session_id).toBe("test-session-123")
            expect(event!.tools).toEqual(["Bash", "Read", "Write"])
        }
    })

    it("parses system:status event", () => {
        const raw = { type: "system", subtype: "status", status: "compacting" }
        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("system")
    })

    it("parses system:compact_boundary event", () => {
        const raw = {
            type: "system",
            subtype: "compact_boundary",
            compact_metadata: { trigger: "auto", pre_tokens: 50000 },
        }
        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
    })

    it("parses system:hook_started event", () => {
        const raw = {
            type: "system",
            subtype: "hook_started",
            hook_name: "pre-tool",
            hook_event: "Bash",
        }
        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
    })

    it("parses system:hook_progress event", () => {
        const raw = {
            type: "system",
            subtype: "hook_progress",
            hook_name: "pre-tool",
            content: "Running...",
        }
        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
    })

    it("parses system:hook_response event", () => {
        const raw = {
            type: "system",
            subtype: "hook_response",
            hook_name: "pre-tool",
            hook_event: "Bash",
            outcome: "approved",
        }
        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
    })

    it("parses assistant event", () => {
        const raw = {
            type: "assistant",
            message: {
                id: "msg-123",
                type: "message",
                role: "assistant",
                content: [{ type: "text", text: "Hello!" }],
                model: "claude-sonnet-4-20250514",
                stop_reason: "end_turn",
                usage: { input_tokens: 100, output_tokens: 50 },
            },
            uuid: "uuid-123",
            session_id: "sess-123",
            parent_tool_use_id: null,
        }

        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("assistant")
    })

    it("parses user event (tool results)", () => {
        const raw = {
            type: "user",
            message: {
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: "tool-123",
                        content: "file contents here",
                    },
                ],
            },
        }

        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("user")
    })

    it("parses result:success event", () => {
        const raw = {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "Done!",
            duration_ms: 5000,
            duration_api_ms: 4000,
            total_cost_usd: 0.05,
            num_turns: 3,
            session_id: "sess-123",
            usage: { input_tokens: 1000, output_tokens: 500 },
        }

        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("result")
        if (event!.type === "result") {
            expect(event!.subtype).toBe("success")
            expect(event!.total_cost_usd).toBe(0.05)
            expect(event!.duration_ms).toBe(5000)
        }
    })

    it("parses result:error_during_execution event", () => {
        const raw = {
            type: "result",
            subtype: "error_during_execution",
            is_error: true,
            result: "Error occurred",
            duration_ms: 1000,
            duration_api_ms: 800,
            total_cost_usd: 0.01,
            num_turns: 1,
            session_id: "sess-123",
            usage: {},
        }

        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("result")
    })

    it("parses tool_progress event", () => {
        const raw = { type: "tool_progress", tool_use_id: "tool-123", data: "..." }
        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("tool_progress")
    })

    it("parses tool_use_summary event", () => {
        const raw = { type: "tool_use_summary", tool_use_id: "tool-123" }
        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("tool_use_summary")
    })

    it("parses auth_status event", () => {
        const raw = { type: "auth_status", status: "ok" }
        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("auth_status")
    })

    it("returns null for unknown top-level type", () => {
        const raw = { type: "unknown_future_type", data: "..." }
        const event = parseClaudeEvent(raw)
        expect(event).toBeNull()
    })

    it("returns null for unknown system subtype", () => {
        const raw = { type: "system", subtype: "unknown_future_subtype" }
        const event = parseClaudeEvent(raw)
        expect(event).toBeNull()
    })

    it("returns null for null input", () => {
        expect(parseClaudeEvent(null)).toBeNull()
    })

    it("returns null for non-object input", () => {
        expect(parseClaudeEvent("string")).toBeNull()
        expect(parseClaudeEvent(42)).toBeNull()
        expect(parseClaudeEvent(true)).toBeNull()
    })

    it("returns null for object without type", () => {
        expect(parseClaudeEvent({ data: "no type" })).toBeNull()
    })

    it("returns null for system without subtype", () => {
        expect(parseClaudeEvent({ type: "system" })).toBeNull()
    })

    it("handles extra fields gracefully (forward-compatible)", () => {
        const raw = {
            type: "system",
            subtype: "init",
            model: "test",
            tools: [],
            mcp_servers: [],
            session_id: "s",
            slash_commands: [],
            skills: [],
            plugins: [],
            future_field: "new data",
        }

        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
        // The extra field is preserved
        expect((event as Record<string, unknown>).future_field).toBe("new data")
    })
})
