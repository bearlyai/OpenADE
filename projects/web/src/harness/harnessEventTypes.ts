/**
 * Browser-safe harness event stream types and helpers.
 *
 * This module aliases shared event types owned by @openade/harness/browser and
 * keeps renderer helpers for persisted-event compatibility and event inspection.
 */

import type {
    HarnessId,
    HarnessIpcCommandEvent,
    HarnessIpcContentBlock,
    HarnessIpcExecutionEvent,
    HarnessIpcExecutionState,
    HarnessIpcQueryOptions,
    HarnessIpcRawMessageEvent,
    HarnessIpcSerializedToolDefinition,
    HarnessIpcStreamEvent,
    HarnessIpcToolResult,
    McpHttpServerConfig,
    McpServerConfig as HarnessMcpServerConfig,
    McpStdioServerConfig,
} from "@openade/harness/browser"

export type { HarnessId, HarnessMcpServerConfig as McpServerConfig, McpStdioServerConfig, McpHttpServerConfig }
export type ContentBlock = HarnessIpcContentBlock
export type SerializedToolDefinition = HarnessIpcSerializedToolDefinition
export type ToolResult = HarnessIpcToolResult
export type HarnessQueryOptions = HarnessIpcQueryOptions
export type HarnessRawMessageEvent = HarnessIpcRawMessageEvent
export type HarnessExecutionEvent = HarnessIpcExecutionEvent
export type HarnessCommandEvent = HarnessIpcCommandEvent
export type HarnessStreamEvent = HarnessIpcStreamEvent
export type ExecutionState = HarnessIpcExecutionState

/** Extract raw message events from unified event stream. */
export function extractRawMessageEvents(events: HarnessStreamEvent[]): HarnessRawMessageEvent[] {
    const result: HarnessRawMessageEvent[] = []
    for (const event of events) {
        if (event.direction !== "execution") continue
        if (event.type !== "raw_message" && (event.type as string) !== "sdk_message") continue

        const raw = event as Record<string, unknown>
        const harnessId = (raw.harnessId as HarnessId) ?? "claude-code"
        result.push({ id: event.id, type: "raw_message", executionId: event.executionId, harnessId, message: raw.message } as HarnessRawMessageEvent)
    }
    return result
}

/** Extract stderr output from unified event stream. */
export function extractStderr(events: HarnessStreamEvent[]): string[] {
    return events
        .filter((event): event is HarnessExecutionEvent & { direction: "execution"; type: "stderr" } => event.direction === "execution" && event.type === "stderr")
        .map((event) => event.data)
}

/** Check if an event ID already exists for deduplication. */
export function hasEventId(events: HarnessStreamEvent[], id: string): boolean {
    return events.some((event) => event.id === id)
}

/**
 * Check if events contain only an init message.
 * Uses discriminated union narrowing on harnessId for type safety.
 */
export function hasOnlyInitMessage(events: HarnessStreamEvent[]): boolean {
    const messageEvents = extractRawMessageEvents(events)
    if (messageEvents.length !== 1) return false
    const event = messageEvents[0]
    if (!event) return false
    if (event.harnessId === "claude-code" && typeof event.message === "object" && event.message !== null) {
        return (event.message as { type?: unknown }).type === "system"
    }
    if (event.harnessId === "codex" && typeof event.message === "object" && event.message !== null) {
        return (event.message as { type?: unknown }).type === "session_configured"
    }
    return false
}
