/**
 * Title and Slug Generation
 *
 * Provides synchronous slug generation and async title generation via Claude Agent SDK.
 */

import { z } from "zod"
import { getHarnessQueryManager } from "../electronAPI/harnessQuery"

const titleSchema = z.object({
    title: z.string().describe("A short, descriptive title for the task (3-8 words)"),
})

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

/** Generate a title from description using harness execution with structured output */
export async function generateTitle(description: string, abortController: AbortController, harnessId?: string): Promise<string | null> {
    // Title generation requires appendSystemPrompt (Claude Code specific).
    // For other harnesses, fall back to truncation.
    if (harnessId && harnessId !== "claude-code") {
        return fallbackTitle(description)
    }

    const manager = getHarnessQueryManager()

    const query = await manager.startExecution(
        `Generate a short, descriptive title (3-8 words) for this task:

${description}`,
        {
            harnessId: "claude-code",
            cwd: "",
            model: "haiku",
            mode: "read-only",
            disablePlanningTools: true,
            appendSystemPrompt: `You are a title generator. Generate a short, descriptive title (3-8 words) that captures the essence of the task.

Usually the description is enough - respond immediately. If the description is vague or references a file you don't understand, you may Read or Glob one file to clarify, but keep research minimal.`,
        }
    )

    if (!query) return null

    const abortHandler = () => query.abort()
    abortController.signal.addEventListener("abort", abortHandler)

    try {
        for await (const msg of query.stream()) {
            const m = msg as Record<string, unknown>
            if (m.type === "result" && "structured_output" in m && m.structured_output) {
                const parsed = titleSchema.safeParse(m.structured_output)
                if (parsed.success) {
                    return parsed.data.title
                }
            }
        }
        return null
    } finally {
        abortController.signal.removeEventListener("abort", abortHandler)
        query.cleanup()
    }
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
