import { describe, it, expect } from "vitest"
import type { Harness } from "./harness.js"
import { HarnessStructuredOutputError } from "./errors.js"
import { runStructuredQuery } from "./structured.js"
import type { HarnessEvent } from "./types.js"

function makeHarness(events: HarnessEvent<unknown>[]): Pick<Harness, "id" | "query"> {
    return {
        id: "claude-code",
        async *query() {
            for (const event of events) {
                yield event
            }
        },
    }
}

describe("runStructuredQuery", () => {
    it("returns parsed structured output with metadata", async () => {
        const harness = makeHarness([
            { type: "session_started", sessionId: "sess-1" },
            { type: "complete", usage: { inputTokens: 1, outputTokens: 1 }, structuredOutput: { answer: "ok" } },
        ])

        const result = await runStructuredQuery(harness, {
            prompt: "hello",
            cwd: "/tmp",
            mode: "yolo",
            signal: new AbortController().signal,
            output: {
                schema: { type: "object" },
                parse: (value) => {
                    const obj = value as { answer: string }
                    return obj.answer.toUpperCase()
                },
            },
        })

        expect(result.output).toBe("OK")
        expect(result.sessionId).toBe("sess-1")
        expect(result.usage?.inputTokens).toBe(1)
    })

    it("throws when stream contains error events", async () => {
        const harness = makeHarness([
            { type: "error", error: "boom", code: "unknown" },
            { type: "complete", usage: { inputTokens: 0, outputTokens: 0 } },
        ])

        await expect(
            runStructuredQuery(harness, {
                prompt: "hello",
                cwd: "/tmp",
                mode: "yolo",
                signal: new AbortController().signal,
                output: { schema: { type: "object" } },
            })
        ).rejects.toThrow("boom")
    })

    it("surfaces provider errors when output is missing", async () => {
        const harness = makeHarness([
            {
                type: "message",
                message: {
                    type: "result",
                    subtype: "error_max_structured_output_retries",
                    is_error: true,
                    errors: ["Failed to provide valid structured output after 5 attempts"],
                },
            },
            { type: "complete", usage: { inputTokens: 1, outputTokens: 1 } },
        ])

        await expect(
            runStructuredQuery(harness, {
                prompt: "hello",
                cwd: "/tmp",
                mode: "yolo",
                signal: new AbortController().signal,
                output: { schema: { type: "object" } },
            })
        ).rejects.toThrow("Provider errors: Failed to provide valid structured output after 5 attempts")
    })

    it("throws HarnessStructuredOutputError when parser rejects output", async () => {
        const harness = makeHarness([
            { type: "complete", usage: { inputTokens: 1, outputTokens: 1 }, structuredOutput: { answer: "ok" } },
        ])

        await expect(
            runStructuredQuery(harness, {
                prompt: "hello",
                cwd: "/tmp",
                mode: "yolo",
                signal: new AbortController().signal,
                output: {
                    schema: { type: "object" },
                    parse: () => {
                        throw new Error("invalid")
                    },
                },
            })
        ).rejects.toBeInstanceOf(HarnessStructuredOutputError)
    })
})
