import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { unlink, rm } from "node:fs/promises"
import { execFileSync } from "node:child_process"

import type { Harness } from "../../harness.js"
import type {
    HarnessMeta,
    HarnessModel,
    HarnessCapabilities,
    HarnessInstallStatus,
    SlashCommand,
    HarnessQuery,
    HarnessEvent,
    McpServerConfig,
    HarnessUsage,
} from "../../types.js"
import { HarnessNotInstalledError } from "../../errors.js"
import { resolveExecutable } from "../../util/which.js"
import { spawnJsonl } from "../../util/spawn.js"
import { startToolServer, type ToolServerHandle } from "../../util/tool-server.js"
import { buildClaudeArgs, type ClaudeCodeHarnessConfig } from "./args.js"
import { writeMcpConfigJson } from "./mcp-config.js"
import { parseClaudeEvent, type ClaudeEvent, type ClaudeResultEvent, type ClaudeSystemInitEvent } from "./types.js"

export type { ClaudeCodeHarnessConfig } from "./args.js"
export type { ClaudeEvent } from "./types.js"

export class ClaudeCodeHarness implements Harness<ClaudeEvent> {
    readonly id = "claude-code"
    private config: ClaudeCodeHarnessConfig

    constructor(config?: ClaudeCodeHarnessConfig) {
        this.config = config ?? {}
    }

    meta(): HarnessMeta {
        return {
            id: "claude-code",
            name: "Claude Code",
            vendor: "Anthropic",
            website: "https://docs.anthropic.com/en/docs/claude-code",
        }
    }

    models(): HarnessModel[] {
        return [
            { id: "opus", label: "Opus 4.6", isDefault: false },
            { id: "sonnet", label: "Sonnet 4.5", isDefault: true },
            { id: "haiku", label: "Haiku 4.5", isDefault: false },
        ]
    }

    capabilities(): HarnessCapabilities {
        return {
            supportsSystemPrompt: true,
            supportsAppendSystemPrompt: true,
            supportsReadOnly: true,
            supportsMcp: true,
            supportsResume: true,
            supportsFork: true,
            supportsClientTools: true,
            supportsStreamingTokens: false,
            supportsCostTracking: true,
            supportsNamedTools: true,
            supportsImages: true,
        }
    }

