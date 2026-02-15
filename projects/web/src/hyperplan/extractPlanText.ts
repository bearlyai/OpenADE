/**
 * Plan Text Extraction
 *
 * Extracts the final assistant text from a completed execution's stream events.
 * Works for both Claude Code and Codex harnesses.
 */

import type { HarnessId, HarnessRawMessageEvent, HarnessStreamEvent } from "../electronAPI/harnessEventTypes"
import { extractRawMessageEvents } from "../electronAPI/harnessEventTypes"

/**
 * Extract the final plan text from a completed execution's stream events.
 *
 * For Claude Code: Uses the `result` event's `result` field (which contains the final text).
 *   Falls back to concatenating text blocks from the last `assistant` message.
 *
 * For Codex: Concatenates all `agent_message` items from `item.completed` events.
 *
 * Returns null if no text could be extracted.
 */
export function extractPlanText(events: HarnessStreamEvent[], harnessId: HarnessId): string | null {
    const rawMessages = extractRawMessageEvents(events)
    if (rawMessages.length === 0) return null

    switch (harnessId) {
        case "claude-code":
            return extractClaudePlanText(rawMessages)
        case "codex":
            return extractCodexPlanText(rawMessages)
        default:
            return null
    }
}

function extractClaudePlanText(rawMessages: HarnessRawMessageEvent[]): string | null {
    // Prefer the `result` event which has the complete final text
    for (let i = rawMessages.length - 1; i >= 0; i--) {
        const raw = rawMessages[i]
        if (raw.harnessId !== "claude-code") continue
        const msg = raw.message
        if (msg.type === "result" && typeof msg.result === "string" && msg.result.length > 0) {
            return msg.result
        }
    }

    // Fallback: concatenate text blocks from the last assistant message
    for (let i = rawMessages.length - 1; i >= 0; i--) {
        const raw = rawMessages[i]
        if (raw.harnessId !== "claude-code") continue
        const msg = raw.message
        if (msg.type === "assistant") {
            const content = msg.message.content
            if (!content) continue
            const textParts = content.filter((b) => b.type === "text").map((b) => (b as { type: "text"; text: string }).text)
            if (textParts.length > 0) {
                return textParts.join("\n")
            }
        }
    }

    return null
}

function extractCodexPlanText(rawMessages: HarnessRawMessageEvent[]): string | null {
    // Collect all agent_message text from item.completed events
    const textParts: string[] = []

    for (const raw of rawMessages) {
        if (raw.harnessId !== "codex") continue
        const msg = raw.message
        if (msg.type === "item.completed") {
            const item = msg.item
            if (item.type === "agent_message" && typeof item.text === "string") {
                textParts.push(item.text)
            }
        }
    }

    if (textParts.length > 0) {
        return textParts.join("\n")
    }

    return null
}
