/**
 * Message grouping utility for inline message rendering
 *
 * Groups harness messages into:
 * - TextGroup: Assistant text messages (rendered as File components)
 * - ToolGroup: Paired tool_use + tool_result (rendered as expandable tabs)
 * - EditGroup: Edit tool calls (rendered as diffs)
 * - BashGroup: Bash commands (rendered as prompt/response)
 * - StderrGroup: stderr output from harness process
 *
 * Delegates to per-harness parsers (e.g. claudeCodeParser) based on harnessId.
 */

import type { ReactNode } from "react"
import type { HarnessStreamEvent, HarnessId, HarnessRawMessageEvent } from "../../electronAPI/harnessEventTypes"
import { extractRawMessageEvents } from "../../electronAPI/harnessEventTypes"
import type { ActionEventSource } from "../../types"
import { groupClaudeCodeMessages } from "./parsers/claudeCodeParser"
import { groupCodexMessages } from "./parsers/codexParser"

// ============================================================================
// Render Mode Types
// ============================================================================

export type RenderMode = "inline" | "row" | "pill"

export interface DisplayContext {
    sourceType: ActionEventSource["type"]
    isLastTextGroup: boolean
}

export interface CommentContext {
    taskId: string
    actionEventId: string
}

export interface GroupRenderer<T> {
    getLabel(group: T): string
    getIcon(group: T): ReactNode
    getStatusIcon?(group: T): ReactNode | null
    getHeaderInfo?(group: T): ReactNode | null
    renderContent(group: T, ctx: CommentContext): ReactNode
}

export interface GroupWithMeta {
    group: MergedGroup
    mode: RenderMode
    id: string
}

export type RenderableItem = { mode: "inline"; item: GroupWithMeta } | { mode: "row"; item: GroupWithMeta } | { mode: "pill"; items: GroupWithMeta[] }

// ============================================================================
// Message Group Types
// ============================================================================

export interface TextGroup {
    type: "text"
    text: string
    messageIndex: number
}

export interface ToolGroup {
    type: "tool"
    toolUseId: string
    toolName: string
    input: unknown
    result?: string
    isError: boolean
    messageIndices: [number, number | undefined]
}

export interface EditGroup {
    type: "edit"
    toolUseId: string
    filePath: string
    oldString: string
    newString: string
    isError: boolean
    isPending: boolean
    errorMessage?: string
    messageIndices: [number, number | undefined]
}

export interface WriteGroup {
    type: "write"
    toolUseId: string
    filePath: string
    content: string
    isError: boolean
    isPending: boolean
    errorMessage?: string
    messageIndices: [number, number | undefined]
}

export interface BashGroup {
    type: "bash"
    toolUseId: string
    command: string
    description?: string
    result?: string
    isError: boolean
    isPending: boolean
    messageIndices: [number, number | undefined]
}

export interface SystemGroup {
    type: "system"
    subtype: "compact_boundary" | "status" | "init" | "hook_response"
    metadata: Record<string, unknown>
    messageIndex: number
}

export interface ResultGroup {
    type: "result"
    subtype: "success" | "error_during_execution" | "error_max_turns" | "error_max_budget_usd" | "error_max_structured_output_retries"
    durationMs: number
    totalCostUsd: number
    usage: { inputTokens: number; outputTokens: number }
    isError: boolean
    result?: string
    errors?: string[]
    messageIndex: number
}

export interface StderrGroup {
    type: "stderr"
    data: string
    eventId: string
}

export interface TodoItem {
    content: string
    status: "pending" | "in_progress" | "completed"
    activeForm: string
}

export interface TodoWriteGroup {
    type: "todoWrite"
    toolUseId: string
    todos: TodoItem[]
    isError: boolean
    isPending: boolean
    messageIndices: [number, number | undefined]
}

export interface ThinkingGroup {
    type: "thinking"
    text: string
    messageIndex: number
}

export type MessageGroup = TextGroup | ThinkingGroup | ToolGroup | EditGroup | WriteGroup | BashGroup | SystemGroup | ResultGroup | StderrGroup | TodoWriteGroup

// MergedGroup is now just MessageGroup - no tool merging needed
// The groupByRenderMode function handles grouping consecutive pills
export type MergedGroup = MessageGroup

/**
 * Group unified stream events into message groups for inline rendering
 *
 * Extracts raw messages from events, dispatches to the appropriate
 * per-harness parser, and appends stderr groups.
 */
export function groupStreamEvents(events: HarnessStreamEvent[], harnessId: HarnessId): MessageGroup[] {
    // Extract typed raw message events — discriminated union on harnessId
    const messageEvents = extractRawMessageEvents(events)

    // Group by harness using narrowing (no unsafe casts)
    const messageGroups = groupRawMessageEvents(messageEvents, harnessId)

    // Extract stderr events and create StderrGroups
    const stderrGroups: StderrGroup[] = events
        .filter(
            (e): e is HarnessStreamEvent & { type: "stderr"; direction: "execution" } =>
                e.direction === "execution" && e.type === "stderr",
        )
        .map((e) => ({
            type: "stderr" as const,
            data: e.data,
            eventId: e.id,
        }))

    // Extract harness-level error events (e.g. process_crashed) and render as ResultGroups
    const errorGroups: ResultGroup[] = events
        .filter(
            (e): e is HarnessStreamEvent & { type: "error"; direction: "execution" } =>
                e.direction === "execution" && e.type === "error",
        )
        .map((e) => ({
            type: "result" as const,
            subtype: "error_during_execution" as const,
            durationMs: 0,
            totalCostUsd: 0,
            usage: { inputTokens: 0, outputTokens: 0 },
            isError: true,
            errors: [e.error],
            messageIndex: -1,
        }))

    // Append stderr and errors at the end
    return [...messageGroups, ...stderrGroups, ...errorGroups]
}

/** Dispatch raw message events to per-harness parser using discriminated union narrowing */
function groupRawMessageEvents(events: HarnessRawMessageEvent[], harnessId: HarnessId): MessageGroup[] {
    switch (harnessId) {
        case "claude-code": {
            const messages = events
                .filter((e): e is HarnessRawMessageEvent & { harnessId: "claude-code" } => e.harnessId === "claude-code")
                .map((e) => e.message)
            return groupClaudeCodeMessages(messages)
        }
        case "codex": {
            const messages = events
                .filter((e): e is HarnessRawMessageEvent & { harnessId: "codex" } => e.harnessId === "codex")
                .map((e) => e.message)
            return groupCodexMessages(messages)
        }
        default: {
            const _exhaustive: never = harnessId
            return _exhaustive
        }
    }
}
