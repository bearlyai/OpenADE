/**
 * Title and Slug Generation
 *
 * Provides synchronous slug generation and async title generation via Claude Agent SDK.
 */

import { z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import { getClaudeQueryManager } from "../electronAPI/claude"

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

/** Generate a title from description using Claude Agent SDK with structured output */
export async function generateTitle(description: string, abortController: AbortController): Promise<string | null> {
    const manager = getClaudeQueryManager()

    const query = await manager.startExecution(
        `Generate a short, descriptive title (3-8 words) for this task:

${description}`,
        {
            model: "claude-haiku-4-5-20251001",
            systemPrompt: `You are a title generator. Generate a short, descriptive title (3-8 words) that captures the essence of the task.

Usually the description is enough - respond immediately. If the description is vague or references a file you don't understand, you may Read or Glob one file to clarify, but keep research minimal.`,
            allowedTools: ["Read", "Glob"],
            disallowedTools: ["Grep", "Bash", "WebSearch", "WebFetch", "Edit", "Write", "Task"],
            outputFormat: {
                type: "json_schema",
                schema: zodToJsonSchema(titleSchema),
            },
        }
    )

    if (!query) return null

    const abortHandler = () => query.abort()
    abortController.signal.addEventListener("abort", abortHandler)

    try {
        for await (const msg of query.stream()) {
            if (msg.type === "result" && "structured_output" in msg && msg.structured_output) {
                const parsed = titleSchema.safeParse(msg.structured_output)
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
