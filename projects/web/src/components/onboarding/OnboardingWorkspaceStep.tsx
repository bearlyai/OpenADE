/**
 * OnboardingWorkspaceStep
 *
 * Second step of onboarding - add first workspace.
 * Reuses validation logic from WorkspaceCreatePage.
 */

import { AlertTriangle, FolderOpen, FolderPlus, GitBranch, Loader2 } from "lucide-react"
import { observer } from "mobx-react"
import { useEffect, useRef, useState } from "react"
import { type IsGitDirectoryResponse, type ResolvePathResponse, initGit, isGitApiAvailable, isGitDirectory, resolvePath } from "../../electronAPI/git"
import { selectDirectory } from "../../electronAPI/shell"
import type { CodeStore } from "../../store/store"
import { getFileName } from "../utils/paths"

interface OnboardingWorkspaceStepProps {
    store: CodeStore
    onWorkspaceAdded: () => void
}

export const OnboardingWorkspaceStep = observer(({ store, onWorkspaceAdded }: OnboardingWorkspaceStepProps) => {
    const inputRef = useRef<HTMLInputElement>(null)

    // Input state
    const [inputValue, setInputValue] = useState("")

    // Validation state
    const [isValidating, setIsValidating] = useState(false)
    const [pathInfo, setPathInfo] = useState<ResolvePathResponse | null>(null)
    const [gitInfo, setGitInfo] = useState<IsGitDirectoryResponse | null>(null)

    // Git init state
    const [isInitializingGit, setIsInitializingGit] = useState(false)
    const [initGitError, setInitGitError] = useState<string | null>(null)

    // Submit state
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Auto-focus input
    useEffect(() => {
        inputRef.current?.focus()
    }, [])

    // Debounced path validation
    useEffect(() => {
        if (!inputValue.trim()) {
            setPathInfo(null)
            setGitInfo(null)
            return
        }

        const timer = setTimeout(async () => {
            if (!isGitApiAvailable()) return

            setIsValidating(true)
            setInitGitError(null)

            try {
                const resolved = await resolvePath({ path: inputValue.trim() })
                setPathInfo(resolved)

                if (resolved.exists && resolved.isDirectory) {
                    const git = await isGitDirectory({ directory: resolved.resolvedPath })
                    setGitInfo(git)
                } else {
                    setGitInfo(null)
                }
            } catch (error) {
                console.error("[OnboardingWorkspaceStep] Error validating path:", error)
                setPathInfo(null)
                setGitInfo(null)
            } finally {
                setIsValidating(false)
            }
        }, 300)

        return () => clearTimeout(timer)
    }, [inputValue])

    const handleBrowse = async () => {
        const selected = await selectDirectory()
        if (selected) {
            setInputValue(selected)
        }
    }

    const handleInitGit = async () => {
        if (!pathInfo?.resolvedPath) return

        setIsInitializingGit(true)
        setInitGitError(null)

        try {
            const result = await initGit({ directory: pathInfo.resolvedPath })
            if (result.success) {
                const git = await isGitDirectory({ directory: pathInfo.resolvedPath })
                setGitInfo(git)
            } else {
                setInitGitError(result.error || "Failed to initialize git repository")
            }
        } catch (error) {
            setInitGitError(error instanceof Error ? error.message : "Failed to initialize git repository")
        } finally {
            setIsInitializingGit(false)
        }
    }

    const handleSubmit = async () => {
        const pathToUse = pathInfo?.resolvedPath || inputValue.trim()
        if (!pathToUse) return

        setIsSubmitting(true)
        try {
            const name = getFileName(pathToUse) || "Workspace"
            const repo = await store.repos.addRepo({ name, path: pathToUse })
            if (repo) {
                onWorkspaceAdded()
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    // Derived state
    const hasCodeModules = isGitApiAvailable()
    const hasValidDirectory = pathInfo?.exists && pathInfo?.isDirectory
    const isGitRepo = gitInfo && "isGitDirectory" in gitInfo && gitInfo.isGitDirectory
    const showGitWarning = hasValidDirectory && !isGitRepo && !isValidating
    const canSubmit = hasValidDirectory && !isValidating && !isSubmitting

    return (
        <div className="flex flex-col">
            <div className="text-center mb-4">
                <h2 className="text-xl font-bold text-base-content mb-1">Add your first project</h2>
                <p className="text-sm text-muted">Choose a directory with code you want to work on.</p>
            </div>

            <div className="flex flex-col gap-3">
                {/* Directory Path Input */}
                <div>
                    <label htmlFor="onboarding-workspace-path" className="block text-sm font-medium text-base-content mb-1.5">
                        Directory Path
                    </label>
                    <div className="flex gap-2">
                        <input
                            id="onboarding-workspace-path"
                            ref={inputRef}
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            placeholder="~/Projects/my-app"
                            className="flex-1 px-3 py-2 bg-input text-base-content border border-border focus:outline-none focus:border-primary transition-all placeholder:text-muted/50 text-sm"
                        />
                        {hasCodeModules && (
                            <button
                                type="button"
                                onClick={handleBrowse}
                                className="px-3 py-2 bg-base-200 text-base-content border border-border hover:bg-base-300 transition-all cursor-pointer flex items-center gap-2 text-sm"
                            >
                                <FolderOpen size={14} />
                                Browse
                            </button>
                        )}
                    </div>
                    {/* Resolved path hint */}
                    {pathInfo && pathInfo.resolvedPath !== inputValue.trim() && <p className="mt-1 text-xs text-muted">Resolves to: {pathInfo.resolvedPath}</p>}
                    {/* Path validation feedback */}
                    {inputValue.trim() && !isValidating && pathInfo && !pathInfo.exists && <p className="mt-1 text-xs text-error">Directory does not exist</p>}
                    {inputValue.trim() && !isValidating && pathInfo && pathInfo.exists && !pathInfo.isDirectory && (
                        <p className="mt-1 text-xs text-error">Path is not a directory</p>
                    )}
                </div>

                {/* Git Warning Banner */}
                {showGitWarning && (
                    <div className="p-3 bg-warning/10 border border-warning/30">
                        <div className="flex items-center gap-3">
                            <AlertTriangle size={16} className="text-warning flex-shrink-0" />
                            <div className="flex-1 flex items-center justify-between gap-2">
                                <span className="text-sm text-base-content">Not a git repository</span>
                                <button
                                    type="button"
                                    onClick={handleInitGit}
                                    disabled={isInitializingGit}
                                    className={`px-2 py-1 text-xs font-medium transition-all ${
                                        isInitializingGit
                                            ? "bg-base-200/40 text-base-content/50 cursor-not-allowed"
                                            : "bg-base-200 text-base-content hover:bg-base-300 cursor-pointer"
                                    }`}
                                >
                                    {isInitializingGit ? "Initializing..." : "Initialize Git"}
                                </button>
                            </div>
                        </div>
                        {initGitError && <p className="mt-2 text-xs text-error">{initGitError}</p>}
                    </div>
                )}

                {/* Git repo success indicator */}
                {hasValidDirectory && isGitRepo && !isValidating && (
                    <div className="p-2 bg-success/10 border border-success/30">
                        <div className="flex items-center gap-2">
                            <GitBranch size={14} className="text-success" />
                            <span className="text-xs text-base-content">Git repo ({gitInfo.mainBranch})</span>
                        </div>
                    </div>
                )}

                {/* Validating indicator */}
                {isValidating && (
                    <div className="flex items-center gap-2 text-muted">
                        <Loader2 size={14} className="animate-spin" />
                        <span className="text-xs">Checking...</span>
                    </div>
                )}

                {/* Submit Button */}
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-all ${
                        !canSubmit
                            ? "bg-primary/40 text-primary-content/50 cursor-not-allowed"
                            : "bg-primary text-primary-content hover:bg-primary/90 cursor-pointer"
                    }`}
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 size={14} className="animate-spin" />
                            Adding...
                        </>
                    ) : (
                        <>
                            <FolderPlus size={14} />
                            Add Workspace
                        </>
                    )}
                </button>
            </div>
        </div>
    )
})
