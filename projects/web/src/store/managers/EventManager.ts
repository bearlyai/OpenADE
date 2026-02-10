/**
 * EventManager
 *
 * Manages event operations using TaskStore:
 * - Event CRUD operations
 * - Plan lookups
 * - Snapshot operations
 *
 * Note: Comments are now managed by CommentManager at the Task level.
 */

import { exhaustive } from "exhaustive"
import type { ClaudeStreamEvent } from "../../electronAPI/claude"
import { extractSDKMessages } from "../../electronAPI/claudeEventTypes"
import { snapshotsApi } from "../../electronAPI/snapshots"
import { syncTaskPreviewFromStore, taskFromStore } from "../../persistence"
import type { ActionEvent, ActionEventSource, GitRefs, ImageAttachment, SnapshotEvent } from "../../types"
import { ulid } from "../../utils/ulid"
import type { CodeStore } from "../store"

// PR URL patterns for GitHub and GitLab
const PR_URL_PATTERNS = [/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/, /https:\/\/gitlab\.com\/[^/]+\/[^/]+\/-\/merge_requests\/\d+/]

/** Extract a PR URL from LLM execution output */
function extractPrUrl(events: ClaudeStreamEvent[]): string | null {
    const sdkMessages = extractSDKMessages(events)
    for (const msg of sdkMessages) {
        if (msg.type !== "assistant") continue
        const message = msg as { message?: { content?: unknown } }
        if (!message.message?.content || !Array.isArray(message.message.content)) continue
        const content = message.message.content as Array<{ type: string; text?: string }>
        for (const block of content) {
            if (block.type !== "text" || !block.text) continue
            for (const pattern of PR_URL_PATTERNS) {
                const match = block.text.match(pattern)
                if (match) return match[0]
            }
        }
    }
    return null
}

/** Parse a PR URL into provider, number, and normalized URL */
function parsePrUrl(url: string): { url: string; number?: number; provider: "github" | "gitlab" | "other" } {
    if (url.includes("github.com")) {
        const match = url.match(/\/pull\/(\d+)/)
        return { url, number: match ? Number.parseInt(match[1], 10) : undefined, provider: "github" }
    }
    if (url.includes("gitlab.com")) {
        const match = url.match(/\/merge_requests\/(\d+)/)
        return { url, number: match ? Number.parseInt(match[1], 10) : undefined, provider: "gitlab" }
    }
    return { url, provider: "other" }
}

export class EventManager {
    constructor(private store: CodeStore) {}

    // ==================== Plan Lookups ====================

    /** Get the latest completed plan/revise event for a task */
    getTaskLatestCompletedPlanEvent(taskId: string): ActionEvent | null {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return null

        const events = taskStore.events.all()
        for (let i = events.length - 1; i >= 0; i--) {
            const event = events[i]
            if (event.type === "action" && (event.source.type === "plan" || event.source.type === "revise") && event.status === "completed") {
                return event
            }
        }
        return null
    }

    /**
     * Check if an action event failed due to defunct session (forking from expired session).
     * Returns the defunct session ID if found, or null if no defunct session error.
     */
    getDefunctSessionId(event: ActionEvent): string | null {
        // Check stderr events
        const stderrText = event.execution.events
            .filter((e): e is ClaudeStreamEvent & { type: "stderr"; direction: "execution" } => e.direction === "execution" && e.type === "stderr")
            .map((e) => e.data)
            .join(" ")

        // Check error events
        const errorText = event.execution.events
            .filter((e): e is ClaudeStreamEvent & { type: "error"; direction: "execution" } => e.direction === "execution" && e.type === "error")
            .map((e) => e.error)
            .join(" ")

        // Check SDK result messages for errors array
        const resultErrors: string[] = []
        for (const e of event.execution.events) {
            if (e.direction === "execution" && e.type === "sdk_message") {
                const msg = e.message as { type?: string; errors?: string[] }
                if (msg.type === "result" && msg.errors) {
                    resultErrors.push(...msg.errors)
                }
            }
        }

        const combined = stderrText + " " + errorText + " " + resultErrors.join(" ")

        // Try to extract session ID from error message like "No conversation found with session ID: <uuid>"
        const match = combined.match(/no conversation found with session id[:\s]+([a-f0-9-]+)/i)
        if (match) {
            return match[1]
        }

        // Fallback: check if it's a generic session not found error
        const lower = combined.toLowerCase()
        if (lower.includes("no conversation found") || (lower.includes("session") && lower.includes("not found"))) {
            // Can't extract the session ID, but we know there's a defunct session error
            // Return the parentSessionId if available, otherwise null
            return event.execution.parentSessionId || null
        }

        return null
    }

