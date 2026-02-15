import { describe, expect, it } from "vitest"
import type { HarnessStreamEvent } from "../electronAPI/harnessEventTypes"
import type { CodeEvent, ActionEvent, SetupEnvironmentEvent } from "../types"
import { buildConversationContext } from "./titleExtractor"

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

/** Helper to build an ActionEvent with Claude Code execution */
function makeActionEvent(overrides: {
    userInput?: string
    harnessId?: "claude-code" | "codex"
    streamEvents?: HarnessStreamEvent[]
}): ActionEvent {
    return {
        id: crypto.randomUUID(),
        type: "action",
        status: "completed",
        createdAt: new Date().toISOString(),
        userInput: overrides.userInput ?? "",
        execution: {
            harnessId: overrides.harnessId ?? "claude-code",
            executionId: "exec-1",
            events: overrides.streamEvents ?? [],
        },
        source: { type: "do", userLabel: "Do" },
        includesCommentIds: [],
    } as ActionEvent
}

/** Helper to build a SetupEnvironmentEvent */
function makeSetupEvent(): SetupEnvironmentEvent {
    return {
        id: crypto.randomUUID(),
        type: "setup_environment",
        status: "completed",
        createdAt: new Date().toISOString(),
        userInput: "",
        worktreeId: "wt-1",
        deviceId: "dev-1",
        workingDir: "/tmp",
    }
}

describe("buildConversationContext", () => {
    it("returns null when events array is empty", () => {
        expect(buildConversationContext([])).toBeNull()
    })

    it("returns null when no action events exist", () => {
        const events: CodeEvent[] = [makeSetupEvent()]
        expect(buildConversationContext(events)).toBeNull()
    })

    it("returns null when action events have no userInput or assistant text", () => {
        const events: CodeEvent[] = [makeActionEvent({ userInput: "", streamEvents: [] })]
        expect(buildConversationContext(events)).toBeNull()
    })

    it("extracts user input from action events", () => {
        const events: CodeEvent[] = [makeActionEvent({ userInput: "Fix the login bug" })]
        expect(buildConversationContext(events)).toBe("User: Fix the login bug")
    })

    it("extracts assistant text from Claude Code result events", () => {
        const events: CodeEvent[] = [
            makeActionEvent({
                userInput: "Fix the login bug",
                streamEvents: [claudeRawEvent({ type: "result", result: "I fixed the authentication check in login.ts" })],
            }),
        ]
        expect(buildConversationContext(events)).toBe("User: Fix the login bug\nAssistant: I fixed the authentication check in login.ts")
    })

    it("extracts assistant text from Codex agent_message events", () => {
        const events: CodeEvent[] = [
            makeActionEvent({
                userInput: "Fix the login bug",
                harnessId: "codex",
                streamEvents: [
                    codexRawEvent({
                        type: "item.completed",
                        item: { type: "agent_message", text: "I fixed the auth check" },
                    }),
                ],
            }),
        ]
        expect(buildConversationContext(events)).toBe("User: Fix the login bug\nAssistant: I fixed the auth check")
    })

    it("handles multiple action events as conversation turns", () => {
        const events: CodeEvent[] = [
            makeActionEvent({
                userInput: "Fix the login bug",
                streamEvents: [claudeRawEvent({ type: "result", result: "I found the issue in auth.ts" })],
            }),
            makeActionEvent({
                userInput: "Also update the tests",
                streamEvents: [claudeRawEvent({ type: "result", result: "Tests updated for the auth fix" })],
            }),
        ]
        expect(buildConversationContext(events)).toBe(
            "User: Fix the login bug\n" +
                "Assistant: I found the issue in auth.ts\n" +
                "User: Also update the tests\n" +
                "Assistant: Tests updated for the auth fix"
        )
    })

    it("skips non-action events interspersed with action events", () => {
        const events: CodeEvent[] = [
            makeActionEvent({
                userInput: "Fix the bug",
                streamEvents: [claudeRawEvent({ type: "result", result: "Fixed" })],
            }),
            makeSetupEvent(),
            makeActionEvent({
                userInput: "Run tests",
                streamEvents: [claudeRawEvent({ type: "result", result: "Tests pass" })],
            }),
        ]
        expect(buildConversationContext(events)).toBe("User: Fix the bug\nAssistant: Fixed\nUser: Run tests\nAssistant: Tests pass")
    })

    it("includes user input even when assistant text is missing", () => {
        const events: CodeEvent[] = [
            makeActionEvent({
                userInput: "Fix the bug",
                streamEvents: [], // no assistant output
            }),
        ]
        expect(buildConversationContext(events)).toBe("User: Fix the bug")
    })

    it("includes assistant text even when user input is empty", () => {
        const events: CodeEvent[] = [
            makeActionEvent({
                userInput: "",
                streamEvents: [claudeRawEvent({ type: "result", result: "Auto-generated response" })],
            }),
        ]
        expect(buildConversationContext(events)).toBe("Assistant: Auto-generated response")
    })

    it("truncates context to MAX_CONVERSATION_CONTEXT_CHARS", () => {
        const longText = "x".repeat(3000)
        const events: CodeEvent[] = [
            makeActionEvent({
                userInput: longText,
            }),
        ]
        const result = buildConversationContext(events)!
        // "User: " (6 chars) + 3000 chars = 3006 total, should be truncated to 2000 + "..."
        expect(result.length).toBe(2003) // 2000 + "..."
        expect(result.endsWith("...")).toBe(true)
    })

    it("does not truncate context within the limit", () => {
        const events: CodeEvent[] = [
            makeActionEvent({
                userInput: "Short input",
                streamEvents: [claudeRawEvent({ type: "result", result: "Short output" })],
            }),
        ]
        const result = buildConversationContext(events)!
        expect(result).not.toContain("...")
        expect(result).toBe("User: Short input\nAssistant: Short output")
    })
})
