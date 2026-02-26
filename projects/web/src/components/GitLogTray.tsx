import { FileCode, GitBranch, GitCommitHorizontal, RefreshCw } from "lucide-react"
import { observer } from "mobx-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { twMerge } from "tailwind-merge"
import { type ChangedFileInfo, type GitLogEntry, type WorkTreeInfo, gitApi } from "../electronAPI/git"
import { useCodeStore } from "../store/context"
import { FileViewer, MultiFileDiffViewer } from "./FilesAndDiffs"
import { FileListItem, StatusIcon, type ViewMode, ViewModeToggle } from "./git/shared"
import { Select } from "./ui/Select"
import { getDisambiguatedPaths } from "./utils/paths"

const PAGE_SIZE = 50
const FILE_CHIP_THRESHOLD = 7

interface GitLogTrayProps {
    workDir: string
    currentBranch: string | null
    className?: string
}

interface ScopeOption {
    id: string
    content: ReactNode
    workDir: string
    ref?: string
}

interface FileSelectEntry {
    id: string
    content: ReactNode
}

function getPathBaseName(value: string): string {
    const parts = value.split(/[\\/]/).filter(Boolean)
    return parts[parts.length - 1] ?? value
}

function formatWorktreeBranch(branch: string): string {
    return branch.replace(/^refs\/heads\//, "")
}

function buildScopeOptions(workDir: string, branches: { name: string }[], worktrees: WorkTreeInfo[]): ScopeOption[] {
    const branchNames = new Set<string>()
    const branchOptions: ScopeOption[] = []

    const addBranch = (name: string) => {
        if (branchNames.has(name)) return
        branchNames.add(name)
        branchOptions.push({
            id: `branch:${name}`,
            workDir,
            ref: name,
            content: (
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] uppercase tracking-wide text-muted flex-shrink-0">Branch</span>
                    <span className="truncate">{name}</span>
                </div>
            ),
        })
    }

    addBranch("HEAD")
    for (const branch of branches) {
        addBranch(branch.name)
    }

    const worktreeOptions: ScopeOption[] = worktrees.map((worktree) => {
        const branch = formatWorktreeBranch(worktree.branch)
        return {
            id: `worktree:${worktree.id}`,
            workDir: worktree.path,
            content: (
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] uppercase tracking-wide text-muted flex-shrink-0">Worktree</span>
                    <span className="truncate">{getPathBaseName(worktree.path)}</span>
                    {branch && <span className="truncate text-muted">({branch})</span>}
                </div>
            ),
        }
    })

    return [...branchOptions, ...worktreeOptions]
}

