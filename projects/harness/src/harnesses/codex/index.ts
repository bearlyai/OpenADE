import { unlink, rm } from "node:fs/promises"
import { execFileSync, spawnSync } from "node:child_process"

import type { Harness } from "../../harness.js"
import type {
    HarnessMeta,
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
import { buildCodexArgs, type CodexHarnessConfig } from "./args.js"
import { buildCodexMcpConfigOverrides } from "./config-overrides.js"
import { calculateCostUsd } from "./pricing.js"
import { parseCodexEvent, type CodexEvent, type CodexTurnCompletedEvent } from "./types.js"

export type { CodexHarnessConfig } from "./args.js"
export type { CodexEvent } from "./types.js"

export class CodexHarness implements Harness<CodexEvent> {
    readonly id = "codex"
    private config: CodexHarnessConfig

    constructor(config?: CodexHarnessConfig) {
        this.config = config ?? {}
    }

    meta(): HarnessMeta {
        return {
            id: "codex",
            name: "Codex",
            vendor: "OpenAI",
            website: "https://openai.com/index/introducing-codex/",
        }
    }

    capabilities(): HarnessCapabilities {
        return {
            supportsSystemPrompt: false,
            supportsAppendSystemPrompt: false,
            supportsReadOnly: true,
            supportsMcp: true,
            supportsResume: true,
            supportsFork: false,
            supportsClientTools: true,
            supportsStreamingTokens: false,
            supportsCostTracking: true,
            supportsNamedTools: false,
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
                authInstructions: "Install Codex CLI: npm install -g @openai/codex",
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

        // Check auth status — codex writes login status to stderr
        let authenticated = false
        try {
            const result = spawnSync(binaryPath, ["login", "status"], {
                encoding: "utf-8",
                timeout: 10000,
                stdio: ["pipe", "pipe", "pipe"],
            })
            const combined = (result.stdout ?? "") + (result.stderr ?? "")
            authenticated = /logged in/i.test(combined)
        } catch {
            // login status failed or returned non-zero — not authenticated
        }

        return {
            installed: true,
            version,
            authType: "account",
            authenticated,
            authInstructions: authenticated ? undefined : "Run `codex login` to authenticate",
        }
    }

    async discoverSlashCommands(_cwd: string): Promise<SlashCommand[]> {
        // Codex has no slash command system
        return []
    }

    async *query(q: HarnessQuery): AsyncGenerator<HarnessEvent<CodexEvent>> {
        const binaryPath = await this.resolveBinary()
        if (!binaryPath) {
            throw new HarnessNotInstalledError("codex", "Install Codex CLI: npm install -g @openai/codex")
        }

        let toolServerHandle: ToolServerHandle | undefined
        const cleanup: Array<{ path: string; type: "file" | "dir" }> = []

        try {
            // ── Build effective MCP server map ──
            const effectiveMcpServers: Record<string, McpServerConfig> = {
                ...(q.mcpServers ?? {}),
            }

            if (q.clientTools && q.clientTools.length > 0) {
                toolServerHandle = await startToolServer(q.clientTools)
                effectiveMcpServers[toolServerHandle.serverName] = toolServerHandle.mcpServer
            }

            // ── Build MCP config overrides ──
            let mcpConfigArgs: string[] | undefined
            const env: Record<string, string> = {}

            if (Object.keys(effectiveMcpServers).length > 0) {
                const overrides = buildCodexMcpConfigOverrides(effectiveMcpServers)
                mcpConfigArgs = overrides.configArgs
                Object.assign(env, overrides.env)
            }

            if (toolServerHandle?.env) {
                Object.assign(env, toolServerHandle.env)
            }

            // ── Build args ──
            const buildResult = buildCodexArgs(q, this.config, mcpConfigArgs)
            Object.assign(env, buildResult.env)
            cleanup.push(...buildResult.cleanup)

            // ── Track wall-clock time ──
            const startTime = Date.now()
            let lastUsage: CodexTurnCompletedEvent["usage"] | undefined

            // ── Spawn and stream ──
            yield* spawnJsonl<CodexEvent>({
                command: binaryPath,
                args: buildResult.args,
                cwd: buildResult.cwd,
                env,
                signal: q.signal,
                parseLine: (line) => {
                    let parsed: unknown
                    try {
                        parsed = JSON.parse(line)
                    } catch {
                        return null
                    }

                    const event = parseCodexEvent(parsed)
                    if (!event) return null

                    const events: HarnessEvent<CodexEvent>[] = []

                    // Extract session_started from thread.started and enrich with query metadata
                    if (event.type === "thread.started") {
                        events.push({ type: "session_started", sessionId: event.thread_id })
                        events.push({
                            type: "message",
                            message: {
                                ...event,
                                session_id: event.thread_id,
                                cwd: q.cwd,
                                model: q.model,
                                additional_directories: q.additionalDirectories,
                            },
                        })
                    }

                    // Stash usage from turn.completed
                    if (event.type === "turn.completed") {
                        lastUsage = event.usage
                    }

                    // Map failure events
                    if (event.type === "turn.failed") {
                        events.push({
                            type: "error",
                            error: event.error.message ?? "Turn failed",
                            code: "unknown",
                        })
                    }

                    if (event.type === "error") {
                        events.push({
                            type: "error",
                            error: event.message,
                            code: "unknown",
                        })
                    }

                    // Always yield the raw message (thread.started is already enriched above)
                    if (event.type !== "thread.started") {
                        events.push({ type: "message", message: event })
                    }

                    return events
                },
                onExit: (code, stderr) => {
                    if (q.signal.aborted) return null

                    const durationMs = Date.now() - startTime

                    if (code === 0 || lastUsage) {
                        const inputTokens = lastUsage?.input_tokens ?? 0
                        const outputTokens = lastUsage?.output_tokens ?? 0
                        const cacheReadTokens = lastUsage?.cached_input_tokens
                        const usage: HarnessUsage = {
                            inputTokens,
                            outputTokens,
                            cacheReadTokens,
                            costUsd: calculateCostUsd(q.model, inputTokens, outputTokens, cacheReadTokens),
                            durationMs,
                        }
                        return { type: "complete", usage }
                    }

                    if (code !== null && code !== 0) {
                        return {
                            type: "error",
                            error: stderr.trim() || `Codex process exited with code ${code}`,
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
        return resolveExecutable("codex")
    }
}
