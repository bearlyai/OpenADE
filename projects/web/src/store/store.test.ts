import { describe, expect, it, vi } from "vitest"
import type { RepoStore } from "../persistence/repoStore"
import type { TaskStore } from "../persistence/taskStore"
import type { Task, TaskDeviceEnvironment } from "../types"
import { CodeStore } from "./store"

function taskStoreFor(task: Task): TaskStore {
    return {
        meta: {
            current: {
                id: task.id,
                repoId: task.repoId,
                slug: task.slug,
                title: task.title,
                description: task.description,
                isolationStrategy: task.isolationStrategy,
                sessionIds: task.sessionIds,
                createdBy: task.createdBy,
                createdAt: task.createdAt,
                updatedAt: task.updatedAt,
                closed: task.closed,
                enabledMcpServerIds: task.enabledMcpServerIds,
                pullRequest: task.pullRequest,
            },
        },
        events: {
            all: () => task.events,
        },
        comments: {
            all: () => task.comments,
        },
        deviceEnvironments: {
            all: () => task.deviceEnvironments,
        },
    } as unknown as TaskStore
}

describe("CodeStore task refresh", () => {
    it("keeps the cached task environment during ordinary task refreshes", async () => {
        const deviceEnvironment: TaskDeviceEnvironment = {
            id: "device-1",
            deviceId: "test-device",
            setupComplete: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            lastUsedAt: "2026-01-01T00:00:00.000Z",
        }
        const task: Task = {
            id: "task-1",
            repoId: "repo-1",
            slug: "task-1",
            title: "Task",
            description: "desc",
            isolationStrategy: { type: "head" },
            deviceEnvironments: [deviceEnvironment],
            createdBy: { id: "u1", email: "u1@example.com" },
            events: [],
            comments: [],
            sessionIds: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        }
        const store = new CodeStore({
            getCurrentUser: () => ({ id: "u1", email: "u1@example.com" }),
            navigateToTask: vi.fn(),
        })
        store.repoStore = {
            repos: {
                all: () => [
                    {
                        id: "repo-1",
                        name: "Repo",
                        path: "/tmp/repo",
                        createdBy: { id: "u1", email: "u1@example.com" },
                        createdAt: "2026-01-01T00:00:00.000Z",
                        updatedAt: "2026-01-01T00:00:00.000Z",
                        tasks: [],
                    },
                ],
            },
        } as unknown as RepoStore
        ;(store as unknown as { taskStoreConnections: Map<string, unknown> }).taskStoreConnections.set("task-1", {
            store: taskStoreFor(task),
            refresh: vi.fn(async () => true),
            sync: vi.fn(async () => undefined),
            disconnect: vi.fn(),
        })
        vi.spyOn(store.repos, "getGitInfo").mockResolvedValue(null)
        localStorage.setItem("openade-device-id", "test-device")

        try {
            const model = store.tasks.getTaskModel("task-1")
            const environment = await model?.loadEnvironment()

            expect(environment).toBeTruthy()
            expect(model?.environment).toBe(environment)

            await store.refreshTaskStoreFromStorage("task-1")

            expect(model?.environment).toBe(environment)
        } finally {
            localStorage.removeItem("openade-device-id")
        }
    })
})
