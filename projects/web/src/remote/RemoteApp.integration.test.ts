import { act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OpenADEClient } from "../../../openade-client/src"
import {
    createOpenADEModule,
    publishOpenADECompanionEvent,
    type OpenADEModuleAdapters,
    type OpenADEScopedHostAdapter,
} from "../../../openade-module/src/module"
import {
    type OpenADECommentCreateRequest,
    type OpenADECommentDeleteRequest,
    type OpenADECommentEditRequest,
    type OpenADEProject,
    type OpenADEProjectProcessInstance,
    type OpenADEQueuedTurn,
    type OpenADESnapshot,
    type OpenADETask,
    type OpenADETaskDeleteRequest,
    type OpenADETaskMetadataUpdateRequest,
    type OpenADETaskPreview,
} from "../../../openade-module/src/types"
import { type RuntimeClientOptions, RuntimeLocalClient, type RuntimeLocalTransport } from "../../../runtime-client/src"
import type { RuntimeMessage, RuntimeRequest } from "../../../runtime-protocol/src"
import type { RuntimeConnection } from "../../../runtime/src"
import { RuntimeServer } from "../../../runtime/src"
import { runtimeSocketUrl } from "../kernel/session"
import { REMOTE_THEME_STORAGE_KEY, RemoteApp } from "./RemoteApp"
import { REMOTE_CONFIG_STORAGE_KEY, __setRemoteClientConstructorsForTest, loadRemoteConfig, loadRemoteConfigs } from "./client"

const now = "2026-05-31T00:00:00.000Z"

let restoreClientConstructors: (() => void) | undefined

