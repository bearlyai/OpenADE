import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import { OPENADE_NOTIFICATION } from "../../../openade-client/src"
import type { RuntimeNotification } from "../../../runtime-protocol/src"
import { createMcpServerStore } from "../persistence/mcpServerStore"
import type { McpServerStoreConnection } from "../persistence/mcpServerStoreBootstrap"
import { createPersonalSettingsStore } from "../persistence/personalSettingsStore"
import type { PersonalSettingsStoreConnection } from "../persistence/personalSettingsStoreBootstrap"
import type { RepoStore } from "../persistence/repoStore"
import { createRepoStore } from "../persistence/repoStore"
import type { RepoStoreConnection } from "../persistence/repoStoreBootstrap"
import type { TaskStore } from "../persistence/taskStore"
import type { Task, TaskDeviceEnvironment } from "../types"
import { CodeStore } from "./store"

interface RuntimeTaskPreviewScheduler {
    scheduleCoalescedRuntimeTaskUpdateNotification(notification: RuntimeNotification): boolean
    scheduleCoalescedRuntimeTaskPreviewNotification(notification: RuntimeNotification): boolean
    enqueueRuntimeNotification(notification: RuntimeNotification): void
}

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

describe("CodeStore runtime notification scheduling", () => {
    it("rate-limits repeated in-progress task update refreshes", async () => {
        vi.useFakeTimers()
        const store = new CodeStore({
            getCurrentUser: () => ({ id: "u1", email: "u1@example.com" }),
            navigateToTask: vi.fn(),
        })
        const scheduler = store as unknown as RuntimeTaskPreviewScheduler
        const enqueueSpy = vi.spyOn(scheduler, "enqueueRuntimeNotification").mockImplementation(() => undefined)
        const notification: RuntimeNotification = {
            method: OPENADE_NOTIFICATION.taskUpdated,
            params: {
                repoId: "repo-1",
                taskId: "task-1",
                eventId: "event-1",
                eventStatus: "in_progress",
                previewChanged: false,
            },
        }

        try {
            expect(scheduler.scheduleCoalescedRuntimeTaskUpdateNotification(notification)).toBe(true)
            await vi.advanceTimersByTimeAsync(150)
            expect(enqueueSpy).toHaveBeenCalledTimes(1)

            expect(scheduler.scheduleCoalescedRuntimeTaskUpdateNotification(notification)).toBe(true)
            await vi.advanceTimersByTimeAsync(14_999)
            expect(enqueueSpy).toHaveBeenCalledTimes(1)

            await vi.advanceTimersByTimeAsync(1)
            expect(enqueueSpy).toHaveBeenCalledTimes(2)
        } finally {
            store.disconnectAllStores()
            enqueueSpy.mockRestore()
            vi.useRealTimers()
        }
    })

    it("rate-limits repeated task preview projection refreshes", async () => {
        vi.useFakeTimers()
        const store = new CodeStore({
            getCurrentUser: () => ({ id: "u1", email: "u1@example.com" }),
            navigateToTask: vi.fn(),
        })
        const scheduler = store as unknown as RuntimeTaskPreviewScheduler
        const enqueueSpy = vi.spyOn(scheduler, "enqueueRuntimeNotification").mockImplementation(() => undefined)
        const notification: RuntimeNotification = {
            method: OPENADE_NOTIFICATION.taskPreviewChanged,
            params: { repoId: "repo-1", taskId: "task-1" },
        }

        try {
            expect(scheduler.scheduleCoalescedRuntimeTaskPreviewNotification(notification)).toBe(true)
            await vi.advanceTimersByTimeAsync(150)
            expect(enqueueSpy).toHaveBeenCalledTimes(1)

            expect(scheduler.scheduleCoalescedRuntimeTaskPreviewNotification(notification)).toBe(true)
            await vi.advanceTimersByTimeAsync(150)
            expect(enqueueSpy).toHaveBeenCalledTimes(1)

            await vi.advanceTimersByTimeAsync(9_850)
            expect(enqueueSpy).toHaveBeenCalledTimes(2)
        } finally {
            store.disconnectAllStores()
            enqueueSpy.mockRestore()
            vi.useRealTimers()
        }
    })
})

