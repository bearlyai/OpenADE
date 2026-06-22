import { AlertTriangle, FlaskConical, FolderOpen, FolderPlus, GitBranch, Loader2 } from "lucide-react"
import { observer } from "mobx-react"
import { useEffect, useRef, useState } from "react"
import { OPENADE_METHOD, type OpenADEMethod } from "../../../openade-client/src"
import { ScrollArea } from "../components/ui"
import { getFileName, slugify } from "../components/utils/paths"
import { type IsGitDirectoryResponse, type ResolvePathResponse, initGit, isGitApiAvailable, isGitDirectory, resolvePath } from "../electronAPI/git"
import { getPathSeparator } from "../electronAPI/platform"
import { createDirectory, isDirectorySelectionAvailable, selectDirectory } from "../electronAPI/shell"
import { useCodeNavigate } from "../routing"
import { useCodeStore } from "../store/context"

type WorkspaceMode = "existing" | "new" | "prototype"
const CORE_REPO_CREATE_METHODS = [OPENADE_METHOD.repoCreate, OPENADE_METHOD.repoPathInspect] as const

export const WorkspaceCreatePage = observer(() => {
    const codeStore = useCodeStore()
    const navigate = useCodeNavigate()
    const inputRef = useRef<HTMLInputElement>(null)
    const [, bumpCoreRepoCapabilityRevision] = useState(0)

    // Mode state
    const [mode, setMode] = useState<WorkspaceMode>("existing")

    // Existing directory state
    const [inputValue, setInputValue] = useState("")
    const [isValidating, setIsValidating] = useState(false)
    const [pathInfo, setPathInfo] = useState<ResolvePathResponse | null>(null)
    const [gitInfo, setGitInfo] = useState<IsGitDirectoryResponse | null>(null)
    const [isInitializingGit, setIsInitializingGit] = useState(false)
    const [initGitError, setInitGitError] = useState<string | null>(null)

    // New directory state
    const [newDirParent, setNewDirParent] = useState("")
    const [newDirName, setNewDirName] = useState("")
    const [parentPathInfo, setParentPathInfo] = useState<ResolvePathResponse | null>(null)
    const [isValidatingParent, setIsValidatingParent] = useState(false)

    // Prototype state
    const [prototypeName, setPrototypeName] = useState("")

    // Submit state
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    const useRuntimeProductAPI = codeStore.shouldUseRuntimeProductAPI()
    const coreOwnsRepoHostCreation = codeStore.usesCoreOwnedProductRuntime()
    const canCreateRepo = codeStore.canUseProductMethod(OPENADE_METHOD.repoCreate)
    const canInspectRepoPath = codeStore.canUseProductMethod(OPENADE_METHOD.repoPathInspect)

    const canUseRepoMethodAfterConnect = async (method: OpenADEMethod): Promise<boolean> => {
        if (coreOwnsRepoHostCreation) return codeStore.canUseProductMethodAfterConnect(method)
        return codeStore.canUseProductMethod(method)
    }

    useEffect(() => {
        if (!coreOwnsRepoHostCreation || useRuntimeProductAPI) return
        let cancelled = false
        void codeStore
            .ensureCoreOwnedProductMethodsAvailable(CORE_REPO_CREATE_METHODS)
            .catch((err: unknown) => {
                console.warn("[WorkspaceCreatePage] Failed to load Core repo creation capabilities:", err)
            })
            .finally(() => {
                if (!cancelled) bumpCoreRepoCapabilityRevision((revision) => revision + 1)
            })

        return () => {
            cancelled = true
        }
    }, [codeStore, coreOwnsRepoHostCreation, useRuntimeProductAPI])

    // Auto-focus input on mount and mode change
    useEffect(() => {
        inputRef.current?.focus()
    }, [mode])

    // Reset mode-specific state on mode change
    const handleModeChange = (newMode: WorkspaceMode) => {
        setMode(newMode)
        setSubmitError(null)
        // Reset existing directory state
        setInputValue("")
        setPathInfo(null)
        setGitInfo(null)
        setInitGitError(null)
        // Reset new directory state
        setNewDirParent("")
        setNewDirName("")
        setParentPathInfo(null)
        // Reset prototype state
        setPrototypeName("")
    }

    // Debounced path validation for existing directory
    useEffect(() => {
        if (mode !== "existing" || !inputValue.trim()) {
            setPathInfo(null)
            setGitInfo(null)
            setIsValidating(false)
            return
        }

        let cancelled = false
        const candidatePath = inputValue.trim()
        const timer = setTimeout(async () => {
            setIsValidating(true)
            setInitGitError(null)

            try {
                if (coreOwnsRepoHostCreation) {
                    const canInspect = await codeStore.canUseProductMethodAfterConnect(OPENADE_METHOD.repoPathInspect)
                    if (cancelled) return
                    if (!canInspect) {
                        setPathInfo(null)
                        setGitInfo(null)
                        return
                    }
                    const inspected = await codeStore.inspectProductRepoPath({ path: candidatePath })
                    if (cancelled) return
                    setPathInfo({
                        resolvedPath: inspected.resolvedPath,
                        exists: inspected.exists,
                        isDirectory: inspected.isDirectory,
                    })
                    setGitInfo(
                        inspected.isGitRepo
                            ? {
                                  isGitDirectory: true,
                                  repoRoot: inspected.repoRoot ?? inspected.resolvedPath,
                                  relativePath: inspected.relativePath ?? "",
                                  mainBranch: inspected.mainBranch ?? "main",
                                  hasGhCli: inspected.hasGhCli ?? false,
                              }
                            : {
                                  isGitDirectory: false,
                                  error: inspected.error,
                              }
                    )
                    return
                }

                if (!isGitApiAvailable()) {
                    setPathInfo(null)
                    setGitInfo(null)
                    return
                }
                const resolved = await resolvePath({ path: candidatePath })
                if (cancelled) return
                setPathInfo(resolved)

                if (resolved.exists && resolved.isDirectory) {
                    const git = await isGitDirectory({ directory: resolved.resolvedPath })
                    if (cancelled) return
                    setGitInfo(git)
                } else {
                    setGitInfo(null)
                }
            } catch (error) {
                if (cancelled) return
                console.error("[WorkspaceCreatePage] Error validating path:", error)
                setPathInfo(null)
                setGitInfo(null)
            } finally {
                if (!cancelled) setIsValidating(false)
            }
        }, 300)

        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [codeStore, coreOwnsRepoHostCreation, inputValue, mode])

    // Debounced path validation for new directory parent
    useEffect(() => {
        if (mode !== "new" || !newDirParent.trim()) {
            setParentPathInfo(null)
            setIsValidatingParent(false)
            return
        }

        let cancelled = false
        const candidatePath = newDirParent.trim()
        const timer = setTimeout(async () => {
            setIsValidatingParent(true)

            try {
                if (coreOwnsRepoHostCreation) {
                    const canInspect = await codeStore.canUseProductMethodAfterConnect(OPENADE_METHOD.repoPathInspect)
                    if (cancelled) return
                    if (!canInspect) {
                        setParentPathInfo(null)
                        return
                    }
                    const inspected = await codeStore.inspectProductRepoPath({ path: candidatePath })
                    if (cancelled) return
                    setParentPathInfo({
                        resolvedPath: inspected.resolvedPath,
                        exists: inspected.exists,
                        isDirectory: inspected.isDirectory,
                    })
                    return
                }

                if (!isGitApiAvailable()) {
                    setParentPathInfo(null)
                    return
                }
                const resolved = await resolvePath({ path: candidatePath })
                if (cancelled) return
                setParentPathInfo(resolved)
            } catch (error) {
                if (cancelled) return
                console.error("[WorkspaceCreatePage] Error validating parent path:", error)
                setParentPathInfo(null)
            } finally {
                if (!cancelled) setIsValidatingParent(false)
            }
        }, 300)

        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [codeStore, coreOwnsRepoHostCreation, newDirParent, mode])

    const handleBrowse = async () => {
        const selected = await selectDirectory()
        if (selected) {
            if (mode === "existing") {
                setInputValue(selected)
            } else if (mode === "new") {
                setNewDirParent(selected)
            }
        }
    }

    const handleInitGit = async () => {
        if (!pathInfo?.resolvedPath) return
        if (coreOwnsRepoHostCreation) return

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

    // Prototype derived values
    const protoSlug = slugify(prototypeName)
    const protoDate = new Date().toISOString().slice(0, 10)
    const protoDirName = protoSlug ? `${protoDate}-${protoSlug}` : ""
    const protoFullPath = protoDirName ? `~/.openade/prototypes/${protoDirName}` : ""
    const handleSubmit = async () => {
        if (!(await canUseRepoMethodAfterConnect(OPENADE_METHOD.repoCreate))) return
        const canInspectPath = await canUseRepoMethodAfterConnect(OPENADE_METHOD.repoPathInspect)
        if (coreOwnsRepoHostCreation && !canInspectPath) return

        setIsSubmitting(true)
        setSubmitError(null)

        try {
            if (mode === "existing") {
                const pathToUse = pathInfo?.resolvedPath || inputValue.trim()
                if (!pathToUse) return

                const name = getFileName(pathToUse) || "Workspace"
                const repo = await codeStore.repos.addRepo({
                    name,
                    path: pathToUse,
                    initializeGit: coreOwnsRepoHostCreation && Boolean(showGitWarning),
                })
                if (repo) {
                    navigate.go("CodeWorkspace", { workspaceId: repo.id })
                }
            } else if (mode === "new") {
                const parentPath = parentPathInfo?.resolvedPath || newDirParent.trim()
                const folderName = newDirName.trim()
                if (!parentPath || !folderName) return

                const requestedPath = `${parentPath}/${folderName}`
                const fullPath =
                    coreOwnsRepoHostCreation && canInspectPath
                        ? (await codeStore.inspectProductRepoPath({ path: requestedPath })).resolvedPath
                        : (await resolvePath({ path: requestedPath })).resolvedPath

                if (!coreOwnsRepoHostCreation) {
                    const createResult = await createDirectory(fullPath)
                    if (!createResult.success) {
                        setSubmitError(createResult.error || "Failed to create directory")
                        return
                    }

                    const gitResult = await initGit({ directory: fullPath })
                    if (!gitResult.success) {
                        setSubmitError(gitResult.error || "Failed to initialize git repository")
                        return
                    }
                }

                const repo = await codeStore.repos.addRepo({
                    name: folderName,
                    path: fullPath,
                    createDirectory: coreOwnsRepoHostCreation,
                    initializeGit: coreOwnsRepoHostCreation,
                })
                if (repo) {
                    navigate.go("CodeWorkspace", { workspaceId: repo.id })
                }
            } else if (mode === "prototype") {
                if (!protoSlug) return

                const fullPath =
                    coreOwnsRepoHostCreation && canInspectPath
                        ? (await codeStore.inspectProductRepoPath({ path: protoFullPath })).resolvedPath
                        : (await resolvePath({ path: protoFullPath })).resolvedPath

                if (!coreOwnsRepoHostCreation) {
                    const createResult = await createDirectory(fullPath)
                    if (!createResult.success) {
                        setSubmitError(createResult.error || "Failed to create directory")
                        return
                    }

                    // Best-effort git init — prototypes work without git
                    try {
                        await initGit({ directory: fullPath })
                    } catch {
                        // ignore
                    }
                }

                const repo = await codeStore.repos.addRepo({
                    name: prototypeName.trim(),
                    path: fullPath,
                    createDirectory: coreOwnsRepoHostCreation,
                })
                if (repo) {
                    navigate.go("CodeWorkspace", { workspaceId: repo.id })
                }
            }
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "An error occurred")
        } finally {
            setIsSubmitting(false)
        }
    }

    // Derived state
    const canBrowseDirectories = isDirectorySelectionAvailable()
    const hasValidDirectory = pathInfo?.exists && pathInfo?.isDirectory
    const isGitRepo = gitInfo && "isGitDirectory" in gitInfo && gitInfo.isGitDirectory
    const showGitWarning = hasValidDirectory && !isGitRepo && !isValidating

    const hasValidParent = parentPathInfo?.exists && parentPathInfo?.isDirectory
    const hasValidNewDirName = newDirName.trim().length > 0 && !newDirName.includes("/") && !newDirName.includes("\\")

    let canSubmit = false
    if (mode === "existing") {
        canSubmit = canCreateRepo && (!coreOwnsRepoHostCreation || canInspectRepoPath) && Boolean(hasValidDirectory) && !isValidating && !isSubmitting
    } else if (mode === "new") {
        canSubmit =
            canCreateRepo && (!coreOwnsRepoHostCreation || canInspectRepoPath) && Boolean(hasValidParent) && hasValidNewDirName && !isValidatingParent && !isSubmitting
    } else if (mode === "prototype") {
        canSubmit = canCreateRepo && (!coreOwnsRepoHostCreation || canInspectRepoPath) && protoSlug.length > 0 && !isSubmitting
    }

    const submitLabel = mode === "existing" ? "Add Workspace" : mode === "new" ? "Create Workspace" : "Create Prototype"
    const submittingLabel = mode === "existing" ? "Adding..." : "Creating..."

    return (
        <ScrollArea className="h-full" viewportClassName="p-0">
            <div className="flex flex-col items-center pt-12 p-8">
                <div className="w-full max-w-2xl">
                    <div className="mb-8">
                        <h1 className="text-2xl font-semibold text-base-content mb-2">Add Workspace</h1>
                        <p className="text-muted">Add a local directory to work on.</p>
                    </div>

                    {/* Mode Selector */}
                    <div className="flex mb-6">
                        <button
                            type="button"
                            onClick={() => handleModeChange("existing")}
                            className={`btn flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium border transition-all cursor-pointer ${
                                mode === "existing"
                                    ? "bg-primary/10 text-primary border-primary z-10"
                                    : "bg-base-200 text-muted border-border hover:bg-base-300"
                            }`}
                        >
                            <FolderOpen size="1em" />
                            Existing Directory
                        </button>
                        <button
                            type="button"
                            onClick={() => handleModeChange("new")}
                            className={`btn flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium border -ml-px transition-all cursor-pointer ${
                                mode === "new" ? "bg-primary/10 text-primary border-primary z-10" : "bg-base-200 text-muted border-border hover:bg-base-300"
                            }`}
                        >
                            <FolderPlus size="1em" />
                            New Directory
                        </button>
                        <button
                            type="button"
                            onClick={() => handleModeChange("prototype")}
                            className={`btn flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium border -ml-px transition-all cursor-pointer ${
                                mode === "prototype"
                                    ? "bg-primary/10 text-primary border-primary z-10"
                                    : "bg-base-200 text-muted border-border hover:bg-base-300"
                            }`}
                        >
                            <FlaskConical size="1em" />
                            Prototype
                        </button>
                    </div>

                    <div className="flex flex-col gap-4">
                        {/* Existing Directory Mode */}
                        {mode === "existing" && (
                            <>
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
                                        {canBrowseDirectories && (
                                            <button
                                                type="button"
                                                onClick={handleBrowse}
                                                className="btn px-4 py-3 bg-base-200 text-base-content border border-border hover:bg-base-300 transition-all cursor-pointer flex items-center gap-2"
                                            >
                                                <FolderOpen size="1em" />
                                                Browse
                                            </button>
                                        )}
                                    </div>
                                    {pathInfo && pathInfo.resolvedPath !== inputValue.trim() && (
                                        <p className="mt-1 text-xs text-muted">Resolves to: {pathInfo.resolvedPath}</p>
                                    )}
                                    {inputValue.trim() && !isValidating && pathInfo && !pathInfo.exists && (
                                        <p className="mt-1 text-xs text-error">Directory does not exist</p>
                                    )}
                                    {inputValue.trim() && !isValidating && pathInfo && pathInfo.exists && !pathInfo.isDirectory && (
                                        <p className="mt-1 text-xs text-error">Path is not a directory</p>
                                    )}
                                </div>

                                {showGitWarning && (
                                    <div className="p-4 bg-warning/10 border border-warning/30">
                                        <div className="flex items-start gap-3">
                                            <AlertTriangle size="1.25rem" className="text-warning flex-shrink-0 mt-0.5" />
                                            <div className="flex-1">
                                                <h3 className="text-sm font-semibold text-base-content mb-1">Not a Git Repository</h3>
                                                <p className="text-sm text-muted mb-3">
                                                    This directory is not under git version control. The agent may make changes that cannot be recovered. We
                                                    recommend initializing a git repository first.
                                                    {coreOwnsRepoHostCreation ? " OpenADE Core will initialize one when you add this workspace." : ""}
                                                </p>
                                                {!coreOwnsRepoHostCreation && (
                                                    <button
                                                        type="button"
                                                        onClick={handleInitGit}
                                                        disabled={isInitializingGit}
                                                        className={`btn px-4 py-2 text-sm font-medium transition-all ${
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
                                                )}
                                                {initGitError && <p className="mt-2 text-sm text-error">{initGitError}</p>}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {hasValidDirectory && isGitRepo && !isValidating && (
                                    <div className="p-3 bg-success/10 border border-success/30">
                                        <div className="flex items-center gap-2">
                                            <GitBranch size="1em" className="text-success" />
                                            <span className="text-sm text-base-content">Git repository detected (default branch: {gitInfo.mainBranch})</span>
                                        </div>
                                    </div>
                                )}

                                {isValidating && (
                                    <div className="flex items-center gap-2 text-muted">
                                        <Loader2 size="1em" className="animate-spin" />
                                        <span className="text-sm">Checking directory...</span>
                                    </div>
                                )}
                            </>
                        )}

                        {/* New Directory Mode */}
                        {mode === "new" && (
                            <>
                                <div>
                                    <label htmlFor="new-dir-parent" className="block text-sm font-medium text-base-content mb-2">
                                        Parent Directory
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            id="new-dir-parent"
                                            ref={inputRef}
                                            type="text"
                                            value={newDirParent}
                                            onChange={(e) => setNewDirParent(e.target.value)}
                                            placeholder="~/Projects"
                                            className="flex-1 px-4 py-3 bg-input text-base-content border border-border focus:outline-none focus:border-primary transition-all placeholder:text-muted/50"
                                        />
                                        {canBrowseDirectories && (
                                            <button
                                                type="button"
                                                onClick={handleBrowse}
                                                className="btn px-4 py-3 bg-base-200 text-base-content border border-border hover:bg-base-300 transition-all cursor-pointer flex items-center gap-2"
                                            >
                                                <FolderOpen size="1em" />
                                                Browse
                                            </button>
                                        )}
                                    </div>
                                    {parentPathInfo && parentPathInfo.resolvedPath !== newDirParent.trim() && (
                                        <p className="mt-1 text-xs text-muted">Resolves to: {parentPathInfo.resolvedPath}</p>
                                    )}
                                    {newDirParent.trim() && !isValidatingParent && parentPathInfo && !parentPathInfo.exists && (
                                        <p className="mt-1 text-xs text-error">Directory does not exist</p>
                                    )}
                                    {newDirParent.trim() && !isValidatingParent && parentPathInfo && parentPathInfo.exists && !parentPathInfo.isDirectory && (
                                        <p className="mt-1 text-xs text-error">Path is not a directory</p>
                                    )}
                                </div>

                                <div>
                                    <label htmlFor="new-dir-name" className="block text-sm font-medium text-base-content mb-2">
                                        Folder Name
                                    </label>
                                    <input
                                        id="new-dir-name"
                                        type="text"
                                        value={newDirName}
                                        onChange={(e) => setNewDirName(e.target.value)}
                                        placeholder="my-new-project"
                                        className="w-full px-4 py-3 bg-input text-base-content border border-border focus:outline-none focus:border-primary transition-all placeholder:text-muted/50"
                                    />
                                    {newDirName && (newDirName.includes("/") || newDirName.includes("\\")) && (
                                        <p className="mt-1 text-xs text-error">Folder name cannot contain slashes</p>
                                    )}
                                    {hasValidParent && hasValidNewDirName && (
                                        <p className="mt-1 text-xs text-muted">
                                            Will create: {parentPathInfo?.resolvedPath}
                                            {getPathSeparator()}
                                            {newDirName.trim()}
                                        </p>
                                    )}
                                </div>

                                {isValidatingParent && (
                                    <div className="flex items-center gap-2 text-muted">
                                        <Loader2 size="1em" className="animate-spin" />
                                        <span className="text-sm">Checking directory...</span>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Prototype Mode */}
                        {mode === "prototype" && (
                            <div>
                                <label htmlFor="prototype-name" className="block text-sm font-medium text-base-content mb-2">
                                    Prototype Name
                                </label>
                                <input
                                    id="prototype-name"
                                    ref={inputRef}
                                    type="text"
                                    value={prototypeName}
                                    onChange={(e) => setPrototypeName(e.target.value)}
                                    placeholder="My cool idea"
                                    className="w-full px-4 py-3 bg-input text-base-content border border-border focus:outline-none focus:border-primary transition-all placeholder:text-muted/50"
                                />
                                {protoFullPath && <p className="mt-1 text-xs text-muted">{protoFullPath}</p>}
                            </div>
                        )}

                        {/* Submit Error */}
                        {submitError && <p className="text-sm text-error">{submitError}</p>}

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
                                        {submittingLabel}
                                    </>
                                ) : (
                                    <>
                                        {mode === "prototype" ? <FlaskConical size="1em" /> : <FolderPlus size="1em" />}
                                        {submitLabel}
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
