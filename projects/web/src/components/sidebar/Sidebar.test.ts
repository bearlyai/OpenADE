import { act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"
import { runInAction } from "mobx"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OpenADECoreRolloutState } from "../../../../electron/src/preload-api"
import { useCodeStore } from "../../store/context"
import { CodeSidebar, CoreMigrationCalloutView, shouldShowCoreMigrationCallout } from "./Sidebar"
import { codeSidebarManager } from "./sidebarManager"

const sidebarChildMocks = vi.hoisted(() => ({
    repoRenderCount: 0,
    cronRenderCount: 0,
    taskRenderCount: 0,
}))

vi.mock("../../store/context", () => ({
    useCodeStore: vi.fn(() => ({})),
}))

vi.mock("./RepoList", () => ({
    ReposSidebarContent: () => {
        sidebarChildMocks.repoRenderCount += 1
        return null
    },
}))

vi.mock("./CronList", () => ({
    CronsSidebarContent: () => {
        sidebarChildMocks.cronRenderCount += 1
        return null
    },
}))

vi.mock("./TaskList", () => ({
    TasksSidebarContent: () => {
        sidebarChildMocks.taskRenderCount += 1
        return null
    },
}))

function rolloutState(overrides: Partial<OpenADECoreRolloutState> = {}): OpenADECoreRolloutState {
    return {
        status: "connected",
        source: "managed",
        reason: "legacy-yjs-documents",
        automatic: true,
        legacyYjsDocumentsPresent: true,
        legacyYjsMigrationAccepted: false,
        ...overrides,
    }
}

describe("shouldShowCoreMigrationCallout", () => {
    it("shows only when legacy Yjs documents keep product runtime on legacy IPC while migration Core is available", () => {
        expect(
            shouldShowCoreMigrationCallout({
                rolloutState: rolloutState(),
                hasCoreRuntimeEndpoint: false,
                hasCoreMigrationRuntimeEndpoint: true,
            })
        ).toBe(true)

        expect(
            shouldShowCoreMigrationCallout({
                rolloutState: rolloutState({ reason: "legacy-yjs-migration-accepted", legacyYjsMigrationAccepted: true }),
                hasCoreRuntimeEndpoint: true,
                hasCoreMigrationRuntimeEndpoint: true,
            })
        ).toBe(false)

        expect(
            shouldShowCoreMigrationCallout({
                rolloutState: rolloutState(),
                hasCoreRuntimeEndpoint: false,
                hasCoreMigrationRuntimeEndpoint: false,
            })
        ).toBe(false)

        expect(
            shouldShowCoreMigrationCallout({
                rolloutState: rolloutState({ legacyYjsDocumentsPresent: false, reason: "managed-core" }),
                hasCoreRuntimeEndpoint: true,
                hasCoreMigrationRuntimeEndpoint: true,
            })
        ).toBe(false)
    })
})

describe("CoreMigrationCalloutView", () => {
    let container: HTMLDivElement
    let root: Root
    let previousActEnvironment: boolean | undefined

    beforeEach(() => {
        previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    it("opens the existing migration settings flow from the callout button", async () => {
        const onOpenMigration = vi.fn()

        await act(async () => {
            root.render(createElement(CoreMigrationCalloutView, { onOpenMigration }))
        })

        expect(container.textContent).toContain("Legacy backend active")
        expect(container.textContent).toContain("Migrate")

        const button = container.querySelector("button")
        expect(button).toBeInstanceOf(HTMLButtonElement)
        if (!button) throw new Error("Expected migration button")

        await act(async () => {
            button.click()
        })

        expect(onOpenMigration).toHaveBeenCalledTimes(1)
    })
})

describe("CodeSidebar", () => {
    let container: HTMLDivElement
    let root: Root
    let previousActEnvironment: boolean | undefined
    let previousSmallScreen: boolean
    let previousManuallyOpened: boolean

    beforeEach(() => {
        previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const mutableManager = codeSidebarManager as unknown as { isSmallScreen: boolean; manuallyOpened: boolean }
        previousSmallScreen = mutableManager.isSmallScreen
        previousManuallyOpened = mutableManager.manuallyOpened
        runInAction(() => {
            mutableManager.isSmallScreen = false
            mutableManager.manuallyOpened = true
        })
        sidebarChildMocks.repoRenderCount = 0
        sidebarChildMocks.cronRenderCount = 0
        sidebarChildMocks.taskRenderCount = 0
        vi.mocked(useCodeStore).mockReturnValue({} as unknown as ReturnType<typeof useCodeStore>)
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
        const mutableManager = codeSidebarManager as unknown as { isSmallScreen: boolean; manuallyOpened: boolean }
        runInAction(() => {
            mutableManager.isSmallScreen = previousSmallScreen
            mutableManager.manuallyOpened = previousManuallyOpened
        })
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    it("mounts one active sidebar content tree for the current viewport", async () => {
        await act(async () => {
            root.render(
                createElement(
                    MemoryRouter,
                    { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-1"] },
                    createElement(
                        Routes,
                        null,
                        createElement(Route, {
                            path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                            element: createElement(CodeSidebar),
                        })
                    )
                )
            )
        })

        expect(sidebarChildMocks.repoRenderCount).toBe(1)
        expect(sidebarChildMocks.cronRenderCount).toBe(1)
        expect(sidebarChildMocks.taskRenderCount).toBe(1)

        const mutableManager = codeSidebarManager as unknown as { isSmallScreen: boolean; manuallyOpened: boolean }
        await act(async () => {
            runInAction(() => {
                mutableManager.isSmallScreen = true
                mutableManager.manuallyOpened = true
            })
            root.render(
                createElement(
                    MemoryRouter,
                    { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-1"] },
                    createElement(
                        Routes,
                        null,
                        createElement(Route, {
                            path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                            element: createElement(CodeSidebar),
                        })
                    )
                )
            )
        })

        expect(sidebarChildMocks.repoRenderCount).toBe(2)
        expect(sidebarChildMocks.cronRenderCount).toBe(2)
        expect(sidebarChildMocks.taskRenderCount).toBe(2)

        await act(async () => {
            runInAction(() => {
                mutableManager.manuallyOpened = false
            })
            root.render(
                createElement(
                    MemoryRouter,
                    { initialEntries: ["/dashboard/code/workspace/repo-1/task/task-1"] },
                    createElement(
                        Routes,
                        null,
                        createElement(Route, {
                            path: "/dashboard/code/workspace/:workspaceId/task/:taskId",
                            element: createElement(CodeSidebar),
                        })
                    )
                )
            )
        })

        expect(sidebarChildMocks.repoRenderCount).toBe(2)
        expect(sidebarChildMocks.cronRenderCount).toBe(2)
        expect(sidebarChildMocks.taskRenderCount).toBe(2)
    })
})
