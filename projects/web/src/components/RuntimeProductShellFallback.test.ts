import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { OpenADECoreRolloutState } from "../../../electron/src/preload-api"
import { OPENADE_METHOD } from "../../../openade-client/src"
import type { SnapshotPatchIndex } from "../electronAPI/snapshots"
import type { ReadProcsResult } from "../electronAPI/procs"
import { gitApi } from "../electronAPI/git"
import { TaskEnvironment } from "../store/TaskEnvironment"
import { SnapshotEventModel } from "../store/EventModel"
import type { TaskModel } from "../store/TaskModel"
import { CodeStoreProvider } from "../store/context"
import { CodeStore } from "../store/store"
import type { SnapshotEvent, Task } from "../types"
import { EnvironmentSetupView } from "./EnvironmentSetupView"
import { GitLogTray } from "./GitLogTray"
import { ImageAttachments } from "./events/ImageAttachments"
import { ProcessesTray } from "./ProcessesTray"
import { ViewPatch } from "./ViewPatch"

const procsApiMocks = vi.hoisted(() => ({
    readProcs: vi.fn(async (path: string): Promise<ReadProcsResult> => {
        return {
            repoRoot: path,
            searchRoot: path,
            isWorktree: false,
            configs: [],
            errors: [],
        }
    }),
}))
const dataFolderApiMocks = vi.hoisted(() => ({
    load: vi.fn(async (): Promise<ArrayBuffer | string | null> => null),
}))
const snapshotsApiMocks = vi.hoisted(() => ({
    isAvailable: vi.fn(() => true),
    loadIndex: vi.fn(async (): Promise<SnapshotPatchIndex | null> => null),
    loadPatch: vi.fn(async (): Promise<string | null> => null),
    loadPatchSlice: vi.fn(async (): Promise<string | null> => null),
}))

vi.mock("../electronAPI/procs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../electronAPI/procs")>()
    return {
        ...actual,
        readProcs: procsApiMocks.readProcs,
    }
})

vi.mock("../electronAPI/dataFolder", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../electronAPI/dataFolder")>()
    return {
        ...actual,
        dataFolderApi: {
            ...actual.dataFolderApi,
            load: dataFolderApiMocks.load,
        },
    }
})

vi.mock("../electronAPI/snapshots", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../electronAPI/snapshots")>()
    return {
        ...actual,
        snapshotsApi: {
            ...actual.snapshotsApi,
            isAvailable: snapshotsApiMocks.isAvailable,
            loadIndex: snapshotsApiMocks.loadIndex,
            loadPatch: snapshotsApiMocks.loadPatch,
            loadPatchSlice: snapshotsApiMocks.loadPatchSlice,
        },
    }
})

function installCoreOwnedRuntimeGap(): () => void {
    const previous = window.openadeAPI
    const rolloutState: OpenADECoreRolloutState = {
        status: "connected",
        source: "managed",
        reason: "managed-core",
        automatic: true,
        legacyYjsDocumentsPresent: false,
        legacyYjsMigrationAccepted: false,
    }

    Object.defineProperty(window, "openadeAPI", {
        configurable: true,
        writable: true,
        value: {
            ...previous,
            app: {
                ...previous?.app,
                smokeTest: false,
            },
            core: {
                ...previous?.core,
                runtimeEndpoint: {
                    url: "ws://127.0.0.1:37376/v1/runtime",
                    token: "trusted-test-token",
                },
                rolloutState,
            },
        },
    })

    return () => {
        Object.defineProperty(window, "openadeAPI", {
            configurable: true,
            writable: true,
            value: previous,
        })
    }
}

function createCoreOwnedGapStore(): CodeStore {
    return new CodeStore({
        getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
        navigateToTask: () => undefined,
        enableRuntimeProductStore: true,
    })
}

