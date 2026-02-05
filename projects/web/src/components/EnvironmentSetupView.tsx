import { exhaustive } from "exhaustive"
import { CheckCircle, FolderGit2, Loader2, RotateCcw, XCircle } from "lucide-react"
import { runInAction } from "mobx"
import { observer } from "mobx-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { type SetupParams, TaskEnvironment } from "../store/TaskEnvironment"
import type { TaskModel } from "../store/TaskModel"
import { useCodeStore } from "../store/context"

type SetupPhase = "workspace" | "pending" | "completing" | "complete"

interface EnvironmentSetupViewProps {
    taskModel: TaskModel
    onComplete: () => void
    onCancel?: () => void
}

export const EnvironmentSetupView = observer(function EnvironmentSetupView({ taskModel, onComplete, onCancel }: EnvironmentSetupViewProps) {
    const codeStore = useCodeStore()
    const [phase, setPhase] = useState<SetupPhase>("pending")
    const [error, setError] = useState<string | null>(null)
    const [isSettingUp, setIsSettingUp] = useState(false)
    const abortControllerRef = useRef<AbortController | null>(null)

    const task = codeStore.tasks.getTask(taskModel.taskId)
    const repo = task ? codeStore.repos.getRepo(task.repoId) : null

    const runSetup = useCallback(async () => {
        if (!task || !repo || !task.isolationStrategy) {
            console.error("[EnvironmentSetupView] Setup precondition failed:", {
                taskId: taskModel.taskId,
                hasTask: !!task,
                hasRepo: !!repo,
                hasIsolationStrategy: !!task?.isolationStrategy,
                taskRepoId: task?.repoId,
            })
            setError("Task or repository not found")
            return
        }

        setIsSettingUp(true)
        setError(null)
        setPhase("pending")

        abortControllerRef.current = new AbortController()

        try {
            // Fetch git info before setup
            const gitInfo = await codeStore.repos.getGitInfo(task.repoId)

            const params: SetupParams = {
                taskSlug: task.slug,
                gitInfo,
                isolationStrategy: task.isolationStrategy,
                signal: abortControllerRef.current.signal,
                onPhase: (p) => setPhase(p),
            }

            const deviceEnv = await TaskEnvironment.setup(params)

            setPhase("completing")
            await codeStore.tasks.addDeviceEnvironment(task.id, deviceEnv)

            runInAction(() => {
                codeStore.tasks.invalidateTaskModel(task.id)
            })

            setPhase("complete")
            onComplete()
        } catch (err) {
            if (err instanceof Error && err.message === "Setup cancelled") {
                setPhase("pending")
            } else {
                console.error("[EnvironmentSetupView] Setup failed:", err)
                setError(err instanceof Error ? err.message : "Setup failed")
            }
        } finally {
            setIsSettingUp(false)
            abortControllerRef.current = null
        }
    }, [task, repo, onComplete])

    const handleCancel = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
        onCancel?.()
    }, [onCancel])

    const handleRetry = useCallback(() => {
        setError(null)
        runSetup()
    }, [runSetup])

    useEffect(() => {
        if (!isSettingUp && !error && phase === "pending") {
            runSetup()
        }
    }, [])

    const isolationStrategy = task?.isolationStrategy
    const strategyLabel = isolationStrategy
        ? exhaustive.tag(isolationStrategy, "type", {
              worktree: (s) => `Creating worktree from ${s.sourceBranch}`,
              head: () => "Setting up in main repository",
          })
        : "Setting up environment"

    const phaseLabel = exhaustive(phase, {
        pending: () => "Preparing...",
        workspace: () => strategyLabel,
        completing: () => "Finishing...",
        complete: () => "Complete",
    })

    return (
        <div className="h-full flex flex-col items-center justify-center p-8">
            <div className="w-full max-w-xl">
                <div className="flex flex-col items-center gap-4 mb-6">
                    <div className="w-12 h-12 flex items-center justify-center bg-base-200 border border-border">
                        <FolderGit2 size="1.5em" className="text-muted" />
                    </div>
                    <div className="text-center">
                        <h2 className="text-lg font-medium text-base-content mb-1">Environment Setup</h2>
                        <p className="text-sm text-muted">Setting up the development environment for this task</p>
                    </div>
                </div>

                {error ? (
                    <div className="border border-error/30 bg-error/10 p-4 mb-4">
                        <div className="flex items-start gap-3">
                            <XCircle size="1.25em" className="text-error flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-error mb-1">Setup Failed</div>
                                <div className="text-sm text-error/80">{error}</div>
                            </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                            <button
                                type="button"
                                onClick={handleRetry}
                                className="btn flex items-center gap-2 px-4 py-2 text-sm font-medium bg-base-200 text-base-content hover:bg-base-300 border border-border"
                            >
                                <RotateCcw size="1em" />
                                Retry
                            </button>
                            {onCancel && (
                                <button type="button" onClick={handleCancel} className="btn px-4 py-2 text-sm text-muted hover:text-base-content">
                                    Cancel
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="mb-4">
                        <div className="flex items-center gap-3 p-4 bg-base-200 border border-border">
                            {phase === "complete" ? (
                                <CheckCircle size="1.25em" className="text-success" />
                            ) : (
                                <Loader2 size="1.25em" className="animate-spin text-primary" />
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-base-content">{phaseLabel}</div>
                                {phase !== "complete" && <div className="text-xs text-muted mt-0.5">This may take a moment</div>}
                            </div>
                            {isSettingUp && onCancel && (
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    className="btn px-3 py-1.5 text-xs text-muted hover:text-base-content border border-border hover:bg-base-300"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
})
