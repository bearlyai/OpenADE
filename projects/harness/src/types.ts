// ============================================================================
// Identifiers
// ============================================================================

export type HarnessId = string // "claude-code" | "codex" | future harnesses

// ============================================================================
// Prompt Content
// ============================================================================

export type PromptPart = { type: "text"; text: string } | { type: "image"; source: ImageSource }

export type ImageSource = { kind: "path"; path: string; mediaType: string } | { kind: "base64"; data: string; mediaType: string }

// ============================================================================
// MCP Server Config
// ============================================================================

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig

export interface McpStdioServerConfig {
    type: "stdio"
    command: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
}

export interface McpHttpServerConfig {
    type: "http"
    url: string
    headers?: Record<string, string>
}

// ============================================================================
// Client Tool Definitions
// ============================================================================

export type JsonSchema = Record<string, unknown>

export interface ClientToolDefinition {
    name: string
    description: string
    inputSchema: JsonSchema
    handler: (args: Record<string, unknown>) => Promise<ClientToolResult>
}

export interface ClientToolResult {
    content?: string
    error?: string
}

// ============================================================================
// HarnessQuery — the normalized input to every harness
// ============================================================================

export interface HarnessQuery {
    // ── Content ──
    prompt: string | PromptPart[]
    systemPrompt?: string
    appendSystemPrompt?: string

    // ── Context ──
    cwd: string
    additionalDirectories?: string[]
    env?: Record<string, string>

    // ── Model ──
    model?: string
    thinking?: "low" | "med" | "high"

    // ── Session ──
    resumeSessionId?: string
    forkSession?: boolean

    // ── Permissions ──
    mode: "read-only" | "yolo"
    allowedTools?: string[]
    disallowedTools?: string[]

    // ── Integrations ──
    mcpServers?: Record<string, McpServerConfig>
    clientTools?: ClientToolDefinition[]

    // ── Control ──
    signal: AbortSignal
}

// ============================================================================
// HarnessEvent — the stream output envelope
// ============================================================================

export type HarnessEvent<M> =
    | { type: "message"; message: M }
    | { type: "session_started"; sessionId: string }
    | { type: "complete"; usage?: HarnessUsage }
    | { type: "error"; error: string; code?: HarnessErrorCode }
    | { type: "stderr"; data: string }

export interface HarnessUsage {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    costUsd?: number
    durationMs?: number
}

export type HarnessErrorCode = "auth_failed" | "not_installed" | "rate_limited" | "context_overflow" | "process_crashed" | "aborted" | "timeout" | "unknown"

// ============================================================================
// Meta & Capabilities
// ============================================================================

export interface HarnessMeta {
    id: HarnessId
    name: string
    vendor: string
    website: string
}

export interface HarnessModel {
    id: string
    label: string
    isDefault?: boolean
}

export interface HarnessInstallStatus {
    installed: boolean
    version?: string
    authType: "api-key" | "account" | "none"
    authenticated: boolean
    authInstructions?: string
}

export interface HarnessCapabilities {
    supportsSystemPrompt: boolean
    supportsAppendSystemPrompt: boolean
    supportsReadOnly: boolean
    supportsMcp: boolean
    supportsResume: boolean
    supportsFork: boolean
    supportsClientTools: boolean
    supportsStreamingTokens: boolean
    supportsCostTracking: boolean
    supportsNamedTools: boolean
    supportsImages: boolean
}

export interface SlashCommand {
    name: string
    type: "skill" | "slash_command"
}