    async checkInstallStatus(): Promise<HarnessInstallStatus> {
        const binaryPath = await this.resolveBinary()

        if (!binaryPath) {
            return {
                installed: false,
                authType: "account",
                authenticated: false,
                authInstructions: "Install Claude Code: npm install -g @anthropic-ai/claude-code",
            }
        }

        // Get version
        let version: string | undefined
        try {
            const output = execFileSync(binaryPath, ["--version"], {
                encoding: "utf-8",
                timeout: 10000,
                stdio: ["pipe", "pipe", "pipe"],
            }).trim()
            version = output
        } catch {
            // Version check failed
        }

        // Probe for auth status
        let authenticated = false
        try {
            const ac = new AbortController()
            const timeout = setTimeout(() => ac.abort(), 15000)

            const probeArgs = ["--print", "__harness_probe__", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"]

            for await (const event of spawnJsonl<Record<string, unknown>>({
                command: binaryPath,
                args: probeArgs,
                signal: ac.signal,
                parseLine: (line) => {
                    try {
                        const parsed = JSON.parse(line)
                        return { type: "message", message: parsed }
                    } catch {
                        return null
                    }
                },
            })) {
                if (event.type === "message") {
                    const msg = event.message as Record<string, unknown>
                    // If we get a system:init, auth is working
                    if (msg.type === "system" && msg.subtype === "init") {
                        authenticated = true
                        ac.abort()
                        break
                    }
                    // Check for auth failure in result
                    if (msg.type === "result") {
                        const result = msg as Record<string, unknown>
                        if (
                            result.is_error &&
                            typeof result.result === "string" &&
                            (result.result.includes("Not logged in") || result.result.includes("authentication"))
                        ) {
                            authenticated = false
                        } else {
                            authenticated = true
                        }
                        ac.abort()
                        break
                    }
                }
            }

            clearTimeout(timeout)
        } catch {
            // Probe failed — assume not authenticated
        }

        return {
            installed: true,
            version,
            authType: "account",
            authenticated,
            authInstructions: authenticated ? undefined : "Run `claude login` to authenticate",
        }
    }

    async discoverSlashCommands(cwd: string, signal?: AbortSignal): Promise<SlashCommand[]> {
        const binaryPath = await this.resolveBinary()
        if (!binaryPath) return []

        const ac = new AbortController()
        const timeout = setTimeout(() => ac.abort(), 15000)

        // Link parent signal to our controller
        if (signal) {
            signal.addEventListener("abort", () => ac.abort(), { once: true })
        }

        const commands: SlashCommand[] = []

        try {
            const probeArgs = ["--print", "__harness_probe__", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"]

            for await (const event of spawnJsonl<Record<string, unknown>>({
                command: binaryPath,
                args: probeArgs,
                cwd,
                signal: ac.signal,
                parseLine: (line) => {
                    try {
                        return { type: "message", message: JSON.parse(line) }
                    } catch {
                        return null
                    }
                },
            })) {
                if (event.type === "message") {
                    const msg = event.message as Record<string, unknown>
                    if (msg.type === "system" && msg.subtype === "init") {
                        const init = msg as unknown as ClaudeSystemInitEvent
                        // Extract slash commands
                        if (init.slash_commands) {
                            for (const cmd of init.slash_commands) {
                                commands.push({ name: cmd, type: "slash_command" })
                            }
                        }
                        // Extract skills
                        if (init.skills) {
                            for (const skill of init.skills) {
                                commands.push({ name: skill, type: "skill" })
                            }
                        }
                        ac.abort()
                        break
                    }
                }
            }
        } catch {
            // Probe failed
        }

        clearTimeout(timeout)
        return commands
    }

    async *query(q: HarnessQuery): AsyncGenerator<HarnessEvent<ClaudeEvent>> {
        const binaryPath = await this.resolveBinary()
        if (!binaryPath) {
            throw new HarnessNotInstalledError("claude-code", "Install Claude Code: npm install -g @anthropic-ai/claude-code")
        }

        // Build base args
        const buildResult = buildClaudeArgs(q, this.config)
        const { args, env, cwd, cleanup } = buildResult

        let toolServerHandle: ToolServerHandle | undefined

        try {
            // ── Client tools → start MCP tool server ──
            const effectiveMcpServers: Record<string, McpServerConfig> = {
                ...(q.mcpServers ?? {}),
            }

            if (q.clientTools && q.clientTools.length > 0) {
                toolServerHandle = await startToolServer(q.clientTools)
                effectiveMcpServers[toolServerHandle.serverName] = toolServerHandle.mcpServer
                if (toolServerHandle.env) {
                    Object.assign(env, toolServerHandle.env)
                }
            }

            // ── MCP config → write temp file ──
            if (Object.keys(effectiveMcpServers).length > 0) {
                const mcpConfigPath = join(tmpdir(), `harness-mcp-${randomUUID()}.json`)
                await writeMcpConfigJson(effectiveMcpServers, mcpConfigPath)
                args.push("--mcp-config", mcpConfigPath)
                args.push("--strict-mcp-config")
                cleanup.push({ path: mcpConfigPath, type: "file" })
            }

            // ── Spawn and stream ──
            let lastUsage: HarnessUsage | undefined

            yield* spawnJsonl<ClaudeEvent>({
                command: binaryPath,
                args,
                cwd,
                env,
                signal: q.signal,
                parseLine: (line) => {
                    let parsed: unknown
                    try {
                        parsed = JSON.parse(line)
                    } catch {
                        return null
                    }

                    const event = parseClaudeEvent(parsed)
                    if (!event) return null

                    const events: HarnessEvent<ClaudeEvent>[] = []

                    // Extract session_started from system:init
                    if (event.type === "system" && event.subtype === "init") {
                        const init = event as ClaudeSystemInitEvent
                        events.push({ type: "session_started", sessionId: init.session_id })
                    }

                    // Extract usage from result
                    if (event.type === "result") {
                        const result = event as ClaudeResultEvent
                        lastUsage = {
                            inputTokens: 0,
                            outputTokens: 0,
                            costUsd: result.total_cost_usd,
                            durationMs: result.duration_ms,
                        }
                        // Try to extract token counts from usage object
                        if (result.usage) {
                            const u = result.usage as Record<string, unknown>
                            if (typeof u.input_tokens === "number") lastUsage.inputTokens = u.input_tokens
                            if (typeof u.output_tokens === "number") lastUsage.outputTokens = u.output_tokens
                            if (typeof u.cache_read_input_tokens === "number") lastUsage.cacheReadTokens = u.cache_read_input_tokens
                            if (typeof u.cache_creation_input_tokens === "number") lastUsage.cacheWriteTokens = u.cache_creation_input_tokens
                        }
                    }

                    // Always yield the raw message
                    events.push({ type: "message", message: event })

                    // Yield complete after result
                    if (event.type === "result") {
                        events.push({ type: "complete", usage: lastUsage })
                    }

                    return events
                },
                onExit: (code, stderr) => {
                    if (q.signal.aborted) return null
                    if (code !== null && code !== 0 && !lastUsage) {
                        // Process crashed without a result event
                        return {
                            type: "error",
                            error: stderr.trim() || `Claude process exited with code ${code}`,
                            code: "process_crashed",
                        }
                    }
                    return null
                },
            })
        } finally {
            // ── Cleanup ──
            if (toolServerHandle) {
                try {
                    await toolServerHandle.stop()
                } catch {
                    // Ignore cleanup errors
                }
            }

            for (const item of cleanup) {
                try {
                    if (item.type === "file") {
                        await unlink(item.path)
                    } else {
                        await rm(item.path, { recursive: true, force: true })
                    }
                } catch {
                    // Ignore cleanup errors
                }
            }
        }
    }

    private async resolveBinary(): Promise<string | undefined> {
        if (this.config.binaryPath) return this.config.binaryPath
        return resolveExecutable("claude")
    }
}
