import { homedir } from "node:os"
import { join, basename } from "node:path"
import { randomUUID } from "node:crypto"
import { readFile, readdir, appendFile, rm, stat } from "node:fs/promises"

import type { HarnessEvent, SessionMeta, ListSessionsOptions, GetSessionEventsOptions, WriteSessionEventsOptions, DeleteSessionOptions } from "../../types.js"
import type { ClaudeEvent, ClaudeAssistantEvent, ClaudeUserEvent } from "./types.js"

function resolveClaudeHome(): string {
    return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")
}

export function encodeProjectPath(cwd: string): string {
    // Replace both forward and backslashes to handle Windows paths
    return cwd.replace(/[/\\]/g, "-")
}

async function findSessionFile(sessionId: string, cwd?: string): Promise<string | null> {
    const claudeHome = resolveClaudeHome()
    const projectsDir = join(claudeHome, "projects")

    if (cwd) {
        const encoded = encodeProjectPath(cwd)
        const filePath = join(projectsDir, encoded, `${sessionId}.jsonl`)
        try {
            await stat(filePath)
            return filePath
        } catch {
            return null
        }
    }

    // Scan all project directories
    let projectDirs: string[]
    try {
        projectDirs = await readdir(projectsDir)
    } catch {
        return null
    }

    for (const dir of projectDirs) {
        const filePath = join(projectsDir, dir, `${sessionId}.jsonl`)
        try {
            await stat(filePath)
            return filePath
        } catch {
            continue
        }
    }
    return null
}

export function parseClaudeSessionLine(raw: Record<string, unknown>): HarnessEvent<ClaudeEvent> | null {
    const type = raw.type as string | undefined
    if (!type) return null

    if (type === "assistant") {
        const msg = raw.message as ClaudeAssistantEvent["message"] | undefined
        if (!msg) return null
        const event: ClaudeAssistantEvent = {
            type: "assistant",
            message: msg,
            uuid: (raw.uuid as string) ?? "",
            session_id: (raw.sessionId as string) ?? "",
            parent_tool_use_id: (raw.sourceToolAssistantUUID as string) ?? null,
        }
        return { type: "message", message: event }
    }

    if (type === "user") {
        const msg = raw.message as ClaudeUserEvent["message"] | undefined
        if (!msg) return null
        const event: ClaudeUserEvent = {
            type: "user",
            message: msg,
        }
        return { type: "message", message: event }
    }

    // Skip queue-operation, metadata, and other non-message entries
    return null
}

export async function readClaudeSession(sessionId: string, options?: GetSessionEventsOptions): Promise<HarnessEvent<ClaudeEvent>[] | null> {
    const filePath = await findSessionFile(sessionId, options?.cwd)
    if (!filePath) return null

    const content = await readFile(filePath, "utf-8")
    const events: HarnessEvent<ClaudeEvent>[] = [{ type: "session_started", sessionId }]

    for (const line of content.split("\n")) {
        if (!line.trim()) continue
        try {
            const parsed = JSON.parse(line)
            const event = parseClaudeSessionLine(parsed)
            if (event) events.push(event)
        } catch {
            // Skip corrupted lines
        }
    }

    return events
}

async function findLeafUuid(filePath: string): Promise<string | null> {
    const content = await readFile(filePath, "utf-8")
    const uuids = new Set<string>()
    const referencedAsParent = new Set<string>()

    for (const line of content.split("\n")) {
        if (!line.trim()) continue
        try {
            const parsed = JSON.parse(line) as Record<string, unknown>
            const uuid = parsed.uuid as string | undefined
            const parentUuid = parsed.parentUuid as string | undefined
            if (uuid) uuids.add(uuid)
            if (parentUuid) referencedAsParent.add(parentUuid)
        } catch {
            continue
        }
    }

    // The leaf is a uuid that is never referenced as a parentUuid
    // Walk backwards to find the most recent leaf
    let leaf: string | null = null
    for (const uuid of uuids) {
        if (!referencedAsParent.has(uuid)) {
            leaf = uuid
        }
    }
    return leaf
}

function claudeEventToSessionLine(
    event: HarnessEvent<ClaudeEvent>,
    sessionId: string,
    parentUuid: string | null,
    cwd?: string,
): { line: Record<string, unknown>; uuid: string } | null {
    if (event.type !== "message") return null
    const msg = event.message

    if (msg.type === "assistant") {
        const uuid = randomUUID()
        return {
            line: {
                type: "assistant",
                message: msg.message,
                uuid,
                parentUuid,
                isSidechain: false,
                sessionId,
                timestamp: new Date().toISOString(),
                userType: "external",
                cwd,
                version: "harness",
            },
            uuid,
        }
    }

    if (msg.type === "user") {
        const uuid = randomUUID()
        return {
            line: {
                type: "user",
                message: msg.message,
                uuid,
                parentUuid,
                isSidechain: false,
                sessionId,
                timestamp: new Date().toISOString(),
                userType: "external",
                cwd,
                version: "harness",
            },
            uuid,
        }
    }

    return null
}

