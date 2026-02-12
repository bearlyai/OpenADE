// ============================================================================
// CodexEvent — types for Codex CLI --json JSONL output
// ============================================================================

export type CodexEvent =
    | CodexThreadStartedEvent
    | CodexTurnStartedEvent
    | CodexTurnCompletedEvent
    | CodexTurnFailedEvent
    | CodexItemStartedEvent
    | CodexItemCompletedEvent
    | CodexErrorEvent

export interface CodexThreadStartedEvent {
    type: "thread.started"
    thread_id: string
}

export interface CodexTurnStartedEvent {
    type: "turn.started"
}

export interface CodexTurnCompletedEvent {
    type: "turn.completed"
    usage: CodexUsage
}

export interface CodexTurnFailedEvent {
    type: "turn.failed"
    error: { message?: string; [key: string]: unknown }
}

export interface CodexItemStartedEvent {
    type: "item.started"
    item: CodexItem
}

export interface CodexItemCompletedEvent {
    type: "item.completed"
    item: CodexItem
}

export interface CodexErrorEvent {
    type: "error"
    message: string
}

export interface CodexUsage {
    input_tokens: number
    cached_input_tokens: number
    output_tokens: number
}

export type CodexItem = CodexReasoningItem | CodexAgentMessageItem | CodexCommandExecutionItem

export interface CodexReasoningItem {
    id: string
    type: "reasoning"
    text: string
}

export interface CodexAgentMessageItem {
    id: string
    type: "agent_message"
    text: string
}

export interface CodexCommandExecutionItem {
    id: string
    type: "command_execution"
    command: string
    aggregated_output: string
    exit_code: number | null
    status: "in_progress" | "completed"
}

// ============================================================================
// Parser
// ============================================================================

const KNOWN_TOP_TYPES = new Set<string>(["thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.completed", "error"])

/**
 * Parses a raw JSON object into a typed CodexEvent.
 * Returns null for unknown event types (forward-compatible).
 */
export function parseCodexEvent(json: unknown): CodexEvent | null {
    if (!json || typeof json !== "object") return null

    const obj = json as Record<string, unknown>
    const type = obj.type as string | undefined

    if (!type) return null

    // Known types are parsed directly
    if (KNOWN_TOP_TYPES.has(type)) {
        return obj as unknown as CodexEvent
    }

    // Unknown types — return null (forward-compatible)
    return null
}