    /** Check if an action event failed due to defunct session (forking from expired session) */
    hasDefunctSessionError(event: ActionEvent): boolean {
        return this.getDefunctSessionId(event) !== null
    }

    /** Get the session ID from the last event with an execution, skipping defunct sessions */
    getLastEventSessionId(taskId: string): string | undefined {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return undefined

        const events = taskStore.events.all()

        // Walk backwards, collecting defunct sessions as we go
        const defunctSessionIds = new Set<string>()
        for (let i = events.length - 1; i >= 0; i--) {
            const event = events[i]
            if (event.type !== "action") continue

            // If this event has defunct session error, extract and mark the defunct session ID
            const defunctSessionId = this.getDefunctSessionId(event)
            if (defunctSessionId) {
                defunctSessionIds.add(defunctSessionId)
                // Also mark this event's own session as defunct if it has one
                if (event.execution.sessionId) {
                    defunctSessionIds.add(event.execution.sessionId)
                }
            }

            // Return first valid session we find
            if (event.execution.sessionId && !defunctSessionIds.has(event.execution.sessionId)) {
                return event.execution.sessionId
            }
        }
        return undefined
    }

    // ==================== Event CRUD Operations ====================

    createActionEvent({
        taskId,
        userInput,
        images,
        executionId,
        source,
        includesCommentIds = [],
        modelId,
        gitRefsBefore,
    }: {
        taskId: string
        userInput: string
        images?: ImageAttachment[]
        executionId: string
        source: ActionEventSource
        includesCommentIds?: string[]
        modelId?: string
        gitRefsBefore?: GitRefs
    }): { eventId: string } | null {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return null

        const now = new Date().toISOString()
        const eventId = ulid()
        const event: ActionEvent & { id: string } = {
            id: eventId,
            type: "action",
            status: "in_progress",
            createdAt: now,
            userInput,
            ...(images && images.length > 0 ? { images } : {}),
            execution: {
                type: "claude-code",
                executionId,
                modelId,
                events: [],
                gitRefsBefore,
            },
            source,
            includesCommentIds,
        }

        taskStore.events.push(event)
        taskStore.meta.update((draft) => {
            draft.updatedAt = now
        })

        return { eventId }
    }

    appendStreamEventToEvent({
        taskId,
        eventId,
        streamEvent,
    }: {
        taskId: string
        eventId: string
        streamEvent: ClaudeStreamEvent
    }): void {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) {
            console.debug("[EventManager] appendStreamEventToEvent: no taskStore", { taskId })
            return
        }

        console.debug("[EventManager] appendStreamEventToEvent", { taskId, eventId, streamEventType: streamEvent.type })

