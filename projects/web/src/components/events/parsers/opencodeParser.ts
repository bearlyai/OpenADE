/**
 * opencode event parser
 *
 * Converts typed OpencodeEvent[] into MessageGroup[] for rendering.
 */

import type { OpencodeErrorEvent, OpencodeEvent, OpencodeRawJsonEvent, OpencodeStepFinishEvent, OpencodeToolUseEvent } from "@openade/harness/browser"
import type { BashGroup, MessageGroup, ResultGroup, ToolGroup } from "../messageGroups"

type CompletionUsage = { costUsd?: number; durationMs?: number; inputTokens?: number; outputTokens?: number }

export function groupOpencodeMessages(messages: OpencodeEvent[], completionUsage?: CompletionUsage): MessageGroup[] {
    const groups: MessageGroup[] = []
    const textDeltaPartIds = new Set<string>()
    const thinkingDeltaPartIds = new Set<string>()
    const endedShellCallIds = collectEndedShellCallIds(messages)
    let textBuffer = ""
    let textStartIndex = -1
    let thinkingBuffer = ""
    let thinkingStartIndex = -1
    let renderedResult = false

    const flushText = () => {
        const text = textBuffer.trim()
        if (text.length > 0) {
            groups.push({
                type: "text",
                text,
                messageIndex: textStartIndex,
            })
        }
        textBuffer = ""
        textStartIndex = -1
    }

    const flushThinking = () => {
        const text = thinkingBuffer.trim()
        if (text.length > 0) {
            groups.push({
                type: "thinking",
                text,
                messageIndex: thinkingStartIndex,
            })
        }
        thinkingBuffer = ""
        thinkingStartIndex = -1
    }

    const flushInlineText = () => {
        flushText()
        flushThinking()
    }

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]

        const text = getOpencodeText(msg, textDeltaPartIds)
        if (text) {
            flushThinking()
            if (textStartIndex < 0) textStartIndex = i
            textBuffer += text
            continue
        }

        const thinking = getOpencodeThinking(msg, thinkingDeltaPartIds)
        if (thinking) {
            flushText()
            if (thinkingStartIndex < 0) thinkingStartIndex = i
            thinkingBuffer += thinking
            continue
        }

        flushInlineText()

        if (msg.type === "step_start") {
            const { type: _type, ...metadata } = msg as unknown as Record<string, unknown>
            groups.push({
                type: "system",
                subtype: "init",
                metadata,
                messageIndex: i,
            })
            continue
        }

        if (msg.type === "tool_use") {
            groups.push(buildToolGroup(msg, i))
            continue
        }

        if (msg.type === "message.part.updated") {
            const toolGroup = buildPartUpdatedToolGroup(msg, i)
            if (toolGroup) {
                groups.push(toolGroup)
            }
            continue
        }

        if (msg.type === "session.next.shell.started") {
            const callId = getShellCallId(msg)
            if (!callId || !endedShellCallIds.has(callId)) {
                groups.push(buildShellGroup(msg, i, true))
            }
            continue
        }

        if (msg.type === "session.next.shell.ended") {
            groups.push(buildShellGroup(msg, i, false))
            continue
        }

        if (msg.type === "step_finish") {
            const result = buildResultGroup(msg, i, completionUsage)
            if (result) {
                groups.push(result)
                renderedResult = true
            }
            continue
        }

        if (msg.type === "error" || msg.type === "session.error") {
            groups.push(buildErrorResultGroup(msg, i))
            continue
        }

        if (msg.type === "raw_json") {
            pushOpencodeUnknownEventGroup(groups, msg, i)
        }
    }

    flushInlineText()

    if (!renderedResult && completionUsage) {
        groups.push(buildCompletionResultGroup(completionUsage, messages.length - 1))
    }

    return groups
}

function getOpencodeText(msg: OpencodeEvent, textDeltaPartIds: Set<string>): string | undefined {
    if (msg.type === "text") {
        const partText = msg.part?.text
        if (typeof partText === "string") return partText

        const rawText = (msg as unknown as { text?: unknown }).text
        return typeof rawText === "string" ? rawText : undefined
    }

    const properties = getProperties(msg)
    if (!properties) return undefined

    if (msg.type === "message.part.delta") {
        if (properties.field !== "text" || typeof properties.delta !== "string") return undefined
        const partId = getOpencodePartId(properties)
        if (partId) textDeltaPartIds.add(partId)
        return properties.delta
    }

    if (msg.type === "message.part.updated") {
        const part = isRecord(properties.part) ? properties.part : undefined
        if (!part || part.type !== "text") return undefined
        const partId = getOpencodePartId(properties) ?? getOpencodePartId(part)
        if (partId && textDeltaPartIds.has(partId)) return undefined
        const text = part.text ?? part.snapshot
        return typeof text === "string" ? text : undefined
    }

    return undefined
}

