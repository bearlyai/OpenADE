import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseCodexSessionLine, readCodexSession, writeCodexSession, deleteCodexSession, isCodexSessionActive, listCodexSessions } from "./sessions.js"
import type { HarnessEvent } from "../../types.js"
import type { CodexEvent, CodexItemCompletedEvent, CodexThreadStartedEvent, CodexTurnStartedEvent, CodexTurnCompletedEvent } from "./types.js"

// ── Fixtures ──

const SESSION_META_LINE = {
    timestamp: "2026-04-03T18:25:48.000Z",
    type: "session_meta",
    payload: {
        id: "019d5573-d6f9-73b3-9e3d-06a4af1fd60d",
        cwd: "/Users/test/project",
        originator: "codex_exec",
        cli_version: "0.111.0",
        model_provider: "openai",
    },
}

const ASSISTANT_MESSAGE_LINE = {
    timestamp: "2026-04-03T18:25:50.000Z",
    type: "response_item",
    payload: {
        id: "item-001",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Hello from Codex" }],
    },
}

const FUNCTION_CALL_LINE = {
    timestamp: "2026-04-03T18:25:51.000Z",
    type: "response_item",
    payload: {
        id: "item-002",
        type: "function_call",
        name: "shell",
        arguments: '{"command": "ls -la"}',
        call_id: "call-001",
    },
}

const REASONING_LINE = {
    timestamp: "2026-04-03T18:25:52.000Z",
    type: "response_item",
    payload: {
        id: "item-003",
        type: "reasoning",
        summary: [{ type: "summary_text", text: "Thinking about the problem..." }],
    },
}

const FUNCTION_CALL_OUTPUT_LINE = {
    timestamp: "2026-04-03T18:25:53.000Z",
    type: "response_item",
    payload: {
        type: "function_call_output",
        call_id: "call-001",
        output: '{"stdout": "file.txt", "exit_code": 0}',
    },
}

const USER_MESSAGE_LINE = {
    timestamp: "2026-04-03T18:25:49.000Z",
    type: "response_item",
    payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello" }],
    },
}

const EVENT_MSG_LINE = {
    timestamp: "2026-04-03T18:25:54.000Z",
    type: "event_msg",
    payload: { type: "token_count", total_token_usage: 500 },
}

// ── Tests ──

