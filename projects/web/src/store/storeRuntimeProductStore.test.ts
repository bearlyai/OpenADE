import { describe, expect, it, vi } from "vitest"
import { OpenADEClient } from "../../../openade-client/src"
import { type OpenADEModuleAdapters, createOpenADEModule } from "../../../openade-module/src/module"
import type { OpenADEProject, OpenADESnapshotPatchIndex, OpenADETask, OpenADETaskPreview, OpenADETaskPreviewUsage } from "../../../openade-module/src/types"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { RuntimeLocalClient, type RuntimeLocalTransport } from "../../../runtime-client/src"
import type { RuntimeMessage, RuntimeRecord, RuntimeRequest } from "../../../runtime-protocol/src"
import { type RuntimeConnection, RuntimeServer } from "../../../runtime/src"
import { analytics } from "../analytics"
import { GitLogTray } from "../components/GitLogTray"
import { ViewPatch } from "../components/ViewPatch"
import { filesApi } from "../electronAPI/files"
import { gitApi } from "../electronAPI/git"
import { snapshotsApi } from "../electronAPI/snapshots"
import { OpenADEProductStore } from "../kernel/productStore"
import { CodeStoreProvider } from "./context"
import type { SnapshotEventModel } from "./EventModel"
import { CodeStore } from "./store"

const now = "2026-05-31T00:00:00.000Z"

const project: OpenADEProject = {
    id: "repo-1",
    name: "Runtime Repo",
    path: "/tmp/runtime-repo",
    tasks: [
        {
            id: "task-1",
            slug: "runtime-task",
            title: "Runtime task",
            createdAt: now,
        },
    ],
}

const task: OpenADETask = {
    id: "task-1",
    repoId: "repo-1",
    slug: "runtime-task",
    title: "Runtime task",
    description: "Read through the desktop runtime product bridge.",
    isolationStrategy: { type: "head" },
    createdBy: { id: "user-1", email: "user@example.com" },
    createdAt: now,
    updatedAt: now,
    deviceEnvironments: [],
    events: [
        {
            id: "event-1",
            type: "action",
            status: "completed",
            createdAt: now,
            completedAt: now,
            userInput: "Do the runtime-backed work",
            execution: {
                harnessId: "codex",
                executionId: "exec-1",
                modelId: "gpt-test",
                events: [],
            },
            source: { type: "do", userLabel: "Do" },
            includesCommentIds: ["comment-1"],
            result: { success: true },
        },
    ],
    comments: [
        {
            id: "comment-1",
            content: "Runtime-backed",
            source: { type: "llm_output", eventId: "event-1", lineStart: 1, lineEnd: 1 },
            selectedText: { text: "Runtime", linesBefore: "", linesAfter: "" },
            author: { id: "user-1", email: "user@example.com" },
            createdAt: now,
        },
    ],
}

const snapshotPatch = [
    "diff --git a/README.md b/README.md",
    "index 1111111..2222222 100644",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -1 +1,2 @@",
    "-old runtime",
    "+new runtime",
    "+snapshot product store",
    "",
].join("\n")

const snapshotPatchIndex: OpenADESnapshotPatchIndex = {
    version: 1,
    patchSize: snapshotPatch.length,
    files: [
        {
            id: "README.md",
            path: "README.md",
            status: "modified",
            binary: false,
            insertions: 2,
            deletions: 1,
            changedLines: 3,
            hunkCount: 1,
            patchStart: 0,
            patchEnd: snapshotPatch.length,
        },
    ],
}

const gitLogCommits = [
    {
        sha: "abc123456789",
        shortSha: "abc1234",
        message: "Runtime product store commit",
        author: "Runtime Author",
        date: now,
        relativeDate: "1 minute ago",
        parentCount: 1,
    },
    {
        sha: "def123456789",
        shortSha: "def1234",
        message: "Previous runtime commit",
        author: "Runtime Author",
        date: now,
        relativeDate: "2 minutes ago",
        parentCount: 1,
    },
]

interface RuntimeBridgeState {
    project: OpenADEProject | null
    task: OpenADETask | null
    taskUsage?: OpenADETaskPreviewUsage
}

function cloneProject(value: OpenADEProject): OpenADEProject {
    return structuredClone(value)
}

function cloneTask(value: OpenADETask): OpenADETask {
    return structuredClone(value)
}

function taskPreviewFromTask(value: OpenADETask, usage?: OpenADETaskPreviewUsage): OpenADETaskPreview {
    return {
        id: value.id,
        slug: value.slug,
        title: value.title,
        closed: value.closed,
        createdAt: value.createdAt ?? now,
        lastEventAt: value.lastEventAt,
        lastViewedAt: value.lastViewedAt,
        usage,
    }
}

function projectFromState(state: RuntimeBridgeState): OpenADEProject | null {
    if (!state.project) return null
    return {
        ...cloneProject(state.project),
        tasks: state.task ? [taskPreviewFromTask(state.task, state.taskUsage)] : [],
    }
}

function projectsFromState(state: RuntimeBridgeState): OpenADEProject[] {
    const currentProject = projectFromState(state)
    return currentProject ? [currentProject] : []
}

function createBridgeState(): RuntimeBridgeState {
    return {
        project: cloneProject(project),
        task: cloneTask(task),
    }
}

function unsupportedMutation(method: string): () => Promise<never> {
    return async () => {
        throw new Error(`${method} is not available in the read-only bridge test runtime`)
    }
}

function snapshotPatchForEvent(snapshotEvent: Record<string, unknown>): { patchFileId?: string; patch: string | null } {
    const patchFileId = typeof snapshotEvent.patchFileId === "string" ? snapshotEvent.patchFileId : undefined
    const inlinePatch = typeof snapshotEvent.fullPatch === "string" && snapshotEvent.fullPatch.length > 0 ? snapshotEvent.fullPatch : null
    if (inlinePatch) return { patchFileId, patch: inlinePatch }
    return { patchFileId, patch: patchFileId === "patch-1" ? snapshotPatch : null }
}

function snapshotIndexForPatch(patch: string | null): OpenADESnapshotPatchIndex | null {
    if (patch === null) return null
    return {
        ...snapshotPatchIndex,
        patchSize: patch.length,
        files: snapshotPatchIndex.files.map((file) => ({ ...file, patchEnd: patch.length })),
    }
}

