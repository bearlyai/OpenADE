import type { OpenADEQueuedTurn, OpenADETask } from "../../../../openade-module/src"
import { groupStreamEvents } from "../../components/events/messageGroups"
import { compactText, presentMessageGroup, stringifyRaw, type PresentedGroup } from "../../components/events/presentation"
import type { HarnessId, HarnessStreamEvent } from "../../electronAPI/harnessEventTypes"

export type TaskEventBlockKind = "action" | "setup" | "snapshot" | "queued" | "unknown"

export interface TaskActionBlock {
    kind: "action"
    id: string
    title: string
    status?: string
    createdAt?: string
    userInput?: string
    images: TaskImageAttachment[]
    groups: PresentedGroup[]
    emptyText: string
}

export interface TaskImageAttachment {
    id: string
    ext: string
    mediaType?: string
    originalWidth?: number
    originalHeight?: number
    resizedWidth?: number
    resizedHeight?: number
}

export interface TaskSetupBlock {
    kind: "setup"
    id: string
    title: string
    status?: string
    createdAt?: string
    body: string
}

export interface TaskSnapshotBlock {
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

export interface TaskQueuedTurnBlock {
    kind: "queued"
    id: string
    title: string
    status: OpenADEQueuedTurn["status"]
    createdAt?: string
    body: string
}

export interface TaskUnknownBlock {
    kind: "unknown"
    id: string
    title: string
    status?: string
    createdAt?: string
    body: string
}

export type TaskEventBlock = TaskActionBlock | TaskSetupBlock | TaskSnapshotBlock | TaskQueuedTurnBlock | TaskUnknownBlock

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

function numberField(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function imageAttachment(value: unknown): TaskImageAttachment | null {
    if (!isRecord(value)) return null
    if (typeof value.id !== "string" || typeof value.ext !== "string") return null
    if (!/^[a-zA-Z0-9_-]+$/.test(value.id) || !/^[a-zA-Z0-9]+$/.test(value.ext)) return null
    return {
        id: value.id,
        ext: value.ext.toLowerCase(),
        mediaType: typeof value.mediaType === "string" && value.mediaType.startsWith("image/") ? value.mediaType : undefined,
        originalWidth: numberField(value.originalWidth),
        originalHeight: numberField(value.originalHeight),
        resizedWidth: numberField(value.resizedWidth),
        resizedHeight: numberField(value.resizedHeight),
    }
}

function imageAttachments(value: unknown): TaskImageAttachment[] {
    if (!Array.isArray(value)) return []
    return value.map(imageAttachment).filter((image): image is TaskImageAttachment => image !== null)
}

function actionBlock(rawEvent: Record<string, unknown>, eventId: string): TaskActionBlock {
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
        images: imageAttachments(rawEvent.images),
        groups,
        emptyText: asString(rawEvent.status) ?? "updated",
    }
}

function setupBlock(rawEvent: Record<string, unknown>, eventId: string): TaskSetupBlock {
    return {
        kind: "setup",
        id: eventId,
        title: "Environment",
        status: asString(rawEvent.status),
        createdAt: asString(rawEvent.createdAt),
        body: compactText(firstString(rawEvent.setupOutput, rawEvent.workingDir) ?? "Environment ready", 1200),
    }
}

function snapshotBlock(rawEvent: Record<string, unknown>, eventId: string): TaskSnapshotBlock {
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

function unknownBlock(rawEvent: Record<string, unknown>, eventId: string): TaskUnknownBlock {
    return {
        kind: "unknown",
        id: eventId,
        title: eventSourceLabel(rawEvent),
        status: asString(rawEvent.status),
        createdAt: asString(rawEvent.createdAt),
        body: compactText(asString(rawEvent.status) ?? stringifyRaw(rawEvent), 2000),
    }
}

function queuedTurnBlock(turn: OpenADEQueuedTurn): TaskQueuedTurnBlock {
    return {
        kind: "queued",
        id: `${turn.id}:queued-turn`,
        title: turn.type === "ask" ? "Queued Ask" : "Queued Do",
        status: turn.status,
        createdAt: turn.createdAt,
        body: compactText(turn.input, 1800),
    }
}

export function taskEventBlocks(task: Pick<OpenADETask, "events" | "queuedTurns"> | null): TaskEventBlock[] {
    if (!task) return []

    const blocks: TaskEventBlock[] = []
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
