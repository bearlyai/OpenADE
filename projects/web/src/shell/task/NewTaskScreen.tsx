import { Loader2, MessageSquarePlus } from "lucide-react"
import type { OpenADEProject } from "../../../../openade-module/src"
import { TASK_NEW_TASK_COMMANDS, taskCommandLabel, type TaskCommandType } from "./taskCommands"

export function NewTaskScreen({
    repos,
    repoId,
    mode,
    title,
    prompt,
    isLoading,
    isSubmitting,
    isOnline,
    onRepoChange,
    onModeChange,
    onTitleChange,
    onPromptChange,
    onCreate,
}: {
    repos: OpenADEProject[]
    repoId: string | null
    mode: TaskCommandType
    title: string
    prompt: string
    isLoading: boolean
    isSubmitting: boolean
    isOnline: boolean
    onRepoChange: (repoId: string) => void
    onModeChange: (mode: TaskCommandType) => void
    onTitleChange: (title: string) => void
    onPromptChange: (prompt: string) => void
    onCreate: () => void
}) {
    const selectedRepo = repos.find((repo) => repo.id === repoId) ?? null

    return (
        <div className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-3 pb-20">
            <div className="flex w-full max-w-full flex-col gap-3 overflow-hidden">
                <div className="overflow-hidden border border-border bg-base-200/25">
                    <div className="flex min-w-0 items-center gap-3 border-b border-border bg-base-200/60 p-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-primary/20 bg-primary/10 text-primary">
                            <MessageSquarePlus size={18} />
                        </span>
                        <div className="min-w-0">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted">New task</div>
                            <div className="truncate text-base font-semibold">{selectedRepo?.name ?? "Choose a project"}</div>
                            <div className="truncate text-xs text-muted">{selectedRepo?.path ?? "Pick where this should run"}</div>
                        </div>
                    </div>
                    <div className="p-3">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-muted">Project</span>
                            <select
                                value={repoId ?? ""}
                                onChange={(event) => onRepoChange(event.target.value)}
                                disabled={isSubmitting}
                                className="input h-11 w-full max-w-full border border-border bg-base-100 px-3 text-sm"
                            >
                                {repos.map((repo) => (
                                    <option key={repo.id} value={repo.id}>
                                        {repo.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                </div>

                <section className="border border-border bg-base-200/20 p-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Mode</div>
                    <div className="grid min-w-0 grid-cols-4 gap-1.5">
                        {TASK_NEW_TASK_COMMANDS.map((type) => (
                            <button
                                key={type}
                                type="button"
                                onClick={() => onModeChange(type)}
                                disabled={isSubmitting}
                                className={`btn min-w-0 overflow-hidden border px-1.5 py-2 text-xs ${
                                    mode === type ? "border-primary bg-primary text-primary-content" : "border-border bg-base-100 text-base-content"
                                }`}
                            >
                                <span className="truncate">{taskCommandLabel(type)}</span>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="border border-border bg-base-200/20 p-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Prompt</div>
                    <input
                        value={title}
                        aria-label="Task title"
                        onChange={(event) => onTitleChange(event.target.value)}
                        disabled={isSubmitting}
                        placeholder="Optional title"
                        className="input mb-2 h-11 w-full max-w-full border border-border bg-base-100 px-3 text-base"
                    />
                    <textarea
                        value={prompt}
                        aria-label="Task prompt"
                        onChange={(event) => onPromptChange(event.target.value)}
                        disabled={isSubmitting}
                        placeholder={isSubmitting ? "Sending..." : "What should OpenADE do?"}
                        className="input min-h-[220px] w-full max-w-full resize-none border border-border bg-base-100 p-3 text-base"
                    />
                </section>
                <button
                    type="button"
                    onClick={onCreate}
                    disabled={!prompt.trim() || !repoId || isLoading || isSubmitting || !isOnline}
                    className="btn flex h-12 items-center justify-center gap-2 bg-primary px-4 font-medium text-primary-content disabled:opacity-50"
                >
                    {isSubmitting || isLoading ? <Loader2 size={16} className="animate-spin" /> : <MessageSquarePlus size={16} />}
                    {isSubmitting ? "Sending..." : "Create Task"}
                </button>
            </div>
        </div>
    )
}
