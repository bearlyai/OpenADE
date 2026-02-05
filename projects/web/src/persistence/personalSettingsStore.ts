/**
 * PersonalSettingsStore
 *
 * Manages personal settings using YJS for persistence.
 * Stores environment variables and other user-specific configuration.
 */

import type * as Y from "yjs"
import type { SettingsTab } from "../components/settings/SettingsModal"
import { type YObjectHandle, objectOfType } from "./storage"

// ============================================================================
// Types
// ============================================================================

/**
 * Theme setting options.
 * - "system": Follow OS preference (prefers-color-scheme)
 * - "light": Always use light theme
 * - "dark": Always use dark theme
 * Additional themes can be added here in the future.
 */

/** Theme metadata for display in UI */
interface ThemeInfo {
    /** Display name shown in settings */
    label: string
}

/** Actual theme class names (CSS classes applied to root element) with metadata */
export const themeClasses = {
    "code-theme-light": { label: "Light" },
    "code-theme-bright": { label: "Bright" },
    "code-theme-clean": { label: "Clean" },
    "code-theme-black": { label: "Black" },
    "code-theme-synthwave": { label: "Synthwave" },
    "code-theme-dracula": { label: "Dracula" },
} as const satisfies Record<string, ThemeInfo>

/** Actual theme class type (excludes "system") */
export type ThemeClass = keyof typeof themeClasses

/** All available theme settings including "system" */
export const availableThemeClasses = {
    system: true,
    ...themeClasses,
} as const

/** Theme setting that can be stored (includes "system" option) */
export type ThemeSetting = keyof typeof availableThemeClasses

/** Ordered list of all theme options for UI display (system first, then theme classes in order) */
export const allThemeOptions: Array<{ value: ThemeSetting; label: string; isSystem: boolean }> = [
    { value: "system", label: "System", isSystem: true },
    ...(Object.keys(themeClasses) as ThemeClass[]).map((key) => ({
        value: key as ThemeSetting,
        label: themeClasses[key].label,
        isSystem: false,
    })),
]

/** Default theme to use when system preference is dark */
export const defaultDarkTheme: ThemeClass = "code-theme-black"
/** Default theme to use when system preference is light */
export const defaultLightTheme: ThemeClass = "code-theme-light"

/**
 * Personal settings stored per-user.
 */
export interface PersonalSettings {
    /** Custom environment variables to propagate to all subprocesses, Claude queries, and PTYs */
    envVars: Record<string, string>
    /** Theme preference - defaults to "system" */
    theme: ThemeSetting
    /** Last viewed settings tab - remembers which tab to open by default */
    lastSettingsTab?: SettingsTab
    /** Anonymous device ID for analytics - generated on first launch */
    deviceId?: string
    /** Opt-out of telemetry - undefined/false means enabled, true means disabled */
    telemetryDisabled?: boolean
    /** Whether the user has completed onboarding - shows only once per device */
    onboardingCompleted?: boolean
    /** Dev: Hide the tray buttons and slide-out panel */
    devHideTray?: boolean
}

/**
 * PersonalSettingsStore manages user-specific settings.
 * Backed by a single YJS document.
 */
export interface PersonalSettingsStore {
    settings: YObjectHandle<PersonalSettings>
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a PersonalSettingsStore backed by the given YJS document.
 * The document should be obtained via getYDoc() with the personal settings room ticket.
 */
export function createPersonalSettingsStore(doc: Y.Doc): PersonalSettingsStore {
    const settings = objectOfType<PersonalSettings>(doc, "personal_settings", () => ({
        envVars: {},
        theme: "code-theme-black",
    }))
    return { settings }
}
