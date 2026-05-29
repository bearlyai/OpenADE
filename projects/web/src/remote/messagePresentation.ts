import type { RemoteQueuedTurn, RemoteTask } from "../../../shared/companion/src"
import { groupStreamEvents } from "../components/events/messageGroups"
import { compactText, presentMessageGroup, stringifyRaw, type PresentedGroup } from "../components/events/presentation"
import type { HarnessId, HarnessStreamEvent } from "../electronAPI/harnessEventTypes"

export type RemoteEventBlockKind = "action" | "setup" | "snapshot" | "queued" | "unknown"

export interface RemoteActionBlock {
    kind: "action"
    id: string
    title: string
    status?: string
    createdAt?: string
    userInput?: string
    groups: PresentedGroup[]
    emptyText: string
}

export interface RemoteSetupBlock {
    kind: "setup"
    id: string
    title: string
    status?: string
    createdAt?: string
    body: string
}

export interface RemoteSnapshotBlock {
    kind: "snapshot"
    id: string
    title: string
    status?: string
    createdAt?: string
    referenceBranch?: string
    filesChanged: number
    insertions: number
    deletions: number
}

export interface RemoteQueuedTurnBlock {
    kind: "queued"
    id: string
    title: string
    status: RemoteQueuedTurn["status"]
    createdAt?: string
    body: string
}

export interface RemoteUnknownBlock {
    kind: "unknown"
    id: string
    title: string
    status?: string
    createdAt?: string
    body: string
}

export type RemoteEventBlock = RemoteActionBlock | RemoteSetupBlock | RemoteSnapshotBlock | RemoteQueuedTurnBlock | RemoteUnknownBlock

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

function eventSourceLabel(event: Record<string, unknown>): string {
    const source = isRecord(event.source) ? event.source : null
    return firstString(source?.userLabel, source?.type, event.type) ?? "Event"
}

function asHarnessId(value: unknown): HarnessId | undefined {
    return value === "claude-code" || value === "codex" ? value : undefined
}

function actionBlock(rawEvent: Record<string, unknown>, eventId: string): RemoteActionBlock {
    const execution = isRecord(rawEvent.execution) ? rawEvent.execution : null
    const streamEvents = Array.isArray(execution?.events) ? execution.events : []
    const harnessId = asHarnessId(execution?.harnessId) ?? asHarnessId(streamEvents.find(isRecord)?.harnessId)
    const groups = harnessId ? groupStreamEvents(streamEvents as HarnessStreamEvent[], harnessId).map((group, index) => presentMessageGroup(group, index)) : []

    return {
        kind: "action",
        id: eventId,
        title: eventSourceLabel(rawEvent),
        status: asString(rawEvent.status),
        createdAt: asString(rawEvent.createdAt),
        userInput: asString(rawEvent.userInput),
        groups,
        emptyText: asString(rawEvent.status) ?? "updated",
    }
}

function setupBlock(rawEvent: Record<string, unknown>, eventId: string): RemoteSetupBlock {
    return {
        kind: "setup",
        id: eventId,
        title: "Environment",
        status: asString(rawEvent.status),
        createdAt: asString(rawEvent.createdAt),
        body: compactText(firstString(rawEvent.setupOutput, rawEvent.workingDir) ?? "Environment ready", 1200),
    }
}

function snapshotBlock(rawEvent: Record<string, unknown>, eventId: string): RemoteSnapshotBlock {
    const stats = isRecord(rawEvent.stats) ? rawEvent.stats : null
    return {
        kind: "snapshot",
        id: eventId,
        title: "Snapshot",
        status: asString(rawEvent.status),
        createdAt: asString(rawEvent.createdAt),
        referenceBranch: asString(rawEvent.referenceBranch),
        filesChanged: typeof stats?.filesChanged === "number" ? stats.filesChanged : 0,
        insertions: typeof stats?.insertions === "number" ? stats.insertions : 0,
        deletions: typeof stats?.deletions === "number" ? stats.deletions : 0,
    }
}

function unknownBlock(rawEvent: Record<string, unknown>, eventId: string): RemoteUnknownBlock {
    return {
        kind: "unknown",
        id: eventId,
        title: eventSourceLabel(rawEvent),
        status: asString(rawEvent.status),
        createdAt: asString(rawEvent.createdAt),
        body: compactText(asString(rawEvent.status) ?? stringifyRaw(rawEvent), 2000),
    }
}

function queuedTurnBlock(turn: RemoteQueuedTurn): RemoteQueuedTurnBlock {
    return {
        kind: "queued",
        id: `${turn.id}:queued-turn`,
        title: turn.type === "ask" ? "Queued Ask" : "Queued Do",
        status: turn.status,
        createdAt: turn.createdAt,
        body: compactText(turn.input, 1800),
    }
}

export function taskEventBlocks(task: RemoteTask | null): RemoteEventBlock[] {
    if (!task) return []

    const blocks: RemoteEventBlock[] = []
    for (const [index, rawEvent] of task.events.entries()) {
        if (!isRecord(rawEvent)) continue

        const eventId = asString(rawEvent.id) ?? `${index}`
        if (rawEvent.type === "action") {
            blocks.push(actionBlock(rawEvent, eventId))
        } else if (rawEvent.type === "setup_environment") {
            blocks.push(setupBlock(rawEvent, eventId))
        } else if (rawEvent.type === "snapshot") {
            blocks.push(snapshotBlock(rawEvent, eventId))
        } else {
            blocks.push(unknownBlock(rawEvent, eventId))
        }
    }

    for (const turn of task.queuedTurns ?? []) {
        blocks.push(queuedTurnBlock(turn))
    }

    return blocks
}
