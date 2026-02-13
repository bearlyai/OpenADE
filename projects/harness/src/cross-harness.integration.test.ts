import { describe, it, expect, afterEach } from "vitest"
import { execFileSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { tmpdir } from "node:os"

import { HarnessRegistry } from "./registry.js"
import { ClaudeCodeHarness } from "./harnesses/claude-code/index.js"
import { CodexHarness } from "./harnesses/codex/index.js"
import type { Harness } from "./harness.js"
import type { HarnessEvent } from "./types.js"
import { collectEvents, makeTmpDir, trivialSignal } from "./integration-helpers.js"

const claude = new ClaudeCodeHarness()
const codex = new CodexHarness()

const [claudeStatus, codexStatus] = await Promise.all([claude.checkInstallStatus(), codex.checkInstallStatus()])
const claudeReady = claudeStatus.installed && claudeStatus.authenticated
const codexReady = codexStatus.installed && codexStatus.authenticated

const tmpDirs: Array<{ cleanup: () => Promise<void> }> = []

afterEach(async () => {
    for (const dir of tmpDirs) {
        await dir.cleanup()
    }
    tmpDirs.length = 0
})

async function getTmpDir(): Promise<string> {
    const tmp = await makeTmpDir()
    tmpDirs.push(tmp)
    // Codex requires a trusted (git) directory
    execFileSync("git", ["init"], { cwd: tmp.path, stdio: "ignore" })
    return tmp.path
}

const VALID_EVENT_TYPES = new Set(["session_started", "message", "complete", "error", "stderr"])

describe.skipIf(!claudeReady || !codexReady)("Cross-harness integration", () => {
    // ============================================================================
    // 1. Registry integration
    // ============================================================================

    describe("1. Registry integration", () => {
        it("1a. Register both harnesses and check all install status", async () => {
            const registry = new HarnessRegistry()
            registry.register(claude)
            registry.register(codex)

            const statuses = await registry.checkAllInstallStatus()

            const claudeStatus = statuses.get("claude-code")
            expect(claudeStatus).toBeDefined()
            expect(claudeStatus!.installed).toBe(true)
            expect(claudeStatus!.authenticated).toBe(true)

            const codexStatus = statuses.get("codex")
            expect(codexStatus).toBeDefined()
            expect(codexStatus!.installed).toBe(true)
            expect(codexStatus!.authenticated).toBe(true)
        })
    })

    // ============================================================================
    // 2. Interface contract
    // ============================================================================

    describe("2. Interface contract", () => {
        it("2a. Both harnesses produce the same event envelope types", async () => {
            const harnesses: Harness[] = [claude, codex]

            for (const h of harnesses) {
                const tmpDir = await getTmpDir()
                const events = await collectEvents(
                    h.query({
                        prompt: "Reply with exactly: hello",
                        cwd: tmpDir,
                        mode: "yolo",
                        signal: trivialSignal(),
                    })
                )

                // Check that expected event types are present
                const eventTypes = new Set(events.map((e) => e.type))
                expect(eventTypes.has("session_started"), `${h.id} should emit session_started`).toBe(true)
                expect(eventTypes.has("message"), `${h.id} should emit message`).toBe(true)
                expect(eventTypes.has("complete"), `${h.id} should emit complete`).toBe(true)

                // Check no unexpected event types
                for (const type of eventTypes) {
                    expect(VALID_EVENT_TYPES.has(type), `${h.id}: unexpected event type '${type}'`).toBe(true)
                }
            }
        })

        it("2b. Capabilities reflect reality", async () => {
            // Claude capabilities
            const claudeCaps = claude.capabilities()
            expect(claudeCaps.supportsResume).toBe(true)
            expect(claudeCaps.supportsFork).toBe(true)
            expect(claudeCaps.supportsSystemPrompt).toBe(true)
            expect(claudeCaps.supportsCostTracking).toBe(true)

            // Codex capabilities
            const codexCaps = codex.capabilities()
            expect(codexCaps.supportsFork).toBe(false)
            expect(codexCaps.supportsCostTracking).toBe(false)
            expect(codexCaps.supportsSystemPrompt).toBe(false)
        })
    })

    // ============================================================================
    // 3. Abort cleanup
    // ============================================================================

    describe("3. Abort cleanup", () => {
        it("3a. Both harnesses clean up after abort", async () => {
            const harnesses: Harness[] = [claude, codex]

            for (const h of harnesses) {
                const tmpDir = await getTmpDir()

                // Snapshot temp files before
                const tmpBase = tmpdir()
                // Only track non-integ harness temp files (harness-integ-* are test tmp dirs)
                const filesBefore = new Set(readdirSync(tmpBase).filter((f) => f.startsWith("harness-") && !f.startsWith("harness-integ-")))

                const controller = new AbortController()

                const tool = {
                    name: "test_noop",
                    description: "A no-op tool for testing cleanup",
                    inputSchema: { type: "object" as const, properties: {} },
                    handler: async () => ({ content: "ok" }),
                }

                const events: HarnessEvent<unknown>[] = []
                const gen = h.query({
                    prompt: "Write a 2000 word essay about the history of computing",
                    cwd: tmpDir,
                    mode: "yolo",
                    clientTools: [tool],
                    signal: controller.signal,
                })

                let aborted = false
                const startTime = Date.now()

                for await (const event of gen) {
                    events.push(event)
                    if (event.type === "message" && !aborted) {
                        controller.abort()
                        aborted = true
                    }
                }

                // Generator should have exited cleanly within bounded time
                const elapsed = Date.now() - startTime
                expect(elapsed, `${h.id}: generator should exit within 30s`).toBeLessThan(30_000)

                // Small delay for async cleanup
                await new Promise((r) => setTimeout(r, 1000))

                // Check no new harness temp files remain
                const filesAfter = new Set(readdirSync(tmpBase).filter((f) => f.startsWith("harness-") && !f.startsWith("harness-integ-")))
                const newFiles = [...filesAfter].filter((f) => !filesBefore.has(f))
                expect(newFiles, `${h.id}: no new temp files should remain after cleanup`).toEqual([])
            }
        })
    })
})
