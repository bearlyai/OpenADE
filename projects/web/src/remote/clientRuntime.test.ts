import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OpenADEClientOptions } from "../../../openade-client/src"
import type { OpenADESnapshot, OpenADETask, OpenADETurnStartResult } from "../../../openade-module/src"
import type { RuntimeClientOptions } from "../../../runtime-client/src"
import {
    type RemoteConfig,
    __setRemoteClientConstructorsForTest,
    cancelRemoteQueuedTurn,
    createRemoteComment,
    deleteRemoteTask,
    getSnapshot,
    getTask,
    reconnectRemoteProjectProcess,
    startRemoteReview,
    startRemoteTurn,
    subscribeRemoteChanges,
    updateRemoteTaskMetadata,
} from "./client"

const runtimeClients: RuntimeClient[] = []
const openadeClients: OpenADEClient[] = []
const changeListeners: Array<(notification: { method: string; params?: unknown }) => void> = []
let testRun = 0
let startTurnResult: OpenADETurnStartResult = { taskId: "task-1" }
let getTaskFailures = 0
let restoreClientConstructors: (() => void) | undefined

class RuntimeClient {
    close = vi.fn()
    request = vi.fn()
    subscribe = vi.fn(() => () => undefined)

    constructor(readonly options: RuntimeClientOptions) {
        runtimeClients.push(this)
    }
}

