// ============================================================================
// CodexEvent — types for Codex CLI --json JSONL output
// ============================================================================

export type CodexEvent =
    | CodexThreadStartedEvent
    | CodexTurnStartedEvent
    | CodexTurnCompletedEvent
    | CodexTurnFailedEvent
    | CodexItemStartedEvent
    | CodexItemUpdatedEvent
    | CodexItemCompletedEvent
    | CodexErrorEvent
    | CodexRawJsonEvent

export interface CodexThreadStartedEvent {
    type: "thread.started"
    thread_id: string
    // Enriched by harness (not emitted by Codex CLI)
    session_id?: string
    cwd?: string
    model?: string
    additional_directories?: string[]
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

export interface CodexItemUpdatedEvent {
    type: "item.updated"
    item: CodexItem
}

export interface CodexErrorEvent {
    type: "error"
    message: string
}

export interface CodexRawJsonEvent {
    type: "raw_json"
    original_type?: string
    raw: Record<string, unknown>
}

export interface CodexUsage {
    input_tokens: number
    cached_input_tokens: number
    output_tokens: number
}

export type CodexItem =
    | CodexReasoningItem
    | CodexAgentMessageItem
    | CodexCommandExecutionItem
    | CodexFileChangeItem
    | CodexTodoListItem
    | CodexErrorItem
    | CodexUnsupportedItem

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
    status: "in_progress" | "completed" | "failed" | "declined" | string
}

export interface CodexFileChangeItem {
    id: string
    type: "file_change"
    changes: CodexFileChange[]
    status: "in_progress" | "completed" | "failed" | "declined" | string
}

export interface CodexFileChange {
    path: string
    kind: "add" | "delete" | "update" | string
    diff?: string
}

export interface CodexTodoListItem {
    id: string
    type: "todo_list"
    items: Array<{ text: string; completed: boolean }>
}

export interface CodexErrorItem {
    id: string
    type: "error"
    message: string
}

export interface CodexUnsupportedItem {
    id: string
    type: "unsupported"
    original_type?: string
    raw: Record<string, unknown>
}

// ============================================================================
// Parser
// ============================================================================

const KNOWN_TOP_TYPES = new Set<string>([
    "thread.started",
    "turn.started",
    "turn.completed",
    "turn.failed",
    "item.started",
    "item.updated",
    "item.completed",
    "error",
])

const KNOWN_ITEM_TYPES = new Set<string>(["reasoning", "agent_message", "command_execution", "file_change", "todo_list", "error"])

/**
 * Parses a raw JSON object into a typed CodexEvent.
 * Preserves unknown event types as raw_json so consumers can surface them.
 */
export function parseCodexEvent(json: unknown): CodexEvent | null {
    if (!json || typeof json !== "object") return null

    const obj = json as Record<string, unknown>
    const type = obj.type as string | undefined

    if (!type) return null

    if ((type === "item.started" || type === "item.updated" || type === "item.completed") && obj.item && typeof obj.item === "object") {
        return {
            ...obj,
            item: parseCodexItem(obj.item),
        } as unknown as CodexEvent
    }

    // Known types are parsed directly
    if (KNOWN_TOP_TYPES.has(type)) {
        return obj as unknown as CodexEvent
    }

    return {
        type: "raw_json",
        original_type: type,
        raw: obj,
    }
}

function parseCodexItem(item: object): CodexItem {
    const obj = item as Record<string, unknown>
    const type = obj.type as string | undefined

    if (type && KNOWN_ITEM_TYPES.has(type)) {
        return obj as unknown as CodexItem
    }

    return {
        id: typeof obj.id === "string" ? obj.id : "",
        type: "unsupported",
        original_type: type,
        raw: obj,
    }
}
