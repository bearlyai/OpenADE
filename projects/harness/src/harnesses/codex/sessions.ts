import { homedir } from "node:os"
import { join, basename } from "node:path"
import { randomUUID } from "node:crypto"
import { readFile, readdir, appendFile, rm, stat } from "node:fs/promises"

import type { HarnessEvent, SessionMeta, ListSessionsOptions, GetSessionEventsOptions, WriteSessionEventsOptions, DeleteSessionOptions } from "../../types.js"
import type {
    CodexEvent,
    CodexThreadStartedEvent,
    CodexTurnStartedEvent,
    CodexTurnCompletedEvent,
    CodexItemCompletedEvent,
    CodexAgentMessageItem,
    CodexReasoningItem,
    CodexCommandExecutionItem,
} from "./types.js"

function resolveCodexHome(): string {
    return process.env.CODEX_HOME ?? join(homedir(), ".codex")
}

async function findSessionFile(sessionId: string): Promise<string | null> {
    const codexHome = resolveCodexHome()
    const sessionsDir = join(codexHome, "sessions")

    let allFiles: string[]
    try {
        allFiles = (await readdir(sessionsDir, { recursive: true })) as string[]
    } catch {
        return null
    }

    const suffix = `-${sessionId}.jsonl`
    for (const file of allFiles) {
        if (file.endsWith(suffix)) {
            return join(sessionsDir, file)
        }
    }
    return null
}

interface CodexRolloutLine {
    timestamp: string
    type: string
    payload: Record<string, unknown>
}

interface FunctionCallCorrelation {
    output: string
    exitCode: number | null
}

function readFirstSessionMeta(content: string): CodexRolloutLine | null {
    const idx = content.indexOf("\n")
    const firstLine = idx >= 0 ? content.slice(0, idx) : content
    if (!firstLine.trim()) return null
    try {
        const parsed = JSON.parse(firstLine) as CodexRolloutLine
        if (parsed.type === "session_meta") return parsed
    } catch {
        // ignore
    }
    return null
}

export function parseCodexSessionLine(
    raw: CodexRolloutLine,
    callOutputs?: Map<string, FunctionCallCorrelation>,
): HarnessEvent<CodexEvent> | null {
    // session_meta → thread.started
    if (raw.type === "session_meta") {
        const payload = raw.payload
        const event: CodexThreadStartedEvent = {
            type: "thread.started",
            thread_id: (payload.id as string) ?? "",
            session_id: (payload.id as string) ?? "",
            cwd: payload.cwd as string | undefined,
        }
        return { type: "message", message: event }
    }

    // event_msg → turn lifecycle
    if (raw.type === "event_msg") {
        const eventType = raw.payload.type as string | undefined

        if (eventType === "turn_started") {
            const event: CodexTurnStartedEvent = { type: "turn.started" }
            return { type: "message", message: event }
        }

        if (eventType === "turn_complete") {
            const event: CodexTurnCompletedEvent = {
                type: "turn.completed",
                usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
            }
            return { type: "message", message: event }
        }

        // token_count, etc. — no matching CodexEvent type
        return null
    }

    if (raw.type !== "response_item") return null

    const payload = raw.payload
    const itemType = payload.type as string | undefined
    if (!itemType) return null

    if (itemType === "message") {
        const role = payload.role as string | undefined
        if (role !== "assistant") return null

        // Extract text from content array
        const contentArr = payload.content as Array<{ type: string; text?: string }> | undefined
        const text =
            contentArr
                ?.filter((b) => b.type === "output_text" || b.type === "text")
                .map((b) => b.text ?? "")
                .join("") ?? ""

        const item: CodexAgentMessageItem = {
            id: (payload.id as string) ?? randomUUID(),
            type: "agent_message",
            text,
        }
        const event: CodexItemCompletedEvent = {
            type: "item.completed",
            item,
        }
        return { type: "message", message: event }
    }

    if (itemType === "function_call") {
        let command = (payload.name as string) ?? ""
        let aggregatedOutput = ""
        let exitCode: number | null = null

        // Extract actual command from arguments JSON
        const argsStr = payload.arguments as string | undefined
        if (argsStr) {
            try {
                const args = JSON.parse(argsStr) as Record<string, unknown>
                if (typeof args.cmd === "string") command = args.cmd
                else if (typeof args.command === "string") command = args.command
            } catch {
                // Keep the function name as command
            }
        }

        // Correlate with function_call_output if available
        const callId = payload.call_id as string | undefined
        if (callId && callOutputs) {
            const correlated = callOutputs.get(callId)
            if (correlated) {
                aggregatedOutput = correlated.output
                exitCode = correlated.exitCode
            }
        }

        const item: CodexCommandExecutionItem = {
            id: (payload.id as string) ?? randomUUID(),
            type: "command_execution",
            command,
            aggregated_output: aggregatedOutput,
            exit_code: exitCode,
            status: "completed",
        }
        const event: CodexItemCompletedEvent = {
            type: "item.completed",
            item,
        }
        return { type: "message", message: event }
    }

    if (itemType === "reasoning") {
        const summary = payload.summary as Array<{ type: string; text?: string }> | undefined
        const text = summary?.map((b) => b.text ?? "").join("") ?? ""

        const item: CodexReasoningItem = {
            id: (payload.id as string) ?? randomUUID(),
            type: "reasoning",
            text,
        }
        const event: CodexItemCompletedEvent = {
            type: "item.completed",
            item,
        }
        return { type: "message", message: event }
    }

    // Skip function_call_output (consumed via callOutputs correlation), user messages, etc.
    return null
}

