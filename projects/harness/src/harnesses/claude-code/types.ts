// ============================================================================
// ClaudeEvent — types for Claude CLI --output-format stream-json --verbose
// ============================================================================

export type ClaudeEvent =
    | ClaudeSystemInitEvent
    | ClaudeSystemStatusEvent
    | ClaudeSystemCompactBoundaryEvent
    | ClaudeSystemHookStartedEvent
    | ClaudeSystemHookProgressEvent
    | ClaudeSystemHookResponseEvent
    | ClaudeSystemTaskNotificationEvent
    | ClaudeSystemFilesPersistedEvent
    | ClaudeAssistantEvent
    | ClaudeUserEvent
    | ClaudeResultEvent
    | ClaudeToolProgressEvent
    | ClaudeToolUseSummaryEvent
    | ClaudeAuthStatusEvent

// ── system:init ──
export interface ClaudeSystemInitEvent {
    type: "system"
    subtype: "init"
    model: string
    tools: string[]
    mcp_servers: { name: string; status: string }[]
    session_id: string
    slash_commands: string[]
    skills: string[]
    plugins: { name: string; path: string }[]
}

// ── system:status ──
export interface ClaudeSystemStatusEvent {
    type: "system"
    subtype: "status"
    status: string | null
}

// ── system:compact_boundary ──
export interface ClaudeSystemCompactBoundaryEvent {
    type: "system"
    subtype: "compact_boundary"
    compact_metadata: { trigger: string; pre_tokens: number }
}

// ── system:hook_started ──
export interface ClaudeSystemHookStartedEvent {
    type: "system"
    subtype: "hook_started"
    hook_name: string
    hook_event: string
}

// ── system:hook_progress ──
export interface ClaudeSystemHookProgressEvent {
    type: "system"
    subtype: "hook_progress"
    hook_name: string
    content: string
}

// ── system:hook_response ──
export interface ClaudeSystemHookResponseEvent {
    type: "system"
    subtype: "hook_response"
    hook_name: string
    hook_event: string
    outcome: string
}

// ── system:task_notification ──
export interface ClaudeSystemTaskNotificationEvent {
    type: "system"
    subtype: "task_notification"
    [key: string]: unknown
}

// ── system:files_persisted ──
export interface ClaudeSystemFilesPersistedEvent {
    type: "system"
    subtype: "files_persisted"
    [key: string]: unknown
}

// ── assistant ──
export interface ClaudeAssistantEvent {
    type: "assistant"
    message: {
        id: string
        type: "message"
        role: "assistant"
        content: ClaudeContentBlock[]
        model: string
        stop_reason: string | null
        usage: {
            input_tokens: number
            output_tokens: number
            cache_creation_input_tokens?: number
            cache_read_input_tokens?: number
        }
    }
    uuid: string
    session_id: string
    parent_tool_use_id: string | null
}

export type ClaudeContentBlock =
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }

// ── user (tool results) ──
export interface ClaudeUserEvent {
    type: "user"
    message: {
        role: "user"
        content: ClaudeUserContentBlock[]
    }
    parent_tool_use_id?: string
}

export type ClaudeUserContentBlock = { type: "tool_result"; tool_use_id: string; content: string | unknown[]; is_error?: boolean }

// ── result ──
export interface ClaudeResultEvent {
    type: "result"
    subtype: "success" | "error_during_execution" | "error_max_turns" | "error_tool_use"
    is_error: boolean
    result?: string
    duration_ms: number
    duration_api_ms: number
    total_cost_usd: number
    num_turns: number
    session_id: string
    usage: Record<string, unknown>
    structured_output?: unknown
}

// ── tool_progress ──
export interface ClaudeToolProgressEvent {
    type: "tool_progress"
    tool_use_id: string
    [key: string]: unknown
}

// ── tool_use_summary ──
export interface ClaudeToolUseSummaryEvent {
    type: "tool_use_summary"
    [key: string]: unknown
}

// ── auth_status ──
export interface ClaudeAuthStatusEvent {
    type: "auth_status"
    [key: string]: unknown
}

// ============================================================================
// Parser
// ============================================================================

const KNOWN_SYSTEM_SUBTYPES = new Set<string>([
    "init",
    "status",
    "compact_boundary",
    "hook_started",
    "hook_progress",
    "hook_response",
    "task_notification",
    "files_persisted",
])

const KNOWN_TOP_TYPES = new Set<string>(["system", "assistant", "user", "result", "tool_progress", "tool_use_summary", "auth_status"])

/**
 * Parses a raw JSON object into a typed ClaudeEvent.
 * Returns null for unknown event types (forward-compatible).
 */
export function parseClaudeEvent(json: unknown): ClaudeEvent | null {
    if (!json || typeof json !== "object") return null

    const obj = json as Record<string, unknown>
    const type = obj.type as string | undefined

    if (!type || !KNOWN_TOP_TYPES.has(type)) {
        return null
    }

    if (type === "system") {
        const subtype = obj.subtype as string | undefined
        if (!subtype || !KNOWN_SYSTEM_SUBTYPES.has(subtype)) {
            return null
        }
        // Trust the structure — the CLI output is the source of truth
        return obj as unknown as ClaudeEvent
    }

    return obj as unknown as ClaudeEvent
}
