import { Code } from "lucide-react"
import { type ComponentType, createElement } from "react"
import { flushSync } from "react-dom"
import { type Root, createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CodeStoreProvider } from "../store/context"
import type { CodeStore } from "../store/store"
import { CodeLayout, type CodeLayoutProps } from "./CodeLayout"

const CodeLayoutForTest = CodeLayout as ComponentType<Omit<CodeLayoutProps, "children">>

function createDeferred<T = void>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve
        reject = promiseReject
    })
    return { promise, resolve, reject }
}

function createInitializedStore(
    loadedRepoIds: Set<string> = new Set(["repo-1"]),
    runtimeProduct: {
        api?: boolean
        coreOwned?: boolean
        taskRoute?: boolean
        reposLoading?: boolean
        storeInitialized?: boolean
        hasTaskSource?: boolean
        taskReadInFlight?: (repoId: string, taskId: string) => boolean
    } = {}
): {
    store: CodeStore
    loadRepos: ReturnType<typeof vi.fn>
    initializeStores: ReturnType<typeof vi.fn>
    initializeRuntimeTaskRouteShell: ReturnType<typeof vi.fn>
    ensureTasksLoaded: ReturnType<typeof vi.fn>
    getTaskStore: ReturnType<typeof vi.fn>
    loadRuntimeProductTask: ReturnType<typeof vi.fn>
    loadRuntimeProductTaskForRoute: ReturnType<typeof vi.fn>
} {
    const loadRepos = vi.fn(async () => undefined)
    const initializeStores = vi.fn(async () => undefined)
    const initializeRuntimeTaskRouteShell = vi.fn(async () => undefined)
    const ensureTasksLoaded = vi.fn()
    const getTaskStore = vi.fn(async () => undefined)
    const loadRuntimeProductTask = vi.fn(async () => undefined)
    const loadRuntimeProductTaskForRoute = vi.fn(async () => undefined)
    const store = {
        storeInitialized: runtimeProduct.storeInitialized ?? true,
        isWorking: false,
        runtimeProductStoreStatus: "idle",
        initializeStores,
        initializeRuntimeTaskRouteShell,
        shouldUseRuntimeProductAPI: vi.fn(() => runtimeProduct.api ?? false),
        usesCoreOwnedProductRuntime: vi.fn(() => runtimeProduct.coreOwned ?? false),
        shouldUseRuntimeProductTaskRoute: vi.fn(() => runtimeProduct.taskRoute ?? runtimeProduct.api ?? runtimeProduct.coreOwned ?? false),
        canUseProductMethod: vi.fn(() => true),
        canUseRuntimeProductTaskRouteModelSource: vi.fn(() => runtimeProduct.taskRoute ?? runtimeProduct.api ?? runtimeProduct.coreOwned ?? false),
        hasProductTaskModelSource: vi.fn(() => runtimeProduct.hasTaskSource ?? true),
        hasProductTaskReadInFlight: vi.fn((repoId: string, taskId: string) => runtimeProduct.taskReadInFlight?.(repoId, taskId) ?? false),
        getTaskStore,
        loadRuntimeProductTask,
        loadRuntimeProductTaskForRoute,
        repos: {
            repos: [],
            reposLoading: runtimeProduct.reposLoading ?? false,
            loadRepos,
        },
        tasks: {
            loadedRepoIds,
            ensureTasksLoaded,
        },
    } as unknown as CodeStore
    return {
        store,
        loadRepos,
        initializeStores,
        initializeRuntimeTaskRouteShell,
        ensureTasksLoaded,
        getTaskStore,
        loadRuntimeProductTask,
        loadRuntimeProductTaskForRoute,
    }
}

