import { describe, expect, it } from "vitest"
import type { HarnessStreamEvent } from "../electronAPI/harnessEventTypes"
import { extractPlanText } from "./extractPlanText"

/** Helper to build a raw_message execution event for Claude Code */
function claudeRawEvent(message: Record<string, unknown>): HarnessStreamEvent {
    return {
        id: crypto.randomUUID(),
        type: "raw_message",
        executionId: "exec-1",
        harnessId: "claude-code",
        message,
        direction: "execution",
    } as unknown as HarnessStreamEvent
}

/** Helper to build a raw_message execution event for Codex */
function codexRawEvent(message: Record<string, unknown>): HarnessStreamEvent {
    return {
        id: crypto.randomUUID(),
        type: "raw_message",
        executionId: "exec-1",
        harnessId: "codex",
        message,
        direction: "execution",
    } as unknown as HarnessStreamEvent
}

describe("extractPlanText", () => {
    describe("claude-code", () => {
        it("extracts text from result event", () => {
            const events = [
                claudeRawEvent({ type: "assistant", message: { content: [{ type: "text", text: "partial" }] } }),
                claudeRawEvent({ type: "result", result: "Final plan text here" }),
            ]
            expect(extractPlanText(events, "claude-code")).toBe("Final plan text here")
        })

        it("falls back to last assistant message text blocks", () => {
            const events = [
                claudeRawEvent({
                    type: "assistant",
                    message: { content: [{ type: "text", text: "Part 1" }, { type: "text", text: "Part 2" }] },
                }),
            ]
            expect(extractPlanText(events, "claude-code")).toBe("Part 1\nPart 2")
        })

        it("prefers result over assistant message", () => {
            const events = [
                claudeRawEvent({
                    type: "assistant",
                    message: { content: [{ type: "text", text: "Old text" }] },
                }),
                claudeRawEvent({ type: "result", result: "Newer result" }),
            ]
            expect(extractPlanText(events, "claude-code")).toBe("Newer result")
        })

        it("returns null for empty events", () => {
            expect(extractPlanText([], "claude-code")).toBeNull()
        })

        it("returns null when result is empty string", () => {
            const events = [claudeRawEvent({ type: "result", result: "" })]
            expect(extractPlanText(events, "claude-code")).toBeNull()
        })

        it("ignores command-direction events", () => {
            const events: HarnessStreamEvent[] = [
                {
                    id: crypto.randomUUID(),
                    type: "start_query",
                    executionId: "exec-1",
                    prompt: "hi",
                    options: { harnessId: "claude-code", cwd: "/" },
                    direction: "command",
                } as HarnessStreamEvent,
            ]
            expect(extractPlanText(events, "claude-code")).toBeNull()
        })
    })

    describe("codex", () => {
        it("extracts text from item.completed agent_message events", () => {
            const events = [
                codexRawEvent({ type: "item.completed", item: { type: "agent_message", text: "Plan step 1" } }),
                codexRawEvent({ type: "item.completed", item: { type: "agent_message", text: "Plan step 2" } }),
            ]
            expect(extractPlanText(events, "codex")).toBe("Plan step 1\nPlan step 2")
        })

        it("ignores non-agent_message items", () => {
            const events = [
                codexRawEvent({ type: "item.completed", item: { type: "tool_call", text: "ignored" } }),
                codexRawEvent({ type: "item.completed", item: { type: "agent_message", text: "kept" } }),
            ]
            expect(extractPlanText(events, "codex")).toBe("kept")
        })

        it("returns null for empty events", () => {
            expect(extractPlanText([], "codex")).toBeNull()
        })

        it("returns null when no agent_message items exist", () => {
            const events = [
                codexRawEvent({ type: "item.completed", item: { type: "tool_call" } }),
            ]
            expect(extractPlanText(events, "codex")).toBeNull()
        })
    })

    describe("unknown harness", () => {
        it("returns null for unsupported harnessId", () => {
            const events = [claudeRawEvent({ type: "result", result: "text" })]
            expect(extractPlanText(events, "unknown-harness" as never)).toBeNull()
        })
    })
})
