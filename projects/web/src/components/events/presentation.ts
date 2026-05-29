import type { BashGroup, EditGroup, FileChangeGroup, MessageGroup, ResultGroup, SystemGroup, TodoWriteGroup, ToolGroup, WriteGroup } from "./messageGroups"
import { classifyBashCommand } from "../InlineMessages/renderers/classifyBashCommand"
import { formatInputCacheRate } from "./usage"

export type PresentedTone = "muted" | "info" | "ok" | "warn" | "bad"

export interface PresentedGroup {
    id: string
    type: MessageGroup["type"]
    label: string
    detail?: string
    tone: PresentedTone
    isPending: boolean
    isError: boolean
    group: MessageGroup
}

export function compactText(value: string, maxLength = 3200): string {
    const normalized = value.replace(/\n{3,}/g, "\n\n").trim()
    if (normalized.length <= maxLength) return normalized
    return `${normalized.slice(0, maxLength).trim()}...`
}

export function compactInline(value: string, maxLength = 96): string {
    const normalized = value.replace(/\s+/g, " ").trim()
    if (normalized.length <= maxLength) return normalized
    return `${normalized.slice(0, maxLength).trim()}...`
}

export function fileName(value: string): string {
    return value.split(/[\\/]/).filter(Boolean).pop() ?? value
}

export function stringifyRaw(value: unknown): string {
    try {
        const json = JSON.stringify(value, null, 2)
        return json ?? String(value)
    } catch {
        return String(value)
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined
}

function firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
        const text = asString(value)
        if (text) return text
    }
    return undefined
}

function detailFromToolInput(input: unknown): string | undefined {
    if (typeof input === "string") return compactInline(input)
    if (!isRecord(input)) return undefined

    const query = asString(input.query)
    if (query) return compactInline(query)

    const filePath = firstString(input.file_path, input.path)
    if (filePath) return fileName(filePath)

    const pattern = asString(input.pattern)
    if (pattern) return compactInline(pattern)

    const command = asString(input.command)
    if (command) return compactInline(command)

    return undefined
}

function resultDetail(group: ResultGroup): string | undefined {
    if (group.errors?.length) return compactInline(group.errors.join("; "))
    const inputTokens = group.usage?.inputTokens ?? 0
    const outputTokens = group.usage?.outputTokens ?? 0
    const cacheRate = formatInputCacheRate(group.usage)
    if (inputTokens || outputTokens) {
        return [`${inputTokens.toLocaleString()} in`, `${outputTokens.toLocaleString()} out`, cacheRate ? `${cacheRate} input cache` : undefined]
            .filter(Boolean)
            .join(", ")
    }
    if (group.durationMs) return `${Math.round(group.durationMs / 1000)}s`
    return undefined
}

function todoDetail(group: TodoWriteGroup): string {
    const completed = group.todos.filter((todo) => todo.status === "completed").length
    const active = group.todos.filter((todo) => todo.status === "in_progress").length
    return `${completed}/${group.todos.length} done${active ? `, ${active} active` : ""}`
}

function statusTone(group: { isError: boolean; isPending?: boolean }): PresentedTone {
    if (group.isError) return "bad"
    if (group.isPending) return "warn"
    return "muted"
}

function toolGroupPresentation(group: ToolGroup): Pick<PresentedGroup, "label" | "detail" | "tone" | "isPending" | "isError"> {
    return {
        label: group.toolName,
        detail: detailFromToolInput(group.input),
        tone: group.isError ? "bad" : "muted",
        isPending: false,
        isError: group.isError,
    }
}

function editGroupPresentation(group: EditGroup): Pick<PresentedGroup, "label" | "detail" | "tone" | "isPending" | "isError"> {
    return {
        label: group.isPending ? "Editing" : "Edited",
        detail: fileName(group.filePath),
        tone: statusTone(group),
        isPending: group.isPending,
        isError: group.isError,
    }
}

