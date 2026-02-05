import { exhaustive } from "exhaustive"
import { AlertCircle, GitBranch, Loader2, RotateCcw, X } from "lucide-react"
import { observer } from "mobx-react"
import { useEffect } from "react"
import { useCodeNavigate } from "../routing"
import { useCodeStore } from "../store/context"
import type { CreationPhase } from "../store/managers/TaskCreationManager"

interface TaskCreationPageProps {
    workspaceId: string
    creationId: string
}

const phaseLabels: Record<CreationPhase | "pending" | "completing" | "error", string> = {
    pending: "Starting...",
    workspace: "Creating workspace",
    completing: "Finalizing task",
    error: "Setup failed",
}

export const TaskCreationPage = observer(({ workspaceId, creationId }: TaskCreationPageProps) => {
    const codeStore = useCodeStore()
    const navigate = useCodeNavigate()
    const creation = codeStore.creation.getCreation(creationId)

    useEffect(() => {
        if (creation?.completedTaskId) {
            navigate.go("CodeWorkspaceTask", { workspaceId, taskId: creation.completedTaskId })
        }
    }, [creation?.completedTaskId, workspaceId, navigate])

    if (!creation) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-8">
                <div className="text-muted">Task creation not found</div>
            </div>
        )
    }

    const isError = creation.error !== null
    const phase = creation.phase
    const sourceBranch = creation.isolationStrategy
        ? exhaustive.tag(creation.isolationStrategy, "type", {
              worktree: (s) => s.sourceBranch,
              head: () => undefined,
          })
        : undefined

    const handleRetry = () => {
        codeStore.creation.retryCreation(creationId)
    }

    const handleCancel = async () => {
        await codeStore.creation.cancelCreation(creationId)
        navigate.go("CodeWorkspaceTaskCreate", { workspaceId })
    }

    return (
        <div className="h-full flex flex-col items-center justify-center p-8">
            <div className="max-w-xl w-full">
                <div className="text-center mb-6">
                    <div className="flex items-center justify-center gap-2">
                        {isError ? <AlertCircle size="1.25rem" className="text-error" /> : <Loader2 size="1.25rem" className="animate-spin text-primary" />}
                        <span className={`text-base font-medium ${isError ? "text-error" : "text-base-content"}`}>
                            {isError ? phaseLabels.error : phaseLabels[phase]}
                        </span>
                    </div>
                </div>

                {isError && creation.error && (
                    <div className="mb-6">
                        <div className="text-xs text-muted mb-2">Error output</div>
                        <div className="bg-error/10 border border-error/20 p-4 max-h-48 overflow-auto">
                            <pre className="text-xs text-error whitespace-pre-wrap font-mono">{creation.error}</pre>
                        </div>
                        <div className="flex gap-3 mt-4">
                            <button
                                type="button"
                                onClick={handleRetry}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-base-200 border border-border text-base-content text-sm font-medium hover:bg-base-300 transition-colors cursor-pointer"
                            >
                                <RotateCcw size="1em" />
                                Retry
                            </button>
                            <button
                                type="button"
                                onClick={handleCancel}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-base-200 border border-border text-base-content text-sm font-medium hover:bg-base-300 transition-colors cursor-pointer"
                            >
                                <X size="1em" />
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {!isError && (
                    <div className="flex flex-col items-center gap-3">
                        {sourceBranch && (
                            <div className="flex items-center justify-center gap-1.5 text-xs text-muted">
                                <GitBranch size="1em" />
                                <span>from {sourceBranch}</span>
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="btn flex items-center justify-center gap-2 px-4 py-2 text-xs text-base-content hover:text-muted transition-colors"
                        >
                            <X size="1em" />
                            Stop
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
})