export async function writeClaudeSession(sessionId: string, events: HarnessEvent<ClaudeEvent>[], options: WriteSessionEventsOptions): Promise<void> {
    const filePath = await findSessionFile(sessionId, options.cwd)
    if (!filePath) throw new Error(`Session ${sessionId} not found`)

    let parentUuid = await findLeafUuid(filePath)
    const lines: string[] = []

    for (const event of events) {
        const result = claudeEventToSessionLine(event, sessionId, parentUuid, options.cwd)
        if (result) {
            lines.push(JSON.stringify(result.line))
            parentUuid = result.uuid
        }
    }

    if (lines.length > 0) {
        await appendFile(filePath, lines.join("\n") + "\n")
    }
}

export async function deleteClaudeSession(sessionId: string, options?: DeleteSessionOptions): Promise<boolean> {
    const claudeHome = resolveClaudeHome()
    const filePath = await findSessionFile(sessionId, options?.cwd)
    if (!filePath) return false

    // Delete main JSONL
    await rm(filePath, { force: true })

    // Delete subagents + remote-agents directory (same path without .jsonl)
    const sessionDir = filePath.replace(/\.jsonl$/, "")
    await rm(sessionDir, { recursive: true, force: true })

    // Delete debug log
    const debugLog = join(claudeHome, "debug", `${sessionId}.txt`)
    await rm(debugLog, { force: true })

    return true
}

export async function isClaudeSessionActive(sessionId: string): Promise<boolean> {
    const claudeHome = resolveClaudeHome()
    const sessionsDir = join(claudeHome, "sessions")

    let files: string[]
    try {
        files = await readdir(sessionsDir)
    } catch {
        return false
    }

    for (const file of files) {
        if (!file.endsWith(".json")) continue
        try {
            const content = JSON.parse(await readFile(join(sessionsDir, file), "utf-8"))
            if (content.sessionId !== sessionId) continue
            // Probe if PID is still running (signal 0 = existence check)
            process.kill(content.pid, 0)
            return true
        } catch {
            // File parse error or process not running (ESRCH)
            continue
        }
    }
    return false
}

export async function listClaudeSessions(options?: ListSessionsOptions): Promise<SessionMeta[]> {
    const claudeHome = resolveClaudeHome()
    const projectsDir = join(claudeHome, "projects")
    const limit = options?.limit ?? 50

    let projectDirs: string[]
    try {
        projectDirs = await readdir(projectsDir)
    } catch {
        return []
    }

    // If cwd is specified, only scan that project dir
    if (options?.cwd) {
        const encoded = encodeProjectPath(options.cwd)
        projectDirs = projectDirs.includes(encoded) ? [encoded] : []
    }

    const sessions: SessionMeta[] = []

    for (const dir of projectDirs) {
        let files: string[]
        try {
            files = await readdir(join(projectsDir, dir))
        } catch {
            continue
        }

        for (const file of files) {
            if (!file.endsWith(".jsonl")) continue

            const sessionId = basename(file, ".jsonl")
            // Validate it looks like a UUID
            if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(sessionId)) continue

            const meta: SessionMeta = {
                sessionId,
                harnessId: "claude-code",
            }

            // Read first few lines for metadata
            try {
                const filePath = join(projectsDir, dir, file)
                const fileStat = await stat(filePath)
                meta.startedAt = fileStat.birthtime.toISOString()

                const content = await readFile(filePath, "utf-8")
                const lines = content.split("\n")
                let count = 0
                for (const line of lines) {
                    if (!line.trim()) continue
                    try {
                        const parsed = JSON.parse(line) as Record<string, unknown>
                        if (parsed.type === "assistant" || parsed.type === "user") count++
                        if (!meta.cwd && typeof parsed.cwd === "string") meta.cwd = parsed.cwd
                        if (!meta.model && parsed.type === "assistant") {
                            const msg = parsed.message as Record<string, unknown> | undefined
                            if (msg && typeof msg.model === "string") meta.model = msg.model
                        }
                    } catch {
                        continue
                    }
                }
                meta.messageCount = count
            } catch {
                // Skip files we can't read
            }

            sessions.push(meta)
        }
    }

    // Sort by startedAt descending
    sessions.sort((a, b) => {
        if (!a.startedAt || !b.startedAt) return 0
        return b.startedAt.localeCompare(a.startedAt)
    })

    return sessions.slice(0, limit)
}
