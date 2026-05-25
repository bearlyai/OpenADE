import { reaction } from "mobx"
import type {
    CompanionEvent,
    CompanionRequest,
    CompanionResponse,
    RemoteRepo,
    RemoteRunRequest,
    RemoteSnapshot,
    RemoteTask,
} from "../../../shared/companion/src"
import { getTaskPreview } from "../persistence/repoStore"
import { themeClasses } from "../persistence/personalSettingsStore"
import { type TaskStore, taskFromStore } from "../persistence/taskStore"
import type { RunCmdArgs } from "../types"
import type { CodeStore } from "../store/store"
import { MODEL_REGISTRY } from "../constants"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { resolveThemeSetting } from "../hooks/useResolvedTheme"
import { sortTaskPreviewsLikeSidebar } from "../components/sidebar/taskSorting"

function nowEvent(type: CompanionEvent["type"]): CompanionEvent {
    return { type, at: new Date().toISOString() } as CompanionEvent
}

function notify(event: CompanionEvent): void {
    void window.openadeAPI?.companion.notifyEvent(event).catch((error) => {
        console.warn("[Companion] Failed to notify main process:", error)
    })
}

function toIpcResult<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function toRemoteRepo(repo: ReturnType<NonNullable<CodeStore["repoStore"]>["repos"]["all"]>[number], store: CodeStore): RemoteRepo {
    const tasks = sortTaskPreviewsLikeSidebar(repo.tasks, {
        pinnedTaskIds: store.personalSettingsStore?.settings.current.pinnedTaskIds,
        workingTaskIds: store.workingTaskIds,
    })

    return {
        id: repo.id,
        name: repo.name,
        path: repo.path,
        archived: repo.archived,
        tasks: tasks.map((task) => ({
            id: task.id,
            slug: task.slug,
            title: task.title,
            closed: task.closed,
            createdAt: task.createdAt,
            lastEvent: task.lastEvent,
            lastViewedAt: task.lastViewedAt,
            lastEventAt: task.lastEventAt,
        })),
    }
}

function isMissingTaskDocumentError(error: unknown): boolean {
    return error instanceof Error && error.message.includes("missing or has mismatched metadata id")
}

async function snapshot(store: CodeStore): Promise<RemoteSnapshot> {
    if (!store.repoStore) throw new Error("Repo store is not initialized")
    const themeSetting = store.personalSettingsStore?.settings.current.theme ?? "system"
    const systemPreference = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    const themeClass = resolveThemeSetting(themeSetting, systemPreference)

    return {
        server: {
            version: "local",
            hostName: window.location.hostname || "OpenADE",
            theme: {
                setting: themeSetting,
                className: themeClass,
                label: themeClasses[themeClass]?.label,
            },
        },
        repos: store.repoStore.repos.all().map((repo) => toRemoteRepo(repo, store)),
        workingTaskIds: Array.from(store.workingTaskIds),
    }
}

async function getTask(store: CodeStore, params: { repoId: string; taskId: string }): Promise<RemoteTask> {
    let taskStore: TaskStore
    try {
        taskStore = await store.getTaskStore(params.repoId, params.taskId)
    } catch (error) {
        if (!isMissingTaskDocumentError(error) || !store.repoStore) throw error

        try {
            taskStore = await store.getTaskStore(params.repoId, params.taskId)
        } catch (retryError) {
            if (!isMissingTaskDocumentError(retryError)) throw retryError

            const preview = getTaskPreview(store.repoStore, params.repoId, params.taskId)
            if (!preview) throw retryError

            return {
                id: preview.id,
                repoId: params.repoId,
                slug: preview.slug,
                title: preview.title,
                description: "",
                closed: preview.closed,
                unavailableReason: "Task data is unavailable on the desktop host.",
                events: [],
                comments: [],
            }
        }
    }

    const task = taskFromStore(taskStore)
    return {
        id: task.id,
        repoId: task.repoId,
        slug: task.slug,
        title: task.title,
        description: task.description,
        closed: task.closed,
        events: task.events,
        comments: task.comments,
    }
}

function toRunCmdArgs(args: RemoteRunRequest): RunCmdArgs {
    const harnessId = args.harnessId && Object.prototype.hasOwnProperty.call(MODEL_REGISTRY, args.harnessId) ? (args.harnessId as HarnessId) : undefined

    return {
        repoId: args.repoId,
        type: args.type,
        input: args.input,
        appendSystemPrompt: args.appendSystemPrompt,
        inTaskId: args.inTaskId,
        isolationStrategy: args.isolationStrategy,
        enabledMcpServerIds: args.enabledMcpServerIds,
        harnessId,
        thinking: args.thinking,
        fastMode: args.fastMode,
        title: args.title,
    }
}

export function registerCompanionController(store: CodeStore): () => void {
    const companion = window.openadeAPI?.companion
    if (!companion) return () => {}

    const disposers: Array<() => void> = []
    const taskSubscriptions = new Map<string, () => void>()

    const ensureTaskSubscription = async (repoId: string, taskId: string) => {
        if (taskSubscriptions.has(taskId)) return
        const taskStore = await store.getTaskStore(repoId, taskId)
        const dispose = taskStore.events.subscribe(() => {
            notify({ type: "task_changed", repoId, taskId, at: new Date().toISOString() })
        })
        taskSubscriptions.set(taskId, dispose)
    }

    disposers.push(
        companion.onRequest(async (rawRequest) => {
            const request = rawRequest as CompanionRequest
            const respond = (response: CompanionResponse) => companion.respond(toIpcResult(response))

            try {
                switch (request.method) {
                    case "getSnapshot": {
                        await respond({ id: request.id, ok: true, result: await snapshot(store) })
                        break
                    }
                    case "getTask": {
                        const task = await getTask(store, request.params)
                        if (!task.unavailableReason) {
                            await ensureTaskSubscription(request.params.repoId, request.params.taskId)
                        }
                        await respond({ id: request.id, ok: true, result: task })
                        break
                    }
                    case "run": {
                        const result = await store.runCmd.run(toRunCmdArgs(request.params))
                        await ensureTaskSubscription(request.params.repoId, result.taskId)
                        await respond({ id: request.id, ok: true, result })
                        break
                    }
                    case "abort": {
                        await store.queries.abortTask(request.params.taskId)
                        await respond({ id: request.id, ok: true, result: { ok: true } })
                        break
                    }
                }
            } catch (error) {
                await respond({
                    id: request.id,
                    ok: false,
                    error: error instanceof Error ? error.message : "Unknown companion controller error",
                })
            }
        })
    )

    if (store.repoStore) {
        disposers.push(store.repoStore.repos.subscribe(() => notify(nowEvent("snapshot_changed"))))
    }

    disposers.push(
        reaction(
            () => Array.from(store.workingTaskIds),
            (taskIds) => notify({ type: "working_tasks", taskIds, at: new Date().toISOString() }),
            { fireImmediately: true }
        )
    )

    disposers.push(
        store.execution.onAfterEvent((taskId) => {
            const taskStore = store.getCachedTaskStore(taskId)
            const repoId = taskStore?.meta.current.repoId
            if (repoId) notify({ type: "task_changed", repoId, taskId, at: new Date().toISOString() })
            notify(nowEvent("snapshot_changed"))
        })
    )

    return () => {
        for (const dispose of disposers) dispose()
        for (const dispose of taskSubscriptions.values()) dispose()
        taskSubscriptions.clear()
    }
}
