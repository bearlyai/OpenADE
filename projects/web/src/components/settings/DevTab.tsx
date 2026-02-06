/**
 * DevTab
 *
 * Developer tools tab for testing and debugging.
 * Only visible in local development.
 */

import NiceModal from "@ebay/nice-modal-react"
import { AlertTriangle, Eye, EyeOff, Megaphone, RotateCcw, Sparkles } from "lucide-react"
import { observer } from "mobx-react"
import { OnboardingModal } from "../onboarding"
import type { CodeStore } from "../../store/store"

interface DevTabProps {
    store: CodeStore
}

export const DevTab = observer(({ store }: DevTabProps) => {
    const personalSettings = store.personalSettingsStore

    const handlePreviewOnboarding = () => {
        NiceModal.show(OnboardingModal, {
            store,
            onComplete: () => {
                // Don't actually set onboardingCompleted when previewing
                console.log("[DevTab] Onboarding preview completed")
            },
        })
    }

    const handleResetOnboarding = () => {
        personalSettings?.settings.set({ onboardingCompleted: false })
    }

    const onboardingCompleted = personalSettings?.settings.current.onboardingCompleted
    const lastSeenReleaseVersion = personalSettings?.settings.current.lastSeenReleaseVersion

    const handleResetReleaseNotes = () => {
        personalSettings?.settings.set({ lastSeenReleaseVersion: undefined })
    }

    // Dev settings stored in personalSettings
    const devHideTray = personalSettings?.settings.current.devHideTray ?? false

    const handleToggleHideTray = () => {
        personalSettings?.settings.set({ devHideTray: !devHideTray })
    }

    return (
        <div className="flex flex-col gap-8">
            {/* Warning banner */}
            <div className="p-3 bg-warning/10 border border-warning/30 flex items-start gap-3">
                <AlertTriangle size={16} className="text-warning flex-shrink-0 mt-0.5" />
                <div>
                    <p className="text-sm text-base-content font-medium">Developer Tools</p>
                    <p className="text-xs text-muted">These options are for development and testing only.</p>
                </div>
            </div>

            {/* Onboarding section */}
            <section>
                <h3 className="text-base font-semibold text-base-content mb-1">Onboarding</h3>
                <p className="text-sm text-muted mb-4">Test the onboarding flow.</p>

                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between p-3 bg-base-200/50 border border-border">
                        <div className="flex items-center gap-3">
                            <Sparkles size={16} className="text-primary" />
                            <div>
                                <p className="text-sm font-medium text-base-content">Preview Onboarding</p>
                                <p className="text-xs text-muted">Opens the onboarding modal without changing state</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handlePreviewOnboarding}
                            className="btn px-3 py-1.5 text-sm font-medium bg-primary text-primary-content hover:bg-primary/80 transition-colors"
                        >
                            Preview
                        </button>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-base-200/50 border border-border">
                        <div className="flex items-center gap-3">
                            <RotateCcw size={16} className="text-muted" />
                            <div>
                                <p className="text-sm font-medium text-base-content">Reset Onboarding</p>
                                <p className="text-xs text-muted">
                                    Status:{" "}
                                    <span className={onboardingCompleted ? "text-success" : "text-warning"}>
                                        {onboardingCompleted ? "Completed" : "Not completed"}
                                    </span>
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleResetOnboarding}
                            disabled={!onboardingCompleted}
                            className={`btn px-3 py-1.5 text-sm font-medium transition-colors ${
                                onboardingCompleted
                                    ? "bg-base-200 text-base-content hover:bg-base-300"
                                    : "bg-base-200/40 text-base-content/50 cursor-not-allowed"
                            }`}
                        >
                            Reset
                        </button>
                    </div>
                </div>
            </section>

            {/* Release Notes section */}
            <section>
                <h3 className="text-base font-semibold text-base-content mb-1">Release Notes</h3>
                <p className="text-sm text-muted mb-4">Reset the release notes notification.</p>

                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between p-3 bg-base-200/50 border border-border">
                        <div className="flex items-center gap-3">
                            <Megaphone size={16} className="text-muted" />
                            <div>
                                <p className="text-sm font-medium text-base-content">Reset Release Notes</p>
                                <p className="text-xs text-muted">
                                    Last seen:{" "}
                                    <span className={lastSeenReleaseVersion ? "text-success" : "text-warning"}>{lastSeenReleaseVersion ?? "None"}</span>
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleResetReleaseNotes}
                            disabled={!lastSeenReleaseVersion}
                            className={`btn px-3 py-1.5 text-sm font-medium transition-colors ${
                                lastSeenReleaseVersion
                                    ? "bg-base-200 text-base-content hover:bg-base-300"
                                    : "bg-base-200/40 text-base-content/50 cursor-not-allowed"
                            }`}
                        >
                            Reset
                        </button>
                    </div>
                </div>
            </section>

            {/* UI Toggles section */}
            <section>
                <h3 className="text-base font-semibold text-base-content mb-1">UI Toggles</h3>
                <p className="text-sm text-muted mb-4">Toggle UI elements for testing.</p>

                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between p-3 bg-base-200/50 border border-border">
                        <div className="flex items-center gap-3">
                            {devHideTray ? <EyeOff size={16} className="text-muted" /> : <Eye size={16} className="text-muted" />}
                            <div>
                                <p className="text-sm font-medium text-base-content">Hide Tray</p>
                                <p className="text-xs text-muted">Hide the tray buttons and slide-out panel</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleToggleHideTray}
                            className={`btn px-3 py-1.5 text-sm font-medium transition-colors ${
                                devHideTray ? "bg-error text-error-content hover:bg-error/80" : "bg-base-200 text-base-content hover:bg-base-300"
                            }`}
                        >
                            {devHideTray ? "Hidden" : "Visible"}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    )
})

/** Check if we're in local development */
export function isLocalDev(): boolean {
    if (typeof window === "undefined") return false
    const hostname = window.location.hostname
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("192.168.") || hostname.endsWith(".local")
}
