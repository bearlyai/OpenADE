/**
 * TaskStore
 *
 * Manages a single task's complete state using YJS for sync.
 * Uses multiple YJS structures for optimal conflict resolution:
 * - meta: YObjectHandle for scalar fields
 * - events: YArrayHandle for event list
 * - comments: YArrayHandle for comment list
 * - deviceEnvironments: YArrayHandle for per-device state
 */

import type * as Y from "yjs"
import type { CodeEvent, Comment, IsolationStrategy, Task, TaskDeviceEnvironment, User } from "../types"
import { ulid } from "../utils/ulid"
import type { RepoStore } from "./repoStore"
import { updateTaskPreview } from "./repoStore"
import { type YArrayHandle, type YObjectHandle, arrayOfType, objectOfType } from "./storage"
import { computeTaskUsage } from "./taskStatsUtils"

// ============================================================================
// Types
// ============================================================================

/**
 * Scalar metadata fields for a task.
 * Stored in a YObjectHandle for efficient partial updates.
 */
export interface TaskMetadata {
    id: string
    repoId: string
    slug: string
    title: string
    description: string
    isolationStrategy: IsolationStrategy
    sessionIds: Record<string, string>
    createdBy: User
    createdAt: string
    updatedAt: string
    lastViewedAt?: string
    lastEventAt?: string
    closed?: boolean
    cancelledPlanEventId?: string
    /** IDs of MCP servers enabled for this task */
    enabledMcpServerIds?: string[]
}

/**
 * TaskStore manages a single task's complete state.
 * Backed by multiple YJS structures for optimal conflict resolution.
 *
 * Note: CodeEvent, Comment, and TaskDeviceEnvironment all have `id: string`
 * which is required by YArrayHandle.
 */
export interface TaskStore {
    /** Scalar metadata (title, description, timestamps, etc.) */
    meta: YObjectHandle<TaskMetadata>

    /** Ordered list of events (actions, snapshots, setup) */
    events: YArrayHandle<CodeEvent & { id: string }>

    /** Task-level comments with source tracking */
    comments: YArrayHandle<Comment & { id: string }>

    /** Per-device environment state */
    deviceEnvironments: YArrayHandle<TaskDeviceEnvironment>
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a TaskStore backed by the given YJS document.
 *
 * @param doc - YJS document (from getYDoc with task's room ticket)
 * @param initialTask - Optional initial data to seed the document (for migration/creation)
 */
export function createTaskStore(doc: Y.Doc, initialTask?: Task): TaskStore {
    // Create handles with namespaced keys to avoid collisions
    // Note: YJS cannot serialize undefined values, so we omit optional fields if not present
    const meta = objectOfType<TaskMetadata>(doc, "task:meta", () => {
        const base: TaskMetadata = {
            id: initialTask?.id ?? ulid(),
            repoId: initialTask?.repoId ?? "",
            slug: initialTask?.slug ?? "",
            title: initialTask?.title ?? "",
            description: initialTask?.description ?? "",
            isolationStrategy: initialTask?.isolationStrategy ?? { type: "head" },
            sessionIds: initialTask?.sessionIds ?? {},
            createdBy: initialTask?.createdBy ?? { id: "", email: "" },
            createdAt: initialTask?.createdAt ?? new Date().toISOString(),
            updatedAt: initialTask?.updatedAt ?? new Date().toISOString(),
        }
        // Only add optional fields if they have values (YJS can't serialize undefined)
        if (initialTask?.closed !== undefined) base.closed = initialTask.closed
        if (initialTask?.cancelledPlanEventId) base.cancelledPlanEventId = initialTask.cancelledPlanEventId
        return base
    })

    const events = arrayOfType<CodeEvent & { id: string }>(doc, "task:events")
    const comments = arrayOfType<Comment & { id: string }>(doc, "task:comments")
    const deviceEnvironments = arrayOfType<TaskDeviceEnvironment>(doc, "task:deviceEnvironments")

    // Seed initial data if provided and arrays are empty
    if (initialTask && events.ids.length === 0) {
        for (const event of initialTask.events) {
            events.push(event)
        }
        for (const comment of initialTask.comments) {
            comments.push(comment)
        }
        for (const de of initialTask.deviceEnvironments) {
            deviceEnvironments.push(de)
        }
    }

    return { meta, events, comments, deviceEnvironments }
}

// ============================================================================
// Sync Helper
// ============================================================================

/**
 * Syncs relevant TaskStore fields to the RepoStore preview.
 * Call this after TaskStore mutations that affect sidebar display:
 * - Title change
 * - Event added/completed
 * - Task closed/opened
 */
function getEventSourceLabel(event: CodeEvent): string {
    switch (event.type) {
        case "action":
            return event.source.userLabel
        case "setup_environment":
            return "Setup"
        case "snapshot":
            return "Snapshot"
    }
}

export function syncTaskPreviewFromStore(repoStore: RepoStore, repoId: string, taskStore: TaskStore): void {
    const events = taskStore.events.all()
    // Get last non-snapshot event for status display
    const lastNonSnapshotEvent = [...events].reverse().find((e) => e.type !== "snapshot")
    const meta = taskStore.meta.current

    // Build lastEvent preview data
    const lastEvent = lastNonSnapshotEvent
        ? {
              type: lastNonSnapshotEvent.type,
              status: lastNonSnapshotEvent.status,
              sourceType: lastNonSnapshotEvent.type === "action" ? lastNonSnapshotEvent.source.type : undefined,
              sourceLabel: getEventSourceLabel(lastNonSnapshotEvent),
              at: meta.lastEventAt ?? lastNonSnapshotEvent.createdAt,
          }
        : undefined

    const usage = computeTaskUsage(events)

    updateTaskPreview(repoStore, repoId, meta.id, {
        title: meta.title,
        lastEvent,
        closed: meta.closed,
        usage,
        lastViewedAt: meta.lastViewedAt,
        lastEventAt: meta.lastEventAt,
    })
}

// ============================================================================
// Export Helper
// ============================================================================

/**
 * Exports a TaskStore back to a plain Task object.
 * Useful for backward compatibility with existing code that expects Task type.
 */
export function taskFromStore(store: TaskStore): Task {
    const meta = store.meta.current
    return {
        id: meta.id,
        repoId: meta.repoId,
        slug: meta.slug,
        title: meta.title,
        description: meta.description,
        isolationStrategy: meta.isolationStrategy,
        sessionIds: meta.sessionIds,
        createdBy: meta.createdBy,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        closed: meta.closed,
        cancelledPlanEventId: meta.cancelledPlanEventId,
        enabledMcpServerIds: meta.enabledMcpServerIds,
        events: store.events.all(),
        comments: store.comments.all(),
        deviceEnvironments: store.deviceEnvironments.all(),
    }
}
