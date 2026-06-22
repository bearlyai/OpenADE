import { describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../openade-client/src"
import type { OpenADEProjectFileReadResult, OpenADEProjectFilesTreeResult, OpenADEProjectSearchResult } from "../../../openade-module/src"
import { DEFAULT_MODEL, getDefaultModelForHarness } from "../constants"
import { type DescribePathResponse, filesApi } from "../electronAPI/files"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import type { ActionEvent, SetupEnvironmentEvent, Task } from "../types"
import { TaskModel } from "./TaskModel"
import { EventManager } from "./managers/EventManager"
import type { CodeStore } from "./store"

function createActionEvent({
    id,
    harnessId,
    modelId,
    fastMode,
}: {
    id: string
    harnessId: HarnessId
    modelId?: string
    fastMode?: boolean
}): ActionEvent {
    return {
        id,
        type: "action",
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
        userInput: "test",
        execution: {
            harnessId,
            executionId: `${id}-exec`,
            modelId,
            fastMode,
            events: [],
        },
        source: { type: "do", userLabel: "Do" },
        includesCommentIds: [],
        result: { success: true },
    }
}

function createTask(events: ActionEvent[]): Task {
    return {
        id: "task-1",
        repoId: "repo-1",
        slug: "task-1",
        title: "Task",
        description: "desc",
        isolationStrategy: { type: "head" },
        deviceEnvironments: [],
        createdBy: { id: "u1", email: "u1@example.com" },
        events,
        comments: [],
        sessionIds: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    }
}

function createStore(task: Task): CodeStore {
    return {
        execution: {
            onAfterEvent: () => () => {},
        },
        tasks: {
            getTask: (taskId: string) => (taskId === task.id ? task : null),
        },
        shouldUseRuntimeProductAPI: () => false,
        usesCoreOwnedProductRuntime: () => false,
        shouldUseRuntimeProductTaskRoute: () => false,
    } as unknown as CodeStore
}

function legacyFileResponse(path: string, content = "legacy file"): Extract<DescribePathResponse, { type: "file" }> {
    return {
        type: "file",
        path,
        size: content.length,
        mode: 0o100644,
        content,
        tooLarge: false,
        isReadable: true,
        isBinary: false,
    }
}

function productFileResponse(args: { repoId: string; taskId?: string; path: string }): OpenADEProjectFileReadResult {
    return {
        repoId: args.repoId,
        taskId: args.taskId,
        path: args.path,
        encoding: "utf8",
        content: `product file: ${args.path}`,
        size: 24,
        tooLarge: false,
        isReadable: true,
        isBinary: false,
        mediaType: "text/plain",
        previewKind: null,
    }
}

function productTreeResponse(args: { repoId: string; taskId?: string; path?: string }): OpenADEProjectFilesTreeResult {
    return {
        repoId: args.repoId,
        taskId: args.taskId,
        path: args.path ?? "",
        entries: [],
        truncated: false,
    }
}

function productSearchResponse(args: { repoId: string; taskId?: string }): OpenADEProjectSearchResult {
    return {
        repoId: args.repoId,
        taskId: args.taskId,
        matches: [
            {
                path: "README.md",
                line: 1,
                content: "needle",
                matchStart: 0,
                matchEnd: 6,
            },
        ],
        truncated: false,
    }
}

describe("TaskModel harness lock", () => {
    it("exposes closed state from task metadata", () => {
        const task = { ...createTask([]), closed: true }

        const model = new TaskModel(createStore(task), task.id)

        expect(model.isClosed).toBe(true)
    })

    it("reuses a fresh runtime git summary unless a refresh is forced", async () => {
        const task = createTask([])
        const readProductTaskGitSummary = vi.fn().mockResolvedValue({
            branch: "main",
            headCommit: "abc123",
            ahead: 0,
            hasChanges: false,
            staged: { files: [], stats: { added: 0, deleted: 0 } },
            unstaged: { files: [], stats: { added: 0, deleted: 0 } },
            untracked: [],
        })
        const store = {
            ...createStore(task),
            shouldUseRuntimeProductAPI: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod: () => true,
            readProductTaskGitSummary,
        } as unknown as CodeStore
        const model = new TaskModel(store, task.id)

        await model.refreshGitState()
        await model.refreshGitState()
        await model.refreshGitState({ force: true })

        expect(readProductTaskGitSummary).toHaveBeenCalledTimes(2)
        expect(readProductTaskGitSummary).toHaveBeenNthCalledWith(1, { repoId: "repo-1", taskId: "task-1" }, { bypassCache: false })
        expect(readProductTaskGitSummary).toHaveBeenNthCalledWith(2, { repoId: "repo-1", taskId: "task-1" }, { bypassCache: true })
    })

    it("does not refresh runtime git summary when the capability is absent", async () => {
        const task = createTask([])
        const readProductTaskGitSummary = vi.fn()
        const store = {
            ...createStore(task),
            shouldUseRuntimeProductAPI: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod: () => false,
            readProductTaskGitSummary,
        } as unknown as CodeStore
        const model = new TaskModel(store, task.id)

        await model.refreshGitState({ force: true })

        expect(readProductTaskGitSummary).not.toHaveBeenCalled()
        expect(model.gitStatus).toBeNull()
    })

    it("attaches Core-owned task git summary on explicit runtime git refresh", async () => {
        const task = createTask([])
        let runtimeProductAPIAvailable = false
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            if (method !== OPENADE_METHOD.taskGitSummaryRead) return false
            runtimeProductAPIAvailable = true
            return true
        })
        const readProductTaskGitSummary = vi.fn().mockResolvedValue({
            branch: "main",
            headCommit: "abc123",
            ahead: 1,
            hasChanges: true,
            staged: { files: [], stats: { added: 0, deleted: 0 } },
            unstaged: { files: [], stats: { added: 0, deleted: 0 } },
            untracked: [],
        })
        const store = {
            ...createStore(task),
            shouldUseRuntimeProductAPI: () => runtimeProductAPIAvailable,
            usesCoreOwnedProductRuntime: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && method === OPENADE_METHOD.taskGitSummaryRead),
            canUseProductMethodAfterConnect,
            readProductTaskGitSummary,
        } as unknown as CodeStore
        const model = new TaskModel(store, task.id)

        await model.refreshGitState({ force: true })

        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskGitSummaryRead)
        expect(readProductTaskGitSummary).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1" }, { bypassCache: true })
        expect(model.gitStatus).toMatchObject({ branch: "main", ahead: 1, hasChanges: true })
    })

    it("uses route-owned task git summary before broad runtime projection is active", async () => {
        const task = createTask([])
        const getGitInfo = vi.fn(async () => {
            throw new Error("route-owned git refresh should not load legacy repo git info")
        })
        const readProductTaskGitSummary = vi.fn().mockResolvedValue({
            branch: "feature/core-route",
            headCommit: "def456",
            ahead: 0,
            hasChanges: true,
            staged: { files: [], stats: { added: 0, deleted: 0 } },
            unstaged: { files: [{ path: "src/app.ts", status: "modified" as const, binary: false }], stats: { added: 3, deleted: 1 } },
            untracked: [],
        })
        const store = {
            ...createStore(task),
            shouldUseRuntimeProductAPI: () => false,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod: vi.fn((method: string) => method === OPENADE_METHOD.taskGitSummaryRead),
            readProductTaskGitSummary,
            repos: {
                getRepo: vi.fn(),
                getGitInfo,
            },
        } as unknown as CodeStore
        const model = new TaskModel(store, task.id)

        await model.refreshGitState({ force: true })

        expect(readProductTaskGitSummary).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1" }, { bypassCache: true })
        expect(getGitInfo).not.toHaveBeenCalled()
        expect(model.gitStatus).toMatchObject({ branch: "feature/core-route", hasChanges: true })
    })

    it("does not fall back to legacy git refresh before Core-owned repo context is attached", async () => {
        const task = { ...createTask([]), repoId: "" }
        const getGitInfo = vi.fn(async () => null)
        const readProductTaskGitSummary = vi.fn()
        const store = {
            ...createStore(task),
            shouldUseRuntimeProductAPI: () => false,
            usesCoreOwnedProductRuntime: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod: vi.fn(() => true),
            readProductTaskGitSummary,
            repos: {
                getRepo: vi.fn(),
                getGitInfo,
            },
        } as unknown as CodeStore
        const model = new TaskModel(store, task.id)

        await model.refreshGitState({ force: true })

        expect(getGitInfo).not.toHaveBeenCalled()
        expect(readProductTaskGitSummary).not.toHaveBeenCalled()
        expect(model.gitStatus).toBeNull()
    })

    it("does not run legacy after-event git refreshes before a Core-owned product store is attached", () => {
        const task = createTask([])
        const afterEventCallbacks: Array<(taskId: string) => void> = []
        const getGitInfo = vi.fn(async () => null)
        const readProductTaskGitSummary = vi.fn()
        const store = {
            ...createStore(task),
            execution: {
                onAfterEvent: vi.fn((callback: (taskId: string) => void) => {
                    afterEventCallbacks.push(callback)
                    return () => undefined
                }),
            },
            shouldUseRuntimeProductAPI: () => false,
            usesCoreOwnedProductRuntime: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod: vi.fn(() => true),
            readProductTaskGitSummary,
            repos: {
                getRepo: vi.fn(),
                getGitInfo,
            },
        } as unknown as CodeStore

        new TaskModel(store, task.id)
        afterEventCallbacks[0]?.(task.id)

        expect(getGitInfo).not.toHaveBeenCalled()
        expect(readProductTaskGitSummary).not.toHaveBeenCalled()
    })

    it("does not expose runtime SDK capabilities when project SDK reads are unavailable", () => {
        const task = createTask([])
        const readProductProjectSdkCapabilities = vi.fn()
        const canUseProductMethod = vi.fn((method: string) => method !== OPENADE_METHOD.projectSdkCapabilitiesRead)
        const store = {
            ...createStore(task),
            shouldUseRuntimeProductAPI: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod,
            readProductProjectSdkCapabilities,
        } as unknown as CodeStore
        const model = new TaskModel(store, task.id)

        expect(model.sdkCapabilities).toBeUndefined()
        expect(canUseProductMethod).toHaveBeenCalledWith(OPENADE_METHOD.projectSdkCapabilitiesRead)
        expect(readProductProjectSdkCapabilities).not.toHaveBeenCalled()
    })

    it("attaches Core-owned queued-turn cancel before cancelling queued turns", async () => {
        const task = createTask([])
        let runtimeProductAPIAvailable = false
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            if (method !== OPENADE_METHOD.queuedTurnCancel) return false
            runtimeProductAPIAvailable = true
            return true
        })
        const cancelProductQueuedTurn = vi.fn(async () => ({
            repoId: "repo-1",
            taskId: "task-1",
            queuedTurnId: "queued-1",
            cancelled: true,
        }))
        const refreshProductStateAfterTaskMutation = vi.fn(async () => undefined)
        const store = {
            ...createStore(task),
            shouldUseRuntimeProductAPI: () => runtimeProductAPIAvailable,
            usesCoreOwnedProductRuntime: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && method === OPENADE_METHOD.queuedTurnCancel),
            canUseProductMethodAfterConnect,
            cancelProductQueuedTurn,
            refreshProductStateAfterTaskMutation,
        } as unknown as CodeStore
        const model = new TaskModel(store, task.id)

        await expect(model.cancelQueuedTurn("queued-1")).resolves.toBe(true)

        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.queuedTurnCancel)
        expect(cancelProductQueuedTurn).toHaveBeenCalledWith({
            repoId: "repo-1",
            taskId: "task-1",
            queuedTurnId: "queued-1",
        })
        expect(refreshProductStateAfterTaskMutation).not.toHaveBeenCalled()
    })

    it("replaces a legacy SDK capability manager when runtime product ownership appears", async () => {
        const task = createTask([])
        let runtimeProductActive = false
        const readProductProjectSdkCapabilities = vi.fn().mockResolvedValue({
            slash_commands: ["/runtime"],
            skills: ["runtime-skill"],
            plugins: [],
            cachedAt: 1_779_811_200_000,
        })
        const store = {
            ...createStore(task),
            shouldUseRuntimeProductAPI: () => runtimeProductActive,
            shouldUseRuntimeProductTaskRoute: () => runtimeProductActive,
            canUseProductMethod: (method: string) => method === OPENADE_METHOD.projectSdkCapabilitiesRead,
            readProductProjectSdkCapabilities,
        } as unknown as CodeStore
        const model = new TaskModel(store, task.id)

        const legacyManager = model.sdkCapabilities
        runtimeProductActive = true
        const runtimeManager = model.sdkCapabilities

        expect(runtimeManager).toBeDefined()
        expect(runtimeManager).not.toBe(legacyManager)
        await runtimeManager?.loadCapabilities("/repo")
        expect(readProductProjectSdkCapabilities).toHaveBeenCalledWith({
            repoId: "repo-1",
            taskId: "task-1",
            harnessId: "claude-code",
        })
        expect(runtimeManager?.slashCommands).toEqual(["/runtime"])
    })

    it("attaches Core-owned SDK capability reads from the lazy slash-command manager", async () => {
        const task = createTask([])
        let runtimeProductAPIAvailable = false
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            if (method !== OPENADE_METHOD.projectSdkCapabilitiesRead) return false
            runtimeProductAPIAvailable = true
            return true
        })
        const readProductProjectSdkCapabilities = vi.fn().mockResolvedValue({
            slash_commands: ["/core"],
            skills: ["core-skill"],
            plugins: [],
            cachedAt: 1_779_811_200_000,
        })
        const store = {
            ...createStore(task),
            shouldUseRuntimeProductAPI: () => runtimeProductAPIAvailable,
            usesCoreOwnedProductRuntime: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod: vi.fn((method: string) => runtimeProductAPIAvailable && method === OPENADE_METHOD.projectSdkCapabilitiesRead),
            canUseProductMethodAfterConnect,
            readProductProjectSdkCapabilities,
        } as unknown as CodeStore
        const model = new TaskModel(store, task.id)

        const manager = model.sdkCapabilities
        expect(manager).toBeDefined()
        await manager?.loadCapabilities("/repo")

        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.projectSdkCapabilitiesRead)
        expect(readProductProjectSdkCapabilities).toHaveBeenCalledWith({
            repoId: "repo-1",
            taskId: "task-1",
            harnessId: "claude-code",
        })
        expect(manager?.slashCommands).toEqual(["/core"])
        expect(manager?.skills).toEqual(["core-skill"])
    })

    it("keeps legacy file and content search managers on the raw files API", async () => {
        const task = createTask([])
        const describePath = vi.spyOn(filesApi, "describePath").mockResolvedValue(legacyFileResponse("/repo/README.md"))
        const contentSearch = vi.spyOn(filesApi, "contentSearch").mockResolvedValue({
            matches: [
                {
                    file: "README.md",
                    line: 1,
                    content: "needle",
                    matchStart: 0,
                    matchEnd: 6,
                },
            ],
            truncated: false,
        })
        const readProductProjectFile = vi.fn(async (args: { repoId: string; taskId?: string; path: string }) => productFileResponse(args))
        const searchProductProject = vi.fn(async (args: { repoId: string; taskId?: string }) => productSearchResponse(args))
        const store = {
            ...createStore(task),
            readProductProjectFile,
            searchProductProject,
        } as unknown as CodeStore
        const model = new TaskModel(store, task.id)

        try {
            await model.fileBrowser.openFile("/repo/README.md")
            model.contentSearch.setWorkingDir("/repo")
            model.contentSearch.setQuery("needle")

            await vi.waitFor(() => expect(contentSearch).toHaveBeenCalled(), { timeout: 1000, interval: 10 })

            expect(describePath).toHaveBeenCalledWith({
                path: "/repo/README.md",
                readContents: true,
                maxReadSize: 5 * 1024 * 1024,
            })
            expect(model.fileBrowser.activeFileData?.content).toBe("legacy file")
            expect(model.contentSearch.contentResults).toEqual([
                {
                    path: "README.md",
                    line: 1,
                    content: "needle",
                    matchStart: 0,
                    matchEnd: 6,
                },
            ])
            expect(readProductProjectFile).not.toHaveBeenCalled()
            expect(searchProductProject).not.toHaveBeenCalled()
        } finally {
            describePath.mockRestore()
            contentSearch.mockRestore()
        }
    })

    it("routes runtime file and content search managers through product APIs without raw file fallback", async () => {
        const task = createTask([])
        const describePath = vi.spyOn(filesApi, "describePath").mockRejectedValue(new Error("legacy files API should not be used"))
        const contentSearch = vi.spyOn(filesApi, "contentSearch").mockRejectedValue(new Error("legacy content search should not be used"))
        const listProductProjectFiles = vi.fn(async (args: { repoId: string; taskId?: string; path?: string }) => productTreeResponse(args))
        const readProductProjectFile = vi.fn(async (args: { repoId: string; taskId?: string; path: string }) => productFileResponse(args))
        const fuzzySearchProductProjectFiles = vi.fn(async (args: { repoId: string; taskId?: string }) => ({
            repoId: args.repoId,
            taskId: args.taskId,
            results: ["README.md"],
            truncated: false,
            source: "filesystem" as const,
        }))
        const searchProductProject = vi.fn(async (args: { repoId: string; taskId?: string }) => productSearchResponse(args))
        const store = {
            ...createStore(task),
            shouldUseRuntimeProductAPI: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod: () => true,
            repos: {
                getRepo: (repoId: string) =>
                    repoId === "repo-1"
                        ? {
                              id: "repo-1",
                              name: "Repo",
                              path: "/repo",
                              tasks: [],
                          }
                        : null,
            },
            listProductProjectFiles,
            readProductProjectFile,
            fuzzySearchProductProjectFiles,
            searchProductProject,
        } as unknown as CodeStore
        const model = new TaskModel(store, task.id)

        try {
            await model.fileBrowser.openFile("/repo/README.md")
            model.contentSearch.setQuery("needle")

            await vi.waitFor(() => expect(searchProductProject).toHaveBeenCalled(), { timeout: 1000, interval: 10 })

            expect(readProductProjectFile).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                path: "README.md",
                maxBytes: 5 * 1024 * 1024,
            })
            expect(searchProductProject).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                query: "needle",
                limit: 100,
                caseSensitive: false,
            })
            expect(listProductProjectFiles).toHaveBeenCalled()
            expect(fuzzySearchProductProjectFiles).not.toHaveBeenCalled()
            expect(describePath).not.toHaveBeenCalled()
            expect(contentSearch).not.toHaveBeenCalled()
            expect(model.fileBrowser.activeFileData?.content).toBe("product file: README.md")
            expect(model.contentSearch.previewData?.content).toBe("product file: README.md")
        } finally {
            describePath.mockRestore()
            contentSearch.mockRestore()
        }
    })

    it("attaches Core-owned file and content search capabilities before product file requests", async () => {
        const task = createTask([])
        let runtimeProductAPIAvailable = false
        const attachedMethods = new Set<string>()
        const describePath = vi.spyOn(filesApi, "describePath").mockRejectedValue(new Error("legacy files API should not be used"))
        const contentSearch = vi.spyOn(filesApi, "contentSearch").mockRejectedValue(new Error("legacy content search should not be used"))
        const listProductProjectFiles = vi.fn(async (args: { repoId: string; taskId?: string; path?: string }) => productTreeResponse(args))
        const readProductProjectFile = vi.fn(async (args: { repoId: string; taskId?: string; path: string }) => productFileResponse(args))
        const fuzzySearchProductProjectFiles = vi.fn()
        const searchProductProject = vi.fn(async (args: { repoId: string; taskId?: string }) => productSearchResponse(args))
        const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
            runtimeProductAPIAvailable = true
            attachedMethods.add(method)
            return (
                method === OPENADE_METHOD.projectFilesTree ||
                method === OPENADE_METHOD.projectFileRead ||
                method === OPENADE_METHOD.projectSearch
            )
        })
        const store = {
            ...createStore(task),
            shouldUseRuntimeProductAPI: () => runtimeProductAPIAvailable,
            usesCoreOwnedProductRuntime: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod: vi.fn((method: string) => attachedMethods.has(method)),
            canUseProductMethodAfterConnect,
            repos: {
                getRepo: (repoId: string) =>
                    repoId === "repo-1"
                        ? {
                              id: "repo-1",
                              name: "Repo",
                              path: "/repo",
                              tasks: [],
                          }
                        : null,
            },
            listProductProjectFiles,
            readProductProjectFile,
            fuzzySearchProductProjectFiles,
            searchProductProject,
        } as unknown as CodeStore
        const model = new TaskModel(store, task.id)

        try {
            await model.fileBrowser.openFile("/repo/README.md")
            model.contentSearch.setQuery("needle")

            await vi.waitFor(() => expect(searchProductProject).toHaveBeenCalled(), { timeout: 1000, interval: 10 })

            expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.projectFilesTree)
            expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.projectFileRead)
            expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.projectSearch)
            expect(readProductProjectFile).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                path: "README.md",
                maxBytes: 5 * 1024 * 1024,
            })
            expect(searchProductProject).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                query: "needle",
                limit: 100,
                caseSensitive: false,
            })
            expect(listProductProjectFiles).toHaveBeenCalled()
            expect(fuzzySearchProductProjectFiles).not.toHaveBeenCalled()
            expect(describePath).not.toHaveBeenCalled()
            expect(contentSearch).not.toHaveBeenCalled()
        } finally {
            describePath.mockRestore()
            contentSearch.mockRestore()
        }
    })

    it("fails closed without product or raw file requests when runtime file/search capabilities are absent", async () => {
        const task = createTask([])
        const describePath = vi.spyOn(filesApi, "describePath").mockRejectedValue(new Error("legacy files API should not be used"))
        const contentSearch = vi.spyOn(filesApi, "contentSearch").mockRejectedValue(new Error("legacy content search should not be used"))
        const listProductProjectFiles = vi.fn(async (args: { repoId: string; taskId?: string; path?: string }) => productTreeResponse(args))
        const readProductProjectFile = vi.fn(async (args: { repoId: string; taskId?: string; path: string }) => productFileResponse(args))
        const fuzzySearchProductProjectFiles = vi.fn(async (args: { repoId: string; taskId?: string }) => ({
            repoId: args.repoId,
            taskId: args.taskId,
            results: ["README.md"],
            truncated: false,
            source: "filesystem" as const,
        }))
        const searchProductProject = vi.fn(async (args: { repoId: string; taskId?: string }) => productSearchResponse(args))
        const canUseProductMethod = vi.fn(() => false)
        const store = {
            ...createStore(task),
            shouldUseRuntimeProductAPI: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            canUseProductMethod,
            repos: {
                getRepo: (repoId: string) =>
                    repoId === "repo-1"
                        ? {
                              id: "repo-1",
                              name: "Repo",
                              path: "/repo",
                              tasks: [],
                          }
                        : null,
            },
            listProductProjectFiles,
            readProductProjectFile,
            fuzzySearchProductProjectFiles,
            searchProductProject,
        } as unknown as CodeStore
        const model = new TaskModel(store, task.id)

        try {
            await model.fileBrowser.openFile("/repo/README.md")
            model.contentSearch.setQuery("needle")

            await vi.waitFor(() => expect(canUseProductMethod).toHaveBeenCalledWith(OPENADE_METHOD.projectSearch), { timeout: 1000, interval: 10 })

            expect(model.fileBrowser.fileError).toBe("File not found")
            expect(model.contentSearch.contentResults).toEqual([])
            expect(listProductProjectFiles).not.toHaveBeenCalled()
            expect(readProductProjectFile).not.toHaveBeenCalled()
            expect(fuzzySearchProductProjectFiles).not.toHaveBeenCalled()
            expect(searchProductProject).not.toHaveBeenCalled()
            expect(describePath).not.toHaveBeenCalled()
            expect(contentSearch).not.toHaveBeenCalled()
        } finally {
            describePath.mockRestore()
            contentSearch.mockRestore()
        }
    })

    it("hydrates harness/model from latest action event", () => {
        const task = createTask([
            createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "opus" }),
            createActionEvent({ id: "a2", harnessId: "codex", modelId: "gpt-5.3-codex" }),
        ])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("codex")
        expect(model.model).toBe("gpt-5.3-codex")
    })

    it("hydrates fast mode from latest action event", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "codex", modelId: "gpt-5.5", fastMode: true })])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.fastMode).toBe(true)
    })

    it("skips review events when restoring harness/model from history", () => {
        const primaryEvent = createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "opus" })
        const reviewEvent = {
            ...createActionEvent({ id: "a2", harnessId: "codex", modelId: "gpt-5.3-codex" }),
            source: { type: "review" as const, userLabel: "Review", reviewType: "work" as const },
        }
        const task = createTask([primaryEvent, reviewEvent])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("opus")
    })

    it("maps persisted exact Opus full model IDs to versioned aliases", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "claude-opus-4-7" })])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("opus-4-7")
    })

    it("maps persisted Opus 4.6 full model IDs to versioned aliases", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "claude-opus-4-6" })])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("opus-4-6")
    })

    it("maps persisted Opus 4.8 full model IDs to versioned aliases", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "claude-opus-4-8" })])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("opus-4-8")
    })

    it("maps future Claude Sonnet full model IDs to stable aliases", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "claude-sonnet-4-7-20260601" })])

        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("sonnet")
    })

    it("does not allow harness switching once action history exists", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "codex", modelId: "gpt-5.3-codex" })])

        const model = new TaskModel(createStore(task), task.id)
        model.setHarnessId("claude-code")

        expect(model.harnessId).toBe("codex")
        expect(model.model).toBe("gpt-5.3-codex")
    })

    it("allows model switching while harness remains locked", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "opus" })])

        const model = new TaskModel(createStore(task), task.id)
        model.setHarnessId("codex")
        model.setModel("sonnet")

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("sonnet")
    })

    it("allows harness switching for tasks without action history", () => {
        const task = createTask([])

        const model = new TaskModel(createStore(task), task.id)
        model.setHarnessId("codex")

        expect(model.harnessId).toBe("codex")
        expect(model.model).toBe(getDefaultModelForHarness("codex"))
    })

    it("v1 compat: reads harnessId from legacy `type` field", () => {
        // Pre-harness tasks stored `type: "claude-code"` instead of `harnessId`
        const legacyEvent = {
            id: "a1",
            type: "action" as const,
            status: "completed" as const,
            createdAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:01.000Z",
            userInput: "test",
            execution: {
                type: "claude-code",
                executionId: "a1-exec",
                modelId: "claude-opus-4-7",
                events: [],
            },
            source: { type: "do" as const, userLabel: "Do" },
            includesCommentIds: [],
            result: { success: true },
        } as unknown as ActionEvent

        const task = createTask([legacyEvent])
        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("opus-4-7")
    })

    it("v1 compat: defaults to claude-code when neither harnessId nor type exists", () => {
        const legacyEvent = {
            id: "a1",
            type: "action" as const,
            status: "completed" as const,
            createdAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:01.000Z",
            userInput: "test",
            execution: {
                executionId: "a1-exec",
                modelId: "opus",
                events: [],
            },
            source: { type: "do" as const, userLabel: "Do" },
            includesCommentIds: [],
            result: { success: true },
        } as unknown as ActionEvent

        const task = createTask([legacyEvent])
        const model = new TaskModel(createStore(task), task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("opus")
    })

    it("serializes task threads as JSON and XML", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "claude-code", modelId: "opus" })])

        const model = new TaskModel(createStore(task), task.id)

        const threadJson = model.getThreadJson()
        expect(threadJson?.task.id).toBe(task.id)
        expect(threadJson?.events).toHaveLength(1)

        const threadXml = model.getThreadXml()
        expect(threadXml).toContain(`<task id="${task.id}"`)
        expect(threadXml).toContain(`<event id="a1"`)
    })
})

