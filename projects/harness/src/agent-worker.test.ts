import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { runCommandAgentWorker, type WorkerHarness } from "./agent-worker.js"
import type { HarnessEvent, HarnessQuery, SlashCommand } from "./types.js"

class MemoryWritable extends Writable {
    chunks: string[] = []

    _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        this.chunks.push(chunk.toString("utf8"))
        callback()
    }

    text(): string {
        return this.chunks.join("")
    }
}

class BrokenWritable extends Writable {
    _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        callback(new Error("broken stdout"))
    }
}

function startEnvelope(overrides: Record<string, unknown> = {}): string {
    return `${JSON.stringify({
        type: "start",
        protocolVersion: 1,
        request: {
            runtimeId: "runtime-1",
            repoId: "repo-1",
            repoPath: "/tmp/repo",
            cwd: "/tmp/repo",
            taskId: "task-1",
            eventId: "event-1",
            executionId: "execution-1",
            harnessId: "codex",
            modelId: "gpt-test",
            turnType: "do",
            input: "Implement the task",
            appendSystemPrompt: "Use short answers",
            enabledMcpServerIds: ["mcp-1"],
            mcpServerConfigs: {
                "runtime-http": {
                    type: "http",
                    url: "https://mcp.example.test",
                    headers: { Authorization: "Bearer token" },
                },
            },
            includeComments: true,
            thinking: "high",
            fastMode: true,
            ...overrides,
        },
    })}\n`
}