class OpenADEClient {
    getSnapshot = vi.fn(
        async (): Promise<OpenADESnapshot> => ({
            repos: [],
            workingTaskIds: [],
            server: { version: "test", hostName: "test", theme: { setting: "system", className: "code-theme-light" } },
        })
    )
    getTask = vi.fn(async (): Promise<OpenADETask> => {
        if (getTaskFailures > 0) {
            getTaskFailures -= 1
            throw new Error("Runtime socket disconnected")
        }
        return {
            id: "task-1",
            repoId: "repo-1",
            slug: "task-1",
            title: "Task",
            description: "",
            events: [],
            comments: [],
            deviceEnvironments: [],
        }
    })
    startTurn = vi.fn(async (): Promise<OpenADETurnStartResult> => startTurnResult)
    listProjectFiles = vi.fn(async () => ({ repoId: "repo-1", path: "", entries: [], truncated: false }))
    readProjectFile = vi.fn(async () => ({ repoId: "repo-1", path: "README.md", encoding: "utf8" as const, size: 0, tooLarge: false, content: "" }))
    fuzzySearchProjectFiles = vi.fn(async () => ({ repoId: "repo-1", results: [], truncated: false, source: "filesystem" as const }))
    writeProjectFile = vi.fn(async (args: { repoId: string; path: string; content: string }) => ({
        repoId: args.repoId,
        path: args.path,
        size: args.content.length,
    }))
    searchProject = vi.fn(async () => ({ repoId: "repo-1", matches: [], truncated: false }))
    listProjectProcesses = vi.fn(async () => ({
        repoId: "repo-1",
        searchRoot: "/tmp/repo",
        repoRoot: "/tmp/repo",
        isWorktree: false,
        processes: [],
        errors: [],
        instances: [],
    }))
    startProjectProcess = vi.fn(async () => ({
        repoId: "repo-1",
        definitionId: "openade.toml::Echo",
        processId: "proc-remote-test",
        runtimeId: "process:proc-remote-test",
    }))
    reconnectProjectProcess = vi.fn(async () => ({ repoId: "repo-1", processId: "proc-remote-test", found: true, output: [] }))
    stopProjectProcess = vi.fn(async () => ({ repoId: "repo-1", processId: "proc-remote-test", ok: true }))
    startTaskTerminal = vi.fn(async () => ({
        repoId: "repo-1",
        taskId: "task-1",
        terminalId: "openade-task-terminal-test",
        runtimeId: "pty:openade-task-terminal-test",
        ok: true,
    }))
    reconnectTaskTerminal = vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", terminalId: "openade-task-terminal-test", found: true, output: [] }))
    writeTaskTerminal = vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", terminalId: "openade-task-terminal-test", ok: true }))
    resizeTaskTerminal = vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", terminalId: "openade-task-terminal-test", ok: true }))
    stopTaskTerminal = vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", terminalId: "openade-task-terminal-test", ok: true }))
    readTaskGitSummary = vi.fn(async () => ({
        repoId: "repo-1",
        taskId: "task-1",
        branch: "main",
        headCommit: "abc123",
        ahead: 0,
        hasChanges: false,
        staged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
        unstaged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
        untracked: [],
    }))
    readTaskChanges = vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", files: [], fromTreeish: "HEAD", toTreeish: "" }))
    readTaskDiff = vi.fn(async () => ({
        repoId: "repo-1",
        taskId: "task-1",
        filePath: "README.md",
        fromTreeish: "HEAD",
        toTreeish: "",
        patch: "",
        truncated: false,
        heavy: false,
        stats: { insertions: 0, deletions: 0, changedLines: 0, hunkCount: 0 },
    }))
    readTaskFilePair = vi.fn(async () => ({
        repoId: "repo-1",
        taskId: "task-1",
        filePath: "README.md",
        fromTreeish: "HEAD",
        toTreeish: "",
        before: "before\n",
        after: "after\n",
    }))
    readTaskGitLog = vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", commits: [], hasMore: false }))
    readTaskGitCommitFiles = vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", commit: "abc123", files: [] }))
    readTaskGitFileAtTreeish = vi.fn(async () => ({
        repoId: "repo-1",
        taskId: "task-1",
        treeish: "abc123",
        filePath: "README.md",
        content: "",
        exists: true,
    }))
    readTaskGitCommitFilePatch = vi.fn(async () => ({
        repoId: "repo-1",
        taskId: "task-1",
        commit: "abc123",
        filePath: "README.md",
        patch: "",
        truncated: false,
        heavy: false,
        stats: { insertions: 0, deletions: 0, changedLines: 0, hunkCount: 0 },
    }))
    commitTaskGit = vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", committed: false, status: "nothing_to_commit" as const }))
    readTaskImage = vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", imageId: "image-1", ext: "png", mediaType: "image/png", data: "" }))
    readTaskSnapshotPatch = vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", eventId: "snapshot-1", patch: "" }))
    readTaskSnapshotIndex = vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", eventId: "snapshot-1", index: null }))
    readTaskSnapshotPatchSlice = vi.fn(async () => ({ repoId: "repo-1", taskId: "task-1", eventId: "snapshot-1", patch: "" }))
    createRepo = vi.fn(async () => ({ repoId: "repo-1", createdAt: "2026-05-31T00:00:00.000Z" }))
    updateRepo = vi.fn(async () => undefined)
    deleteRepo = vi.fn(async () => undefined)
    startReview = vi.fn(async (args: { taskId: string }) => ({ taskId: args.taskId }))
    interruptTurn = vi.fn(async () => undefined)
    cancelQueuedTurn = vi.fn(async (args: { taskId: string; queuedTurnId: string }) => ({
        taskId: args.taskId,
        queuedTurnId: args.queuedTurnId,
        cancelled: true,
    }))
    updateTaskMetadata = vi.fn(async () => undefined)
    createComment = vi.fn(async (args: { commentId?: string }) => ({ commentId: args.commentId ?? "comment-1", createdAt: "2026-05-31T00:00:00.000Z" }))
    editComment = vi.fn(async () => undefined)
    deleteComment = vi.fn(async () => undefined)
    deleteTask = vi.fn(async (args: { repoId: string; taskId: string }) => ({ repoId: args.repoId, taskId: args.taskId, deleted: true as const }))
    setupTaskEnvironment = vi.fn(async () => undefined)
    subscribeToChanges = vi.fn((listener: (notification: { method: string; params?: unknown }) => void) => {
        changeListeners.push(listener)
        return () => {
            const index = changeListeners.indexOf(listener)
            if (index >= 0) changeListeners.splice(index, 1)
        }
    })

