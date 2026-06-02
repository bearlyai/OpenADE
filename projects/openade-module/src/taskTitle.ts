export const OPENADE_TASK_TITLE_SYSTEM_PROMPT =
    "You are a title generator. Aim for exactly 3 words. Output a title in this exact format:\n" +
    "Title: <your 3 word title>\n" +
    "Do not output anything else."

export const OPENADE_TASK_TITLE_OUTPUT_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        title: { type: "string" },
    },
    required: ["title"],
}

export const OPENADE_TASK_TITLE_CONTEXT_MAX_BYTES = 2000

const encoder = new TextEncoder()

function byteLength(value: string): number {
    return encoder.encode(value).byteLength
}

function recordFrom(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function boundedEventContext(events: unknown[]): string {
    const selected: string[] = []
    let usedBytes = 0

    for (let index = events.length - 1; index >= 0; index--) {
        let serialized: string
        try {
            serialized = JSON.stringify(events[index])
        } catch {
            continue
        }
        if (!serialized) continue

        const line = serialized.length > 1000 ? `${serialized.slice(0, 1000)}...` : serialized
        const lineBytes = byteLength(line)
        if (usedBytes > 0 && usedBytes + lineBytes > OPENADE_TASK_TITLE_CONTEXT_MAX_BYTES) break
        if (lineBytes > OPENADE_TASK_TITLE_CONTEXT_MAX_BYTES) continue

        selected.unshift(line)
        usedBytes += lineBytes
    }

    return selected.join("\n")
}

export function buildOpenADETaskTitlePrompt({ description, events }: { description: string; events?: unknown[] }): string {
    let prompt = `Generate a concise, descriptive title (aim for exactly 3 words) for this task:\n\n${description}`
    if (events && events.length > 0) {
        const context = boundedEventContext(events)
        if (context) {
            prompt += `\n\nHere is some of the conversation so far:\n\n${context}`
        }
    }
    return prompt
}

export function cleanOpenADETaskTitle(raw: string): string | null {
    const trimmed = raw.trim()
    if (!trimmed) return null

    const match = trimmed.match(/^title:\s*(.+)/im)
    const titleText = (match?.[1] ?? trimmed.split("\n").find((line) => line.trim().length > 0) ?? "").trim()
    const cleaned = titleText.replace(/^["']|["']$/g, "").trim()
    return cleaned || null
}

export function fallbackOpenADETaskTitle(input: string): string {
    const maxLength = 50
    const cleaned = input.replace(/\s+/g, " ").trim()
    if (cleaned.length <= maxLength) return cleaned
    return `${cleaned.slice(0, maxLength).trim()}...`
}

function titleFromRecord(value: unknown): string | null {
    const record = recordFrom(value)
    if (!record) return null
    return typeof record.title === "string" ? cleanOpenADETaskTitle(record.title) : null
}

export function titleFromStructuredOutput(output: unknown): string | null {
    const direct = titleFromRecord(output)
    if (direct) return direct

    const record = recordFrom(output)
    return titleFromRecord(record?.output)
}

function textFromContentBlock(value: unknown): string | null {
    const record = recordFrom(value)
    if (!record) return null
    if (record.type === "text" && typeof record.text === "string") return record.text
    return null
}

function textFromContent(value: unknown): string | null {
    if (typeof value === "string") return value
    if (!Array.isArray(value)) return null
    const text = value.map(textFromContentBlock).filter((item): item is string => item !== null).join("\n")
    return text.trim() ? text : null
}

function textFromMessage(value: unknown): string | null {
    if (typeof value === "string") return value
    const record = recordFrom(value)
    if (!record) return null
    if (typeof record.text === "string") return record.text
    return textFromContent(record.content)
}

export function extractOpenADETaskTitleFromStreamEvent(event: unknown): string | null {
    const record = recordFrom(event)
    if (!record) return null

    if (record.type === "result" && typeof record.result === "string") {
        return cleanOpenADETaskTitle(record.result)
    }

    if (record.type === "raw_message" || record.type === "message" || record.type === "sdk_message") {
        const title = cleanOpenADETaskTitle(textFromMessage(record.message) ?? "")
        if (title) return title
    }

    if (record.type === "item.completed") {
        const item = recordFrom(record.item)
        if (item?.type === "agent_message" && typeof item.text === "string") return cleanOpenADETaskTitle(item.text)
        if (item?.type === "message" && item.role === "assistant") {
            return cleanOpenADETaskTitle(textFromContent(item.content) ?? "")
        }
    }

    return null
}
