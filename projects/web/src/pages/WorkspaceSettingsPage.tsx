import { AlertTriangle, ChevronRight, FileText, FolderOpen, GitBranch, Loader2, Save } from "lucide-react"
import { observer } from "mobx-react"
import { useEffect, useState } from "react"
import { ScrollArea } from "../components/ui"
import { type IsGitDirectoryResponse, type ResolvePathResponse, initGit, isGitApiAvailable, isGitDirectory, resolvePath } from "../electronAPI/git"
import { selectDirectory } from "../electronAPI/shell"
import { useCodeNavigate } from "../routing"
import { useCodeStore } from "../store/context"
import type { Repo } from "../types"

interface WorkspaceSettingsPageProps {
    workspaceId: string
    repo: Repo
}

export const WorkspaceSettingsPage = observer(({ workspaceId, repo }: WorkspaceSettingsPageProps) => {
    const codeStore = useCodeStore()
    const navigate = useCodeNavigate()

    // Form state - initialize from repo
    const [name, setName] = useState(repo.name)
    const [inputValue, setInputValue] = useState(repo.path)

    // Validation state
    const [isValidating, setIsValidating] = useState(false)
    const [pathInfo, setPathInfo] = useState<ResolvePathResponse | null>(null)
    const [gitInfo, setGitInfo] = useState<IsGitDirectoryResponse | null>(null)

    // Git init state
    const [isInitializingGit, setIsInitializingGit] = useState(false)
    const [initGitError, setInitGitError] = useState<string | null>(null)

    // Save state
    const [isSaving, setIsSaving] = useState(false)

    // Reset form state when repo changes (e.g., navigating to different workspace)
    useEffect(() => {
        setName(repo.name)
        setInputValue(repo.path)
    }, [repo.id, repo.name, repo.path])

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
                console.error("[WorkspaceSettingsPage] Error validating path:", error)
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

    const handleSave = async () => {
        if (!canSave) return

        setIsSaving(true)
        try {
            const updates: { name?: string; path?: string } = {}

            if (name.trim() !== repo.name) {
                updates.name = name.trim()
            }

            const resolvedPath = pathInfo?.resolvedPath || inputValue.trim()
            const isPathChanging = resolvedPath !== repo.path
            if (isPathChanging) {
                updates.path = resolvedPath
            }

            if (Object.keys(updates).length > 0) {
                await codeStore.repos.updateRepo(workspaceId, updates)

                // Reload the page if path changed to reset repo environment and processes
                if (isPathChanging) {
                    // Sync to disk before reloading to avoid losing changes (storage uses debounced saves)
                    await codeStore.syncRepoStore()
                    window.location.reload()
                }
            }
        } finally {
            setIsSaving(false)
        }
    }

    // Derived state
    const hasCodeModules = isGitApiAvailable()
    const hasValidDirectory = pathInfo?.exists && pathInfo?.isDirectory
    const isGitRepo = gitInfo && "isGitDirectory" in gitInfo && gitInfo.isGitDirectory
    const showGitWarning = hasValidDirectory && !isGitRepo && !isValidating

    // Check if there are changes
    const resolvedPath = pathInfo?.resolvedPath || inputValue.trim()
    const nameChanged = name.trim() !== repo.name
    const pathChanged = resolvedPath !== repo.path
    const hasChanges = nameChanged || pathChanged

    // Can save if: has changes, name is not empty, path is valid (or unchanged)
    const pathIsValid = !pathChanged || (hasValidDirectory && !isValidating)
    const canSave = hasChanges && name.trim().length > 0 && pathIsValid && !isSaving

    return (
        <ScrollArea className="h-full" viewportClassName="p-0">
            <div className="flex flex-col items-center pt-12 p-8">
                <div className="w-full max-w-2xl">
                    <div className="mb-8">
                        <div className="flex items-center gap-3 mb-2">
                            <button
                                type="button"
                                onClick={() => navigate.go("CodeWorkspaceTaskCreate", { workspaceId })}
                                className="bg-transparent border-none text-muted hover:text-base-content transition-colors cursor-pointer"
                            >
                                <ChevronRight size="1.5rem" className="rotate-180" />
                            </button>
                            <h1 className="text-2xl font-semibold text-base-content">Workspace Settings</h1>
                        </div>
                        <p className="text-muted ml-9">
                            Configure settings for <span className="font-medium text-base-content">{repo.name}</span>
                        </p>
                    </div>

                    <div className="flex flex-col gap-6">
                        {/* Workspace Name */}
                        <div>
                            <label htmlFor="workspace-name" className="block text-sm font-medium text-base-content mb-2">
                                Workspace Name
                            </label>
                            <input
                                id="workspace-name"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="My Workspace"
                                className="w-full px-4 py-3 bg-input text-base-content border border-border focus:outline-none focus:border-primary transition-all placeholder:text-muted/50"
                            />
                            {name.trim().length === 0 && <p className="mt-1 text-xs text-error">Name is required</p>}
                        </div>

                        {/* Directory Path */}
                        <div>
                            <label htmlFor="workspace-path" className="block text-sm font-medium text-base-content mb-2">
                                Directory Path
                            </label>
                            <div className="flex gap-2">
                                <input
                                    id="workspace-path"
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

                        {/* Save Button */}
                        <div className="flex flex-col sm:flex-row gap-3 mt-2">
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={!canSave}
                                className={`flex-1 flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium transition-all ${
                                    !canSave
                                        ? "bg-primary/40 text-primary-content/50 cursor-not-allowed"
                                        : "bg-primary text-primary-content hover:bg-primary/90 cursor-pointer"
                                }`}
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2 size="1em" className="animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <Save size="1em" />
                                        Save Changes
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Process Configuration Section */}
                    <div className="border border-border mt-8">
                        <div className="px-4 py-3 bg-base-200 border-b border-border">
                            <span className="text-sm font-medium text-base-content">Process Configuration</span>
                        </div>

                        <div className="p-4">
                            <div className="flex items-start gap-3 p-4 bg-base-100 border border-border rounded">
                                <FileText size={20} className="text-muted flex-shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm text-base-content mb-2">
                                        Processes are configured via <code className="bg-base-200 px-1.5 py-0.5 rounded text-xs">procs.toml</code> files in your
                                        project.
                                    </p>
                                    <p className="text-xs text-muted mb-3">
                                        Create a <code className="bg-base-200 px-1 py-0.5 rounded">procs.toml</code> file in any directory to define processes
                                        for that directory. Setup processes (with <code className="bg-base-200 px-1 py-0.5 rounded">setup = true</code>) run
                                        automatically before other processes.
                                    </p>
                                    <div className="bg-base-200 p-3 rounded font-mono text-xs text-muted">
                                        <div className="text-base-content/70 mb-2"># procs.toml</div>
                                        <div>[[process]]</div>
                                        <div>name = "Install"</div>
                                        <div>command = "npm install"</div>
                                        <div>setup = true</div>
                                        <div className="mt-2">[[process]]</div>
                                        <div>name = "Dev Server"</div>
                                        <div>command = "npm run dev"</div>
                                        <div>url = "http://localhost:3000"</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </ScrollArea>
    )
})
