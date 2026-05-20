// ============================================================================
// CodexEvent — types for Codex CLI --json JSONL output
// ============================================================================

import type { ThreadEvent as CodexSdkThreadEvent, ThreadItem as CodexSdkThreadItem } from "@openai/codex-sdk"

export type CodexEvent =
    | CodexThreadStartedEvent
    | CodexTurnStartedEvent
    | CodexTurnCompletedEvent
    | CodexTurnFailedEvent
    | CodexItemStartedEvent
    | CodexItemUpdatedEvent
    | CodexItemCompletedEvent
    | CodexErrorEvent
    | CodexWebSearchEvent
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

export interface CodexWebSearchEvent {
    type: "web_search"
    id?: string
    query?: string
    action?: {
        type?: string
        query?: string
        queries?: string[]
        [key: string]: unknown
    }
    [key: string]: unknown
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
    | CodexMcpToolCallItem
    | CodexTodoListItem
    | CodexErrorItem
    | CodexWebSearchItem
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

export interface CodexMcpToolCallItem {
    id: string
    type: "mcp_tool_call"
    server: string
    tool: string
    arguments: unknown
    result?: {
        content: unknown[]
        structured_content: unknown
    }
    error?: {
        message: string
    }
    status: "in_progress" | "completed" | "failed" | string
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

export interface CodexWebSearchItem {
    id: string
    type: "web_search"
    query?: string
    action?: {
        type?: string
        query?: string
        queries?: string[]
        [key: string]: unknown
    }
    [key: string]: unknown
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

const CODEX_SDK_TOP_TYPES = {
    "thread.started": true,
    "turn.started": true,
    "turn.completed": true,
    "turn.failed": true,
    "item.started": true,
    "item.updated": true,
    "item.completed": true,
    error: true,
} satisfies Record<CodexSdkThreadEvent["type"], true>

const CODEX_SDK_ITEM_TYPES = {
    reasoning: true,
    agent_message: true,
    command_execution: true,
    file_change: true,
    mcp_tool_call: true,
    web_search: true,
    todo_list: true,
    error: true,
} satisfies Record<CodexSdkThreadItem["type"], true>

const KNOWN_TOP_TYPES = new Set<string>([...Object.keys(CODEX_SDK_TOP_TYPES), "web_search"])

const KNOWN_ITEM_TYPES = new Set<string>(Object.keys(CODEX_SDK_ITEM_TYPES))

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
