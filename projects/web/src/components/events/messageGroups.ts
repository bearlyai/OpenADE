/**
 * Message grouping utility for inline message rendering
 *
 * Groups SDK messages into:
 * - TextGroup: Assistant text messages (rendered as File components)
 * - ToolGroup: Paired tool_use + tool_result (rendered as expandable tabs)
 * - EditGroup: Edit tool calls (rendered as diffs)
 * - BashGroup: Bash commands (rendered as prompt/response)
 * - StderrGroup: stderr output from Claude process
 *
 * Now supports unified ClaudeStreamEvent[] as input (extracts SDKMessages internally).
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { ReactNode } from "react"
import type { ClaudeStreamEvent } from "../../electronAPI/claudeEventTypes"
import { extractSDKMessages } from "../../electronAPI/claudeEventTypes"
import type { ActionEventSource } from "../../types"

// ============================================================================
// Render Mode Types
// ============================================================================

export type RenderMode = "inline" | "row" | "pill"

export interface DisplayContext {
    sourceType: ActionEventSource["type"]
    isLastTextGroup: boolean
}

export interface CommentContext {
    taskId: string
    actionEventId: string
}

export interface GroupRenderer<T> {
    getLabel(group: T): string
    getIcon(group: T): ReactNode
    getStatusIcon?(group: T): ReactNode | null
    getHeaderInfo?(group: T): ReactNode | null
    renderContent(group: T, ctx: CommentContext): ReactNode
}

export interface GroupWithMeta {
    group: MergedGroup
    mode: RenderMode
    id: string
}

export type RenderableItem = { mode: "inline"; item: GroupWithMeta } | { mode: "row"; item: GroupWithMeta } | { mode: "pill"; items: GroupWithMeta[] }

// ============================================================================
// Message Group Types
// ============================================================================

export interface TextGroup {
    type: "text"
    text: string
    messageIndex: number
}

export interface ToolGroup {
    type: "tool"
    toolUseId: string
    toolName: string
    input: unknown
    result?: string
    isError: boolean
    messageIndices: [number, number | undefined]
}

export interface EditGroup {
    type: "edit"
    toolUseId: string
    filePath: string
    oldString: string
    newString: string
    isError: boolean
    isPending: boolean
    errorMessage?: string
    messageIndices: [number, number | undefined]
}

export interface WriteGroup {
    type: "write"
    toolUseId: string
    filePath: string
    content: string
    isError: boolean
    isPending: boolean
    errorMessage?: string
    messageIndices: [number, number | undefined]
}

export interface BashGroup {
    type: "bash"
    toolUseId: string
    command: string
    description?: string
    result?: string
    isError: boolean
    isPending: boolean
    messageIndices: [number, number | undefined]
}

export interface SystemGroup {
    type: "system"
    subtype: "compact_boundary" | "status" | "init" | "hook_response"
    metadata: Record<string, unknown>
    messageIndex: number
}

export interface ResultGroup {
    type: "result"
    subtype: "success" | "error_during_execution" | "error_max_turns" | "error_max_budget_usd" | "error_max_structured_output_retries"
    durationMs: number
    totalCostUsd: number
    usage: { inputTokens: number; outputTokens: number }
    isError: boolean
    result?: string
    errors?: string[]
    messageIndex: number
}

export interface StderrGroup {
    type: "stderr"
    data: string
    eventId: string
}

export interface TodoItem {
    content: string
    status: "pending" | "in_progress" | "completed"
    activeForm: string
}

export interface TodoWriteGroup {
    type: "todoWrite"
    toolUseId: string
    todos: TodoItem[]
    isError: boolean
    isPending: boolean
    messageIndices: [number, number | undefined]
}

export type MessageGroup = TextGroup | ToolGroup | EditGroup | WriteGroup | BashGroup | SystemGroup | ResultGroup | StderrGroup | TodoWriteGroup

/** Extract text content from assistant message */
function getAssistantText(msg: SDKMessage): string | null {
    if (msg.type !== "assistant") return null
    const message = msg as { message?: { content?: unknown } }
    if (!message.message?.content || !Array.isArray(message.message.content)) return null
    const content = message.message.content as Array<{ type: string; text?: string }>
    const text = content
        .filter((block) => block.type === "text")
        .map((block) => block.text || "")
        .join("")
    return text.trim() || null
}

/** Extract tool_use from assistant message */
function getToolUse(msg: SDKMessage): { id: string; name: string; input: unknown } | null {
    if (msg.type !== "assistant") return null
    const message = msg as { message?: { content?: unknown } }
    if (!message.message?.content || !Array.isArray(message.message.content)) return null
    const content = message.message.content as Array<{
        type: string
        id?: string
        name?: string
        input?: unknown
    }>
    const toolUseBlock = content.find((block) => block.type === "tool_use")
    if (!toolUseBlock) return null
    return {
        id: toolUseBlock.id || "unknown",
        name: toolUseBlock.name || "unknown",
        input: toolUseBlock.input,
    }
}

