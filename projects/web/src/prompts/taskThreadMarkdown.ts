import type { ActionEventSource } from "../types"
import {
    type TaskLike,
    type TaskThreadEventJson,
    type TaskThreadFormat,
    type TaskThreadItemJson,
    type TaskThreadJson,
    buildTaskThreadJson,
} from "./taskThreadSerializer"

// Human-readable headings for each turn kind, e.g. "## User (Ask)".
const SOURCE_LABELS: Record<ActionEventSource["type"], string> = {
    plan: "Plan",
    revise: "Revise",
    run_plan: "Run Plan",
    do: "Do",
    ask: "Ask",
    hyperplan: "HyperPlan",
    review: "Review",
}

function sourceLabel(sourceType: ActionEventSource["type"]): string {
    // Tolerant of unknown/legacy source types persisted on old tasks.
    return SOURCE_LABELS[sourceType] ?? sourceType
}

/**
 * Serialize a task conversation to Markdown.
 *
 * Messages (user input + agent output) are always included. The optional flags on
 * {@link TaskThreadFormat} layer in thinking, function calls + params, and function
 * results. Output is delimited as:
 *
 *     ## User (Ask)
 *     <prompt>
 *     ## Agent
 *     <output>
 */
export function buildTaskThreadMarkdown(task: TaskLike, format: Partial<TaskThreadFormat> = {}): string {
    const thread = buildTaskThreadJson(task, { ...format, includeMessages: true })
    return taskThreadJsonToMarkdown(thread)
}

export function taskThreadJsonToMarkdown(thread: TaskThreadJson): string {
    const blocks: string[] = []

    const title = thread.task.title.trim()
    if (title) blocks.push(`# ${title}`)

    for (const event of thread.events) {
        blocks.push(...eventToMarkdownBlocks(event))
    }

    return `${blocks.join("\n\n").trim()}\n`
}

function eventToMarkdownBlocks(event: TaskThreadEventJson): string[] {
    const blocks: string[] = []

    blocks.push(`## User (${sourceLabel(event.sourceType)})`)
    const userText = event.items
        .find((item): item is Extract<TaskThreadItemJson, { kind: "message" }> => item.kind === "message" && item.role === "user")
        ?.text.trim()
    blocks.push(userText && userText.length > 0 ? userText : "_(no message)_")

    blocks.push("## Agent")
    const agentBlocks: string[] = []
    for (const item of event.items) {
        if (item.kind === "message" && item.role === "user") continue
        const rendered = itemToMarkdown(item)
        if (rendered) agentBlocks.push(rendered)
    }
    blocks.push(...(agentBlocks.length > 0 ? agentBlocks : ["_(no output)_"]))

    return blocks
}

function itemToMarkdown(item: TaskThreadItemJson): string | null {
    switch (item.kind) {
        case "message": {
            const text = item.text.trim()
            return text.length > 0 ? text : null
        }
        case "thinking": {
            const text = item.text.trim()
            return text.length > 0 ? `**Thinking**\n\n${text}` : null
        }
        case "functionCall": {
            const header = `**Function call: \`${item.name}\`**${item.isPending ? " _(pending)_" : ""}`
            if (item.input === undefined) return header
            return `${header}\n\n${formatInput(item.input)}`
        }
        case "functionOutput":
            return `**Function ${item.isError ? "error" : "result"}: \`${item.name}\`**\n\n${codeFence(item.output)}`
        case "result":
            return resultToMarkdown(item)
        default: {
            const _exhaustive: never = item
            throw new Error(`Unhandled task thread item kind: ${String(_exhaustive)}`)
        }
    }
}

// The result item mirrors the final assistant text on success, so only surface failures.
function resultToMarkdown(item: Extract<TaskThreadItemJson, { kind: "result" }>): string | null {
    if (!item.isError) return null
    const blocks = [`**Run ended with error** (\`${item.subtype}\`)`]
    if (item.errors && item.errors.length > 0) {
        blocks.push(codeFence(item.errors.join("\n")))
    } else if (item.result) {
        blocks.push(codeFence(item.result))
    }
    return blocks.join("\n\n")
}

function formatInput(input: unknown): string {
    if (typeof input === "string") return codeFence(input)
    return codeFence(stableJson(input), "json")
}

function stableJson(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2) ?? String(value)
    } catch {
        return String(value)
    }
}

// Pick a fence longer than any backtick run inside the content so embedded fences don't break out.
function codeFence(content: string, lang = ""): string {
    const text = content.replace(/\s+$/, "")
    const longestRun = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0)
    const fence = "`".repeat(Math.max(3, longestRun + 1))
    return `${fence}${lang}\n${text}\n${fence}`
}
