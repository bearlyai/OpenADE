/**
 * OnboardingModal
 *
 * Three-step onboarding wizard for new users.
 * Steps: Theme selection → Workspace setup → Ask/Plan/Do explanation
 */

import NiceModal, { useModal } from "@ebay/nice-modal-react"
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react"
import { observer } from "mobx-react"
import { useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import type { CodeStore } from "../../store/store"
import { ScrollArea } from "../ui/ScrollArea"
import { OnboardingActionsStep } from "./OnboardingActionsStep"
import { OnboardingThemeStep } from "./OnboardingThemeStep"
import { OnboardingWorkspaceStep } from "./OnboardingWorkspaceStep"

const Z_INDEX_MODAL = "z-50"

type OnboardingStep = 0 | 1 | 2

const STEP_TITLES = ["Theme", "Workspace", "Workflow"]

interface OnboardingModalProps {
    store: CodeStore
    onComplete: () => void
}

export const OnboardingModal = NiceModal.create(
    observer(({ store, onComplete }: OnboardingModalProps) => {
        const modal = useModal()
        const [step, setStep] = useState<OnboardingStep>(0)
        const [workspaceAdded, setWorkspaceAdded] = useState(false)

        const handleComplete = () => {
            store.personalSettingsStore?.settings.set({ onboardingCompleted: true })
            modal.remove()
            onComplete()
        }

        const handleSkip = () => {
            store.personalSettingsStore?.settings.set({ onboardingCompleted: true })
            modal.remove()
            onComplete()
        }

        const handleNext = () => {
            if (step < 2) {
                setStep((step + 1) as OnboardingStep)
            } else {
                handleComplete()
            }
        }

        const handleBack = () => {
            if (step > 0) {
                setStep((step - 1) as OnboardingStep)
            }
        }

        const handleWorkspaceAdded = () => {
            setWorkspaceAdded(true)
            handleNext()
        }

        // Escape to skip
        useHotkeys(
            "esc",
            (e) => {
                e.preventDefault()
                e.stopPropagation()
                handleSkip()
            },
            { enableOnFormTags: ["INPUT", "TEXTAREA", "SELECT"] },
            [modal]
        )

        // Determine if Next is allowed
        const canProceed = step !== 1 || workspaceAdded

        const renderStep = () => {
            switch (step) {
                case 0:
                    return <OnboardingThemeStep store={store} />
                case 1:
                    return <OnboardingWorkspaceStep store={store} onWorkspaceAdded={handleWorkspaceAdded} />
                case 2:
                    return <OnboardingActionsStep />
                default:
                    return null
            }
        }

        return (
            <div
                className={`absolute inset-0 bg-black/50 flex items-start justify-center ${Z_INDEX_MODAL} p-4`}
                style={{
                    backdropFilter: "blur(5px)",
                    WebkitBackdropFilter: "blur(5px)",
                    paddingTop: "max(min(80px, 15%), 1rem)",
                }}
            >
                <div
                    className="bg-base-100 shadow-2xl w-full max-w-xl flex flex-col border border-border"
                    style={{
                        maxHeight: "min(580px, 80vh)",
                        minHeight: "350px",
                    }}
                >
                    {/* Header with progress */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                        <div className="flex items-center gap-2">
                            <Sparkles size={16} className="text-primary" />
                            <h2 className="text-base font-semibold text-base-content">Welcome</h2>
                        </div>
                        {/* Compact progress dots */}
                        <div className="flex items-center gap-1.5">
                            {STEP_TITLES.map((title, i) => (
                                <div
                                    key={title}
                                    title={title}
                                    className={`w-2 h-2 transition-colors ${i === step ? "bg-primary" : i < step ? "bg-success" : "bg-base-300"}`}
                                />
                            ))}
                        </div>
                        <button type="button" onClick={handleSkip} className="btn text-xs text-muted hover:text-base-content transition-colors">
                            Skip
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-h-0 overflow-hidden relative">
                        <ScrollArea className="absolute inset-0" viewportClassName="p-4">
                            {renderStep()}
                        </ScrollArea>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border flex-shrink-0 bg-base-200/30">
                        <div>
                            {step > 0 && (
                                <button
                                    type="button"
                                    onClick={handleBack}
                                    className="btn flex items-center gap-1.5 px-3 h-8 text-sm font-medium bg-base-200 text-base-content hover:bg-base-300 transition-all cursor-pointer"
                                >
                                    <ArrowLeft size={12} />
                                    Back
                                </button>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            {/* Step 1 (workspace) shows skip option */}
                            {step === 1 && (
                                <button type="button" onClick={handleNext} className="btn text-xs text-muted hover:text-base-content transition-colors">
                                    Skip for now
                                </button>
                            )}
                            {/* Other steps show Next/Get Started button */}
                            {step !== 1 && (
                                <button
                                    type="button"
                                    onClick={handleNext}
                                    disabled={!canProceed}
                                    className={`btn flex items-center gap-1.5 px-3 h-8 text-sm font-medium transition-all ${
                                        canProceed
                                            ? "bg-primary text-primary-content hover:bg-primary/80 cursor-pointer"
                                            : "bg-primary/40 text-primary-content/50 cursor-not-allowed"
                                    }`}
                                >
                                    {step === 2 ? "Get Started" : "Next"}
                                    {step !== 2 && <ArrowRight size={12} />}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )
    })
)
