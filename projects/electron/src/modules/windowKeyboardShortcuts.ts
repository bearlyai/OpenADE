export interface BeforeInputLike {
    key: string
    type: string
    meta: boolean
    control: boolean
    alt: boolean
    shift: boolean
}

export type WindowKeyboardShortcutAction = "block-window-close" | "focus-input" | "reload" | null

export function getWindowKeyboardShortcutAction(input: BeforeInputLike, platform: NodeJS.Platform, terminalKeyboardCapture = false): WindowKeyboardShortcutAction {
    const key = input.key.toLowerCase()
    const mod = platform === "darwin" ? input.meta : input.control

    if (platform !== "darwin" && terminalKeyboardCapture && input.control && !input.meta) {
        return null
    }

    if (!mod || input.alt || input.shift) {
        return null
    }

    if (key === "w") {
        return "block-window-close"
    }

    if (key === "l" && input.type === "keyDown") {
        return "focus-input"
    }

    if (key === "r" && input.type === "keyDown") {
        return "reload"
    }

    return null
}