function createRuntimeLocalTransport(server: RuntimeServer): RuntimeLocalTransport {
    const listeners = new Set<(message: RuntimeMessage) => void>()
    let dispose: (() => void) | null = null
    const connection: RuntimeConnection = {
        id: `remote-app-test-${Math.random().toString(36).slice(2)}`,
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
        onMessage(listener: (message: RuntimeMessage) => void) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
    return transport
}

type RuntimeClientConstructor = new (options: RuntimeClientOptions) => RuntimeLocalClient

function createSnapshotRuntimeServer(snapshot: OpenADESnapshot): RuntimeServer {
    const server = new RuntimeServer({ serverName: `${snapshot.server.hostName}-runtime`, protocolVersion: 1 })
    server.register("openade/snapshot/read", () => snapshot)
    server.registerNotification("openade/snapshotChanged")
    return server
}

function createSnapshotRuntimeConstructors(sessions: Array<{ baseUrl: string; snapshot: OpenADESnapshot }>): {
    RuntimeClient: RuntimeClientConstructor
    OpenADEClient: typeof OpenADEClient
} {
    const servers = new Map<string, RuntimeServer>()
    for (const session of sessions) {
        servers.set(runtimeSocketUrl({ baseUrl: session.baseUrl }), createSnapshotRuntimeServer(session.snapshot))
    }

    class MultiSessionRuntimeClient extends RuntimeLocalClient {
        constructor(options: RuntimeClientOptions) {
            const server = servers.get(options.url)
            if (!server) throw new Error(`Missing test runtime server for ${options.url}`)
            super(createRuntimeLocalTransport(server), {
                clientName: options.clientName,
                clientVersion: options.clientVersion,
                clientPlatform: options.clientPlatform,
                protocolVersion: options.protocolVersion,
            })
        }
    }

    return { RuntimeClient: MultiSessionRuntimeClient, OpenADEClient }
}

function createRuntimeBackedConstructors(state: {
    taskDeleted: boolean
    processRunning: boolean
    selfRevoked: boolean
    task: OpenADETask
    queuedTurn: OpenADEQueuedTurn
}): {
    RuntimeClient: RuntimeClientConstructor
    OpenADEClient: typeof OpenADEClient
} {
    const server = new RuntimeServer({ serverName: "remote-app-test-runtime", protocolVersion: 1 })
    const preview: OpenADETaskPreview = {
        id: state.task.id,
        slug: state.task.slug,
        title: state.task.title,
        createdAt: now,
        closed: state.task.closed,
    }
    const project: OpenADEProject = {
        id: "repo-1",
        name: "Runtime Repo",
        path: "/tmp/openade-runtime-repo",
        tasks: [preview],
    }

    function snapshot(options?: { version?: string; hostName?: string; workingTaskIds?: string[] }): OpenADESnapshot {
        return {
            server: {
                version: options?.version ?? "test",
                hostName: options?.hostName ?? "test-host",
                theme: { setting: "system", className: "code-theme-light", label: "Light" },
            },
            repos: [project],
            workingTaskIds: options?.workingTaskIds ?? [],
        }
    }

    function publishTaskChanged(previewChanged = true): void {
        publishOpenADECompanionEvent(server, { type: "task_changed", repoId: "repo-1", taskId: state.task.id, previewChanged, at: now })
    }

    function readTaskDto(): OpenADETask {
        return {
            ...state.task,
            deviceEnvironments: [...state.task.deviceEnvironments],
            queuedTurns: state.task.queuedTurns?.map((turn) => ({ ...turn })),
            events: [...state.task.events],
            comments: [...state.task.comments],
        }
    }

    function processInstance(): OpenADEProjectProcessInstance {
        return {
            processId: "proc-test",
            definitionId: "openade.toml::Phone Echo",
            repoId: "repo-1",
            cwd: "/tmp/openade-runtime-repo",
            completed: false,
            exitCode: null,
            signal: null,
            pid: 123,
        }
    }

    const scopedHost: OpenADEScopedHostAdapter = {
        listProjectFiles: async (params) => ({
            repoId: params.repoId,
            path: params.path ?? "",
            entries: [
                { path: "README.md", name: "README.md", type: "file", size: 19 },
                { path: "src", name: "src", type: "directory" },
            ],
            truncated: false,
        }),
        readProjectFile: async (params) => ({
            repoId: params.repoId,
            path: params.path,
            encoding: params.encoding ?? "utf8",
            size: "remote project file".length,
            tooLarge: false,
            content: params.path === "README.md" ? "remote project file" : "",
        }),
        writeProjectFile: async (params) => ({ repoId: params.repoId, path: params.path, size: params.content.length }),
        fuzzySearchProjectFiles: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            results: params.query === "remote" ? ["README.md"] : [],
            truncated: false,
            source: "filesystem",
        }),
        searchProject: async (params) => ({
            repoId: params.repoId,
            matches: params.query === "remote" ? [{ path: "README.md", line: 1, content: "remote project file search hit", matchStart: 0, matchEnd: 6 }] : [],
            truncated: false,
        }),
        listProjectProcesses: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            searchRoot: "/tmp/openade-runtime-repo",
            repoRoot: "/tmp/openade-runtime-repo",
            isWorktree: false,
            processes: [
                {
                    id: "openade.toml::Phone Echo",
                    name: "Phone Echo",
                    command: "printf phone",
                    type: "task",
                    configPath: "openade.toml",
                    cwd: "/tmp/openade-runtime-repo",
                },
            ],
            errors: [],
            instances: state.processRunning ? [processInstance()] : [],
        }),
        startProjectProcess: async (params) => {
            state.processRunning = true
            return { repoId: params.repoId, taskId: params.taskId, definitionId: params.definitionId, processId: "proc-test" }
        },
        reconnectProjectProcess: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            processId: params.processId,
            found: state.processRunning,
            completed: false,
            output: state.processRunning ? [{ type: "stdout", data: "phone process output\n", timestamp: 1 }] : [],
        }),
        stopProjectProcess: async (params) => {
            state.processRunning = false
            return { repoId: params.repoId, taskId: params.taskId, processId: params.processId, ok: true }
        },
        startTaskTerminal: async (params) => ({ repoId: params.repoId, taskId: params.taskId, terminalId: "terminal-test", ok: true }),
        reconnectTaskTerminal: async (params) => ({ repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId ?? "terminal-test", found: false, output: [] }),
        writeTaskTerminal: async (params) => ({ repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId, ok: true }),
        resizeTaskTerminal: async (params) => ({ repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId, ok: true }),
        stopTaskTerminal: async (params) => ({ repoId: params.repoId, taskId: params.taskId, terminalId: params.terminalId, ok: true }),
        readTaskChanges: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            files: [{ path: "src/app.ts", status: "modified" }],
            fromTreeish: "HEAD",
            toTreeish: "",
        }),
        readTaskDiff: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            filePath: params.filePath,
            oldPath: params.oldPath,
            fromTreeish: "HEAD",
            toTreeish: "",
            patch: "diff --git a/src/app.ts b/src/app.ts\n+remote task changes\n",
            truncated: false,
            heavy: false,
            stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
        }),
        readTaskFilePair: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            filePath: params.filePath,
            oldPath: params.oldPath,
            fromTreeish: "HEAD",
            toTreeish: "",
            before: "before\n",
            after: "after\n",
        }),
        readTaskGitLog: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            commits: [
                {
                    sha: "0123456789abcdef",
                    shortSha: "0123456",
                    message: "Initial remote commit",
                    author: "OpenADE",
                    date: now,
                    relativeDate: "today",
                    parentCount: 1,
                },
            ],
            hasMore: false,
        }),
        readTaskGitCommitFiles: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            commit: params.commit,
            files: [{ path: "src/app.ts", status: "modified" }],
        }),
        readTaskGitFileAtTreeish: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            treeish: params.treeish,
            filePath: params.filePath,
            content: "remote task file\n",
            exists: true,
        }),
        readTaskGitCommitFilePatch: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            commit: params.commit,
            filePath: params.filePath,
            oldPath: params.oldPath,
            patch: "diff --git a/src/app.ts b/src/app.ts\n+remote task changes\n",
            truncated: false,
            heavy: false,
            stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
        }),
        commitTaskGit: async (params) => ({ repoId: params.repoId, taskId: params.taskId, committed: false, status: "nothing_to_commit" }),
        readTaskImage: async (params) => ({
            repoId: params.repoId,
            taskId: params.taskId,
            imageId: params.imageId,
            ext: params.ext,
            mediaType: params.image.mediaType,
            data: btoa("remote image"),
        }),
        readTaskSnapshotPatch: async (params) => ({ repoId: params.repoId, taskId: params.taskId, eventId: params.eventId, patch: null }),
        readTaskSnapshotIndex: async (params) => ({ repoId: params.repoId, taskId: params.taskId, eventId: params.eventId, index: null }),
        readTaskSnapshotPatchSlice: async (params) => ({ repoId: params.repoId, taskId: params.taskId, eventId: params.eventId, patch: null }),
    }

    const adapters: OpenADEModuleAdapters = {
        version: () => "test",
        readSnapshot: async (options) => snapshot(options),
        readProjects: async () => [project],
        readTaskList: async () => project.tasks,
        readTask: async () => readTaskDto(),
        listDataDocuments: async () => [],
        readDataDocumentBase64: async () => null,
        saveDataDocumentBase64: async () => undefined,
        deleteDataDocument: async () => undefined,
        scopedHost,
        createRepo: async () => ({ repoId: "repo-created", createdAt: now }),
        updateRepo: async () => undefined,
        deleteRepo: async () => undefined,
        startTurn: async (params) => {
            state.task.events = [
                ...state.task.events,
                {
                    id: "event-turn",
                    type: "action",
                    status: "completed",
                    createdAt: now,
                    userInput: params.input,
                    source: { type: params.type, userLabel: params.type },
                },
            ]
            publishTaskChanged()
            return { taskId: state.task.id, eventId: "event-turn" }
        },
        startReview: async (params) => {
            state.task.events = [
                ...state.task.events,
                {
                    id: "event-review",
                    type: "action",
                    status: "in_progress",
                    createdAt: now,
                    userInput: params.customInstructions ?? "",
                    source: { type: "review", userLabel: "Review", reviewType: params.reviewType },
                },
            ]
            publishTaskChanged()
            return { taskId: params.taskId }
        },
        interruptTurn: async () => undefined,
        cancelQueuedTurn: async (params) => {
            state.queuedTurn = { ...state.queuedTurn, status: "cancelled", updatedAt: now }
            state.task.queuedTurns = [state.queuedTurn]
            publishTaskChanged(false)
            return { taskId: params.taskId, queuedTurnId: params.queuedTurnId, cancelled: true }
        },
        deleteTask: async (params: OpenADETaskDeleteRequest) => {
            state.taskDeleted = true
            project.tasks = project.tasks.filter((task) => task.id !== params.taskId)
            publishOpenADECompanionEvent(server, { type: "task_deleted", repoId: params.repoId, taskId: params.taskId, at: now })
            return { repoId: params.repoId, taskId: params.taskId, deleted: true }
        },
        setupTaskEnvironment: async () => undefined,
        createActionEvent: async () => ({ eventId: "event-created", createdAt: now }),
        appendActionStreamEvent: async () => undefined,
        completeActionEvent: async () => undefined,
        errorActionEvent: async () => undefined,
        stoppedActionEvent: async () => undefined,
        reconcileActionEventRuntime: async (params) => ({ taskId: params.taskId, changed: false }),
        updateActionExecution: async () => undefined,
        addHyperPlanSubExecution: async () => undefined,
        appendHyperPlanSubExecutionStreamEvent: async () => undefined,
        updateHyperPlanSubExecution: async () => undefined,
        setHyperPlanReconcileLabels: async () => undefined,
        createSnapshotEvent: async () => ({ eventId: "snapshot-created", createdAt: now }),
        createComment: async (params: OpenADECommentCreateRequest) => {
            const commentId = params.commentId ?? "comment-1"
            state.task.comments = [
                ...state.task.comments,
                {
                    id: commentId,
                    content: params.content,
                    source: params.source,
                    selectedText: params.selectedText,
                    author: params.author,
                    createdAt: params.createdAt ?? now,
                },
            ]
            publishTaskChanged(false)
            return { commentId, createdAt: params.createdAt ?? now }
        },
        editComment: async (params: OpenADECommentEditRequest) => {
            state.task.comments = state.task.comments.map((comment) => {
                const record = typeof comment === "object" && comment !== null && !Array.isArray(comment) ? (comment as Record<string, unknown>) : null
                return record?.id === params.commentId ? { ...record, content: params.content, updatedAt: params.updatedAt ?? now } : comment
            })
            publishTaskChanged(false)
        },
        deleteComment: async (params: OpenADECommentDeleteRequest) => {
            state.task.comments = state.task.comments.filter((comment) => {
                const record = typeof comment === "object" && comment !== null && !Array.isArray(comment) ? (comment as Record<string, unknown>) : null
                return record?.id !== params.commentId
            })
            publishTaskChanged(false)
        },
        updateTaskMetadata: async (params: OpenADETaskMetadataUpdateRequest) => {
            if (params.title) {
                state.task.title = params.title
                preview.title = params.title
            }
            if (params.closed !== undefined) {
                state.task.closed = params.closed
                preview.closed = params.closed
            }
            publishTaskChanged()
        },
    }
    server.registerModule(createOpenADEModule(adapters))
    server.register("remote/device/selfRevoke", () => {
        state.selfRevoked = true
        return { ok: true, revoked: true }
    })

    class TestRuntimeClient extends RuntimeLocalClient {
        constructor(options: RuntimeClientOptions) {
            super(createRuntimeLocalTransport(server), {
                clientName: options.clientName,
                clientVersion: options.clientVersion,
                clientPlatform: options.clientPlatform,
                protocolVersion: options.protocolVersion,
            })
        }
    }

    return { RuntimeClient: TestRuntimeClient, OpenADEClient }
}

