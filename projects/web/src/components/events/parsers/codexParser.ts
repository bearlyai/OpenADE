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

import type { CodexEvent, CodexItem, CodexTurnCompletedEvent, CodexTurnFailedEvent, CodexErrorEvent } from "@openade/harness"
import type { MessageGroup } from "../messageGroups"

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

        // item.started — only process if no corresponding item.completed exists
        if (msg.type === "item.started") {
            if (completedItemIds.has(msg.item.id)) continue
            pushItemGroup(groups, msg.item, i, true)
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

        // turn.started — no visual representation
    }

    return groups
}

/** Convert a CodexItem into the appropriate MessageGroup and push it. */
function pushItemGroup(groups: MessageGroup[], item: CodexItem, messageIndex: number, isPending: boolean): void {
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
    }
}