describe("parseCodexSessionLine", () => {
    it("parses assistant message", () => {
        const event = parseCodexSessionLine(ASSISTANT_MESSAGE_LINE)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("message")
        if (event!.type === "message") {
            const msg = event!.message as CodexItemCompletedEvent
            expect(msg.type).toBe("item.completed")
            expect(msg.item.type).toBe("agent_message")
            if (msg.item.type === "agent_message") {
                expect(msg.item.text).toBe("Hello from Codex")
            }
        }
    })

    it("parses function_call as command_execution with command from arguments", () => {
        const event = parseCodexSessionLine(FUNCTION_CALL_LINE)
        expect(event).not.toBeNull()
        if (event!.type === "message") {
            const msg = event!.message as CodexItemCompletedEvent
            expect(msg.item.type).toBe("command_execution")
            if (msg.item.type === "command_execution") {
                expect(msg.item.command).toBe("ls -la") // extracted from arguments.command
                expect(msg.item.status).toBe("completed")
                expect(msg.item.aggregated_output).toBe("")
                expect(msg.item.exit_code).toBeNull()
            }
        }
    })

    it("correlates function_call with function_call_output", () => {
        const callOutputs = new Map([["call-001", { output: "file.txt", exitCode: 0 }]])
        const event = parseCodexSessionLine(FUNCTION_CALL_LINE, callOutputs)
        expect(event).not.toBeNull()
        if (event!.type === "message") {
            const msg = event!.message as CodexItemCompletedEvent
            if (msg.item.type === "command_execution") {
                expect(msg.item.command).toBe("ls -la")
                expect(msg.item.aggregated_output).toBe("file.txt")
                expect(msg.item.exit_code).toBe(0)
            }
        }
    })

    it("falls back to function name when arguments is not parseable", () => {
        const line = {
            ...FUNCTION_CALL_LINE,
            payload: { ...FUNCTION_CALL_LINE.payload, arguments: "not json" },
        }
        const event = parseCodexSessionLine(line)
        expect(event).not.toBeNull()
        if (event!.type === "message") {
            const msg = event!.message as CodexItemCompletedEvent
            if (msg.item.type === "command_execution") {
                expect(msg.item.command).toBe("shell")
            }
        }
    })

    it("parses reasoning item", () => {
        const event = parseCodexSessionLine(REASONING_LINE)
        expect(event).not.toBeNull()
        if (event!.type === "message") {
            const msg = event!.message as CodexItemCompletedEvent
            expect(msg.item.type).toBe("reasoning")
            if (msg.item.type === "reasoning") {
                expect(msg.item.text).toBe("Thinking about the problem...")
            }
        }
    })

    it("skips function_call_output", () => {
        expect(parseCodexSessionLine(FUNCTION_CALL_OUTPUT_LINE)).toBeNull()
    })

    it("skips user messages", () => {
        expect(parseCodexSessionLine(USER_MESSAGE_LINE)).toBeNull()
    })

    it("parses session_meta as thread.started", () => {
        const event = parseCodexSessionLine(SESSION_META_LINE)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("message")
        if (event!.type === "message") {
            const msg = event!.message as CodexThreadStartedEvent
            expect(msg.type).toBe("thread.started")
            expect(msg.thread_id).toBe("019d5573-d6f9-73b3-9e3d-06a4af1fd60d")
            expect(msg.session_id).toBe("019d5573-d6f9-73b3-9e3d-06a4af1fd60d")
            expect(msg.cwd).toBe("/Users/test/project")
        }
    })

    it("parses event_msg turn_started as turn.started", () => {
        const line = {
            timestamp: "2026-04-03T18:25:54.000Z",
            type: "event_msg",
            payload: { type: "turn_started", turn_id: "turn-001" },
        }
        const event = parseCodexSessionLine(line)
        expect(event).not.toBeNull()
        if (event!.type === "message") {
            expect((event!.message as CodexTurnStartedEvent).type).toBe("turn.started")
        }
    })

    it("parses event_msg turn_complete as turn.completed", () => {
        const line = {
            timestamp: "2026-04-03T18:25:54.000Z",
            type: "event_msg",
            payload: { type: "turn_complete", turn_id: "turn-001" },
        }
        const event = parseCodexSessionLine(line)
        expect(event).not.toBeNull()
        if (event!.type === "message") {
            const msg = event!.message as CodexTurnCompletedEvent
            expect(msg.type).toBe("turn.completed")
            expect(msg.usage).toEqual({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 })
        }
    })

    it("skips event_msg token_count", () => {
        expect(parseCodexSessionLine(EVENT_MSG_LINE)).toBeNull()
    })

    it("skips lines without payload type", () => {
        expect(
            parseCodexSessionLine({
                timestamp: "2026-01-01T00:00:00Z",
                type: "response_item",
                payload: {},
            })
        ).toBeNull()
    })
})

