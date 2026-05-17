import { describe, expect, it, vi } from "vitest"
import type { RepoStore, TaskPreview } from "./repoStore"
import type { TaskStore } from "./taskStore"
import { syncTaskPreviewUsageFromStore } from "./taskStore"

function repoStoreWithPreview(preview: TaskPreview): RepoStore {
    return {
        repos: {
            update: vi.fn((_repoId: string, recipe: (draft: { tasks: TaskPreview[] }) => void) => {
                recipe({ tasks: [preview] })
            }),
        },
    } as unknown as RepoStore
}

function taskStoreWithMeta(id: string): TaskStore {
    return {
        meta: {
            current: { id },
        },
        events: {
            all: vi.fn(() => []),
        },
    } as unknown as TaskStore
}

describe("syncTaskPreviewUsageFromStore", () => {
    it("updates usage on the requested preview id", () => {
        const preview: TaskPreview = {
            id: "task-1",
            slug: "task-1",
            title: "Task",
            createdAt: "2026-01-01T00:00:00.000Z",
        }
        const repoStore = repoStoreWithPreview(preview)

        syncTaskPreviewUsageFromStore(repoStore, "repo-1", "task-1", taskStoreWithMeta("task-1"))

        expect(preview.usage).toEqual({
            usageVersion: 2,
            inputTokens: 0,
            outputTokens: 0,
            totalCostUsd: 0,
            eventCount: 0,
            costByModel: {},
            durationMs: 0,
        })
    })

    it("rejects mismatched task docs instead of updating the wrong preview", () => {
        const preview: TaskPreview = {
            id: "task-1",
            slug: "task-1",
            title: "Task",
            createdAt: "2026-01-01T00:00:00.000Z",
        }
        const repoStore = repoStoreWithPreview(preview)

        expect(() => syncTaskPreviewUsageFromStore(repoStore, "repo-1", "task-1", taskStoreWithMeta("other-task"))).toThrow("mismatched metadata id")
        expect(preview.usage).toBeUndefined()
    })
})
