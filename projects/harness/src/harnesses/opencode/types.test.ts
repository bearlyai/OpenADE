import { describe, it, expect } from "vitest"
import { parseOpencodeEvent } from "./types.js"

describe("parseOpencodeEvent", () => {
    it("parses step_start event", () => {
        const raw = { type: "step_start", sessionID: "ses_123", part: { id: "prt_1", type: "step-start" } }
        const event = parseOpencodeEvent(raw)
        expect(event).toEqual(raw)
    })

    it("parses text event", () => {
        const raw = { type: "text", sessionID: "ses_123", part: { type: "text", text: "hello" } }
        const event = parseOpencodeEvent(raw)
        expect(event).toEqual(raw)
    })

    it("parses opencode JSON stream message part events", () => {
        const raw = { type: "message.part.delta", properties: { partID: "prt_1", field: "text", delta: "hello" } }
        const event = parseOpencodeEvent(raw)
        expect(event).toEqual(raw)
    })

    it("parses opencode JSON stream shell events", () => {
        const raw = { type: "session.next.shell.ended", properties: { callID: "call_1", command: "pwd", output: "/tmp", exit: 0 } }
        const event = parseOpencodeEvent(raw)
        expect(event).toEqual(raw)
    })

    it("parses tool_use event", () => {
        const raw = {
            type: "tool_use",
            sessionID: "ses_123",
            part: {
                id: "prt_1",
                tool: "bash",
                state: { status: "completed", input: { command: "pwd" }, output: "/tmp", metadata: { exit: 0 } },
            },
        }
        const event = parseOpencodeEvent(raw)
        expect(event).toEqual(raw)
    })

    it("parses step_finish event with usage", () => {
        const raw = {
            type: "step_finish",
            sessionID: "ses_123",
            part: {
                reason: "stop",
                cost: 0.01,
                tokens: { input: 10, output: 20, cache: { read: 3, write: 4 } },
            },
        }
        const event = parseOpencodeEvent(raw)
        expect(event).toEqual(raw)
    })

    it("parses error event", () => {
        const raw = { type: "error", error: { name: "APIError", data: { message: "rate limited" } } }
        const event = parseOpencodeEvent(raw)
        expect(event).toEqual(raw)
    })

    it("preserves unknown event types as raw_json", () => {
        const raw = { type: "future_event", data: "value" }
        expect(parseOpencodeEvent(raw)).toEqual({
            type: "raw_json",
            original_type: "future_event",
            raw,
        })
    })

    it("returns null for invalid input", () => {
        expect(parseOpencodeEvent(null)).toBeNull()
        expect(parseOpencodeEvent("nope")).toBeNull()
        expect(parseOpencodeEvent({ data: "no type" })).toBeNull()
    })
})