function parseLines(output: MemoryWritable): Record<string, unknown>[] {
    return output
        .text()
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function fakeHarness(events: HarnessEvent<unknown>[], capture?: (query: HarnessQuery) => void, slashCommands: SlashCommand[] = []): WorkerHarness {
    return {
        async discoverSlashCommands(): Promise<SlashCommand[]> {
            return slashCommands
        },
        async *query(query: HarnessQuery): AsyncGenerator<HarnessEvent<unknown>> {
            capture?.(query)
            for (const event of events) {
                yield event
            }
        },
    }
}

describe("runCommandAgentWorker", () => {
    it("maps SDK capability discovery to the Core worker protocol", async () => {
        const output = new MemoryWritable()

        const exitCode = await runCommandAgentWorker({
            input: Readable.from([
                `${JSON.stringify({
                    type: "sdkCapabilities",
                    protocolVersion: 1,
                    request: {
                        repoId: "repo-1",
                        repoPath: "/tmp/repo",
                        cwd: "/tmp/repo/worktree",
                        taskId: "task-1",
                        harnessId: "claude-code",
                    },
                })}\n`,
            ]),
            output,
            now: () => new Date("2026-06-07T09:00:00.000Z"),
            harnesses: {
                "claude-code": fakeHarness(
                    [],
                    undefined,
                    [
                        { name: "project-command", type: "slash_command" },
                        { name: "project-skill", type: "skill" },
                    ]
                ),
            },
        })

        expect(exitCode).toBe(0)
        expect(parseLines(output)).toEqual([
            {
                type: "sdkCapabilities",
                slash_commands: ["project-command"],
                skills: ["project-skill"],
                plugins: [],
                cachedAt: Date.parse("2026-06-07T09:00:00.000Z"),
            },
        ])
    })

    it("maps a real harness stream to the Core worker protocol", async () => {
        const output = new MemoryWritable()
        const capturedQueries: HarnessQuery[] = []
        let eventCounter = 0

        const exitCode = await runCommandAgentWorker({
            input: Readable.from([startEnvelope()]),
            output,
            now: () => new Date("2026-06-07T10:00:00.000Z"),
            eventId: () => `stream-${++eventCounter}`,
            gitRefs: async () => ({ sha: "abc123", branch: "main" }),
            harnesses: {
                codex: fakeHarness(
                    [
                        { type: "session_started", sessionId: "session-1" },
                        { type: "message", message: { type: "thread.started", thread_id: "session-1" } },
                        { type: "stderr", data: "provider warning" },
                        { type: "complete", usage: { inputTokens: 10, outputTokens: 5 } },
                    ],
                    (query) => capturedQueries.push(query)
                ),
            },
        })

        expect(exitCode).toBe(0)
        expect(capturedQueries).toHaveLength(1)
        expect(capturedQueries[0]).toMatchObject({
            prompt: "Implement the task",
            cwd: "/tmp/repo",
            mode: "yolo",
            model: "gpt-test",
            thinking: "high",
            fastMode: true,
            appendSystemPrompt: "Use short answers",
            processLabel: "openade-agent-execution-1",
            mcpServers: {
                "runtime-http": {
                    type: "http",
                    url: "https://mcp.example.test",
                    headers: { Authorization: "Bearer token" },
                },
            },
        })

        const messages = parseLines(output)
        expect(messages).toHaveLength(6)
        expect(messages[0]).toMatchObject({
            type: "stream",
            event: {
                id: "stream-1",
                direction: "execution",
                type: "session_started",
                executionId: "execution-1",
                harnessId: "codex",
                sessionId: "session-1",
            },
        })
        expect(messages[1]).toMatchObject({
            type: "stream",
            event: {
                id: "stream-2",
                type: "raw_message",
                harnessId: "codex",
                message: { type: "thread.started", thread_id: "session-1" },
            },
        })
        expect(messages[2]).toMatchObject({ type: "stream", event: { id: "stream-3", type: "stderr", data: "provider warning" } })
        expect(messages[3]).toMatchObject({ type: "stream", event: { id: "stream-4", type: "complete", usage: { inputTokens: 10, outputTokens: 5 } } })
        expect(messages[4]).toMatchObject({ type: "execution", sessionId: "session-1", gitRefsAfter: { sha: "abc123", branch: "main" } })
        expect(messages[5]).toMatchObject({
            type: "result",
            status: "completed",
            success: true,
            completedAt: "2026-06-07T10:00:00.000Z",
        })
    })

    it("marks provider errors without completion as failed", async () => {
        const output = new MemoryWritable()

        const exitCode = await runCommandAgentWorker({
            input: Readable.from([startEnvelope({ harnessId: "claude-code" })]),
            output,
            now: () => new Date("2026-06-07T10:01:00.000Z"),
            eventId: () => "error-event",
            gitRefs: async () => undefined,
            harnesses: {
                "claude-code": fakeHarness([{ type: "error", error: "provider failed", code: "process_crashed" }]),
            },
        })

        expect(exitCode).toBe(0)
        const messages = parseLines(output)
        expect(messages).toHaveLength(2)
        expect(messages[0]).toMatchObject({
            type: "stream",
            event: { type: "error", error: "provider failed", code: "process_crashed" },
        })
        expect(messages[1]).toMatchObject({
            type: "result",
            status: "failed",
            success: false,
            error: "provider failed",
            completedAt: "2026-06-07T10:01:00.000Z",
        })
    })

    it("writes every worker protocol message to a recovery transcript", async () => {
        const output = new MemoryWritable()
        const recoveryDir = await mkdtemp(join(tmpdir(), "openade-worker-recovery-"))
        const recoveryFile = join(recoveryDir, "runtime.ndjson")
        let eventCounter = 0

        const exitCode = await runCommandAgentWorker({
            input: Readable.from([startEnvelope()]),
            output,
            recoveryFile,
            now: () => new Date("2026-06-07T10:03:00.000Z"),
            eventId: () => `recovery-${++eventCounter}`,
            gitRefs: async () => ({ sha: "def456" }),
            harnesses: {
                codex: fakeHarness([
                    { type: "session_started", sessionId: "session-recovery" },
                    { type: "message", message: { type: "item.completed", item: { type: "agent_message", text: "Recovered" } } },
                    { type: "complete", usage: { inputTokens: 2, outputTokens: 3 } },
                ]),
            },
        })

        expect(exitCode).toBe(0)
        expect(await readFile(recoveryFile, "utf8")).toBe(output.text())
        const messages = parseLines(output)
        expect(messages.at(-1)).toMatchObject({
            type: "result",
            status: "completed",
            success: true,
            completedAt: "2026-06-07T10:03:00.000Z",
        })
    })

    it("keeps writing recovery transcript when stdout is disconnected", async () => {
        const recoveryDir = await mkdtemp(join(tmpdir(), "openade-worker-broken-stdout-"))
        const recoveryFile = join(recoveryDir, "runtime.ndjson")

        const exitCode = await runCommandAgentWorker({
            input: Readable.from([startEnvelope()]),
            output: new BrokenWritable(),
            recoveryFile,
            now: () => new Date("2026-06-07T10:05:00.000Z"),
            eventId: () => "broken-stdout-stream",
            gitRefs: async () => undefined,
            harnesses: {
                codex: fakeHarness([{ type: "complete", usage: { inputTokens: 1, outputTokens: 1 } }]),
            },
        })

        expect(exitCode).toBe(0)
        const transcript = (await readFile(recoveryFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
        expect(transcript).toHaveLength(2)
        expect(transcript[0]).toMatchObject({ type: "stream", event: { type: "complete" } })
        expect(transcript[1]).toMatchObject({ type: "result", status: "completed" })
    })

    it("passes base64 image blocks through to the harness prompt", async () => {
        const output = new MemoryWritable()
        const capturedQueries: HarnessQuery[] = []

        await runCommandAgentWorker({
            input: Readable.from([
                startEnvelope({
                    images: [{ source: { kind: "base64", data: "aW1hZ2U=", mediaType: "image/png" } }],
                }),
            ]),
            output,
            gitRefs: async () => undefined,
            harnesses: {
                codex: fakeHarness([{ type: "complete" }], (query) => capturedQueries.push(query)),
            },
        })

        expect(capturedQueries[0].prompt).toEqual([
            { type: "text", text: "Implement the task" },
            { type: "image", source: { kind: "base64", data: "aW1hZ2U=", mediaType: "image/png" } },
        ])
    })

    it("maps read-only start envelopes to read-only harness mode", async () => {
        const output = new MemoryWritable()
        const capturedQueries: HarnessQuery[] = []

        await runCommandAgentWorker({
            input: Readable.from([startEnvelope({ readOnly: true, turnType: "review" })]),
            output,
            gitRefs: async () => undefined,
            harnesses: {
                codex: fakeHarness([{ type: "complete" }], (query) => capturedQueries.push(query)),
            },
        })

        expect(capturedQueries[0].mode).toBe("read-only")
    })

    it("uses the deterministic smoke harness only when smoke env is enabled", async () => {
        const output = new MemoryWritable()
        const previousSmokeTest = process.env.OPENADE_SMOKE_TEST
        const previousDeterministicHarness = process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS
        process.env.OPENADE_SMOKE_TEST = "1"
        process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS = "1"
        try {
            const exitCode = await runCommandAgentWorker({
                input: Readable.from([startEnvelope()]),
                output,
                now: () => new Date("2026-06-07T10:02:00.000Z"),
                eventId: () => "smoke-stream",
                gitRefs: async () => undefined,
            })

            expect(exitCode).toBe(0)
            const messages = parseLines(output)
            expect(messages).toHaveLength(5)
            expect(messages[0]).toMatchObject({
                type: "stream",
                event: {
                    type: "session_started",
                    harnessId: "codex",
                    sessionId: "smoke-codex-session",
                },
            })
            expect(messages[1]).toMatchObject({
                type: "stream",
                event: {
                    type: "raw_message",
                    message: {
                        type: "item.completed",
                        item: {
                            type: "agent_message",
                            text: "Deterministic Core smoke response.",
                        },
                    },
                },
            })
            expect(messages[2]).toMatchObject({ type: "stream", event: { type: "complete", usage: { inputTokens: 1, outputTokens: 1 } } })
            expect(messages[3]).toMatchObject({ type: "execution", sessionId: "smoke-codex-session" })
            expect(messages[4]).toMatchObject({
                type: "result",
                status: "completed",
                success: true,
                completedAt: "2026-06-07T10:02:00.000Z",
            })
        } finally {
            if (previousSmokeTest === undefined) {
                delete process.env.OPENADE_SMOKE_TEST
            } else {
                process.env.OPENADE_SMOKE_TEST = previousSmokeTest
            }
            if (previousDeterministicHarness === undefined) {
                delete process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS
            } else {
                process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS = previousDeterministicHarness
            }
        }
    })

    it("delays only deterministic smoke prompts matching the configured recovery probe", async () => {
        const output = new MemoryWritable()
        const previousSmokeTest = process.env.OPENADE_SMOKE_TEST
        const previousDeterministicHarness = process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS
        const previousDelayPrompt = process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS_DELAY_PROMPT
        const previousDelayMs = process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS_DELAY_MS
        process.env.OPENADE_SMOKE_TEST = "1"
        process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS = "1"
        process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS_DELAY_PROMPT = "Delay managed Core recovery smoke"
        process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS_DELAY_MS = "1"
        try {
            const exitCode = await runCommandAgentWorker({
                input: Readable.from([startEnvelope({ input: "Delay managed Core recovery smoke" })]),
                output,
                now: () => new Date("2026-06-07T10:04:00.000Z"),
                eventId: () => "delayed-smoke-stream",
                gitRefs: async () => undefined,
            })

            expect(exitCode).toBe(0)
            expect(parseLines(output).at(-1)).toMatchObject({ type: "result", status: "completed" })
        } finally {
            if (previousSmokeTest === undefined) {
                delete process.env.OPENADE_SMOKE_TEST
            } else {
                process.env.OPENADE_SMOKE_TEST = previousSmokeTest
            }
            if (previousDeterministicHarness === undefined) {
                delete process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS
            } else {
                process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS = previousDeterministicHarness
            }
            if (previousDelayPrompt === undefined) {
                delete process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS_DELAY_PROMPT
            } else {
                process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS_DELAY_PROMPT = previousDelayPrompt
            }
            if (previousDelayMs === undefined) {
                delete process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS_DELAY_MS
            } else {
                process.env.OPENADE_SMOKE_DETERMINISTIC_HARNESS_DELAY_MS = previousDelayMs
            }
        }
    })
})
