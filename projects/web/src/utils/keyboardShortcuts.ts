export function isEventFromTerminal(event: KeyboardEvent): boolean {
    const target = event.target
    return target instanceof HTMLElement && !!target.closest(".xterm")
}

export function isEventFromEditable(event: KeyboardEvent): boolean {
    const target = event.target
    if (!(target instanceof HTMLElement)) return false

    if (target.closest("[data-allow-global-shortcuts='true']")) return false

    const editable = target.closest("input, textarea, select, [contenteditable]")
    return !!editable || target.isContentEditable
}

let suppressEditorAutoFocusUntil = 0
const KEYBOARD_NAV_AUTO_FOCUS_SUPPRESSION_MS = 1000
const KEYBOARD_NAV_SETTLED_EVENT = "openade:keyboard-navigation-settled"
const KEYBOARD_NAV_SETTLE_FOCUS_DELAY_MS = 120
const KEYBOARD_NAV_SETTLE_REPLAY_MS = 500
let keyboardNavigationFocusPending = false
let keyboardNavigationSettleTimer: number | null = null

function clearKeyboardNavigationSettleTimer() {
    if (keyboardNavigationSettleTimer === null || typeof window === "undefined") return
    window.clearTimeout(keyboardNavigationSettleTimer)
    keyboardNavigationSettleTimer = null
}

let lastKeyboardNavigationSettledAt = 0

function emitKeyboardNavigationSettled() {
    lastKeyboardNavigationSettledAt = Date.now()
    window.dispatchEvent(new Event(KEYBOARD_NAV_SETTLED_EVENT))
}

function scheduleKeyboardNavigationSettledFocus() {
    if (typeof window === "undefined") return

    clearKeyboardNavigationSettleTimer()
    keyboardNavigationSettleTimer = window.setTimeout(() => {
        keyboardNavigationSettleTimer = null
        emitKeyboardNavigationSettled()
    }, KEYBOARD_NAV_SETTLE_FOCUS_DELAY_MS)
}

function removeKeyboardNavigationReleaseListeners() {
    if (typeof window === "undefined") return

    window.removeEventListener("keyup", handleKeyboardNavigationRelease)
    window.removeEventListener("blur", handleKeyboardNavigationBlur)
}

function handleKeyboardNavigationRelease(event: KeyboardEvent) {
    if (!keyboardNavigationFocusPending) return
    if (event.key !== "Meta" && event.metaKey) return

    keyboardNavigationFocusPending = false
    removeKeyboardNavigationReleaseListeners()
    scheduleKeyboardNavigationSettledFocus()
}

function handleKeyboardNavigationBlur() {
    keyboardNavigationFocusPending = false
    removeKeyboardNavigationReleaseListeners()
    clearKeyboardNavigationSettleTimer()
}

export function suppressEditorAutoFocusForKeyboardNavigation() {
    suppressEditorAutoFocusUntil = Date.now() + KEYBOARD_NAV_AUTO_FOCUS_SUPPRESSION_MS
    if (typeof window === "undefined") return

    keyboardNavigationFocusPending = true
    clearKeyboardNavigationSettleTimer()
    window.addEventListener("keyup", handleKeyboardNavigationRelease)
    window.addEventListener("blur", handleKeyboardNavigationBlur)
}

export function shouldSuppressEditorAutoFocusForKeyboardNavigation(): boolean {
    return Date.now() < suppressEditorAutoFocusUntil
}

export function onKeyboardNavigationSettled(callback: () => void): () => void {
    if (typeof window === "undefined") return () => {}

    const listener = () => callback()
    window.addEventListener(KEYBOARD_NAV_SETTLED_EVENT, listener)

    if (Date.now() - lastKeyboardNavigationSettledAt < KEYBOARD_NAV_SETTLE_REPLAY_MS) {
        const replayTimer = window.setTimeout(callback, 0)
        return () => {
            window.clearTimeout(replayTimer)
            window.removeEventListener(KEYBOARD_NAV_SETTLED_EVENT, listener)
        }
    }

    return () => window.removeEventListener(KEYBOARD_NAV_SETTLED_EVENT, listener)
}

export function getDigitShortcutIndex(event: KeyboardEvent): number | null {
    const codeMatch = event.code.match(/^(?:Digit|Numpad)([1-9])$/)
    if (codeMatch) return Number.parseInt(codeMatch[1], 10) - 1

    const digit = Number.parseInt(event.key, 10)
    if (!Number.isInteger(digit) || digit < 1 || digit > 9) return null
    return digit - 1
}

export function isMetaShortcut(event: KeyboardEvent, code: string, { alt = false, shift = false }: { alt?: boolean; shift?: boolean } = {}): boolean {
    return event.metaKey && !event.ctrlKey && event.altKey === alt && event.shiftKey === shift && event.code === code && !isEventFromTerminal(event)
}

export function isMetaOnlyShortcut(event: KeyboardEvent, code: string): boolean {
    return isMetaShortcut(event, code)
}

export function getMetaDigitShortcutIndex(event: KeyboardEvent, { alt = false, shift = false }: { alt?: boolean; shift?: boolean } = {}): number | null {
    if (!event.metaKey || event.ctrlKey || event.altKey !== alt || event.shiftKey !== shift || isEventFromTerminal(event)) return null
    return getDigitShortcutIndex(event)
}
