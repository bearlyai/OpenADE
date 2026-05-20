/**
 * Codex event parser
 *
 * Converts typed CodexEvent[] into MessageGroup[] for rendering.
 * Maps Codex items to existing group types:
 *   - reasoning  → ThinkingGroup
 *   - agent_message → TextGroup
 *   - command_execution → BashGroup
 *   - turn.completed → ResultGroup
 *   - turn.failed / error → ResultGroup (error)
 */

import type {
    CodexErrorEvent,
    CodexEvent,
    CodexFileChangeItem,
    CodexItem,
    CodexRawJsonEvent,
    CodexTurnCompletedEvent,
    CodexTurnFailedEvent,
} from "@openade/harness/browser"
import type { MessageGroup, TodoItem, ToolGroup } from "../messageGroups"

type RenderableCodexItemType = Exclude<CodexItem["type"], "unsupported">

const CODEX_ITEM_RENDER_POLICIES = {
    reasoning: "thinking",
    agent_message: "text",
    command_execution: "bash",
    file_change: "fileChange",
    mcp_tool_call: "tool",
    web_search: "tool",
    todo_list: "todoWrite",
    error: "error",
} satisfies Record<RenderableCodexItemType, "thinking" | "text" | "bash" | "fileChange" | "tool" | "todoWrite" | "error">

/**
 * Group Codex messages into MessageGroups for inline rendering.
 *
 * Prefers `item.completed` over `item.started` for the same item ID
 * (completed has final output, exit code, etc.).
 */
export function groupCodexMessages(messages: CodexEvent[], completionUsage?: { costUsd?: number; durationMs?: number }): MessageGroup[] {
    const groups: MessageGroup[] = []

    // Track which item IDs we've seen via item.completed so we can skip
    // their item.started counterparts.
    const completedItemIds = new Set<string>()

    // First pass: collect completed item IDs
    for (const msg of messages) {
        if (msg.type === "item.completed") {
            completedItemIds.add(msg.item.id)
        }
    }

    // Second pass: build groups
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]

        const webSearchGroup = getWebSearchToolGroup(msg, i)
        if (webSearchGroup) {
            groups.push(webSearchGroup)
            continue
        }

        // item.started — only process if no corresponding item.completed exists
        if (msg.type === "item.started") {
            if (completedItemIds.has(msg.item.id)) continue
            pushItemGroup(groups, msg.item, i, true)
            continue
        }

        if (msg.type === "item.updated") {
            if (completedItemIds.has(msg.item.id)) continue
            pushItemGroup(groups, msg.item, i, false)
            continue
        }

        // item.completed — always process
        if (msg.type === "item.completed") {
            pushItemGroup(groups, msg.item, i, false)
            continue
        }

        // turn.completed — result with usage
        if (msg.type === "turn.completed") {
            const tc = msg as CodexTurnCompletedEvent
            groups.push({
                type: "result",
                subtype: "success",
                durationMs: completionUsage?.durationMs ?? 0,
                totalCostUsd: completionUsage?.costUsd ?? 0,
                usage: {
                    inputTokens: tc.usage.input_tokens,
                    outputTokens: tc.usage.output_tokens,
                },
                isError: false,
                messageIndex: i,
            })
            continue
        }

        // turn.failed — error result
        if (msg.type === "turn.failed") {
            const tf = msg as CodexTurnFailedEvent
            groups.push({
                type: "result",
                subtype: "error_during_execution",
                durationMs: 0,
                totalCostUsd: 0,
                usage: { inputTokens: 0, outputTokens: 0 },
                isError: true,
                errors: [tf.error.message ?? "Turn failed"],
                messageIndex: i,
            })
            continue
        }

        // error — top-level error
        if (msg.type === "error") {
            const err = msg as CodexErrorEvent
            groups.push({
                type: "result",
                subtype: "error_during_execution",
                durationMs: 0,
                totalCostUsd: 0,
                usage: { inputTokens: 0, outputTokens: 0 },
                isError: true,
                errors: [err.message],
                messageIndex: i,
            })
            continue
        }

        // thread.started — session init pill
        if (msg.type === "thread.started") {
            const { type: _type, ...metadata } = msg as unknown as Record<string, unknown>
            groups.push({
                type: "system",
                subtype: "init",
                metadata,
                messageIndex: i,
            })
            continue
        }

        if (msg.type === "raw_json") {
            pushCodexUnknownEventGroup(groups, msg, i)
            continue
        }

        // turn.started — no visual representation
    }

    return groups
}

function getWebSearchToolGroup(msg: CodexEvent, messageIndex: number): ToolGroup | null {
    const event = msg as unknown as { type?: unknown; original_type?: unknown; raw?: unknown }
    let raw: Record<string, unknown> | null = null

    if (event.type === "web_search") {
        raw = event as Record<string, unknown>
    } else if (event.type === "raw_json" && event.original_type === "web_search" && event.raw && typeof event.raw === "object") {
        raw = event.raw as Record<string, unknown>
    }

    if (!raw) return null

    return buildWebSearchToolGroup(raw, messageIndex)
}

