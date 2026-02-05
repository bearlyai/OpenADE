/**
 * useTerminalTheme
 *
 * Hook that detects the terminal theme from CSS variables and returns the corresponding
 * TerminalTheme object for xterm.js configuration.
 *
 * Reads the --terminal-theme CSS variable from the nearest .code-theme ancestor
 * and watches for theme class changes to update dynamically.
 */

import { type RefObject, useEffect, useState } from "react"
import { DEFAULT_TERMINAL_THEME, TERMINAL_THEMES, type TerminalTheme } from "../themes/terminalThemes"

/**
 * Detects terminal theme by reading --terminal-theme CSS variable from the ref element.
 * The variable is inherited from the nearest ancestor with the .code-theme class.
 * Watches for class changes on that ancestor to detect theme switches.
 *
 * @param ref - RefObject to an element within the themed container
 * @returns The TerminalTheme object to use for xterm.js configuration
 */
export function useTerminalTheme(ref: RefObject<HTMLElement | null>): TerminalTheme {
    const [theme, setTheme] = useState<TerminalTheme>(DEFAULT_TERMINAL_THEME)

    useEffect(() => {
        const el = ref.current
        if (!el) return

        const updateTheme = () => {
            const themeName = getComputedStyle(el).getPropertyValue("--terminal-theme").trim()
            console.log("USING THEME", themeName)
            const resolvedTheme = TERMINAL_THEMES[themeName] ?? DEFAULT_TERMINAL_THEME
            setTheme(resolvedTheme)
        }

        // Initial read
        updateTheme()

        // Find the nearest ancestor with the .code-theme class to observe
        const themeAncestor = el.closest(".code-theme")
        if (!themeAncestor) return

        const observer = new MutationObserver(updateTheme)
        observer.observe(themeAncestor, {
            attributes: true,
            attributeFilter: ["class"],
        })

        return () => observer.disconnect()
    }, [ref])

    console.log("GOT THEME", theme)
    return theme
}
