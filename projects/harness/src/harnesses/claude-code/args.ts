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

/** Tools that are always disallowed when disablePlanningTools is set */
const PLANNING_TOOLS = ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode", "Task(Plan)"]

/** Tools that are disallowed in read-only mode */
const READ_ONLY_DISALLOWED_TOOLS = ["Edit", "Write", "NotebookEdit"]

/** Tools that are auto-approved in read-only mode (via --allowedTools) */
const READ_ONLY_ALLOWED_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"]

/** Bash command patterns that are safe for read-only mode */
const READ_ONLY_ALLOWED_BASH_PATTERNS = [
    // Git read commands
    "Bash(git status *)",
    "Bash(git log *)",
    "Bash(git diff *)",
    "Bash(git show *)",
    "Bash(git branch *)",
    "Bash(git tag *)",
    "Bash(git remote *)",
    "Bash(git rev-parse *)",
    "Bash(git describe *)",
    "Bash(git blame *)",
    "Bash(git shortlog *)",
    "Bash(git stash list *)",
    "Bash(git ls-files *)",
    "Bash(git ls-tree *)",
    "Bash(git cat-file *)",
    // Filesystem read commands
    "Bash(ls *)",
    "Bash(cat *)",
    "Bash(head *)",
    "Bash(tail *)",
    "Bash(find *)",
    "Bash(tree *)",
    "Bash(file *)",
    "Bash(wc *)",
    "Bash(du *)",
    "Bash(stat *)",
    "Bash(realpath *)",
    "Bash(readlink *)",
    // Search commands
    "Bash(grep *)",
    "Bash(rg *)",
    "Bash(ag *)",
    "Bash(ack *)",
    // Info/version commands
    "Bash(which *)",
    "Bash(where *)",
    "Bash(type *)",
    "Bash(echo *)",
    "Bash(pwd)",
    "Bash(env)",
    "Bash(printenv *)",
    "Bash(uname *)",
    "Bash(whoami)",
    "Bash(date *)",
    "Bash(node --version)",
    "Bash(npm --version)",
    "Bash(python --version)",
    "Bash(python3 --version)",
    "Bash(cargo --version)",
    "Bash(go version)",
    "Bash(rustc --version)",
    // Build/dependency inspection (read-only)
    "Bash(npm ls *)",
    "Bash(npm list *)",
    "Bash(npm info *)",
    "Bash(npm view *)",
    "Bash(cargo tree *)",
    "Bash(pip list *)",
    "Bash(pip show *)",
    // Process/system info
    "Bash(ps *)",
    "Bash(df *)",
    // gh read commands
    "Bash(gh pr view *)",
    "Bash(gh pr list *)",
    "Bash(gh pr diff *)",
    "Bash(gh pr checks *)",
    "Bash(gh issue view *)",
    "Bash(gh issue list *)",
    "Bash(gh api *)",
]

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
        // Use dontAsk mode: auto-denies tools unless pre-approved via --allowedTools.
        // This avoids --permission-mode plan which injects unwanted plan-specific
        // system prompts. Read-only Bash patterns are added to allowedTools below.
        args.push("--permission-mode", "dontAsk")
    } else if (query.mode === "yolo") {
        args.push("--dangerously-skip-permissions")
    }

    // ── Tool allow/deny lists ──
    // The harness owns all tool restriction logic. Callers express intent
    // via `mode` and `disablePlanningTools`; specific tool lists are computed here.
    const allowedTools: string[] = []
    const disallowedTools: string[] = []

    if (query.mode === "read-only") {
        // In dontAsk mode, only tools in --allowedTools are auto-approved.
        // Block write tools entirely, and whitelist safe read tools + Bash patterns.
        disallowedTools.push(...READ_ONLY_DISALLOWED_TOOLS)
        allowedTools.push(...READ_ONLY_ALLOWED_TOOLS)
        allowedTools.push(...READ_ONLY_ALLOWED_BASH_PATTERNS)
    }

    if (query.disablePlanningTools) {
        disallowedTools.push(...PLANNING_TOOLS)
    }

    if (allowedTools.length > 0) {
        // Use --allowedTools with each pattern as a separate arg (patterns contain
        // parentheses and spaces, so comma-joining would break parsing).
        args.push("--allowedTools", ...allowedTools)
    }
    if (disallowedTools.length > 0) {
        args.push("--disallowed-tools", disallowedTools.join(","))
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
