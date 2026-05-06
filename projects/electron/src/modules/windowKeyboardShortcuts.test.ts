import { describe, expect, it } from "vitest"
import { getWindowKeyboardShortcutAction, type BeforeInputLike } from "./windowKeyboardShortcuts"

const makeInput = (overrides: Partial<BeforeInputLike>): BeforeInputLike => ({
    key: "",
    type: "keyDown",
    meta: false,
    control: false,
    alt: false,
    shift: false,
    ...overrides,
})

describe("getWindowKeyboardShortcutAction", () => {
    it("uses Cmd for reload and close prevention on macOS", () => {
        expect(getWindowKeyboardShortcutAction(makeInput({ key: "r", meta: true }), "darwin")).toBe("reload")
        expect(getWindowKeyboardShortcutAction(makeInput({ key: "w", meta: true }), "darwin")).toBe("block-window-close")
    })

    it("does not treat macOS Ctrl terminal shortcuts as app shortcuts", () => {
        expect(getWindowKeyboardShortcutAction(makeInput({ key: "r", control: true }), "darwin")).toBeNull()
        expect(getWindowKeyboardShortcutAction(makeInput({ key: "w", control: true }), "darwin")).toBeNull()
    })

    it("keeps terminal capture scoped to non-macOS app modifiers", () => {
        expect(getWindowKeyboardShortcutAction(makeInput({ key: "r", meta: true }), "darwin", true)).toBe("reload")
        expect(getWindowKeyboardShortcutAction(makeInput({ key: "r", control: true }), "darwin", true)).toBeNull()
    })

    it("lets focused terminals capture Ctrl shortcuts on non-macOS platforms", () => {
        expect(getWindowKeyboardShortcutAction(makeInput({ key: "r", control: true }), "linux", true)).toBeNull()
        expect(getWindowKeyboardShortcutAction(makeInput({ key: "w", control: true }), "win32", true)).toBeNull()
    })

    it("uses Ctrl for reload and close prevention on non-macOS platforms", () => {
        expect(getWindowKeyboardShortcutAction(makeInput({ key: "r", control: true }), "linux")).toBe("reload")
        expect(getWindowKeyboardShortcutAction(makeInput({ key: "w", control: true }), "win32")).toBe("block-window-close")
    })

    it("ignores shifted or alt-modified variants", () => {
        expect(getWindowKeyboardShortcutAction(makeInput({ key: "r", meta: true, shift: true }), "darwin")).toBeNull()
        expect(getWindowKeyboardShortcutAction(makeInput({ key: "r", control: true, alt: true }), "linux")).toBeNull()
    })

    it("only reloads on keyDown", () => {
        expect(getWindowKeyboardShortcutAction(makeInput({ key: "r", meta: true, type: "keyUp" }), "darwin")).toBeNull()
    })
})