describe("CodeStore initialization observability", () => {
    it("retries store initialization after an initialization failure", async () => {
        const personalDoc = new Y.Doc()
        const mcpDoc = new Y.Doc()
        const repoDoc = new Y.Doc()
        let personalSettingsAttempts = 0
        const store = new CodeStore({
            getCurrentUser: () => ({ id: "u1", email: "u1@example.com" }),
            navigateToTask: vi.fn(),
            legacyStoreConnectors: {
                connectPersonalSettingsStore: async (): Promise<PersonalSettingsStoreConnection> => {
                    personalSettingsAttempts += 1
                    if (personalSettingsAttempts === 1) {
                        throw new Error("transient settings load failure")
                    }
                    return {
                        store: createPersonalSettingsStore(personalDoc),
                        sync: async () => undefined,
                        disconnect: () => personalDoc.destroy(),
                    }
                },
                connectMcpServerStore: async (): Promise<McpServerStoreConnection> => ({
                    store: createMcpServerStore(mcpDoc),
                    sync: async () => undefined,
                    disconnect: () => mcpDoc.destroy(),
                }),
                connectRepoStore: async (): Promise<RepoStoreConnection> => ({
                    store: createRepoStore(repoDoc),
                    sync: async () => undefined,
                    refresh: async () => true,
                    disconnect: () => repoDoc.destroy(),
                }),
            },
        })
        vi.spyOn(store.crons, "startAll").mockResolvedValue(undefined)

        try {
            await expect(store.initializeStores()).rejects.toThrow("transient settings load failure")
            expect(store.storeInitializing).toBe(false)

            await expect(store.initializeStores()).resolves.toBeUndefined()

            expect(personalSettingsAttempts).toBe(2)
            expect(store.storeInitialized).toBe(true)
            expect(store.personalSettingsStore).not.toBeNull()
        } finally {
            store.disconnectAllStores()
            personalDoc.destroy()
            mcpDoc.destroy()
            repoDoc.destroy()
        }
    })

    it("logs slow initialization phases with sanitized timing context", async () => {
        const personalDoc = new Y.Doc()
        const mcpDoc = new Y.Doc()
        const repoDoc = new Y.Doc()
        let nowMs = 1_000
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowMs)
        const store = new CodeStore({
            getCurrentUser: () => ({ id: "u1", email: "u1@example.com" }),
            navigateToTask: vi.fn(),
            legacyStoreConnectors: {
                connectPersonalSettingsStore: async (): Promise<PersonalSettingsStoreConnection> => ({
                    store: createPersonalSettingsStore(personalDoc),
                    sync: async () => {
                        nowMs += 300
                    },
                    disconnect: () => personalDoc.destroy(),
                }),
                connectMcpServerStore: async (): Promise<McpServerStoreConnection> => ({
                    store: createMcpServerStore(mcpDoc),
                    sync: async () => undefined,
                    disconnect: () => mcpDoc.destroy(),
                }),
                connectRepoStore: async (): Promise<RepoStoreConnection> => ({
                    store: createRepoStore(repoDoc),
                    sync: async () => undefined,
                    refresh: async () => true,
                    disconnect: () => repoDoc.destroy(),
                }),
            },
        })
        vi.spyOn(store.crons, "startAll").mockResolvedValue(undefined)

        try {
            await store.initializeStores()

            const slowPhaseCalls = warnSpy.mock.calls.filter(([message]) => message === "[CodeStore] Slow initialization phase")
            expect(slowPhaseCalls).toEqual(
                expect.arrayContaining([
                    [
                        "[CodeStore] Slow initialization phase",
                        expect.objectContaining({
                            phase: "personal_settings_sync",
                            durationMs: 300,
                            runtimeProductAPI: false,
                            coreOwned: false,
                            runtimeProductStoreStatus: "disabled",
                        }),
                    ],
                ])
            )
            expect(JSON.stringify(slowPhaseCalls)).not.toContain("/tmp")
            expect(JSON.stringify(slowPhaseCalls)).not.toContain("envVars")
        } finally {
            store.disconnectAllStores()
            warnSpy.mockRestore()
            nowSpy.mockRestore()
            personalDoc.destroy()
            mcpDoc.destroy()
            repoDoc.destroy()
        }
    })
})