    constructor(readonly options: OpenADEClientOptions) {
        openadeClients.push(this)
    }
}

function config(overrides: Partial<RemoteConfig> = {}): RemoteConfig {
    const host = `100.64.1.${testRun + 1}:7823`
    return {
        id: `host-${testRun}`,
        baseUrl: `http://${host}`,
        token: "token-1",
        host,
        savedAt: "2026-05-27T00:00:00.000Z",
        lastUsedAt: "2026-05-27T00:00:00.000Z",
        ...overrides,
    }
}

beforeEach(() => {
    restoreClientConstructors?.()
    restoreClientConstructors = __setRemoteClientConstructorsForTest({
        RuntimeClient,
        OpenADEClient,
    })
    testRun += 1
    localStorage.clear()
    runtimeClients.length = 0
    openadeClients.length = 0
    changeListeners.length = 0
    startTurnResult = { taskId: "task-1" }
    getTaskFailures = 0
    vi.useRealTimers()
})

afterEach(() => {
    restoreClientConstructors?.()
    restoreClientConstructors = undefined
})

describe("companion remote runtime client cache", () => {
    it("reuses one runtime socket client for repeated calls to the same paired host", async () => {
        const remote = config()

        await getSnapshot(remote)
        await getTask(remote, "repo-1", "task-1")
        const unsubscribeA = subscribeRemoteChanges(remote, vi.fn())
        const unsubscribeB = subscribeRemoteChanges(remote, vi.fn())
        await startRemoteTurn(remote, { repoId: "repo-1", type: "ask", input: "hello" })

        expect(runtimeClients).toHaveLength(1)
        expect(openadeClients).toHaveLength(1)
        expect(openadeClients[0].getSnapshot).toHaveBeenCalledTimes(2)
        expect(openadeClients[0].getTask).toHaveBeenCalledTimes(2)
        expect(openadeClients[0].getTask).toHaveBeenCalledWith("repo-1", "task-1", {})
        expect(openadeClients[0].subscribeToChanges).toHaveBeenCalledTimes(2)
        expect(openadeClients[0].startTurn).toHaveBeenCalledWith({ repoId: "repo-1", type: "ask", input: "hello" }, {})

        unsubscribeA()
        unsubscribeB()
    })

    it("passes task read hydration options through to the runtime protocol", async () => {
        const remote = config()

        await getTask(remote, "repo-1", "task-1", { hydrateSessionEvents: false })

        expect(openadeClients[0].getTask).toHaveBeenCalledWith("repo-1", "task-1", { hydrateSessionEvents: false })
    })

    it("retries transient runtime socket failures for reads", async () => {
        vi.useFakeTimers()
        getTaskFailures = 1

        const task = getTask(config(), "repo-1", "task-1", { hydrateSessionEvents: false })
        await vi.advanceTimersByTimeAsync(250)

        await expect(task).resolves.toEqual(
            expect.objectContaining({
                id: "task-1",
                repoId: "repo-1",
                events: [],
            })
        )
        expect(openadeClients[0].getTask).toHaveBeenCalledTimes(2)
    })

    it("closes and replaces the runtime socket client when saved credentials change", async () => {
        await getSnapshot(config())
        const firstRuntime = runtimeClients[0]

        await getSnapshot(config({ token: "token-2" }))

        expect(firstRuntime.close).toHaveBeenCalledTimes(1)
        expect(runtimeClients).toHaveLength(2)
        expect(openadeClients).toHaveLength(2)
    })

    it("forwards realtime socket statuses without treating lag as a connection state", async () => {
        const onEvent = vi.fn()
        const onStatus = vi.fn()

        subscribeRemoteChanges(config(), onEvent, onStatus)
        const runtimeOptions = runtimeClients[0].options as { onStatus?: (status: string) => void }
        runtimeOptions.onStatus?.("connected")
        changeListeners[0]({ method: "connection/lagged", params: { requestedCursor: "1", oldestCursor: "10" } })

        expect(onStatus).toHaveBeenCalledWith("connected")
        expect(onStatus).not.toHaveBeenCalledWith("lagged")
        expect(onEvent).toHaveBeenCalledTimes(1)
        expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ method: "connection/lagged" }))
    })

    it("replays the current runtime socket status to a new mobile subscription", async () => {
        const remote = config()
        const firstStatus = vi.fn()

        const unsubscribe = subscribeRemoteChanges(remote, vi.fn(), firstStatus)
        const runtimeOptions = runtimeClients[0].options as { onStatus?: (status: string) => void }
        runtimeOptions.onStatus?.("connected")
        unsubscribe()

        const secondStatus = vi.fn()
        subscribeRemoteChanges(remote, vi.fn(), secondStatus)
        await Promise.resolve()

        expect(secondStatus).toHaveBeenCalledWith("connected")
        expect(runtimeClients).toHaveLength(1)
    })

    it("preserves queued turn start results from the runtime protocol", async () => {
        startTurnResult = { taskId: "task-1", queued: true, queuedTurnId: "queued-1" }

        await expect(startRemoteTurn(config(), { repoId: "repo-1", type: "do", input: "after this" })).resolves.toEqual({
            taskId: "task-1",
            queued: true,
            queuedTurnId: "queued-1",
        })
    })

    it("routes product mutations through the shared remote product store", async () => {
        const remote = config()
        await getTask(remote, "repo-1", "task-1")

        await expect(
            startRemoteReview(remote, {
                repoId: "repo-1",
                taskId: "task-1",
                reviewType: "work",
                harnessId: "codex",
                modelId: "model-1",
            })
        ).resolves.toEqual({ taskId: "task-1" })
        await expect(cancelRemoteQueuedTurn(remote, { repoId: "repo-1", taskId: "task-1", queuedTurnId: "queued-1" })).resolves.toEqual({
            taskId: "task-1",
            queuedTurnId: "queued-1",
            cancelled: true,
        })
        await updateRemoteTaskMetadata(remote, { taskId: "task-1", title: "Updated" })
        await expect(reconnectRemoteProjectProcess(remote, { repoId: "repo-1", processId: "proc-remote-test" })).resolves.toEqual({
            repoId: "repo-1",
            processId: "proc-remote-test",
            found: true,
            output: [],
        })
        await expect(
            createRemoteComment(remote, {
                taskId: "task-1",
                commentId: "comment-1",
                content: "Comment",
                source: { type: "manual" },
                selectedText: { text: "Comment", linesBefore: "", linesAfter: "" },
                author: { id: "user-1", email: "user@example.com" },
            })
        ).resolves.toEqual({ commentId: "comment-1", createdAt: "2026-05-31T00:00:00.000Z" })
        await expect(deleteRemoteTask(remote, { repoId: "repo-1", taskId: "task-1" })).resolves.toEqual({
            repoId: "repo-1",
            taskId: "task-1",
            deleted: true,
        })

        expect(openadeClients[0].startReview).toHaveBeenCalledWith(expect.objectContaining({ repoId: "repo-1", taskId: "task-1", reviewType: "work" }), {})
        expect(openadeClients[0].cancelQueuedTurn).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", queuedTurnId: "queued-1" }, {})
        expect(openadeClients[0].updateTaskMetadata).toHaveBeenCalledWith({ taskId: "task-1", title: "Updated" }, {})
        expect(openadeClients[0].reconnectProjectProcess).toHaveBeenCalledWith({ repoId: "repo-1", processId: "proc-remote-test" })
        expect(openadeClients[0].createComment).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-1", commentId: "comment-1" }), {})
        expect(openadeClients[0].deleteTask).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1" }, {})
    })
})
