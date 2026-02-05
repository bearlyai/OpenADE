import { AlertTriangle, FolderOpen, FolderPlus, GitBranch, Loader2 } from "lucide-react"
import { observer } from "mobx-react"
import { useEffect, useRef, useState } from "react"
import { ScrollArea } from "../components/ui"
import { getFileName } from "../components/utils/paths"
import { type IsGitDirectoryResponse, type ResolvePathResponse, initGit, isGitApiAvailable, isGitDirectory, resolvePath } from "../electronAPI/git"
import { selectDirectory } from "../electronAPI/shell"
import { useCodeNavigate } from "../routing"
import { useCodeStore } from "../store/context"

export const WorkspaceCreatePage = observer(() => {
    const codeStore = useCodeStore()
    const navigate = useCodeNavigate()
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
                // Resolve the path first
                const resolved = await resolvePath({ path: inputValue.trim() })
                setPathInfo(resolved)

                // If it's a valid directory, check if it's a git repo
                if (resolved.exists && resolved.isDirectory) {
                    const git = await isGitDirectory({ directory: resolved.resolvedPath })
                    setGitInfo(git)
                } else {
                    setGitInfo(null)
                }
            } catch (error) {
                console.error("[WorkspaceCreatePage] Error validating path:", error)
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
                // Re-check git status
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
            const repo = await codeStore.repos.addRepo({ name, path: pathToUse })
            if (repo) {
                navigate.go("CodeWorkspace", { workspaceId: repo.id })
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
        <ScrollArea className="h-full" viewportClassName="p-0">
            <div className="flex flex-col items-center pt-12 p-8">
                <div className="w-full max-w-2xl">
                    <div className="mb-8">
                        <h1 className="text-2xl font-semibold text-base-content mb-2">Add Workspace</h1>
                        <p className="text-muted">Add a local directory to work on.</p>
                    </div>
                    <div className="flex flex-col gap-4">
                        {/* Directory Path Input */}
                        <div>
                            <label htmlFor="workspace-path" className="block text-sm font-medium text-base-content mb-2">
                                Directory Path
                            </label>
                            <div className="flex gap-2">
                                <input
                                    id="workspace-path"
                                    ref={inputRef}
                                    type="text"
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    placeholder="~/Projects/my-app or /path/to/directory"
                                    className="flex-1 px-4 py-3 bg-input text-base-content border border-border focus:outline-none focus:border-primary transition-all placeholder:text-muted/50"
                                />
                                {hasCodeModules && (
                                    <button
                                        type="button"
                                        onClick={handleBrowse}
                                        className="px-4 py-3 bg-base-200 text-base-content border border-border hover:bg-base-300 transition-all cursor-pointer flex items-center gap-2"
                                    >
                                        <FolderOpen size="1em" />
                                        Browse
                                    </button>
                                )}
                            </div>
                            {/* Resolved path hint */}
                            {pathInfo && pathInfo.resolvedPath !== inputValue.trim() && (
                                <p className="mt-1 text-xs text-muted">Resolves to: {pathInfo.resolvedPath}</p>
                            )}
                            {/* Path validation feedback */}
                            {inputValue.trim() && !isValidating && pathInfo && !pathInfo.exists && (
                                <p className="mt-1 text-xs text-error">Directory does not exist</p>
                            )}
                            {inputValue.trim() && !isValidating && pathInfo && pathInfo.exists && !pathInfo.isDirectory && (
                                <p className="mt-1 text-xs text-error">Path is not a directory</p>
                            )}
                        </div>

                        {/* Git Warning Banner */}
                        {showGitWarning && (
                            <div className="p-4 bg-warning/10 border border-warning/30">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle size="1.25rem" className="text-warning flex-shrink-0 mt-0.5" />
                                    <div className="flex-1">
                                        <h3 className="text-sm font-semibold text-base-content mb-1">Not a Git Repository</h3>
                                        <p className="text-sm text-muted mb-3">
                                            This directory is not under git version control. The agent may make changes that cannot be recovered. We recommend
                                            initializing a git repository first.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={handleInitGit}
                                            disabled={isInitializingGit}
                                            className={`px-4 py-2 text-sm font-medium transition-all ${
                                                isInitializingGit
                                                    ? "bg-base-200/40 text-base-content/50 cursor-not-allowed"
                                                    : "bg-base-200 text-base-content hover:bg-base-300 cursor-pointer"
                                            }`}
                                        >
                                            {isInitializingGit ? (
                                                <>
                                                    <Loader2 size="1em" className="inline animate-spin mr-2" />
                                                    Initializing...
                                                </>
                                            ) : (
                                                <>
                                                    <GitBranch size="1em" className="inline mr-2" />
                                                    Initialize Git Repository
                                                </>
                                            )}
                                        </button>
                                        {initGitError && <p className="mt-2 text-sm text-error">{initGitError}</p>}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Git repo success indicator */}
                        {hasValidDirectory && isGitRepo && !isValidating && (
                            <div className="p-3 bg-success/10 border border-success/30">
                                <div className="flex items-center gap-2">
                                    <GitBranch size="1em" className="text-success" />
                                    <span className="text-sm text-base-content">Git repository detected (default branch: {gitInfo.mainBranch})</span>
                                </div>
                            </div>
                        )}

                        {/* Validating indicator */}
                        {isValidating && (
                            <div className="flex items-center gap-2 text-muted">
                                <Loader2 size="1em" className="animate-spin" />
                                <span className="text-sm">Checking directory...</span>
                            </div>
                        )}

                        {/* Submit Button */}
                        <div className="flex flex-col sm:flex-row gap-3 mt-2">
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={!canSubmit}
                                className={`flex-1 flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium transition-all ${
                                    !canSubmit
                                        ? "bg-primary/40 text-primary-content/50 cursor-not-allowed"
                                        : "bg-primary text-primary-content hover:bg-primary/90 cursor-pointer"
                                }`}
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 size="1em" className="animate-spin" />
                                        Adding...
                                    </>
                                ) : (
                                    <>
                                        <FolderPlus size="1em" />
                                        Add Workspace
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </ScrollArea>
    )
})
