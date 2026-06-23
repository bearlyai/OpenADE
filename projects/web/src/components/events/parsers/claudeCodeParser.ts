/**
 * Claude Code message parser
 *
 * Extracts Claude-specific parsing logic from messageGroups.ts.
 * Converts typed ClaudeEvent[] into MessageGroup[] for rendering.
 */

import type {
    ClaudeAssistantEvent,
    ClaudeContentBlock,
    ClaudeEvent,
    ClaudeRawJsonEvent,
    ClaudeResultEvent,
    ClaudeUserContentBlock,
    ClaudeUserEvent,
} from "@openade/harness/browser"
import type { MessageGroup, ResultGroup, SystemGroup, TodoItem, ToolGroup } from "../messageGroups"

/** Extract text content from assistant message */
function getAssistantText(msg: ClaudeEvent): string | null {
    if (msg.type !== "assistant") return null
    const { content } = (msg as ClaudeAssistantEvent).message
    if (!Array.isArray(content)) return null
    const text = content
        .filter((block): block is ClaudeContentBlock & { type: "text" } => block.type === "text")
        .map((block) => block.text)
        .join("")
    return text.trim() || null
}

/** Extract thinking content from assistant message */
function getThinkingText(msg: ClaudeEvent): string | null {
    if (msg.type !== "assistant") return null
    const { content } = (msg as ClaudeAssistantEvent).message
    if (!Array.isArray(content)) return null
    const text = content
        .filter((block): block is ClaudeContentBlock & { type: "thinking" } => block.type === "thinking")
        .map((block) => block.thinking)
        .join("")
    return text.trim() || null
}

/** Extract tool_use from assistant message */
function getToolUse(msg: ClaudeEvent): { id: string; name: string; input: Record<string, unknown> } | null {
    if (msg.type !== "assistant") return null
    const { content } = (msg as ClaudeAssistantEvent).message
    if (!Array.isArray(content)) return null
    const toolUseBlock = content.find((block): block is ClaudeContentBlock & { type: "tool_use" } => block.type === "tool_use")
    if (!toolUseBlock) return null
    return {
        id: toolUseBlock.id,
        name: toolUseBlock.name,
        input: toolUseBlock.input,
    }
}

/** Extract tool_result from user message */
function getToolResult(msg: ClaudeEvent): { toolUseId: string; content: string; isError: boolean } | null {
    if (msg.type !== "user") return null
    const { content } = (msg as ClaudeUserEvent).message
    if (!Array.isArray(content)) return null

    const toolResultBlock = content.find((block): block is ClaudeUserContentBlock & { type: "tool_result" } => block.type === "tool_result")
    if (!toolResultBlock) return null

    // Content can be a string or array of content blocks
    let contentStr: string
    if (typeof toolResultBlock.content === "string") {
        contentStr = toolResultBlock.content
    } else if (Array.isArray(toolResultBlock.content)) {
        contentStr = toolResultBlock.content
            .map((c: unknown) => {
                const block = c as { type: string; text?: string }
                return block.type === "text" ? block.text || "" : JSON.stringify(c)
            })
            .join("\n")
    } else {
        contentStr = JSON.stringify(toolResultBlock.content)
    }

    return {
        toolUseId: toolResultBlock.tool_use_id,
        content: contentStr,
        isError: toolResultBlock.is_error === true,
    }
}

/**
 * Group Claude Code messages into MessageGroups for inline rendering.
 *
 * This is the Claude-specific parser invoked by the harness-agnostic
 * groupStreamEvents in messageGroups.ts.
 */
