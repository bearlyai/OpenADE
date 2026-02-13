/**
 * Harness Event Stream Types
 *
 * This file defines the shared event types used for communication between
 * the Electron main process and the Dashboard renderer process.
 *
 * Replaces claudeEventTypes.ts with harness-agnostic types.
 *
 * Events are split by direction:
 * - HarnessExecutionEvent: Events from Electron -> Dashboard (execution output)
 * - HarnessCommandEvent: Commands from Dashboard -> Electron (control actions)
 */

import type {
    HarnessId,
    HarnessUsage,
    HarnessErrorCode,
    McpServerConfig as HarnessMcpServerConfig,
    McpStdioServerConfig,
    McpHttpServerConfig,
    ClaudeEvent,
    CodexEvent,
} from "@openade/harness"

export type { HarnessId, HarnessMcpServerConfig as McpServerConfig, McpStdioServerConfig, McpHttpServerConfig }

// ============================================================================
// Prompt Content
// ============================================================================

/** Content block for Vision API support — text or base64 image */
export type ContentBlock = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } }

// ============================================================================
// Query Options (renderer → Electron)
// ============================================================================

/** Serialized tool definition for IPC (no handler, JSON Schema) */
export interface SerializedToolDefinition {
    name: string
    description: string
    inputSchema: Record<string, unknown>
}

/** Tool result from renderer */
export interface ToolResult {
    content: Array<{ type: "text"; text: string }>
    isError?: boolean
}

export interface HarnessQueryOptions {
    harnessId: HarnessId
    cwd: string
    mode?: "read-only" | "yolo"
    model?: string
    thinking?: "low" | "med" | "high"
    appendSystemPrompt?: string
    resumeSessionId?: string
    forkSession?: boolean
    additionalDirectories?: string[]
    env?: Record<string, string>
    disablePlanningTools?: boolean
    mcpServerConfigs?: Record<string, HarnessMcpServerConfig>
    clientTools?: SerializedToolDefinition[]
}

// ============================================================================
// Raw Message — discriminated union keyed on harnessId
// ============================================================================

export type HarnessRawMessageEvent =
    | { id: string; type: "raw_message"; executionId: string; harnessId: "claude-code"; message: ClaudeEvent }
    | { id: string; type: "raw_message"; executionId: string; harnessId: "codex"; message: CodexEvent }

// ============================================================================
// Execution Events (Electron → Dashboard)
// ============================================================================

export type HarnessExecutionEvent =
    | HarnessRawMessageEvent
    | { id: string; type: "stderr"; executionId: string; harnessId: HarnessId; data: string }
    | { id: string; type: "complete"; executionId: string; harnessId: HarnessId; usage?: HarnessUsage }
    | { id: string; type: "error"; executionId: string; harnessId: HarnessId; error: string; code?: HarnessErrorCode }
    | { id: string; type: "tool_call"; executionId: string; harnessId: HarnessId; callId: string; toolName: string; args: unknown }
    | { id: string; type: "session_started"; executionId: string; harnessId: HarnessId; sessionId: string }

// ============================================================================
// Command Events (Dashboard → Electron)
// ============================================================================

export type HarnessCommandEvent =
    | { id: string; type: "start_query"; executionId: string; prompt: string | ContentBlock[]; options: HarnessQueryOptions }
    | { id: string; type: "tool_response"; executionId: string; callId: string; result?: ToolResult; error?: string }
    | { id: string; type: "abort"; executionId: string }
    | { id: string; type: "reconnect"; executionId: string }
    | { id: string; type: "clear_buffer"; executionId: string }

// ============================================================================
// Combined Event Type
// ============================================================================

export type HarnessStreamEvent = (HarnessExecutionEvent & { direction: "execution" }) | (HarnessCommandEvent & { direction: "command" })

// ============================================================================
// Execution State (used by both sides for buffering)
// ============================================================================

export interface ExecutionState {
    executionId: string
    harnessId: HarnessId
    status: "in_progress" | "completed" | "error" | "aborted"
    sessionId?: string
    events: HarnessStreamEvent[]
    createdAt: string
    completedAt?: string
}

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
