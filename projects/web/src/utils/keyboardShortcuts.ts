export function isEventFromTerminal(event: KeyboardEvent): boolean {
    const target = event.target
    return target instanceof HTMLElement && !!target.closest(".xterm")
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
