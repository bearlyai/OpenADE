import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ClientHarnessQueryOptions } from "../electronAPI/harnessQuery"
import { HyperPlanExecutor, type HyperPlanCallbacks } from "./HyperPlanExecutor"
import { peerReviewStrategy } from "./strategies"
import type { AgentCouplet } from "./types"

const harnessMockState = vi.hoisted(() => ({
    calls: [] as Array<{ prompt: string; options: ClientHarnessQueryOptions; executionId?: string }>,
    sessionSequence: [] as Array<string | undefined>,
    cleanupCalls: [] as string[],
}))

vi.mock("./extractPlanText", () => ({
    extractPlanText: () => "mock-step-result",
}))

vi.mock("../constants", () => ({
    getModelFullId: (modelId: string) => modelId,
}))

vi.mock("../electronAPI/harnessQuery", () => ({
    isHarnessApiAvailable: () => true,
    getHarnessQueryManager: () => ({
        startExecution: async (prompt: string, options: ClientHarnessQueryOptions, executionId?: string) => {
            harnessMockState.calls.push({ prompt, options, executionId })
            const sessionId = harnessMockState.sessionSequence.shift()
            const handlers: Array<(sessionId: string) => void> = []
            const id = executionId ?? `exec-${harnessMockState.calls.length}`

            return {
                id,
                options,
                executionState: {
                    executionId: id,
                    harnessId: options.harnessId,
                    status: "completed",
                    events: [
                        {
                            id: `complete-${id}`,
                            type: "complete",
                            executionId: id,
                            harnessId: options.harnessId,
                            direction: "execution",
                        },
                    ],
                    createdAt: "2026-01-01T00:00:00.000Z",
                },
                onSessionId: (handler: (sid: string) => void) => {
                    handlers.push(handler)
                },
                stream: async function* () {
                    if (sessionId) {
                        for (const h of handlers) h(sessionId)
                    }
                    yield { type: "result", result: "ok" }
                },
                abort: async () => {},
                clearBuffer: async () => {},
            }
        },
        cleanup: (executionId: string) => {
            harnessMockState.cleanupCalls.push(executionId)
        },
    }),
}))

const claude: AgentCouplet = { harnessId: "claude-code", modelId: "opus" }
const codex: AgentCouplet = { harnessId: "codex", modelId: "gpt-5.3-codex" }

function createCallbacks() {
    const terminalSessions: Array<{ sessionId: string; parentSessionId?: string }> = []
    const subPlanSessions: Array<{ stepId: string; sessionId: string; parentSessionId?: string }> = []
    const callbacks: HyperPlanCallbacks = {
        onSubPlanStarted: () => {},
        onSubPlanEvent: () => {},
        onSubPlanSessionId: (stepId, sessionId, parentSessionId) => {
            subPlanSessions.push({ stepId, sessionId, parentSessionId })
        },
        onSubPlanStatusChange: () => {},
        onTerminalEvent: () => {},
        onTerminalSessionId: (sessionId, parentSessionId) => {
            terminalSessions.push({ sessionId, parentSessionId })
        },
        onLabelMapping: () => {},
    }
    return { callbacks, terminalSessions, subPlanSessions }
}

beforeEach(() => {
    harnessMockState.calls = []
    harnessMockState.cleanupCalls = []
    harnessMockState.sessionSequence = []
})

describe("HyperPlanExecutor peer-review revise flow", () => {
    it("passes resumeSessionId to revise and reports terminal parentSessionId", async () => {
        harnessMockState.sessionSequence = ["plan-session-1", "review-session-1", "plan-session-1"]
        const { callbacks, terminalSessions, subPlanSessions } = createCallbacks()
        const abortController = new AbortController()

        const executor = new HyperPlanExecutor({
            strategy: peerReviewStrategy(claude, codex),
            taskDescription: "Implement feature X",
            cwd: "/tmp",
            callbacks,
            signal: abortController.signal,
        })

        const result = await executor.execute()

        expect(result.success).toBe(true)
        expect(harnessMockState.calls).toHaveLength(3)
        expect(harnessMockState.calls[2].options.resumeSessionId).toBe("plan-session-1")
        expect(harnessMockState.calls[2].options.forkSession).toBe(false)
        expect(subPlanSessions).toEqual([
            { stepId: "plan_a", sessionId: "plan-session-1", parentSessionId: undefined },
            { stepId: "review_b", sessionId: "review-session-1", parentSessionId: undefined },
        ])
        expect(terminalSessions).toEqual([{ sessionId: "plan-session-1", parentSessionId: "plan-session-1" }])
    })

    it("fails terminal revise when the referenced plan session is unavailable", async () => {
        harnessMockState.sessionSequence = [undefined, "review-session-1"]
        const { callbacks, terminalSessions } = createCallbacks()
        const abortController = new AbortController()

        const executor = new HyperPlanExecutor({
            strategy: peerReviewStrategy(claude, codex),
            taskDescription: "Implement feature X",
            cwd: "/tmp",
            callbacks,
            signal: abortController.signal,
        })

        const result = await executor.execute()

        expect(result.success).toBe(false)
        // plan + review run; revise fails before startExecution because resume session is missing
        expect(harnessMockState.calls).toHaveLength(2)
        expect(terminalSessions).toEqual([])
    })
})
