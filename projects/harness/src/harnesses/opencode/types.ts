// ============================================================================
// OpencodeEvent — types for `opencode run --format json` JSONL output
// ============================================================================

export type OpencodeEvent =
    | OpencodeStepStartEvent
    | OpencodeTextEvent
    | OpencodeToolUseEvent
    | OpencodeStepFinishEvent
    | OpencodeErrorEvent
    | OpencodeMessagePartDeltaEvent
    | OpencodeMessagePartUpdatedEvent
    | OpencodeMessageUpdatedEvent
    | OpencodeShellStartedEvent
    | OpencodeShellEndedEvent
    | OpencodeSessionErrorEvent
    | OpencodeGenericKnownEvent
    | OpencodeRawJsonEvent

export interface OpencodeBaseEvent {
    timestamp?: number
    sessionID?: string
    part?: OpencodePart
    [key: string]: unknown
}

export interface OpencodeStepStartEvent extends OpencodeBaseEvent {
    type: "step_start"
}

export interface OpencodeTextEvent extends OpencodeBaseEvent {
    type: "text"
    part?: OpencodePart & { text?: string }
}

export interface OpencodeToolUseEvent extends OpencodeBaseEvent {
    type: "tool_use"
    part?: OpencodePart & {
        tool?: string
        state?: OpencodeToolState
    }
}

export interface OpencodeStepFinishEvent extends OpencodeBaseEvent {
    type: "step_finish"
    part?: OpencodePart & {
        reason?: string
        cost?: number
        tokens?: OpencodeTokens
    }
}

export interface OpencodeErrorEvent extends OpencodeBaseEvent {
    type: "error"
    error?: {
        name?: string
        message?: string
        data?: {
            message?: string
            statusCode?: number
            isRetryable?: boolean
            [key: string]: unknown
        }
        [key: string]: unknown
    }
    message?: string
}

export interface OpencodeMessagePartDeltaEvent extends OpencodeBaseEvent {
    type: "message.part.delta"
    properties?: {
        field?: string
        delta?: string
        partID?: string
        partId?: string
        id?: string
        part?: OpencodePart
        sessionID?: string
        [key: string]: unknown
    }
}

export interface OpencodeMessagePartUpdatedEvent extends OpencodeBaseEvent {
    type: "message.part.updated"
    properties?: {
        part?: OpencodePart
        partID?: string
        partId?: string
        id?: string
        sessionID?: string
        [key: string]: unknown
    }
}

export interface OpencodeMessageUpdatedEvent extends OpencodeBaseEvent {
    type: "message.updated"
    properties?: {
        info?: {
            tokens?: OpencodeTokens
            cost?: number
            sessionID?: string
            [key: string]: unknown
        }
        sessionID?: string
        [key: string]: unknown
    }
}

export interface OpencodeShellStartedEvent extends OpencodeBaseEvent {
    type: "session.next.shell.started"
    properties?: {
        callID?: string
        command?: string
        cwd?: string
        sessionID?: string
        [key: string]: unknown
    }
}

export interface OpencodeShellEndedEvent extends OpencodeBaseEvent {
    type: "session.next.shell.ended"
    properties?: {
        callID?: string
        command?: string
        output?: string
        stdout?: string
        stderr?: string
        exit?: number
        code?: number
        sessionID?: string
        [key: string]: unknown
    }
}

export interface OpencodeSessionErrorEvent extends OpencodeBaseEvent {
    type: "session.error"
    properties?: {
        error?: unknown
        message?: string
        sessionID?: string
        [key: string]: unknown
    }
    error?: OpencodeErrorEvent["error"]
    message?: string
}

export interface OpencodeGenericKnownEvent extends OpencodeBaseEvent {
    type: "permission.asked" | "permission.replied" | "question.asked" | "question.replied" | "question.rejected"
    properties?: Record<string, unknown>
}

export interface OpencodeRawJsonEvent {
    type: "raw_json"
    original_type?: string
    raw: Record<string, unknown>
}

export interface OpencodePart {
    id?: string
    sessionID?: string
    messageID?: string
    type?: string
    text?: string
    snapshot?: string
    tool?: string
    state?: OpencodeToolState
    reason?: string
    cost?: number
    tokens?: OpencodeTokens
    [key: string]: unknown
}

export interface OpencodeToolState {
    status?: "pending" | "running" | "completed" | "error" | string
    input?: unknown
    output?: unknown
    title?: string
    metadata?: {
        exit?: number
        [key: string]: unknown
    }
    [key: string]: unknown
}

export interface OpencodeTokens {
    total?: number
    input?: number
    output?: number
    reasoning?: number
    cache?: {
        read?: number
        write?: number
        [key: string]: unknown
    }
    [key: string]: unknown
}

const KNOWN_TOP_TYPES = new Set([
    "step_start",
    "text",
    "tool_use",
    "step_finish",
    "error",
    "message.updated",
    "message.part.delta",
    "message.part.updated",
    "permission.asked",
    "permission.replied",
    "question.asked",
    "question.replied",
    "question.rejected",
    "session.next.shell.started",
    "session.next.shell.ended",
    "session.error",
])

/**
 * Parses a raw JSON object into a typed OpencodeEvent.
 * Preserves unknown event types as raw_json so consumers can surface them.
 */
export function parseOpencodeEvent(json: unknown): OpencodeEvent | null {
    if (!json || typeof json !== "object") return null

    const obj = json as Record<string, unknown>
    const type = obj.type as string | undefined

    if (!type) return null

    if (KNOWN_TOP_TYPES.has(type)) {
        return obj as unknown as OpencodeEvent
    }

    return {
        type: "raw_json",
        original_type: type,
        raw: obj,
    }
}
