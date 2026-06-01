import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADESnapshot } from "../../../openade-module/src"
import { isMobileThemeSetting, MobileSessionsScreen, MobileSettingsScreen } from "./MobileSessionScreens"

const snapshot: OpenADESnapshot = {
    server: {
        version: "test",
        hostName: "Runtime Host",
        theme: { setting: "code-theme-dracula", className: "code-theme-dracula", label: "Dracula" },
    },
    repos: [],
    workingTaskIds: [],
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true)
    if (!button) throw new Error(`Missing button: ${text}`)
    return button
}

function buttonByTitle(container: HTMLElement, title: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.title === title)
    if (!button) throw new Error(`Missing button title: ${title}`)
    return button
}

describe("MobileSessionScreens", () => {
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

    it("routes saved session selection, removal, and add actions", () => {
        const actions: string[] = []
        render(
            createElement(MobileSessionsScreen, {
                configs: [
                    { id: "local", host: "Local Desktop", baseUrl: "http://127.0.0.1:1977" },
                    { id: "office", host: "Office Desktop", baseUrl: "http://10.0.0.5:1977" },
                ],
                activeConfigId: "local",
                onSelect: (configId) => actions.push(`select:${configId}`),
                onRemove: (configId) => actions.push(`remove:${configId}`),
                onAdd: () => actions.push("add"),
            })
        )

        expect(container.textContent).toContain("Local Desktop")
        expect(container.textContent).toContain("Office Desktop")

        act(() => buttonByText(container, "Office Desktop").click())
        act(() => buttonByTitle(container, "Remove Office Desktop").click())
        act(() => buttonByText(container, "Add OpenADE Session").click())

        expect(actions).toEqual(["select:office", "remove:office", "add"])
    })

    it("routes mobile settings actions and validates theme selections", () => {
        const actions: string[] = []
        render(
            createElement(MobileSettingsScreen, {
                config: { id: "local", host: "Local Desktop", baseUrl: "http://127.0.0.1:1977" },
                snapshot,
                status: { label: "Connected", tone: "ok" },
                mobileTheme: "desktop",
                onRefresh: () => actions.push("refresh"),
                onForget: () => actions.push("forget"),
                onSelfRevoke: () => actions.push("self-revoke"),
                onSessions: () => actions.push("sessions"),
                onAdd: () => actions.push("add"),
                onThemeChange: (value) => actions.push(`theme:${value}`),
            })
        )

        expect(container.textContent).toContain("Local Desktop")
        expect(container.textContent).toContain("Connected")
        expect(container.textContent).toContain("Matching desktop: Dracula")

        act(() => buttonByText(container, "Test").click())
        act(() => buttonByText(container, "Forget").click())
        act(() => buttonByText(container, "Revoke This Device").click())
        act(() => buttonByText(container, "Manage Sessions").click())
        act(() => buttonByText(container, "Add Session").click())

        const themeSelect = container.querySelector("select")
        if (!(themeSelect instanceof HTMLSelectElement)) throw new Error("Missing theme select")
        act(() => {
            themeSelect.value = "code-theme-light"
            themeSelect.dispatchEvent(new Event("change", { bubbles: true }))
        })

        expect(actions).toEqual(["refresh", "forget", "self-revoke", "sessions", "add", "theme:code-theme-light"])
    })

    it("accepts only supported mobile theme settings", () => {
        expect(isMobileThemeSetting("desktop")).toBe(true)
        expect(isMobileThemeSetting("code-theme-clean")).toBe(true)
        expect(isMobileThemeSetting("not-a-theme")).toBe(false)
        expect(isMobileThemeSetting(null)).toBe(false)
    })
})
