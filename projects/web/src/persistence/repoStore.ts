/**
 * RepoStore
 *
 * Manages repos with embedded task previews using YJS for sync.
 * Backed by a single YJS document for efficient sidebar rendering.
 */

import type * as Y from "yjs"
import type { User } from "../types"
import { ulid } from "../utils/ulid"
import { type YArrayHandle, arrayOfType } from "./storage"

// ============================================================================
// Types
// ============================================================================

/**
 * Last event info for sidebar rendering.
 */
export interface TaskPreviewLastEvent {
    type: "action" | "setup_environment" | "snapshot"
    status: "in_progress" | "completed" | "error" | "stopped"
    sourceType?: "plan" | "revise" | "run_plan" | "do" | "ask" // Only for action events
    sourceLabel: string // Display label ("Plan", "Do", "Ask", "Setup", "Snapshot")
    at: string // ISO timestamp
}

/**
 * Aggregated usage stats for a task, synced from TaskStore.
 */
export interface TaskPreviewUsage {
    inputTokens: number
    outputTokens: number
    totalCostUsd: number
    eventCount: number
    costByModel: Record<string, number>
}

/**
 * Lightweight task preview for sidebar rendering.
 * Full task data is loaded on-demand via task id.
 */
export interface TaskPreview {
    id: string
    slug: string
    title: string
    lastEvent?: TaskPreviewLastEvent
    closed?: boolean
    createdAt: string // ISO timestamp
    usage?: TaskPreviewUsage
    lastViewedAt?: string // ISO timestamp - for unread badge computation
    lastEventAt?: string // ISO timestamp - for unread badge computation
}

/**
 * Repo with embedded task previews.
 * This is the unit stored in RepoStore's YArrayHandle.
 * Note: gitInfo is NOT persisted - it's computed at runtime via RepoManager.getGitInfo()
 */
export interface RepoItem {
    id: string
    name: string
    path: string // THE source of truth for working directory
    createdBy: User
    createdAt: string
    updatedAt: string
    tasks: TaskPreview[]
}

/**
 * RepoStore manages all repos and their task previews.
 * Backed by a single YJS document for efficient sidebar rendering.
 */
export interface RepoStore {
    repos: YArrayHandle<RepoItem>
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a RepoStore backed by the given YJS document.
 * The document should be obtained via getYDoc() with the repo store room ticket.
 */
export function createRepoStore(doc: Y.Doc): RepoStore {
    const repos = arrayOfType<RepoItem>(doc, "repos")
    return { repos }
}

// ============================================================================
// Repo CRUD Operations
// ============================================================================

/**
 * Adds a new repo to the store.
 * Returns the generated repo ID.
 */
export function addRepo(
    store: RepoStore,
    params: {
        name: string
        path: string
        createdBy: User
    }
): string {
    const now = new Date().toISOString()
    const id = ulid()

    store.repos.push({
        id,
        name: params.name,
        path: params.path,
        createdBy: params.createdBy,
        createdAt: now,
        updatedAt: now,
        tasks: [],
    })

    return id
}

/**
 * Updates an existing repo's editable fields.
 */
export function updateRepo(store: RepoStore, repoId: string, updates: Partial<Pick<RepoItem, "name" | "path">>): void {
    store.repos.update(repoId, (draft) => {
        if (updates.name !== undefined) draft.name = updates.name
        if (updates.path !== undefined) draft.path = updates.path
        draft.updatedAt = new Date().toISOString()
    })
}

/**
 * Deletes a repo and all its task previews.
 * Note: This does NOT delete the task YDocs from IndexedDB.
 * Call deleteTaskDocs() separately if needed.
 */
export function deleteRepo(store: RepoStore, repoId: string): void {
    store.repos.delete(repoId)
}

// ============================================================================
// Task Preview Operations
// ============================================================================

/**
 * Adds a task preview to a repo.
 */
export function addTaskPreview(
    store: RepoStore,
    repoId: string,
    params: {
        id: string
        slug: string
        title: string
    }
): void {
    const now = new Date().toISOString()

    store.repos.update(repoId, (draft) => {
        draft.tasks.push({
            id: params.id,
            slug: params.slug,
            title: params.title,
            createdAt: now,
        })
        draft.updatedAt = now
    })
}

/**
 * Updates a task preview's sidebar-visible fields.
 * Call this after TaskStore changes that affect sidebar display.
 */
export function updateTaskPreview(store: RepoStore, repoId: string, taskId: string, updates: Partial<Omit<TaskPreview, "id">>): void {
    store.repos.update(repoId, (draft) => {
        const task = draft.tasks.find((t) => t.id === taskId)
        if (task) {
            if (updates.slug !== undefined) task.slug = updates.slug
            if (updates.title !== undefined) task.title = updates.title
            if (updates.lastEvent !== undefined) task.lastEvent = updates.lastEvent
            if (updates.closed !== undefined) task.closed = updates.closed
            if (updates.usage !== undefined) task.usage = updates.usage
            if (updates.lastViewedAt !== undefined) task.lastViewedAt = updates.lastViewedAt
            if (updates.lastEventAt !== undefined) task.lastEventAt = updates.lastEventAt
        }
    })
}

/**
 * Deletes a task preview from a repo.
 * Note: This does NOT delete the task's YDoc from IndexedDB.
 */
export function deleteTaskPreview(store: RepoStore, repoId: string, taskId: string): void {
    store.repos.update(repoId, (draft) => {
        const idx = draft.tasks.findIndex((t) => t.id === taskId)
        if (idx !== -1) {
            draft.tasks.splice(idx, 1)
        }
    })
}

/**
 * Gets a task preview by ID from a specific repo.
 * Returns undefined if not found.
 */
export function getTaskPreview(store: RepoStore, repoId: string, taskId: string): TaskPreview | undefined {
    const repo = store.repos.get(repoId)
    return repo?.tasks.find((t) => t.id === taskId)
}
