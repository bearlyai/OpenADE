import { createElement, useEffect } from "react"
import { type Root, createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
    type OpenADEModuleAdapters,
    type OpenADEProject,
    type OpenADESnapshot,
    type OpenADETask,
    type OpenADETaskMetadataUpdateRequest,
    type OpenADETaskPreview,
    type OpenADETurnStartRequest,
    createOpenADEModule,
} from "../../openade-module/src"
import { type RuntimeMessage, validateRuntimeRequest } from "../../runtime-protocol/src"
import { type RuntimeConnection, RuntimeServer } from "../../runtime/src"
import { CodeBaseRoute, CodeWorkspaceRoute, CodeWorkspaceTaskRoute } from "./Routes"
import { analytics } from "./analytics"
import { getDefaultModelForHarness } from "./constants"
import { resetCodeModuleCapabilitiesForTests } from "./electronAPI/capabilities"
import { resetPlatformInfoForTests } from "./electronAPI/platform"
import { localRuntimeClient } from "./runtime/localRuntimeClient"
import { CodeStoreProvider } from "./store/context"
import { CodeStore } from "./store/store"

const now = "2026-05-31T00:00:00.000Z"
const routeModelId = getDefaultModelForHarness("codex")

const routeTask: OpenADETask = {
    id: "task-1",
    repoId: "repo-1",
    slug: "runtime-route-task",
    title: "Runtime route task",
    description: "Read through the desktop runtime route.",
    isolationStrategy: { type: "head" },
    createdBy: { id: "user-1", email: "user@example.com" },
    createdAt: now,
    updatedAt: now,
    deviceEnvironments: [],
    events: [
        {
            id: "event-1",
            type: "action",
            status: "completed",
            createdAt: now,
            completedAt: "2026-05-31T00:01:00.000Z",
            userInput: "Do the runtime-backed work",
            source: { type: "do", userLabel: "Do" },
            execution: {
                harnessId: "codex",
                executionId: "exec-1",
                modelId: routeModelId,
                events: [],
            },
            includesCommentIds: [],
            result: { success: true },
        },
    ],
    comments: [
        {
            id: "comment-1",
            content: "Runtime pending comment",
            source: { type: "llm_output", eventId: "event-1", lineStart: 1, lineEnd: 1 },
            selectedText: { text: "runtime", linesBefore: "", linesAfter: "" },
            author: { id: "user-1", email: "user@example.com" },
            createdAt: now,
        },
    ],
}

function cloneTask(value: OpenADETask): OpenADETask {
    return structuredClone(value)
}

function routeTaskPreview(value: OpenADETask): OpenADETaskPreview {
    return {
        id: value.id,
        slug: value.slug,
        title: value.title,
        closed: value.closed,
        createdAt: value.createdAt ?? now,
        lastEventAt: "2026-05-31T00:01:00.000Z",
        lastEvent: { type: "action", status: "completed", sourceType: "do", sourceLabel: "Do", at: "2026-05-31T00:01:00.000Z" },
    }
}

function routeProject(task: OpenADETask = routeTask): OpenADEProject {
    return {
        id: "repo-1",
        name: "Runtime Route Repo",
        path: "/tmp/runtime-route-repo",
        tasks: [routeTaskPreview(task)],
    }
}

function routeTurnLabel(type: OpenADETurnStartRequest["type"]): string {
    if (type === "do") return "Do"
    if (type === "ask") return "Ask"
    if (type === "revise") return "Revise Plan"
    if (type === "run_plan") return "Run Plan"
    if (type === "hyperplan") return "HyperPlan"
    return "Plan"
}

function runtimeSnapshot(task: OpenADETask = routeTask): OpenADESnapshot {
    return {
        server: {
            version: "route-smoke-test",
            hostName: "route-smoke-host",
            theme: { setting: "system", className: "code-theme-light" },
        },
        workingTaskIds: [],
        repos: [routeProject(task)],
    }
}

function unsupportedMutation(method: string): () => Promise<never> {
    return async () => {
        throw new Error(`${method} is not available in the route runtime test`)
    }
}

interface RouteRuntimeServerHooks {
    onStartTurn?: (params: OpenADETurnStartRequest) => void
    onUpdateTaskMetadata?: (params: OpenADETaskMetadataUpdateRequest) => void
}