function getOpencodeThinking(msg: OpencodeEvent, thinkingDeltaPartIds: Set<string>): string | undefined {
    const properties = getProperties(msg)
    if (!properties) return undefined

    if (msg.type === "message.part.delta") {
        const part = isRecord(properties.part) ? properties.part : undefined
        if (part?.type !== "reasoning" || properties.field !== "text" || typeof properties.delta !== "string") return undefined
        const partId = getOpencodePartId(properties) ?? getOpencodePartId(part)
        if (partId) thinkingDeltaPartIds.add(partId)
        return properties.delta
    }

    if (msg.type === "message.part.updated") {
        const part = isRecord(properties.part) ? properties.part : undefined
        if (!part || part.type !== "reasoning") return undefined
        const partId = getOpencodePartId(properties) ?? getOpencodePartId(part)
        if (partId && thinkingDeltaPartIds.has(partId)) return undefined
        const text = part.text ?? part.snapshot
        return typeof text === "string" ? text : undefined
    }

    return undefined
}

function buildToolGroup(msg: OpencodeToolUseEvent, messageIndex: number): ToolGroup | BashGroup {
    return buildToolGroupFromPart(msg.part ?? {}, messageIndex)
}

function buildPartUpdatedToolGroup(msg: OpencodeEvent, messageIndex: number): ToolGroup | BashGroup | null {
    const properties = getProperties(msg)
    const part = properties && isRecord(properties.part) ? properties.part : undefined
    if (!part || part.type !== "tool") return null
    return buildToolGroupFromPart(part, messageIndex)
}

function buildToolGroupFromPart(part: Record<string, unknown>, messageIndex: number): ToolGroup | BashGroup {
    const state = isRecord(part.state) ? part.state : undefined
    const toolName = normalizeToolName(getToolName(part.tool))
    const input = state?.input ?? part.input
    const output = state?.output ?? part.output
    const metadata = state && isRecord(state.metadata) ? state.metadata : undefined
    const exitCode = pickNumber(metadata, ["exit", "code"]) ?? pickNumber(state, ["exit", "code"]) ?? pickNumber(part, ["exit", "code"])
    const status = pickString(state, ["status"]) ?? pickString(part, ["status"])
    const isError = status === "error" || status === "failed" || (exitCode !== undefined && exitCode !== 0)
    const toolUseId = pickString(part, ["id", "callID", "callId"]) ?? `opencode-tool-${messageIndex}`

    if (toolName === "Bash") {
        const inputRecord = isRecord(input) ? input : {}
        return {
            type: "bash",
            toolUseId,
            command: pickString(inputRecord, ["command", "cmd", "script"]) ?? stringifyUnknown(input) ?? "",
            description: pickString(inputRecord, ["description"]),
            result: stringifyUnknown(output),
            isError,
            isPending: status === "pending" || status === "running",
            messageIndices: [messageIndex, undefined],
        }
    }

    return {
        type: "tool",
        toolUseId,
        toolName,
        input,
        result: stringifyUnknown(output),
        isError,
        messageIndices: [messageIndex, undefined],
    }
}

function buildShellGroup(msg: OpencodeEvent, messageIndex: number, isPending: boolean): BashGroup {
    const properties = getProperties(msg) ?? {}
    const exitCode = pickNumber(properties, ["exit", "exitCode", "code"])
    const status = pickString(properties, ["status"])
    const output = pickString(properties, ["output"]) ?? joinOutputParts(properties)

    return {
        type: "bash",
        toolUseId: getShellCallId(msg) ?? `opencode-shell-${messageIndex}`,
        command: pickString(properties, ["command", "cmd", "script"]) ?? "",
        description: pickString(properties, ["description"]),
        result: isPending ? undefined : output,
        isError: status === "error" || status === "failed" || (exitCode !== undefined && exitCode !== 0),
        isPending,
        messageIndices: [messageIndex, undefined],
    }
}

function buildResultGroup(msg: OpencodeStepFinishEvent, messageIndex: number, completionUsage?: CompletionUsage): ResultGroup | null {
    if (msg.part?.reason === "tool-calls") return null

    return {
        type: "result",
        subtype: "success",
        durationMs: completionUsage?.durationMs ?? 0,
        totalCostUsd: completionUsage?.costUsd ?? msg.part?.cost ?? 0,
        usage: {
            inputTokens: completionUsage?.inputTokens ?? msg.part?.tokens?.input ?? 0,
            outputTokens: completionUsage?.outputTokens ?? msg.part?.tokens?.output ?? 0,
        },
        isError: false,
        messageIndex,
    }
}