/** Extract tool_result from user message */
function getToolResult(msg: SDKMessage): { toolUseId: string; content: string; isError: boolean } | null {
    if (msg.type !== "user") return null

    // User messages have content nested in message.content (like assistant messages)
    const message = msg as {
        message?: {
            content?: unknown
        }
    }
    if (!message.message?.content) return null

    // Content must be an array to search for tool_result
    if (!Array.isArray(message.message.content)) return null

    const content = message.message.content as Array<{
        type: string
        tool_use_id?: string
        content?: unknown
        is_error?: boolean
    }>
    const toolResultBlock = content.find((block) => block.type === "tool_result")
    if (!toolResultBlock) return null

    // Content can be a string or array of content blocks
    let contentStr: string
    if (typeof toolResultBlock.content === "string") {
        contentStr = toolResultBlock.content
    } else if (Array.isArray(toolResultBlock.content)) {
        contentStr = toolResultBlock.content.map((c: { type: string; text?: string }) => (c.type === "text" ? c.text || "" : JSON.stringify(c))).join("\n")
    } else {
        contentStr = JSON.stringify(toolResultBlock.content)
    }

    return {
        toolUseId: toolResultBlock.tool_use_id || "unknown",
        content: contentStr,
        isError: toolResultBlock.is_error === true,
    }
}

/**
 * Group messages into text and tool groups for inline rendering
 * Internal helper - use groupStreamEvents for the public API.
 */
function groupMessages(messages: SDKMessage[]): MessageGroup[] {
    const groups: MessageGroup[] = []

    // Build a map of tool_use_id → user message index for quick lookup
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

    // Process messages in order
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]

        // Handle system messages
        if (msg.type === "system") {
            const systemMsg = msg as { subtype?: string; status?: string | null; [key: string]: unknown }
            const subtype = systemMsg.subtype as SystemGroup["subtype"] | undefined

            // Skip status messages when status is null (they're meaningless)
            if (subtype === "status" && systemMsg.status === null) {
                continue
            }

            // Only include specific subtypes we want to display
            if (subtype === "compact_boundary" || subtype === "status" || subtype === "init" || subtype === "hook_response") {
                const { type: _type, subtype: _subtype, uuid: _uuid, ...metadata } = systemMsg
                groups.push({
                    type: "system",
                    subtype,
                    metadata,
                    messageIndex: i,
                })
            }
            continue
        }

        // Handle result messages
        if (msg.type === "result") {
            const resultMsg = msg as unknown as {
                subtype: ResultGroup["subtype"]
                duration_ms: number
                total_cost_usd: number
                usage: { input_tokens: number; output_tokens: number }
                is_error: boolean
                result?: string
                errors?: string[]
            }
            groups.push({
                type: "result",
                subtype: resultMsg.subtype,
                durationMs: resultMsg.duration_ms,
                totalCostUsd: resultMsg.total_cost_usd,
                usage: {
                    inputTokens: resultMsg.usage?.input_tokens ?? 0,
                    outputTokens: resultMsg.usage?.output_tokens ?? 0,
                },
                isError: resultMsg.is_error,
                result: resultMsg.result,
                errors: resultMsg.errors,
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
            const text = getAssistantText(msg)
            const toolUse = getToolUse(msg)

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
                    const todos: TodoItem[] = (input.todos || []).map((t) => ({
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
        }
    }

    return groups
}

// MergedGroup is now just MessageGroup - no tool merging needed
// The groupByRenderMode function handles grouping consecutive pills
export type MergedGroup = MessageGroup

/**
 * Group unified stream events into message groups for inline rendering
 *
 * This is the preferred entry point for the unified event system.
 * Extracts SDKMessages from events and also creates StderrGroups for stderr events.
 */
export function groupStreamEvents(events: ClaudeStreamEvent[]): MessageGroup[] {
    // Extract SDK messages and process them using existing logic
    const messages = extractSDKMessages(events)
    const sdkGroups = groupMessages(messages)

    // Extract stderr events and create StderrGroups
    const stderrGroups: StderrGroup[] = events
        .filter((e): e is ClaudeStreamEvent & { type: "stderr"; direction: "execution" } => e.direction === "execution" && e.type === "stderr")
        .map((e) => ({
            type: "stderr" as const,
            data: e.data,
            eventId: e.id,
        }))

    // For now, append stderr at the end (could be interleaved chronologically in future)
    // Interleaving would require tracking event order, which adds complexity
    return [...sdkGroups, ...stderrGroups]
}