function createRouteRuntimeServer(hooks: RouteRuntimeServerHooks = {}): RuntimeServer {
    const server = new RuntimeServer({ serverName: "desktop-route-runtime", protocolVersion: 1 })
    const task = cloneTask(routeTask)
    const project = routeProject(task)
    let projectProcessId: string | null = null
    const adapters: OpenADEModuleAdapters = {
        version: () => "route-smoke-test",
        readSnapshot: async () => runtimeSnapshot(task),
        readProjects: async () => [project],
        readTaskList: async () => project.tasks,
        readTask: async (_repoId, taskId) => {
            if (taskId !== task.id) throw new Error(`Task ${taskId} not found`)
            return cloneTask(task)
        },
        listDataDocuments: async () => [],
        readDataDocumentBase64: async () => null,
        saveDataDocumentBase64: unsupportedMutation("saveDataDocumentBase64"),
        deleteDataDocument: unsupportedMutation("deleteDataDocument"),
        createRepo: unsupportedMutation("createRepo"),
        updateRepo: unsupportedMutation("updateRepo"),
        deleteRepo: unsupportedMutation("deleteRepo"),
        startTurn: async (params, context) => {
            if (params.repoId !== project.id) throw new Error(`Repo ${params.repoId} not found`)
            hooks.onStartTurn?.(structuredClone(params))
            const eventId = `event-${task.events.length + 1}`
            const completedAt = "2026-05-31T00:02:00.000Z"
            task.events = [
                ...task.events,
                {
                    id: eventId,
                    type: "action",
                    status: "completed",
                    createdAt: "2026-05-31T00:01:30.000Z",
                    completedAt,
                    userInput: params.input,
                    source: { type: params.type, userLabel: routeTurnLabel(params.type) },
                    execution: {
                        harnessId: params.harnessId ?? "codex",
                        executionId: "exec-shared-shell",
                        modelId: params.modelId ?? routeModelId,
                        events: [],
                    },
                    includesCommentIds: [],
                    result: { success: true },
                },
            ]
            task.updatedAt = completedAt
            task.lastEventAt = completedAt
            project.tasks = [routeTaskPreview(task)]
            if (context?.runtimeId) {
                const completedRuntime = server.supervisor.update(context.runtimeId, {
                    status: "completed",
                    scope: { ownerType: "openade-task", ownerId: task.id },
                    exitedAt: completedAt,
                    lastActivityAt: completedAt,
                })
                if (completedRuntime) server.notify("runtime/completed", completedRuntime)
            }
            return { taskId: task.id, eventId }
        },
        startReview: async (params, context) => {
            if (params.repoId !== project.id) throw new Error(`Repo ${params.repoId} not found`)
            if (params.taskId !== task.id) throw new Error(`Task ${params.taskId} not found`)
            const eventId = `event-${task.events.length + 1}`
            const completedAt = "2026-05-31T00:02:15.000Z"
            task.events = [
                ...task.events,
                {
                    id: eventId,
                    type: "action",
                    status: "completed",
                    createdAt: "2026-05-31T00:02:05.000Z",
                    completedAt,
                    userInput: params.customInstructions,
                    source: {
                        type: "review",
                        userLabel: params.reviewType === "plan" ? "Review Plan" : "Review Work",
                        reviewType: params.reviewType,
                        userInstructions: params.customInstructions,
                    },
                    execution: {
                        harnessId: params.harnessId,
                        executionId: "exec-shared-review",
                        modelId: params.modelId,
                        events: [],
                    },
                    includesCommentIds: [],
                    result: { success: true },
                },
            ]
            task.updatedAt = completedAt
            task.lastEventAt = completedAt
            project.tasks = [routeTaskPreview(task)]
            if (context?.runtimeId) {
                const completedRuntime = server.supervisor.update(context.runtimeId, {
                    status: "completed",
                    scope: { ownerType: "openade-task", ownerId: task.id },
                    exitedAt: completedAt,
                    lastActivityAt: completedAt,
                })
                if (completedRuntime) server.notify("runtime/completed", completedRuntime)
            }
            return { taskId: task.id, eventId }
        },
        interruptTurn: unsupportedMutation("interruptTurn"),
        cancelQueuedTurn: unsupportedMutation("cancelQueuedTurn"),
        deleteTask: unsupportedMutation("deleteTask"),
        setupTaskEnvironment: unsupportedMutation("setupTaskEnvironment"),
        createActionEvent: unsupportedMutation("createActionEvent"),
        appendActionStreamEvent: unsupportedMutation("appendActionStreamEvent"),
        completeActionEvent: unsupportedMutation("completeActionEvent"),
        errorActionEvent: unsupportedMutation("errorActionEvent"),
        stoppedActionEvent: unsupportedMutation("stoppedActionEvent"),
        reconcileActionEventRuntime: async (params) => ({ taskId: params.taskId, changed: false }),
        updateActionExecution: unsupportedMutation("updateActionExecution"),
        addHyperPlanSubExecution: unsupportedMutation("addHyperPlanSubExecution"),
        appendHyperPlanSubExecutionStreamEvent: unsupportedMutation("appendHyperPlanSubExecutionStreamEvent"),
        updateHyperPlanSubExecution: unsupportedMutation("updateHyperPlanSubExecution"),
        setHyperPlanReconcileLabels: unsupportedMutation("setHyperPlanReconcileLabels"),
        createSnapshotEvent: unsupportedMutation("createSnapshotEvent"),
        createComment: async (params) => {
            if (params.taskId !== task.id) throw new Error(`Task ${params.taskId} not found`)
            const commentId = params.commentId ?? `comment-${task.comments.length + 1}`
            const createdAt = "2026-05-31T00:01:45.000Z"
            task.comments = [
                ...task.comments,
                {
                    id: commentId,
                    content: params.content,
                    source: params.source,
                    selectedText: params.selectedText,
                    author: params.author,
                    createdAt,
                    updatedAt: createdAt,
                },
            ]
            task.updatedAt = createdAt
            return { commentId, createdAt }
        },
        editComment: async (params) => {
            if (params.taskId !== task.id) throw new Error(`Task ${params.taskId} not found`)
            task.comments = task.comments.map((comment) => {
                if (typeof comment !== "object" || comment === null || Array.isArray(comment)) return comment
                if (!("id" in comment) || comment.id !== params.commentId) return comment
                return { ...comment, content: params.content, updatedAt: params.updatedAt ?? "2026-05-31T00:01:50.000Z" }
            })
        },
        deleteComment: async (params) => {
            if (params.taskId !== task.id) throw new Error(`Task ${params.taskId} not found`)
            task.comments = task.comments.filter((comment) => {
                if (typeof comment !== "object" || comment === null || Array.isArray(comment)) return true
                return !("id" in comment) || comment.id !== params.commentId
            })
        },
        updateTaskMetadata: async (params) => {
            if (params.taskId !== task.id) throw new Error(`Task ${params.taskId} not found`)
            hooks.onUpdateTaskMetadata?.(structuredClone(params))
            if (params.title !== undefined) task.title = params.title
            if (params.closed !== undefined) task.closed = params.closed
            if (params.lastViewedAt !== undefined) task.lastViewedAt = params.lastViewedAt
            project.tasks = [routeTaskPreview(task)]
        },
        scopedHost: {
            listProjectFiles: async (params) => ({
                repoId: params.repoId,
                path: params.path ?? "",
                entries: [{ path: "README.md", name: "README.md", type: "file", size: 34 }],
                truncated: false,
            }),
            readProjectFile: async (params) => ({
                repoId: params.repoId,
                path: params.path,
                encoding: "utf8",
                size: 34,
                tooLarge: false,
                content: "Runtime route readme\nshared shell\n",
            }),
            writeProjectFile: unsupportedMutation("writeProjectFile"),
            searchProject: async (params) => ({
                repoId: params.repoId,
                matches: params.query.toLowerCase().includes("readme")
                    ? [{ path: "README.md", line: 1, content: "Runtime route readme", matchStart: 14, matchEnd: 20 }]
                    : [],
                truncated: false,
            }),
            listProjectProcesses: async (params) => ({
                repoId: params.repoId,
                searchRoot: project.path,
                repoRoot: project.path,
                isWorktree: false,
                processes: [
                    {
                        id: "dev-server",
                        name: "Dev Server",
                        command: "npm run dev",
                        type: "daemon",
                        configPath: "openade.toml",
                        cwd: project.path,
                    },
                ],
                instances: projectProcessId
                    ? [
                          {
                              processId: projectProcessId,
                              definitionId: "dev-server",
                              repoId: params.repoId,
                              cwd: project.path,
                              completed: false,
                              exitCode: null,
                              signal: null,
                          },
                      ]
                    : [],
                errors: [],
            }),
            startProjectProcess: async (params) => {
                projectProcessId = "process-1"
                return { repoId: params.repoId, definitionId: params.definitionId, processId: projectProcessId }
            },
            reconnectProjectProcess: async (params) => ({
                repoId: params.repoId,
                processId: params.processId,
                found: params.processId === projectProcessId,
                completed: false,
                output: [{ type: "stdout", data: "dev server ready\n", timestamp: 1 }],
            }),
            stopProjectProcess: async (params) => {
                if (params.processId === projectProcessId) projectProcessId = null
                return { repoId: params.repoId, processId: params.processId, ok: true }
            },
            startTaskTerminal: unsupportedMutation("startTaskTerminal"),
            reconnectTaskTerminal: unsupportedMutation("reconnectTaskTerminal"),
            writeTaskTerminal: unsupportedMutation("writeTaskTerminal"),
            resizeTaskTerminal: unsupportedMutation("resizeTaskTerminal"),
            stopTaskTerminal: unsupportedMutation("stopTaskTerminal"),
            readTaskImage: async (params) => ({ repoId: params.repoId, taskId: params.taskId, imageId: params.imageId, ext: params.ext, data: null }),
            readTaskChanges: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                files: [],
                fromTreeish: "HEAD",
                toTreeish: "HEAD",
            }),
            readTaskDiff: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                filePath: params.filePath,
                oldPath: params.oldPath,
                fromTreeish: "HEAD",
                toTreeish: "HEAD",
                patch: "",
                truncated: false,
                heavy: false,
                stats: { insertions: 0, deletions: 0, changedLines: 0, hunkCount: 0 },
            }),
            readTaskGitLog: async (params) => ({ repoId: params.repoId, taskId: params.taskId, commits: [], hasMore: false }),
            commitTaskGit: unsupportedMutation("commitTaskGit"),
            readTaskSnapshotPatch: unsupportedMutation("readTaskSnapshotPatch"),
            readTaskSnapshotIndex: unsupportedMutation("readTaskSnapshotIndex"),
            readTaskSnapshotPatchSlice: unsupportedMutation("readTaskSnapshotPatchSlice"),
        },
    }
    server.registerModule(createOpenADEModule(adapters))
    server.register("host/capabilities/read", () => ({ enabled: true, version: "route-test" }))
    server.register("host/platform/info", () => ({
        platform: "darwin",
        pathSeparator: "/",
        homeDir: "/Users/test",
        isWindows: false,
        isMac: true,
        isLinux: false,
    }))
    server.register("git/directory/read", () => ({ isGitDirectory: false, error: "not a git repo in route smoke test" }))
    server.register("agent/sdkCapabilities/read", () => null)
    return server
}

