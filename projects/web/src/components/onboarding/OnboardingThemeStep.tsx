/**
 * OnboardingThemeStep
 *
 * First step of onboarding - theme selection.
 * Shows theme preview cards with live switching.
 */

import { Check } from "lucide-react"
import { observer } from "mobx-react"
import { type ThemeClass, type ThemeSetting, allThemeOptions } from "../../persistence/personalSettingsStore"
import type { CodeStore } from "../../store/store"

/** Mini preview showing a mock UI using the theme's CSS class */
const ThemePreview = ({ themeClass }: { themeClass: ThemeClass }) => (
    <div className={`${themeClass} w-full aspect-square overflow-hidden border border-border bg-base-100`}>
        {/* Simulated sidebar */}
        <div className="flex h-full">
            <div className="w-1/4 h-full p-1.5 bg-base-200">
                <div className="w-full h-2 mb-1 bg-base-300" />
                <div className="w-3/4 h-2 mb-1 bg-base-300" />
                <div className="w-full h-2 bg-primary/30" />
            </div>
            {/* Simulated content area */}
            <div className="flex-1 p-2 flex flex-col gap-1.5">
                <div className="w-2/3 h-2 bg-base-content/70" />
                <div className="w-full h-2 bg-base-300" />
                <div className="w-4/5 h-2 bg-base-300" />
                <div className="mt-auto flex gap-1">
                    <div className="h-3 w-8 bg-primary" />
                    <div className="h-3 w-6 bg-base-300" />
                </div>
            </div>
        </div>
    </div>
)

/** System theme preview showing both light and dark split diagonally */
const SystemThemePreview = () => (
    <div className="w-full aspect-square overflow-hidden border border-border relative">
        {/* Light half (top-left) */}
        <div className="code-theme-light absolute inset-0 bg-base-100" style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}>
            <div className="flex h-full">
                <div className="w-1/4 h-full p-1.5 bg-base-200">
                    <div className="w-full h-2 mb-1 bg-base-300" />
                    <div className="w-3/4 h-2 bg-base-300" />
                </div>
                <div className="flex-1 p-2">
                    <div className="w-2/3 h-2 mb-1.5 bg-base-content/70" />
                    <div className="w-full h-2 bg-base-300" />
                </div>
            </div>
        </div>
        {/* Dark half (bottom-right) */}
        <div className="code-theme-black absolute inset-0 bg-base-100" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}>
            <div className="flex h-full">
                <div className="w-1/4 h-full p-1.5 bg-base-200">
                    <div className="w-full h-2 mb-1 bg-base-300" />
                    <div className="w-3/4 h-2 bg-base-300" />
                </div>
                <div className="flex-1 p-2">
                    <div className="w-2/3 h-2 mb-1.5 bg-base-content/70" />
                    <div className="w-full h-2 bg-base-300" />
                </div>
            </div>
        </div>
    </div>
)

interface OnboardingThemeStepProps {
    store: CodeStore
}

export const OnboardingThemeStep = observer(({ store }: OnboardingThemeStepProps) => {
    const personalSettings = store.personalSettingsStore
    const currentTheme = personalSettings?.settings.current.theme ?? "code-theme-black"

    const handleThemeChange = (theme: ThemeSetting) => {
        personalSettings?.settings.set({ theme })
    }

    return (
        <div className="flex flex-col items-center text-center">
            <h2 className="text-xl font-bold text-base-content mb-1">Pick your vibe</h2>
            <p className="text-sm text-muted mb-4">You can change this anytime in Settings.</p>

            <div className="flex gap-3 flex-wrap justify-center">
                {allThemeOptions.map((option) => {
                    const isSelected = currentTheme === option.value
                    return (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => handleThemeChange(option.value)}
                            className="btn flex flex-col items-center gap-1.5 group"
                        >
                            <div
                                className={`relative w-16 transition-all ${
                                    isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-base-100" : "hover:opacity-80"
                                }`}
                            >
                                {option.isSystem ? <SystemThemePreview /> : <ThemePreview themeClass={option.value as ThemeClass} />}
                                {isSelected && (
                                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-primary flex items-center justify-center">
                                        <Check size={10} className="text-primary-content" />
                                    </div>
                                )}
                            </div>
                            <span className={`text-xs font-medium ${isSelected ? "text-base-content" : "text-muted group-hover:text-base-content"}`}>
                                {option.label}
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
})
