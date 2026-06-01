import { FolderOpen, MessageSquarePlus, Settings } from "lucide-react"
import { type ReactElement, act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OpenADEChrome, type OpenADEChromeNavItem, openADEStatusToneClass } from "./OpenADEChrome"

type TestScreen = "projects" | "new_task" | "settings"

const navItems: Array<OpenADEChromeNavItem<TestScreen>> = [
    { screen: "projects", label: "Projects", icon: FolderOpen },
    { screen: "new_task", label: "New", icon: MessageSquarePlus },
    { screen: "settings", label: "Settings", icon: Settings },
]

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true)
    if (!button) throw new Error(`Missing button: ${text}`)
    return button
}

describe("OpenADEChrome", () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    function render(element: ReactElement): void {
        act(() => {
            root.render(element)
        })
    }

    it("frames shared shell content and routes chrome actions", () => {
        const actions: string[] = []
        render(
            createElement(
                OpenADEChrome<TestScreen>,
                {
                    className: "code-theme code-theme-black flex bg-base-100 text-base-content flex-col overflow-hidden",
                    title: "Runtime task",
                    host: "Local Desktop",
                    status: { label: "Connected", tone: "ok" },
                    showBack: true,
                    isLoading: false,
                    error: "Recoverable error",
                    notice: "Saved",
                    connectionWarning: null,
                    activeNav: "projects",
                    navItems,
                    onBack: () => actions.push("back"),
                    onRefresh: () => actions.push("refresh"),
                    onNavigate: (screen) => actions.push(`nav:${screen}`),
                },
                createElement("div", null, "Shell body")
            )
        )

        expect(container.textContent).toContain("Runtime task")
        expect(container.textContent).toContain("Local Desktop")
        expect(container.textContent).toContain("Connected")
        expect(container.textContent).toContain("Recoverable error")
        expect(container.textContent).toContain("Saved")
        expect(container.textContent).toContain("Shell body")

        const iconButtons = Array.from(container.querySelectorAll("button")).filter((button) => button.textContent === "")
        if (iconButtons.length < 2) throw new Error("Expected back and refresh icon buttons")
        act(() => iconButtons[0].click())
        act(() => iconButtons[1].click())
        act(() => buttonByText(container, "Settings").click())

        expect(actions).toEqual(["back", "refresh", "nav:settings"])
    })

    it("keeps status tone mapping available to medium settings panels", () => {
        expect(openADEStatusToneClass("ok")).toBe("text-success")
        expect(openADEStatusToneClass("warn")).toBe("text-warning")
        expect(openADEStatusToneClass("bad")).toBe("text-error")
        expect(openADEStatusToneClass("muted")).toBe("text-muted")
    })
})
