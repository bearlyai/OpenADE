/**
 * Harness Event Compatibility Layer
 *
 * Normalizes persisted v1 events (ClaudeStreamEvent) to v2 (HarnessStreamEvent).
 * v1 events have type:"sdk_message" and no harnessId field.
 * v2 events have type:"raw_message" and a harnessId field.
 */

import type { HarnessStreamEvent } from "./harnessEventTypes"

/**
 * Normalize a persisted event that may be v1 (ClaudeStreamEvent) or v2 (HarnessStreamEvent).
 * v1 events have type:"sdk_message" and no harnessId field.
 * v2 events have type:"raw_message" and a harnessId field.
 */
export function normalizePersistedEvent(event: Record<string, unknown>): HarnessStreamEvent {
    // Already v2 — has harnessId
    if ("harnessId" in event) return event as HarnessStreamEvent

    // v1 → v2 normalization
    if (event.type === "sdk_message") {
        return {
            ...event,
            type: "raw_message",
            harnessId: "claude-code",
        } as HarnessStreamEvent
    }

    // v1 command events and other execution events — inject harnessId
    return {
        ...event,
        harnessId: "claude-code",
    } as HarnessStreamEvent
}

/** Normalize an array of persisted events */
export function normalizePersistedEvents(events: unknown[]): HarnessStreamEvent[] {
    return events.map((e) => normalizePersistedEvent(e as Record<string, unknown>))
}
