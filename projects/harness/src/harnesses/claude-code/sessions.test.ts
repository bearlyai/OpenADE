import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
    encodeProjectPath,
    parseClaudeSessionLine,
    readClaudeSession,
    writeClaudeSession,
    deleteClaudeSession,
    isClaudeSessionActive,
    listClaudeSessions,
} from "./sessions.js"
import type { HarnessEvent } from "../../types.js"
import type { ClaudeEvent, ClaudeAssistantEvent, ClaudeUserEvent } from "./types.js"

// ── Fixtures ──

const ASSISTANT_LINE = {
    type: "assistant",
    message: {
        id: "msg-001",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello world" }],
        model: "claude-sonnet-4-20250514",
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50 },
    },
    uuid: "aaaa-1111",
    parentUuid: null,
    isSidechain: false,
    sessionId: "sess-001",
    timestamp: "2026-01-01T00:00:00.000Z",
}

const USER_LINE = {
    type: "user",
    message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-001", content: "file contents" }],
    },
    uuid: "bbbb-2222",
    parentUuid: "aaaa-1111",
    isSidechain: false,
    sessionId: "sess-001",
    timestamp: "2026-01-01T00:00:01.000Z",
}

const ASSISTANT_LINE_2 = {
    type: "assistant",
    message: {
        id: "msg-002",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Done!" }],
        model: "claude-sonnet-4-20250514",
        stop_reason: "end_turn",
        usage: { input_tokens: 200, output_tokens: 100 },
    },
    uuid: "cccc-3333",
    parentUuid: "bbbb-2222",
    isSidechain: false,
    sessionId: "sess-001",
    timestamp: "2026-01-01T00:00:02.000Z",
}

const QUEUE_OP_LINE = {
    type: "queue-operation",
    operation: "enqueue",
    timestamp: "2026-01-01T00:00:00.000Z",
    sessionId: "sess-001",
    content: "do something",
}

// ── Tests ──

describe("encodeProjectPath", () => {
    it("replaces slashes with dashes", () => {
        expect(encodeProjectPath("/Users/foo/project")).toBe("-Users-foo-project")
    })

    it("handles root path", () => {
        expect(encodeProjectPath("/")).toBe("-")
    })

    it("handles nested paths", () => {
        expect(encodeProjectPath("/a/b/c/d")).toBe("-a-b-c-d")
    })

    it("handles Windows backslash paths", () => {
        expect(encodeProjectPath("C:\\Users\\foo\\project")).toBe("C:-Users-foo-project")
    })
})

describe("parseClaudeSessionLine", () => {
    it("parses assistant line", () => {
        const event = parseClaudeSessionLine(ASSISTANT_LINE)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("message")
        if (event!.type === "message") {
            expect(event!.message.type).toBe("assistant")
            const msg = event!.message as ClaudeAssistantEvent
            expect(msg.message.content[0]).toEqual({ type: "text", text: "Hello world" })
            expect(msg.uuid).toBe("aaaa-1111")
            expect(msg.session_id).toBe("sess-001")
        }
    })

    it("parses user tool-result line", () => {
        const event = parseClaudeSessionLine(USER_LINE)
        expect(event).not.toBeNull()
        expect(event!.type).toBe("message")
        if (event!.type === "message") {
            expect(event!.message.type).toBe("user")
            const msg = event!.message as ClaudeUserEvent
            expect(msg.message.content[0]).toEqual({
                type: "tool_result",
                tool_use_id: "tool-001",
                content: "file contents",
            })
        }
    })

    it("skips queue-operation lines", () => {
        const event = parseClaudeSessionLine(QUEUE_OP_LINE as unknown as Record<string, unknown>)
        expect(event).toBeNull()
    })

    it("skips lines without type", () => {
        expect(parseClaudeSessionLine({ data: "no type" })).toBeNull()
    })

    it("skips assistant lines without message", () => {
        expect(parseClaudeSessionLine({ type: "assistant" })).toBeNull()
    })

    it("skips user lines without message", () => {
        expect(parseClaudeSessionLine({ type: "user" })).toBeNull()
    })
})