export const GitLogTray = observer(function GitLogTray({ workDir, currentBranch, className }: GitLogTrayProps) {
    const codeStore = useCodeStore()

    const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>([])
    const [scopeLoading, setScopeLoading] = useState(false)
    const [scopeRefreshToken, setScopeRefreshToken] = useState(0)
    const [selectedScopeId, setSelectedScopeId] = useState<string>("branch:HEAD")

    const [commits, setCommits] = useState<GitLogEntry[]>([])
    const [logLoading, setLogLoading] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(false)
    const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null)
    const [logError, setLogError] = useState<string | null>(null)

    const [commitFiles, setCommitFiles] = useState<ChangedFileInfo[]>([])
    const [commitFilesLoading, setCommitFilesLoading] = useState(false)
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
    const [filePair, setFilePair] = useState<{ before: string; after: string; tooLarge?: boolean } | null>(null)
    const [fileLoading, setFileLoading] = useState(false)
    const [fileError, setFileError] = useState<string | null>(null)

    const viewMode = codeStore.ui.viewMode
    const setViewMode = (mode: ViewMode) => codeStore.ui.setViewMode(mode)

    const selectedScope = useMemo(() => scopeOptions.find((option) => option.id === selectedScopeId) ?? null, [scopeOptions, selectedScopeId])

    const selectedCommit = useMemo(() => commits.find((commit) => commit.sha === selectedCommitSha) ?? null, [commits, selectedCommitSha])

    const selectedFile = useMemo(() => {
        if (commitFiles.length === 0) return null
        if (!selectedFilePath) return commitFiles[0]
        return commitFiles.find((file) => file.path === selectedFilePath) ?? commitFiles[0]
    }, [commitFiles, selectedFilePath])

    const shortCommitPaths = useMemo(() => {
        const allPaths: string[] = []
        const seen = new Set<string>()

        for (const file of commitFiles) {
            if (!seen.has(file.path)) {
                seen.add(file.path)
                allPaths.push(file.path)
            }
            if (file.oldPath && !seen.has(file.oldPath)) {
                seen.add(file.oldPath)
                allPaths.push(file.oldPath)
            }
        }

        return getDisambiguatedPaths(allPaths)
    }, [commitFiles])

    const useFileSelect = commitFiles.length > FILE_CHIP_THRESHOLD

    const fileSelectEntries = useMemo<FileSelectEntry[]>(() => {
        return commitFiles.map((file) => {
            const shortPath = shortCommitPaths.get(file.path) ?? file.path
            const shortOldPath = file.oldPath ? (shortCommitPaths.get(file.oldPath) ?? file.oldPath) : null

            return {
                id: file.path,
                content: (
                    <div className="flex items-center gap-1.5 min-w-0">
                        <StatusIcon status={file.status} />
                        {shortOldPath ? (
                            <span className="truncate">
                                <span className="text-muted">{shortOldPath}</span>
                                <span className="mx-1">→</span>
                                {shortPath}
                            </span>
                        ) : (
                            <span className="truncate">{shortPath}</span>
                        )}
                    </div>
                ),
            }
        })
    }, [commitFiles, shortCommitPaths])

    useEffect(() => {
        let cancelled = false
        setScopeLoading(true)

        async function loadScopes() {
            try {
                const [branchesResult, worktreesResult] = await Promise.all([
                    gitApi.listBranches({ repoDir: workDir, includeRemote: true }),
                    gitApi.listWorkTrees({ repoDir: workDir }),
                ])
                if (cancelled) return

                const options = buildScopeOptions(workDir, branchesResult.branches, worktreesResult.worktrees)
                setScopeOptions(options)
                setSelectedScopeId((previousId) => {
                    if (options.some((option) => option.id === previousId)) {
                        return previousId
                    }

                    const preferredBranch = currentBranch ? `branch:${currentBranch}` : "branch:HEAD"
                    if (options.some((option) => option.id === preferredBranch)) {
                        return preferredBranch
                    }

                    return options[0]?.id ?? "branch:HEAD"
                })
            } catch (error) {
                console.error("[GitLogTray] Failed to load branch/worktree scopes:", error)
                if (cancelled) return
                const fallback = buildScopeOptions(workDir, [], [])
                setScopeOptions(fallback)
                setSelectedScopeId(fallback[0]?.id ?? "branch:HEAD")
            } finally {
                if (!cancelled) {
                    setScopeLoading(false)
                }
            }
        }

        loadScopes()
        return () => {
            cancelled = true
        }
    }, [workDir, currentBranch, scopeRefreshToken])

    useEffect(() => {
        const scope = selectedScope
        if (!scope) {
            setCommits([])
            setHasMore(false)
            setSelectedCommitSha(null)
            return
        }

        let cancelled = false
        setLogLoading(true)
        setLogError(null)
        setCommits([])
        setHasMore(false)
        setSelectedCommitSha(null)

        async function loadLog(scopeValue: ScopeOption) {
            try {
                const result = await gitApi.getLog({
                    workDir: scopeValue.workDir,
                    ref: scopeValue.ref,
                    limit: PAGE_SIZE,
                    skip: 0,
                })
                if (cancelled) return
                setCommits(result.commits)
                setHasMore(result.hasMore)
                setSelectedCommitSha((prev) => {
                    if (prev && result.commits.some((commit) => commit.sha === prev)) {
                        return prev
                    }
                    return result.commits[0]?.sha ?? null
                })
            } catch (error) {
                console.error("[GitLogTray] Failed to load commit log:", error)
                if (cancelled) return
                setCommits([])
                setHasMore(false)
                setSelectedCommitSha(null)
                setLogError("Failed to load commit history")
            } finally {
                if (!cancelled) {
                    setLogLoading(false)
                }
            }
        }

        loadLog(scope)
        return () => {
            cancelled = true
        }
    }, [selectedScope])

    useEffect(() => {
        const scope = selectedScope
        const commit = selectedCommit
        if (!scope || !commit) {
            setCommitFiles([])
            setSelectedFilePath(null)
            setFilePair(null)
            return
        }

        let cancelled = false
        setCommitFilesLoading(true)
        setFilePair(null)
        setFileError(null)

        async function loadCommitFiles(scopeValue: ScopeOption, commitValue: GitLogEntry) {
            try {
                const result = await gitApi.getCommitFiles({
                    workDir: scopeValue.workDir,
                    commit: commitValue.sha,
                })
                if (cancelled) return
                setCommitFiles(result.files)
            } catch (error) {
                console.error("[GitLogTray] Failed to load commit files:", error)
                if (cancelled) return
                setCommitFiles([])
                setFileError("Failed to load changed files for commit")
            } finally {
                if (!cancelled) {
                    setCommitFilesLoading(false)
                }
            }
        }

        loadCommitFiles(scope, commit)
        return () => {
            cancelled = true
        }
    }, [selectedScope, selectedCommit])

    useEffect(() => {
        setSelectedFilePath((previousPath) => {
            if (commitFiles.length === 0) return null
            if (previousPath && commitFiles.some((file) => file.path === previousPath)) {
                return previousPath
            }
            return commitFiles[0].path
        })
    }, [commitFiles])

    useEffect(() => {
        const scope = selectedScope
        const commit = selectedCommit
        const file = selectedFile
        if (!scope || !commit || !file) {
            setFilePair(null)
            return
        }

        if (file.binary) {
            setFilePair(null)
            return
        }

        let cancelled = false
        setFileLoading(true)
        setFileError(null)

        async function loadFilePair(scopeValue: ScopeOption, commitValue: GitLogEntry, fileValue: ChangedFileInfo) {
            try {
                const beforeTreeish = commitValue.parentCount === 0 ? null : `${commitValue.sha}^`
                const beforePath = fileValue.oldPath ?? fileValue.path

                const [beforeResult, afterResult] = await Promise.all([
                    beforeTreeish
                        ? gitApi.getFileAtTreeish({
                              workDir: scopeValue.workDir,
                              treeish: beforeTreeish,
                              filePath: beforePath,
                          })
                        : Promise.resolve({ content: "", exists: false, tooLarge: false }),
                    gitApi.getFileAtTreeish({
                        workDir: scopeValue.workDir,
                        treeish: commitValue.sha,
                        filePath: fileValue.path,
                    }),
                ])

                if (cancelled) return

                if (beforeResult.tooLarge || afterResult.tooLarge) {
                    setFilePair({ before: "", after: "", tooLarge: true })
                    return
                }

                setFilePair({
                    before: beforeResult.content,
                    after: afterResult.content,
                })
            } catch (error) {
                console.error("[GitLogTray] Failed to load file content at commit:", error)
                if (cancelled) return
                setFilePair(null)
                setFileError("Failed to load file content for diff")
            } finally {
                if (!cancelled) {
                    setFileLoading(false)
                }
            }
        }

        loadFilePair(scope, commit, file)
        return () => {
            cancelled = true
        }
    }, [selectedScope, selectedCommit, selectedFile])

    const refresh = () => {
        setScopeRefreshToken((value) => value + 1)
    }

    const loadMore = async () => {
        if (!selectedScope || loadingMore || logLoading || !hasMore) {
            return
        }

        setLoadingMore(true)
        try {
            const result = await gitApi.getLog({
                workDir: selectedScope.workDir,
                ref: selectedScope.ref,
                limit: PAGE_SIZE,
                skip: commits.length,
            })
            setCommits((previous) => [...previous, ...result.commits])
            setHasMore(result.hasMore)
        } catch (error) {
            console.error("[GitLogTray] Failed to load more commits:", error)
            setLogError("Failed to load more commits")
        } finally {
            setLoadingMore(false)
        }
    }

    return (
        <div className={twMerge("flex flex-col h-full", className)}>
            <div className="px-3 py-2 border-b border-border flex items-center gap-2 justify-between bg-base-200">
                <Select
                    selectedId={selectedScopeId}
                    entries={scopeOptions}
                    onSelect={(entry) => setSelectedScopeId(entry.id)}
                    disabled={scopeLoading || scopeOptions.length === 0}
                    className={{
                        trigger: "h-8 px-2 text-xs border border-border bg-base-100 hover:bg-base-200 transition-colors min-w-[16rem]",
                        value: "text-xs truncate",
                    }}
                />
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={refresh}
                        className="btn p-1 text-muted hover:text-base-content hover:bg-base-300 transition-colors"
                        title="Refresh history"
                        disabled={scopeLoading || logLoading}
                    >
                        <RefreshCw size={14} />
                    </button>
                    <ViewModeToggle value={viewMode} onChange={setViewMode} />
                </div>
            </div>
            <div className="flex-1 min-h-0 flex">
                <div className="w-72 border-r border-border bg-base-200 flex flex-col">
                    <div className="px-3 py-2 border-b border-border text-xs text-muted flex items-center gap-1">
                        <GitCommitHorizontal size={12} />
                        Commits
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {logLoading && commits.length === 0 ? (
                            <div className="py-12 text-center text-sm text-muted">Loading commits...</div>
                        ) : commits.length === 0 ? (
                            <div className="py-12 text-center text-sm text-muted">No commits found.</div>
                        ) : (
                            <div className="flex flex-col py-1">
                                {commits.map((commit) => {
                                    const selected = commit.sha === selectedCommit?.sha
                                    return (
                                        <button
                                            key={commit.sha}
                                            type="button"
                                            onClick={() => setSelectedCommitSha(commit.sha)}
                                            className={twMerge(
                                                "btn text-left px-3 py-2 border-b border-border/40 transition-colors",
                                                selected ? "bg-primary/10 text-base-content" : "text-muted hover:text-base-content hover:bg-base-300"
                                            )}
                                            title={`${commit.shortSha} ${commit.message}`}
                                        >
                                            <div className="font-mono text-xs text-muted">{commit.shortSha}</div>
                                            <div className="text-sm truncate">{commit.message}</div>
                                            <div className="text-xs text-muted truncate mt-0.5">
                                                {commit.author} · {commit.relativeDate}
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                    {hasMore && (
                        <div className="p-2 border-t border-border">
                            <button
                                type="button"
                                onClick={loadMore}
                                disabled={loadingMore}
                                className="btn w-full h-8 flex items-center justify-center text-xs border border-border bg-base-100 hover:bg-base-300 transition-colors disabled:opacity-60"
                            >
                                {loadingMore ? "Loading..." : "Load more"}
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col">
                    {selectedCommit ? (
                        <>
                            <div className="px-3 py-2 border-b border-border text-sm bg-base-200 flex items-center justify-between gap-2">
                                <div className="truncate">
                                    <span className="font-mono text-xs text-muted mr-2">{selectedCommit.shortSha}</span>
                                    <span>{selectedCommit.message}</span>
                                </div>
                                <div className="text-xs text-muted flex items-center gap-1 flex-shrink-0">
                                    <GitBranch size={12} />
                                    <span>{selectedCommit.author}</span>
                                </div>
                            </div>
                            {commitFilesLoading ? (
                                <div className="flex-1 flex items-center justify-center py-12 text-muted text-sm">Loading commit files...</div>
                            ) : commitFiles.length === 0 ? (
                                <div className="flex-1 flex items-center justify-center py-12 text-muted text-sm">No file changes in this commit.</div>
                            ) : (
                                <>
                                    {useFileSelect ? (
                                        <div className="px-2 py-1.5 border-b border-border bg-base-200 flex items-center gap-2">
                                            <span className="text-xs text-muted whitespace-nowrap">{commitFiles.length} files</span>
                                            <Select
                                                selectedId={selectedFile?.path ?? commitFiles[0]?.path ?? ""}
                                                entries={fileSelectEntries}
                                                onSelect={(entry) => setSelectedFilePath(entry.id)}
                                                className={{
                                                    trigger: "h-8 px-2 text-xs border border-border bg-base-100 hover:bg-base-200 transition-colors flex-1 min-w-0",
                                                    value: "text-xs truncate",
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        <div className="px-2 py-1.5 border-b border-border bg-base-200 max-h-28 overflow-y-auto">
                                            <div className="flex items-center gap-1 flex-wrap">
                                                {commitFiles.map((file) => (
                                                    <FileListItem
                                                        key={`${file.path}:${file.oldPath ?? ""}`}
                                                        file={file}
                                                        displayPath={shortCommitPaths.get(file.path) ?? file.path}
                                                        displayOldPath={file.oldPath ? (shortCommitPaths.get(file.oldPath) ?? file.oldPath) : undefined}
                                                        selected={selectedFile?.path === file.path}
                                                        onSelect={() => setSelectedFilePath(file.path)}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {selectedFile && (
                                        <div className="px-3 py-2 border-b border-border bg-base-100 flex items-center gap-2 text-sm">
                                            <StatusIcon status={selectedFile.status} />
                                            <FileCode size={13} className="text-muted flex-shrink-0" />
                                            <span className="truncate" title={selectedFile.path}>
                                                {selectedFile.oldPath ? (
                                                    <>
                                                        <span className="text-muted">{shortCommitPaths.get(selectedFile.oldPath) ?? selectedFile.oldPath}</span>
                                                        <span className="mx-1">→</span>
                                                        {shortCommitPaths.get(selectedFile.path) ?? selectedFile.path}
                                                    </>
                                                ) : (
                                                    shortCommitPaths.get(selectedFile.path) ?? selectedFile.path
                                                )}
                                            </span>
                                        </div>
                                    )}
                                    <div className="flex-1 min-h-0 overflow-auto">
                                        {fileLoading ? (
                                            <div className="flex items-center justify-center py-12 text-muted text-sm">Loading file...</div>
                                        ) : selectedFile?.binary ? (
                                            <div className="flex items-center justify-center py-12 text-muted text-sm">Binary file — cannot display diff</div>
                                        ) : filePair?.tooLarge ? (
                                            <div className="flex items-center justify-center py-12 text-muted text-sm">Too large to display</div>
                                        ) : selectedFile && filePair ? (
                                            <div className="min-h-full bg-editor-background">
                                                {viewMode === "current" ? (
                                                    <FileViewer
                                                        file={{
                                                            name: selectedFile.path,
                                                            contents: filePair.after,
                                                        }}
                                                        disableFileHeader
                                                        commentHandlers={null}
                                                    />
                                                ) : (
                                                    <MultiFileDiffViewer
                                                        oldFile={{
                                                            name: selectedFile.oldPath ?? selectedFile.path,
                                                            contents: filePair.before,
                                                        }}
                                                        newFile={{
                                                            name: selectedFile.path,
                                                            contents: filePair.after,
                                                        }}
                                                        diffStyle={viewMode}
                                                        expandUnchanged
                                                        expansionLineCount={2}
                                                        disableFileHeader
                                                        commentHandlers={null}
                                                    />
                                                )}
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center py-12 text-muted text-sm">Select a file to view changes</div>
                                        )}
                                    </div>
                                </>
                            )}
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center py-12 text-muted text-sm">Select a commit to view changes</div>
                    )}
                    {(logError || fileError) && <div className="px-3 py-2 border-t border-border text-xs text-error bg-error/5">{logError ?? fileError}</div>}
                </div>
            </div>
        </div>
    )
})