export function groupClaudeCodeMessages(messages: ClaudeEvent[]): MessageGroup[] {
    const groups: MessageGroup[] = []

    // Build a map of tool_use_id -> user message index for quick lookup
    const toolResultMap = new Map<string, { index: number; content: string; isError: boolean }>()
    for (let i = 0; i < messages.length; i++) {
        const result = getToolResult(messages[i])
        if (result) {
            toolResultMap.set(result.toolUseId, {
                index: i,
                content: result.content,
                isError: result.isError,
            })
        }
    }

    // Peak thinking-token estimate seen since the last thinking group; folded into the next one.
    let pendingThinkingTokens: number | null = null

    // Process messages in order
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]

        if (isIgnoredClaudeTelemetryEvent(msg)) {
            continue
        }

        const thinkingTokens = readThinkingTokensEvent(msg)
        if (thinkingTokens) {
            if (thinkingTokens.estimate !== null) {
                pendingThinkingTokens = Math.max(pendingThinkingTokens ?? 0, thinkingTokens.estimate)
            }
            continue
        }

        const webSearchGroup = getWebSearchToolGroup(msg, i)
        if (webSearchGroup) {
            groups.push(webSearchGroup)
            continue
        }

        const rawJsonSystemGroup = getRawJsonVisibleSystemGroup(msg, i)
        if (rawJsonSystemGroup) {
            groups.push(rawJsonSystemGroup)
            continue
        }

        // Handle system messages
        if (msg.type === "system") {
            const subtype = msg.subtype as SystemGroup["subtype"] | string

            // Skip status messages when status is null (they're meaningless)
            if (subtype === "status" && "status" in msg && msg.status === null) {
                continue
            }

            // Only include specific subtypes we want to display
            if (isVisibleSystemSubtype(subtype)) {
                const { type: _type, subtype: _subtype, ...metadata } = msg as Record<string, unknown>
                groups.push({
                    type: "system",
                    subtype,
                    metadata,
                    messageIndex: i,
                })
            } else {
                pushClaudeUnknownGroup(groups, msg, i)
            }
            continue
        }

        // Handle result messages
        if (msg.type === "result") {
            // Turn boundary: a pending estimate with no thinking group to attach to is stale.
            pendingThinkingTokens = null
            const resultMsg = msg as ClaudeResultEvent
            groups.push({
                type: "result",
                subtype: resultMsg.subtype as ResultGroup["subtype"],
                durationMs: resultMsg.duration_ms,
                totalCostUsd: resultMsg.total_cost_usd,
                usage: {
                    inputTokens: (resultMsg.usage as { input_tokens?: number })?.input_tokens ?? 0,
                    outputTokens: (resultMsg.usage as { output_tokens?: number })?.output_tokens ?? 0,
                },
                isError: resultMsg.is_error,
                result: resultMsg.result,
                errors: (resultMsg as unknown as { errors?: string[] }).errors,
                messageIndex: i,
            })
            continue
        }

        // Skip user messages (they're handled via tool_result pairing)
        if (msg.type === "user") {
            continue
        }

        // Handle assistant messages
        if (msg.type === "assistant") {
            const groupCountBeforeAssistant = groups.length
            // Fold any buffered thinking-token estimate into this turn's thinking group, then clear
            // it so it cannot leak into a later turn that happens to have no thinking of its own.
            const estimatedThinkingTokens = pendingThinkingTokens ?? undefined
            pendingThinkingTokens = null
            const thinking = getThinkingText(msg)
            const text = getAssistantText(msg)
            const toolUse = getToolUse(msg)
            const unknownContentBlocks = getUnknownAssistantContentBlocks(msg)

            // If has thinking, create thinking group (before text)
            if (thinking) {
                groups.push({
                    type: "thinking",
                    text: thinking,
                    estimatedThinkingTokens,
                    messageIndex: i,
                })
            }

            // If has text, create text group
            if (text) {
                groups.push({
                    type: "text",
                    text,
                    messageIndex: i,
                })
            }

            // If has tool use, create appropriate group
            if (toolUse) {
                const result = toolResultMap.get(toolUse.id)

                // Check if this is an Edit tool call
                if (toolUse.name === "Edit") {
                    const input = toolUse.input as {
                        file_path?: string
                        old_string?: string
                        new_string?: string
                    }
                    groups.push({
                        type: "edit",
                        toolUseId: toolUse.id,
                        filePath: input.file_path || "unknown",
                        oldString: input.old_string || "",
                        newString: input.new_string || "",
                        isError: result?.isError ?? false,
                        isPending: result === undefined,
                        errorMessage: result?.isError ? result.content : undefined,
                        messageIndices: [i, result?.index],
                    })
                } else if (toolUse.name === "Write") {
                    // Write tool call - render as diff (empty -> content)
                    const input = toolUse.input as {
                        file_path?: string
                        content?: string
                    }
                    groups.push({
                        type: "write",
                        toolUseId: toolUse.id,
                        filePath: input.file_path || "unknown",
                        content: input.content || "",
                        isError: result?.isError ?? false,
                        isPending: result === undefined,
                        errorMessage: result?.isError ? result.content : undefined,
                        messageIndices: [i, result?.index],
                    })
                } else if (toolUse.name === "Bash") {
                    // Bash tool call - render as prompt/response
                    const input = toolUse.input as {
                        command?: string
                        description?: string
                    }
                    groups.push({
                        type: "bash",
                        toolUseId: toolUse.id,
                        command: input.command || "",
                        description: input.description,
                        result: result?.content,
                        isError: result?.isError ?? false,
                        isPending: result === undefined,
                        messageIndices: [i, result?.index],
                    })
                } else if (toolUse.name === "TodoWrite") {
                    // TodoWrite tool call - render as todo list with completion visualization
                    const input = toolUse.input as {
                        todos?: Array<{
                            content?: string
                            status?: "pending" | "in_progress" | "completed"
                            activeForm?: string
                        }>
                    }
                    const todos: TodoItem[] = (Array.isArray(input.todos) ? input.todos : []).map((t) => ({
                        content: t.content || "",
                        status: t.status || "pending",
                        activeForm: t.activeForm || t.content || "",
                    }))
                    groups.push({
                        type: "todoWrite",
                        toolUseId: toolUse.id,
                        todos,
                        isError: result?.isError ?? false,
                        isPending: result === undefined,
                        messageIndices: [i, result?.index],
                    })
                } else {
                    // Regular tool group
                    groups.push({
                        type: "tool",
                        toolUseId: toolUse.id,
                        toolName: toolUse.name,
                        input: toolUse.input,
                        result: result?.content,
                        isError: result?.isError ?? false,
                        messageIndices: [i, result?.index],
                    })
                }
            }

            if (unknownContentBlocks.length > 0) {
                groups.push({
                    type: "unknown",
                    harnessId: "claude-code",
                    label: "Unknown Claude content",
                    originalType: "assistant.content",
                    raw: unknownContentBlocks,
                    messageIndex: i,
                })
            } else if (groups.length === groupCountBeforeAssistant) {
                if (hasEmptyThinkingBlock(msg)) {
                    groups.push({
                        type: "thinking",
                        text: "Thinking",
                        estimatedThinkingTokens,
                        messageIndex: i,
                    })
                } else if (!hasOnlyEmptyAssistantContent(msg)) {
                    pushClaudeUnknownGroup(groups, msg, i)
                }
            }

            continue
        }

        pushClaudeUnknownGroup(groups, msg, i)
    }

    return groups
}

