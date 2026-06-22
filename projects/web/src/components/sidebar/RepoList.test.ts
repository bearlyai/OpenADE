import { act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useCodeStore } from "../../store/context"
import { ReposSidebarContent } from "./RepoList"

vi.mock("../../store/context", () => ({
    useCodeStore: vi.fn(),
}))

vi.mock("../../routing", () => ({
    useCodeNavigate: () => ({
        go: vi.fn(),
    }),
}))

vi.mock("../../hooks/useShortcutHintsVisible", () => ({
    useShortcutHintsVisible: () => false,
}))

function makeStore({
    runtimeProduct = false,
    coreOwned = false,
    routeTaskSource = false,
}: {
    runtimeProduct?: boolean
    coreOwned?: boolean
    routeTaskSource?: boolean
}) {
    return {
        repos: {
            repos: [],
        },
        canUseProductMethod: vi.fn(() => false),
        shouldUseRuntimeProductAPI: vi.fn(() => runtimeProduct),
        usesCoreOwnedProductRuntime: vi.fn(() => coreOwned),
        canUseRuntimeProductTaskRouteModelSource: vi.fn(() => routeTaskSource),
        getTaskPreviewsForRepo: vi.fn(() => []),
        isTaskRunning: vi.fn(() => false),
    }
}

describe("ReposSidebarContent", () => {
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
        vi.mocked(useCodeStore).mockReset()
    })

    it("does not show an empty-workspace state while a Core task route defers project projection", async () => {
        vi.mocked(useCodeStore).mockReturnValue(
            makeStore({
                coreOwned: true,
                routeTaskSource: true,
            }) as unknown as ReturnType<typeof useCodeStore>
        )

        await act(async () => {
            root.render(createElement(MemoryRouter, null, createElement(ReposSidebarContent, { workspaceId: "repo-1" })))
        })

        expect(container.textContent).toContain("Loading workspace...")
        expect(container.textContent).not.toContain("No workspaces yet")
    })

    it("keeps the normal empty-workspace state outside runtime task routes", async () => {
        vi.mocked(useCodeStore).mockReturnValue(makeStore({}) as unknown as ReturnType<typeof useCodeStore>)

        await act(async () => {
            root.render(createElement(MemoryRouter, null, createElement(ReposSidebarContent, { workspaceId: undefined })))
        })

        expect(container.textContent).toContain("No workspaces yet")
        expect(container.textContent).not.toContain("Loading workspace...")
    })
})
