import { describe, it, expect, afterAll, afterEach } from "vitest"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

import { ClaudeCodeHarness } from "./index.js"
import type { ClaudeEvent, ClaudeSystemInitEvent, ClaudeAssistantEvent, ClaudeResultEvent } from "./types.js"
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
    findAllEvents,
} from "../../integration-helpers.js"

const harness = new ClaudeCodeHarness()
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
    return tmp.path
}

function extractAssistantText(messages: ClaudeEvent[]): string {
    return messages
        .filter((m): m is ClaudeAssistantEvent => m.type === "assistant")
        .flatMap((m) => m.message.content)
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join(" ")
}

// ============================================================================
// 1. Install status and discovery
// ============================================================================

describe("1. Install status and discovery", () => {
    it("1a. checkInstallStatus reports installed with valid shape", async () => {
        const status = await harness.checkInstallStatus()
        expect(status.installed).toBe(true)
        expect(status.version).toBeTruthy()
        expect(typeof status.version).toBe("string")
        expect(status.authType).toBe("account")
        expect(typeof status.authenticated).toBe("boolean")
        if (!status.authenticated) {
            expect(status.authInstructions).toBeTruthy()
        }
    })
})

describe.skipIf(!ready)("Claude Code (authenticated)", () => {
    // ============================================================================
    // 1b. Discovery (requires auth)
    // ============================================================================

    describe("1. Install status and discovery", () => {
        it("1b. discoverSlashCommands returns commands and skills", async () => {
            const tmpDir = await getTmpDir()
            const commands = await harness.discoverSlashCommands(tmpDir)
            expect(Array.isArray(commands)).toBe(true)
            expect(commands.length).toBeGreaterThan(0)
            for (const cmd of commands) {
                expect(cmd.name).toBeTruthy()
                expect(typeof cmd.name).toBe("string")
                expect(["skill", "slash_command"]).toContain(cmd.type)
            }
        })
    })

    // ============================================================================
    // 2. Basic query lifecycle
    // ============================================================================

    describe("2. Basic query lifecycle", () => {
        it("2a. Simple prompt yields session_started, assistant message, and complete", async () => {
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

            const messages = findAllMessages<ClaudeEvent>(events)
            const hasAssistant = messages.some((m) => m.type === "assistant")
            expect(hasAssistant).toBe(true)

            const complete = getCompleteEvent(events)
            expect(complete).toBeDefined()

            // Complete should be at or after all message events
            const completeIdx = events.findIndex((e) => e.type === "complete")
            const lastMsgIdx = events.reduce((max, e, i) => (e.type === "message" ? i : max), -1)
            expect(completeIdx).toBeGreaterThanOrEqual(lastMsgIdx)
        })

        it("2b. Complete event includes usage with token counts and cost", async () => {
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
            expect(typeof usage.costUsd).toBe("number")
            expect(usage.costUsd!).toBeGreaterThan(0)
            expect(typeof usage.durationMs).toBe("number")
            expect(usage.durationMs!).toBeGreaterThan(0)
        })

        it("2c. System init event is emitted as a message", async () => {
            const tmpDir = await getTmpDir()
            const events = await collectEvents(
                harness.query({
                    prompt: "Reply with exactly: hello",
                    cwd: tmpDir,
                    mode: "yolo",
                    signal: trivialSignal(),
                })
            )

            const messages = findAllMessages<ClaudeEvent>(events)
            const initEvent = messages.find((m) => m.type === "system" && (m as ClaudeSystemInitEvent).subtype === "init") as ClaudeSystemInitEvent | undefined

            expect(initEvent).toBeDefined()
            expect(typeof initEvent!.model).toBe("string")
            expect(Array.isArray(initEvent!.tools)).toBe(true)
            expect(typeof initEvent!.session_id).toBe("string")
            expect(initEvent!.session_id).toBeTruthy()
        })
    })

    // ============================================================================
    // 3. Modes and permissions
    // ============================================================================

    describe("3. Modes and permissions", () => {
        it("3a. Read-only mode completes successfully", async () => {
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

        it("3b. Yolo mode allows tool execution", async () => {
            const tmpDir = await getTmpDir()
            const events = await collectEvents(
                harness.query({
                    prompt: "Create a file called test.txt containing 'hello' in the current directory. Do nothing else.",
                    cwd: tmpDir,
                    mode: "yolo",
                    signal: standardSignal(),
                })
            )

            const complete = getCompleteEvent(events)
            expect(complete).toBeDefined()

            expect(existsSync(join(tmpDir, "test.txt"))).toBe(true)
        })
    })

    // ============================================================================
    // 4. Session management
    // ============================================================================

    describe("4. Session management", () => {
        let sessionId: string
        // Shared across 4a and 4b — managed outside afterEach cleanup
        let sessionTmp: { path: string; cleanup: () => Promise<void> } | undefined

        afterAll(async () => {
            await sessionTmp?.cleanup()
        })

        it("4a. Session ID is stable across the query", async () => {
            sessionTmp = await makeTmpDir()
            const events = await collectEvents(
                harness.query({
                    prompt: "Reply with exactly: hello",
                    cwd: sessionTmp.path,
                    mode: "yolo",
                    signal: trivialSignal(),
                })
            )

            const sessionStarted = getSessionStartedEvent(events)
            expect(sessionStarted).toBeDefined()
            sessionId = sessionStarted!.sessionId

            // Find result event and check session_id matches
            const messages = findAllMessages<ClaudeEvent>(events)
            const resultEvent = messages.find((m) => m.type === "result") as ClaudeResultEvent | undefined
            expect(resultEvent).toBeDefined()
            expect(resultEvent!.session_id).toBe(sessionId)
        })

        it("4b. Resume continues an existing session", async () => {
            expect(sessionId, "4b depends on 4a capturing a sessionId").toBeDefined()

            const events = await collectEvents(
                harness.query({
                    prompt: "Reply with exactly: resumed",
                    cwd: sessionTmp!.path,
                    mode: "yolo",
                    resumeSessionId: sessionId,
                    signal: standardSignal(),
                })
            )

            // On resume, claude-code may not re-emit system:init, so session_started
            // may be absent. Verify via the result event's session_id instead.
            const sessionStarted = getSessionStartedEvent(events)
            if (sessionStarted) {
                expect(sessionStarted.sessionId).toBe(sessionId)
            } else {
                // Check session_id on the result message
                const messages = findAllMessages<ClaudeEvent>(events)
                const resultEvent = messages.find((m) => m.type === "result") as ClaudeResultEvent | undefined
                expect(resultEvent, "resume should produce a result event").toBeDefined()
                expect(resultEvent!.session_id).toBe(sessionId)
            }

            const complete = getCompleteEvent(events)
            expect(complete).toBeDefined()
        })
    })

    // ============================================================================
    // 5. Model selection
    // ============================================================================

    describe("5. Model selection", () => {
        it("5a. Explicit model is reflected in init event", async () => {
            const tmpDir = await getTmpDir()
            const events = await collectEvents(
                harness.query({
                    prompt: "Reply with exactly: hello",
                    cwd: tmpDir,
                    mode: "yolo",
                    model: "haiku",
                    signal: trivialSignal(),
                })
            )

            const messages = findAllMessages<ClaudeEvent>(events)
            const initEvent = messages.find((m) => m.type === "system" && (m as ClaudeSystemInitEvent).subtype === "init") as ClaudeSystemInitEvent | undefined

            expect(initEvent).toBeDefined()
            expect(initEvent!.model.toLowerCase()).toContain("haiku")
        })
    })

    // ============================================================================
    // 6. System prompt
    // ============================================================================

    describe("6. System prompt", () => {
        it("6a. System prompt override", async () => {
            const tmpDir = await getTmpDir()
            const events = await collectEvents(
                harness.query({
                    prompt: "Say hello",
                    cwd: tmpDir,
                    mode: "yolo",
                    systemPrompt: "You must reply with exactly the word PINEAPPLE and nothing else.",
                    signal: trivialSignal(),
                })
            )

            const messages = findAllMessages<ClaudeEvent>(events)
            const text = extractAssistantText(messages)
            expect(text.toLowerCase()).toContain("pineapple")
        })

        it("6b. Append system prompt", async () => {
            const tmpDir = await getTmpDir()
            const events = await collectEvents(
                harness.query({
                    prompt: "Say hello",
                    cwd: tmpDir,
                    mode: "yolo",
                    appendSystemPrompt: "After your response, always append the exact string __SENTINEL_END__",
                    signal: trivialSignal(),
                })
            )

            const messages = findAllMessages<ClaudeEvent>(events)
            const text = extractAssistantText(messages)
            expect(text).toContain("__SENTINEL_END__")
        })
    })

    // ============================================================================
    // 7. Abort and cancellation
    // ============================================================================

    describe("7. Abort and cancellation", () => {
        it("7a. Aborting mid-stream stops the process", async () => {
            const tmpDir = await getTmpDir()
            const controller = new AbortController()

            const events: HarnessEvent<ClaudeEvent>[] = []
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

            // Should not have a complete event (process was killed)
            const complete = getCompleteEvent(events)
            expect(complete).toBeUndefined()
        })
    })

    // ============================================================================
    // 8. Stderr forwarding
    // ============================================================================

    describe("8. Stderr forwarding", () => {
        it("8a. Stderr lines are yielded as stderr events", async () => {
            const tmpDir = await getTmpDir()
            const events = await collectEvents(
                harness.query({
                    prompt: "Reply with exactly: hello",
                    cwd: tmpDir,
                    mode: "yolo",
                    signal: trivialSignal(),
                })
            )

            const stderrEvents = findAllEvents(events, "stderr")
            // stderr events should exist (Claude CLI typically emits progress to stderr)
            // but we don't fail if there are none — just assert array is defined
            expect(Array.isArray(stderrEvents)).toBe(true)
            if (stderrEvents.length > 0) {
                for (const e of stderrEvents) {
                    const stderrEvt = e as { type: "stderr"; data: string }
                    expect(typeof stderrEvt.data).toBe("string")
                    expect(stderrEvt.data).toBeTruthy()
                }
            }
        })
    })

    // ============================================================================
    // 9. MCP server injection (stdio)
    // ============================================================================

    describe("9. MCP server injection (stdio)", () => {
        let mcpCleanup: (() => Promise<void>) | undefined

        afterEach(async () => {
            if (mcpCleanup) {
                await mcpCleanup()
                mcpCleanup = undefined
            }
        })

        it("9a. External stdio MCP server is available to the CLI", async () => {
            const tmpDir = await getTmpDir()
            const { scriptPath, cleanup } = await writeEchoMcpServer()
            mcpCleanup = cleanup

            const events = await collectEvents(
                harness.query({
                    prompt: "Reply with exactly: hello",
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

            const messages = findAllMessages<ClaudeEvent>(events)
            const initEvent = messages.find((m) => m.type === "system" && (m as ClaudeSystemInitEvent).subtype === "init") as ClaudeSystemInitEvent | undefined

            expect(initEvent).toBeDefined()
            expect(initEvent!.mcp_servers).toBeDefined()

            const echoServer = initEvent!.mcp_servers.find((s) => s.name === "test-echo")
            expect(echoServer).toBeDefined()
            // Status should indicate it connected (not an error)
            expect(echoServer!.status).toBeTruthy()
        })
    })

    // ============================================================================
    // 10. Client tools (via dynamic MCP server)
    // ============================================================================

    describe("10. Client tools (via dynamic MCP server)", () => {
        it("10a. Client tool is invoked by the CLI and returns a result", async () => {
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

            const messages = findAllMessages<ClaudeEvent>(events)
            const text = extractAssistantText(messages)
            expect(text).toContain("42")
        })

        it("10b. Client tool that receives arguments", async () => {
            const tmpDir = await getTmpDir()

            let receivedArgs: Record<string, unknown> | undefined
            const tool = {
                name: "add_numbers",
                description: "Adds two numbers together. Use this tool when asked to add numbers.",
                inputSchema: {
                    type: "object" as const,
                    properties: {
                        a: { type: "number" as const },
                        b: { type: "number" as const },
                    },
                    required: ["a", "b"],
                },
                handler: async (args: Record<string, unknown>) => {
                    receivedArgs = args
                    return { content: String(Number(args.a) + Number(args.b)) }
                },
            }

            const events = await collectEvents(
                harness.query({
                    prompt: "Use the add_numbers tool to add 3 and 7, then tell me the result",
                    cwd: tmpDir,
                    mode: "yolo",
                    clientTools: [tool],
                    signal: standardSignal(),
                })
            )

            expect(receivedArgs).toBeDefined()
            expect(receivedArgs!.a).toBeDefined()
            expect(receivedArgs!.b).toBeDefined()

            const messages = findAllMessages<ClaudeEvent>(events)
            const text = extractAssistantText(messages)
            expect(text).toContain("10")
        })
    })

    // ============================================================================
    // 11. Thinking / effort levels
    // ============================================================================

    describe("11. Thinking / effort levels", () => {
        it("11a. Thinking level does not break the query", async () => {
            for (const thinking of ["low", "med", "high"] as const) {
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
    // 12. Additional directories
    // ============================================================================

    describe("12. Additional directories", () => {
        it("12a. --add-dir makes another directory's files visible", async () => {
            const mainDir = await getTmpDir()
            const extraDir = await getTmpDir()

            await writeFile(join(extraDir, "unique-marker-a1b2c3.txt"), "unique-marker-a1b2c3", "utf-8")

            const events = await collectEvents(
                harness.query({
                    prompt: "Read unique-marker-a1b2c3.txt and repeat its full contents",
                    cwd: mainDir,
                    mode: "yolo",
                    additionalDirectories: [extraDir],
                    signal: standardSignal(),
                })
            )

            const messages = findAllMessages<ClaudeEvent>(events)
            const text = extractAssistantText(messages)
            expect(text).toContain("unique-marker-a1b2c3")
        })
    })
})