function requireStateTask(state: RuntimeBridgeState, taskId: string): OpenADETask {
    if (!state.task || state.task.id !== taskId) throw new Error(`Task ${taskId} not found`)
    return state.task
}

function requireStateProject(state: RuntimeBridgeState, repoId: string): OpenADEProject {
    if (!state.project || state.project.id !== repoId) throw new Error(`Repo ${repoId} not found`)
    return state.project
}

const runtimeSearchFixture = {
    path: "src/runtime-search.ts",
    content: "export const marker = 'runtime needle';\n",
}

function createReadOnlyAdapters(state: RuntimeBridgeState): OpenADEModuleAdapters {
    return {
        version: () => "bridge-test-version",
        readSnapshot: async () => ({
            server: {
                version: "bridge-test-version",
                hostName: "bridge-test-host",
                theme: { setting: "system", className: "code-theme-light" },
            },
            repos: projectsFromState(state),
            workingTaskIds: [],
        }),
        readProjects: async () => projectsFromState(state),
        readTaskList: async () => projectFromState(state)?.tasks ?? [],
        readTask: async (_repoId, taskId) => {
            if (!state.task || taskId !== state.task.id) throw new Error(`Task ${taskId} not found`)
            return cloneTask(state.task)
        },
        listDataDocuments: async () => [],
        readDataDocumentBase64: async () => null,
        saveDataDocumentBase64: unsupportedMutation("saveDataDocumentBase64"),
        deleteDataDocument: unsupportedMutation("deleteDataDocument"),
        createRepo: async (params) => {
            const repoId = params.repoId ?? "repo-created"
            const createdAt = params.createdAt ?? now
            state.project = { id: repoId, name: params.name, path: params.path, tasks: [] }
            state.task = null
            state.taskUsage = undefined
            return { repoId, createdAt }
        },
        updateRepo: async (params) => {
            if (!state.project || state.project.id !== params.repoId) throw new Error(`Repo ${params.repoId} not found`)
            state.project = {
                ...state.project,
                name: params.name ?? state.project.name,
                path: params.path ?? state.project.path,
                archived: params.archived ?? state.project.archived,
            }
        },
        deleteRepo: async (params) => {
            if (!state.project || state.project.id !== params.repoId) throw new Error(`Repo ${params.repoId} not found`)
            state.project = null
            if (state.task?.repoId === params.repoId) state.task = null
            if (!state.task) state.taskUsage = undefined
        },
        startTurn: async (params) => {
            const existingTaskId = params.inTaskId ?? state.task?.id
            const taskId = existingTaskId ?? "task-started"
            const repoId = params.repoId
            const eventId = "event-started"
            const actionEvent = {
                id: eventId,
                type: "action",
                status: "completed",
                createdAt: now,
                completedAt: now,
                userInput: params.input,
                execution: {
                    harnessId: params.harnessId ?? "codex",
                    executionId: "exec-started",
                    modelId: params.modelId,
                    events: [],
                    thinking: params.thinking,
                    fastMode: params.fastMode,
                },
                source: { type: params.type, userLabel: params.label ?? params.type },
                includesCommentIds: [],
                result: { success: true },
            }
            if (state.task && existingTaskId === state.task.id) {
                state.task = {
                    ...state.task,
                    events: [...state.task.events, actionEvent],
                    lastEventAt: now,
                    updatedAt: now,
                }
            } else {
                state.project = state.project ?? { id: repoId, name: "Runtime Repo", path: "/tmp/runtime-repo", tasks: [] }
                state.task = {
                    id: taskId,
                    repoId,
                    slug: "task-started",
                    title: params.title ?? "Started task",
                    description: params.input,
                    isolationStrategy: params.isolationStrategy,
                    enabledMcpServerIds: params.enabledMcpServerIds,
                    deviceEnvironments: [],
                    createdBy: { id: "user-1", email: "user@example.com" },
                    createdAt: now,
                    updatedAt: now,
                    events: [actionEvent],
                    comments: [],
                }
                state.taskUsage = undefined
            }
            return { taskId, eventId }
        },
        startReview: async (params) => {
            const current = requireStateTask(state, params.taskId)
            const eventId = "event-review"
            state.task = {
                ...current,
                events: [
                    ...current.events,
                    {
                        id: eventId,
                        type: "action",
                        status: "completed",
                        createdAt: now,
                        completedAt: now,
                        userInput: params.customInstructions ?? "",
                        execution: {
                            harnessId: params.harnessId,
                            executionId: "exec-review",
                            modelId: params.modelId,
                            events: [],
                        },
                        source: { type: "review", userLabel: params.reviewType },
                        includesCommentIds: [],
                        result: { success: true },
                    },
                ],
                lastEventAt: now,
                updatedAt: now,
            }
            return { taskId: params.taskId, eventId }
        },
        interruptTurn: async (params) => {
            requireStateTask(state, params.taskId)
        },
        cancelQueuedTurn: async (params) => {
            const current = requireStateTask(state, params.taskId)
            state.task = {
                ...current,
                queuedTurns: (current.queuedTurns ?? []).map((turn) =>
                    turn.id === params.queuedTurnId ? { ...turn, status: "cancelled", updatedAt: now } : turn
                ),
                updatedAt: now,
            }
            return { taskId: params.taskId, queuedTurnId: params.queuedTurnId, cancelled: true }
        },
        deleteTask: async (params) => {
            requireStateTask(state, params.taskId)
            state.task = null
            state.taskUsage = undefined
            return { repoId: params.repoId, taskId: params.taskId, deleted: true }
        },
        setupTaskEnvironment: async (params) => {
            const current = requireStateTask(state, params.taskId)
            state.task = {
                ...current,
                deviceEnvironments: [...current.deviceEnvironments.filter((env) => env.id !== params.deviceEnvironment.id), params.deviceEnvironment],
                updatedAt: now,
            }
        },
        createActionEvent: unsupportedMutation("createActionEvent"),
        appendActionStreamEvent: unsupportedMutation("appendActionStreamEvent"),
        completeActionEvent: unsupportedMutation("completeActionEvent"),
        errorActionEvent: unsupportedMutation("errorActionEvent"),
        stoppedActionEvent: unsupportedMutation("stoppedActionEvent"),
        reconcileActionEventRuntime: async (params) => ({ taskId: params.taskId, changed: false }),
        updateActionExecution: unsupportedMutation("updateActionExecution"),
        addHyperPlanSubExecution: unsupportedMutation("addHyperPlanSubExecution"),
        appendHyperPlanSubExecutionStreamEvent: unsupportedMutation("appendHyperPlanSubExecutionStreamEvent"),
        updateHyperPlanSubExecution: unsupportedMutation("updateHyperPlanSubExecution"),
        setHyperPlanReconcileLabels: unsupportedMutation("setHyperPlanReconcileLabels"),
        createSnapshotEvent: unsupportedMutation("createSnapshotEvent"),
        createComment: async (params) => {
            const current = requireStateTask(state, params.taskId)
            const commentId = params.commentId ?? "comment-created"
            const createdAt = params.createdAt ?? now
            state.task = {
                ...current,
                comments: [
                    ...current.comments,
                    {
                        id: commentId,
                        content: params.content,
                        source: params.source,
                        selectedText: params.selectedText,
                        author: params.author,
                        createdAt,
                    },
                ],
                updatedAt: createdAt,
            }
            return { commentId, createdAt }
        },
        editComment: async (params) => {
            const current = requireStateTask(state, params.taskId)
            state.task = {
                ...current,
                comments: current.comments.map((comment) => {
                    if (typeof comment !== "object" || comment === null || !("id" in comment) || comment.id !== params.commentId) return comment
                    return { ...comment, content: params.content, updatedAt: params.updatedAt ?? now }
                }),
                updatedAt: params.updatedAt ?? now,
            }
        },
        deleteComment: async (params) => {
            const current = requireStateTask(state, params.taskId)
            state.task = {
                ...current,
                comments: current.comments.filter((comment) => {
                    if (typeof comment !== "object" || comment === null || !("id" in comment)) return true
                    return comment.id !== params.commentId
                }),
                updatedAt: params.updatedAt ?? now,
            }
        },
        updateTaskMetadata: async (params) => {
            const current = requireStateTask(state, params.taskId)
            state.task = {
                ...current,
                title: params.title ?? current.title,
                closed: params.closed ?? current.closed,
                lastViewedAt: params.lastViewedAt ?? current.lastViewedAt,
                lastEventAt: params.lastEventAt ?? current.lastEventAt,
                cancelledPlanEventId: params.cancelledPlanEventId ?? current.cancelledPlanEventId,
                enabledMcpServerIds: params.enabledMcpServerIds ?? current.enabledMcpServerIds,
                sessionIds: params.sessionIds ? { ...(current.sessionIds ?? {}), ...params.sessionIds } : current.sessionIds,
                queuedTurns: params.queuedTurns ?? current.queuedTurns,
                updatedAt: params.updatedAt ?? now,
            }
            state.taskUsage = params.usage ?? state.taskUsage
        },
        scopedHost: {
            listProjectFiles: async (params) => {
                requireStateProject(state, params.repoId)
                return {
                    repoId: params.repoId,
                    path: params.path ?? "",
                    entries: [
                        { path: "src", name: "src", type: "directory" },
                        { path: runtimeSearchFixture.path, name: "runtime-search.ts", type: "file", size: runtimeSearchFixture.content.length },
                    ],
                    truncated: false,
                }
            },
            readProjectFile: async (params) => {
                requireStateProject(state, params.repoId)
                if (params.path !== runtimeSearchFixture.path) throw new Error(`Project file ${params.path} not found`)
                const tooLarge = runtimeSearchFixture.content.length > (params.maxBytes ?? Number.POSITIVE_INFINITY)
                return {
                    repoId: params.repoId,
                    path: params.path,
                    encoding: params.encoding ?? "utf8",
                    size: runtimeSearchFixture.content.length,
                    tooLarge,
                    content: tooLarge ? null : runtimeSearchFixture.content,
                }
            },
            writeProjectFile: unsupportedMutation("writeProjectFile"),
            fuzzySearchProjectFiles: async (params) => {
                requireStateProject(state, params.repoId)
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    results: [runtimeSearchFixture.path],
                    truncated: false,
                    source: "filesystem",
                }
            },
            searchProject: async (params) => {
                requireStateProject(state, params.repoId)
                const line = runtimeSearchFixture.content.trimEnd()
                const haystack = params.caseSensitive ? line : line.toLowerCase()
                const needle = params.caseSensitive ? params.query : params.query.toLowerCase()
                const matchStart = haystack.indexOf(needle)
                return {
                    repoId: params.repoId,
                    matches:
                        matchStart >= 0
                            ? [
                                  {
                                      path: runtimeSearchFixture.path,
                                      line: 1,
                                      content: line,
                                      matchStart,
                                      matchEnd: matchStart + params.query.length,
                                  },
                              ]
                            : [],
                    truncated: false,
                }
            },
            listProjectProcesses: unsupportedMutation("listProjectProcesses"),
            startProjectProcess: unsupportedMutation("startProjectProcess"),
            reconnectProjectProcess: unsupportedMutation("reconnectProjectProcess"),
            stopProjectProcess: unsupportedMutation("stopProjectProcess"),
            startTaskTerminal: unsupportedMutation("startTaskTerminal"),
            reconnectTaskTerminal: unsupportedMutation("reconnectTaskTerminal"),
            writeTaskTerminal: unsupportedMutation("writeTaskTerminal"),
            resizeTaskTerminal: unsupportedMutation("resizeTaskTerminal"),
            stopTaskTerminal: unsupportedMutation("stopTaskTerminal"),
            readTaskImage: unsupportedMutation("readTaskImage"),
            readTaskChanges: unsupportedMutation("readTaskChanges"),
            readTaskDiff: unsupportedMutation("readTaskDiff"),
            readTaskFilePair: unsupportedMutation("readTaskFilePair"),
            readTaskGitLog: async (params) => {
                const skip = params.skip ?? 0
                const limit = params.limit ?? gitLogCommits.length
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    commits: gitLogCommits.slice(skip, skip + limit),
                    hasMore: gitLogCommits.length > skip + limit,
                }
            },
            readTaskGitCommitFiles: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                commit: params.commit,
                files: [{ path: "README.md", status: "modified" }],
            }),
            readTaskGitFileAtTreeish: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                treeish: params.treeish,
                filePath: params.filePath,
                content: params.treeish.endsWith("^") ? "before runtime commit\n" : "after runtime commit\n",
                exists: true,
            }),
            readTaskGitCommitFilePatch: async (params) => ({
                repoId: params.repoId,
                taskId: params.taskId,
                commit: params.commit,
                filePath: params.filePath,
                oldPath: params.oldPath,
                patch: "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-before runtime commit\n+after runtime commit\n",
                truncated: false,
                heavy: false,
                stats: { insertions: 1, deletions: 1, changedLines: 2, hunkCount: 1 },
            }),
            commitTaskGit: unsupportedMutation("commitTaskGit"),
            readTaskSnapshotPatch: async (params) => {
                const { patchFileId, patch } = snapshotPatchForEvent(params.snapshotEvent)
                return { repoId: params.repoId, taskId: params.taskId, eventId: params.eventId, patchFileId, patch }
            },
            readTaskSnapshotIndex: async (params) => {
                const { patchFileId, patch } = snapshotPatchForEvent(params.snapshotEvent)
                return { repoId: params.repoId, taskId: params.taskId, eventId: params.eventId, patchFileId, index: snapshotIndexForPatch(patch) }
            },
            readTaskSnapshotPatchSlice: async (params) => {
                const { patchFileId, patch } = snapshotPatchForEvent(params.snapshotEvent)
                return {
                    repoId: params.repoId,
                    taskId: params.taskId,
                    eventId: params.eventId,
                    patchFileId,
                    patch: patch === null ? null : patch.slice(params.start, params.end),
                }
            },
        },
    }
}