function createSnapshotTask(): Task {
    const snapshotEvent: SnapshotEvent = {
        id: "snapshot-1",
        type: "snapshot",
        status: "completed",
        createdAt: "2026-06-12T00:00:00.000Z",
        completedAt: "2026-06-12T00:00:01.000Z",
        userInput: "",
        actionEventId: "action-1",
        referenceBranch: "main",
        mergeBaseCommit: "abc123456789",
        fullPatch: "diff --git a/README.md b/README.md\n+stale inline patch\n",
        patchFileId: "patch-1",
        stats: {
            filesChanged: 1,
            insertions: 1,
            deletions: 0,
        },
    }

    return {
        id: "task-1",
        repoId: "repo-1",
        slug: "task-1",
        title: "Task",
        description: "",
        isolationStrategy: { type: "head" },
        deviceEnvironments: [],
        createdBy: { id: "user-1", email: "user@example.com" },
        events: [snapshotEvent],
        comments: [],
        sessionIds: {},
        createdAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T00:00:00.000Z",
    }
}

function createSnapshotPatchIndex(): SnapshotPatchIndex {
    return {
        version: 1,
        patchSize: 42,
        files: [
            {
                id: "file-1",
                path: "README.md",
                status: "modified",
                binary: false,
                insertions: 1,
                deletions: 0,
                changedLines: 1,
                hunkCount: 1,
                patchStart: 0,
                patchEnd: 42,
            },
        ],
    }
}

