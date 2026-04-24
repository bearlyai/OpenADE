import { MODEL_REGISTRY } from "../../models.js"
import type { HarnessQuery, PromptPart } from "../../types.js"

export interface ClaudeCodeHarnessConfig {
    binaryPath?: string
    disableTelemetry?: boolean
    forceSubagentModel?: boolean
    settingSources?: string[]
}

export interface ClaudeArgBuildResult {
    args: string[]
    /** Raw prompt text to write to stdin (text-only prompt transport). */
    stdinData?: string
    env: Record<string, string>
    cwd: string
    /** Temp files/dirs that need cleanup after the process exits */
    cleanup: Array<{ path: string; type: "file" | "dir" }>
    /** When set, these lines must be written to the process stdin */
    stdinLines?: string[]
}

/** Tools that are always disallowed when disablePlanningTools is set */
const PLANNING_TOOLS = ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode", "Task(Plan)"]

/** Tools that are disallowed in read-only mode */
const READ_ONLY_DISALLOWED_TOOLS = ["Edit", "Write", "NotebookEdit"]

/** Tools that are auto-approved in read-only mode (via --allowedTools) */
const READ_ONLY_ALLOWED_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"]

/** Bash command patterns that are safe for read-only mode.
 *  Many commands need both a no-arg variant and a wildcard variant because
 *  the glob `*` requires at least one character after the trailing space. */
const READ_ONLY_ALLOWED_BASH_PATTERNS = [
    // Git read commands
    "Bash(git status)",
    "Bash(git status *)",
    "Bash(git log)",
    "Bash(git log *)",
    "Bash(git diff)",
    "Bash(git diff *)",
    "Bash(git show)",
    "Bash(git show *)",
    "Bash(git branch)",
    "Bash(git branch *)",
    "Bash(git tag)",
    "Bash(git tag *)",
    "Bash(git remote)",
    "Bash(git remote *)",
    "Bash(git rev-parse *)",
    "Bash(git describe)",
    "Bash(git describe *)",
    "Bash(git blame *)",
    "Bash(git shortlog)",
    "Bash(git shortlog *)",
    "Bash(git stash list)",
    "Bash(git stash list *)",
    "Bash(git ls-files)",
    "Bash(git ls-files *)",
    "Bash(git ls-tree *)",
    "Bash(git cat-file *)",
    // Filesystem read commands
    "Bash(ls)",
    "Bash(ls *)",
    "Bash(cat *)",
    "Bash(head *)",
    "Bash(tail *)",
    "Bash(find *)",
    "Bash(tree)",
    "Bash(tree *)",
    "Bash(file *)",
    "Bash(wc *)",
    "Bash(du)",
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
    "Bash(printenv)",
    "Bash(printenv *)",
    "Bash(uname)",
    "Bash(uname *)",
    "Bash(whoami)",
    "Bash(date)",
    "Bash(date *)",
    "Bash(node --version)",
    "Bash(npm --version)",
    "Bash(python --version)",
    "Bash(python3 --version)",
    "Bash(cargo --version)",
    "Bash(go version)",
    "Bash(rustc --version)",
    // Build/dependency inspection (read-only)
    "Bash(npm ls)",
    "Bash(npm ls *)",
    "Bash(npm list)",
    "Bash(npm list *)",
    "Bash(npm info *)",
    "Bash(npm view *)",
    "Bash(cargo tree)",
    "Bash(cargo tree *)",
    "Bash(pip list)",
    "Bash(pip list *)",
    "Bash(pip show *)",
    // Process/system info
    "Bash(ps)",
    "Bash(ps *)",
    "Bash(df)",
    "Bash(df *)",
    // gh read commands
    "Bash(gh pr view)",
    "Bash(gh pr view *)",
    "Bash(gh pr list)",
    "Bash(gh pr list *)",
    "Bash(gh pr diff)",
    "Bash(gh pr diff *)",
    "Bash(gh pr checks)",
    "Bash(gh pr checks *)",
    "Bash(gh pr status)",
    "Bash(gh pr status *)",
    "Bash(gh issue view)",
    "Bash(gh issue view *)",
    "Bash(gh issue list)",
    "Bash(gh issue list *)",
    "Bash(gh run list)",
    "Bash(gh run list *)",
    "Bash(gh run view)",
    "Bash(gh run view *)",
    "Bash(gh repo view)",
    "Bash(gh repo view *)",
    "Bash(gh release list)",
    "Bash(gh release list *)",
    "Bash(gh release view)",
    "Bash(gh release view *)",
    "Bash(gh api *)",
]

const THINKING_EFFORT_MAP: Record<string, string> = {
    low: "low",
    med: "medium",
    high: "high",
    max: "max",
}

function getSubagentModelOverride(model: string | undefined): string | undefined {
    if (!model) return undefined

    const rollingAlias = MODEL_REGISTRY["claude-code"].models.find((entry) => entry.id === model && entry.fullId === model)
    if (rollingAlias) {
        return undefined
    }

    return model
}