function seededTask(): { taskDeleted: boolean; processRunning: boolean; selfRevoked: boolean; task: OpenADETask; queuedTurn: OpenADEQueuedTurn } {
    const queuedTurn: OpenADEQueuedTurn = {
        id: "queued-1",
        type: "do",
        input: "Run this after the current turn",
        status: "queued",
        createdAt: now,
        updatedAt: now,
    }
    return {
        taskDeleted: false,
        processRunning: false,
        selfRevoked: false,
        queuedTurn,
        task: {
            id: "task-1",
            repoId: "repo-1",
            slug: "task-1",
            title: "Original task",
            description: "A task rendered by the shared remote shell.",
            isolationStrategy: { type: "head" },
            deviceEnvironments: [],
            queuedTurns: [queuedTurn],
            events: [
                {
                    id: "event-image",
                    type: "action",
                    status: "completed",
                    createdAt: now,
                    userInput: "Describe this image",
                    source: { type: "do", userLabel: "Do" },
                    images: [
                        { id: "remote-image", ext: "png", mediaType: "image/png", originalWidth: 1, originalHeight: 1, resizedWidth: 1, resizedHeight: 1 },
                    ],
                },
            ],
            comments: [],
        },
    }
}

interface SavedRemoteSessionConfig {
    id: string
    baseUrl: string
    token: string
    host: string
    savedAt: string
    lastUsedAt: string
}