describe("HyperPlan handoff consistency", () => {
    /**
     * Regression test: after HyperPlan completes, follow-up actions must use
     * the terminal step's (reconciler's) harness+model. Without a fix, the
     * TaskModel retains whatever harness+model it had before HyperPlan ran,
     * leading to a mismatch between the session being resumed and the
     * harness/model used to resume it.
     *
     * The real-world flow:
     * 1. TaskModel constructed (defaults to claude-code + DEFAULT_MODEL)
     * 2. HyperPlan runs — reconciler uses e.g. codex + o3
     * 3. Reconciler's session ID saved on the ActionEvent
     * 4. User clicks "Run Plan" — runAction reads taskModel.harnessId/model
     *    AND getLastEventSessionId() for the session
     * 5. BUG: harnessId/model are stale defaults, but session is the reconciler's
     */

    function createHyperPlanEvent({
        id,
        harnessId,
        modelId,
        sessionId,
    }: {
        id: string
        harnessId: HarnessId
        modelId: string
        sessionId: string
    }): ActionEvent {
        return {
            id,
            type: "action",
            status: "completed",
            createdAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:01.000Z",
            userInput: "Implement dark mode",
            execution: {
                harnessId,
                executionId: `${id}-exec`,
                modelId,
                sessionId,
                events: [],
            },
            source: { type: "hyperplan", userLabel: "HyperPlan", strategyId: "ensemble" },
            includesCommentIds: [],
            result: { success: true },
        }
    }

    function createEventManager(events: ActionEvent[]): EventManager {
        return new EventManager({
            tasks: {
                getTask: (taskId: string) => (taskId === "task-1" ? createTask(events) : null),
            },
        } as unknown as CodeStore)
    }

    it("syncHarnessFromHistory updates TaskModel after HyperPlan (cross-harness)", () => {
        // Simulates the real flow: TaskModel exists before HyperPlan, then
        // HyperPlan adds an event with a different harness/model.
        const task = createTask([])
        const store = createStore(task)
        const model = new TaskModel(store, task.id)

        // Starts with defaults
        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe(DEFAULT_MODEL)

        // HyperPlan completes — reconciler used codex
        const hyperplanEvent = createHyperPlanEvent({
            id: "hp-1",
            harnessId: "codex",
            modelId: "gpt-5.3-codex",
            sessionId: "reconciler-session-abc",
        })
        task.events.push(hyperplanEvent)

        // Before sync: TaskModel is stale
        expect(model.harnessId).toBe("claude-code")

        // After sync: TaskModel matches the reconciler
        model.syncHarnessFromHistory()
        expect(model.harnessId).toBe("codex")
        expect(model.model).toBe("gpt-5.3-codex")
    })

    it("syncHarnessFromHistory updates TaskModel after HyperPlan (same-harness, different model)", () => {
        const task = createTask([])
        const store = createStore(task)
        const model = new TaskModel(store, task.id)

        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe(DEFAULT_MODEL)

        // HyperPlan reconciler used claude-code + sonnet (same harness, different model)
        task.events.push(
            createHyperPlanEvent({
                id: "hp-1",
                harnessId: "claude-code",
                modelId: "sonnet",
                sessionId: "reconciler-session-456",
            })
        )

        // Before sync: model is still the default
        expect(model.model).toBe(DEFAULT_MODEL)

        // After sync: model matches the reconciler
        model.syncHarnessFromHistory()
        expect(model.harnessId).toBe("claude-code")
        expect(model.model).toBe("sonnet")
    })

    it("getLastEventSessionContext returns harness/model with session ID", () => {
        const hyperplanEvent = createHyperPlanEvent({
            id: "hp-1",
            harnessId: "codex",
            modelId: "gpt-5.3-codex",
            sessionId: "reconciler-session-xyz",
        })
        const task = createTask([hyperplanEvent])
        const eventManager = createEventManager(task.events as ActionEvent[])

        const ctx = eventManager.getLastEventSessionContext(task.id)
        expect(ctx).toEqual({
            sessionId: "reconciler-session-xyz",
            harnessId: "codex",
            modelId: "gpt-5.3-codex",
        })
    })

    it("session context and TaskModel agree after construction with HyperPlan event", () => {
        const hyperplanEvent = createHyperPlanEvent({
            id: "hp-1",
            harnessId: "codex",
            modelId: "gpt-5.3-codex",
            sessionId: "reconciler-session-xyz",
        })
        const task = createTask([hyperplanEvent])

        const eventManager = createEventManager(task.events as ActionEvent[])
        const ctx = eventManager.getLastEventSessionContext(task.id)!

        // TaskModel constructed after event — picks up reconciler values
        const store = createStore(task)
        const model = new TaskModel(store, task.id)

        // Both agree: the session was created by codex/gpt-5.3-codex
        expect(model.harnessId).toBe(ctx.harnessId)
        expect(model.model).toBe(ctx.modelId)
    })

    it("runAction resolution: session context drives harness/model when resuming (regression)", () => {
        // This replicates the exact resolution logic from ExecutionManager.runAction:
        //
        //   const sessionContext = freshSession ? undefined : store.events.getLastEventSessionContext(taskId)
        //   const parentSessionId = sessionContext?.sessionId
        //   const effectiveHarnessId = overrideHarnessId ?? (parentSessionId ? sessionContext.harnessId : taskModel.harnessId)
        //   const effectiveModel = overrideModel ?? (parentSessionId ? (sessionContext.modelId ?? taskModel.model) : taskModel.model)
        //
        // The bug was: this used to be just `taskModel.harnessId` / `taskModel.model`
        // regardless of the session, causing cross-harness session resume failures.

        const task = createTask([])
        const store = createStore(task)
        const taskModel = new TaskModel(store, task.id)

        // TaskModel starts with defaults
        expect(taskModel.harnessId).toBe("claude-code")
        expect(taskModel.model).toBe(DEFAULT_MODEL)

        // HyperPlan adds event with different harness
        task.events.push(
            createHyperPlanEvent({
                id: "hp-1",
                harnessId: "codex",
                modelId: "gpt-5.3-codex",
                sessionId: "reconciler-session-abc",
            })
        )

        const eventManager = createEventManager(task.events as ActionEvent[])
        const sessionContext = eventManager.getLastEventSessionContext(task.id)

        // Replicate runAction resolution — the fix:
        const parentSessionId = sessionContext?.sessionId
        const effectiveHarnessId = parentSessionId ? sessionContext!.harnessId : taskModel.harnessId
        const effectiveModel = parentSessionId ? (sessionContext!.modelId ?? taskModel.model) : taskModel.model

        // Session exists, so harness/model come from the session context, NOT the stale TaskModel
        expect(parentSessionId).toBe("reconciler-session-abc")
        expect(effectiveHarnessId).toBe("codex")
        expect(effectiveModel).toBe("gpt-5.3-codex")

        // The old broken behavior would have been:
        //   effectiveHarnessId = taskModel.harnessId = "claude-code"  (WRONG)
        //   effectiveModel = taskModel.model = DEFAULT_MODEL           (WRONG)
        // Verify these are indeed different to confirm the fix matters:
        expect(taskModel.harnessId).not.toBe(effectiveHarnessId)
        expect(taskModel.model).not.toBe(effectiveModel)
    })
})