describe("runtime product shell fallback gaps", () => {
    afterEach(() => {
        procsApiMocks.readProcs.mockClear()
        dataFolderApiMocks.load.mockClear()
        snapshotsApiMocks.isAvailable.mockClear()
        snapshotsApiMocks.loadIndex.mockClear()
        snapshotsApiMocks.loadPatch.mockClear()
        snapshotsApiMocks.loadPatchSlice.mockClear()
        vi.restoreAllMocks()
    })

    it("does not fall back to raw process config reads before the Core product store is attached", async () => {
        const restoreOpenADEAPI = installCoreOwnedRuntimeGap()
        const codeStore = createCoreOwnedGapStore()
        const runtimeProcessList = vi.spyOn(codeStore, "listProductProjectProcesses")
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(ProcessesTray, {
                            searchPath: "/tmp/runtime-repo",
                            context: { type: "repo", root: "/tmp/runtime-repo" },
                            workspaceId: "repo-1",
                            isOpen: true,
                            productScope: { repoId: "repo-1", taskId: "task-1" },
                        })
                    )
                )
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain("No processes configured")
            })
            expect(runtimeProcessList).not.toHaveBeenCalled()
            expect(procsApiMocks.readProcs).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            runtimeProcessList.mockRestore()
            codeStore.disconnectAllStores()
            restoreOpenADEAPI()
        }
    })

    it("does not fall back to raw git history reads before the Core product store is attached", async () => {
        const restoreOpenADEAPI = installCoreOwnedRuntimeGap()
        const codeStore = createCoreOwnedGapStore()
        const branchRead = vi.spyOn(gitApi, "listBranches").mockRejectedValue(new Error("legacy branch list should not be used"))
        const worktreeRead = vi.spyOn(gitApi, "listWorkTrees").mockRejectedValue(new Error("legacy worktree list should not be used"))
        const legacyLogRead = vi.spyOn(gitApi, "getLog").mockRejectedValue(new Error("legacy git log read should not be used"))
        const legacyCommitFilesRead = vi.spyOn(gitApi, "getCommitFiles").mockRejectedValue(new Error("legacy commit-file read should not be used"))
        const legacyCommitPatchRead = vi.spyOn(gitApi, "getCommitFilePatch").mockRejectedValue(new Error("legacy commit patch read should not be used"))
        const legacyFileRead = vi.spyOn(gitApi, "getFileAtTreeish").mockRejectedValue(new Error("legacy commit file read should not be used"))
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(GitLogTray, {
                            taskId: "task-1",
                            workDir: "/tmp/runtime-repo",
                            currentBranch: "main",
                            className: "h-full",
                        })
                    )
                )
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain("Task git context unavailable")
            })
            expect(branchRead).not.toHaveBeenCalled()
            expect(worktreeRead).not.toHaveBeenCalled()
            expect(legacyLogRead).not.toHaveBeenCalled()
            expect(legacyCommitFilesRead).not.toHaveBeenCalled()
            expect(legacyCommitPatchRead).not.toHaveBeenCalled()
            expect(legacyFileRead).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            branchRead.mockRestore()
            worktreeRead.mockRestore()
            legacyLogRead.mockRestore()
            legacyCommitFilesRead.mockRestore()
            legacyCommitPatchRead.mockRestore()
            legacyFileRead.mockRestore()
            codeStore.disconnectAllStores()
            restoreOpenADEAPI()
        }
    })

    it("does not fall back to legacy image blob reads before the Core product store is attached", async () => {
        const restoreOpenADEAPI = installCoreOwnedRuntimeGap()
        const codeStore = createCoreOwnedGapStore()
        const runtimeImageRead = vi.spyOn(codeStore, "readProductTaskImage")
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            expect(codeStore.usesCoreOwnedProductRuntime()).toBe(true)
            expect(codeStore.shouldUseRuntimeProductAPI()).toBe(false)

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(ImageAttachments, {
                            taskId: "task-1",
                            images: [
                                {
                                    id: "image-1",
                                    ext: "png",
                                    mediaType: "image/png",
                                    originalWidth: 100,
                                    originalHeight: 50,
                                    resizedWidth: 100,
                                    resizedHeight: 50,
                                },
                            ],
                        })
                    )
                )
                await Promise.resolve()
            })

            expect(runtimeImageRead).not.toHaveBeenCalled()
            expect(dataFolderApiMocks.load).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            runtimeImageRead.mockRestore()
            codeStore.disconnectAllStores()
            restoreOpenADEAPI()
        }
    })

    it("attaches Core-owned snapshot model blob reads instead of falling back to legacy snapshots", async () => {
        const task = createSnapshotTask()
        const snapshotEvent = task.events[0] as SnapshotEvent
        snapshotEvent.fullPatch = ""
        let runtimeProductAPIAvailable = false
        const snapshotMethods = new Set<string>([OPENADE_METHOD.taskSnapshotIndexRead, OPENADE_METHOD.taskSnapshotPatchRead])
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            if (!snapshotMethods.has(method)) return false
            runtimeProductAPIAvailable = true
            return true
        })
        const readProductTaskSnapshotIndex = vi.fn(async () => ({ index: createSnapshotPatchIndex() }))
        const readProductTaskSnapshotPatch = vi.fn(async () => ({ patch: "diff --git a/README.md b/README.md\n+product snapshot patch\n" }))
        const store = {
            shouldUseRuntimeProductAPI: () => runtimeProductAPIAvailable,
            usesCoreOwnedProductRuntime: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod: (method: string) => runtimeProductAPIAvailable && snapshotMethods.has(method),
            canUseProductMethodAfterConnect,
            findProductRepoIdForTask: () => "repo-1",
            readProductTaskSnapshotIndex,
            readProductTaskSnapshotPatch,
            tasks: {
                getTask: () => task,
            },
        } as unknown as CodeStore
        const eventModel = new SnapshotEventModel(store, "task-1", "snapshot-1", false)

        await eventModel.loadIndex()
        await eventModel.loadPatch()

        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskSnapshotIndexRead)
        expect(readProductTaskSnapshotIndex).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", eventId: "snapshot-1" })
        expect(readProductTaskSnapshotPatch).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", eventId: "snapshot-1" })
        expect(snapshotsApiMocks.loadIndex).not.toHaveBeenCalled()
        expect(snapshotsApiMocks.loadPatch).not.toHaveBeenCalled()
        expect(eventModel.patchIndex).toEqual(createSnapshotPatchIndex())
        expect(eventModel.fullPatch).toContain("+product snapshot patch")
    })

    it("attaches Core-owned patch slice reads instead of falling back to legacy patch slices", async () => {
        let runtimeProductAPIAvailable = false
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            if (method !== OPENADE_METHOD.taskSnapshotPatchReadSlice) return false
            runtimeProductAPIAvailable = true
            return true
        })
        const runtimePatchSliceRead = vi.fn(async () => ({ patch: "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+product slice\n" }))
        const codeStore = {
            ui: {
                viewMode: "unified",
                setViewMode: vi.fn(),
            },
            shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && method === OPENADE_METHOD.taskSnapshotPatchReadSlice),
            canUseProductMethodAfterConnect,
            findProductRepoIdForTask: vi.fn(() => "repo-1"),
            readProductTaskSnapshotPatchSlice: runtimePatchSliceRead,
            tasks: {
                getTask: vi.fn(() => ({ id: "task-1", comments: [] })),
            },
            comments: {
                getIncludedCommentIds: vi.fn(() => new Set<string>()),
                addComment: vi.fn(),
                editComment: vi.fn(),
                removeComment: vi.fn(),
            },
        } as unknown as CodeStore
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(ViewPatch, {
                            patchFileId: "patch-1",
                            patchIndex: createSnapshotPatchIndex(),
                            taskId: "task-1",
                            snapshotEventId: "snapshot-1",
                        })
                    )
                )
                await Promise.resolve()
            })

            await vi.waitFor(() => {
                expect(runtimePatchSliceRead).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    eventId: "snapshot-1",
                    start: 0,
                    end: 42,
                })
            })
            expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskSnapshotPatchReadSlice)
            expect(snapshotsApiMocks.loadPatchSlice).not.toHaveBeenCalled()
            expect(container.textContent).toContain("README.md")
            expect(container.textContent).not.toContain("Could not load patch preview")
        } finally {
            act(() => root.unmount())
            container.remove()
        }
    })

    it("does not fall back to legacy environment setup before the Core product store is attached", async () => {
        const task = createSnapshotTask()
        const prepareProductTaskEnvironment = vi.fn()
        const rawSetup = vi.spyOn(TaskEnvironment, "setup").mockRejectedValue(new Error("legacy environment setup should not be used"))
        const store = {
            shouldUseRuntimeProductAPI: () => false,
            usesCoreOwnedProductRuntime: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod: () => false,
            canUseProductMethodAfterConnect: vi.fn(async () => false),
            prepareProductTaskEnvironment,
            tasks: {
                getTask: () => task,
            },
            repos: {
                getRepo: () => ({ id: "repo-1", name: "Repo", path: "/tmp/runtime-repo", archived: false }),
            },
        } as unknown as CodeStore
        const taskModel = { taskId: "task-1" } as unknown as TaskModel
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store },
                        createElement(EnvironmentSetupView, {
                            taskModel,
                            onComplete: () => undefined,
                        })
                    )
                )
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain("Environment setup is not available from this runtime")
            })
            expect(prepareProductTaskEnvironment).not.toHaveBeenCalled()
            expect(rawSetup).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            rawSetup.mockRestore()
        }
    })

    it("attaches Core-owned environment setup after connect instead of reporting it unavailable", async () => {
        const task = createSnapshotTask()
        let runtimeProductAPIAvailable = false
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            if (method !== OPENADE_METHOD.taskEnvironmentPrepare) return false
            runtimeProductAPIAvailable = true
            return true
        })
        const prepareProductTaskEnvironment = vi.fn(async () => ({ deviceEnvironmentId: "runtime-device" }))
        const rawSetup = vi.spyOn(TaskEnvironment, "setup").mockRejectedValue(new Error("legacy environment setup should not be used"))
        const getGitInfo = vi.fn(async () => {
            throw new Error("legacy git info should not be read")
        })
        const onComplete = vi.fn()
        const store = {
            shouldUseRuntimeProductAPI: () => runtimeProductAPIAvailable,
            usesCoreOwnedProductRuntime: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod: (method: string) => runtimeProductAPIAvailable && method === OPENADE_METHOD.taskEnvironmentPrepare,
            canUseProductMethodAfterConnect,
            prepareProductTaskEnvironment,
            tasks: {
                getTask: () => task,
                invalidateTaskModel: vi.fn(),
            },
            repos: {
                getRepo: () => ({ id: "repo-1", name: "Repo", path: "/tmp/runtime-repo", archived: false }),
                getGitInfo,
            },
        } as unknown as CodeStore
        const taskModel = { taskId: "task-1" } as unknown as TaskModel
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store },
                        createElement(EnvironmentSetupView, {
                            taskModel,
                            onComplete,
                        })
                    )
                )
            })

            await vi.waitFor(() => {
                expect(prepareProductTaskEnvironment).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1" })
            })
            expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskEnvironmentPrepare)
            expect(store.tasks.invalidateTaskModel).toHaveBeenCalledWith("task-1")
            expect(onComplete).toHaveBeenCalled()
            expect(rawSetup).not.toHaveBeenCalled()
            expect(getGitInfo).not.toHaveBeenCalled()
            expect(container.textContent).not.toContain("Environment setup is not available from this runtime")
        } finally {
            act(() => root.unmount())
            container.remove()
            rawSetup.mockRestore()
        }
    })
})