export async function readCodexSession(sessionId: string, _options?: GetSessionEventsOptions): Promise<HarnessEvent<CodexEvent>[] | null> {
    const filePath = await findSessionFile(sessionId)
    if (!filePath) return null

    const content = await readFile(filePath, "utf-8")
    const parsedLines: CodexRolloutLine[] = []

    // Pass 1: parse JSON lines, collect function_call_output correlation map
    const callOutputs = new Map<string, FunctionCallCorrelation>()

    for (const line of content.split("\n")) {
        if (!line.trim()) continue
        try {
            const parsed = JSON.parse(line) as CodexRolloutLine
            parsedLines.push(parsed)

            if (parsed.type === "response_item") {
                const itemType = parsed.payload.type as string
                if (itemType === "function_call_output") {
                    const callId = parsed.payload.call_id as string | undefined
                    if (callId) {
                        let output = ""
                        let exitCode: number | null = null
                        const outputStr = parsed.payload.output as string | undefined
                        if (outputStr) {
                            try {
                                const outputObj = JSON.parse(outputStr) as Record<string, unknown>
                                output = (outputObj.stdout as string) ?? (outputObj.output as string) ?? outputStr
                                exitCode = typeof outputObj.exit_code === "number" ? outputObj.exit_code : null
                            } catch {
                                output = outputStr
                            }
                        }
                        callOutputs.set(callId, { output, exitCode })
                    }
                }
            }
        } catch {
            // Skip corrupted lines
        }
    }

    // Pass 2: build events with function_call correlation
    const events: HarnessEvent<CodexEvent>[] = [{ type: "session_started", sessionId }]

    for (const parsed of parsedLines) {
        const event = parseCodexSessionLine(parsed, callOutputs)
        if (event) events.push(event)
    }

    return events
}

function codexEventToRolloutLines(event: HarnessEvent<CodexEvent>, timestamp: string): CodexRolloutLine[] {
    if (event.type !== "message") return []
    const msg = event.message

    if (msg.type === "item.completed" || msg.type === "item.started") {
        const item = msg.item

        if (item.type === "agent_message") {
            return [
                {
                    timestamp,
                    type: "response_item",
                    payload: {
                        id: item.id,
                        type: "message",
                        role: "assistant",
                        content: [{ type: "output_text", text: item.text }],
                    },
                },
            ]
        }

        if (item.type === "command_execution") {
            return [
                {
                    timestamp,
                    type: "response_item",
                    payload: {
                        id: item.id,
                        type: "function_call",
                        name: item.command,
                        arguments: "{}",
                        call_id: randomUUID(),
                    },
                },
            ]
        }

        if (item.type === "reasoning") {
            return [
                {
                    timestamp,
                    type: "response_item",
                    payload: {
                        id: item.id,
                        type: "reasoning",
                        summary: [{ type: "summary_text", text: item.text }],
                    },
                },
            ]
        }
    }

    return []
}