function getWebSearchToolGroup(msg: ClaudeEvent, messageIndex: number): ToolGroup | null {
    const event = msg as unknown as { type?: unknown; original_type?: unknown; raw?: unknown }
    let raw: Record<string, unknown> | null = null

    if (event.type === "web_search") {
        raw = event as Record<string, unknown>
    } else if (event.type === "raw_json" && event.original_type === "web_search" && event.raw && typeof event.raw === "object") {
        raw = event.raw as Record<string, unknown>
    }

    if (!raw) return null

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

function getRawJsonVisibleSystemGroup(msg: ClaudeEvent, messageIndex: number): SystemGroup | null {
    if (msg.type !== "raw_json") return null
    if (msg.original_type !== "system" || !isVisibleSystemSubtype(msg.original_subtype)) return null

    const { type: _type, subtype: _subtype, ...metadata } = msg.raw
    return {
        type: "system",
        subtype: msg.original_subtype,
        metadata,
        messageIndex,
    }
}

function isVisibleSystemSubtype(subtype: string | undefined): subtype is SystemGroup["subtype"] {
    return (
        subtype === "compact_boundary" ||
        subtype === "status" ||
        subtype === "init" ||
        subtype === "hook_started" ||
        subtype === "hook_progress" ||
        subtype === "hook_response" ||
        subtype === "api_retry" ||
        subtype === "task_started" ||
        subtype === "task_progress" ||
        subtype === "task_notification" ||
        subtype === "task_updated"
    )
}

function isIgnoredClaudeTelemetryEvent(msg: ClaudeEvent): boolean {
    const raw = msg as unknown as {
        type?: unknown
        subtype?: unknown
        original_type?: unknown
        original_subtype?: unknown
    }
    return raw.type === "rate_limit_event" || (raw.type === "raw_json" && raw.original_type === "rate_limit_event")
}

/**
 * thinking_tokens is a streaming estimate the CLI emits roughly every ~100 thinking tokens while the
 * model reasons. It is not transcript content, and it is not a known SDK system subtype, so it
 * arrives as raw_json today (typed system form tolerated for forward-compat). Returns the matched
 * estimate so the caller can fold the peak into the thinking group it precedes; returns null when the
 * event is not a thinking_tokens event at all.
 */
function readThinkingTokensEvent(msg: ClaudeEvent): { estimate: number | null } | null {
    const raw = msg as unknown as {
        type?: unknown
        subtype?: unknown
        original_type?: unknown
        original_subtype?: unknown
        estimated_tokens?: unknown
        raw?: { estimated_tokens?: unknown }
    }
    const isTyped = raw.type === "system" && raw.subtype === "thinking_tokens"
    const isRawJson = raw.type === "raw_json" && raw.original_type === "system" && raw.original_subtype === "thinking_tokens"
    if (!isTyped && !isRawJson) return null

    const value = isTyped ? raw.estimated_tokens : raw.raw?.estimated_tokens
    return { estimate: typeof value === "number" && Number.isFinite(value) ? value : null }
}

function getUnknownAssistantContentBlocks(msg: ClaudeEvent): unknown[] {
    if (msg.type !== "assistant") return []
    const { content } = msg.message
    if (!Array.isArray(content)) return []
    return content.filter((block) => {
        const type = (block as { type?: unknown }).type
        return type !== "text" && type !== "thinking" && type !== "tool_use"
    })
}

function hasOnlyEmptyAssistantContent(msg: ClaudeEvent): boolean {
    if (msg.type !== "assistant") return false
    const { content } = msg.message
    if (!Array.isArray(content)) return false
    if (content.length === 0) return true

    return content.every((block) => {
        const raw = block as { type?: unknown; text?: unknown; thinking?: unknown }
        if (raw.type === "text") return typeof raw.text !== "string" || raw.text.trim() === ""
        if (raw.type === "thinking") return typeof raw.thinking !== "string" || raw.thinking.trim() === ""
        return false
    })
}

function hasEmptyThinkingBlock(msg: ClaudeEvent): boolean {
    if (msg.type !== "assistant") return false
    const { content } = msg.message
    if (!Array.isArray(content)) return false
    return content.some((block) => {
        const raw = block as { type?: unknown; thinking?: unknown }
        return raw.type === "thinking" && (typeof raw.thinking !== "string" || raw.thinking.trim() === "")
    })
}

function pushClaudeUnknownGroup(groups: MessageGroup[], msg: ClaudeEvent, messageIndex: number): void {
    const rawMsg = msg as unknown as Record<string, unknown>
    const rawJson = msg.type === "raw_json" ? (msg as ClaudeRawJsonEvent) : null
    const originalType = rawJson ? formatRawJsonType(rawJson) : formatClaudeType(rawMsg)

    groups.push({
        type: "unknown",
        harnessId: "claude-code",
        label: `Unknown Claude event: ${originalType ?? "event"}`,
        originalType,
        raw: rawJson?.raw ?? msg,
        messageIndex,
    })
}

function formatRawJsonType(event: ClaudeRawJsonEvent): string | undefined {
    if (event.original_type === "system" && event.original_subtype) return `system:${event.original_subtype}`
    return event.original_type
}

function formatClaudeType(raw: Record<string, unknown>): string | undefined {
    const type = typeof raw.type === "string" ? raw.type : undefined
    const subtype = typeof raw.subtype === "string" ? raw.subtype : undefined
    if (type === "system" && subtype) return `system:${subtype}`
    return type
}