function buildCompletionResultGroup(completionUsage: CompletionUsage, messageIndex: number): ResultGroup {
    return {
        type: "result",
        subtype: "success",
        durationMs: completionUsage.durationMs ?? 0,
        totalCostUsd: completionUsage.costUsd ?? 0,
        usage: {
            inputTokens: completionUsage.inputTokens ?? 0,
            outputTokens: completionUsage.outputTokens ?? 0,
        },
        isError: false,
        messageIndex,
    }
}

function buildErrorResultGroup(msg: OpencodeErrorEvent | Extract<OpencodeEvent, { type: "session.error" }>, messageIndex: number): ResultGroup {
    return {
        type: "result",
        subtype: "error_during_execution",
        durationMs: 0,
        totalCostUsd: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
        isError: true,
        errors: [getOpencodeErrorMessage(msg)],
        messageIndex,
    }
}

function getOpencodeErrorMessage(msg: OpencodeErrorEvent | Extract<OpencodeEvent, { type: "session.error" }>): string {
    if (msg.type === "error") {
        return msg.error?.data?.message ?? msg.error?.message ?? msg.message ?? msg.error?.name ?? "opencode error"
    }

    const properties = getProperties(msg)
    const propertyError = properties?.error
    if (isRecord(propertyError)) {
        const data = isRecord(propertyError.data) ? propertyError.data : undefined
        return (data && pickString(data, ["message"])) ?? pickString(propertyError, ["message", "name"]) ?? "opencode error"
    }
    if (typeof propertyError === "string") return propertyError
    return msg.message ?? pickString(properties, ["message"]) ?? "opencode error"
}

function pushOpencodeUnknownEventGroup(groups: MessageGroup[], event: OpencodeRawJsonEvent, messageIndex: number): void {
    groups.push({
        type: "unknown",
        harnessId: "opencode",
        label: `Unknown opencode event: ${event.original_type ?? "event"}`,
        originalType: event.original_type,
        raw: event.raw,
        messageIndex,
    })
}

function collectEndedShellCallIds(messages: OpencodeEvent[]): Set<string> {
    const ids = new Set<string>()
    for (const message of messages) {
        if (message.type !== "session.next.shell.ended") continue
        const callId = getShellCallId(message)
        if (callId) ids.add(callId)
    }
    return ids
}

function getShellCallId(msg: OpencodeEvent): string | undefined {
    const properties = getProperties(msg)
    return properties ? pickString(properties, ["callID", "callId", "id"]) : undefined
}

function getProperties(msg: OpencodeEvent): Record<string, unknown> | undefined {
    const properties = (msg as unknown as { properties?: unknown }).properties
    return isRecord(properties) ? properties : undefined
}

function getOpencodePartId(record: Record<string, unknown>): string | undefined {
    return pickString(record, ["partID", "partId", "id"])
}

function getToolName(value: unknown): string | undefined {
    if (typeof value === "string") return value
    if (isRecord(value)) return pickString(value, ["name", "id", "tool"])
    return undefined
}

function normalizeToolName(value: string | undefined): string {
    const lower = value?.toLowerCase()
    if (lower === "bash" || lower === "shell") return "Bash"
    if (lower === "websearch" || lower === "web_search") return "WebSearch"
    if (lower === "webfetch" || lower === "web_fetch") return "WebFetch"
    if (lower === "todowrite" || lower === "todo_write") return "TodoWrite"
    if (!value) return "opencode tool"
    return value
}

function joinOutputParts(record: Record<string, unknown>): string | undefined {
    const parts = [pickString(record, ["stdout"]), pickString(record, ["stderr"])].filter((part): part is string => typeof part === "string" && part.length > 0)
    return parts.length > 0 ? parts.join("\n") : undefined
}

function stringifyUnknown(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined
    if (typeof value === "string") return value
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

function pickString(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
    if (!record) return undefined
    for (const key of keys) {
        const value = record[key]
        if (typeof value === "string") return value
    }
    return undefined
}

function pickNumber(record: Record<string, unknown> | undefined, keys: string[]): number | undefined {
    if (!record) return undefined
    for (const key of keys) {
        const value = record[key]
        if (typeof value === "number" && Number.isFinite(value)) return value
    }
    return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
}
