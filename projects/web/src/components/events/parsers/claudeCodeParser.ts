/**
 * Claude Code message parser
 *
 * Extracts Claude-specific parsing logic from messageGroups.ts.
 * Converts typed ClaudeEvent[] into MessageGroup[] for rendering.
 */

import type { ClaudeAssistantEvent, ClaudeContentBlock, ClaudeEvent, ClaudeResultEvent, ClaudeUserContentBlock, ClaudeUserEvent } from "@openade/harness"
import type { MessageGroup, ResultGroup, SystemGroup, TodoItem } from "../messageGroups"

/** Extract text content from assistant message */
function getAssistantText(msg: ClaudeEvent): string | null {
    if (msg.type !== "assistant") return null
    const { content } = (msg as ClaudeAssistantEvent).message
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

    // Process messages in order
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]

        // Handle system messages
        if (msg.type === "system") {
            const subtype = msg.subtype as SystemGroup["subtype"] | string

            // Skip status messages when status is null (they're meaningless)
            if (subtype === "status" && "status" in msg && msg.status === null) {
                continue
            }

            // Only include specific subtypes we want to display
            if (subtype === "compact_boundary" || subtype === "status" || subtype === "init" || subtype === "hook_response") {
                const { type: _type, subtype: _subtype, ...metadata } = msg as Record<string, unknown>
                groups.push({
                    type: "system",
                    subtype: subtype as SystemGroup["subtype"],
                    metadata,
                    messageIndex: i,
                })
            }
            continue
        }

        // Handle result messages
        if (msg.type === "result") {
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
            const thinking = getThinkingText(msg)
            const text = getAssistantText(msg)
            const toolUse = getToolUse(msg)

            // If has thinking, create thinking group (before text)
            if (thinking) {
                groups.push({
                    type: "thinking",
                    text: thinking,
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
