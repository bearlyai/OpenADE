import { type ReactNode, createElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD, type OpenADEMethod } from "../../../openade-client/src"
import { CodeStoreProvider } from "../store/context"
import type { TaskModel } from "../store/TaskModel"
import type { CodeStore } from "../store/store"
import { TaskPage } from "./TaskPage"

const componentMocks = vi.hoisted(() => ({
    eventLogProps: [] as Array<{ isLoading?: boolean; onRequestFullHistory?: () => void }>,
    inputBarProps: [] as Array<{
        enabledMcpServerIds?: string[]
        onMcpServerIdsChange?: (serverIds: string[]) => void
        fileMentionsDir?: string | null
        slashCommandsDir?: string | null
        resolveWorkingDir?: () => Promise<string | null>
        resolveSdkCapabilities?: () => unknown
    }>,
}))

vi.mock("../components/EventLog", () => ({
    EventLog: ({ isLoading, onRequestFullHistory }: { isLoading?: boolean; onRequestFullHistory?: () => void }) => {
        componentMocks.eventLogProps.push({ isLoading, onRequestFullHistory })
        return createElement(
            "button",
            {
                "data-testid": "event-log",
                type: "button",
                onClick: () => onRequestFullHistory?.(),
            },
            "event log"
        )
    },
}))

vi.mock("../components/InputBar", () => ({
    InputBar: (props: {
        enabledMcpServerIds?: string[]
        onMcpServerIdsChange?: (serverIds: string[]) => void
        fileMentionsDir?: string | null
        slashCommandsDir?: string | null
        resolveWorkingDir?: () => Promise<string | null>
        resolveSdkCapabilities?: () => unknown
    }) => {
        componentMocks.inputBarProps.push({
            enabledMcpServerIds: props.enabledMcpServerIds,
            onMcpServerIdsChange: props.onMcpServerIdsChange,
            fileMentionsDir: props.fileMentionsDir,
            slashCommandsDir: props.slashCommandsDir,
            resolveWorkingDir: props.resolveWorkingDir,
            resolveSdkCapabilities: props.resolveSdkCapabilities,
        })
        return createElement("div", { "data-testid": "input-bar" })
    },
}))

vi.mock("../components/ImageDropOverlay", () => ({
    ImageDropOverlay: () => createElement("div", { "data-testid": "image-drop-overlay" }),
}))

vi.mock("../components/EnvironmentSetupView", () => ({
    EnvironmentSetupView: ({ onComplete }: { onComplete: () => void }) =>
        createElement("button", { "data-testid": "environment-setup", type: "button", onClick: onComplete }, "environment setup"),
}))

vi.mock("../components/ui/ScrollArea", () => ({
    ScrollArea: ({ children }: { children?: ReactNode }) => createElement("div", { "data-testid": "scroll-area" }, children),
}))

const hookMocks = vi.hoisted(() => ({
    useImageDropZone: vi.fn((_editorManager: unknown, _persistImage: unknown) => ({ isDragOver: false, dragHandlers: {} })),
}))

vi.mock("../hooks/useImageDropZone", () => ({
    useImageDropZone: hookMocks.useImageDropZone,
}))

vi.mock("../hooks/useShortcutHintsVisible", () => ({
    useShortcutHintsVisible: () => false,
}))

vi.mock("../shell/task/useTaskThreadScroll", () => ({
    useTaskThreadScroll: () => ({ viewportRef: { current: null } }),
}))

