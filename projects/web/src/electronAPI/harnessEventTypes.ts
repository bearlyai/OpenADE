/**
 * Harness Event Stream Types
 *
 * This file aliases shared event types owned by @openade/harness/browser and
 * keeps renderer helpers for persisted-event compatibility and event inspection.
 *
 * Replaces claudeEventTypes.ts with harness-agnostic types.
 *
 * Events are split by direction:
 * - HarnessExecutionEvent: Events from Electron -> Dashboard (execution output)
 * - HarnessCommandEvent: Commands from Dashboard -> Electron (control actions)
 */

import type {
    HarnessId,
    McpServerConfig as HarnessMcpServerConfig,
    McpStdioServerConfig,
    McpHttpServerConfig,
    HarnessIpcContentBlock,
    HarnessIpcSerializedToolDefinition,
    HarnessIpcToolResult,
    HarnessIpcQueryOptions,
    HarnessIpcRawMessageEvent,
    HarnessIpcExecutionEvent,
    HarnessIpcCommandEvent,
    HarnessIpcStreamEvent,
    HarnessIpcExecutionState,
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

// ============================================================================
// Helper Functions
// ============================================================================

/** Extract raw message events from unified event stream (for rendering).
 *  Handles backward compat: old v1 events have type:"sdk_message" and no harnessId. */
export function extractRawMessageEvents(events: HarnessStreamEvent[]): HarnessRawMessageEvent[] {
    const result: HarnessRawMessageEvent[] = []
    for (const e of events) {
        if (e.direction !== "execution") continue
        if (e.type !== "raw_message" && (e.type as string) !== "sdk_message") continue

        // v1 compat: old sdk_message events lack harnessId — they're always claude-code
        const raw = e as Record<string, unknown>
        const harnessId = (raw.harnessId as HarnessId) ?? "claude-code"
        result.push({ id: e.id, type: "raw_message", executionId: e.executionId, harnessId, message: raw.message } as HarnessRawMessageEvent)
    }
    return result
}

/** Extract stderr output from unified event stream */
export function extractStderr(events: HarnessStreamEvent[]): string[] {
    return events
        .filter((e): e is HarnessExecutionEvent & { direction: "execution"; type: "stderr" } => e.direction === "execution" && e.type === "stderr")
        .map((e) => e.data)
}

/** Check if an event ID already exists (for deduplication) */
export function hasEventId(events: HarnessStreamEvent[], id: string): boolean {
    return events.some((e) => e.id === id)
}

/**
 * Check if events contain only an init message (no meaningful work done).
 * Uses discriminated union narrowing on harnessId for type safety.
 */
export function hasOnlyInitMessage(events: HarnessStreamEvent[]): boolean {
    const messageEvents = extractRawMessageEvents(events)
    if (messageEvents.length !== 1) return false
    const event = messageEvents[0]
    switch (event.harnessId) {
        case "claude-code":
            return event.message.type === "system" && event.message.subtype === "init"
        case "codex":
            return event.message.type === "thread.started"
        default:
            return false
    }
}