function buildWebSearchToolGroup(raw: Record<string, unknown>, messageIndex: number): ToolGroup {
    const { type: _type, id: rawId, ...input } = raw
    const toolUseId = typeof rawId === "string" ? rawId : `web-search-${messageIndex}`
    return {
        type: "tool",
        toolUseId,
        toolName: "WebSearch",
        input,
        isError: false,
        messageIndices: [messageIndex, undefined],
    }
}

function buildMcpToolCallGroup(raw: Record<string, unknown>, messageIndex: number): ToolGroup {
    const server = typeof raw.server === "string" ? raw.server : "mcp"
    const tool = typeof raw.tool === "string" ? raw.tool : "tool"
    const error = raw.error && typeof raw.error === "object" ? (raw.error as { message?: unknown }) : undefined
    const result = error?.message ? String(error.message) : raw.result === undefined ? undefined : JSON.stringify(raw.result)

    return {
        type: "tool",
        toolUseId: typeof raw.id === "string" ? raw.id : `mcp-tool-${messageIndex}`,
        toolName: `MCP: ${server}.${tool}`,
        input: raw.arguments,
        result,
        isError: Boolean(error) || raw.status === "failed",
        messageIndices: [messageIndex, undefined],
    }
}

/** Convert a CodexItem into the appropriate MessageGroup and push it. */
function pushItemGroup(groups: MessageGroup[], item: CodexItem, messageIndex: number, isPending: boolean): void {
    const rawItem = item as unknown as { type?: string; original_type?: string; raw?: Record<string, unknown> }
    const renderPolicy = rawItem.type && rawItem.type !== "unsupported" ? CODEX_ITEM_RENDER_POLICIES[rawItem.type as RenderableCodexItemType] : undefined

    if (renderPolicy === "tool" && rawItem.type === "web_search") {
        groups.push(buildWebSearchToolGroup(rawItem as Record<string, unknown>, messageIndex))
        return
    }
    if (renderPolicy === "tool" && rawItem.type === "mcp_tool_call") {
        groups.push(buildMcpToolCallGroup(rawItem as Record<string, unknown>, messageIndex))
        return
    }
    if (rawItem.type === "unsupported" && rawItem.original_type === "web_search" && rawItem.raw) {
        groups.push(buildWebSearchToolGroup(rawItem.raw, messageIndex))
        return
    }
    if (rawItem.type === "unsupported" && rawItem.original_type === "mcp_tool_call" && rawItem.raw) {
        groups.push(buildMcpToolCallGroup(rawItem.raw, messageIndex))
        return
    }

    switch (item.type) {
        case "reasoning":
            groups.push({
                type: "thinking",
                text: item.text,
                messageIndex,
            })
            break

        case "agent_message":
            groups.push({
                type: "text",
                text: item.text,
                messageIndex,
            })
            break

        case "command_execution":
            groups.push({
                type: "bash",
                toolUseId: item.id,
                command: item.command,
                result: item.aggregated_output || undefined,
                isError: item.exit_code !== null && item.exit_code !== 0,
                isPending: isPending || item.status === "in_progress",
                messageIndices: [messageIndex, undefined],
            })
            break

        case "file_change":
            pushFileChangeGroups(groups, item, messageIndex, isPending)
            break

        case "todo_list": {
            const todos: TodoItem[] = item.items.map((todo) => ({
                content: todo.text,
                status: todo.completed ? "completed" : "pending",
                activeForm: todo.text,
            }))
            groups.push({
                type: "todoWrite",
                toolUseId: item.id,
                todos,
                isError: false,
                isPending,
                messageIndices: [messageIndex, undefined],
            })
            break
        }

        case "error":
            groups.push({
                type: "result",
                subtype: "error_during_execution",
                durationMs: 0,
                totalCostUsd: 0,
                usage: { inputTokens: 0, outputTokens: 0 },
                isError: true,
                errors: [item.message],
                messageIndex,
            })
            break

        case "unsupported":
            groups.push({
                type: "unknown",
                harnessId: "codex",
                label: `Unknown Codex item: ${item.original_type ?? "item"}`,
                originalType: item.original_type,
                raw: item.raw,
                messageIndex,
            })
            break
    }
}

function pushCodexUnknownEventGroup(groups: MessageGroup[], event: CodexRawJsonEvent, messageIndex: number): void {
    groups.push({
        type: "unknown",
        harnessId: "codex",
        label: `Unknown Codex event: ${event.original_type ?? "event"}`,
        originalType: event.original_type,
        raw: event.raw,
        messageIndex,
    })
}

function pushFileChangeGroups(groups: MessageGroup[], item: CodexFileChangeItem, messageIndex: number, isPendingEvent: boolean): void {
    const status = item.status.toLowerCase()
    const isPending = isPendingEvent || status === "in_progress" || status === "inprogress"
    const isError = status === "failed" || status === "declined"

    const changes = Array.isArray(item.changes) ? item.changes : []

    changes.forEach((change, changeIndex) => {
        groups.push({
            type: "fileChange",
            toolUseId: item.id,
            filePath: change.path,
            kind: change.kind,
            status: item.status,
            diff: change.diff,
            isError,
            isPending,
            messageIndex,
            changeIndex,
        })
    })
}
