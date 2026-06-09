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

function createInitializedStore(loadedRepoIds: Set<string> = new Set(["repo-1"])): {
    store: CodeStore
    loadRepos: ReturnType<typeof vi.fn>
    ensureTasksLoaded: ReturnType<typeof vi.fn>
} {
    const loadRepos = vi.fn(async () => undefined)
    const ensureTasksLoaded = vi.fn()
    const store = {
        storeInitialized: true,
        isWorking: false,
        shouldUseRuntimeProductReads: vi.fn(() => false),
        getTaskStore: vi.fn(async () => undefined),
        repos: {
            repos: [],
            reposLoading: false,
            loadRepos,
        },
        tasks: {
            loadedRepoIds,
            ensureTasksLoaded,
        },
    } as unknown as CodeStore
    return { store, loadRepos, ensureTasksLoaded }
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
})