function installOpenADEApiRuntimeBridge(server: RuntimeServer): () => void {
    const previous = window.openadeAPI
    const listeners = new Set<(message: unknown) => void>()
    let disposeConnection: (() => void) | null = null
    const connection: RuntimeConnection = {
        id: "desktop-route-openade-api",
        send(message: RuntimeMessage) {
            for (const listener of listeners) listener(message)
        },
    }
    const noopUnsubscribe = () => undefined
    window.openadeAPI = {
        app: {
            activeWorkUnloadBlockerDisabled: true,
            quit: async () => undefined,
            openUrl: async () => undefined,
            applyUpdate: async () => undefined,
            forceEnableDevTools: async () => undefined,
            isWindowedWithFrame: async () => false,
            setTerminalKeyboardCapture: async () => undefined,
            onUpdateAvailable: () => noopUnsubscribe,
            onUpdateError: () => noopUnsubscribe,
            onFocusInputShortcut: () => noopUnsubscribe,
            retryUpdateCheck: async () => undefined,
        },
        window: {
            isPinned: async () => false,
            isAutoHide: async () => false,
            action: async () => undefined,
            frameEnabled: async () => true,
            setFrameColors: async () => undefined,
            findInPage: async () => null,
        },
        settings: {
            getDeviceConfig: async () => null,
            setDeviceId: async () => null,
            setTelemetryDisabled: async () => undefined,
        },
        shell: {
            selectDirectory: async () => ({ canceled: true }),
            openUrl: async () => undefined,
            openPath: async () => undefined,
        },
        codeWindowFrame: {
            enabled: async () => true,
            setColors: async () => undefined,
        },
        notifications: {
            getState: async () => null,
            shouldShow: async () => false,
        },
        companion: {
            getState: async () => null,
            setEnabled: async () => null,
            setKeepAwakeMode: async () => null,
            startPairing: async () => null,
        },
        runtime: {
            connect: async () => {
                disposeConnection?.()
                disposeConnection = server.connect(connection)
                return null
            },
            disconnect: async () => {
                disposeConnection?.()
                disposeConnection = null
                return null
            },
            request: async (rawRequest: unknown) => {
                const request = validateRuntimeRequest(rawRequest)
                if (!request.ok) throw new Error(request.error.message)
                return server.handleRequest(request.value, connection, { requireInitialized: true })
            },
            onMessage: (cb: (message: unknown) => void) => {
                listeners.add(cb)
                return () => listeners.delete(cb)
            },
        },
    }
    return () => {
        disposeConnection?.()
        disposeConnection = null
        listeners.clear()
        window.openadeAPI = previous
    }
}