export async function writeCodexSession(sessionId: string, events: HarnessEvent<CodexEvent>[], _options: WriteSessionEventsOptions): Promise<void> {
    const filePath = await findSessionFile(sessionId)
    if (!filePath) throw new Error(`Session ${sessionId} not found`)

    const now = new Date().toISOString()
    const turnId = randomUUID()
    const lines: string[] = []

    // Turn lifecycle: started
    lines.push(
        JSON.stringify({
            timestamp: now,
            type: "event_msg",
            payload: { type: "turn_started", turn_id: turnId },
        })
    )

    for (const event of events) {
        const rolloutLines = codexEventToRolloutLines(event, now)
        for (const rl of rolloutLines) {
            lines.push(JSON.stringify(rl))
        }
    }

    // Turn lifecycle: completed
    lines.push(
        JSON.stringify({
            timestamp: now,
            type: "event_msg",
            payload: { type: "turn_complete", turn_id: turnId },
        })
    )

    // Only write if there are actual content lines (not just the lifecycle wrapper)
    if (lines.length > 2) {
        await appendFile(filePath, lines.join("\n") + "\n")
    }
}

export async function deleteCodexSession(sessionId: string, _options?: DeleteSessionOptions): Promise<boolean> {
    const filePath = await findSessionFile(sessionId)
    if (!filePath) {
        // Also check archived_sessions
        const codexHome = resolveCodexHome()
        const archivedPath = join(codexHome, "archived_sessions", `${sessionId}.jsonl`)
        try {
            await stat(archivedPath)
            await rm(archivedPath, { force: true })
            return true
        } catch {
            return false
        }
    }

    await rm(filePath, { force: true })

    // Also try to clean archived copy if it exists
    const codexHome = resolveCodexHome()
    const archivedPath = join(codexHome, "archived_sessions", `${sessionId}.jsonl`)
    await rm(archivedPath, { force: true }).catch(() => {})

    return true
}

export async function isCodexSessionActive(_sessionId: string): Promise<boolean> {
    // Codex CLI does not maintain PID files or a session registry, so there is
    // no reliable way to detect whether a session is currently being served by
    // a running process. Always returns false — callers should treat Codex
    // sessions as safe to write/delete without an active-session guard.
    return false
}

export async function listCodexSessions(options?: ListSessionsOptions): Promise<SessionMeta[]> {
    const codexHome = resolveCodexHome()
    const sessionsDir = join(codexHome, "sessions")
    const limit = options?.limit ?? 50

    let allFiles: string[]
    try {
        allFiles = (await readdir(sessionsDir, { recursive: true })) as string[]
    } catch {
        return []
    }

    // Filter to rollout files and sort descending (filenames contain datetime)
    const rolloutFiles = allFiles
        .filter((f) => basename(f).startsWith("rollout-"))
        .sort()
        .reverse()

    const sessions: SessionMeta[] = []

    for (const file of rolloutFiles) {
        if (sessions.length >= limit) break

        const base = basename(file, ".jsonl")
        // rollout-YYYY-MM-DDTHH-MM-SS-<uuid> — UUID is last 36 chars
        if (base.length < 36) continue
        const sessionId = base.slice(-36)
        if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(sessionId)) continue

        const meta: SessionMeta = {
            sessionId,
            harnessId: "codex",
        }

        // Extract timestamp from filename: rollout-YYYY-MM-DDTHH-MM-SS-...
        const dateStr = base.slice(8, 27) // YYYY-MM-DDTHH-MM-SS
        if (dateStr.length === 19) {
            // Convert YYYY-MM-DDTHH-MM-SS to ISO: replace position-specific dashes
            const iso = dateStr.slice(0, 10) + "T" + dateStr.slice(11).replace(/-/g, ":") + "Z"
            meta.startedAt = iso
        }

        // If filtering by cwd, read the first line for session_meta
        if (options?.cwd) {
            try {
                const filePath = join(sessionsDir, file)
                const content = await readFile(filePath, "utf-8")
                const sessionMeta = readFirstSessionMeta(content)
                if (sessionMeta && sessionMeta.payload.cwd !== options.cwd) continue
                if (sessionMeta) meta.cwd = sessionMeta.payload.cwd as string
            } catch {
                continue
            }
        }

        sessions.push(meta)
    }

    return sessions
}
