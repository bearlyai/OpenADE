import { useEffect, useRef, useState } from "react"
import { Archive, ChevronRight, FolderOpen, Loader2, Plus, Server, X } from "lucide-react"
import type { OpenADEProject, OpenADERepoPathInspectResult, OpenADESnapshot } from "../../../../openade-module/src"

export interface ProjectSessionSummary {
    id: string
    host: string
    snapshot: OpenADESnapshot | null
    isActive: boolean
}

export function ProjectsScreen({
    sessions,
    showArchived,
    createProjectLoading,
    onToggleArchived,
    onSelectSession,
    onSelectProject,
    onAddSession,
    onCreateProject,
    onInspectProjectPath,
}: {
    sessions: ProjectSessionSummary[]
    showArchived: boolean
    createProjectLoading: boolean
    onToggleArchived: () => void
    onSelectSession: (sessionId: string) => void
    onSelectProject?: (sessionId: string, repoId: string) => void
    onAddSession: () => void
    onCreateProject?: (project: { name: string; path: string }) => Promise<boolean> | boolean
    onInspectProjectPath?: (path: string) => Promise<OpenADERepoPathInspectResult | null> | OpenADERepoPathInspectResult | null
}) {
    const [showCreateProject, setShowCreateProject] = useState(false)
    const [newProjectName, setNewProjectName] = useState("")
    const [newProjectPath, setNewProjectPath] = useState("")
    const [projectPathInspection, setProjectPathInspection] = useState<OpenADERepoPathInspectResult | null>(null)
    const [projectPathError, setProjectPathError] = useState<string | null>(null)
    const [projectPathInspecting, setProjectPathInspecting] = useState(false)
    const pathInspectionRunRef = useRef(0)
    const canCreateProject = Boolean(onCreateProject)
    const canInspectProjectPath = Boolean(onInspectProjectPath)

    const resetProjectForm = () => {
        pathInspectionRunRef.current += 1
        setNewProjectName("")
        setNewProjectPath("")
        setProjectPathInspection(null)
        setProjectPathError(null)
        setProjectPathInspecting(false)
    }

    useEffect(() => {
        if (!canCreateProject) {
            setShowCreateProject(false)
            pathInspectionRunRef.current += 1
            setNewProjectName("")
            setNewProjectPath("")
            setProjectPathInspection(null)
            setProjectPathError(null)
            setProjectPathInspecting(false)
            return
        }
        if (!canInspectProjectPath) {
            pathInspectionRunRef.current += 1
            setProjectPathInspection(null)
            setProjectPathError(null)
            setProjectPathInspecting(false)
        }
    }, [canCreateProject, canInspectProjectPath])

    const validateProjectPath = async (path: string): Promise<string | null> => {
        if (!onInspectProjectPath) return path
        const runId = pathInspectionRunRef.current + 1
        pathInspectionRunRef.current = runId
        setProjectPathInspecting(true)
        setProjectPathError(null)
        try {
            const inspection = await onInspectProjectPath(path)
            if (pathInspectionRunRef.current !== runId) return null
            setProjectPathInspection(inspection)
            if (!inspection) {
                setProjectPathError("Path inspection is unavailable.")
                return null
            }
            if (inspection.error) {
                setProjectPathError(inspection.error)
                return null
            }
            if (!inspection.exists) {
                setProjectPathError("Path does not exist.")
                return null
            }
            if (!inspection.isDirectory) {
                setProjectPathError("Path is not a directory.")
                return null
            }
            return inspection.resolvedPath || path
        } catch (error) {
            if (pathInspectionRunRef.current !== runId) return null
            setProjectPathInspection(null)
            setProjectPathError(error instanceof Error ? error.message : "Path inspection failed.")
            return null
        } finally {
            if (pathInspectionRunRef.current === runId) {
                setProjectPathInspecting(false)
            }
        }
    }

    const submitProject = async () => {
        const name = newProjectName.trim()
        const path = newProjectPath.trim()
        if (!onCreateProject || createProjectLoading || projectPathInspecting || !name || !path) return
        const resolvedPath = await validateProjectPath(path)
        if (!resolvedPath) return
        const created = await onCreateProject({ name, path: resolvedPath })
        if (!created) return
        resetProjectForm()
        setShowCreateProject(false)
    }

    if (sessions.length === 0) {
        return (
            <div className="w-full max-w-full p-3">
                <div className="border border-border bg-base-200/40 p-3 text-sm text-muted">No sessions.</div>
            </div>
        )
    }

    return (
        <div className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden bg-base-100 p-3">
            <div className="flex w-full max-w-full flex-col gap-3 overflow-hidden">
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={onToggleArchived}
                        className={`btn flex h-11 flex-1 items-center justify-center gap-2 border px-3 text-sm ${
                            showArchived ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-base-200/70 text-base-content"
                        }`}
                    >
                        <Archive size={15} />
                        {showArchived ? "Hide archived" : "Show archived"}
                    </button>
                    <button
                        type="button"
                        onClick={onAddSession}
                        className="btn flex h-11 shrink-0 items-center gap-2 border border-border bg-base-200/70 px-3 text-sm text-base-content"
                    >
                        <Plus size={15} />
                        Session
                    </button>
                    {canCreateProject && (
                        <button
                            type="button"
                            onClick={() => {
                                setShowCreateProject((value) => !value)
                                setProjectPathError(null)
                            }}
                            className="btn flex h-11 shrink-0 items-center gap-2 border border-border bg-base-200/70 px-3 text-sm text-base-content"
                        >
                            {showCreateProject ? <X size={15} /> : <Plus size={15} />}
                            Project
                        </button>
                    )}
                </div>
                {canCreateProject && showCreateProject && (
                    <form
                        className="flex w-full max-w-full flex-col gap-2 border border-border bg-base-200/25 p-3"
                        onSubmit={(event) => {
                            event.preventDefault()
                            void submitProject()
                        }}
                    >
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
                            <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                                Name
                                <input
                                    value={newProjectName}
                                    onChange={(event) => setNewProjectName(event.target.value)}
                                    className="input h-10 min-w-0 border border-border bg-base-100 px-3 text-sm font-normal normal-case text-base-content"
                                    placeholder="Project name"
                                    disabled={createProjectLoading}
                                />
                            </label>
                            <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                                Path
                                <input
                                    value={newProjectPath}
                                    onChange={(event) => {
                                        pathInspectionRunRef.current += 1
                                        setNewProjectPath(event.target.value)
                                        setProjectPathInspection(null)
                                        setProjectPathError(null)
                                    }}
                                    className="input h-10 min-w-0 border border-border bg-base-100 px-3 text-sm font-normal normal-case text-base-content"
                                    placeholder="/path/to/project"
                                    disabled={createProjectLoading || projectPathInspecting}
                                />
                            </label>
                            <button
                                type="submit"
                                disabled={createProjectLoading || projectPathInspecting || !newProjectName.trim() || !newProjectPath.trim()}
                                className="btn mt-5 flex h-10 shrink-0 items-center justify-center gap-1.5 bg-primary px-3 text-sm text-primary-content disabled:opacity-50"
                            >
                                {createProjectLoading || projectPathInspecting ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                                Create
                            </button>
                        </div>
                        {projectPathError && <div className="text-xs text-error">{projectPathError}</div>}
                        {projectPathInspection && !projectPathError && !projectPathInspection.isGitRepo && (
                            <div className="text-xs text-warning">Path is not a Git repository.</div>
                        )}
                    </form>
                )}
                {sessions.map((session) => {
                    const repos = session.snapshot?.repos.filter((repo) => showArchived || !repo.archived) ?? []
                    const totalProjects = session.snapshot?.repos.length ?? 0
                    const hiddenProjects = Math.max(totalProjects - repos.length, 0)
                    const workingTaskIds = new Set(session.snapshot?.workingTaskIds ?? [])
                    const runningProjectCount = repos.filter((repo) => repo.tasks.some((task) => workingTaskIds.has(task.id))).length
                    return (
                        <section key={session.id} className="w-full max-w-full overflow-hidden border border-border bg-base-200/25">
                            <div className="border-b border-border bg-base-200/60 px-3 py-3">
                                <div className="flex min-w-0 items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-primary/20 bg-primary/10 text-primary">
                                            <Server size={17} />
                                        </span>
                                        <div className="min-w-0">
                                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted">Session</div>
                                            <div className="truncate text-sm font-semibold">{session.host}</div>
                                            <div className="truncate text-xs text-muted">
                                                {repos.length} project{repos.length === 1 ? "" : "s"}
                                                {hiddenProjects > 0 ? `, ${hiddenProjects} hidden` : ""}
                                                {runningProjectCount > 0 ? `, ${runningProjectCount} running` : ""}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                        {runningProjectCount > 0 && <Loader2 size={13} className="animate-spin text-primary" />}
                                        {session.isActive && (
                                            <span className="border border-primary/25 bg-primary/10 px-2 py-1 text-[11px] text-primary">Active</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex flex-col">
                                {!session.snapshot && (
                                    <div className="flex items-center justify-between gap-3 px-3 py-3 text-sm text-muted">
                                        <span className="min-w-0 flex-1">Open this session to load projects.</span>
                                        <button
                                            type="button"
                                            onClick={() => onSelectSession(session.id)}
                                            className="btn h-9 shrink-0 border border-border bg-base-200 px-3 text-sm text-base-content"
                                        >
                                            Open Session
                                        </button>
                                    </div>
                                )}
                                {session.snapshot && repos.length === 0 && (
                                    <div className="px-3 py-3 text-sm text-muted">{showArchived ? "No projects." : "No active projects."}</div>
                                )}
                                {repos.map((repo) => (
                                    <ProjectRow
                                        key={repo.id}
                                        repo={repo}
                                        runningCount={repo.tasks.filter((task) => workingTaskIds.has(task.id)).length}
                                        onSelect={onSelectProject ? () => onSelectProject(session.id, repo.id) : undefined}
                                    />
                                ))}
                            </div>
                        </section>
                    )
                })}
            </div>
        </div>
    )
}

function ProjectRow({ repo, runningCount, onSelect }: { repo: OpenADEProject; runningCount: number; onSelect?: () => void }) {
    const canSelect = Boolean(onSelect)
    return (
        <button
            type="button"
            onClick={onSelect}
            disabled={!canSelect}
            className="btn group flex w-full min-w-0 items-center gap-3 border-b border-border bg-transparent px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-base-200/70"
        >
            <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center border ${
                    repo.archived ? "border-warning/20 bg-warning/10 text-warning" : "border-info/20 bg-info/10 text-info"
                }`}
            >
                {repo.archived ? <Archive size={16} /> : <FolderOpen size={16} />}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex w-full min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-base-content">{repo.name}</span>
                    {runningCount > 0 && (
                        <span className="flex shrink-0 items-center gap-1 border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] uppercase text-primary">
                            <Loader2 size={10} className="animate-spin" />
                            {runningCount}
                        </span>
                    )}
                    <span className="shrink-0 text-[11px] text-muted">
                        {repo.tasks.length} task{repo.tasks.length === 1 ? "" : "s"}
                    </span>
                </span>
                <span className="mt-0.5 block max-w-full truncate text-xs text-muted">{repo.path}</span>
            </span>
            {repo.archived && <span className="shrink-0 border border-warning/20 bg-warning/10 px-2 py-1 text-[10px] uppercase text-warning">Archived</span>}
            <ChevronRight size={15} className="shrink-0 text-muted opacity-60 group-hover:text-base-content" />
        </button>
    )
}