describe("session file operations", () => {
    let tmpDir: string
    const sessionId = "019d5573-d6f9-73b3-9e3d-06a4af1fd60d"

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "harness-codex-test-"))
        process.env.CODEX_HOME = tmpDir
    })

    afterEach(async () => {
        delete process.env.CODEX_HOME
        await rm(tmpDir, { recursive: true, force: true })
    })

    async function createSessionFile(lines: unknown[]) {
        const sessionsDir = join(tmpDir, "sessions", "2026", "04", "03")
        await mkdir(sessionsDir, { recursive: true })
        const filePath = join(sessionsDir, `rollout-2026-04-03T18-25-48-${sessionId}.jsonl`)
        const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n"
        await writeFile(filePath, content)
        return filePath
    }

    describe("readCodexSession", () => {
        it("returns events for a valid session", async () => {
            await createSessionFile([SESSION_META_LINE, ASSISTANT_MESSAGE_LINE, FUNCTION_CALL_LINE, REASONING_LINE])

            const events = await readCodexSession(sessionId)
            expect(events).not.toBeNull()
            // session_started + thread.started + 3 items
            expect(events!.length).toBe(5)
            expect(events![0]).toEqual({ type: "session_started", sessionId })
            // thread.started from session_meta
            if (events![1].type === "message") {
                expect((events![1].message as CodexThreadStartedEvent).type).toBe("thread.started")
            }
        })

        it("skips non-emittable lines but keeps session_meta", async () => {
            await createSessionFile([SESSION_META_LINE, EVENT_MSG_LINE, FUNCTION_CALL_OUTPUT_LINE, ASSISTANT_MESSAGE_LINE])

            const events = await readCodexSession(sessionId)
            expect(events).not.toBeNull()
            // session_started + thread.started (from session_meta) + 1 assistant
            // EVENT_MSG (token_count) → skipped, FUNCTION_CALL_OUTPUT → consumed in pass 1
            expect(events!.length).toBe(3)
        })

        it("correlates function_call with function_call_output", async () => {
            await createSessionFile([SESSION_META_LINE, FUNCTION_CALL_LINE, FUNCTION_CALL_OUTPUT_LINE])

            const events = await readCodexSession(sessionId)
            expect(events).not.toBeNull()
            // session_started + thread.started + function_call (correlated)
            expect(events!.length).toBe(3)

            const fnEvent = events![2]
            if (fnEvent.type === "message") {
                const msg = fnEvent.message as CodexItemCompletedEvent
                if (msg.item.type === "command_execution") {
                    expect(msg.item.command).toBe("ls -la")
                    expect(msg.item.aggregated_output).toBe("file.txt")
                    expect(msg.item.exit_code).toBe(0)
                }
            }
        })

        it("returns null for missing session", async () => {
            const events = await readCodexSession("nonexistent-session")
            expect(events).toBeNull()
        })

        it("handles corrupted lines gracefully", async () => {
            const sessionsDir = join(tmpDir, "sessions", "2026", "04", "03")
            await mkdir(sessionsDir, { recursive: true })
            const filePath = join(sessionsDir, `rollout-2026-04-03T18-25-48-${sessionId}.jsonl`)
            await writeFile(filePath, JSON.stringify(ASSISTANT_MESSAGE_LINE) + "\nnot valid json\n" + JSON.stringify(REASONING_LINE) + "\n")

            const events = await readCodexSession(sessionId)
            expect(events).not.toBeNull()
            expect(events!.length).toBe(3) // session_started + 2 valid messages
        })
    })

    describe("writeCodexSession", () => {
        it("wraps events in turn lifecycle", async () => {
            const filePath = await createSessionFile([SESSION_META_LINE])

            const newEvents: HarnessEvent<CodexEvent>[] = [
                {
                    type: "message",
                    message: {
                        type: "item.completed",
                        item: {
                            id: "new-001",
                            type: "agent_message",
                            text: "Injected message",
                        },
                    },
                },
            ]

            await writeCodexSession(sessionId, newEvents, { cwd: "/test" })

            const content = await readFile(filePath, "utf-8")
            const lines = content
                .trim()
                .split("\n")
                .map((l) => JSON.parse(l))

            // Original session_meta + turn_started + message + turn_complete
            expect(lines.length).toBe(4)
            expect(lines[1].type).toBe("event_msg")
            expect(lines[1].payload.type).toBe("turn_started")
            expect(lines[2].type).toBe("response_item")
            expect(lines[2].payload.type).toBe("message")
            expect(lines[2].payload.role).toBe("assistant")
            expect(lines[3].type).toBe("event_msg")
            expect(lines[3].payload.type).toBe("turn_complete")

            // Turn IDs should match
            expect(lines[1].payload.turn_id).toBe(lines[3].payload.turn_id)
        })

        it("does not write when only non-message events provided", async () => {
            const filePath = await createSessionFile([SESSION_META_LINE])

            const newEvents: HarnessEvent<CodexEvent>[] = [{ type: "session_started", sessionId: "ignored" }, { type: "complete" }]

            await writeCodexSession(sessionId, newEvents, { cwd: "/test" })

            const content = await readFile(filePath, "utf-8")
            const lines = content.trim().split("\n")
            expect(lines.length).toBe(1) // unchanged
        })

        it("throws for missing session", async () => {
            await expect(writeCodexSession("nonexistent", [], { cwd: "/test" })).rejects.toThrow("not found")
        })
    })

    describe("deleteCodexSession", () => {
        it("deletes session file", async () => {
            const filePath = await createSessionFile([SESSION_META_LINE])

            const result = await deleteCodexSession(sessionId)
            expect(result).toBe(true)
            await expect(stat(filePath)).rejects.toThrow()
        })

        it("deletes archived session file", async () => {
            const archivedDir = join(tmpDir, "archived_sessions")
            await mkdir(archivedDir, { recursive: true })
            const archivedPath = join(archivedDir, `${sessionId}.jsonl`)
            await writeFile(archivedPath, JSON.stringify(SESSION_META_LINE) + "\n")

            const result = await deleteCodexSession(sessionId)
            expect(result).toBe(true)
            await expect(stat(archivedPath)).rejects.toThrow()
        })

        it("returns false for nonexistent session", async () => {
            const result = await deleteCodexSession("nonexistent-id-0000-0000-000000000000")
            expect(result).toBe(false)
        })
    })

    describe("isCodexSessionActive", () => {
        it("always returns false (no PID tracking)", async () => {
            expect(await isCodexSessionActive(sessionId)).toBe(false)
        })
    })

    describe("listCodexSessions", () => {
        it("lists sessions from directory structure", async () => {
            await createSessionFile([SESSION_META_LINE, ASSISTANT_MESSAGE_LINE])

            const sessions = await listCodexSessions()
            expect(sessions.length).toBe(1)
            expect(sessions[0].sessionId).toBe(sessionId)
            expect(sessions[0].harnessId).toBe("codex")
            expect(sessions[0].startedAt).toBeDefined()
        })

        it("lists multiple sessions sorted by date descending", async () => {
            // Create two sessions
            await createSessionFile([SESSION_META_LINE])

            const otherId = "019d5574-aaaa-bbbb-cccc-dddddddddddd"
            const otherDir = join(tmpDir, "sessions", "2026", "04", "04")
            await mkdir(otherDir, { recursive: true })
            await writeFile(join(otherDir, `rollout-2026-04-04T10-00-00-${otherId}.jsonl`), JSON.stringify(SESSION_META_LINE) + "\n")

            const sessions = await listCodexSessions()
            expect(sessions.length).toBe(2)
            // Newer session first
            expect(sessions[0].sessionId).toBe(otherId)
            expect(sessions[1].sessionId).toBe(sessionId)
        })

        it("respects limit", async () => {
            await createSessionFile([SESSION_META_LINE])

            const otherId = "019d5574-aaaa-bbbb-cccc-dddddddddddd"
            const otherDir = join(tmpDir, "sessions", "2026", "04", "04")
            await mkdir(otherDir, { recursive: true })
            await writeFile(join(otherDir, `rollout-2026-04-04T10-00-00-${otherId}.jsonl`), JSON.stringify(SESSION_META_LINE) + "\n")

            const sessions = await listCodexSessions({ limit: 1 })
            expect(sessions.length).toBe(1)
        })

        it("filters by cwd", async () => {
            await createSessionFile([SESSION_META_LINE]) // cwd: /Users/test/project

            const sessions = await listCodexSessions({ cwd: "/Users/test/project" })
            expect(sessions.length).toBe(1)

            const noMatch = await listCodexSessions({ cwd: "/other/project" })
            expect(noMatch.length).toBe(0)
        })

        it("returns empty for nonexistent directory", async () => {
            delete process.env.CODEX_HOME
            process.env.CODEX_HOME = "/nonexistent/path"
            const sessions = await listCodexSessions()
            expect(sessions).toEqual([])
        })
    })

    describe("round-trip read → write → read", () => {
        it("preserves message content through round trip", async () => {
            await createSessionFile([SESSION_META_LINE, ASSISTANT_MESSAGE_LINE, REASONING_LINE])

            // Read
            const events = await readCodexSession(sessionId)
            expect(events).not.toBeNull()

            // Write back message events
            const messageEvents = events!.filter((e) => e.type === "message")
            await writeCodexSession(sessionId, messageEvents, { cwd: "/test" })

            // Read again
            const events2 = await readCodexSession(sessionId)
            expect(events2).not.toBeNull()

            // Should have more events now (original + written back)
            const msgs = events2!.filter((e) => e.type === "message")
            expect(msgs.length).toBeGreaterThan(messageEvents.length)
        })
    })
})
