import { rm } from "node:fs/promises"
import { execFileSync, spawnSync } from "node:child_process"

import type { Harness } from "../../harness.js"
import type {
    DeleteSessionOptions,
    HarnessCapabilities,
    HarnessEvent,
    HarnessInstallStatus,
    HarnessMeta,
    HarnessModelConfig,
    HarnessQuery,
    HarnessUsage,
    ListSessionsOptions,
    SessionMeta,
    SlashCommand,
    StructuredQueryInput,
    StructuredQueryResult,
    WriteSessionEventsOptions,
    GetSessionEventsOptions,
} from "../../types.js"
import { HarnessNotInstalledError } from "../../errors.js"
import { OPENCODE_MODEL_CONFIG } from "../../models.js"
import { runStructuredQuery } from "../../structured.js"
import { spawnJsonl } from "../../util/spawn.js"
import { resolveExecutable } from "../../util/which.js"
import { buildOpencodeArgs, type OpencodeHarnessConfig } from "./args.js"
import { parseOpencodeEvent, type OpencodeEvent } from "./types.js"

export type { OpencodeHarnessConfig } from "./args.js"
export type { OpencodeEvent } from "./types.js"

export class OpencodeHarness implements Harness<OpencodeEvent> {
    readonly id = "opencode"
    private config: OpencodeHarnessConfig

    constructor(config?: OpencodeHarnessConfig) {
        this.config = config ?? {}
    }

    meta(): HarnessMeta {
        return {
            id: "opencode",
            name: "opencode",
            vendor: "sst",
            website: "https://opencode.ai/",
        }
    }

    capabilities(): HarnessCapabilities {
        return {
            supportsSystemPrompt: false,
            supportsAppendSystemPrompt: false,
            supportsReadOnly: true,
            supportsMcp: false,
            supportsResume: true,
            supportsFork: true,
            supportsClientTools: false,
            supportsStreamingTokens: false,
            supportsCostTracking: true,
            supportsFastMode: false,
            supportsNamedTools: false,
            supportsImages: true,
            supportsSessionReplay: false,
        }
    }

    models(): HarnessModelConfig {
        return OPENCODE_MODEL_CONFIG
    }

    async checkInstallStatus(): Promise<HarnessInstallStatus> {
        const binaryPath = await this.resolveBinary()

        if (!binaryPath) {
            return {
                installed: false,
                authType: "account",
                authenticated: false,
                authInstructions: "Install opencode: curl -fsSL https://opencode.ai/install | bash",
            }
        }

        let version: string | undefined
        try {
            version = execFileSync(binaryPath, ["--version"], {
                encoding: "utf-8",
                timeout: 10000,
                stdio: ["pipe", "pipe", "pipe"],
            }).trim()
        } catch {
            // Version check failed
        }

        let authenticated = false
        try {
            const result = spawnSync(binaryPath, ["auth", "list"], {
                encoding: "utf-8",
                timeout: 10000,
                stdio: ["pipe", "pipe", "pipe"],
            })
            authenticated = hasAuthListEntries(`${result.stdout ?? ""}\n${result.stderr ?? ""}`)
        } catch {
            // auth list failed or returned non-zero — not authenticated
        }

        return {
            installed: true,
            version,
            authType: "account",
            authenticated,
            authInstructions: authenticated ? undefined : "Run `opencode auth login` to authenticate a provider",
        }
    }

    async discoverSlashCommands(_cwd: string): Promise<SlashCommand[]> {
        return []
    }