describe("TaskModel stats", () => {
    it("uses runtime preview usage instead of scanning task events when runtime reads are active", () => {
        const task = createTask([createActionEvent({ id: "a1", harnessId: "codex", modelId: "gpt-test" })])
        const getRuntimeProductTaskPreviewDto = vi.fn(() => ({
            usage: {
                usageVersion: 2,
                inputTokens: 123,
                outputTokens: 45,
                totalCostUsd: 0.42,
                eventCount: 1,
                costByModel: { "gpt-test": 0.42 },
                durationMs: 6_000,
            },
        }))
        const store = {
            execution: {
                onAfterEvent: () => () => {},
            },
            tasks: {
                getTask: (taskId: string) => (taskId === task.id ? task : null),
            },
            shouldUseRuntimeProductAPI: () => true,
            shouldUseRuntimeProductTaskRoute: () => true,
            getRuntimeProductTaskPreviewDto,
        } as unknown as CodeStore

        const model = new TaskModel(store, task.id)

        expect(model.stats).toEqual({
            totalCostUsd: 0.42,
            durationMs: 6_000,
            inputTokens: 123,
            outputTokens: 45,
        })
        expect(getRuntimeProductTaskPreviewDto).toHaveBeenCalledWith("repo-1", "task-1")
    })
})