function LocationProbe({ onPath }: { onPath: (path: string) => void }) {
    const location = useLocation()
    useEffect(() => {
        onPath(location.pathname)
    }, [location.pathname, onPath])
    return null
}

async function waitForPath(paths: string[], expected: string): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (paths.at(-1) === expected) return
        await new Promise((resolve) => window.setTimeout(resolve, 10))
    }
    expect(paths.at(-1)).toBe(expected)
}

async function waitForText(container: HTMLElement, expected: string): Promise<void> {
    await vi.waitFor(
        async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 10))
            expect(container.textContent).toContain(expected)
        },
        { timeout: 1500, interval: 10 }
    )
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    if (!valueSetter) throw new Error("HTMLTextAreaElement value setter is unavailable")
    valueSetter.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
}

function setInputValue(input: HTMLInputElement, value: string): void {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    if (!valueSetter) throw new Error("HTMLInputElement value setter is unavailable")
    valueSetter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
}

function clickElement(element: HTMLElement): void {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
}

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text)
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Button "${text}" was not rendered`)
    return button
}

function findButtonByTitle(container: HTMLElement, title: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.title === title)
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Button titled "${title}" was not rendered`)
    return button
}

function findButtonByTitlePrefix(container: HTMLElement, titlePrefix: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.title.startsWith(titlePrefix))
    if (!(button instanceof HTMLButtonElement)) {
        const titles = Array.from(container.querySelectorAll("button"))
            .map((candidate) => candidate.title || candidate.textContent?.trim() || "<untitled>")
            .join(", ")
        throw new Error(`Button titled with "${titlePrefix}" was not rendered. Buttons: ${titles}`)
    }
    return button
}