function makeTaskModel({
    taskWorkingDir = null,
    taskWorkingDirHint = "/repo",
    canAttachImages = true,
    needsEnvironmentSetup = false,
    enabledMcpServerIds = [],
}: {
    taskWorkingDir?: string | null
    taskWorkingDirHint?: string | null
    canAttachImages?: boolean
    needsEnvironmentSetup?: boolean
    enabledMcpServerIds?: string[]
} = {}) {
    const fileBrowser = {
        setWorkingDir: vi.fn(),
    }
    const contentSearch = {
        setWorkingDir: vi.fn(),
    }
    const sdkCapabilities = {
        slashCommands: [],
        skills: [],
        allCommands: [],
        loadCapabilities: vi.fn(async () => undefined),
    }
    const fileBrowserAccess = vi.fn(() => fileBrowser)
    const contentSearchAccess = vi.fn(() => contentSearch)
    const sdkCapabilitiesAccess = vi.fn(() => sdkCapabilities)
    const taskModel = {
        input: {
            persistImage: vi.fn(),
            canAttachImages,
        },
        tray: {
            isOpen: false,
            close: vi.fn(),
            toggle: vi.fn(),
        },
        exists: true,
        needsEnvironmentSetup,
        environment: taskWorkingDir ? { taskWorkingDir } : null,
        taskWorkingDirHint,
        ensureTaskWorkingDirHint: vi.fn(async () => "/repo"),
        get fileBrowser() {
            return fileBrowserAccess()
        },
        get contentSearch() {
            return contentSearchAccess()
        },
        gitStatus: null,
        pullRequest: null,
        get sdkCapabilities() {
            return sdkCapabilitiesAccess()
        },
        model: null,
        setModel: vi.fn(),
        thinking: false,
        setThinking: vi.fn(),
        fastMode: false,
        setFastMode: vi.fn(),
        harnessId: "claude-code",
        enabledMcpServerIds,
        setEnabledMcpServerIds: vi.fn(),
        refreshGitState: vi.fn(),
        loadEnvironment: vi.fn(async () => null),
        isWorking: true,
    } as unknown as TaskModel
    return {
        taskModel,
        fileBrowser,
        contentSearch,
        fileBrowserAccess,
        contentSearchAccess,
        sdkCapabilitiesAccess,
        sdkCapabilities,
    }
}

function makeCodeStore({
    runtimeProductAPI = true,
    coreOwned = false,
    canPersistTaskViewed = true,
    canReadTaskDetails = true,
    canReadMcpServers = true,
    canSearchProjectFiles = true,
    canReadProjectSdkCapabilities = true,
    attachCoreMethods = false,
    task = { id: "task-1", events: [] },
}: {
    runtimeProductAPI?: boolean
    coreOwned?: boolean
    canPersistTaskViewed?: boolean
    canReadTaskDetails?: boolean
    canReadMcpServers?: boolean
    canSearchProjectFiles?: boolean
    canReadProjectSdkCapabilities?: boolean
    attachCoreMethods?: boolean
    task?: { id: string; events: [] } | null
} = {}) {
    let runtimeProductAPIAvailable = runtimeProductAPI
    let canPersistTaskViewedAvailable = canPersistTaskViewed
    let canReadTaskDetailsAvailable = canReadTaskDetails
    let canReadMcpServersAvailable = canReadMcpServers
    let canSearchProjectFilesAvailable = canSearchProjectFiles
    let canReadProjectSdkCapabilitiesAvailable = canReadProjectSdkCapabilities
    const markTaskViewed = vi.fn()
    const loadRuntimeProductTask = vi.fn(async () => null)
    const smartEditorsGetManager = vi.fn(() => ({}))
    const ensureCoreOwnedProductMethodsAvailable = vi.fn(async () => {
        if (!attachCoreMethods) return
        runtimeProductAPIAvailable = true
        canPersistTaskViewedAvailable = true
        canReadTaskDetailsAvailable = true
        canReadMcpServersAvailable = true
        canSearchProjectFilesAvailable = true
        canReadProjectSdkCapabilitiesAvailable = true
    })
    const canUseProductMethodAfterConnect = vi.fn(async (method: OpenADEMethod) => {
        if (attachCoreMethods) {
            runtimeProductAPIAvailable = true
            canPersistTaskViewedAvailable = true
            canReadTaskDetailsAvailable = true
            canReadMcpServersAvailable = true
        }
        if (method === OPENADE_METHOD.taskMetadataUpdate) return canPersistTaskViewedAvailable
        if (method === OPENADE_METHOD.taskRead) return canReadTaskDetailsAvailable
        if (method === OPENADE_METHOD.settingsMcpServersRead) return canReadMcpServersAvailable
        if (method === OPENADE_METHOD.projectFilesFuzzySearch) return canSearchProjectFilesAvailable
        if (method === OPENADE_METHOD.projectSdkCapabilitiesRead) return canReadProjectSdkCapabilitiesAvailable
        return true
    })
    return {
        store: {
            shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
            usesCoreOwnedProductRuntime: vi.fn(() => coreOwned),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => runtimeProductAPIAvailable || coreOwned),
            canUseProductMethod: vi.fn((method: OpenADEMethod) => {
                if (method === OPENADE_METHOD.taskMetadataUpdate) return canPersistTaskViewedAvailable
                if (method === OPENADE_METHOD.taskRead) return canReadTaskDetailsAvailable
                if (method === OPENADE_METHOD.settingsMcpServersRead) return canReadMcpServersAvailable
                if (method === OPENADE_METHOD.projectFilesFuzzySearch) return canSearchProjectFilesAvailable
                if (method === OPENADE_METHOD.projectSdkCapabilitiesRead) return canReadProjectSdkCapabilitiesAvailable
                return true
            }),
            canUseProductMethodAfterConnect,
            ensureCoreOwnedProductMethodsAvailable,
            tasks: {
                getTask: vi.fn(() => task),
                markTaskViewed,
            },
            smartEditors: {
                getManager: smartEditorsGetManager,
            },
            comments: {
                getUnsubmittedComments: vi.fn(() => []),
            },
            personalSettingsStore: {
                settings: {
                    current: {},
                },
            },
            loadRuntimeProductTask,
        } as unknown as CodeStore,
        markTaskViewed,
        loadRuntimeProductTask,
        smartEditorsGetManager,
        ensureCoreOwnedProductMethodsAvailable,
        canUseProductMethodAfterConnect,
    }
}

