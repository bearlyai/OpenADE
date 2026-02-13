import { describe, expect, it } from "vitest"
import { getHarnessDisplayName, toHarnessStatusView } from "./harnessStatusUtils"

describe("toHarnessStatusView", () => {
    it("returns Ready for installed and authenticated harnesses", () => {
        expect(
            toHarnessStatusView({
                installed: true,
                authType: "account",
                authenticated: true,
                version: "1.0.0",
            })
        ).toEqual({
            label: "Ready",
            tone: "success",
            subtitle: "Authenticated and ready.",
        })
    })

    it("returns Needs Login for installed but unauthenticated harnesses", () => {
        expect(
            toHarnessStatusView({
                installed: true,
                authType: "account",
                authenticated: false,
                authInstructions: "Run `codex login` to authenticate",
            })
        ).toEqual({
            label: "Needs Login",
            tone: "warning",
            subtitle: "Run `codex login` to authenticate",
        })
    })

    it("returns Not Installed for missing harnesses", () => {
        expect(
            toHarnessStatusView({
                installed: false,
                authType: "account",
                authenticated: false,
                authInstructions: "Install Codex CLI",
            })
        ).toEqual({
            label: "Not Installed",
            tone: "error",
            subtitle: "Install Codex CLI",
        })
    })
})

describe("getHarnessDisplayName", () => {
    it("uses known labels for standard harness IDs", () => {
        expect(getHarnessDisplayName("claude-code")).toBe("Claude Code")
        expect(getHarnessDisplayName("codex")).toBe("Codex")
    })

    it("formats unknown IDs as title-cased words", () => {
        expect(getHarnessDisplayName("my-custom-harness")).toBe("My Custom Harness")
    })
})
