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
 * Resolves a stored theme setting to an actual theme class name.
 * - "system": Uses OS preference to select defaultDarkTheme or defaultLightTheme
 * - "light"/"dark": Legacy stored values mapped to current theme classes
 * - Other values: Validated against themeClasses, falls back to defaultDarkTheme if invalid
 */
export function resolveThemeSetting(setting: ThemeSetting | string | null | undefined, systemPreference: "light" | "dark"): ThemeClass {
    if (!setting || setting === "system") {
        return systemPreference === "dark" ? defaultDarkTheme : defaultLightTheme
    }

    if (setting === "light") return defaultLightTheme
    if (setting === "dark") return defaultDarkTheme

    if (setting in themeClasses) {
        return setting as ThemeClass
    }

    return defaultDarkTheme
}

export function useResolvedTheme(setting: ThemeSetting | string | null | undefined): ThemeClass {
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

    return resolveThemeSetting(setting, systemPreference)
}