function hasConfiguredMcp(query: HarnessQuery): boolean {
    const hasExternalMcp = !!query.mcpServers && Object.keys(query.mcpServers).length > 0
    const hasClientTools = !!query.clientTools && query.clientTools.length > 0
    const hasUserPromptHandler = !!query.userPromptHandler
    return hasExternalMcp || hasClientTools || hasUserPromptHandler
}

function getReadOnlyAllowedMcpToolPatterns(query: HarnessQuery): string[] {
    const serverNames = new Set<string>()
    if (query.mcpServers) {
        for (const name of Object.keys(query.mcpServers)) {
            serverNames.add(name)
        }
    }
    if ((query.clientTools && query.clientTools.length > 0) || query.userPromptHandler) {
        // startToolServer() registers client tools (including the injected user prompt tool)
        // under this fixed MCP server name.
        serverNames.add("harness_client_tools")
    }
    return Array.from(serverNames).map((name) => `mcp__${name}__*`)
}

/**
 * Builds CLI arguments for the `claude` binary from a HarnessQuery.
 */
export function buildClaudeArgs(query: HarnessQuery, config: ClaudeCodeHarnessConfig): ClaudeArgBuildResult {
    const args: string[] = []
    const env: Record<string, string> = {}
    const cleanup: Array<{ path: string; type: "file" | "dir" }> = []

    // ── Prompt ──
    // -p is a boolean flag (non-interactive / print mode).
    // For text-only prompts, the prompt is sent through stdin.
    // For multimodal prompts (with images), we use --input-format stream-json
    // and send the content via stdin as NDJSON.
    const transport = resolvePromptTransport(query.prompt)
    args.push("-p")

    if (transport.kind === "stream-json") {
        args.push("--input-format", "stream-json")
    }

    // ── Always-present flags ──
    args.push("--output-format", "stream-json")
    args.push("--verbose")

    // ── Setting sources ──
    const settingSources = config.settingSources ?? ["user", "project", "local"]
    args.push("--setting-sources", settingSources.join(","))

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

    // ── Structured output ──
    if (query.outputSchema) {
        args.push("--json-schema", JSON.stringify(query.outputSchema))
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
        if (hasConfiguredMcp(query)) {
            // MCP tool names are namespaced as: mcp__<server_name>__<tool_name>
            allowedTools.push(...getReadOnlyAllowedMcpToolPatterns(query))
        }
    }

    if (query.disablePlanningTools) {
        disallowedTools.push(...PLANNING_TOOLS)
    }

    if (query.userPromptHandler) {
        // Disable built-in AskUserQuestion so it doesn't compete with the MCP ask_user tool.
        // In non-interactive -p mode, AskUserQuestion is auto-denied, but the model still
        // prefers it over the MCP tool. Disabling it forces the model to use our handler.
        disallowedTools.push("AskUserQuestion")
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
    const subagentModel = getSubagentModelOverride(query.model)
    if (forceSubagentModel && subagentModel) {
        // Rolling aliases like "opus" work for --model but are rejected in
        // ANTHROPIC_DEFAULT_*_MODEL env vars by newer Claude Code versions.
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = subagentModel
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = subagentModel
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = subagentModel
        env.CLAUDE_CODE_SUBAGENT_MODEL = subagentModel
    }

    // Merge query env
    if (query.env) {
        Object.assign(env, query.env)
    }

    return {
        args,
        stdinData: transport.kind === "stdin-text" ? transport.stdinData : undefined,
        env,
        cwd: query.cwd,
        cleanup,
        stdinLines: transport.kind === "stream-json" ? transport.stdinLines : undefined,
    }
}

type PromptTransport = { kind: "stdin-text"; stdinData: string } | { kind: "stream-json"; stdinLines: string[] }

function resolvePromptTransport(prompt: string | PromptPart[]): PromptTransport {
    if (typeof prompt === "string") {
        return { kind: "stdin-text", stdinData: prompt }
    }

    const hasImages = prompt.some((p) => p.type === "image")

    if (!hasImages) {
        // Text-only: use raw stdin text
        const text = prompt
            .filter((p): p is Extract<PromptPart, { type: "text" }> => p.type === "text")
            .map((p) => p.text)
            .join("\n")
        return { kind: "stdin-text", stdinData: text }
    }

    // Build Anthropic-format content blocks for stream-json input
    const content: unknown[] = []
    for (const part of prompt) {
        if (part.type === "text") {
            content.push({ type: "text", text: part.text })
        } else if (part.type === "image" && part.source.kind === "base64") {
            content.push({
                type: "image",
                source: {
                    type: "base64",
                    media_type: part.source.mediaType,
                    data: part.source.data,
                },
            })
        }
    }

    const userMessage = JSON.stringify({
        type: "user",
        message: { role: "user", content },
        session_id: "default",
        parent_tool_use_id: null,
    })

    return { kind: "stream-json", stdinLines: [userMessage] }
}