describe("Code routes with runtime product reads", () => {
    let container: HTMLDivElement
    let root: Root
    let cleanupOpenADEApi: (() => void) | null = null
    let previousActEnvironment: boolean | undefined

    beforeEach(() => {
        const testGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
        previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
        // This file is a full browser smoke for app-shell routes; Base UI schedules
        // layout state outside React act, so assertions poll the rendered DOM directly.
        testGlobal.IS_REACT_ACT_ENVIRONMENT = false
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        root.unmount()
        cleanupOpenADEApi?.()
        cleanupOpenADEApi = null
        await localRuntimeClient.close()
        resetCodeModuleCapabilitiesForTests()
        resetPlatformInfoForTests()
        container.remove()
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    it("redirects the desktop base route to the latest runtime-backed task preview from the default-on real local runtime path", async () => {
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(createRouteRuntimeServer())
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
        })
        try {
            await codeStore.initializeRuntimeProductStore()
            const paths: string[] = []

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code"] },
                createElement(LocationProbe, { onPath: (path) => paths.push(path) }),
                createElement(
                    Routes,
                    null,
                    createElement(Route, { path: "/dashboard/code", element: createElement(CodeBaseRoute) }),
                    createElement(Route, { path: "/dashboard/code/workspace/:workspaceId/task/:taskId", element: createElement("div") })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForPath(paths, "/dashboard/code/workspace/repo-1/task/task-1")
        } finally {
            codeStore.disconnectAllStores()
        }
    })

    it("keeps the desktop workspace route on the classic task redirect while using runtime project DTOs", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(createRouteRuntimeServer())
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
        })
        try {
            await codeStore.initializeRuntimeProductStore()
            codeStore.storeInitialized = true
            codeStore.tasks.ensureTasksLoaded("repo-1")
            const paths: string[] = []

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1"] },
                createElement(LocationProbe, { onPath: (path) => paths.push(path) }),
                createElement(
                    Routes,
                    null,
                    createElement(Route, { path: "/dashboard/code/workspace/:workspaceId", element: createElement(CodeWorkspaceRoute) }),
                    createElement(Route, { path: "/dashboard/code/workspace/:workspaceId/task/:taskId", element: createElement("div") })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))

            await waitForPath(paths, "/dashboard/code/workspace/repo-1/task/task-1")
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_error", expect.anything())
        } finally {
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("renders the classic desktop task route by default after loading task detail through the real local runtime product store", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const startedTurns: OpenADETurnStartRequest[] = []
        const metadataUpdates: OpenADETaskMetadataUpdateRequest[] = []
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(
            createRouteRuntimeServer({
                onStartTurn: (params) => startedTurns.push(params),
                onUpdateTaskMetadata: (params) => metadataUpdates.push(params),
            })
        )
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
        })
        try {
            await codeStore.initializeRuntimeProductStore()
            codeStore.storeInitialized = true
            codeStore.tasks.ensureTasksLoaded("repo-1")

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-1"] },
                createElement(
                    Routes,
                    null,
                    createElement(Route, { path: "/dashboard/code/workspace/:workspaceId/task/:taskId", element: createElement(CodeWorkspaceTaskRoute) })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))
            await new Promise((resolve) => window.setTimeout(resolve, 50))

            expect(container.querySelector('[data-openade-surface="desktop-classic-task"]')).toBeInstanceOf(HTMLElement)
            expect(container.querySelector('[data-openade-surface="desktop-shared-task"]')).toBeNull()
            await waitForText(container, "Runtime route task")
            await waitForText(container, "Do the runtime-backed work")
            await waitForText(container, "1 comment")
            clickElement(findButtonByText(container, "1 comment"))
            await waitForText(container, "Runtime pending comment")
            expect(findButtonByTitle(container, "Attach image")).toBeInstanceOf(HTMLButtonElement)

            codeStore.smartEditors.getManager("task-task-1", "repo-1").setValue("Classic desktop runtime turn")
            const doButton = findButtonByTitlePrefix(container, "Do")
            await vi.waitFor(() => expect(doButton.disabled).toBe(false), { timeout: 1000, interval: 10 })
            clickElement(doButton)

            await vi.waitFor(() => expect(startedTurns).toHaveLength(1), { timeout: 1000, interval: 10 })
            expect(startedTurns[0]).toMatchObject({
                repoId: "repo-1",
                inTaskId: "task-1",
                type: "do",
                input: "Classic desktop runtime turn",
                harnessId: "codex",
                modelId: routeModelId,
                thinking: "max",
                fastMode: false,
            })
            await waitForText(container, "Classic desktop runtime turn")

            clickElement(findButtonByText(container, "Close"))
            await waitForText(container, "Reopen")
            clickElement(findButtonByText(container, "Reopen"))
            await vi.waitFor(() => expect(findButtonByText(container, "Close")).toBeInstanceOf(HTMLButtonElement), { timeout: 1000, interval: 10 })
            expect(metadataUpdates).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: "task-1", closed: true })]))
            expect(metadataUpdates).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: "task-1", closed: false })]))
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
        } finally {
            trackSpy.mockRestore()
            codeStore.disconnectAllStores()
        }
    })

    it("renders the shared task shell on the desktop route when the runtime shared-screen gate is enabled", async () => {
        const startedTurns: OpenADETurnStartRequest[] = []
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(createRouteRuntimeServer({ onStartTurn: (params) => startedTurns.push(params) }))
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            enableDesktopSharedTaskScreen: true,
        })
        try {
            await codeStore.initializeRuntimeProductStore()
            codeStore.storeInitialized = true
            codeStore.tasks.ensureTasksLoaded("repo-1")

            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-1"] },
                createElement(
                    Routes,
                    null,
                    createElement(Route, { path: "/dashboard/code/workspace/:workspaceId/task/:taskId", element: createElement(CodeWorkspaceTaskRoute) })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))
            await new Promise((resolve) => window.setTimeout(resolve, 50))

            await waitForText(container, "Runtime route task")
            await waitForText(container, "Do the runtime-backed work")
            await waitForText(container, "Review Plan")
            await waitForText(container, "No changes.")
            expect(findButtonByTitle(container, "Attach image")).toBeInstanceOf(HTMLButtonElement)
            clickElement(findButtonByTitlePrefix(container, "Files"))
            await vi.waitFor(() => {
                const filesSearch = Array.from(container.querySelectorAll("input")).find((input) => input.placeholder === "Search files...")
                expect(filesSearch).toBeInstanceOf(HTMLInputElement)
            })
            clickElement(findButtonByTitle(container, "MCP connectors"))
            await waitForText(container, "No connectors")

            const titleInput = Array.from(container.querySelectorAll("input")).find((input) => input.value === "Runtime route task")
            if (!(titleInput instanceof HTMLInputElement)) throw new Error("Shared task title input was not rendered")
            setInputValue(titleInput, "Shared shell title")
            const saveTitleButton = findButtonByText(container, "Save")
            await vi.waitFor(() => expect(saveTitleButton.disabled).toBe(false), { timeout: 1000, interval: 10 })
            clickElement(saveTitleButton)
            await waitForText(container, "Shared shell title")

            clickElement(findButtonByText(container, "Close"))
            await waitForText(container, "Reopen")
            clickElement(findButtonByText(container, "Reopen"))
            await vi.waitFor(() => expect(findButtonByText(container, "Close")).toBeInstanceOf(HTMLButtonElement), { timeout: 1000, interval: 10 })

            const commentInput = Array.from(container.querySelectorAll("input")).find((input) => input.placeholder === "Add a comment")
            if (!(commentInput instanceof HTMLInputElement)) throw new Error("Shared task comment input was not rendered")
            setInputValue(commentInput, "Shared shell comment")
            const addCommentButton = findButtonByText(container, "Add")
            await vi.waitFor(() => expect(addCommentButton.disabled).toBe(false), { timeout: 1000, interval: 10 })
            clickElement(addCommentButton)
            await waitForText(container, "Shared shell comment")

            const reviewInput = Array.from(container.querySelectorAll("textarea")).find((textarea) => textarea.placeholder === "Optional review notes")
            if (!(reviewInput instanceof HTMLTextAreaElement)) throw new Error("Shared task review textarea was not rendered")
            setTextareaValue(reviewInput, "Shared shell review notes")
            clickElement(findButtonByText(container, "Review Plan"))
            await waitForText(container, "Shared shell review notes")

            clickElement(findButtonByTitle(container, "Fast mode"))
            codeStore.smartEditors.getManager("task-task-1", "repo-1").setValue("Shared shell turn")
            const doButton = findButtonByTitlePrefix(container, "Do")
            await vi.waitFor(() => expect(doButton.disabled).toBe(false), { timeout: 1000, interval: 10 })
            clickElement(doButton)

            await vi.waitFor(() => expect(startedTurns).toHaveLength(1), { timeout: 1000, interval: 10 })
            expect(startedTurns[0]).toMatchObject({
                repoId: "repo-1",
                inTaskId: "task-1",
                input: "Shared shell turn",
                harnessId: "codex",
                modelId: routeModelId,
                thinking: "max",
                fastMode: true,
                enabledMcpServerIds: [],
            })
            await waitForText(container, "Shared shell turn")
        } finally {
            codeStore.disconnectAllStores()
        }
    })

    it("runs the shared desktop workflow through runtime commands and reloads the runtime-backed state", async () => {
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const startedTurns: OpenADETurnStartRequest[] = []
        const server = createRouteRuntimeServer({ onStartTurn: (params) => startedTurns.push(params) })
        cleanupOpenADEApi = installOpenADEApiRuntimeBridge(server)
        const stores: CodeStore[] = []

        const createStore = async () => {
            const codeStore = new CodeStore({
                getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
                navigateToTask: () => undefined,
                enableRuntimeProductStore: true,
                enableDesktopSharedTaskScreen: true,
            })
            stores.push(codeStore)
            await codeStore.initializeRuntimeProductStore()
            codeStore.storeInitialized = true
            codeStore.tasks.ensureTasksLoaded("repo-1")
            return codeStore
        }

        const renderTaskRoute = (codeStore: CodeStore) => {
            const router = createElement(
                MemoryRouter,
                { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-1"] },
                createElement(
                    Routes,
                    null,
                    createElement(Route, { path: "/dashboard/code/workspace/:workspaceId/task/:taskId", element: createElement(CodeWorkspaceTaskRoute) })
                )
            )
            root.render(createElement(CodeStoreProvider, { store: codeStore }, router))
        }

        const runRichCommand = async (codeStore: CodeStore, titlePrefix: string, value?: string) => {
            if (value !== undefined) codeStore.smartEditors.getManager("task-task-1", "repo-1").setValue(value)
            let button: HTMLButtonElement | null = null
            await vi.waitFor(
                () => {
                    button = findButtonByTitlePrefix(container, titlePrefix)
                    expect(button.disabled).toBe(false)
                },
                { timeout: 1000, interval: 10 }
            )
            if (!button) throw new Error(`Button titled with "${titlePrefix}" was not rendered`)
            clickElement(button)
        }

        try {
            const codeStore = await createStore()
            renderTaskRoute(codeStore)
            await new Promise((resolve) => window.setTimeout(resolve, 50))
            await waitForText(container, "Runtime route task")

            await runRichCommand(codeStore, "Plan", "Shared workflow plan")
            await waitForText(container, "Shared workflow plan")
            await vi.waitFor(() => {
                expect(codeStore.runtimeProductSnapshot?.repos.map((repo) => repo.id)).toEqual(["repo-1"])
                expect(codeStore.repos.getRepo("repo-1")).toBeDefined()
                expect(codeStore.tasks.getTask("task-1")?.events.map((event) => (event.type === "action" ? event.source.type : event.type))).toContain("plan")
                expect(codeStore.tasks.getTaskModel("task-1")?.hasActivePlan).toBe(true)
            })

            await runRichCommand(codeStore, "Revise Plan", "Shared workflow revision")
            await waitForText(container, "Shared workflow revision")

            await runRichCommand(codeStore, "Run Plan")
            await waitForText(container, "Run Plan")

            await runRichCommand(codeStore, "Ask", "Shared workflow question")
            await waitForText(container, "Shared workflow question")

            clickElement(findButtonByText(container, "Close"))
            await waitForText(container, "Reopen")
            clickElement(findButtonByText(container, "Reopen"))
            await vi.waitFor(() => expect(findButtonByText(container, "Close")).toBeInstanceOf(HTMLButtonElement), { timeout: 1000, interval: 10 })

            expect(startedTurns.map((turn) => turn.type)).toEqual(["plan", "revise", "run_plan", "ask"])

            root.unmount()
            root = createRoot(container)
            codeStore.disconnectAllStores()

            const reloadedStore = await createStore()
            renderTaskRoute(reloadedStore)
            await waitForText(container, "Shared workflow plan")
            await waitForText(container, "Shared workflow revision")
            await waitForText(container, "Shared workflow question")
            expect(reloadedStore.tasks.getTask("task-1")?.closed).toBe(false)
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_fallback", expect.anything())
            expect(trackSpy).not.toHaveBeenCalledWith("runtime_product_store_error", expect.anything())
        } finally {
            trackSpy.mockRestore()
            for (const store of stores) store.disconnectAllStores()
        }
    })
})