function createLocalRuntimeClient(server: RuntimeServer): RuntimeLocalClient {
    const listeners = new Set<(message: RuntimeMessage) => void>()
    let dispose: (() => void) | null = null
    const connection: RuntimeConnection = {
        id: "desktop-product-store-test",
        send(message) {
            for (const listener of listeners) listener(message)
        },
    }
    const transport: RuntimeLocalTransport = {
        connect() {
            dispose = server.connect(connection)
        },
        disconnect() {
            dispose?.()
            dispose = null
        },
        request(request: RuntimeRequest) {
            return server.handleRequest(request, connection, { requireInitialized: true })
        },
        onMessage(listener) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
    return new RuntimeLocalClient(transport, { clientName: "desktop-product-store-test", clientPlatform: "desktop" })
}

function createRuntimeBackedClient(state: RuntimeBridgeState = createBridgeState()): {
    client: OpenADEClient
    runtime: RuntimeLocalClient
    server: RuntimeServer
    state: RuntimeBridgeState
} {
    const server = new RuntimeServer({ serverName: "desktop-product-store-runtime", protocolVersion: 1 })
    server.registerModule(createOpenADEModule(createReadOnlyAdapters(state)))
    const runtime = createLocalRuntimeClient(server)
    return {
        server,
        state,
        runtime,
        client: new OpenADEClient({ runtime, clientName: "desktop-product-store-test", clientPlatform: "desktop" }),
    }
}

function runtimeRecord(status: RuntimeRecord["status"], updatedAt: string): RuntimeRecord {
    return {
        runtimeId: "runtime-1",
        kind: "agent",
        status,
        scope: { ownerType: "openade-task", ownerId: "task-1" },
        startedAt: now,
        updatedAt,
        lastActivityAt: updatedAt,
    }
}

async function waitForRuntimeBridge(assertion: () => void): Promise<void> {
    await vi.waitFor(assertion, { timeout: 1000, interval: 10 })
}

describe("CodeStore runtime product store bridge", () => {
    it("hydrates a desktop runtime-backed snapshot and task through a real local runtime client", async () => {
        const { client, runtime } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            expect(codeStore.runtimeProductStoreStatus).toBe("ready")
            expect(codeStore.runtimeProductStoreError).toBeNull()
            expect(codeStore.runtimeProductSnapshot?.server.hostName).toBe("bridge-test-host")
            expect(codeStore.runtimeProductSnapshot?.repos[0]?.tasks[0]?.title).toBe("Runtime task")
            expect(codeStore.repos.repos).toEqual([
                expect.objectContaining({
                    id: "repo-1",
                    name: "Runtime Repo",
                    path: "/tmp/runtime-repo",
                }),
            ])
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([
                expect.objectContaining({
                    id: "task-1",
                    title: "Runtime task",
                }),
            ])

            await expect(codeStore.getRuntimeProductTask("repo-1", "task-1")).resolves.toMatchObject({
                id: "task-1",
                title: "Runtime task",
                comments: [{ id: "comment-1" }],
            })

            await expect(codeStore.loadRuntimeProductTask("repo-1", "task-1")).resolves.toMatchObject({
                id: "task-1",
                title: "Runtime task",
                events: [{ id: "event-1" }],
                comments: [{ id: "comment-1" }],
            })
            expect(codeStore.tasks.getTask("task-1")).toMatchObject({
                id: "task-1",
                createdBy: { id: "user-1", email: "user@example.com" },
                events: [{ id: "event-1", type: "action" }],
                comments: [{ source: { type: "llm_output", eventId: "event-1" } }],
            })
            const taskModel = codeStore.tasks.getTaskModel("task-1")
            expect(taskModel?.exists).toBe(true)
            expect(taskModel?.title).toBe("Runtime task")
            expect(taskModel?.events.map((event) => event.id)).toEqual(["event-1"])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("refreshes runtime task state after a mutation without using legacy store refreshes", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            const legacyTaskRefresh = vi.spyOn(codeStore, "refreshTaskStoreFromStorage")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            if (!state.task) throw new Error("Expected runtime task fixture")
            state.task.title = "Runtime mutation title"

            await codeStore.refreshProductStateAfterTaskMutation("task-1")

            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
            expect(codeStore.tasks.getTask("task-1")?.title).toBe("Runtime mutation title")
            expect(codeStore.getTaskPreviewsForRepo("repo-1")[0]?.title).toBe("Runtime mutation title")
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("backs stats previews with runtime snapshot and backfills usage without legacy task stores", async () => {
        const { client, runtime } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            const legacyTaskRead = vi.spyOn(codeStore, "getTaskStore")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            expect(codeStore.getTaskPreviewReposForStats()).toEqual([
                expect.objectContaining({
                    id: "repo-1",
                    name: "Runtime Repo",
                    tasks: [expect.objectContaining({ id: "task-1", title: "Runtime task", usage: undefined })],
                }),
            ])

            await codeStore.backfillTaskUsagePreview("repo-1", "task-1")

            expect(legacyTaskRead).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
            expect(codeStore.runtimeProductSnapshot?.repos[0]?.tasks[0]?.usage).toMatchObject({
                usageVersion: 2,
                eventCount: 1,
            })
            expect(codeStore.getTaskPreviewReposForStats()[0]?.tasks[0]?.usage).toMatchObject({
                usageVersion: 2,
                eventCount: 1,
            })
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("refreshes runtime repo state after repo mutations without using legacy store refreshes", async () => {
        const { client, runtime } = createRuntimeBackedClient({ project: null, task: null })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            const created = await codeStore.repos.createRepo({ name: "New Runtime Repo", path: "/tmp/new-runtime-repo" })
            expect(created).toEqual(expect.objectContaining({ id: "repo-created", name: "New Runtime Repo", path: "/tmp/new-runtime-repo" }))
            expect(codeStore.runtimeProductSnapshot?.repos).toEqual([
                expect.objectContaining({ id: "repo-created", name: "New Runtime Repo", path: "/tmp/new-runtime-repo" }),
            ])

            const updated = await codeStore.repos.updateRepo("repo-created", { name: "Renamed Runtime Repo", path: "/tmp/renamed-runtime-repo" })
            expect(updated).toEqual(expect.objectContaining({ id: "repo-created", name: "Renamed Runtime Repo", path: "/tmp/renamed-runtime-repo" }))

            await codeStore.repos.setRepoArchived("repo-created", true)
            expect(codeStore.repos.getRepo("repo-created")).toEqual(expect.objectContaining({ archived: true }))

            await expect(codeStore.repos.deleteRepo("repo-created")).resolves.toBe(true)
            expect(codeStore.runtimeProductSnapshot?.repos).toEqual([])
            expect(codeStore.repos.repos).toEqual([])
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("routes classic task, comment, review, and turn mutations through the runtime product store", async () => {
        const { client, runtime } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")
            const legacyTaskRead = vi.spyOn(codeStore, "getTaskStore")
            const legacyTaskRefresh = vi.spyOn(codeStore, "refreshTaskStoreFromStorage")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            const commentId = await codeStore.comments.addComment(
                "task-1",
                { type: "llm_output", eventId: "event-1", lineStart: 1, lineEnd: 1 },
                "Runtime comment",
                { text: "Runtime", linesBefore: "", linesAfter: "" }
            )
            expect(commentId).toBe("comment-created")
            expect(codeStore.tasks.getTask("task-1")?.comments).toEqual(
                expect.arrayContaining([expect.objectContaining({ id: "comment-created", content: "Runtime comment" })])
            )

            await codeStore.comments.editComment("task-1", commentId, "Edited runtime comment")
            expect(codeStore.tasks.getTask("task-1")?.comments).toEqual(
                expect.arrayContaining([expect.objectContaining({ id: "comment-created", content: "Edited runtime comment" })])
            )

            await codeStore.tasks.markTaskViewed("task-1")
            expect(codeStore.getTaskPreviewsForRepo("repo-1")[0]?.lastViewedAt).toBeDefined()

            await codeStore.tasks.setSessionId({ taskId: "task-1", key: "review", sessionId: "session-runtime" })
            expect(codeStore.tasks.getTask("task-1")?.sessionIds).toEqual(expect.objectContaining({ review: "session-runtime" }))

            await codeStore.tasks.addDeviceEnvironment("task-1", {
                id: "device-1",
                deviceId: "device-1",
                setupComplete: true,
                createdAt: now,
                lastUsedAt: now,
            })
            expect(codeStore.tasks.getTask("task-1")?.deviceEnvironments).toEqual([expect.objectContaining({ id: "device-1" })])

            await codeStore.startProductReview({
                repoId: "repo-1",
                taskId: "task-1",
                reviewType: "plan",
                harnessId: "codex",
                modelId: "gpt-test",
            })
            await codeStore.refreshProductStateAfterTaskMutation("task-1")

            await codeStore.startProductTurn({
                repoId: "repo-1",
                type: "do",
                input: "Run through runtime product store",
                inTaskId: "task-1",
                harnessId: "codex",
                modelId: "gpt-test",
            })
            await codeStore.refreshProductStateAfterTaskMutation("task-1")
            expect(codeStore.tasks.getTask("task-1")?.events).toEqual(expect.arrayContaining([expect.objectContaining({ id: "event-started" })]))

            await codeStore.comments.removeComment("task-1", commentId)
            expect(codeStore.tasks.getTask("task-1")?.comments).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "comment-created" })]))

            await codeStore.tasks.deepRemoveTask("task-1", {
                deleteSnapshots: false,
                deleteImages: false,
                deleteSessions: false,
                deleteWorktrees: false,
            })
            expect(codeStore.tasks.getTask("task-1")).toBeNull()
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([])

            expect(legacyTaskRead).not.toHaveBeenCalled()
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("builds desktop task resource inventory from runtime DTOs without opening a legacy task store", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        if (!state.task) throw new Error("Expected runtime task fixture")
        const firstEvent = state.task.events[0]
        if (!firstEvent) throw new Error("Expected runtime task event fixture")
        state.task = {
            ...state.task,
            sessionIds: { last: "session-from-metadata" },
            events: [
                {
                    ...firstEvent,
                    execution: {
                        harnessId: "codex",
                        executionId: "exec-1",
                        modelId: "gpt-test",
                        events: [],
                        sessionId: "session-from-event",
                    },
                    images: [
                        {
                            id: "image-1",
                            mediaType: "image/png",
                            ext: "png",
                            originalWidth: 320,
                            originalHeight: 200,
                            resizedWidth: 320,
                            resizedHeight: 200,
                        },
                    ],
                },
                {
                    id: "snapshot-1",
                    type: "snapshot",
                    status: "completed",
                    createdAt: now,
                    completedAt: now,
                    userInput: "",
                    actionEventId: "event-1",
                    referenceBranch: "main",
                    mergeBaseCommit: "merge-base",
                    fullPatch: "",
                    patchFileId: "patch-1",
                    stats: { filesChanged: 1, insertions: 2, deletions: 1 },
                    files: [],
                },
            ],
        }
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            const legacyTaskStoreRead = vi.spyOn(codeStore, "getTaskStore")

            await expect(codeStore.tasks.getResourceInventory(["task-1"])).resolves.toEqual([
                expect.objectContaining({
                    taskId: "task-1",
                    taskTitle: "Runtime task",
                    snapshotIds: ["patch-1"],
                    images: [{ id: "image-1", ext: "png" }],
                    sessions: expect.arrayContaining([
                        { sessionId: "session-from-event", harnessId: "codex" },
                        { sessionId: "session-from-metadata", harnessId: "claude-code" },
                    ]),
                    worktree: null,
                }),
            ])
            expect(legacyTaskStoreRead).not.toHaveBeenCalled()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("routes classic file browsing, content search, and previews through task-scoped runtime project methods", async () => {
        const { client, runtime } = createRuntimeBackedClient({
            project: { ...project, path: "/tmp/runtime-repo" },
            task: { ...task, isolationStrategy: { type: "head" } },
        })
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const legacyContentSearch = vi.spyOn(filesApi, "contentSearch").mockRejectedValue(new Error("legacy content search should not be used"))
        const legacyDescribePath = vi.spyOn(filesApi, "describePath").mockRejectedValue(new Error("legacy file preview should not be used"))
        const legacyFuzzySearch = vi.spyOn(filesApi, "fuzzySearch").mockRejectedValue(new Error("legacy fuzzy search should not be used"))
        const runtimeSearch = vi.spyOn(codeStore, "searchProductProject")
        const runtimeFileRead = vi.spyOn(codeStore, "readProductProjectFile")
        const runtimeFileList = vi.spyOn(codeStore, "listProductProjectFiles")
        const runtimeFuzzySearch = vi.spyOn(codeStore, "fuzzySearchProductProjectFiles")

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            const taskModel = codeStore.tasks.getTaskModel("task-1")
            if (!taskModel) throw new Error("Expected runtime task model")
            taskModel.contentSearch.setWorkingDir("/tmp/runtime-repo")
            taskModel.contentSearch.setQuery("needle")
            taskModel.fileBrowser.setWorkingDir("/tmp/runtime-repo")
            await taskModel.fileBrowser.openFileReference("runtime-search.ts", { line: 2 })

            await vi.waitFor(() => {
                expect(taskModel.contentSearch.contentResults).toEqual([
                    expect.objectContaining({
                        file: "src/runtime-search.ts",
                        line: 1,
                        content: expect.stringContaining("runtime needle"),
                    }),
                ])
            })
            await vi.waitFor(() => {
                expect(taskModel.contentSearch.previewData?.content).toBe(runtimeSearchFixture.content)
            })
            await vi.waitFor(() => {
                expect(taskModel.fileBrowser.activeFileData?.content).toBe(runtimeSearchFixture.content)
            })

            expect(runtimeSearch).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", query: "needle", limit: 100, caseSensitive: false })
            expect(runtimeFileRead).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                path: "src/runtime-search.ts",
                maxBytes: 5 * 1024 * 1024,
            })
            expect(runtimeFileList).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                path: "",
                maxDepth: 0,
                maxEntries: 1000,
                includeHidden: true,
                includeGenerated: true,
            })
            expect(runtimeFuzzySearch).toHaveBeenCalledWith({
                repoId: "repo-1",
                taskId: "task-1",
                query: "runtime-search.ts",
                matchDirs: false,
                limit: 12,
                includeHidden: true,
                includeGenerated: true,
            })
            expect(legacyContentSearch).not.toHaveBeenCalled()
            expect(legacyDescribePath).not.toHaveBeenCalled()
            expect(legacyFuzzySearch).not.toHaveBeenCalled()
        } finally {
            runtimeSearch.mockRestore()
            runtimeFileRead.mockRestore()
            runtimeFileList.mockRestore()
            runtimeFuzzySearch.mockRestore()
            legacyContentSearch.mockRestore()
            legacyDescribePath.mockRestore()
            legacyFuzzySearch.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("routes classic git log reads through the runtime product store", async () => {
        const { client, runtime } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const branchRead = vi.spyOn(gitApi, "listBranches").mockResolvedValue({
            branches: [{ name: "main", isDefault: true, isRemote: false }],
            defaultBranch: "main",
        })
        const worktreeRead = vi.spyOn(gitApi, "listWorkTrees").mockResolvedValue({ worktrees: [] })
        const legacyLogRead = vi.spyOn(gitApi, "getLog").mockRejectedValue(new Error("legacy git log read should not be used"))
        const legacyCommitFilesRead = vi.spyOn(gitApi, "getCommitFiles").mockRejectedValue(new Error("legacy commit-file read should not be used"))
        const legacyCommitPatchRead = vi.spyOn(gitApi, "getCommitFilePatch").mockRejectedValue(new Error("legacy commit patch read should not be used"))
        const runtimeGitLogRead = vi.spyOn(codeStore, "readProductTaskGitLog")
        const runtimeCommitFilesRead = vi.spyOn(codeStore, "readProductTaskGitCommitFiles")
        const runtimeCommitPatchRead = vi.spyOn(codeStore, "readProductTaskGitCommitFilePatch")
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(GitLogTray, {
                            taskId: "task-1",
                            workDir: "/tmp/runtime-repo",
                            currentBranch: "main",
                            className: "h-full",
                        })
                    )
                )
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain("Runtime product store commit")
                expect(runtimeGitLogRead).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", ref: "HEAD", limit: 50, skip: 0 })
                expect(runtimeCommitFilesRead).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", commit: "abc123456789" })
                expect(runtimeCommitPatchRead).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    commit: "abc123456789",
                    filePath: "README.md",
                    oldPath: undefined,
                    contextLines: 3,
                })
            })
            expect(branchRead).toHaveBeenCalled()
            expect(worktreeRead).toHaveBeenCalled()
            expect(legacyLogRead).not.toHaveBeenCalled()
            expect(legacyCommitFilesRead).not.toHaveBeenCalled()
            expect(legacyCommitPatchRead).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            runtimeGitLogRead.mockRestore()
            runtimeCommitFilesRead.mockRestore()
            runtimeCommitPatchRead.mockRestore()
            branchRead.mockRestore()
            worktreeRead.mockRestore()
            legacyLogRead.mockRestore()
            legacyCommitFilesRead.mockRestore()
            legacyCommitPatchRead.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("routes classic snapshot patch reads through the runtime product store", async () => {
        const { client, runtime, state } = createRuntimeBackedClient()
        if (!state.task) throw new Error("Expected runtime task fixture")
        state.task = {
            ...state.task,
            events: [
                ...state.task.events,
                {
                    id: "snapshot-1",
                    type: "snapshot",
                    status: "completed",
                    createdAt: now,
                    completedAt: now,
                    userInput: "",
                    actionEventId: "event-1",
                    referenceBranch: "main",
                    mergeBaseCommit: "merge-base",
                    fullPatch: "",
                    patchFileId: "patch-1",
                    stats: { filesChanged: 1, insertions: 2, deletions: 1 },
                    files: [],
                },
            ],
        }
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const legacyPatchRead = vi.spyOn(snapshotsApi, "loadPatch").mockRejectedValue(new Error("legacy snapshot patch read should not be used"))
        const legacyIndexRead = vi.spyOn(snapshotsApi, "loadIndex").mockRejectedValue(new Error("legacy snapshot index read should not be used"))
        const legacySliceRead = vi.spyOn(snapshotsApi, "loadPatchSlice").mockRejectedValue(new Error("legacy snapshot slice read should not be used"))
        const runtimeSliceRead = vi.spyOn(codeStore, "readProductTaskSnapshotPatchSlice")
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            const snapshotModel = codeStore.tasks.getTaskModel("task-1")?.events.find((event) => event.id === "snapshot-1") as SnapshotEventModel | undefined
            if (!snapshotModel) throw new Error("Expected snapshot event model")

            await snapshotModel.loadIndex()
            expect(snapshotModel.patchIndex).toEqual(
                expect.objectContaining({
                    files: [expect.objectContaining({ path: "README.md", insertions: 2, deletions: 1 })],
                })
            )

            await snapshotModel.loadPatch()
            expect(snapshotModel.fullPatch).toContain("+snapshot product store")

            await expect(
                codeStore.readProductTaskSnapshotPatchSlice({
                    repoId: "repo-1",
                    taskId: "task-1",
                    eventId: "snapshot-1",
                    start: 0,
                    end: snapshotPatch.length,
                })
            ).resolves.toMatchObject({ patch: expect.stringContaining("+snapshot product store") })
            runtimeSliceRead.mockClear()

            await act(async () => {
                root.render(
                    createElement(
                        CodeStoreProvider,
                        { store: codeStore },
                        createElement(ViewPatch, {
                            patchFileId: "patch-1",
                            patchIndex: snapshotModel.patchIndex,
                            taskId: "task-1",
                            snapshotEventId: "snapshot-1",
                        })
                    )
                )
            })

            await vi.waitFor(() => {
                expect(container.textContent).toContain("README.md")
                expect(runtimeSliceRead).toHaveBeenCalledWith({
                    repoId: "repo-1",
                    taskId: "task-1",
                    eventId: "snapshot-1",
                    start: 0,
                    end: snapshotPatch.length,
                })
                expect(container.textContent).not.toContain("Could not load patch preview")
                expect(container.textContent).not.toContain("Loading file diff")
            })
            expect(legacyPatchRead).not.toHaveBeenCalled()
            expect(legacyIndexRead).not.toHaveBeenCalled()
            expect(legacySliceRead).not.toHaveBeenCalled()
        } finally {
            act(() => root.unmount())
            container.remove()
            legacyPatchRead.mockRestore()
            legacyIndexRead.mockRestore()
            legacySliceRead.mockRestore()
            runtimeSliceRead.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("keeps a cached runtime snapshot as the read source during transient bridge errors", async () => {
        const { client, runtime } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            codeStore.runtimeProductStoreStatus = "error"
            codeStore.runtimeProductStoreError = "transient refresh failure"

            expect(codeStore.shouldUseRuntimeProductReads()).toBe(true)
            expect(codeStore.repos.getRepo("repo-1")).toEqual(expect.objectContaining({ id: "repo-1", name: "Runtime Repo" }))
            expect(codeStore.tasks.getTaskModel("task-1")?.exists).toBe(true)
            expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([expect.objectContaining({ id: "task-1", title: "Runtime task" })])
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("emits rollout telemetry when enabled runtime reads fall back to a legacy task store", async () => {
        const { client, runtime } = createRuntimeBackedClient()
        const trackSpy = vi.spyOn(analytics, "track").mockImplementation(() => undefined)
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()

            await expect(codeStore.getTaskStore("repo-1", "task-1")).rejects.toThrow("RepoStore not initialized")

            expect(trackSpy).toHaveBeenCalledWith(
                "runtime_product_store_fallback",
                expect.objectContaining({
                    source: "task_store",
                    reason: "direct_task_store_read",
                    enabled: true,
                    status: "ready",
                    hasSnapshot: true,
                    repoCount: 1,
                    taskPreviewCount: 1,
                })
            )
        } finally {
            trackSpy.mockRestore()
            warnSpy.mockRestore()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("prunes repo-scoped desktop bridge state from real repo deletion notifications", async () => {
        const { client, runtime, server, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            expect(codeStore.repos.repos).toEqual([expect.objectContaining({ id: "repo-1" })])
            expect(codeStore.tasks.getTask("task-1")).toMatchObject({ id: "task-1" })

            state.project = null
            state.task = null
            server.notify("openade/repo/deleted", { repoId: "repo-1" })

            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimeProductSnapshot?.repos).toEqual([])
                expect(codeStore.repos.repos).toEqual([])
                expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([])
                expect(codeStore.tasks.getTask("task-1")).toBeNull()
                expect(codeStore.tasks.getTaskModel("task-1")).toBeNull()
            })
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("runs after-event callbacks from runtime DTO task events when a task runtime settles", async () => {
        const { client, runtime, server, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })
        const afterEvents: Array<{ taskId: string; eventType: string }> = []
        const unsubscribe = codeStore.execution.onAfterEvent((taskId, eventType) => {
            afterEvents.push({ taskId, eventType })
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            const legacyTaskRefresh = vi.spyOn(codeStore, "refreshTaskStoreFromStorage")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            server.notify("runtime/updated", runtimeRecord("running", "2026-05-31T00:01:00.000Z"))
            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(true)
            })

            state.task = {
                ...cloneTask(task),
                updatedAt: "2026-05-31T00:02:00.000Z",
                events: [
                    ...task.events,
                    {
                        id: "event-run-plan",
                        type: "action",
                        status: "completed",
                        createdAt: "2026-05-31T00:02:00.000Z",
                        completedAt: "2026-05-31T00:02:01.000Z",
                        userInput: "Run the accepted plan",
                        execution: {
                            harnessId: "codex",
                            executionId: "exec-run-plan",
                            modelId: "gpt-test",
                            events: [],
                        },
                        source: { type: "run_plan", userLabel: "Run Plan", planEventId: "event-1" },
                        includesCommentIds: [],
                        result: { success: true },
                    },
                ],
            }
            server.notify("runtime/completed", runtimeRecord("completed", "2026-05-31T00:02:02.000Z"))

            await waitForRuntimeBridge(() => {
                expect(afterEvents).toEqual([{ taskId: "task-1", eventType: "run_plan" }])
                expect(codeStore.runtimes.isTaskRunning("task-1")).toBe(false)
                expect(codeStore.tasks.getTask("task-1")?.events.map((event) => event.id)).toEqual(["event-1", "event-run-plan"])
            })
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
        } finally {
            unsubscribe()
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })

    it("refreshes cached desktop bridge state from real runtime notifications", async () => {
        const { client, runtime, server, state } = createRuntimeBackedClient()
        const codeStore = new CodeStore({
            getCurrentUser: () => ({ id: "user-1", email: "user@example.com" }),
            navigateToTask: () => undefined,
            enableRuntimeProductStore: true,
            runtimeProductStoreFactory: () => new OpenADEProductStore(client),
            runtimeNotificationSource: runtime,
        })

        try {
            await codeStore.initializeRuntimeProductStore()
            await codeStore.loadRuntimeProductTask("repo-1", "task-1")

            const legacyTaskRefresh = vi.spyOn(codeStore, "refreshTaskStoreFromStorage")
            const legacyRepoRefresh = vi.spyOn(codeStore, "refreshRepoStoreFromStorage")

            state.task = {
                ...cloneTask(task),
                title: "Runtime notification task",
                updatedAt: "2026-05-31T00:01:00.000Z",
                events: [
                    ...task.events,
                    {
                        id: "event-2",
                        type: "action",
                        status: "completed",
                        createdAt: "2026-05-31T00:01:00.000Z",
                        completedAt: "2026-05-31T00:01:01.000Z",
                        userInput: "Refresh from runtime notification",
                        execution: {
                            harnessId: "codex",
                            executionId: "exec-2",
                            modelId: "gpt-test",
                            events: [],
                        },
                        source: { type: "ask", userLabel: "Ask" },
                        includesCommentIds: [],
                        result: { success: true },
                    },
                ],
                comments: [
                    ...task.comments,
                    {
                        id: "comment-2",
                        content: "Runtime notification refreshed",
                        source: { type: "llm_output", eventId: "event-2", lineStart: 1, lineEnd: 1 },
                        selectedText: { text: "notification", linesBefore: "", linesAfter: "" },
                        author: { id: "user-1", email: "user@example.com" },
                        createdAt: "2026-05-31T00:01:00.000Z",
                    },
                ],
            }
            server.notify("openade/task/updated", { repoId: "repo-1", taskId: "task-1" })

            await waitForRuntimeBridge(() => {
                expect(codeStore.tasks.getTask("task-1")).toMatchObject({
                    title: "Runtime notification task",
                    events: [
                        expect.objectContaining({ id: "event-1" }),
                        expect.objectContaining({ id: "event-2", source: expect.objectContaining({ type: "ask" }) }),
                    ],
                    comments: [expect.objectContaining({ id: "comment-1" }), expect.objectContaining({ id: "comment-2" })],
                })
            })

            state.task = {
                ...state.task,
                title: "Runtime preview notification task",
                closed: true,
                lastEventAt: "2026-05-31T00:02:00.000Z",
            }
            server.notify("openade/task/previewChanged", { repoId: "repo-1", taskId: "task-1" })

            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimeProductSnapshot?.repos[0]?.tasks).toEqual([
                    expect.objectContaining({
                        id: "task-1",
                        title: "Runtime preview notification task",
                        closed: true,
                        lastEventAt: "2026-05-31T00:02:00.000Z",
                    }),
                ])
                expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([
                    expect.objectContaining({
                        id: "task-1",
                        title: "Runtime preview notification task",
                        closed: true,
                    }),
                ])
            })

            state.task = null
            server.notify("openade/task/deleted", { repoId: "repo-1", taskId: "task-1" })

            await waitForRuntimeBridge(() => {
                expect(codeStore.runtimeProductSnapshot?.repos[0]?.tasks).toEqual([])
                expect(codeStore.getTaskPreviewsForRepo("repo-1")).toEqual([])
                expect(codeStore.tasks.getTask("task-1")).toBeNull()
                expect(codeStore.tasks.getTaskModel("task-1")).toBeNull()
            })
            expect(legacyTaskRefresh).not.toHaveBeenCalled()
            expect(legacyRepoRefresh).not.toHaveBeenCalled()
        } finally {
            codeStore.disconnectAllStores()
            await runtime.close()
        }
    })
})
