/**
 * OnboardingActionsStep
 *
 * Third step of onboarding - explain Ask/Plan/Do workflow.
 * Compact design with visual workflow graphic.
 */

import { ArrowRight, MessageCircleQuestion, Play, RefreshCw } from "lucide-react"

// Button styles matching InputBar.tsx
const BUTTON_BASE = "flex items-center justify-center gap-1.5 px-3 h-8 text-sm font-medium whitespace-nowrap"

const BUTTON_STYLES = {
    primary: "bg-primary text-primary-content",
    success: "bg-success text-success-content",
    ghost: "bg-base-200 text-base-content",
} as const

export const OnboardingActionsStep = () => {
    return (
        <div className="flex flex-col gap-4">
            <div className="text-center">
                <h2 className="text-xl font-bold text-base-content mb-1">Three ways to work</h2>
                <p className="text-sm text-muted">Pick the right mode for the job</p>
            </div>

            {/* Compact action cards */}
            <div className="flex flex-col gap-2">
                {/* Ask */}
                <div className="flex items-center gap-3 p-3 bg-base-200/50 border border-border">
                    <div className={`${BUTTON_BASE} ${BUTTON_STYLES.ghost} flex-shrink-0`}>
                        <MessageCircleQuestion size={14} />
                        Ask
                    </div>
                    <div className="flex-1 min-w-0">
                        <span className="text-sm text-base-content">Explore and understand — no changes made</span>
                    </div>
                </div>

                {/* Plan */}
                <div className="flex items-center gap-3 p-3 bg-base-200/50 border border-border">
                    <div className={`${BUTTON_BASE} ${BUTTON_STYLES.success} flex-shrink-0`}>
                        <RefreshCw size={14} />
                        Plan
                    </div>
                    <div className="flex-1 min-w-0">
                        <span className="text-sm text-base-content">Claude proposes, you review and approve</span>
                    </div>
                </div>

                {/* Do */}
                <div className="flex items-center gap-3 p-3 bg-base-200/50 border border-border">
                    <div className={`${BUTTON_BASE} ${BUTTON_STYLES.primary} flex-shrink-0`}>
                        <Play size={14} />
                        Do
                    </div>
                    <div className="flex-1 min-w-0">
                        <span className="text-sm text-base-content">YOLO — Claude makes changes directly</span>
                    </div>
                </div>
            </div>

            {/* Visual workflow recommendation */}
            <div className="p-4 bg-success/10 border border-success/30">
                <p className="text-xs text-muted uppercase tracking-wide mb-3">Recommended workflow</p>
                <div className="flex items-center justify-center gap-2">
                    {/* Start with Ask or Plan */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-base-100 border border-border">
                        <div className={`${BUTTON_BASE} ${BUTTON_STYLES.ghost} h-7 px-2`}>
                            <MessageCircleQuestion size={12} />
                            Ask
                        </div>
                        <span className="text-muted text-sm">/</span>
                        <div className={`${BUTTON_BASE} ${BUTTON_STYLES.success} h-7 px-2`}>
                            <RefreshCw size={12} />
                            Plan
                        </div>
                    </div>

                    {/* Arrow */}
                    <ArrowRight size={20} className="text-muted flex-shrink-0" />

                    {/* Then Do */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-base-100 border border-border">
                        <div className={`${BUTTON_BASE} ${BUTTON_STYLES.primary} h-7 px-2`}>
                            <Play size={12} />
                            Do
                        </div>
                    </div>
                </div>
                <p className="text-xs text-center text-muted mt-3">A good plan helps any model get it right</p>
            </div>
        </div>
    )
}
