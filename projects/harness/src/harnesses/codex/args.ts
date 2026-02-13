import type { HarnessQuery, PromptPart } from "../../types.js"

export interface CodexHarnessConfig {
    binaryPath?: string
    tempDir?: string
}

export interface CodexArgBuildResult {
    command: string
    args: string[]
    env: Record<string, string>
    cwd?: string
    /** Temp files/dirs that need cleanup */
    cleanup: Array<{ path: string; type: "file" | "dir" }>
}

const THINKING_EFFORT_MAP: Record<string, string> = {
    low: "low",
    med: "medium",
    high: "xhigh",
}

/**
 * Builds CLI arguments for the `codex` binary from a HarnessQuery.
 */
export function buildCodexArgs(query: HarnessQuery, _config: CodexHarnessConfig, mcpConfigArgs?: string[]): CodexArgBuildResult {
    const rootArgs: string[] = []
    const execArgs: string[] = []
    const env: Record<string, string> = {}
    const cleanup: Array<{ path: string; type: "file" | "dir" }> = []

    // ── Root-level flags (before exec subcommand) ──

    // Permissions / mode
    if (query.mode === "read-only") {
        rootArgs.push("-a", "on-request")
    } else if (query.mode === "yolo") {
        rootArgs.push("--yolo")
    }

    // ── Subcommand ──
    if (query.resumeSessionId) {
        rootArgs.push("exec", "resume")
    } else {
        rootArgs.push("exec")
    }

    // ── Exec-level flags ──

    // Always JSON output
    execArgs.push("--json")

    // `codex exec resume` only accepts: --json [SESSION_ID] [PROMPT]
    // All other exec-level flags are only valid for `codex exec`
    if (!query.resumeSessionId) {
        // Sandbox for read-only
        if (query.mode === "read-only") {
            execArgs.push("--sandbox", "read-only")
        }

        // Model
        if (query.model) {
            execArgs.push("-m", query.model)
        }

        // Working directory
        if (query.cwd) {
            execArgs.push("-C", query.cwd)
        }

        // Additional directories
        if (query.additionalDirectories) {
            for (const dir of query.additionalDirectories) {
                execArgs.push("--add-dir", dir)
            }
        }

        // Thinking / reasoning effort
        if (query.thinking) {
            const effort = THINKING_EFFORT_MAP[query.thinking]
            if (effort) {
                execArgs.push("-c", `model_reasoning_effort=${effort}`)
            }
        }

        // MCP config overrides (passed through from the harness class)
        if (mcpConfigArgs) {
            for (const arg of mcpConfigArgs) {
                execArgs.push("-c", arg)
            }
        }
    }

    // Fork session warning
    if (query.forkSession) {
        console.warn("[codex-harness] forkSession is not supported in Codex JSON mode. Ignoring.")
    }

    // ── Build prompt ──
    let promptText = resolvePromptText(query.prompt)

    // System prompt → prepend to user prompt (Codex has no native system prompt)
    const systemPrompt = query.systemPrompt ?? query.appendSystemPrompt
    if (systemPrompt) {
        promptText = `<system-instructions>\n${systemPrompt}\n</system-instructions>\n\n${promptText}`
    }

    // ── Session ID (for resume) or prompt as positional args ──
    if (query.resumeSessionId) {
        execArgs.push(query.resumeSessionId, promptText)
    } else {
        execArgs.push(promptText)
    }

    // Merge query env
    if (query.env) {
        Object.assign(env, query.env)
    }

    // Note: allowedTools and disallowedTools are ignored for Codex (no named tools)

    return {
        command: "codex",
        args: [...rootArgs, ...execArgs],
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
