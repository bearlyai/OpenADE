import { act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { HashRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OpenADEApp } from "./App"
import type { CodeStore } from "./store/store"

vi.mock("./components/sidebar/Sidebar", () => ({
    CodeSidebar: () => null,
}))

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve
        reject = promiseReject
    })
    return { promise, resolve, reject }
}

describe("OpenADEApp route boundaries", () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        window.location.hash = ""
        window.localStorage.clear()
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        Reflect.deleteProperty(window, "openadeAPI")
        window.location.hash = ""
        window.localStorage.clear()
        vi.useRealTimers()
    })

    async function renderApp(path: string, codeStoreFactory: () => CodeStore): Promise<void> {
        window.location.hash = path
        await act(async () => {
            root.render(createElement(HashRouter, null, createElement(OpenADEApp, { codeStoreFactory })))
        })
    }

    async function renderCodeApp(path: string, codeStoreFactory: () => CodeStore): Promise<void> {
        const { CodeApp } = await import("./CodeApp")
        window.location.hash = path
        await act(async () => {
            root.render(createElement(HashRouter, null, createElement(CodeApp, { codeStoreFactory })))
        })
    }

    function installOpenADEAPIMock(): void {
        Object.defineProperty(window, "openadeAPI", {
            configurable: true,
            value: {
                app: {
                    activeWorkUnloadBlockerDisabled: false,
                    onUpdateAvailable: vi.fn(() => vi.fn()),
                    onUpdateError: vi.fn(() => vi.fn()),
                },
                codeWindowFrame: {
                    enabled: vi.fn(async () => false),
                    setColors: vi.fn(async () => undefined),
                },
                runtime: {
                    connect: vi.fn(async () => undefined),
                    disconnect: vi.fn(async () => undefined),
                    onMessage: vi.fn(() => vi.fn()),
                    request: vi.fn(async (request: { id: string | number; method: string }) => {
                        if (request.method === "initialize") {
                            return {
                                id: request.id,
                                ok: true,
                                result: {
                                    protocolVersion: 1,
                                    serverName: "test",
                                    serverVersion: "0.0.0",
                                    capabilities: { methods: ["host/capabilities/read", "host/platform/info"], notifications: [] },
                                },
                            }
                        }
                        if (request.method === "host/capabilities/read") {
                            return { id: request.id, ok: true, result: { enabled: true, version: "test" } }
                        }
                        if (request.method === "host/platform/info") {
                            return {
                                id: request.id,
                                ok: true,
                                result: {
                                    platform: "darwin",
                                    pathSeparator: "/",
                                    homeDir: "/",
                                    isWindows: false,
                                    isMac: true,
                                    isLinux: false,
                                },
                            }
                        }
                        return { id: request.id, ok: false, error: { code: "method_not_found", message: request.method } }
                    }),
                },
            },
        })
    }

    it("renders the remote companion shell without constructing the desktop CodeStore", async () => {
        const codeStoreFactory = vi.fn<() => CodeStore>(() => {
            throw new Error("Remote shell must not construct the desktop CodeStore")
        })

        await renderApp("/remote", codeStoreFactory)

        expect(codeStoreFactory).not.toHaveBeenCalled()
        expect(container.textContent).toContain("OpenADE")
        expect(container.textContent).toContain("Companion")
        expect(container.textContent).toContain("Connect")
    })

    it("constructs and initializes the desktop CodeStore for code routes only", async () => {
        const initializeStores = vi.fn<CodeStore["initializeStores"]>(() => new Promise(() => {}))
        const disconnectAllStores = vi.fn<CodeStore["disconnectAllStores"]>(() => undefined)
        const fakeStore = {
            initializeStores,
            disconnectAllStores,
        } as unknown as CodeStore
        const codeStoreFactory = vi.fn<() => CodeStore>(() => fakeStore)

        await import("./CodeApp")
        await renderApp("/dashboard/code/tasks", codeStoreFactory)

        await vi.waitFor(() => {
            expect(codeStoreFactory).toHaveBeenCalledTimes(1)
            expect(initializeStores).toHaveBeenCalledTimes(1)
        })
        expect(container.textContent).toContain("Loading...")
    })

    it("keeps legacy direct task routes on broad desktop store initialization", async () => {
        const initializeStores = vi.fn<CodeStore["initializeStores"]>(() => new Promise(() => {}))
        const disconnectAllStores = vi.fn<CodeStore["disconnectAllStores"]>(() => undefined)
        const fakeStore = {
            initializeStores,
            disconnectAllStores,
            usesCoreOwnedProductRuntime: vi.fn(() => false),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => false),
        } as unknown as CodeStore
        const codeStoreFactory = vi.fn<() => CodeStore>(() => fakeStore)

        await renderCodeApp("/dashboard/code/workspace/repo-1/task/task-1", codeStoreFactory)

        await vi.waitFor(() => {
            expect(codeStoreFactory).toHaveBeenCalledTimes(1)
            expect(initializeStores).toHaveBeenCalledTimes(1)
        })
        expect(container.textContent).toContain("Loading...")
    })

    it("starts direct runtime task reads before route-shell initialization", async () => {
        vi.useFakeTimers()
        const order: string[] = []
        const initializeStores = vi.fn<CodeStore["initializeStores"]>(async () => {
            order.push("init")
        })
        const initializeRuntimeTaskRouteShell = vi.fn<CodeStore["initializeRuntimeTaskRouteShell"]>(async () => {
            order.push("routeShell")
        })
        const disconnectAllStores = vi.fn<CodeStore["disconnectAllStores"]>(() => undefined)
        let hasTaskSource = false
        let taskReadInFlight = false
        const taskRead = createDeferred<null>()
        const loadRuntimeProductTaskForRoute = vi.fn(async () => {
            order.push("task")
            taskReadInFlight = true
            await taskRead.promise
            taskReadInFlight = false
            hasTaskSource = true
            return null
        })
        const loadRepos = vi.fn(async () => {
            order.push("repos")
        })
        const fakeStore = {
            initializeStores,
            initializeRuntimeTaskRouteShell,
            disconnectAllStores,
            storeInitialized: false,
            runtimeProductStoreStatus: "idle",
            runtimeProductStoreError: null,
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            hasProductTaskModelSource: vi.fn(() => hasTaskSource),
            canUseRuntimeProductTaskRouteModelSource: vi.fn(() => true),
            hasProductTaskReadInFlight: vi.fn(() => taskReadInFlight),
            loadRuntimeProductTaskForRoute,
            canUseProductMethod: vi.fn(() => false),
            isWorking: false,
            personalSettingsStore: null,
            repos: {
                reposLoading: false,
                loadRepos,
                getRepo: vi.fn(() => ({
                    id: "repo-1",
                    name: "Repo",
                    path: "/repo",
                    createdBy: { id: "local-user", name: "Local User", email: "local@openade.dev" },
                    createdAt: "",
                    updatedAt: "",
                    archived: false,
                })),
            },
            tasks: {
                loadedRepoIds: new Set<string>(),
                ensureTasksLoaded: vi.fn(),
                getTaskModel: vi.fn(() => null),
                getTaskModelForRoute: vi.fn(() => null),
                regeneratingTitleTaskIds: new Set<string>(),
                regenerateTitle: vi.fn(),
                setTaskTitle: vi.fn(),
            },
        } as unknown as CodeStore
        const codeStoreFactory = vi.fn<() => CodeStore>(() => fakeStore)
        installOpenADEAPIMock()

        await renderCodeApp("/dashboard/code/workspace/repo-1/task/task-1", codeStoreFactory)

        await vi.waitFor(() => expect(loadRuntimeProductTaskForRoute).toHaveBeenCalledWith("repo-1", "task-1"))
        expect(order[0]).toBe("task")
        expect(initializeStores).not.toHaveBeenCalled()

        await act(async () => {
            await vi.advanceTimersByTimeAsync(300)
        })

        expect(initializeStores).not.toHaveBeenCalled()

        await act(async () => {
            taskRead.resolve(null)
            await Promise.resolve()
            await vi.advanceTimersByTimeAsync(150)
        })

        await vi.waitFor(() => expect(initializeRuntimeTaskRouteShell).toHaveBeenCalledTimes(1))
        expect(order).toEqual(["task", "routeShell"])

        await act(async () => {
            await vi.advanceTimersByTimeAsync(30_000)
        })

        expect(initializeStores).not.toHaveBeenCalled()
    })

    it("keeps broad desktop store initialization deferred after a completed direct runtime task read paints", async () => {
        vi.useFakeTimers()
        const initializeStores = vi.fn<CodeStore["initializeStores"]>(async () => undefined)
        const initializeRuntimeTaskRouteShell = vi.fn<CodeStore["initializeRuntimeTaskRouteShell"]>(async () => undefined)
        const disconnectAllStores = vi.fn<CodeStore["disconnectAllStores"]>(() => undefined)
        const loadRuntimeProductTaskForRoute = vi.fn(async () => null)
        const fakeStore = {
            initializeStores,
            initializeRuntimeTaskRouteShell,
            disconnectAllStores,
            storeInitialized: false,
            runtimeProductStoreStatus: "idle",
            runtimeProductStoreError: null,
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            hasProductTaskModelSource: vi.fn(() => false),
            canUseRuntimeProductTaskRouteModelSource: vi.fn(() => true),
            hasProductTaskReadInFlight: vi.fn(() => false),
            loadRuntimeProductTaskForRoute,
            canUseProductMethod: vi.fn(() => false),
            isWorking: false,
            personalSettingsStore: null,
            repos: {
                reposLoading: false,
                loadRepos: vi.fn(async () => undefined),
                getRepo: vi.fn(() => ({
                    id: "repo-1",
                    name: "Repo",
                    path: "/repo",
                    createdBy: { id: "local-user", name: "Local User", email: "local@openade.dev" },
                    createdAt: "",
                    updatedAt: "",
                    archived: false,
                })),
            },
            tasks: {
                loadedRepoIds: new Set<string>(),
                ensureTasksLoaded: vi.fn(),
                getTaskModel: vi.fn(() => null),
                getTaskModelForRoute: vi.fn(() => null),
                regeneratingTitleTaskIds: new Set<string>(),
                regenerateTitle: vi.fn(),
                setTaskTitle: vi.fn(),
            },
        } as unknown as CodeStore
        const codeStoreFactory = vi.fn<() => CodeStore>(() => fakeStore)
        installOpenADEAPIMock()

        await renderCodeApp("/dashboard/code/workspace/repo-1/task/task-1", codeStoreFactory)

        await vi.waitFor(() => expect(loadRuntimeProductTaskForRoute).toHaveBeenCalledWith("repo-1", "task-1"))

        await act(async () => {
            await vi.advanceTimersByTimeAsync(150)
        })

        await vi.waitFor(() => expect(initializeRuntimeTaskRouteShell).toHaveBeenCalledTimes(1))

        await act(async () => {
            await vi.advanceTimersByTimeAsync(30_000)
        })

        expect(initializeStores).not.toHaveBeenCalled()
    })

    it("keeps broad desktop store initialization deferred after the route task read settles", async () => {
        vi.useFakeTimers()
        const initializeStores = vi.fn<CodeStore["initializeStores"]>(async () => undefined)
        const initializeRuntimeTaskRouteShell = vi.fn<CodeStore["initializeRuntimeTaskRouteShell"]>(async () => undefined)
        const disconnectAllStores = vi.fn<CodeStore["disconnectAllStores"]>(() => undefined)
        let taskReadInFlight = false
        const taskRead = createDeferred<null>()
        const loadRuntimeProductTaskForRoute = vi.fn(async () => {
            taskReadInFlight = true
            await taskRead.promise
            taskReadInFlight = false
            return null
        })
        const fakeStore = {
            initializeStores,
            initializeRuntimeTaskRouteShell,
            disconnectAllStores,
            storeInitialized: false,
            runtimeProductStoreStatus: "idle",
            runtimeProductStoreError: null,
            shouldUseRuntimeProductAPI: vi.fn(() => true),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            shouldUseRuntimeProductTaskRoute: vi.fn(() => true),
            hasProductTaskModelSource: vi.fn(() => false),
            canUseRuntimeProductTaskRouteModelSource: vi.fn(() => true),
            hasProductTaskReadInFlight: vi.fn(() => taskReadInFlight),
            loadRuntimeProductTaskForRoute,
            canUseProductMethod: vi.fn(() => false),
            isWorking: false,
            personalSettingsStore: null,
            repos: {
                reposLoading: false,
                loadRepos: vi.fn(async () => undefined),
                getRepo: vi.fn(() => ({
                    id: "repo-1",
                    name: "Repo",
                    path: "/repo",
                    createdBy: { id: "local-user", name: "Local User", email: "local@openade.dev" },
                    createdAt: "",
                    updatedAt: "",
                    archived: false,
                })),
            },
            tasks: {
                loadedRepoIds: new Set<string>(),
                ensureTasksLoaded: vi.fn(),
                getTaskModel: vi.fn(() => null),
                getTaskModelForRoute: vi.fn(() => null),
                regeneratingTitleTaskIds: new Set<string>(),
                regenerateTitle: vi.fn(),
                setTaskTitle: vi.fn(),
            },
        } as unknown as CodeStore
        const codeStoreFactory = vi.fn<() => CodeStore>(() => fakeStore)
        installOpenADEAPIMock()

        await renderCodeApp("/dashboard/code/workspace/repo-1/task/task-1", codeStoreFactory)

        await vi.waitFor(() => expect(loadRuntimeProductTaskForRoute).toHaveBeenCalledWith("repo-1", "task-1"))

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5_000)
        })

        expect(initializeStores).not.toHaveBeenCalled()

        await act(async () => {
            taskRead.resolve(null)
            await Promise.resolve()
            await vi.advanceTimersByTimeAsync(150)
        })

        await vi.waitFor(() => expect(initializeRuntimeTaskRouteShell).toHaveBeenCalledTimes(1))

        await act(async () => {
            await vi.advanceTimersByTimeAsync(30_000)
        })

        expect(initializeStores).not.toHaveBeenCalled()
    })
})
