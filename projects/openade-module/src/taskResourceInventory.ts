import type { OpenADETask, OpenADETaskResourceInventory } from "./types"

function record(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null
}

function collectSnapshotPatchIds(task: OpenADETask): string[] {
    const ids = new Set<string>()
    for (const rawEvent of task.events) {
        const event = record(rawEvent)
        if (event?.type === "snapshot" && typeof event.patchFileId === "string" && event.patchFileId.length > 0) {
            ids.add(event.patchFileId)
        }
    }
    return [...ids]
}

function collectTaskImages(task: OpenADETask): Array<{ id: string; ext: string }> {
    const images = new Map<string, { id: string; ext: string }>()
    for (const rawEvent of task.events) {
        const event = record(rawEvent)
        if (event?.type !== "action" || !Array.isArray(event.images)) continue
        for (const rawImage of event.images) {
            const image = record(rawImage)
            if (typeof image?.id === "string" && typeof image.ext === "string") {
                images.set(`${image.id}.${image.ext}`, { id: image.id, ext: image.ext })
            }
        }
    }
    return [...images.values()]
}

function collectTaskSessions(task: OpenADETask): Array<{ sessionId: string; harnessId: string }> {
    const sessions = new Map<string, string>()

    for (const rawEvent of task.events) {
        const event = record(rawEvent)
        if (event?.type !== "action") continue

        const execution = record(event.execution)
        const harnessId = typeof execution?.harnessId === "string" ? execution.harnessId : "claude-code"
        if (typeof execution?.sessionId === "string" && execution.sessionId.length > 0) {
            sessions.set(execution.sessionId, harnessId)
        }

        const subExecutions = Array.isArray(event.hyperplanSubExecutions) ? event.hyperplanSubExecutions : []
        for (const rawSubExecution of subExecutions) {
            const subExecution = record(rawSubExecution)
            const subHarnessId = typeof subExecution?.harnessId === "string" ? subExecution.harnessId : harnessId
            if (typeof subExecution?.sessionId === "string" && subExecution.sessionId.length > 0) {
                sessions.set(subExecution.sessionId, subHarnessId)
            }
        }
    }

    for (const sessionId of Object.values(task.sessionIds ?? {})) {
        if (!sessions.has(sessionId)) sessions.set(sessionId, "claude-code")
    }

    return [...sessions.entries()].map(([sessionId, harnessId]) => ({ sessionId, harnessId }))
}

export function buildOpenADETaskResourceInventory(params: {
    task: OpenADETask
    isRunning: boolean
    branchMerged?: boolean | null
}): OpenADETaskResourceInventory {
    const { task } = params
    const sourceBranch = task.isolationStrategy?.type === "worktree" ? task.isolationStrategy.sourceBranch : null

    return {
        repoId: task.repoId,
        taskId: task.id,
        taskTitle: task.title || task.description || "Untitled",
        isRunning: params.isRunning,
        snapshotIds: collectSnapshotPatchIds(task),
        images: collectTaskImages(task),
        sessions: collectTaskSessions(task),
        worktree: sourceBranch
            ? {
                  slug: task.slug,
                  branchName: `openade/${task.slug}`,
                  sourceBranch,
                  branchMerged: params.branchMerged ?? null,
              }
            : null,
    }
}
