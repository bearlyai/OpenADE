/**
 * OnboardingPage
 *
 * Shows the onboarding modal for first-time users.
 * After completion, redirects to the first workspace.
 */

import NiceModal from "@ebay/nice-modal-react"
import { Sparkles } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useEffect } from "react"
import { OnboardingModal } from "../components/onboarding"
import { useCodeNavigate } from "../routing"
import { useCodeStore } from "../store/context"

export const OnboardingPage = observer(() => {
    const codeStore = useCodeStore()
    const navigate = useCodeNavigate()

    const handleComplete = useCallback(() => {
        // After onboarding, redirect to first workspace or workspace create
        const firstWorkspace = codeStore.repos.repos[0]
        if (firstWorkspace) {
            navigate.go("CodeWorkspaceTaskCreate", { workspaceId: firstWorkspace.id })
        } else {
            navigate.go("CodeWorkspaceCreate")
        }
    }, [codeStore.repos.repos, navigate])

    useEffect(() => {
        // Show the onboarding modal when the page mounts
        NiceModal.show(OnboardingModal, { store: codeStore, onComplete: handleComplete })
    }, [codeStore, handleComplete])

    return (
        <div className="flex flex-col items-center justify-center h-full text-muted">
            <Sparkles size="3rem" className="mb-4 text-primary opacity-50" />
            <div className="text-lg font-medium mb-2">Welcome</div>
            <div className="text-sm">Let's get you set up...</div>
        </div>
    )
})
