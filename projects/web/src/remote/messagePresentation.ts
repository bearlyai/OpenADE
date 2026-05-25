import type { RemoteTask } from "../../../shared/companion/src"
import { groupStreamEvents, type MessageGroup } from "../components/events/messageGroups"
import type { HarnessId, HarnessStreamEvent } from "../electronAPI/harnessEventTypes"

export type RemoteMessageKind = "user" | "assistant" | "system" | "tool" | "snapshot" | "error" | "activity"

export type RemoteActivityTone = "muted" | "ok" | "warn" | "bad" | "info"

export interface RemoteActivity {
    id: string
    label: string
    detail?: string
    tone?: RemoteActivityTone
}

export interface RemoteMessage {
    id: string
    kind: RemoteMessageKind
    title?: string
    body: string
    meta?: string
    status?: string
    activity?: RemoteActivity[]
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

function compactText(value: string, maxLength = 3200): string {
    const normalized = value.replace(/\n{3,}/g, "\n\n").trim()
    if (normalized.length <= maxLength) return normalized
    return `${normalized.slice(0, maxLength).trim()}...`
}

function compactInline(value: string, maxLength = 96): string {
    const normalized = value.replace(/\s+/g, " ").trim()
    if (normalized.length <= maxLength) return normalized
    return `${normalized.slice(0, maxLength).trim()}...`
}

function eventSourceLabel(event: Record<string, unknown>): string {
    const source = isRecord(event.source) ? event.source : null
    return firstString(source?.userLabel, source?.type, event.type) ?? "Event"
}

function asHarnessId(value: unknown): HarnessId | undefined {
    return value === "claude-code" || value === "codex" ? value : undefined
}

function fileName(value: string): string {
    return value.split(/[\\/]/).filter(Boolean).pop() ?? value
}

function activityDetailFromInput(input: unknown): string | undefined {
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

function resultDetail(group: Extract<MessageGroup, { type: "result" }>): string | undefined {
    if (group.errors?.length) return compactInline(group.errors.join("; "))
    const inputTokens = group.usage?.inputTokens ?? 0
    const outputTokens = group.usage?.outputTokens ?? 0
    if (inputTokens || outputTokens) return `${inputTokens.toLocaleString()} in, ${outputTokens.toLocaleString()} out`
    if (group.durationMs) return `${Math.round(group.durationMs / 1000)}s`
    return undefined
}

function activityForGroup(group: MessageGroup, index: number): RemoteActivity | null {
    switch (group.type) {
        case "text":
            return null
        case "thinking":
            return {
                id: `thinking:${group.messageIndex}:${index}`,
                label: "Thinking",
                detail: group.text ? compactInline(group.text) : undefined,
                tone: "info",
            }
        case "tool":
            return {
                id: `tool:${group.toolUseId}:${index}`,
                label: group.toolName,
                detail: activityDetailFromInput(group.input),
                tone: group.isError ? "bad" : "muted",
            }
        case "bash":
            return {
                id: `bash:${group.toolUseId}:${index}`,
                label: group.isPending ? "Shell running" : "Shell",
                detail: compactInline(group.command),
                tone: group.isError ? "bad" : group.isPending ? "warn" : "muted",
            }
        case "edit":
            return {
                id: `edit:${group.toolUseId}:${index}`,
                label: group.isPending ? "Editing" : "Edited",
                detail: fileName(group.filePath),
                tone: group.isError ? "bad" : group.isPending ? "warn" : "muted",
            }
        case "write":
            return {
                id: `write:${group.toolUseId}:${index}`,
                label: group.isPending ? "Writing" : "Wrote",
                detail: fileName(group.filePath),
                tone: group.isError ? "bad" : group.isPending ? "warn" : "muted",
            }
        case "fileChange":
            return {
                id: `file:${group.toolUseId}:${group.changeIndex}:${index}`,
                label: group.status || group.kind || "Changed",
                detail: fileName(group.filePath),
                tone: group.isError ? "bad" : group.isPending ? "warn" : "muted",
            }
        case "todoWrite": {
            const completed = group.todos.filter((todo) => todo.status === "completed").length
            const active = group.todos.filter((todo) => todo.status === "in_progress").length
            return {
                id: `todo:${group.toolUseId}:${index}`,
                label: "Todo",
                detail: `${completed}/${group.todos.length} done${active ? `, ${active} active` : ""}`,
                tone: group.isError ? "bad" : group.isPending ? "warn" : "muted",
            }
        }
        case "system":
            return {
                id: `system:${group.subtype}:${group.messageIndex}:${index}`,
                label: group.subtype.replace(/_/g, " "),
                tone: "muted",
            }
        case "result":
            return {
                id: `result:${group.subtype}:${group.messageIndex}:${index}`,
                label: group.isError ? "Failed" : "Completed",
                detail: resultDetail(group),
                tone: group.isError ? "bad" : "ok",
            }
        case "stderr":
            return {
                id: `stderr:${group.eventId}:${index}`,
                label: "stderr",
                detail: compactInline(group.data),
                tone: "warn",
            }
        case "unknown":
            return {
                id: `unknown:${group.messageIndex}:${index}`,
                label: group.label,
                detail: group.originalType,
                tone: "muted",
            }
    }
}

function executionMessages(event: Record<string, unknown>, eventId: string): RemoteMessage[] {
    const execution = isRecord(event.execution) ? event.execution : null
    const streamEvents = Array.isArray(execution?.events) ? execution.events : []
    const messages: RemoteMessage[] = []
    const harnessId = asHarnessId(execution?.harnessId) ?? asHarnessId(streamEvents.find(isRecord)?.harnessId)
    const groups = harnessId ? groupStreamEvents(streamEvents as HarnessStreamEvent[], harnessId) : []
    let activities: RemoteActivity[] = []

    const flushActivities = () => {
        if (activities.length === 0) return
        messages.push({
            id: `${eventId}:activity:${messages.length}`,
            kind: "activity",
            title: "Activity",
            body: activities.map((activity) => [activity.label, activity.detail].filter(Boolean).join(": ")).join("\n"),
            activity: activities,
        })
        activities = []
    }

    for (const [index, group] of groups.entries()) {
        if (group.type === "text") {
            flushActivities()
            messages.push({
                id: `${eventId}:assistant:${group.messageIndex}:${index}`,
                kind: "assistant",
                title: eventSourceLabel(event),
                body: compactText(group.text),
                status: asString(event.status),
            })
            continue
        }

        const activity = activityForGroup(group, index)
        if (activity) activities.push(activity)
    }
    flushActivities()

    if (messages.length === 0) {
        messages.push({
            id: `${eventId}:status`,
            kind: "system",
            title: eventSourceLabel(event),
            body: asString(event.status) ?? "updated",
        })
    }

    return messages
}

export function taskMessages(task: RemoteTask | null): RemoteMessage[] {
    if (!task) return []

    const messages: RemoteMessage[] = []
    for (const [index, rawEvent] of task.events.entries()) {
        if (!isRecord(rawEvent)) continue

        const eventId = asString(rawEvent.id) ?? `${index}`
        const userInput = asString(rawEvent.userInput)
        if (userInput) {
            messages.push({
                id: `${eventId}:user`,
                kind: "user",
                body: compactText(userInput, 1800),
                meta: eventSourceLabel(rawEvent),
            })
        }

        if (rawEvent.type === "action") {
            messages.push(...executionMessages(rawEvent, eventId))
            continue
        }

        if (rawEvent.type === "setup_environment") {
            messages.push({
                id: `${eventId}:setup`,
                kind: "system",
                title: "Environment",
                body: compactText(firstString(rawEvent.setupOutput, rawEvent.workingDir) ?? "Environment ready", 1200),
                status: asString(rawEvent.status),
            })
            continue
        }

        if (rawEvent.type === "snapshot") {
            const stats = isRecord(rawEvent.stats) ? rawEvent.stats : null
            const filesChanged = typeof stats?.filesChanged === "number" ? stats.filesChanged : 0
            const insertions = typeof stats?.insertions === "number" ? stats.insertions : 0
            const deletions = typeof stats?.deletions === "number" ? stats.deletions : 0
            messages.push({
                id: `${eventId}:snapshot`,
                kind: "snapshot",
                title: "Snapshot",
                body: `${filesChanged} files changed, +${insertions} -${deletions}`,
                meta: asString(rawEvent.referenceBranch),
                status: asString(rawEvent.status),
            })
            continue
        }

        messages.push({
            id: `${eventId}:event`,
            kind: "system",
            title: eventSourceLabel(rawEvent),
            body: asString(rawEvent.status) ?? "updated",
        })
    }

    return messages
}
