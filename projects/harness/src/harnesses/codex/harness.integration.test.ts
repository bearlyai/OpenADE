import { describe, it, expect, afterEach } from "vitest"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

import { CodexHarness } from "./index.js"
import type { CodexEvent, CodexItemCompletedEvent, CodexAgentMessageItem, CodexCommandExecutionItem } from "./types.js"
import type { HarnessEvent } from "../../types.js"
import {
    collectEvents,
    makeTmpDir,
    writeEchoMcpServer,
    trivialSignal,
    standardSignal,
    heavySignal,
    findAllMessages,
    getCompleteEvent,
    getSessionStartedEvent,
    getErrorEvents,
} from "../../integration-helpers.js"

const harness = new CodexHarness()
const status = await harness.checkInstallStatus()
const ready = status.installed && status.authenticated

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

function extractAgentText(messages: CodexEvent[]): string {
    return messages
        .filter((m): m is CodexItemCompletedEvent => m.type === "item.completed")
        .map((m) => m.item)
        .filter((item): item is CodexAgentMessageItem => item.type === "agent_message")
        .map((item) => item.text)
        .join(" ")
}

// ============================================================================
// 1. Install status
// ============================================================================

describe("1. Install status", () => {
    it("1a. checkInstallStatus reports installed with valid shape", async () => {
        const status = await harness.checkInstallStatus()
        expect(status.installed).toBe(true)
        expect(status.version).toBeTruthy()
        expect(typeof status.version).toBe("string")
        expect(typeof status.authenticated).toBe("boolean")
        if (!status.authenticated) {
            expect(status.authInstructions).toBeTruthy()
        }
    })
})

