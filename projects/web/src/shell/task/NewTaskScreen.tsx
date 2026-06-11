import { MessageSquarePlus } from "lucide-react"
import type { OpenADEProject } from "../../../../openade-module/src"
import { TaskComposer, type TaskComposerAgentControls } from "./TaskComposer"
import { TASK_NEW_TASK_COMMANDS, type TaskCommandType } from "./taskCommands"

export function NewTaskScreen({
    repos,
    repoId,
    mode,
    title,
    prompt,
    isLoading,
    isSubmitting,
    isOnline,
    canCreateTask,
    canStartTurn,
    agentControls,
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
    canCreateTask: boolean
    canStartTurn: boolean
    agentControls?: TaskComposerAgentControls
    onRepoChange: (repoId: string) => void
    onModeChange: (mode: TaskCommandType) => void
    onTitleChange: (title: string) => void
    onPromptChange: (prompt: string) => void
    onCreate: () => void
}) {
    const selectedRepo = repos.find((repo) => repo.id === repoId) ?? null

    return (
        <div className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-3 pb-20" data-openade-surface="shared-new-task">
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
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Task</div>
                    <input
                        value={title}
                        aria-label="Task title"
                        onChange={(event) => onTitleChange(event.target.value)}
                        disabled={isSubmitting}
                        placeholder="Optional title"
                        className="input mb-2 h-11 w-full max-w-full border border-border bg-base-100 px-3 text-base"
                    />
                    <TaskComposer
                        input={prompt}
                        commandType={mode}
                        commands={canStartTurn ? TASK_NEW_TASK_COMMANDS : []}
                        isLoading={isLoading}
                        isSubmitting={isSubmitting}
                        isOnline={isOnline}
                        isRunning={false}
                        canSend={Boolean(repoId) && canCreateTask}
                        agentControls={canStartTurn ? agentControls : undefined}
                        placeholder="What should OpenADE do?"
                        sendLabel={canStartTurn ? "Create & Run" : "Create Task"}
                        onInputChange={onPromptChange}
                        onCommandTypeChange={onModeChange}
                        onSend={onCreate}
                        onAbort={() => undefined}
                    />
                </section>
            </div>
        </div>
    )
}
