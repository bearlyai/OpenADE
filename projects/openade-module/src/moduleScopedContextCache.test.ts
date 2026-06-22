import { describe, expect, it } from "vitest"
import { OPENADE_METHOD } from "../../openade-client/src"
import { RuntimeServer, type RuntimeConnection } from "../../runtime/src"
import { createOpenADEModule, type OpenADEModuleAdapters, type OpenADEScopedHostAdapter } from "./module"
import type { OpenADEProject, OpenADETask } from "./types"

type ScopedProjectGitInfoParams = Parameters<OpenADEScopedHostAdapter["readProjectGitInfo"]>[0]
type ScopedTaskGitSummaryParams = Parameters<OpenADEScopedHostAdapter["readTaskGitSummary"]>[0]

function connection(): RuntimeConnection {
    return {
        id: "module-scoped-cache-test",
        send: () => undefined,
    }
}

async function runtimeRequest<T>(server: RuntimeServer, method: string, params?: unknown): Promise<T> {
    const response = await server.handleRequest({ id: `${method}-test`, method, params }, connection())
    if (response.error) throw new Error(`${response.error.code}: ${response.error.message}`)
    return response.result as T
}

function unsupported(): Promise<never> {
    throw new Error("unsupported test adapter")
}

function createCountingRuntime(): {
    server: RuntimeServer
    readProjectsCount: () => number
    readTaskCount: () => number
} {
    let readProjectsCount = 0
    let readTaskCount = 0
    let taskTitle = "Scoped cache task"

    const project: OpenADEProject = {
        id: "repo-1",
        name: "Repo",
        path: "/tmp/repo",
        tasks: [
            {
                id: "task-1",
                slug: "task-1",
                title: taskTitle,
                createdAt: "2026-06-14T00:00:00.000Z",
            },
        ],
    }

    const task = (): OpenADETask => ({
        id: "task-1",
        repoId: project.id,
        slug: "task-1",
        title: taskTitle,
        description: "",
        isolationStrategy: { type: "head" },
        deviceEnvironments: [],
        events: [],
        comments: [],
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z",
    })

    const scopedHost = {
        readProjectGitInfo: async ({ repo }: ScopedProjectGitInfoParams) => ({
            repoId: repo.id,
            isGitRepo: true,
            repoRoot: repo.path,
            relativePath: "",
            mainBranch: "main",
            hasGhCli: false,
        }),
        readTaskGitSummary: async ({ repo, task }: ScopedTaskGitSummaryParams) => ({
            repoId: repo.id,
            taskId: task.id,
            branch: "main",
            headCommit: "abc123",
            ahead: 0,
            hasChanges: false,
            staged: { files: [], stats: { additions: 0, deletions: 0 } },
            unstaged: { files: [], stats: { additions: 0, deletions: 0 } },
            untracked: [],
        }),
    } as unknown as OpenADEScopedHostAdapter

    const adapters: OpenADEModuleAdapters = {
        readSnapshot: async () => ({
            server: {
                version: "test",
                hostName: "test-host",
                theme: {
                    setting: "system",
                    className: "code-theme-light",
                },
            },
            repos: [project],
            workingTaskIds: [],
        }),
        readProjects: async () => {
            readProjectsCount += 1
            return [project]
        },
        readTaskList: async () => project.tasks,
        readTask: async () => {
            readTaskCount += 1
            return task()
        },
        listDataDocuments: async () => [],
        readDataDocumentBase64: async () => null,
        saveDataDocumentBase64: unsupported,
        deleteDataDocument: unsupported,
        createRepo: unsupported,
        updateRepo: unsupported,
        deleteRepo: unsupported,
        createTask: unsupported,
        startTurn: unsupported,
        startReview: unsupported,
        interruptTurn: unsupported,
        enqueueQueuedTurn: unsupported,
        reorderQueuedTurns: unsupported,
        cancelQueuedTurn: unsupported,
        deleteTask: unsupported,
        setupTaskEnvironment: unsupported,
        createActionEvent: unsupported,
        appendActionStreamEvent: unsupported,
        completeActionEvent: unsupported,
        errorActionEvent: unsupported,
        stoppedActionEvent: unsupported,
        reconcileActionEventRuntime: unsupported,
        updateActionExecution: unsupported,
        addHyperPlanSubExecution: unsupported,
        appendHyperPlanSubExecutionStreamEvent: unsupported,
        updateHyperPlanSubExecution: unsupported,
        setHyperPlanReconcileLabels: unsupported,
        createSnapshotEvent: unsupported,
        createComment: unsupported,
        editComment: unsupported,
        deleteComment: unsupported,
        updateTaskMetadata: async (params) => {
            taskTitle = params.title ?? taskTitle
        },
        scopedHost,
    }

    const server = new RuntimeServer({
        serverName: "module-scoped-cache-runtime",
        protocolVersion: 1,
    })
    server.registerModule(createOpenADEModule(adapters))

    return {
        server,
        readProjectsCount: () => readProjectsCount,
        readTaskCount: () => readTaskCount,
    }
}

describe("OpenADE module scoped host context cache", () => {
    it("reuses project and task projection across adjacent scoped host requests and invalidates after mutation", async () => {
        const { server, readProjectsCount, readTaskCount } = createCountingRuntime()

        await runtimeRequest(server, "initialize", {
            clientName: "module-scoped-cache-test",
            protocolVersion: 1,
        })
        await runtimeRequest(server, OPENADE_METHOD.projectGitInfoRead, { repoId: "repo-1" })
        await runtimeRequest(server, OPENADE_METHOD.taskGitSummaryRead, { repoId: "repo-1", taskId: "task-1" })
        await runtimeRequest(server, OPENADE_METHOD.taskGitSummaryRead, { repoId: "repo-1", taskId: "task-1" })

        expect(readProjectsCount()).toBe(1)
        expect(readTaskCount()).toBe(1)

        await runtimeRequest(server, OPENADE_METHOD.taskMetadataUpdate, {
            taskId: "task-1",
            title: "Changed title",
            clientRequestId: "invalidate-scoped-context",
        })
        await runtimeRequest(server, OPENADE_METHOD.taskGitSummaryRead, { repoId: "repo-1", taskId: "task-1" })

        expect(readProjectsCount()).toBe(2)
        expect(readTaskCount()).toBe(2)
    })
})
