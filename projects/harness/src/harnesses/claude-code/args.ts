import type { HarnessQuery, PromptPart } from "../../types.js"

export interface ClaudeCodeHarnessConfig {
    binaryPath?: string
    disableTelemetry?: boolean
    forceSubagentModel?: boolean
    settingSources?: string[]
}

export interface ClaudeArgBuildResult {
    args: string[]
    env: Record<string, string>
    cwd: string
    /** Temp files/dirs that need cleanup after the process exits */
    cleanup: Array<{ path: string; type: "file" | "dir" }>
}

const THINKING_EFFORT_MAP: Record<string, string> = {
    low: "low",
    med: "medium",
    high: "high",
}

/**
 * Builds CLI arguments for the `claude` binary from a HarnessQuery.
 */
export function buildClaudeArgs(query: HarnessQuery, config: ClaudeCodeHarnessConfig): ClaudeArgBuildResult {
    const args: string[] = []
    const env: Record<string, string> = {}
    const cleanup: Array<{ path: string; type: "file" | "dir" }> = []

    // ── Prompt ──
    const promptText = resolvePromptText(query.prompt)
    args.push("-p", promptText)

    // ── Always-present flags ──
    args.push("--output-format", "stream-json")
    args.push("--verbose")

    // ── Setting sources ──
    const settingSources = config.settingSources ?? ["user", "project", "local"]
    args.push("--setting-sources", settingSources.join(","))

    // ── System prompt ──
    if (query.systemPrompt) {
        args.push("--system-prompt", query.systemPrompt)
    }
    if (query.appendSystemPrompt) {
        args.push("--append-system-prompt", query.appendSystemPrompt)
    }

    // ── Model ──
    if (query.model) {
        args.push("--model", query.model)
    }

    // ── Thinking / Effort ──
    if (query.thinking) {
        const effort = THINKING_EFFORT_MAP[query.thinking]
        if (effort) {
            args.push("--effort", effort)
        }
    }

    // ── Session ──
    if (query.resumeSessionId) {
        args.push("--resume", query.resumeSessionId)
    }
    if (query.forkSession) {
        args.push("--fork-session")
    }
    // ── Permissions ──
    if (query.mode === "read-only") {
        args.push("--permission-mode", "plan")
    } else if (query.mode === "yolo") {
        args.push("--dangerously-skip-permissions")
    }

    // ── Tool allow/deny lists ──
    if (query.allowedTools && query.allowedTools.length > 0) {
        args.push("--allowed-tools", query.allowedTools.join(","))
    }
    if (query.disallowedTools && query.disallowedTools.length > 0) {
        args.push("--disallowed-tools", query.disallowedTools.join(","))
    }

    // ── Additional directories ──
    if (query.additionalDirectories) {
        for (const dir of query.additionalDirectories) {
            args.push("--add-dir", dir)
        }
    }

    // ── MCP servers ──
    // Note: MCP config file writing is handled by the harness class,
    // which adds --mcp-config and --strict-mcp-config after writing the file.
    // This function only builds the base args.

    // ── Environment variables ──

    // Prevent nested-session detection when the harness itself runs inside Claude Code
    env.CLAUDECODE = ""

    // Telemetry
    const disableTelemetry = config.disableTelemetry ?? true
    if (disableTelemetry) {
        env.DISABLE_TELEMETRY = "1"
        env.DISABLE_ERROR_REPORTING = "1"
    }

    // Subagent model forcing
    const forceSubagentModel = config.forceSubagentModel ?? true
    if (forceSubagentModel && query.model) {
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = query.model
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = query.model
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = query.model
        env.CLAUDE_CODE_SUBAGENT_MODEL = query.model
    }

    // Merge query env
    if (query.env) {
        Object.assign(env, query.env)
    }

    return {
        args,
        env,
        cwd: query.cwd,
        cleanup,
    }
}

function resolvePromptText(prompt: string | PromptPart[]): string {
    if (typeof prompt === "string") return prompt

    return prompt
        .filter((p): p is Extract<PromptPart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("\n")
}
