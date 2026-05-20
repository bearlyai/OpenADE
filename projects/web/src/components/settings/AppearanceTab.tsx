/**
 * AppearanceTab
 *
 * Settings tab for theme selection and appearance preferences.
 * Shows theme previews as square cards using actual theme CSS classes.
 */

import { Check, Eye, EyeOff, Keyboard } from "lucide-react"
import { observer } from "mobx-react"
import { type ThemeClass, type ThemeSetting, allThemeOptions } from "../../persistence/personalSettingsStore"
import type { CodeStore } from "../../store/store"

/** Mini preview showing a mock UI using the theme's CSS class */
const ThemePreview = ({ themeClass }: { themeClass: ThemeClass }) => (
    <div className={`${themeClass} w-full aspect-square rounded-lg overflow-hidden border border-border bg-base-100`}>
        {/* Simulated sidebar */}
        <div className="flex h-full">
            <div className="w-1/4 h-full p-1.5 bg-base-200">
                <div className="w-full h-2 rounded-sm mb-1 bg-base-300" />
                <div className="w-3/4 h-2 rounded-sm mb-1 bg-base-300" />
                <div className="w-full h-2 rounded-sm bg-primary/30" />
            </div>
            {/* Simulated content area */}
            <div className="flex-1 p-2 flex flex-col gap-1.5">
                <div className="w-2/3 h-2 rounded-sm bg-base-content/70" />
                <div className="w-full h-2 rounded-sm bg-base-300" />
                <div className="w-4/5 h-2 rounded-sm bg-base-300" />
                <div className="mt-auto flex gap-1">
                    <div className="h-3 w-8 rounded-sm bg-primary" />
                    <div className="h-3 w-6 rounded-sm bg-base-300" />
                </div>
            </div>
        </div>
    </div>
)

/** System theme preview showing both light and dark split diagonally */
const SystemThemePreview = () => (
    <div className="w-full aspect-square rounded-lg overflow-hidden border border-border relative">
        {/* Light half (top-left) */}
        <div className="code-theme-light absolute inset-0 bg-base-100" style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}>
            <div className="flex h-full">
                <div className="w-1/4 h-full p-1.5 bg-base-200">
                    <div className="w-full h-2 rounded-sm mb-1 bg-base-300" />
                    <div className="w-3/4 h-2 rounded-sm bg-base-300" />
                </div>
                <div className="flex-1 p-2">
                    <div className="w-2/3 h-2 rounded-sm mb-1.5 bg-base-content/70" />
                    <div className="w-full h-2 rounded-sm bg-base-300" />
                </div>
            </div>
        </div>
        {/* Dark half (bottom-right) */}
        <div className="code-theme-black absolute inset-0 bg-base-100" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}>
            <div className="flex h-full">
                <div className="w-1/4 h-full p-1.5 bg-base-200">
                    <div className="w-full h-2 rounded-sm mb-1 bg-base-300" />
                    <div className="w-3/4 h-2 rounded-sm bg-base-300" />
                </div>
                <div className="flex-1 p-2">
                    <div className="w-2/3 h-2 rounded-sm mb-1.5 bg-base-content/70" />
                    <div className="w-full h-2 rounded-sm bg-base-300" />
                </div>
            </div>
        </div>
    </div>
)

interface AppearanceTabProps {
    store: CodeStore
}

export const AppearanceTab = observer(({ store }: AppearanceTabProps) => {
    const personalSettings = store.personalSettingsStore
    const currentTheme = personalSettings?.settings.current.theme ?? "system"
    const shortcutHintsHidden = personalSettings?.settings.current.shortcutHintsHidden ?? false

    const handleThemeChange = (theme: ThemeSetting) => {
        personalSettings?.settings.set({ theme })
    }

    const handleToggleShortcutHints = () => {
        personalSettings?.settings.set({ shortcutHintsHidden: !shortcutHintsHidden })
    }

    return (
        <div className="flex flex-col gap-8">
            <section>
                <h3 className="text-base font-semibold text-base-content mb-1">Theme</h3>
                <p className="text-sm text-muted mb-4">Choose your preferred color scheme.</p>

                <div className="flex gap-4 flex-wrap">
                    {allThemeOptions.map((option) => {
                        const isSelected = currentTheme === option.value
                        return (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => handleThemeChange(option.value)}
                                className="btn flex flex-col items-center gap-2 group"
                            >
                                <div
                                    className={`relative w-24 transition-all ${
                                        isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-base-100 rounded-lg" : "hover:opacity-80"
                                    }`}
                                >
                                    {option.isSystem ? <SystemThemePreview /> : <ThemePreview themeClass={option.value as ThemeClass} />}
                                    {isSelected && (
                                        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                                            <Check size={12} className="text-primary-content" />
                                        </div>
                                    )}
                                </div>
                                <span className={`text-sm font-medium ${isSelected ? "text-base-content" : "text-muted group-hover:text-base-content"}`}>
                                    {option.label}
                                </span>
                            </button>
                        )
                    })}
                </div>
            </section>

            <section>
                <h3 className="text-base font-semibold text-base-content mb-1">Shortcuts</h3>
                <div className="flex items-center justify-between p-3 bg-base-200/50 border border-border">
                    <div className="flex items-center gap-3">
                        <Keyboard size={16} className="text-muted" />
                        <div>
                            <p className="text-sm font-medium text-base-content">Shortcut hints</p>
                            <p className="text-xs text-muted">Show key hints while holding Command</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleToggleShortcutHints}
                        className={`btn flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                            shortcutHintsHidden ? "bg-base-200 text-base-content hover:bg-base-300" : "bg-primary text-primary-content hover:bg-primary/80"
                        }`}
                    >
                        {shortcutHintsHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                        {shortcutHintsHidden ? "Hidden" : "Visible"}
                    </button>
                </div>
            </section>
        </div>
    )
})