describe("TaskPage runtime product behavior", () => {
    let container: HTMLDivElement
    let root: Root
    let previousActEnvironment: boolean | undefined

    beforeEach(() => {
        vi.useFakeTimers()
        const testGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
        previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
        testGlobal.IS_REACT_ACT_ENVIRONMENT = true
        hookMocks.useImageDropZone.mockClear()
        componentMocks.eventLogProps.length = 0
        componentMocks.inputBarProps.length = 0
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        await act(async () => {
            root.unmount()
        })
        container.remove()
        vi.useRealTimers()
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    it("keeps task open on lightweight runtime DTOs without eager git or environment reads", async () => {
        const { taskModel, fileBrowser, contentSearch, fileBrowserAccess, contentSearchAccess, sdkCapabilitiesAccess, sdkCapabilities } = makeTaskModel({
            taskWorkingDir: "/repo/worktree",
        })
        const { store, markTaskViewed } = makeCodeStore()

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        expect(markTaskViewed).toHaveBeenCalledWith("task-1", { defer: true })

        await act(async () => {
            vi.advanceTimersByTime(1_000)
            window.dispatchEvent(new Event("focus"))
            vi.advanceTimersByTime(21_000)
        })

        expect(taskModel.refreshGitState).not.toHaveBeenCalled()
        expect(taskModel.loadEnvironment).not.toHaveBeenCalled()
        expect(sdkCapabilitiesAccess).not.toHaveBeenCalled()
        expect(componentMocks.inputBarProps.at(-1)?.resolveSdkCapabilities?.()).toBe(sdkCapabilities)
        expect(sdkCapabilitiesAccess).toHaveBeenCalledTimes(1)
        expect(sdkCapabilities.loadCapabilities).not.toHaveBeenCalled()
        expect(fileBrowserAccess).not.toHaveBeenCalled()
        expect(contentSearchAccess).not.toHaveBeenCalled()
        expect(fileBrowser.setWorkingDir).not.toHaveBeenCalled()
        expect(contentSearch.setWorkingDir).not.toHaveBeenCalled()
    })

    it("keeps runtime composer working-dir resolution lazy until editor interaction", async () => {
        const { taskModel } = makeTaskModel({ taskWorkingDirHint: null })
        const { store } = makeCodeStore()

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        expect(taskModel.ensureTaskWorkingDirHint).not.toHaveBeenCalled()
        expect(taskModel.loadEnvironment).not.toHaveBeenCalled()

        const resolveWorkingDir = componentMocks.inputBarProps.at(-1)?.resolveWorkingDir
        await expect(resolveWorkingDir?.()).resolves.toBe("/repo")
        expect(taskModel.ensureTaskWorkingDirHint).toHaveBeenCalledTimes(1)
        expect(taskModel.loadEnvironment).not.toHaveBeenCalled()
    })

    it("keeps Core-owned editor discovery available without warming SDK or working-dir state", async () => {
        const { taskModel, sdkCapabilitiesAccess, sdkCapabilities } = makeTaskModel({ taskWorkingDirHint: "/repo" })
        const { store } = makeCodeStore({ runtimeProductAPI: false, coreOwned: true })

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        expect(componentMocks.inputBarProps.at(-1)).toMatchObject({
            fileMentionsDir: "/repo",
            slashCommandsDir: "/repo",
        })
        expect(componentMocks.inputBarProps.at(-1)?.resolveWorkingDir).toBeInstanceOf(Function)
        expect(componentMocks.inputBarProps.at(-1)?.resolveSdkCapabilities).toBeInstanceOf(Function)
        expect(taskModel.ensureTaskWorkingDirHint).not.toHaveBeenCalled()
        expect(sdkCapabilitiesAccess).not.toHaveBeenCalled()

        expect(componentMocks.inputBarProps.at(-1)?.resolveSdkCapabilities?.()).toBe(sdkCapabilities)
        expect(sdkCapabilitiesAccess).toHaveBeenCalledTimes(1)
    })

    it("disables runtime editor file and slash discovery when scoped capabilities are missing", async () => {
        const { taskModel, sdkCapabilitiesAccess } = makeTaskModel({ taskWorkingDirHint: "/repo" })
        const { store } = makeCodeStore({
            canSearchProjectFiles: false,
            canReadProjectSdkCapabilities: false,
        })

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        expect(componentMocks.inputBarProps.at(-1)).toMatchObject({
            fileMentionsDir: null,
            slashCommandsDir: null,
            resolveWorkingDir: undefined,
            resolveSdkCapabilities: undefined,
        })
        expect(sdkCapabilitiesAccess).not.toHaveBeenCalled()
        expect(taskModel.ensureTaskWorkingDirHint).not.toHaveBeenCalled()
        expect(taskModel.loadEnvironment).not.toHaveBeenCalled()
    })

    it("does not fall back to legacy git, environment, working-dir, or viewed-state effects while Core owns product state without runtime access", async () => {
        const { taskModel, fileBrowser, contentSearch, fileBrowserAccess, contentSearchAccess, sdkCapabilitiesAccess } = makeTaskModel({
            taskWorkingDir: "/repo/worktree",
        })
        const { store, markTaskViewed, ensureCoreOwnedProductMethodsAvailable, canUseProductMethodAfterConnect } = makeCodeStore({
            runtimeProductAPI: false,
            coreOwned: true,
            canPersistTaskViewed: false,
        })

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
            await Promise.resolve()
        })

        expect(ensureCoreOwnedProductMethodsAvailable).not.toHaveBeenCalled()
        expect(markTaskViewed).toHaveBeenCalledWith("task-1", { defer: true })
        expect(canUseProductMethodAfterConnect).not.toHaveBeenCalledWith(OPENADE_METHOD.taskMetadataUpdate)

        await act(async () => {
            vi.advanceTimersByTime(1_000)
            window.dispatchEvent(new Event("focus"))
            vi.advanceTimersByTime(21_000)
        })

        expect(taskModel.refreshGitState).not.toHaveBeenCalled()
        expect(taskModel.loadEnvironment).not.toHaveBeenCalled()
        expect(sdkCapabilitiesAccess).not.toHaveBeenCalled()
        expect(fileBrowserAccess).not.toHaveBeenCalled()
        expect(contentSearchAccess).not.toHaveBeenCalled()
        expect(fileBrowser.setWorkingDir).not.toHaveBeenCalled()
        expect(contentSearch.setWorkingDir).not.toHaveBeenCalled()
    })

    it("does not warm Core task route capabilities on mount and waits for explicit full-history actions", async () => {
        const { taskModel } = makeTaskModel({
            enabledMcpServerIds: ["mcp-1"],
        })
        const { store, markTaskViewed, loadRuntimeProductTask, ensureCoreOwnedProductMethodsAvailable, canUseProductMethodAfterConnect } = makeCodeStore({
            runtimeProductAPI: false,
            coreOwned: true,
            canPersistTaskViewed: false,
            canReadTaskDetails: true,
            canReadMcpServers: false,
            attachCoreMethods: true,
        })

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        await act(async () => {
            await vi.waitFor(() => expect(markTaskViewed).toHaveBeenCalledWith("task-1", { defer: true }))
        })

        expect(ensureCoreOwnedProductMethodsAvailable).not.toHaveBeenCalled()
        expect(canUseProductMethodAfterConnect).not.toHaveBeenCalled()
        expect(componentMocks.eventLogProps.at(-1)?.onRequestFullHistory).toBeInstanceOf(Function)

        await act(async () => {
            container.querySelector("[data-testid='event-log']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            await Promise.resolve()
        })

        expect(canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.taskRead)
        expect(loadRuntimeProductTask).toHaveBeenCalledWith("repo-1", "task-1", { hydrateSessionEvents: true })
    })

    it("retries deferred viewed-state persistence when a Core-owned route gains the metadata capability", async () => {
        const { taskModel } = makeTaskModel()
        const { store, markTaskViewed } = makeCodeStore({ runtimeProductAPI: false, coreOwned: true, canPersistTaskViewed: false })

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        expect(markTaskViewed).toHaveBeenCalledWith("task-1", { defer: true })

        const { store: attachedStore, markTaskViewed: attachedMarkTaskViewed } = makeCodeStore({
            runtimeProductAPI: true,
            coreOwned: true,
            canPersistTaskViewed: true,
        })

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store: attachedStore }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        expect(attachedMarkTaskViewed).toHaveBeenCalledWith("task-1", { defer: true })
    })

    it("hides stale MCP connector state when runtime task routes cannot read MCP servers", async () => {
        const { taskModel } = makeTaskModel({
            enabledMcpServerIds: ["mcp-stale"],
        })
        const { store } = makeCodeStore({ runtimeProductAPI: true, canReadMcpServers: false })

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        expect(componentMocks.inputBarProps.at(-1)).toMatchObject({
            enabledMcpServerIds: undefined,
            onMcpServerIdsChange: undefined,
        })
    })

    it("does not arm page-level image drops when task image upload is unavailable", async () => {
        const { taskModel } = makeTaskModel({ canAttachImages: false })
        const { store } = makeCodeStore()

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        const lastCall = hookMocks.useImageDropZone.mock.calls.at(-1)
        expect(lastCall?.[0]).toBeNull()
        expect(typeof lastCall?.[1]).toBe("function")
    })

    it("does not refresh task git state after setup completes in runtime product routes", async () => {
        const { taskModel } = makeTaskModel({ needsEnvironmentSetup: true })
        const { store } = makeCodeStore()

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        const setupButton = container.querySelector("[data-testid='environment-setup']")
        await act(async () => {
            setupButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(taskModel.refreshGitState).not.toHaveBeenCalled()
    })

    it("does not expose full-history hydration when task reads are unavailable", async () => {
        const { taskModel } = makeTaskModel()
        const { store, loadRuntimeProductTask } = makeCodeStore({ canReadTaskDetails: false })

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        expect(componentMocks.eventLogProps.at(-1)?.onRequestFullHistory).toBeUndefined()

        await act(async () => {
            container.querySelector("[data-testid='event-log']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(loadRuntimeProductTask).not.toHaveBeenCalled()
    })

    it("renders the task shell while a Core-owned preview route waits for the lightweight task DTO", async () => {
        const { taskModel } = makeTaskModel()
        const { store, markTaskViewed, smartEditorsGetManager } = makeCodeStore({ coreOwned: true, task: null })

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        expect(componentMocks.eventLogProps.at(-1)).toMatchObject({ isLoading: false })
        expect(componentMocks.inputBarProps).toHaveLength(1)
        expect(hookMocks.useImageDropZone).toHaveBeenCalled()
        expect(smartEditorsGetManager).toHaveBeenCalledWith("task-task-1", "repo-1")
        expect(markTaskViewed).toHaveBeenCalledWith("task-1", { defer: true })
    })

    it("hydrates full task history through task/read only when the runtime capability is available", async () => {
        const { taskModel } = makeTaskModel()
        const { store, loadRuntimeProductTask } = makeCodeStore()

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        expect(componentMocks.eventLogProps.at(-1)?.onRequestFullHistory).toBeInstanceOf(Function)

        await act(async () => {
            container.querySelector("[data-testid='event-log']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            await Promise.resolve()
        })

        expect(loadRuntimeProductTask).toHaveBeenCalledWith("repo-1", "task-1", { hydrateSessionEvents: true })
    })

    it("hydrates full task history for Core-owned task routes when task/read is available", async () => {
        const { taskModel } = makeTaskModel()
        const { store, loadRuntimeProductTask } = makeCodeStore({ runtimeProductAPI: false, coreOwned: true })

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        expect(componentMocks.eventLogProps.at(-1)?.onRequestFullHistory).toBeInstanceOf(Function)

        await act(async () => {
            container.querySelector("[data-testid='event-log']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            await Promise.resolve()
        })

        expect(loadRuntimeProductTask).toHaveBeenCalledWith("repo-1", "task-1", { hydrateSessionEvents: true })
    })

    it("keeps the legacy setup completion git refresh", async () => {
        const { taskModel } = makeTaskModel({ needsEnvironmentSetup: true })
        const { store } = makeCodeStore({ runtimeProductAPI: false })

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(TaskPage, { workspaceId: "repo-1", taskId: "task-1", taskModel })))
        })

        const setupButton = container.querySelector("[data-testid='environment-setup']")
        await act(async () => {
            setupButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(taskModel.refreshGitState).toHaveBeenCalledTimes(1)
    })
})
