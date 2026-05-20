import { describe, it, expect } from "vitest"
import { parseClaudeEvent } from "./types.js"

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

    it("parses system:task_started event", () => {
        const raw = {
            type: "system",
            subtype: "task_started",
            task_id: "bfnq7cq4u",
            tool_use_id: "toolu_01GWjh3CwGWJypAA8rmQjvCU",
            description: "Show context around the bug pattern",
            task_type: "local_bash",
            uuid: "b8b514b2-06a0-4e91-8c71-7e605b35203d",
            session_id: "a6e94e71-7457-4191-b20a-8d154a9b0ed8",
        }

        const event = parseClaudeEvent(raw)
        expect(event).toEqual(raw)
    })

    it("parses system:task_notification event", () => {
        const raw = {
            type: "system",
            subtype: "task_notification",
            task_id: "bfnq7cq4u",
            tool_use_id: "toolu_01GWjh3CwGWJypAA8rmQjvCU",
            status: "completed",
            output_file: "",
            summary: "Show context around the bug pattern",
            uuid: "019f04f4-9b57-4499-88f3-18470e037063",
            session_id: "a6e94e71-7457-4191-b20a-8d154a9b0ed8",
        }

        const event = parseClaudeEvent(raw)
        expect(event).toEqual(raw)
    })

    it("parses system:task_progress event", () => {
        const raw = {
            type: "system",
            subtype: "task_progress",
            task_id: "aa6c4249c1723694f",
            tool_use_id: "toolu_01Nz3nyuFCq5PHarAELVEBej",
            description: "Reading projects/dashboard/src/pages/funktionalChat/state/roomStats.ts",
            usage: {
                total_tokens: 70644,
                tool_uses: 34,
                duration_ms: 96978,
            },
            last_tool_name: "Read",
            uuid: "c33bcbb9-be72-422a-b171-7489fdc5e87a",
            session_id: "1e3e7c52-0da2-404b-b30f-c51641575f32",
        }

        const event = parseClaudeEvent(raw)
        expect(event).toEqual(raw)
    })

    it("parses system:task_updated event", () => {
        const raw = {
            type: "system",
            subtype: "task_updated",
            task_id: "bhmrg4eco",
            patch: {
                status: "completed",
                end_time: 1779216586597,
            },
            uuid: "c6a59719-b446-41c1-aed0-b0b82cffe62d",
            session_id: "a6e94e71-7457-4191-b20a-8d154a9b0ed8",
        }

        const event = parseClaudeEvent(raw)
        expect(event).toEqual(raw)
    })

    it("parses system:api_retry event", () => {
        const raw = {
            type: "system",
            subtype: "api_retry",
            attempt: 10,
            max_retries: 10,
            retry_delay_ms: 35624.81064789373,
            error_status: 529,
            error: "rate_limit",
            session_id: "0848323a-5269-439c-9411-1decd4b8dc5f",
            uuid: "e1d4c18f-ba8a-4fd4-a393-b269470a074d",
        }

        const event = parseClaudeEvent(raw)
        expect(event).toEqual(raw)
    })

    it("parses SDK-known system subtypes that do not have custom renderers", () => {
        const raw = {
            type: "system",
            subtype: "permission_denied",
            tool_name: "Read",
            message: "User denied permission",
            uuid: "perm-1",
            session_id: "sess-123",
        }

        const event = parseClaudeEvent(raw)
        expect(event).toEqual(raw)
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

    it("parses result:error_max_structured_output_retries with errors array", () => {
        const raw = {
            type: "result",
            subtype: "error_max_structured_output_retries",
            is_error: true,
            duration_ms: 1000,
            duration_api_ms: 800,
            total_cost_usd: 0.01,
            num_turns: 1,
            session_id: "sess-123",
            usage: {},
            errors: ["Failed to provide valid structured output after 5 attempts"],
        }

        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("result")
        if (event!.type === "result") {
            expect(event.subtype).toBe("error_max_structured_output_retries")
            expect(event.errors).toEqual(["Failed to provide valid structured output after 5 attempts"])
        }
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

    it("parses web_search event", () => {
        const raw = {
            id: "ws_06a733061430c941016a0bc0dafe9481909d2a5c65720110ba",
            type: "web_search",
            query: "React Router Vercel deployment server-index.mjs ERR_MODULE_NOT_FOUND react-router dist development index.mjs",
            action: {
                type: "search",
                query: "React Router Vercel deployment server-index.mjs ERR_MODULE_NOT_FOUND react-router dist development index.mjs",
                queries: [
                    "React Router Vercel deployment server-index.mjs ERR_MODULE_NOT_FOUND react-router dist development index.mjs",
                    "site:vercel.com/docs react-router Vercel React Router 7 server-index.mjs",
                    "site:reactrouter.com Vercel React Router deployment",
                ],
            },
        }

        const event = parseClaudeEvent(raw)
        expect(event).toEqual(raw)
    })

    it("parses rate_limit_event", () => {
        const raw = {
            type: "rate_limit_event",
            rate_limit_info: {
                status: "allowed",
                resetsAt: 1779137400,
                rateLimitType: "five_hour",
                overageStatus: "allowed",
                overageResetsAt: 1779127200,
                isUsingOverage: false,
            },
            uuid: "c8169bce-1d40-4f3a-a0f8-9e339aa403ac",
            session_id: "1e3e7c52-0da2-404b-b30f-c51641575f32",
        }

        const event = parseClaudeEvent(raw)
        expect(event).toEqual(raw)
    })

    it("parses auth_status event", () => {
        const raw = { type: "auth_status", status: "ok" }
        const event = parseClaudeEvent(raw)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("auth_status")
    })

    it("preserves unknown top-level types as raw_json", () => {
        const raw = { type: "unknown_future_type", data: "..." }
        const event = parseClaudeEvent(raw)
        expect(event).toEqual({
            type: "raw_json",
            original_type: "unknown_future_type",
            raw,
        })
    })

    it("preserves unknown system subtypes as raw_json", () => {
        const raw = { type: "system", subtype: "unknown_future_subtype" }
        const event = parseClaudeEvent(raw)
        expect(event).toEqual({
            type: "raw_json",
            original_type: "system",
            original_subtype: "unknown_future_subtype",
            raw,
        })
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

    it("preserves system events without subtype as raw_json", () => {
        const raw = { type: "system" }
        expect(parseClaudeEvent(raw)).toEqual({
            type: "raw_json",
            original_type: "system",
            original_subtype: undefined,
            raw,
        })
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