function writeGroupPresentation(group: WriteGroup): Pick<PresentedGroup, "label" | "detail" | "tone" | "isPending" | "isError"> {
    return {
        label: group.isPending ? "Writing" : "Wrote",
        detail: fileName(group.filePath),
        tone: statusTone(group),
        isPending: group.isPending,
        isError: group.isError,
    }
}

function fileChangeGroupPresentation(group: FileChangeGroup): Pick<PresentedGroup, "label" | "detail" | "tone" | "isPending" | "isError"> {
    return {
        label: group.status || group.kind || "Changed",
        detail: fileName(group.filePath),
        tone: statusTone(group),
        isPending: group.isPending,
        isError: group.isError,
    }
}

function bashGroupPresentation(group: BashGroup): Pick<PresentedGroup, "label" | "detail" | "tone" | "isPending" | "isError"> {
    return {
        label: group.isPending ? "Shell running" : (group.description ?? classifyBashCommand(group.command).label),
        detail: compactInline(group.command),
        tone: statusTone(group),
        isPending: group.isPending,
        isError: group.isError,
    }
}

function systemGroupPresentation(group: SystemGroup): Pick<PresentedGroup, "label" | "detail" | "tone" | "isPending" | "isError"> {
    return {
        label: group.subtype.replace(/_/g, " "),
        tone: "muted",
        isPending: false,
        isError: false,
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled message group: ${String(value)}`)
}

export function presentedGroupId(group: MessageGroup, index: number): string {
    switch (group.type) {
        case "text":
        case "thinking":
        case "system":
        case "result":
            return `${group.type}:${group.messageIndex}:${index}`
        case "tool":
        case "edit":
        case "write":
        case "bash":
        case "todoWrite":
            return `${group.type}:${group.toolUseId}:${index}`
        case "fileChange":
            return `${group.type}:${group.toolUseId}:${group.changeIndex}:${index}`
        case "stderr":
            return `${group.type}:${group.eventId}:${index}`
        case "unknown":
            return `${group.type}:${group.harnessId}:${group.messageIndex}:${index}`
        default:
            return assertNever(group)
    }
}

export function presentMessageGroup(group: MessageGroup, index: number): PresentedGroup {
    const id = presentedGroupId(group, index)
    switch (group.type) {
        case "text":
            return {
                id,
                type: group.type,
                label: "Assistant",
                detail: compactInline(group.text),
                tone: "muted",
                isPending: false,
                isError: false,
                group,
            }
        case "thinking":
            return {
                id,
                type: group.type,
                label: "Thinking",
                detail: group.text ? compactInline(group.text) : undefined,
                tone: "info",
                isPending: false,
                isError: false,
                group,
            }
        case "tool":
            return { id, type: group.type, group, ...toolGroupPresentation(group) }
        case "edit":
            return { id, type: group.type, group, ...editGroupPresentation(group) }
        case "write":
            return { id, type: group.type, group, ...writeGroupPresentation(group) }
        case "fileChange":
            return { id, type: group.type, group, ...fileChangeGroupPresentation(group) }
        case "bash":
            return { id, type: group.type, group, ...bashGroupPresentation(group) }
        case "todoWrite":
            return {
                id,
                type: group.type,
                label: "Todo",
                detail: todoDetail(group),
                tone: statusTone(group),
                isPending: group.isPending,
                isError: group.isError,
                group,
            }
        case "system":
            return { id, type: group.type, group, ...systemGroupPresentation(group) }
        case "result":
            return {
                id,
                type: group.type,
                label: group.isError ? "Failed" : "Completed",
                detail: resultDetail(group),
                tone: group.isError ? "bad" : "ok",
                isPending: false,
                isError: group.isError,
                group,
            }
        case "stderr":
            return {
                id,
                type: group.type,
                label: "stderr",
                detail: compactInline(group.data),
                tone: "warn",
                isPending: false,
                isError: false,
                group,
            }
        case "unknown":
            return {
                id,
                type: group.type,
                label: group.label,
                detail: group.originalType,
                tone: "muted",
                isPending: false,
                isError: false,
                group,
            }
        default:
            return assertNever(group)
    }
}
