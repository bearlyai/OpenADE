/**
 * Title and Slug Generation
 *
 * Provides synchronous slug generation and async title generation via harness execution.
 */

import { getDefaultModelForHarness, getModelFullId, MODEL_REGISTRY } from "../constants"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { getHarnessQueryManager } from "../electronAPI/harnessQuery"
import { extractPlanText } from "../hyperplan/extractPlanText"
import type { CodeEvent } from "../types"

/** Pick a model for title generation, resolved to the full wire ID for the given harness */
function getTitleModel(harnessId: HarnessId): string {
    // Use "sonnet" if available for this harness, otherwise the harness default
    const config = MODEL_REGISTRY[harnessId]
    const hasSonnet = config?.models.some((m) => m.id === "sonnet")
    const alias = hasSonnet ? "sonnet" : getDefaultModelForHarness(harnessId)
    return getModelFullId(alias, harnessId)
}

function generateRandomChars(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    let result = ""
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
}

/** Generate a random slug synchronously - no LLM call needed */
export function generateSlug(): string {
    return `task-${generateRandomChars(8)}`
}

const MAX_CONVERSATION_CONTEXT_CHARS = 2000

/** Build a truncated conversation summary from task events for title generation */
export function buildConversationContext(events: CodeEvent[]): string | null {
    const parts: string[] = []

    for (const event of events) {
        if (event.type !== "action") continue

        if (event.userInput) {
            parts.push(`User: ${event.userInput}`)
        }

        const assistantText = extractPlanText(event.execution.events, event.execution.harnessId)
        if (assistantText) {
            parts.push(`Assistant: ${assistantText}`)
        }
    }

    if (parts.length === 0) return null

    let context = parts.join("\n")
    if (context.length > MAX_CONVERSATION_CONTEXT_CHARS) {
        context = context.slice(0, MAX_CONVERSATION_CONTEXT_CHARS) + "..."
    }
    return context
}

/** Generate a title from description using harness execution */
export async function generateTitle(
    description: string,
    abortController: AbortController,
    harnessId?: HarnessId | string,
    events?: CodeEvent[],
): Promise<string | null> {
    const manager = getHarnessQueryManager()

    let prompt = `Generate a short, descriptive title (3-8 words) for this task:\n\n${description}`

    if (events && events.length > 0) {
        const context = buildConversationContext(events)
        if (context) {
            prompt += `\n\nHere is some of the conversation so far:\n\n${context}`
        }
    }

    const query = await manager.startExecution(prompt, {
        harnessId: (harnessId as HarnessId) ?? "claude-code",
        cwd: "",
        model: getTitleModel((harnessId as HarnessId) ?? "claude-code"),
        mode: "read-only",
        disablePlanningTools: true,
        appendSystemPrompt:
            "You are a title generator. Output a title in this exact format:\n" + "Title: <your 3-8 word title>\n" + "Do not output anything else.",
    })

    if (!query) return null

    const abortHandler = () => query.abort()
    abortController.signal.addEventListener("abort", abortHandler)

    try {
        let lastAgentText: string | null = null

        for await (const msg of query.stream()) {
            // Claude: result event with aggregated text
            const title = extractTitleFromResultEvent(msg)
            if (title) return title

            // Codex: track last agent_message text
            const agentText = extractCodexAgentText(msg)
            if (agentText) lastAgentText = agentText
        }

        // Codex fallback: use last agent message text
        if (lastAgentText) return cleanTitle(lastAgentText)

        return null
    } finally {
        abortController.signal.removeEventListener("abort", abortHandler)
        query.cleanup()
    }
}

/** Extract title from a Claude result event */
function extractTitleFromResultEvent(msg: unknown): string | null {
    const m = msg as Record<string, unknown>
    if (m.type === "result" && typeof m.result === "string" && m.result.trim()) {
        return cleanTitle(m.result)
    }
    return null
}

/** Extract agent message text from a Codex item.completed event */
function extractCodexAgentText(msg: unknown): string | null {
    const m = msg as Record<string, unknown>
    if (m.type === "item.completed") {
        const item = m.item as Record<string, unknown> | undefined
        if (item?.type === "agent_message" && typeof item.text === "string" && item.text.trim()) {
            return item.text
        }
    }
    return null
}

/** Parse and clean a title from LLM text output */
function cleanTitle(raw: string): string {
    const trimmed = raw.trim()
    // Try to extract "Title: <x>" format
    const match = trimmed.match(/^title:\s*(.+)/im)
    if (match) {
        let title = match[1].trim()
        title = title.replace(/^["']|["']$/g, "")
        return title
    }
    // Fallback: take the first non-empty line, strip quotes
    let title = trimmed.split("\n")[0].trim()
    title = title.replace(/^["']|["']$/g, "")
    return title
}

/** Create a fallback title from description (truncated) */
export function fallbackTitle(description: string): string {
    const maxLength = 50
    const cleaned = description.replace(/\s+/g, " ").trim()
    if (cleaned.length <= maxLength) {
        return cleaned
    }
    return cleaned.slice(0, maxLength).trim() + "..."
}
