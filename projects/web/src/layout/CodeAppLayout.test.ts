import { createElement } from "react"
import { act } from "react"
import { type Root, createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CodeStoreProvider } from "../store/context"
import type { CodeStore } from "../store/store"
import { CodeAppLayout } from "./CodeAppLayout"

const electronApiMocks = vi.hoisted(() => ({
    hasElectronIpc: false,
    fetchPlatformInfo: vi.fn(),
    windowFrameEnabled: vi.fn(),
    windowFrameSetColors: vi.fn(),
}))

vi.mock("../components/sidebar/Sidebar", () => ({
    CodeSidebar: () => createElement("div", { "data-testid": "sidebar" }),
}))

vi.mock("../components/notifications/ReleaseNotification", () => ({
    ReleaseNotification: () => null,
}))

vi.mock("../electronAPI/capabilities", () => ({
    hasElectronIpc: () => electronApiMocks.hasElectronIpc,
}))

vi.mock("../electronAPI/platform", () => ({
    fetchPlatformInfo: electronApiMocks.fetchPlatformInfo,
}))

vi.mock("../electronAPI/windowFrame", () => ({
    windowFrameEnabled: electronApiMocks.windowFrameEnabled,
    windowFrameSetColors: electronApiMocks.windowFrameSetColors,
}))

describe("CodeAppLayout", () => {
    let container: HTMLDivElement
    let root: Root
    let previousActEnvironment: boolean | undefined
    let workerConstructedCount = 0

    beforeEach(() => {
        previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        electronApiMocks.hasElectronIpc = false
        electronApiMocks.fetchPlatformInfo.mockResolvedValue({
            platform: "darwin",
            pathSeparator: "/",
            homeDir: "/Users/test",
            isWindows: false,
            isMac: true,
            isLinux: false,
        })
        electronApiMocks.windowFrameEnabled.mockResolvedValue(true)
        electronApiMocks.windowFrameSetColors.mockResolvedValue({ type: "success" })
        workerConstructedCount = 0
        vi.stubGlobal(
            "Worker",
            class {
                constructor() {
                    workerConstructedCount += 1
                }
            }
        )
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
        vi.unstubAllGlobals()
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    it("does not start diff workers when the app shell opens without a diff surface", async () => {
        const store = {
            personalSettingsStore: {
                settings: {
                    current: {
                        theme: "light",
                        shortcutHintsHidden: true,
                    },
                },
            },
        } as unknown as CodeStore

        await act(async () => {
            root.render(
                createElement(
                    CodeStoreProvider,
                    { store },
                    createElement(CodeAppLayout, {
                        navbar: { title: "Task", icon: null, right: null },
                        children: createElement("div", null, "task route"),
                    })
                )
            )
        })

        expect(container.textContent).toContain("task route")
        expect(workerConstructedCount).toBe(0)
    })

    it("coalesces initial Electron frame color sync", async () => {
        electronApiMocks.hasElectronIpc = true
        const store = {
            personalSettingsStore: {
                settings: {
                    current: {
                        theme: "dark",
                        shortcutHintsHidden: true,
                    },
                },
            },
        } as unknown as CodeStore

        await act(async () => {
            root.render(
                createElement(
                    CodeStoreProvider,
                    { store },
                    createElement(CodeAppLayout, {
                        navbar: { title: "Task", icon: null, right: null },
                        children: createElement("div", null, "task route"),
                    })
                )
            )
        })

        await vi.waitFor(() => expect(electronApiMocks.windowFrameEnabled).toHaveBeenCalledTimes(1))
        await vi.waitFor(() => expect(electronApiMocks.windowFrameSetColors).toHaveBeenCalledTimes(1))
        expect(electronApiMocks.windowFrameSetColors).toHaveBeenCalledWith({
            color: "#303030",
            symbolColor: "#DBDDE0",
        })
    })
})