    async *query(q: HarnessQuery): AsyncGenerator<HarnessEvent<OpencodeEvent>> {
        const binaryPath = await this.resolveBinary()
        if (!binaryPath) {
            throw new HarnessNotInstalledError("opencode", "Install opencode: curl -fsSL https://opencode.ai/install | bash")
        }

        if (q.clientTools && q.clientTools.length > 0) {
            console.warn("[opencode-harness] client tools are not supported by opencode. Ignoring.")
        }
        if (q.userPromptHandler) {
            console.warn("[opencode-harness] user prompts are not supported by opencode. Ignoring.")
        }
        if (q.mcpServers && Object.keys(q.mcpServers).length > 0) {
            console.warn("[opencode-harness] per-query MCP server injection is not supported by opencode. Ignoring.")
        }

        const buildResult = await buildOpencodeArgs(q, this.config)
        const startTime = Date.now()
        let sessionStarted = false
        let lastError: string | undefined
        const textParts: string[] = []
        const textDeltaPartIds = new Set<string>()
        const usageAccumulator = createUsageAccumulator()

        try {
            yield* spawnJsonl<OpencodeEvent>({
                command: binaryPath,
                args: buildResult.args,
                cwd: buildResult.cwd,
                env: buildResult.env,
                signal: q.signal,
                argv0: q.processLabel,
                parseLine: (line) => {
                    let parsed: unknown
                    try {
                        parsed = JSON.parse(line)
                    } catch {
                        return null
                    }

                    const event = parseOpencodeEvent(parsed)
                    if (!event) return null

                    const events: HarnessEvent<OpencodeEvent>[] = []
                    const sessionId = getOpencodeSessionId(event)
                    if (sessionId && !sessionStarted) {
                        sessionStarted = true
                        events.push({ type: "session_started", sessionId })
                    }

                    const text = getOpencodeText(event, textDeltaPartIds)
                    if (text) textParts.push(text)

                    usageAccumulator.add(event)

                    if (event.type === "error" || event.type === "session.error") {
                        lastError = getOpencodeErrorMessage(event)
                        events.push({ type: "error", error: lastError, code: "unknown" })
                    }

                    events.push({ type: "message", message: event })
                    return events
                },
                onExit: (code, stderr) => {
                    if (q.signal.aborted) return null

                    if (lastError) {
                        return null
                    }

                    const durationMs = Date.now() - startTime
                    let structuredOutput: unknown

                    if (q.outputSchema) {
                        const rawStructured = textParts.join("").trim()
                        if (!rawStructured) {
                            return {
                                type: "error",
                                error: "opencode completed without structured output",
                                code: "unknown",
                            }
                        }

                        try {
                            structuredOutput = parseStructuredJson(rawStructured)
                        } catch (error) {
                            return {
                                type: "error",
                                error: `Failed to parse opencode structured output: ${error instanceof Error ? error.message : String(error)}`,
                                code: "unknown",
                            }
                        }
                    }

                    if (code === 0) {
                        return {
                            type: "complete",
                            usage: usageAccumulator.toUsage(durationMs),
                            structuredOutput,
                        }
                    }

                    if (code !== null && code !== 0) {
                        return {
                            type: "error",
                            error: stderr.trim() || `opencode process exited with code ${code}`,
                            code: "process_crashed",
                        }
                    }

                    return null
                },
            })
        } finally {
            for (const item of buildResult.cleanup) {
                try {
                    await rm(item.path, { recursive: item.type === "dir", force: true })
                } catch {
                    // Ignore cleanup errors
                }
            }
        }
    }

    async structuredQuery<T = unknown>(q: StructuredQueryInput<T>): Promise<StructuredQueryResult<T, OpencodeEvent>> {
        return runStructuredQuery(this, q)
    }

    async listSessions(options?: ListSessionsOptions): Promise<SessionMeta[]> {
        const binaryPath = await this.resolveBinary()
        if (!binaryPath) return []

        const args = ["session", "list", "--format", "json"]
        if (options?.limit != null) {
            args.push("--max-count", String(options.limit))
        }

        const result = spawnSync(binaryPath, args, {
            cwd: options?.cwd,
            encoding: "utf-8",
            timeout: 10000,
            stdio: ["pipe", "pipe", "pipe"],
        })

        if (result.status !== 0) return []

        return parseSessionList(result.stdout, options?.cwd)
    }

