import { Archive, ChevronRight, FolderOpen, Loader2, Plus, Server } from "lucide-react"
import type { OpenADEProject, OpenADESnapshot } from "../../../../openade-module/src"

export interface ProjectSessionSummary {
    id: string
    host: string
    snapshot: OpenADESnapshot | null
    isActive: boolean
}

export function ProjectsScreen({
    sessions,
    showArchived,
    onToggleArchived,
    onSelectProject,
    onAddSession,
}: {
    sessions: ProjectSessionSummary[]
    showArchived: boolean
    onToggleArchived: () => void
    onSelectProject: (sessionId: string, repoId: string) => void
    onAddSession: () => void
}) {
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
                </div>
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
                                {!session.snapshot && <div className="px-3 py-3 text-sm text-muted">Loading projects...</div>}
                                {session.snapshot && repos.length === 0 && (
                                    <div className="px-3 py-3 text-sm text-muted">{showArchived ? "No projects." : "No active projects."}</div>
                                )}
                                {repos.map((repo) => (
                                    <ProjectRow
                                        key={repo.id}
                                        repo={repo}
                                        runningCount={repo.tasks.filter((task) => workingTaskIds.has(task.id)).length}
                                        onSelect={() => onSelectProject(session.id, repo.id)}
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

function ProjectRow({ repo, runningCount, onSelect }: { repo: OpenADEProject; runningCount: number; onSelect: () => void }) {
    return (
        <button
            type="button"
            onClick={onSelect}
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