describe.skipIf(!ready)("Codex (authenticated)", () => {
    // ============================================================================
    // 1b. Discovery (requires auth)
    // ============================================================================

    describe("1. Install status", () => {
        it("1b. discoverSlashCommands returns empty array", async () => {
            const tmpDir = await getTmpDir()
            const commands = await harness.discoverSlashCommands(tmpDir)
            expect(commands).toEqual([])
        })
    })

    // ============================================================================
    // 2. Basic query lifecycle
    // ============================================================================

    describe("2. Basic query lifecycle", () => {
        it("2a. Simple prompt yields session_started, agent message, and complete", async () => {
            const tmpDir = await getTmpDir()
            const events = await collectEvents(
                harness.query({
                    prompt: "Reply with exactly: hello",
                    cwd: tmpDir,
                    mode: "yolo",
                    signal: trivialSignal(),
                })
            )

            const sessionStarted = getSessionStartedEvent(events)
            expect(sessionStarted).toBeDefined()
            expect(sessionStarted!.sessionId).toBeTruthy()

            const messages = findAllMessages<CodexEvent>(events)
            const hasAgentMessage = messages.some((m) => m.type === "item.completed" && (m as CodexItemCompletedEvent).item.type === "agent_message")
            expect(hasAgentMessage).toBe(true)

            const complete = getCompleteEvent(events)
            expect(complete).toBeDefined()
        })

        it("2b. Complete event includes usage with token counts", async () => {
            const tmpDir = await getTmpDir()
            const events = await collectEvents(
                harness.query({
                    prompt: "Reply with exactly: hello",
                    cwd: tmpDir,
                    mode: "yolo",
                    signal: trivialSignal(),
                })
            )

            const complete = getCompleteEvent(events)
            expect(complete).toBeDefined()
            expect(complete!.usage).toBeDefined()

            const usage = complete!.usage!
            expect(usage.inputTokens).toBeGreaterThan(0)
            expect(usage.outputTokens).toBeGreaterThan(0)
            expect(typeof usage.durationMs).toBe("number")
            expect(usage.durationMs!).toBeGreaterThan(0)
            // Codex doesn't report cost
            expect(usage.costUsd).toBeUndefined()
        })

        it("2c. Thread started event is emitted", async () => {
            const tmpDir = await getTmpDir()
            const events = await collectEvents(
                harness.query({
                    prompt: "Reply with exactly: hello",
                    cwd: tmpDir,
                    mode: "yolo",
                    signal: trivialSignal(),
                })
            )

            const messages = findAllMessages<CodexEvent>(events)
            const threadStarted = messages.find((m) => m.type === "thread.started")
            expect(threadStarted).toBeDefined()
            expect((threadStarted as { thread_id: string }).thread_id).toBeTruthy()
        })
    })

    // ============================================================================
    // 3. Command execution
    // ============================================================================

    describe("3. Command execution", () => {
        it("3a. Prompt that triggers a shell command", async () => {
            const tmpDir = await getTmpDir()
            await writeFile(join(tmpDir, "marker.txt"), "codex-integration-test", "utf-8")

            const events = await collectEvents(
                harness.query({
                    prompt: "List the files in the current directory",
                    cwd: tmpDir,
                    mode: "yolo",
                    signal: standardSignal(),
                })
            )

            const messages = findAllMessages<CodexEvent>(events)
            const cmdExec = messages.filter((m): m is CodexItemCompletedEvent => m.type === "item.completed").find((m) => m.item.type === "command_execution")

            expect(cmdExec).toBeDefined()
            const cmdItem = cmdExec!.item as CodexCommandExecutionItem
            expect(cmdItem.exit_code).toBe(0)
        })
    })

    // ============================================================================
    // 4. Modes and permissions
    // ============================================================================

    describe("4. Modes and permissions", () => {
        it("4a. Read-only mode completes without error", async () => {
            const tmpDir = await getTmpDir()
            const events = await collectEvents(
                harness.query({
                    prompt: "What is 2 + 2?",
                    cwd: tmpDir,
                    mode: "read-only",
                    signal: trivialSignal(),
                })
            )

            const complete = getCompleteEvent(events)
            expect(complete).toBeDefined()

            const errors = getErrorEvents(events)
            expect(errors).toHaveLength(0)
        })

        it("4b. Yolo mode allows file creation", async () => {
            const tmpDir = await getTmpDir()
            const events = await collectEvents(
                harness.query({
                    prompt: "Create a file called out.txt containing 'hello' in the current directory",
                    cwd: tmpDir,
                    mode: "yolo",
                    signal: standardSignal(),
                })
            )

            const complete = getCompleteEvent(events)
            expect(complete).toBeDefined()

            expect(existsSync(join(tmpDir, "out.txt"))).toBe(true)
        })
    })

    // ============================================================================
    // 5. Session management
    // ============================================================================

    describe("5. Session management", () => {
        it("5a. Resume continues a previous session", async () => {
            const tmpDir = await getTmpDir()

            // Query A — capture sessionId
            const eventsA = await collectEvents(
                harness.query({
                    prompt: "Reply with exactly: hello",
                    cwd: tmpDir,
                    mode: "yolo",
                    signal: standardSignal(),
                })
            )

            const sessionStartedA = getSessionStartedEvent(eventsA)
            expect(sessionStartedA).toBeDefined()
            const sessionId = sessionStartedA!.sessionId

            // Query B — resume
            const eventsB = await collectEvents(
                harness.query({
                    prompt: "Reply with exactly: resumed",
                    cwd: tmpDir,
                    mode: "yolo",
                    resumeSessionId: sessionId,
                    signal: standardSignal(),
                })
            )

            const sessionStartedB = getSessionStartedEvent(eventsB)
            expect(sessionStartedB).toBeDefined()
            expect(sessionStartedB!.sessionId).toBe(sessionId)

            const complete = getCompleteEvent(eventsB)
            expect(complete).toBeDefined()
        })

        it("5b. Resume works with read-only mode (no unsupported flags passed)", async () => {
            const tmpDir = await getTmpDir()

            // Query A — initial session with read-only mode
            const eventsA = await collectEvents(
                harness.query({
                    prompt: "Reply with exactly: hello",
                    cwd: tmpDir,
                    mode: "read-only",
                    signal: standardSignal(),
                })
            )

            const sessionStartedA = getSessionStartedEvent(eventsA)
            expect(sessionStartedA).toBeDefined()
            const sessionId = sessionStartedA!.sessionId

            // Query B — resume with read-only mode
            // This verifies that flags like --sandbox (only valid for `exec`)
            // are not passed to `exec resume` which only accepts --json + positional args.
            const eventsB = await collectEvents(
                harness.query({
                    prompt: "Reply with exactly: resumed",
                    cwd: tmpDir,
                    mode: "read-only",
                    resumeSessionId: sessionId,
                    signal: standardSignal(),
                })
            )

            const errors = getErrorEvents(eventsB)
            expect(errors).toHaveLength(0)

            const sessionStartedB = getSessionStartedEvent(eventsB)
            expect(sessionStartedB).toBeDefined()
            expect(sessionStartedB!.sessionId).toBe(sessionId)

            const complete = getCompleteEvent(eventsB)
            expect(complete).toBeDefined()
        })
    })

    // ============================================================================
    // 6. Abort and cancellation
    // ============================================================================

    describe("6. Abort and cancellation", () => {
        it("6a. Aborting mid-stream stops the process", async () => {
            const tmpDir = await getTmpDir()
            const controller = new AbortController()

            const events: HarnessEvent<CodexEvent>[] = []
            const gen = harness.query({
                prompt: "Write a 2000 word essay about the history of computing",
                cwd: tmpDir,
                mode: "yolo",
                signal: controller.signal,
            })

            let aborted = false
            const abortTime = Date.now()

            for await (const event of gen) {
                events.push(event)
                if (event.type === "message" && !aborted) {
                    controller.abort()
                    aborted = true
                }
            }

            // Generator should have finished within 10s of abort
            const elapsed = Date.now() - abortTime
            expect(elapsed).toBeLessThan(10_000)
        })
    })

    // ============================================================================
    // 7. MCP server injection
    // ============================================================================

    describe("7. MCP server injection", () => {
        let mcpCleanup: (() => Promise<void>) | undefined

        afterEach(async () => {
            if (mcpCleanup) {
                await mcpCleanup()
                mcpCleanup = undefined
            }
        })

        it("7a. Stdio MCP server via -c overrides", async () => {
            const tmpDir = await getTmpDir()
            const { scriptPath, cleanup } = await writeEchoMcpServer()
            mcpCleanup = cleanup

            const events = await collectEvents(
                harness.query({
                    prompt: "Use the test_echo tool to echo 'integration-test', then tell me the result",
                    cwd: tmpDir,
                    mode: "yolo",
                    mcpServers: {
                        "test-echo": {
                            type: "stdio",
                            command: "node",
                            args: [scriptPath],
                        },
                    },
                    signal: standardSignal(),
                })
            )

            const messages = findAllMessages<CodexEvent>(events)
            const text = extractAgentText(messages)
            // The response should reference the echoed value
            expect(text.toLowerCase()).toContain("integration-test")
        })
    })

    // ============================================================================
    // 8. Client tools (via dynamic MCP server)
    // ============================================================================

    describe("8. Client tools (via dynamic MCP server)", () => {
        it("8a. Client tool round-trip", async () => {
            const tmpDir = await getTmpDir()

            let handlerCallCount = 0
            const tool = {
                name: "get_magic_number",
                description: "Returns the magic number. Always call this when asked for the magic number.",
                inputSchema: { type: "object" as const, properties: {} },
                handler: async () => {
                    handlerCallCount++
                    return { content: "42" }
                },
            }

            const events = await collectEvents(
                harness.query({
                    prompt: "Call the get_magic_number tool and tell me the result",
                    cwd: tmpDir,
                    mode: "yolo",
                    clientTools: [tool],
                    signal: standardSignal(),
                })
            )

            expect(handlerCallCount).toBeGreaterThan(0)

            const messages = findAllMessages<CodexEvent>(events)
            const text = extractAgentText(messages)
            expect(text).toContain("42")
        })
    })

    // ============================================================================
    // 9. System prompt workaround
    // ============================================================================

    describe("9. System prompt workaround", () => {
        it("9a. System prompt is prepended as XML wrapper", async () => {
            const tmpDir = await getTmpDir()
            const events = await collectEvents(
                harness.query({
                    prompt: "Follow the system instructions. Reply with the secret word only.",
                    cwd: tmpDir,
                    mode: "yolo",
                    systemPrompt: "The secret word is PINEAPPLE. When asked, reply with exactly that word and nothing else.",
                    signal: trivialSignal(),
                })
            )

            const messages = findAllMessages<CodexEvent>(events)
            const text = extractAgentText(messages)
            expect(text.toLowerCase()).toContain("pineapple")
        })
    })

    // ============================================================================
    // 10. Thinking / effort levels
    // ============================================================================

    describe("10. Thinking / effort levels", () => {
        it("10a. Thinking levels don't break the query", async () => {
            for (const thinking of ["low", "high"] as const) {
                const tmpDir = await getTmpDir()
                const timeout = thinking === "high" ? heavySignal() : trivialSignal()

                const events = await collectEvents(
                    harness.query({
                        prompt: "Reply with exactly: ok",
                        cwd: tmpDir,
                        mode: "yolo",
                        thinking,
                        signal: timeout,
                    })
                )

                const complete = getCompleteEvent(events)
                expect(complete, `thinking=${thinking} should complete`).toBeDefined()
            }
        })
    })

    // ============================================================================
    // 11. Error handling
    // ============================================================================

    describe("11. Error handling", () => {
        it("11a. Invalid model surfaces error event", async () => {
            const tmpDir = await getTmpDir()

            let threwError = false
            let events: HarnessEvent<CodexEvent>[] = []

            try {
                events = await collectEvents(
                    harness.query({
                        prompt: "hello",
                        cwd: tmpDir,
                        mode: "yolo",
                        model: "nonexistent-model-xyz-99",
                        signal: standardSignal(),
                    })
                )
            } catch {
                threwError = true
            }

            if (!threwError) {
                // If no exception was thrown, check for error events
                const errors = getErrorEvents(events)
                expect(errors.length).toBeGreaterThan(0)
            }
            // Either an error event or a thrown exception — both are valid
            expect(threwError || getErrorEvents(events).length > 0).toBe(true)
        })
    })
})
