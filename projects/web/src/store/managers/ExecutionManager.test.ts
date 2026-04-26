import { describe, expect, it } from "vitest"
import { resolveExecutionSession } from "./ExecutionManager"

describe("resolveExecutionSession", () => {
    it("resumes the prior session when harness and model still match", () => {
        const result = resolveExecutionSession({
            taskHarnessId: "codex",
            taskModel: "gpt-5.5",
            sessionContext: {
                sessionId: "session-1",
                harnessId: "codex",
                modelId: "gpt-5.5",
            },
        })

        expect(result).toEqual({
            parentSessionId: "session-1",
            effectiveHarnessId: "codex",
            effectiveModel: "gpt-5.5",
        })
    })

    it("keeps resuming the same session while honoring a changed model selection", () => {
        const result = resolveExecutionSession({
            taskHarnessId: "codex",
            taskModel: "gpt-5.5",
            sessionContext: {
                sessionId: "session-1",
                harnessId: "codex",
                modelId: "gpt-5.4",
            },
        })

        expect(result).toEqual({
            parentSessionId: "session-1",
            effectiveHarnessId: "codex",
            effectiveModel: "gpt-5.5",
        })
    })

    it("resumes legacy sessions that do not have a persisted model id", () => {
        const result = resolveExecutionSession({
            taskHarnessId: "codex",
            taskModel: "gpt-5.5",
            sessionContext: {
                sessionId: "session-1",
                harnessId: "codex",
            },
        })

        expect(result).toEqual({
            parentSessionId: "session-1",
            effectiveHarnessId: "codex",
            effectiveModel: "gpt-5.5",
        })
    })

    it("honors explicit fresh-session runs", () => {
        const result = resolveExecutionSession({
            freshSession: true,
            taskHarnessId: "codex",
            taskModel: "gpt-5.5",
            sessionContext: {
                sessionId: "session-1",
                harnessId: "codex",
                modelId: "gpt-5.4",
            },
        })

        expect(result).toEqual({
            effectiveHarnessId: "codex",
            effectiveModel: "gpt-5.5",
        })
    })

    it("keeps the session harness authoritative when the requested harness differs", () => {
        const result = resolveExecutionSession({
            overrideHarnessId: "claude-code",
            taskHarnessId: "codex",
            taskModel: "gpt-5.5",
            sessionContext: {
                sessionId: "session-1",
                harnessId: "codex",
                modelId: "gpt-5.4",
            },
        })

        expect(result).toEqual({
            parentSessionId: "session-1",
            effectiveHarnessId: "codex",
            effectiveModel: "gpt-5.4",
        })
    })
})