    async getSessionEvents(_sessionId: string, _options?: GetSessionEventsOptions): Promise<HarnessEvent<OpencodeEvent>[] | null> {
        return null
    }

    async writeSessionEvents(_sessionId: string, _events: HarnessEvent<OpencodeEvent>[], _options: WriteSessionEventsOptions): Promise<void> {
        throw new Error("opencode session replay writes are not supported")
    }

    async deleteSession(sessionId: string, options?: DeleteSessionOptions): Promise<boolean> {
        const binaryPath = await this.resolveBinary()
        if (!binaryPath) return false

        const result = spawnSync(binaryPath, ["session", "delete", sessionId], {
            cwd: options?.cwd,
            encoding: "utf-8",
            timeout: 10000,
            stdio: ["pipe", "pipe", "pipe"],
        })

        return result.status === 0
    }

    async isSessionActive(_sessionId: string): Promise<boolean> {
        return false
    }

    private async resolveBinary(): Promise<string | undefined> {
        if (this.config.binaryPath) return this.config.binaryPath
        return resolveExecutable("opencode")
    }
}

function stripAnsi(value: string): string {
    return value.replace(/\x1b\[[0-9;]*m/g, "")
}

function hasAuthListEntries(output: string): boolean {
    const clean = stripAnsi(output)
    return /\b[1-9]\d*\s+credentials?\b/i.test(clean) || /\b[1-9]\d*\s+environment variables?\b/i.test(clean) || /^●\s+/m.test(clean)
}

function getOpencodeSessionId(event: OpencodeEvent): string | undefined {
    const record = getEventRecord(event)

    const direct = pickString(record, ["sessionID", "sessionId"])
    if (direct) return direct

    const part = isRecord(record.part) ? record.part : undefined
    const partSessionId = part ? pickString(part, ["sessionID", "sessionId"]) : undefined
    if (partSessionId) return partSessionId

    const properties = getProperties(event)
    const propertySessionId = properties ? pickString(properties, ["sessionID", "sessionId"]) : undefined
    if (propertySessionId) return propertySessionId

    const propertyPart = properties && isRecord(properties.part) ? properties.part : undefined
    const propertyPartSessionId = propertyPart ? pickString(propertyPart, ["sessionID", "sessionId"]) : undefined
    if (propertyPartSessionId) return propertyPartSessionId

    const info = properties && isRecord(properties.info) ? properties.info : undefined
    return info ? pickString(info, ["sessionID", "sessionId"]) : undefined
}

function getOpencodeText(event: OpencodeEvent, textDeltaPartIds?: Set<string>): string | undefined {
    if (event.type === "text") {
        const partText = event.part?.text
        if (typeof partText === "string") return partText

        const rawText = (event as unknown as { text?: unknown }).text
        return typeof rawText === "string" ? rawText : undefined
    }

    const properties = getProperties(event)
    if (!properties) return undefined

    if (event.type === "message.part.delta") {
        if (properties.field !== "text" || typeof properties.delta !== "string") return undefined
        const partId = getOpencodePartId(properties)
        if (partId) textDeltaPartIds?.add(partId)
        return properties.delta
    }

    if (event.type === "message.part.updated") {
        const part = isRecord(properties.part) ? properties.part : undefined
        if (!part || part.type !== "text") return undefined
        const partId = getOpencodePartId(properties) ?? getOpencodePartId(part)
        if (partId && textDeltaPartIds?.has(partId)) return undefined
        const text = part.text ?? part.snapshot
        return typeof text === "string" ? text : undefined
    }

    return undefined
}

function getOpencodeErrorMessage(event: OpencodeEvent): string {
    if (event.type === "error") {
        return event.error?.data?.message ?? event.error?.message ?? event.message ?? event.error?.name ?? "opencode error"
    }

    if (event.type === "session.error") {
        const properties = getProperties(event)
        const propertyError = properties?.error
        if (isRecord(propertyError)) {
            const data = isRecord(propertyError.data) ? propertyError.data : undefined
            const dataMessage = data ? pickString(data, ["message"]) : undefined
            return dataMessage ?? pickString(propertyError, ["message", "name"]) ?? "opencode error"
        }
        if (typeof propertyError === "string") return propertyError
        return event.message ?? (typeof properties?.message === "string" ? properties.message : undefined) ?? "opencode error"
    }

    return "opencode error"
}

function createUsageAccumulator() {
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let costUsd = 0

    return {
        add(event: OpencodeEvent) {
            const usage = getOpencodeUsage(event)
            if (!usage) return

            if (usage.mode === "snapshot") {
                inputTokens = Math.max(inputTokens, asNumber(usage.tokens?.input))
                outputTokens = Math.max(outputTokens, asNumber(usage.tokens?.output))
                cacheReadTokens = Math.max(cacheReadTokens, asNumber(usage.tokens?.cache?.read))
                cacheWriteTokens = Math.max(cacheWriteTokens, asNumber(usage.tokens?.cache?.write))
                costUsd = Math.max(costUsd, asNumber(usage.cost))
                return
            }

            inputTokens += asNumber(usage.tokens?.input)
            outputTokens += asNumber(usage.tokens?.output)
            cacheReadTokens += asNumber(usage.tokens?.cache?.read)
            cacheWriteTokens += asNumber(usage.tokens?.cache?.write)
            costUsd += asNumber(usage.cost)
        },
        toUsage(durationMs: number): HarnessUsage {
            return {
                inputTokens,
                outputTokens,
                cacheReadTokens,
                cacheWriteTokens,
                costUsd,
                durationMs,
            }
        },
    }
}

function getOpencodeUsage(event: OpencodeEvent): { mode: "increment"; tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } }; cost?: number } | { mode: "snapshot"; tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } }; cost?: number } | null {
    if (event.type === "step_finish") {
        return {
            mode: "increment",
            tokens: event.part?.tokens,
            cost: event.part?.cost,
        }
    }

    if (event.type === "message.updated") {
        const properties = getProperties(event)
        const info = properties && isRecord(properties.info) ? properties.info : undefined
        const tokens = info && isRecord(info.tokens) ? info.tokens : undefined
        return {
            mode: "snapshot",
            tokens: tokens as { input?: number; output?: number; cache?: { read?: number; write?: number } } | undefined,
            cost: typeof info?.cost === "number" ? info.cost : undefined,
        }
    }

    return null
}