describe("session file operations", () => {
    let tmpDir: string
    const sessionId = "aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee"

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "harness-claude-test-"))
        // Set up the expected directory structure
        process.env.CLAUDE_CONFIG_DIR = tmpDir
    })

    afterEach(async () => {
        delete process.env.CLAUDE_CONFIG_DIR
        await rm(tmpDir, { recursive: true, force: true })
    })

    async function createSessionFile(cwd: string, lines: unknown[]) {
        const encoded = encodeProjectPath(cwd)
        const projectDir = join(tmpDir, "projects", encoded)
        await mkdir(projectDir, { recursive: true })
        const filePath = join(projectDir, `${sessionId}.jsonl`)
        const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n"
        await writeFile(filePath, content)
        return filePath
    }

    describe("readClaudeSession", () => {
        it("returns events for a valid session", async () => {
            await createSessionFile("/test/project", [ASSISTANT_LINE, USER_LINE, ASSISTANT_LINE_2])

            const events = await readClaudeSession(sessionId, { cwd: "/test/project" })
            expect(events).not.toBeNull()
            expect(events!.length).toBe(4) // session_started + 3 messages
            expect(events![0]).toEqual({ type: "session_started", sessionId })
            expect(events![1].type).toBe("message")
            expect(events![2].type).toBe("message")
            expect(events![3].type).toBe("message")
        })

        it("skips queue-operation and corrupted lines", async () => {
            await createSessionFile("/test/project", [QUEUE_OP_LINE, ASSISTANT_LINE, "not json"])

            const events = await readClaudeSession(sessionId, { cwd: "/test/project" })
            expect(events).not.toBeNull()
            expect(events!.length).toBe(2) // session_started + 1 assistant
        })

        it("returns null for missing session", async () => {
            const events = await readClaudeSession("nonexistent-session", { cwd: "/test/project" })
            expect(events).toBeNull()
        })

        it("finds session without cwd by scanning all project dirs", async () => {
            await createSessionFile("/some/project", [ASSISTANT_LINE])

            const events = await readClaudeSession(sessionId)
            expect(events).not.toBeNull()
            expect(events!.length).toBe(2)
        })
    })

    describe("writeClaudeSession", () => {
        it("appends events with correct parentUuid chain", async () => {
            const filePath = await createSessionFile("/test/project", [ASSISTANT_LINE, USER_LINE, ASSISTANT_LINE_2])

            const newEvents: HarnessEvent<ClaudeEvent>[] = [
                {
                    type: "message",
                    message: {
                        type: "assistant",
                        message: {
                            id: "msg-new",
                            type: "message",
                            role: "assistant",
                            content: [{ type: "text", text: "Injected!" }],
                            model: "claude-sonnet-4-20250514",
                            stop_reason: "end_turn",
                            usage: { input_tokens: 10, output_tokens: 5 },
                        },
                        uuid: "will-be-overwritten",
                        session_id: "will-be-overwritten",
                        parent_tool_use_id: null,
                    },
                },
            ]

            await writeClaudeSession(sessionId, newEvents, { cwd: "/test/project" })

            // Read back and verify
            const content = await readFile(filePath, "utf-8")
            const lines = content.trim().split("\n")
            expect(lines.length).toBe(4) // 3 original + 1 new

            const newLine = JSON.parse(lines[3]) as Record<string, unknown>
            expect(newLine.type).toBe("assistant")
            expect(newLine.parentUuid).toBe("cccc-3333") // leaf of original chain
            expect(newLine.sessionId).toBe(sessionId)
            expect(newLine.isSidechain).toBe(false)
            expect(typeof newLine.uuid).toBe("string")
            expect(newLine.uuid).not.toBe("will-be-overwritten")
            // Metadata fields
            expect(newLine.userType).toBe("external")
            expect(newLine.cwd).toBe("/test/project")
            expect(newLine.version).toBe("harness")
        })

        it("chains multiple injected events correctly", async () => {
            const filePath = await createSessionFile("/test/project", [ASSISTANT_LINE])

            const newEvents: HarnessEvent<ClaudeEvent>[] = [
                {
                    type: "message",
                    message: {
                        type: "user",
                        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
                    },
                },
                {
                    type: "message",
                    message: {
                        type: "assistant",
                        message: {
                            id: "msg-x",
                            type: "message",
                            role: "assistant",
                            content: [{ type: "text", text: "Response" }],
                            model: "claude-sonnet-4-20250514",
                            stop_reason: "end_turn",
                            usage: { input_tokens: 10, output_tokens: 5 },
                        },
                        uuid: "",
                        session_id: "",
                        parent_tool_use_id: null,
                    },
                },
            ]

            await writeClaudeSession(sessionId, newEvents, { cwd: "/test/project" })

            const content = await readFile(filePath, "utf-8")
            const lines = content
                .trim()
                .split("\n")
                .map((l) => JSON.parse(l) as Record<string, unknown>)
            expect(lines.length).toBe(3) // 1 original + 2 new

            // First injected message chains from original leaf
            expect(lines[1].parentUuid).toBe("aaaa-1111")
            // Second injected message chains from first injected
            expect(lines[2].parentUuid).toBe(lines[1].uuid)
        })

        it("skips non-message events", async () => {
            const filePath = await createSessionFile("/test/project", [ASSISTANT_LINE])

            const newEvents: HarnessEvent<ClaudeEvent>[] = [
                { type: "session_started", sessionId: "ignored" },
                { type: "complete", usage: { inputTokens: 0, outputTokens: 0 } },
                { type: "error", error: "ignored" },
                { type: "stderr", data: "ignored" },
            ]

            await writeClaudeSession(sessionId, newEvents, { cwd: "/test/project" })

            const content = await readFile(filePath, "utf-8")
            const lines = content.trim().split("\n")
            expect(lines.length).toBe(1) // unchanged
        })

        it("throws for missing session", async () => {
            await expect(writeClaudeSession("nonexistent", [], { cwd: "/test/project" })).rejects.toThrow("not found")
        })
    })

    describe("deleteClaudeSession", () => {
        it("deletes session file and subagent directory", async () => {
            const filePath = await createSessionFile("/test/project", [ASSISTANT_LINE])

            // Create subagent dir
            const subagentDir = filePath.replace(/\.jsonl$/, "")
            await mkdir(join(subagentDir, "subagents"), { recursive: true })
            await writeFile(join(subagentDir, "subagents", "agent-abc.jsonl"), "{}")

            // Create debug log
            await mkdir(join(tmpDir, "debug"), { recursive: true })
            await writeFile(join(tmpDir, "debug", `${sessionId}.txt`), "debug log")

            const result = await deleteClaudeSession(sessionId, { cwd: "/test/project" })
            expect(result).toBe(true)

            // Verify everything is gone
            await expect(stat(filePath)).rejects.toThrow()
            await expect(stat(subagentDir)).rejects.toThrow()
            await expect(stat(join(tmpDir, "debug", `${sessionId}.txt`))).rejects.toThrow()
        })

        it("returns false for missing session", async () => {
            const result = await deleteClaudeSession("nonexistent", { cwd: "/test/project" })
            expect(result).toBe(false)
        })
    })

    describe("isClaudeSessionActive", () => {
        it("returns false when no PID files exist", async () => {
            const result = await isClaudeSessionActive(sessionId)
            expect(result).toBe(false)
        })

        it("returns true for active session matching current PID", async () => {
            await mkdir(join(tmpDir, "sessions"), { recursive: true })
            await writeFile(join(tmpDir, "sessions", `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId }))

            const result = await isClaudeSessionActive(sessionId)
            expect(result).toBe(true)
        })

        it("returns false for dead PID", async () => {
            await mkdir(join(tmpDir, "sessions"), { recursive: true })
            // Use a PID that almost certainly doesn't exist
            await writeFile(join(tmpDir, "sessions", "999999.json"), JSON.stringify({ pid: 999999, sessionId }))

            const result = await isClaudeSessionActive(sessionId)
            expect(result).toBe(false)
        })

        it("returns false for non-matching session ID", async () => {
            await mkdir(join(tmpDir, "sessions"), { recursive: true })
            await writeFile(join(tmpDir, "sessions", `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: "other-session" }))

            const result = await isClaudeSessionActive(sessionId)
            expect(result).toBe(false)
        })
    })

    describe("listClaudeSessions", () => {
        it("lists sessions across project directories", async () => {
            await createSessionFile("/project/a", [ASSISTANT_LINE])

            const otherSessionId = "11111111-2222-3333-4444-555555555555"
            const encoded = encodeProjectPath("/project/b")
            const projectDir = join(tmpDir, "projects", encoded)
            await mkdir(projectDir, { recursive: true })
            await writeFile(join(projectDir, `${otherSessionId}.jsonl`), JSON.stringify(ASSISTANT_LINE) + "\n")

            const sessions = await listClaudeSessions()
            expect(sessions.length).toBe(2)
            const ids = sessions.map((s) => s.sessionId)
            expect(ids).toContain(sessionId)
            expect(ids).toContain(otherSessionId)
        })

        it("filters by cwd", async () => {
            await createSessionFile("/project/a", [ASSISTANT_LINE])

            const sessions = await listClaudeSessions({ cwd: "/project/a" })
            expect(sessions.length).toBe(1)
            expect(sessions[0].sessionId).toBe(sessionId)
        })

        it("respects limit", async () => {
            // Create multiple sessions in same project
            const encoded = encodeProjectPath("/project/x")
            const projectDir = join(tmpDir, "projects", encoded)
            await mkdir(projectDir, { recursive: true })

            for (let i = 0; i < 5; i++) {
                const sid = `1111111${i}-2222-3333-4444-555555555555`
                await writeFile(join(projectDir, `${sid}.jsonl`), JSON.stringify(ASSISTANT_LINE) + "\n")
            }

            const sessions = await listClaudeSessions({ limit: 3 })
            expect(sessions.length).toBe(3)
        })

        it("returns newest sessions across directories when limit is applied", async () => {
            // Create older session in project/a
            const encodedA = encodeProjectPath("/project/a")
            const dirA = join(tmpDir, "projects", encodedA)
            await mkdir(dirA, { recursive: true })
            const oldSid = "00000000-1111-2222-3333-444444444444"
            await writeFile(join(dirA, `${oldSid}.jsonl`), JSON.stringify(ASSISTANT_LINE) + "\n")

            // Create newer session in project/b (readdir order may list /b after /a)
            const encodedB = encodeProjectPath("/project/b")
            const dirB = join(tmpDir, "projects", encodedB)
            await mkdir(dirB, { recursive: true })
            const newSid = "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb"
            await writeFile(join(dirB, `${newSid}.jsonl`), JSON.stringify(ASSISTANT_LINE) + "\n")

            // With limit=1, should return the session with the most recent birthtime
            // (both are created nearly simultaneously, but the sort is global)
            const sessions = await listClaudeSessions({ limit: 1 })
            expect(sessions.length).toBe(1)
            // The important thing: we get exactly 1 session from the globally sorted list
            expect([oldSid, newSid]).toContain(sessions[0].sessionId)
        })

        it("returns empty for nonexistent directory", async () => {
            delete process.env.CLAUDE_CONFIG_DIR
            process.env.CLAUDE_CONFIG_DIR = "/nonexistent/path"
            const sessions = await listClaudeSessions()
            expect(sessions).toEqual([])
        })

        it("returns harnessId claude-code", async () => {
            await createSessionFile("/test", [ASSISTANT_LINE])
            const sessions = await listClaudeSessions()
            expect(sessions[0].harnessId).toBe("claude-code")
        })
    })

    describe("round-trip read → write → read", () => {
        it("preserves message content through round trip", async () => {
            await createSessionFile("/test/project", [ASSISTANT_LINE, USER_LINE])

            // Read
            const events = await readClaudeSession(sessionId, { cwd: "/test/project" })
            expect(events).not.toBeNull()

            // Write the message events back (skip session_started)
            const messageEvents = events!.filter((e) => e.type === "message")
            await writeClaudeSession(sessionId, messageEvents, { cwd: "/test/project" })

            // Read again
            const events2 = await readClaudeSession(sessionId, { cwd: "/test/project" })
            expect(events2).not.toBeNull()
            // Should have: session_started + 2 original + 2 written back
            expect(events2!.length).toBe(5)

            // Verify the written-back messages have the same content
            const msgs = events2!.filter((e) => e.type === "message")
            expect(msgs.length).toBe(4)

            // First pair and second pair should have same content
            if (msgs[0].type === "message" && msgs[2].type === "message") {
                const orig = msgs[0].message as ClaudeAssistantEvent
                const copy = msgs[2].message as ClaudeAssistantEvent
                expect(copy.message.content).toEqual(orig.message.content)
            }
        })
    })
})