        taskStore.events.update(eventId, (draft) => {
            if (draft.type !== "action") return
            if (draft.execution.events.some((e) => e.id === streamEvent.id)) return
            draft.execution.events.push(streamEvent)
        })
    }

    completeActionEvent({
        taskId,
        eventId,
        success,
    }: {
        taskId: string
        eventId: string
        success: boolean
    }): void {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        const now = new Date().toISOString()
        taskStore.events.update(eventId, (draft) => {
            if (draft.type !== "action") return
            draft.status = "completed"
            draft.completedAt = now
            draft.result = { success }
        })

        // Extract PR URL from Push action output and save to task metadata
        const event = taskStore.events.all().find((e) => e.id === eventId)
        if (event?.type === "action" && event.source.userLabel === "Push" && success) {
            const prUrl = extractPrUrl(event.execution.events)
            if (prUrl) {
                const prInfo = parsePrUrl(prUrl)
                taskStore.meta.update((draft) => {
                    draft.pullRequest = prInfo
                })
            }
        }

        taskStore.meta.update((draft) => {
            draft.updatedAt = now
            draft.lastEventAt = now
        })

        // Sync to RepoStore for sidebar
        if (this.store.repoStore) {
            syncTaskPreviewFromStore(this.store.repoStore, taskStore.meta.current.repoId, taskStore)
        }
    }

    errorEvent(taskId: string, eventId: string): void {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        const now = new Date().toISOString()
        taskStore.events.update(eventId, (draft) => {
            draft.status = "error"
            draft.completedAt = now
        })

        taskStore.meta.update((draft) => {
            draft.updatedAt = now
        })

        // Sync to RepoStore for sidebar
        if (this.store.repoStore) {
            syncTaskPreviewFromStore(this.store.repoStore, taskStore.meta.current.repoId, taskStore)
        }
    }

    stoppedEvent({
        taskId,
        eventId,
        sessionId,
        parentSessionId,
    }: {
        taskId: string
        eventId: string
        sessionId?: string
        parentSessionId?: string
    }): void {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        const now = new Date().toISOString()
        taskStore.events.update(eventId, (draft) => {
            draft.status = "stopped"
            draft.completedAt = now

            if (draft.type === "action") {
                if (sessionId) draft.execution.sessionId = sessionId
                if (parentSessionId) draft.execution.parentSessionId = parentSessionId
            }
        })

        taskStore.meta.update((draft) => {
            draft.updatedAt = now
        })
    }

    deleteEvent(taskId: string, eventId: string): void {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        taskStore.events.delete(eventId)

        taskStore.meta.update((draft) => {
            draft.updatedAt = new Date().toISOString()
        })
    }

    updateEventSessionIds({
        taskId,
        eventId,
        sessionId,
        parentSessionId,
    }: {
        taskId: string
        eventId: string
        sessionId: string
        parentSessionId?: string
    }): void {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        taskStore.events.update(eventId, (draft) => {
            if (draft.type !== "action") return
            draft.execution.sessionId = sessionId
            draft.execution.parentSessionId = parentSessionId
        })
    }

    updateEventGitRefsAfter({
        taskId,
        eventId,
        gitRefsAfter,
    }: {
        taskId: string
        eventId: string
        gitRefsAfter: GitRefs
    }): void {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return

        taskStore.events.update(eventId, (draft) => {
            if (draft.type !== "action") return
            draft.execution.gitRefsAfter = gitRefsAfter
        })
    }

    // ==================== Snapshot Operations ====================

    /** Get the latest snapshot event for a task */
    private getLatestSnapshotEvent(taskId: string): SnapshotEvent | null {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return null

        const events = taskStore.events.all()
        for (let i = events.length - 1; i >= 0; i--) {
            const event = events[i]
            if (event.type === "snapshot") {
                return event
            }
        }
        return null
    }

    /** Load the patch content for a snapshot (from file if stored externally) */
    private async loadSnapshotPatch(snapshot: SnapshotEvent): Promise<string> {
        // If patch is stored inline, return it
        if (snapshot.fullPatch) {
            return snapshot.fullPatch
        }

        // If stored in file, load it
        if (snapshot.patchFileId && snapshotsApi.isAvailable()) {
            const patch = await snapshotsApi.load(snapshot.patchFileId)
            return patch ?? ""
        }

        return ""
    }

    /**
     * Create a snapshot event after an action completes.
     * Returns true if snapshot was created, false if skipped.
     */
    async createSnapshot({
        taskId,
        actionEventId,
    }: {
        taskId: string
        actionEventId: string
    }): Promise<boolean> {
        const taskModel = this.store.tasks.getTaskModel(taskId)
        if (!taskModel) {
            console.debug("[EventManager] createSnapshot: Task not found")
            return false
        }

        const env = taskModel.environment
        if (!env) {
            console.debug("[EventManager] createSnapshot: Environment not available")
            return false
        }

        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) {
            return false
        }

        const task = taskFromStore(taskStore)

        // Get reference branch and merge base from isolation strategy
        const { referenceBranch, mergeBaseCommit } = exhaustive.tag(task.isolationStrategy, "type", {
            worktree: (s) => ({
                referenceBranch: s.sourceBranch,
                mergeBaseCommit: env.mergeBaseCommit ?? "HEAD",
            }),
            head: () => ({
                referenceBranch: "uncommitted",
                mergeBaseCommit: "HEAD",
            }),
        })

        try {
            console.debug("[EventManager] createSnapshot: Generating patch for task", taskId)

            const patchResult = await env.getPatch()
            if (!patchResult) {
                console.debug("[EventManager] createSnapshot: Skipping - getPatch returned null")
                return false
            }

            console.debug("[EventManager] createSnapshot: Patch generated", {
                patchSize: patchResult.patch.length,
                stats: patchResult.stats,
            })

            // Skip empty snapshots
            if (patchResult.stats.filesChanged === 0 && patchResult.stats.insertions === 0 && patchResult.stats.deletions === 0) {
                console.debug("[EventManager] createSnapshot: Skipping - no changes to snapshot")
                return false
            }

            // Skip if patch is identical to the previous snapshot
            const lastSnapshot = this.getLatestSnapshotEvent(taskId)
            if (lastSnapshot) {
                const lastPatch = await this.loadSnapshotPatch(lastSnapshot)
                if (lastPatch === patchResult.patch) {
                    console.debug("[EventManager] createSnapshot: Skipping - patch identical to previous snapshot")
                    return false
                }
            }

            const now = new Date().toISOString()
            const eventId = ulid()

            // Save patch to filesystem if available, otherwise store inline
            let fullPatch = patchResult.patch
            let patchFileId: string | undefined

            if (snapshotsApi.isAvailable()) {
                try {
                    await snapshotsApi.save(eventId, patchResult.patch)
                    fullPatch = "" // Don't store inline when saved to file
                    patchFileId = eventId
                    console.debug("[EventManager] createSnapshot: Patch saved to file", { eventId, size: patchResult.patch.length })
                } catch (err) {
                    console.warn("[EventManager] createSnapshot: Failed to save patch to file, storing inline:", err)
                    // Fall back to inline storage
                }
            }

            const event: SnapshotEvent & { id: string } = {
                id: eventId,
                type: "snapshot",
                status: "completed",
                createdAt: now,
                completedAt: now,
                userInput: "",
                actionEventId,
                referenceBranch,
                mergeBaseCommit,
                fullPatch,
                patchFileId,
                stats: patchResult.stats,
            }

            taskStore.events.push(event)
            taskStore.meta.update((draft) => {
                draft.updatedAt = now
            })

            console.debug("[EventManager] createSnapshot: Snapshot event created")
            return true
        } catch (err) {
            console.error("[EventManager] createSnapshot: Failed to create snapshot (non-blocking):", err)
            return false
        }
    }

    // ==================== Plan Cancellation ====================

    cancelPlan(taskId: string, planEventId: string): boolean {
        const taskStore = this.store.getCachedTaskStore(taskId)
        if (!taskStore) return false

        taskStore.meta.update((draft) => {
            draft.cancelledPlanEventId = planEventId
            draft.updatedAt = new Date().toISOString()
        })

        return true
    }
}