function getEventRecord(event: OpencodeEvent): Record<string, unknown> {
    return event.type === "raw_json" ? event.raw : (event as unknown as Record<string, unknown>)
}

function getProperties(event: OpencodeEvent): Record<string, unknown> | undefined {
    const properties = getEventRecord(event).properties
    return isRecord(properties) ? properties : undefined
}

function getOpencodePartId(record: Record<string, unknown>): string | undefined {
    return pickString(record, ["partID", "partId", "id"])
}

function asNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function parseStructuredJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        // Continue with extraction fallbacks
    }

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced) {
        return JSON.parse(fenced[1].trim())
    }

    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start >= 0 && end > start) {
        return JSON.parse(text.slice(start, end + 1))
    }

    throw new Error("No JSON object found in opencode output")
}

function parseSessionList(raw: string, cwd: string | undefined): SessionMeta[] {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return []
    }

    const entries = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.sessions) ? parsed.sessions : []

    return entries.flatMap((entry): SessionMeta[] => {
        if (!isRecord(entry)) return []
        const sessionId = pickString(entry, ["id", "sessionID", "sessionId"])
        if (!sessionId) return []
        return [
            {
                sessionId,
                harnessId: "opencode",
                cwd: pickString(entry, ["cwd", "directory", "path"]) ?? cwd,
                model: pickString(entry, ["model"]),
                startedAt: pickString(entry, ["created", "createdAt", "time", "updated", "updatedAt"]),
            },
        ]
    })
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = record[key]
        if (typeof value === "string" && value.length > 0) return value
    }
    return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
}