describe("CodeLayout", () => {
    let container: HTMLDivElement
    let root: Root
    let previousActEnvironment: boolean | undefined

    beforeEach(() => {
        const testGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
        previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
        testGlobal.IS_REACT_ACT_ENVIRONMENT = false
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        root.unmount()
        container.remove()
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    it("renders immediately for an already initialized store", () => {
        const { store, loadRepos, ensureTasksLoaded } = createInitializedStore()

        flushSync(() => {
            root.render(
                createElement(
                    MemoryRouter,
                    null,
                    createElement(
                        CodeStoreProvider,
                        { store },
                        createElement(
                            CodeLayoutForTest,
                            {
                                isCodeModuleAvailable: true,
                                workspaceId: "repo-1",
                                taskId: "task-1",
                                title: "Task",
                                icon: createElement(Code, { size: "1rem" }),
                            },
                            createElement("div", null, "Ready task route")
                        )
                    )
                )
            )
        })

        expect(container.textContent).toContain("Ready task route")
        expect(container.textContent).not.toContain("Loading")
        expect(loadRepos).not.toHaveBeenCalled()
        expect(ensureTasksLoaded).toHaveBeenCalledWith("repo-1")
    })

    it("does not show the app loading shell while marking initialized workspace tasks loaded", () => {
        const { store, loadRepos, ensureTasksLoaded } = createInitializedStore(new Set())

        flushSync(() => {
            root.render(
                createElement(
                    MemoryRouter,
                    null,
                    createElement(
                        CodeStoreProvider,
                        { store },
                        createElement(
                            CodeLayoutForTest,
                            {
                                isCodeModuleAvailable: true,
                                workspaceId: "repo-1",
                                taskId: "task-1",
                                title: "Task",
                                icon: createElement(Code, { size: "1rem" }),
                            },
                            createElement("div", null, "Ready before loaded marker")
                        )
                    )
                )
            )
        })

        expect(container.textContent).toContain("Ready before loaded marker")
        expect(container.textContent).not.toContain("Loading")
        expect(loadRepos).not.toHaveBeenCalled()
        expect(ensureTasksLoaded).toHaveBeenCalledWith("repo-1")
    })

    it("keeps initialized task routes visible during background repo refreshes", () => {
        const { store, loadRepos, ensureTasksLoaded } = createInitializedStore(new Set(["repo-1"]), {
            reposLoading: true,
        })

        flushSync(() => {
            root.render(
                createElement(
                    MemoryRouter,
                    null,
                    createElement(
                        CodeStoreProvider,
                        { store },
                        createElement(
                            CodeLayoutForTest,
                            {
                                isCodeModuleAvailable: true,
                                workspaceId: "repo-1",
                                taskId: "task-1",
                                title: "Task",
                                icon: createElement(Code, { size: "1rem" }),
                            },
                            createElement("div", null, "Ready through repo refresh")
                        )
                    )
                )
            )
        })

        expect(container.textContent).toContain("Ready through repo refresh")
        expect(container.textContent).not.toContain("Loading")
        expect(loadRepos).not.toHaveBeenCalled()
        expect(ensureTasksLoaded).toHaveBeenCalledWith("repo-1")
    })

    it("renders a runtime task route from previews while app-shell initialization is still running", () => {
        const { store, ensureTasksLoaded } = createInitializedStore(new Set(), {
            api: true,
            reposLoading: true,
            storeInitialized: false,
            hasTaskSource: true,
        })

        flushSync(() => {
            root.render(
                createElement(
                    MemoryRouter,
                    null,
                    createElement(
                        CodeStoreProvider,
                        { store },
                        createElement(
                            CodeLayoutForTest,
                            {
                                isCodeModuleAvailable: true,
                                workspaceId: "repo-1",
                                taskId: "task-1",
                                title: "Task",
                                icon: createElement(Code, { size: "1rem" }),
                            },
                            createElement("div", null, "Ready from runtime preview")
                        )
                    )
                )
            )
        })

        expect(container.textContent).toContain("Ready from runtime preview")
        expect(container.textContent).not.toContain("Loading")
        expect(ensureTasksLoaded).not.toHaveBeenCalled()
    })

    it("uses Core product initialization after runtime ownership appears before startup effects run", async () => {
        const { store, loadRepos, initializeStores } = createInitializedStore(new Set(), {
            coreOwned: false,
            storeInitialized: false,
        })

        const renderWorkspace = () =>
            root.render(
                createElement(
                    MemoryRouter,
                    null,
                    createElement(
                        CodeStoreProvider,
                        { store },
                        createElement(
                            CodeLayoutForTest,
                            {
                                isCodeModuleAvailable: true,
                                workspaceId: "repo-1",
                                title: "Workspace",
                                icon: createElement(Code, { size: "1rem" }),
                            },
                            createElement("div", null, "Workspace route")
                        )
                    )
                )
            )

        renderWorkspace()
        vi.mocked(store.usesCoreOwnedProductRuntime).mockReturnValue(true)
        renderWorkspace()

        await vi.waitFor(() => expect(initializeStores).toHaveBeenCalledTimes(1))
        expect(loadRepos).not.toHaveBeenCalled()
    })

    it("uses scoped runtime task-route shell instead of legacy repo loading before full projection is ready", async () => {
        const { store, loadRepos, initializeStores, initializeRuntimeTaskRouteShell, ensureTasksLoaded } = createInitializedStore(new Set(), {
            api: false,
            coreOwned: false,
            taskRoute: true,
            storeInitialized: false,
        })

        flushSync(() => {
            root.render(
                createElement(
                    MemoryRouter,
                    null,
                    createElement(
                        CodeStoreProvider,
                        { store },
                        createElement(
                            CodeLayoutForTest,
                            {
                                isCodeModuleAvailable: true,
                                workspaceId: "repo-1",
                                title: "Workspace",
                                icon: createElement(Code, { size: "1rem" }),
                            },
                            createElement("div", null, "Runtime route shell")
                        )
                    )
                )
            )
        })

        await vi.waitFor(() => expect(initializeRuntimeTaskRouteShell).toHaveBeenCalledTimes(1))
        expect(loadRepos).not.toHaveBeenCalled()
        expect(initializeStores).not.toHaveBeenCalled()
        expect(ensureTasksLoaded).not.toHaveBeenCalled()
    })

    it("loads a task through the runtime product API even when the snapshot projection is unavailable", async () => {
        const { store, getTaskStore, ensureTasksLoaded, loadRuntimeProductTaskForRoute } = createInitializedStore(new Set(["repo-1"]), {
            api: true,
        })

        flushSync(() => {
            root.render(
                createElement(
                    MemoryRouter,
                    null,
                    createElement(
                        CodeStoreProvider,
                        { store },
                        createElement(
                            CodeLayoutForTest,
                            {
                                isCodeModuleAvailable: true,
                                workspaceId: "repo-1",
                                taskId: "task-1",
                                title: "Task",
                                icon: createElement(Code, { size: "1rem" }),
                            },
                            createElement("div", null, "Ready task route")
                        )
                    )
                )
            )
        })

        await vi.waitFor(() => expect(loadRuntimeProductTaskForRoute).toHaveBeenCalledWith("repo-1", "task-1"))
        expect(getTaskStore).not.toHaveBeenCalled()
        expect(ensureTasksLoaded).not.toHaveBeenCalled()
    })

    it("uses runtime task-route loading before the full runtime product API is ready", async () => {
        const { store, getTaskStore, ensureTasksLoaded, loadRepos, initializeStores, loadRuntimeProductTaskForRoute } = createInitializedStore(new Set(), {
            api: false,
            coreOwned: false,
            taskRoute: true,
            storeInitialized: false,
            hasTaskSource: false,
        })

        flushSync(() => {
            root.render(
                createElement(
                    MemoryRouter,
                    null,
                    createElement(
                        CodeStoreProvider,
                        { store },
                        createElement(
                            CodeLayoutForTest,
                            {
                                isCodeModuleAvailable: true,
                                workspaceId: "repo-1",
                                taskId: "task-1",
                                title: "Task",
                                icon: createElement(Code, { size: "1rem" }),
                            },
                            createElement("div", null, "Runtime task route")
                        )
                    )
                )
            )
        })

        await vi.waitFor(() => expect(loadRuntimeProductTaskForRoute).toHaveBeenCalledWith("repo-1", "task-1"))
        expect(getTaskStore).not.toHaveBeenCalled()
        expect(ensureTasksLoaded).not.toHaveBeenCalled()
        expect(loadRepos).not.toHaveBeenCalled()
        expect(initializeStores).not.toHaveBeenCalled()
    })

    it("does not reload the same runtime task just because runtime product status churns", async () => {
        const { store, loadRuntimeProductTaskForRoute } = createInitializedStore(new Set(["repo-1"]), {
            api: true,
        })

        const renderTaskRoute = () =>
            root.render(
                createElement(
                    MemoryRouter,
                    null,
                    createElement(
                        CodeStoreProvider,
                        { store },
                        createElement(
                            CodeLayoutForTest,
                            {
                                isCodeModuleAvailable: true,
                                workspaceId: "repo-1",
                                taskId: "task-1",
                                title: "Task",
                                icon: createElement(Code, { size: "1rem" }),
                            },
                            createElement("div", null, "Ready task route")
                        )
                    )
                )
        )

        flushSync(renderTaskRoute)
        await vi.waitFor(() => expect(loadRuntimeProductTaskForRoute).toHaveBeenCalledTimes(1))

        store.runtimeProductStoreStatus = "ready"
        flushSync(renderTaskRoute)

        await vi.waitFor(() => expect(container.textContent).toContain("Ready task route"))
        expect(loadRuntimeProductTaskForRoute).toHaveBeenCalledTimes(1)
    })

    it("does not auto-retry a failed runtime task route on status churn", async () => {
        const { store, loadRuntimeProductTaskForRoute } = createInitializedStore(new Set(["repo-1"]), {
            api: true,
        })
        loadRuntimeProductTaskForRoute.mockRejectedValueOnce(new Error("runtime task read failed"))
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

        const renderTaskRoute = () =>
            root.render(
                createElement(
                    MemoryRouter,
                    null,
                    createElement(
                        CodeStoreProvider,
                        { store },
                        createElement(
                            CodeLayoutForTest,
                            {
                                isCodeModuleAvailable: true,
                                workspaceId: "repo-1",
                                taskId: "task-1",
                                title: "Task",
                                icon: createElement(Code, { size: "1rem" }),
                            },
                            createElement("div", null, "Ready task route")
                        )
                    )
                )
            )

        try {
            flushSync(renderTaskRoute)
            await vi.waitFor(() => expect(loadRuntimeProductTaskForRoute).toHaveBeenCalledTimes(1))
            await vi.waitFor(() => expect(consoleError).toHaveBeenCalled())

            store.runtimeProductStoreStatus = "error"
            flushSync(renderTaskRoute)

            await vi.waitFor(() => expect(container.textContent).toContain("Ready task route"))
            expect(loadRuntimeProductTaskForRoute).toHaveBeenCalledTimes(1)
        } finally {
            consoleError.mockRestore()
        }
    })

    it("loads Core-owned task routes through the runtime product route loader before runtime API projection is ready", async () => {
        const { store, getTaskStore, ensureTasksLoaded, loadRuntimeProductTaskForRoute } = createInitializedStore(new Set(["repo-1"]), {
            api: false,
            coreOwned: true,
        })

        const renderTaskRoute = () =>
            root.render(
                createElement(
                    MemoryRouter,
                    null,
                    createElement(
                        CodeStoreProvider,
                        { store },
                        createElement(
                            CodeLayoutForTest,
                            {
                                isCodeModuleAvailable: true,
                                workspaceId: "repo-1",
                                taskId: "task-1",
                                title: "Task",
                                icon: createElement(Code, { size: "1rem" }),
                            },
                            createElement("div", null, "Ready task route")
                        )
                    )
                )
            )

        flushSync(renderTaskRoute)

        await vi.waitFor(() => {
            expect(loadRuntimeProductTaskForRoute).toHaveBeenCalledWith("repo-1", "task-1")
        })
        vi.mocked(store.shouldUseRuntimeProductAPI).mockReturnValue(true)
        store.runtimeProductStoreStatus = "ready"
        flushSync(renderTaskRoute)

        expect(loadRuntimeProductTaskForRoute).toHaveBeenCalledTimes(1)
        expect(getTaskStore).not.toHaveBeenCalled()
        expect(ensureTasksLoaded).not.toHaveBeenCalled()
    })

    it("starts the Core-owned route task read before cheap route-shell initialization without broad init", async () => {
        vi.useFakeTimers()
        const order: string[] = []
        const taskReadGate = createDeferred()
        const { store, loadRepos, initializeStores, initializeRuntimeTaskRouteShell, ensureTasksLoaded, loadRuntimeProductTaskForRoute } = createInitializedStore(new Set(), {
            api: false,
            coreOwned: true,
            storeInitialized: false,
            hasTaskSource: false,
        })
        loadRuntimeProductTaskForRoute.mockImplementation(async () => {
            order.push("task")
            await taskReadGate.promise
            return undefined
        })
        loadRepos.mockImplementation(async () => {
            order.push("repos")
        })
        initializeStores.mockImplementation(async () => {
            order.push("init")
        })
        initializeRuntimeTaskRouteShell.mockImplementation(async () => {
            order.push("routeShell")
        })

        try {
            flushSync(() => {
                root.render(
                    createElement(
                        MemoryRouter,
                        null,
                        createElement(
                            CodeStoreProvider,
                            { store },
                            createElement(
                                CodeLayoutForTest,
                                {
                                    isCodeModuleAvailable: true,
                                    workspaceId: "repo-1",
                                    taskId: "task-1",
                                    title: "Task",
                                    icon: createElement(Code, { size: "1rem" }),
                                },
                                createElement("div", null, "Route")
                            )
                        )
                    )
                )
            })

            await Promise.resolve()
            expect(order).toEqual(["task"])
            await vi.advanceTimersByTimeAsync(5_000)
            expect(loadRepos).not.toHaveBeenCalled()
            expect(initializeStores).not.toHaveBeenCalled()
            expect(initializeRuntimeTaskRouteShell).not.toHaveBeenCalled()
            taskReadGate.resolve()
            await Promise.resolve()
            expect(loadRepos).not.toHaveBeenCalled()
            await vi.advanceTimersByTimeAsync(50)
            await vi.waitFor(() => expect(order).toEqual(["task", "routeShell"]))
            expect(initializeStores).not.toHaveBeenCalled()

            await vi.advanceTimersByTimeAsync(4_999)
            expect(initializeStores).not.toHaveBeenCalled()
            await vi.advanceTimersByTimeAsync(1)
            expect(order).toEqual(["task", "routeShell"])
            expect(initializeStores).not.toHaveBeenCalled()
            expect(loadRepos).not.toHaveBeenCalled()
            expect(ensureTasksLoaded).not.toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })

    it("does not start broad app-shell initialization while the Core route task read is still in flight", async () => {
        vi.useFakeTimers()
        let taskReadInFlight = false
        const taskReadGate = createDeferred()
        const { store, loadRepos, initializeStores, initializeRuntimeTaskRouteShell, loadRuntimeProductTaskForRoute } = createInitializedStore(new Set(), {
            api: false,
            coreOwned: true,
            storeInitialized: false,
            hasTaskSource: false,
            taskReadInFlight: () => taskReadInFlight,
        })
        loadRuntimeProductTaskForRoute.mockImplementation(async () => {
            taskReadInFlight = true
            await taskReadGate.promise
            taskReadInFlight = false
            return undefined
        })

        try {
            flushSync(() => {
                root.render(
                    createElement(
                        MemoryRouter,
                        null,
                        createElement(
                            CodeStoreProvider,
                            { store },
                            createElement(
                                CodeLayoutForTest,
                                {
                                    isCodeModuleAvailable: true,
                                    workspaceId: "repo-1",
                                    taskId: "task-1",
                                    title: "Task",
                                    icon: createElement(Code, { size: "1rem" }),
                                },
                                createElement("div", null, "Route")
                            )
                        )
                    )
                )
            })

            await vi.waitFor(() => {
                expect(loadRuntimeProductTaskForRoute).toHaveBeenCalledWith("repo-1", "task-1")
            })

            await vi.advanceTimersByTimeAsync(5_000)
            expect(loadRepos).not.toHaveBeenCalled()
            expect(initializeStores).not.toHaveBeenCalled()
            expect(initializeRuntimeTaskRouteShell).not.toHaveBeenCalled()

            taskReadGate.resolve()
            await Promise.resolve()
            expect(loadRepos).not.toHaveBeenCalled()
            await vi.advanceTimersByTimeAsync(50)
            await vi.waitFor(() => expect(initializeRuntimeTaskRouteShell).toHaveBeenCalledTimes(1))
            expect(initializeStores).not.toHaveBeenCalled()

            await vi.advanceTimersByTimeAsync(5_000)
            expect(initializeStores).not.toHaveBeenCalled()
            expect(loadRepos).not.toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })

    it("keeps broad app-shell initialization deferred after the Core task route has painted and idled", async () => {
        vi.useFakeTimers()
        const taskReadGate = createDeferred()
        const { store, loadRepos, initializeStores, initializeRuntimeTaskRouteShell, loadRuntimeProductTaskForRoute } = createInitializedStore(new Set(), {
            api: false,
            coreOwned: true,
            storeInitialized: false,
            hasTaskSource: false,
        })
        loadRuntimeProductTaskForRoute.mockImplementation(async () => {
            await taskReadGate.promise
            return undefined
        })

        try {
            flushSync(() => {
                root.render(
                    createElement(
                        MemoryRouter,
                        null,
                        createElement(
                            CodeStoreProvider,
                            { store },
                            createElement(
                                CodeLayoutForTest,
                                {
                                    isCodeModuleAvailable: true,
                                    workspaceId: "repo-1",
                                    taskId: "task-1",
                                    title: "Task",
                                    icon: createElement(Code, { size: "1rem" }),
                                },
                                createElement("div", null, "Route")
                            )
                        )
                    )
                )
            })

            await vi.waitFor(() => {
                expect(loadRuntimeProductTaskForRoute).toHaveBeenCalledWith("repo-1", "task-1")
            })
            taskReadGate.resolve()
            await Promise.resolve()
            await vi.advanceTimersByTimeAsync(50)
            await vi.waitFor(() => expect(initializeRuntimeTaskRouteShell).toHaveBeenCalledTimes(1))

            await vi.advanceTimersByTimeAsync(30_000)

            expect(initializeStores).not.toHaveBeenCalled()
            expect(loadRepos).not.toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })
})
