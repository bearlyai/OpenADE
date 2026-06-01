import { type ReactElement, act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RemotePairingScreen } from "./RemotePairingScreen"

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true)
    if (!button) throw new Error(`Missing button: ${text}`)
    return button
}

describe("RemotePairingScreen", () => {
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

    it("routes manual pairing input, scan, submit, and cancel actions", () => {
        const actions: string[] = []
        render(
            createElement(RemotePairingScreen, {
                canScan: true,
                baseUrl: "openade://pair?token=test-token",
                pendingConnection: null,
                isLoading: false,
                error: "Pairing failed",
                canCancel: true,
                onBaseUrlChange: (value) => actions.push(`input:${value}`),
                onScan: () => actions.push("scan"),
                onSubmitPairingLink: () => actions.push("submit"),
                onConfirm: () => actions.push("confirm"),
                onCancelPending: () => actions.push("change"),
                onCancelAdd: () => actions.push("cancel"),
            })
        )

        expect(container.textContent).toContain("OpenADE")
        expect(container.textContent).toContain("Companion")
        expect(container.textContent).toContain("Pairing failed")

        const input = container.querySelector("input")
        if (!(input instanceof HTMLInputElement)) throw new Error("Missing pairing input")
        act(() => {
            const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
            if (!valueSetter) throw new Error("HTMLInputElement value setter is unavailable")
            valueSetter.call(input, "http://127.0.0.1:1977/pair?token=updated")
            input.dispatchEvent(new Event("input", { bubbles: true }))
            input.dispatchEvent(new Event("change", { bubbles: true }))
        })
        act(() => buttonByText(container, "Scan QR").click())
        act(() => buttonByText(container, "Connect").click())
        act(() => buttonByText(container, "Cancel").click())

        expect(actions).toEqual(["input:http://127.0.0.1:1977/pair?token=updated", "scan", "submit", "cancel"])
    })

    it("routes pending connection confirmation and change actions", () => {
        const actions: string[] = []
        render(
            createElement(RemotePairingScreen, {
                canScan: false,
                baseUrl: "",
                pendingConnection: { host: "Office Desktop", baseUrl: "http://10.0.0.5:1977" },
                isLoading: false,
                error: null,
                canCancel: false,
                onBaseUrlChange: (value) => actions.push(`input:${value}`),
                onScan: () => actions.push("scan"),
                onSubmitPairingLink: () => actions.push("submit"),
                onConfirm: () => actions.push("confirm"),
                onCancelPending: () => actions.push("change"),
                onCancelAdd: () => actions.push("cancel"),
            })
        )

        expect(container.textContent).toContain("Connect to Office Desktop")
        expect(container.textContent).toContain("http://10.0.0.5:1977")
        expect(container.textContent).not.toContain("Scan QR")

        act(() => buttonByText(container, "Connect").click())
        act(() => buttonByText(container, "Change").click())

        expect(actions).toEqual(["confirm", "change"])
    })
})
