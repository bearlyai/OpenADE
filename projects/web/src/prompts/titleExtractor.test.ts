import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ActionEvent, CodeEvent } from "../types"
import type { HarnessStreamEvent } from "../electronAPI/harnessEventTypes"
import { fallbackTitle, generateSlug, generateTitle } from "./titleExtractor"

// Capture the prompt passed to startExecution
let capturedPrompt: string | null = null

vi.mock("../electronAPI/harnessQuery", () => ({
    getHarnessQueryManager: () => ({
        startExecution: async (prompt: string) => {
            capturedPrompt = prompt
            return {
                stream: async function* () {
                    yield { type: "result", result: "Title: Test Title" }
                },
                abort: () => {},
                cleanup: () => {},
            }
        },
    }),
}))

vi.mock("../constants", () => ({
    MODEL_REGISTRY: { "claude-code": { models: [{ id: "sonnet" }] } },
    getDefaultModelForHarness: () => "sonnet",
    getModelFullId: (alias: string) => `claude-${alias}`,
}))

function makeActionEvent(overrides: {
    id?: string
    userInput?: string
    harnessId?: "claude-code" | "codex"
    streamEvents?: HarnessStreamEvent[]
}): ActionEvent {
    const id = overrides.id ?? crypto.randomUUID()
    return {
        id,
        type: "action",
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:10.000Z",
        userInput: overrides.userInput ?? "",
        execution: {
            harnessId: overrides.harnessId ?? "claude-code",
            executionId: `${id}-exec`,
            events: overrides.streamEvents ?? [],
        },
        source: { type: "do", userLabel: "Do" },
        includesCommentIds: [],
    } as ActionEvent
}

beforeEach(() => {
    capturedPrompt = null
})

describe("generateSlug", () => {
    it("generates a slug with task- prefix and 8 random chars", () => {
        const slug = generateSlug()
        expect(slug).toMatch(/^task-[a-z0-9]{8}$/)
    })

    it("generates unique slugs", () => {
        const slugs = new Set(Array.from({ length: 100 }, () => generateSlug()))
        expect(slugs.size).toBe(100)
    })
})

describe("fallbackTitle", () => {
    it("returns short descriptions unchanged", () => {
        expect(fallbackTitle("Fix login bug")).toBe("Fix login bug")
    })

    it("truncates long descriptions to 50 chars with ellipsis", () => {
        const long = "a".repeat(100)
        const result = fallbackTitle(long)
        expect(result.length).toBe(53) // 50 + "..."
        expect(result.endsWith("...")).toBe(true)
    })

    it("collapses whitespace", () => {
        expect(fallbackTitle("  fix   the   bug  ")).toBe("fix the bug")
    })
})

describe("generateTitle", () => {
    it("includes serialized thread XML in prompt when events are provided", async () => {
        const events: CodeEvent[] = [makeActionEvent({ userInput: "Fix the login bug" })]
        await generateTitle("Fix login", new AbortController(), "claude-code", events)

        expect(capturedPrompt).toContain("Here is some of the conversation so far:")
        expect(capturedPrompt).toContain("<task")
        expect(capturedPrompt).toContain("Fix the login bug")
    })

    it("does not duplicate description in serialized context", async () => {
        const description = "A".repeat(500)
        const events: CodeEvent[] = [makeActionEvent({ userInput: "do it" })]
        await generateTitle(description, new AbortController(), "claude-code", events)

        // Description appears once at the top of the prompt, not inside <description> in the XML
        const xmlPortion = capturedPrompt!.split("Here is some of the conversation so far:")[1]
        expect(xmlPortion).not.toContain(description)
    })

    it("does not include thread context when no events are provided", async () => {
        await generateTitle("Fix login", new AbortController(), "claude-code")

        expect(capturedPrompt).not.toContain("<task")
        expect(capturedPrompt).not.toContain("conversation so far")
    })

    it("does not include thread context when events array is empty", async () => {
        await generateTitle("Fix login", new AbortController(), "claude-code", [])

        expect(capturedPrompt).not.toContain("<task")
    })

    it("uses middle truncation to keep first and last events", async () => {
        // Create many events with large user inputs to exceed the 2KB budget
        const events: CodeEvent[] = Array.from({ length: 10 }, (_, i) => makeActionEvent({ id: `ev-${i}`, userInput: `Message ${i}: ${"x".repeat(300)}` }))
        await generateTitle("Fix bug", new AbortController(), "claude-code", events)

        // First and last events should be present
        expect(capturedPrompt).toContain("Message 0:")
        expect(capturedPrompt).toContain("Message 9:")
    })
})