describe("TaskModel environment loading", () => {
    it("does not force setup for legacy head-mode tasks without device environment rows", async () => {
        const task: Task = createTask([])
        const repo = {
            id: "repo-1",
            name: "Repo",
            path: "/tmp/repo",
            createdBy: { id: "u1", email: "u1@example.com" },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        }

        const store = {
            execution: {
                onAfterEvent: () => () => {},
            },
            tasks: {
                getTask: (taskId: string) => (taskId === task.id ? task : null),
            },
            repos: {
                getRepo: (repoId: string) => (repoId === repo.id ? repo : undefined),
                getGitInfo: vi.fn(async () => null),
            },
            shouldUseRuntimeProductAPI: () => false,
            usesCoreOwnedProductRuntime: () => false,
            shouldUseRuntimeProductTaskRoute: () => false,
        } as unknown as CodeStore

        localStorage.setItem("openade-device-id", "test-device")

        try {
            const model = new TaskModel(store, task.id)
            const env = await model.loadEnvironment()

            expect(model.needsEnvironmentSetup).toBe(false)
            expect(env?.taskWorkingDir).toBe("/tmp/repo")
        } finally {
            localStorage.removeItem("openade-device-id")
        }
    })

    it("derives worktree environment from legacy setup events", async () => {
        const setupEvent: SetupEnvironmentEvent = {
            id: "setup-1",
            type: "setup_environment",
            status: "completed",
            createdAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:00.000Z",
            userInput: "Environment setup",
            worktreeId: "task-1",
            deviceId: "legacy-device",
            workingDir: "/tmp/openade-worktrees/task-1/packages/web",
            setupOutput: "Worktree: /tmp/openade-worktrees/task-1\nWorking directory: /tmp/openade-worktrees/task-1/packages/web",
        }
        const task: Task = {
            ...createTask([]),
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            events: [setupEvent],
        }
        const repo = {
            id: "repo-1",
            name: "Repo",
            path: "/tmp/repo/packages/web",
            createdBy: { id: "u1", email: "u1@example.com" },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        }

        const store = {
            execution: {
                onAfterEvent: () => () => {},
            },
            tasks: {
                getTask: (taskId: string) => (taskId === task.id ? task : null),
            },
            repos: {
                getRepo: (repoId: string) => (repoId === repo.id ? repo : undefined),
                getGitInfo: vi.fn(async () => ({ isGitRepo: true, repoRoot: "/tmp/repo", relativePath: "packages/web", mainBranch: "main", hasGhCli: false })),
            },
            shouldUseRuntimeProductAPI: () => false,
            usesCoreOwnedProductRuntime: () => false,
            shouldUseRuntimeProductTaskRoute: () => false,
        } as unknown as CodeStore

        localStorage.setItem("openade-device-id", "test-device")

        try {
            const model = new TaskModel(store, task.id)
            const env = await model.loadEnvironment()

            expect(model.needsEnvironmentSetup).toBe(false)
            expect(env?.taskWorkingDir).toBe("/tmp/openade-worktrees/task-1/packages/web")
        } finally {
            localStorage.removeItem("openade-device-id")
        }
    })

    it("builds runtime worktree environments from setup workingDir without loading project git info", async () => {
        const setupEvent: SetupEnvironmentEvent = {
            id: "setup-1",
            type: "setup_environment",
            status: "completed",
            createdAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:00.000Z",
            userInput: "Environment setup",
            worktreeId: "task-1",
            deviceId: "test-device",
            workingDir: "/tmp/openade-worktrees/task-1/packages/web",
            setupOutput: "Working directory: /tmp/openade-worktrees/task-1/packages/web",
        }
        const task: Task = {
            ...createTask([]),
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            deviceEnvironments: [
                {
                    id: "device-1",
                    deviceId: "test-device",
                    setupComplete: true,
                    worktreeDir: "/tmp/openade-worktrees/task-1",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    lastUsedAt: "2026-01-01T00:00:00.000Z",
                },
            ],
            events: [setupEvent],
        }
        const getGitInfo = vi.fn(async () => {
            throw new Error("project git info should not be loaded for a prepared runtime worktree")
        })
        const store = {
            execution: {
                onAfterEvent: () => () => {},
            },
            tasks: {
                getTask: (taskId: string) => (taskId === task.id ? task : null),
            },
            repos: {
                getRepo: () => undefined,
                getGitInfo,
            },
            shouldUseRuntimeProductAPI: () => true,
            usesCoreOwnedProductRuntime: () => false,
            shouldUseRuntimeProductTaskRoute: () => true,
            findProductRepoIdForTask: () => task.repoId,
        } as unknown as CodeStore

        localStorage.setItem("openade-device-id", "test-device")

        try {
            const model = new TaskModel(store, task.id)
            const env = await model.loadEnvironment()

            expect(env?.taskWorkingDir).toBe("/tmp/openade-worktrees/task-1/packages/web")
            expect(env?.hasGit).toBe(true)
            expect(getGitInfo).not.toHaveBeenCalled()
        } finally {
            localStorage.removeItem("openade-device-id")
        }
    })

    it("builds runtime head environments from projected repos without loading project git info", async () => {
        const task: Task = {
            ...createTask([]),
            isolationStrategy: { type: "head" },
            deviceEnvironments: [
                {
                    id: "device-1",
                    deviceId: "test-device",
                    setupComplete: true,
                    createdAt: "2026-01-01T00:00:00.000Z",
                    lastUsedAt: "2026-01-01T00:00:00.000Z",
                },
            ],
        }
        const repo = {
            id: "repo-1",
            name: "Repo",
            path: "/tmp/repo",
            createdBy: { id: "u1", email: "u1@example.com" },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        }
        const getGitInfo = vi.fn(async () => {
            throw new Error("project git info should not be loaded for a runtime head task with repo projection")
        })
        const store = {
            execution: {
                onAfterEvent: () => () => {},
            },
            tasks: {
                getTask: (taskId: string) => (taskId === task.id ? task : null),
            },
            repos: {
                getRepo: (repoId: string) => (repoId === repo.id ? repo : undefined),
                getGitInfo,
            },
            shouldUseRuntimeProductAPI: () => true,
            usesCoreOwnedProductRuntime: () => false,
            shouldUseRuntimeProductTaskRoute: () => true,
            findProductRepoIdForTask: () => task.repoId,
        } as unknown as CodeStore

        localStorage.setItem("openade-device-id", "test-device")

        try {
            const model = new TaskModel(store, task.id)
            const env = await model.loadEnvironment()

            expect(env?.taskWorkingDir).toBe("/tmp/repo")
            expect(env?.hasGit).toBe(false)
            expect(getGitInfo).not.toHaveBeenCalled()
        } finally {
            localStorage.removeItem("openade-device-id")
        }
    })

    it("coalesces concurrent loadEnvironment calls", async () => {
        const task: Task = {
            ...createTask([]),
            deviceEnvironments: [
                {
                    id: "device-1",
                    deviceId: "test-device",
                    setupComplete: true,
                    createdAt: "2026-01-01T00:00:00.000Z",
                    lastUsedAt: "2026-01-01T00:00:00.000Z",
                },
            ],
        }

        const repo = {
            id: "repo-1",
            name: "Repo",
            path: "/tmp/repo/subdir",
            createdBy: { id: "u1", email: "u1@example.com" },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        }

        const getGitInfo = vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25))
            return null
        })

        const store = {
            execution: {
                onAfterEvent: () => () => {},
            },
            tasks: {
                getTask: (taskId: string) => (taskId === task.id ? task : null),
            },
            repos: {
                getRepo: (repoId: string) => (repoId === repo.id ? repo : undefined),
                getGitInfo,
            },
            shouldUseRuntimeProductAPI: () => false,
            usesCoreOwnedProductRuntime: () => false,
            shouldUseRuntimeProductTaskRoute: () => false,
        } as unknown as CodeStore

        localStorage.setItem("openade-device-id", "test-device")

        try {
            const model = new TaskModel(store, task.id)
            const [first, second] = await Promise.all([model.loadEnvironment(), model.loadEnvironment()])
            expect(first).toBeTruthy()
            expect(first).toBe(second)
            expect(getGitInfo).toHaveBeenCalledTimes(1)
        } finally {
            localStorage.removeItem("openade-device-id")
        }
    })
})