function saveRemoteSessions(activeId: string, configs: SavedRemoteSessionConfig[]): void {
    localStorage.setItem(
        REMOTE_CONFIG_STORAGE_KEY,
        JSON.stringify({
            version: 2,
            activeId,
            configs,
        })
    )
}

function saveRemoteSession(): void {
    saveRemoteSessions("session-1", [
        {
            id: "session-1",
            baseUrl: "http://100.64.1.10:7823",
            token: "token-1",
            host: "100.64.1.10:7823",
            savedAt: now,
            lastUsedAt: now,
        },
    ])
}

async function waitForElement<T extends Element>(find: () => T | null, label: string): Promise<T> {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        const found = find()
        if (found) return found
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 25))
        })
    }
    throw new Error(`Timed out waiting for ${label}`)
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((button): button is HTMLButtonElement => button.textContent?.includes(text) === true) ?? null
}

function buttonByTitle(container: HTMLElement, title: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((button): button is HTMLButtonElement => button.title === title) ?? null
}

function inputByValue(container: HTMLElement, value: string): HTMLInputElement | null {
    return Array.from(container.querySelectorAll("input")).find((input): input is HTMLInputElement => input.value === value) ?? null
}

function inputByPlaceholder(container: HTMLElement, value: string): HTMLInputElement | null {
    return Array.from(container.querySelectorAll("input")).find((input): input is HTMLInputElement => input.placeholder === value) ?? null
}

