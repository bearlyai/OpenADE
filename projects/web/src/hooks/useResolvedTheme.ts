/**
 * useResolvedTheme
 *
 * Hook that resolves theme setting to an actual theme class.
 * For "system", uses OS preference and listens for changes.
 * Validates that the theme exists in themeClasses, falling back to defaults if not.
 */

import { useEffect, useState } from "react"
import { type ThemeClass, type ThemeSetting, defaultDarkTheme, defaultLightTheme, themeClasses } from "../persistence/personalSettingsStore"

/**
 * Resolves a ThemeSetting to an actual theme class name.
 * - "system": Uses OS preference to select defaultDarkTheme or defaultLightTheme
 * - Other values: Validated against themeClasses, falls back to defaultDarkTheme if invalid
 */
export function useResolvedTheme(setting: ThemeSetting): ThemeClass {
    const [systemPreference, setSystemPreference] = useState<"light" | "dark">(() => {
        if (typeof window === "undefined") return "light"
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    })

    useEffect(() => {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
        const handler = (e: MediaQueryListEvent) => {
            setSystemPreference(e.matches ? "dark" : "light")
        }
        mediaQuery.addEventListener("change", handler)
        return () => mediaQuery.removeEventListener("change", handler)
    }, [])

    // System mode: use OS preference to pick default light/dark theme
    if (setting === "system") {
        return systemPreference === "dark" ? defaultDarkTheme : defaultLightTheme
    }

    // Validate that the theme exists in available theme classes
    if (setting in themeClasses) {
        return setting as ThemeClass
    }

    // Fallback to default dark theme if the saved theme is no longer available
    return defaultDarkTheme
}