async function click(element: HTMLElement): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
}

async function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
    await act(async () => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")
        descriptor?.set?.call(element, value)
        element.dispatchEvent(new Event("input", { bubbles: true }))
        element.dispatchEvent(new Event("change", { bubbles: true }))
    })
}

async function selectValue(element: HTMLSelectElement, value: string): Promise<void> {
    await act(async () => {
        element.value = value
        element.dispatchEvent(new Event("change", { bubbles: true }))
    })
}

function snapshotWithProject(hostName: string, repoId: string, repoName: string, themeClass: string, themeLabel: string): OpenADESnapshot {
    const project: OpenADEProject = {
        id: repoId,
        name: repoName,
        path: `/tmp/${repoId}`,
        tasks: [],
    }
    return {
        server: {
            version: "test",
            hostName,
            theme: { setting: "system", className: themeClass, label: themeLabel },
        },
        repos: [project],
        workingTaskIds: [],
    }
}

function shellRootClassName(container: HTMLElement): string {
    const element = container.firstElementChild
    return element instanceof HTMLElement ? element.className : ""
}

describe("RemoteApp runtime-backed product controls", () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        localStorage.clear()
        saveRemoteSession()
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        restoreClientConstructors?.()
        restoreClientConstructors = undefined
        act(() => root.unmount())
        container.remove()
        localStorage.clear()
        vi.restoreAllMocks()
    })

    it("switches saved sessions, removes stale hosts, and persists shell theme through real runtime clients", async () => {
        const laptopBaseUrl = "http://100.64.1.10:7823"
        const studioBaseUrl = "http://100.64.1.11:7823"
        const laptopSnapshot = snapshotWithProject("Laptop Desktop", "laptop-repo", "Laptop Repo", "code-theme-light", "Light")
        const studioSnapshot = snapshotWithProject("Studio Desktop", "studio-repo", "Studio Repo", "code-theme-bright", "Bright")
        saveRemoteSessions("session-1", [
            {
                id: "session-1",
                baseUrl: laptopBaseUrl,
                token: "token-1",
                host: "Laptop Desktop",
                savedAt: now,
                lastUsedAt: now,
            },
            {
                id: "session-2",
                baseUrl: studioBaseUrl,
                token: "token-2",
                host: "Studio Desktop",
                savedAt: now,
                lastUsedAt: now,
            },
        ])
        restoreClientConstructors = __setRemoteClientConstructorsForTest(
            createSnapshotRuntimeConstructors([
                { baseUrl: laptopBaseUrl, snapshot: laptopSnapshot },
                { baseUrl: studioBaseUrl, snapshot: studioSnapshot },
            ])
        )

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Laptop Repo"), "active laptop project")
        expect(loadRemoteConfig()?.id).toBe("session-1")
        expect(shellRootClassName(container)).toContain("code-theme-light")

        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab"))
        const themeSelect = await waitForElement(() => {
            const element = container.querySelector("select")
            return element instanceof HTMLSelectElement ? element : null
        }, "shell theme select")
        await selectValue(themeSelect, "code-theme-dracula")
        expect(localStorage.getItem(REMOTE_THEME_STORAGE_KEY)).toBe("code-theme-dracula")
        expect(shellRootClassName(container)).toContain("code-theme-dracula")

        await click(await waitForElement(() => buttonByText(container, "Manage Sessions"), "manage sessions button"))
        await click(await waitForElement(() => buttonByText(container, "Studio Desktop"), "studio session row"))
        await waitForElement(() => buttonByText(container, "Studio Repo"), "active studio project")
        expect(loadRemoteConfig()?.id).toBe("session-2")
        expect(shellRootClassName(container)).toContain("code-theme-dracula")

        await click(await waitForElement(() => buttonByText(container, "Sessions"), "sessions tab"))
        await click(await waitForElement(() => buttonByTitle(container, "Remove Laptop Desktop"), "remove stale laptop session"))
        await waitForElement(
            () =>
                loadRemoteConfigs()
                    .map((item) => item.id)
                    .join(",") === "session-2"
                    ? container
                    : null,
            "stale session removed from storage"
        )
        expect(container.textContent).not.toContain("Laptop Desktop")

        await act(async () => {
            root.unmount()
        })
        root = createRoot(container)
        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await waitForElement(() => buttonByText(container, "Studio Repo"), "persisted active studio project")
        expect(loadRemoteConfig()?.id).toBe("session-2")
        expect(localStorage.getItem(REMOTE_THEME_STORAGE_KEY)).toBe("code-theme-dracula")
        expect(shellRootClassName(container)).toContain("code-theme-dracula")
    })

    it("drives task metadata, comments, queued turns, review, and delete through a real runtime client", async () => {
        const state = seededTask()
        restoreClientConstructors = __setRemoteClientConstructorsForTest(createRuntimeBackedConstructors(state))
        vi.spyOn(window, "confirm").mockReturnValue(true)

        await act(async () => {
            root.render(createElement(RemoteApp))
        })

        await click(await waitForElement(() => buttonByText(container, "Runtime Repo"), "project row"))
        await waitForElement(() => (container.textContent?.includes("README.md") ? container : null), "project file")
        await click(await waitForElement(() => buttonByText(container, "README.md"), "read project file"))
        await waitForElement(() => (container.textContent?.includes("remote project file") ? container : null), "project file content")
        const searchInput = await waitForElement(() => inputByPlaceholder(container, "Search files"), "project search input")
        await typeInto(searchInput, "remote")
        await click(await waitForElement(() => buttonByText(container, "Search"), "project search button"))
        await waitForElement(() => (container.textContent?.includes("remote project file search hit") ? container : null), "project search result")
        await waitForElement(() => (container.textContent?.includes("Phone Echo") ? container : null), "project process")
        await click(await waitForElement(() => buttonByText(container, "Start"), "start project process"))
        await waitForElement(() => (container.textContent?.includes("Running") ? container : null), "running project process")
        expect(state.processRunning).toBe(true)
        await click(await waitForElement(() => buttonByText(container, "Output"), "project process output button"))
        await waitForElement(() => (container.textContent?.includes("phone process output") ? container : null), "project process output")
        await click(await waitForElement(() => buttonByText(container, "Stop"), "stop project process"))
        await waitForElement(() => (container.textContent?.includes("Stopped") ? container : null), "stopped project process")
        expect(state.processRunning).toBe(false)

        await click(await waitForElement(() => buttonByText(container, "Original task"), "task row"))
        await waitForElement(() => (container.textContent?.includes("src/app.ts") ? container : null), "task changed file")
        await waitForElement(() => (container.textContent?.includes("Initial remote commit") ? container : null), "task git log")
        await click(await waitForElement(() => buttonByText(container, "src/app.ts"), "read task diff"))
        await waitForElement(() => (container.textContent?.includes("+remote task changes") ? container : null), "task diff content")
        await waitForElement(() => container.querySelector('img[src="data:image/png;base64,cmVtb3RlIGltYWdl"]'), "remote task image")

        const titleInput = await waitForElement(() => inputByValue(container, "Original task"), "task title input")
        await typeInto(titleInput, "Remote updated task")
        await waitForElement(() => inputByValue(container, "Remote updated task"), "edited task title draft")
        await click(await waitForElement(() => buttonByText(container, "Save"), "save title button"))
        await waitForElement(() => inputByValue(container, "Remote updated task"), "updated task title")
        expect(state.task.title).toBe("Remote updated task")

        await click(await waitForElement(() => buttonByText(container, "Close"), "close task button"))
        await waitForElement(() => buttonByText(container, "Reopen"), "reopen task button")
        expect(state.task.closed).toBe(true)

        const commentInput = await waitForElement(() => inputByPlaceholder(container, "Add a comment"), "comment input")
        await typeInto(commentInput, "Runtime-backed remote comment")
        await waitForElement(() => inputByValue(container, "Runtime-backed remote comment"), "comment draft")
        const addCommentButton = await waitForElement(
            () => Array.from(commentInput.parentElement?.querySelectorAll("button") ?? []).find((button) => button.textContent === "Add") ?? null,
            "add comment button"
        )
        await click(addCommentButton)
        await waitForElement(() => (container.textContent?.includes("Runtime-backed remote comment") ? container : null), "created comment")
        expect(state.task.comments).toEqual([expect.objectContaining({ content: "Runtime-backed remote comment" })])

        await click(await waitForElement(() => buttonByText(container, "Cancel"), "cancel queued turn button"))
        await waitForElement(() => (container.textContent?.includes("cancelled") ? container : null), "cancelled queued turn")
        expect(state.queuedTurn.status).toBe("cancelled")

        await click(await waitForElement(() => buttonByText(container, "Review Work"), "review work button"))
        await waitForElement(() => (state.task.events.some((event) => JSON.stringify(event).includes("event-review")) ? container : null), "review event")

        await click(await waitForElement(() => buttonByText(container, "Delete"), "delete task button"))
        await waitForElement(() => (state.taskDeleted ? container : null), "deleted task")
        expect(container.textContent).toContain("No tasks yet.")

        await click(await waitForElement(() => buttonByText(container, "Settings"), "settings tab"))
        await click(await waitForElement(() => buttonByText(container, "Revoke This Device"), "self revoke button"))
        await waitForElement(() => (state.selfRevoked ? container : null), "self revoked device")
        expect(loadRemoteConfig()).toBeNull()
    })
})
