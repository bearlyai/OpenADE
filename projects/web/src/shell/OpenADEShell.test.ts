import { type ComponentProps, type ReactElement, act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { OpenADEProject, OpenADESnapshot, OpenADETask, OpenADETaskPreview } from "../../../openade-module/src"
import { OpenADEShell, openADEShellSettingsProductStateForCapabilities } from "./OpenADEShell"
import type { OpenADEShellCapabilities } from "./capabilities"

const taskPreview: OpenADETaskPreview = {
    id: "task-1",
    slug: "task-1",
    title: "Runtime task",
    createdAt: "2026-06-01T00:00:00.000Z",
}

const project: OpenADEProject = {
    id: "repo-1",
    name: "Runtime Repo",
    path: "/tmp/runtime-repo",
    tasks: [taskPreview],
}

const retryableTask: OpenADETask = {
    id: "task-1",
    repoId: "repo-1",
    slug: "task-1",
    title: "Runtime task",
    description: "Retryable task",
    deviceEnvironments: [],
    queuedTurns: [],
    events: [
        {
            id: "event-error",
            type: "action",
            status: "error",
            createdAt: "2026-06-01T00:00:00.000Z",
            userInput: "Failed run",
            source: { type: "do", userLabel: "Do" },
        },
    ],
    comments: [],
}

const activePlanTask: OpenADETask = {
    ...retryableTask,
    events: [
        {
            id: "event-plan",
            type: "action",
            status: "completed",
            createdAt: "2026-06-01T00:00:00.000Z",
            userInput: "Plan the work",
            source: { type: "plan", userLabel: "Plan" },
        },
    ],
}

const taskWithPromptImage: OpenADETask = {
    ...retryableTask,
    events: [
        {
            id: "event-image",
            type: "action",
            status: "completed",
            createdAt: "2026-06-01T00:00:00.000Z",
            userInput: "Inspect this",
            images: [{ id: "image-1", ext: "png" }],
            source: { type: "do", userLabel: "Do" },
        },
    ],
}

const taskWithSnapshot: OpenADETask = {
    ...retryableTask,
    events: [
        {
            id: "event-snapshot",
            type: "snapshot",
            status: "completed",
            createdAt: "2026-06-01T00:00:00.000Z",
            referenceBranch: "main",
            stats: { filesChanged: 1, insertions: 1, deletions: 0 },
        },
    ],
}

const snapshot: OpenADESnapshot = {
    server: {
        version: "test",
        hostName: "Runtime Host",
        theme: { setting: "system", className: "code-theme-black", label: "Black" },
    },
    repos: [project],
    workingTaskIds: ["task-1"],
}

let didWarmShellSuspense = false

async function drainAsyncReactWork(): Promise<void> {
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await Promise.resolve()
}

const fullShellCapabilities: OpenADEShellCapabilities = {
    projectDirectoryCapabilities: { canReadSnapshot: true, canReadProjects: true },
    projectRecordCapabilities: { canCreate: true, canInspectPath: true, canUpdate: true, canDelete: true },
    projectSdkCapabilities: { canRead: true },
    taskDirectoryCapabilities: { canList: true, canRead: true },
    taskRuntimeCapabilities: { canReadWorkingTasks: true },
    projectProcessCapabilities: { canRead: true, canStart: true, canReconnect: true, canStop: true },
    projectFileCapabilities: { canList: true, canRead: true, canSearch: true, canWrite: true },
    projectSearchCapabilities: { canSearch: true },
    projectGitCapabilities: { canReadInfo: true, canReadBranches: true, canReadSummary: true },
    projectCronCapabilities: { canRead: true, canReadInstallState: true, canReplaceInstallState: true, canRun: true },
    taskGitCapabilities: {
        canReadChanges: true,
        canReadLog: true,
        canReadSummary: true,
        canReadScopes: true,
        canReadDiff: true,
        canReadFilePair: true,
        canReadCommitFiles: true,
        canReadCommitFilePatch: true,
        canReadFileAtTreeish: true,
    },
    taskCanCommitGit: true,
    taskTerminalCapabilities: {
        canStart: true,
        canReconnect: true,
        canWrite: true,
        canResize: true,
        canStop: true,
    },
    taskResourceCapabilities: { canRead: true },
    taskImageCapabilities: { canRead: true, canWrite: true },
    taskSnapshotPatchCapabilities: { canRead: true, canReadSlice: true },
    taskRecordCapabilities: {
        canCreate: true,
        canDelete: true,
        canUpdateMetadata: true,
        canGenerateTitle: true,
        canPrepareEnvironment: true,
    },
    taskTurnCapabilities: {
        canStart: true,
        canEnqueue: true,
        canInterrupt: true,
    },
    taskReviewCapabilities: { canStart: true },
    taskCommentCapabilities: { canCreate: true, canEdit: true, canDelete: true },
    queuedTurnCapabilities: { canCancel: true, canReorder: true },
    settingsCapabilities: {
        personalSettings: { canRead: true, canReplace: true },
        mcpServers: { canRead: true, canUpsert: true, canDelete: true },
        canSelfRevoke: true,
    },
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true)
    if (!button) throw new Error(`Missing button: ${text}`)
    return button
}

function buttonByExactText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.trim() === text)
    if (!button) throw new Error(`Missing button: ${text}`)
    return button
}

function buttonByTitle(container: HTMLElement, title: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.title === title)
    if (!button) throw new Error(`Missing button title: ${title}`)
    return button
}

function queryButtonByExactText(container: HTMLElement, text: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.trim() === text) ?? null
}

function inputByLabel(container: HTMLElement, label: string): HTMLInputElement {
    const input = container.querySelector(`input[aria-label="${label}"]`)
    if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input: ${label}`)
    return input
}

function queryTextareaByLabel(container: HTMLElement, label: string): HTMLTextAreaElement | null {
    const textarea = container.querySelector(`textarea[aria-label="${label}"]`)
    return textarea instanceof HTMLTextAreaElement ? textarea : null
}

function createProps(actions: string[] = []): ComponentProps<typeof OpenADEShell> {
    return {
        className: "code-theme code-theme-black flex bg-base-100 text-base-content flex-col overflow-hidden",
        screen: "projects",
        host: "Local Desktop",
        status: { label: "Connected", tone: "ok" },
        isLoading: false,
        isSubmitting: false,
        isOnline: true,
        error: null,
        notice: null,
        connectionWarning: null,
        sessions: [{ id: "session-1", host: "Local Desktop", snapshot, isActive: true }],
        showArchivedProjects: false,
        shellCapabilities: fullShellCapabilities,
        selectedRepo: project,
        selectedTask: taskPreview,
        visibleRepos: [project],
        workingTaskIds: snapshot.workingTaskIds,
        projectFiles: null,
        projectFilesLoading: false,
        projectFileRead: null,
        projectFileActionPath: null,
        projectFileSearchQuery: "",
        projectFileSearchResult: null,
        projectFileSearchLoading: false,
        projectSearchQuery: "",
        projectSearchResult: null,
        projectSearchLoading: false,
        projectGitInfo: null,
        projectGitBranches: null,
        projectGitSummary: null,
        projectGitLoading: false,
        projectCronDefinitions: null,
        projectCronInstallState: null,
        projectCronDefinitionsLoading: false,
        projectCronInstallStateLoading: false,
        projectCronInstallActionId: null,
        projectProcesses: null,
        projectProcessesLoading: false,
        projectProcessActionId: null,
        projectProcessOutput: null,
        projectActionLoading: false,
        task: null,
        input: "",
        commandType: "do",
        taskTitleDraft: taskPreview.title,
        commentDraft: "",
        editingCommentId: null,
        editingCommentDraft: "",
        reviewInstructions: "",
        taskChanges: null,
        taskGitLog: null,
        taskGitSummary: null,
        taskGitScopes: null,
        taskChangesLoading: false,
        taskDiff: null,
        taskDiffActionPath: null,
        taskFilePair: null,
        taskFilePairActionPath: null,
        taskCommitFiles: null,
        taskCommitFilesActionSha: null,
        taskCommitPatch: null,
        taskCommitPatchActionKey: null,
        taskTreeishFile: null,
        taskTreeishFileActionKey: null,
        taskResources: null,
        taskResourcesLoading: false,
        taskTerminalProductAccess: null,
        newTaskRepoId: project.id,
        newTaskMode: "do",
        newTaskTitle: "",
        newTaskPrompt: "",
        newTaskIsolationStrategy: { type: "head" },
        newTaskBranches: null,
        newTaskBranchesLoading: false,
        configs: [
            {
                id: "session-1",
                host: "Local Desktop",
                baseUrl: "http://127.0.0.1:17373",
            },
        ],
        activeConfigId: "session-1",
        settingsConfig: {
            id: "session-1",
            host: "Local Desktop",
            baseUrl: "http://127.0.0.1:17373",
        },
        settingsProductData: {
            personalSettings: {
                envVars: { OPENADE_ENV: "configured" },
                theme: "code-theme-clean",
                renderMarkdownMessages: false,
                telemetryDisabled: true,
                newTaskHarnessId: "claude-code",
                newTaskModelId: "sonnet",
                pinnedTaskIds: ["task-1"],
            },
            personalSettingsLoading: false,
            personalSettingsActionLoading: false,
            mcpServers: [
                {
                    id: "mcp-1",
                    name: "Runtime MCP",
                    transportType: "stdio",
                    command: "echo",
                    enabled: true,
                    healthStatus: "healthy",
                    createdAt: "2026-06-01T00:00:00.000Z",
                    updatedAt: "2026-06-01T00:00:00.000Z",
                },
            ],
            mcpServersLoading: false,
            mcpServerActionId: null,
        },
        snapshot,
        themeSetting: "desktop",
        taskSnapshotPatches: {},
        taskSnapshotPatchActionId: null,
        onBack: () => actions.push("back"),
        onRefresh: () => actions.push("refresh"),
        onNavigate: (screen) => actions.push(`nav:${screen}`),
        onToggleArchivedProjects: () => actions.push("toggle-archived"),
        onSelectSession: (configId) => actions.push(`select-session:${configId}`),
        onSelectProject: (configId, repoId) => actions.push(`select-project:${configId}:${repoId}`),
        onCreateProject: (input) => {
            actions.push(`create-project:${input.name}:${input.path}`)
            return true
        },
        onUpdateProject: (input) => {
            actions.push(`update-project:${input.repoId}:${input.name ?? ""}:${input.path ?? ""}:${input.archived ?? ""}`)
            return true
        },
        onDeleteProject: (repoId) => {
            actions.push(`delete-project:${repoId}`)
            return true
        },
        onAddHost: () => actions.push("add-host"),
        onSelectTask: (taskId) => actions.push(`select-task:${taskId}`),
        onNewTask: () => actions.push("new-task"),
        onRefreshProjectProcesses: () => actions.push("refresh-processes"),
        onStartProjectProcess: (definitionId) => actions.push(`start-process:${definitionId}`),
        onReconnectProjectProcess: (processId) => actions.push(`output-process:${processId}`),
        onStopProjectProcess: (processId) => actions.push(`stop-process:${processId}`),
        onRefreshProjectFiles: () => actions.push("refresh-files"),
        onReadProjectFile: (path) => actions.push(`read-file:${path}`),
        onProjectFileSearchQueryChange: (value) => actions.push(`file-search-query:${value}`),
        onSearchProjectFiles: () => actions.push("find-file"),
        onWriteProjectFile: (path, content) => actions.push(`write-file:${path}:${content}`),
        onProjectSearchQueryChange: (value) => actions.push(`search-query:${value}`),
        onSearchProject: () => actions.push("search-project"),
        onRefreshProjectGit: () => actions.push("refresh-project-git"),
        onRefreshProjectCronDefinitions: () => actions.push("refresh-project-crons"),
        onRefreshProjectCronInstallState: () => actions.push("refresh-project-cron-state"),
        onSetProjectCronEnabled: (cronId, enabled) => actions.push(`set-project-cron:${cronId}:${enabled}`),
        onRunProjectCron: (cronId) => actions.push(`run-project-cron:${cronId}`),
        onInputChange: (value) => actions.push(`input:${value}`),
        onCommandTypeChange: (value) => actions.push(`command:${value}`),
        onTaskTitleChange: (value) => actions.push(`title:${value}`),
        onSaveTaskTitle: () => actions.push("save-title"),
        onGenerateTaskTitle: () => actions.push("generate-title"),
        onPrepareTaskEnvironment: () => actions.push("prepare-environment"),
        onToggleTaskClosed: () => actions.push("toggle-closed"),
        onDeleteTask: () => actions.push("delete-task"),
        onCancelPlan: (planEventId) => actions.push(`cancel-plan:${planEventId}`),
        onCommentDraftChange: (value) => actions.push(`comment:${value}`),
        onCreateComment: () => actions.push("create-comment"),
        onStartEditComment: (comment) => actions.push(`start-edit:${comment.id}`),
        onEditingCommentDraftChange: (value) => actions.push(`edit-comment:${value}`),
        onSaveComment: (commentId) => actions.push(`save-comment:${commentId}`),
        onCancelEditComment: () => actions.push("cancel-edit-comment"),
        onDeleteComment: (commentId) => actions.push(`delete-comment:${commentId}`),
        onCancelQueuedTurn: (queuedTurnId) => actions.push(`cancel-queued:${queuedTurnId}`),
        onReorderQueuedTurns: (queuedTurnIds) => actions.push(`reorder-queued:${queuedTurnIds.join(",")}`),
        onReviewInstructionsChange: (value) => actions.push(`review-instructions:${value}`),
        onStartReview: (reviewType) => actions.push(`start-review:${reviewType}`),
        onRefreshTaskGit: () => actions.push("refresh-task-git"),
        onReadTaskDiff: (file) => actions.push(`read-diff:${file.path}`),
        onReadTaskFilePair: (file) => actions.push(`read-file-pair:${file.path}`),
        onReadTaskCommitFiles: (commit) => actions.push(`read-commit-files:${commit.sha}`),
        onReadTaskCommitFilePatch: (file) => actions.push(`read-commit-patch:${file.path}`),
        onReadTaskCommitFileAtTreeish: (file) => actions.push(`read-commit-file:${file.path}`),
        onCommitTaskGit: (message) => actions.push(`commit-task-git:${message}`),
        onRefreshTaskResources: () => actions.push("refresh-task-resources"),
        onLoadTaskSnapshotPatch: (block) => actions.push(`snapshot-patch:${block.id}`),
        onLoadTaskSnapshotPatchSlice: (block, file) => actions.push(`snapshot-patch-slice:${block.id}:${file.path}`),
        onSendTaskInput: () => actions.push("send-task-input"),
        onAbortTask: () => actions.push("abort-task"),
        onRetryTask: () => actions.push("retry-task"),
        onTaskHyperplanPresetChange: (value) => actions.push(`task-hyperplan:${value}`),
        onNewTaskRepoChange: (repoId) => actions.push(`new-task-repo:${repoId}`),
        onNewTaskModeChange: (value) => actions.push(`new-task-mode:${value}`),
        onNewTaskTitleChange: (value) => actions.push(`new-task-title:${value}`),
        onNewTaskPromptChange: (value) => actions.push(`new-task-prompt:${value}`),
        onNewTaskIsolationStrategyChange: (strategy) =>
            actions.push(`new-task-isolation:${strategy.type}${strategy.type === "worktree" ? `:${strategy.sourceBranch}` : ""}`),
        onRefreshNewTaskBranches: () => actions.push("refresh-new-task-branches"),
        onNewTaskHyperplanPresetChange: (value) => actions.push(`new-task-hyperplan:${value}`),
        onCreateTask: () => actions.push("create-task"),
        onSelectHost: (configId) => actions.push(`select-host:${configId}`),
        onRemoveHost: (configId) => actions.push(`remove-host:${configId}`),
        onForget: () => actions.push("forget"),
        onSelfRevoke: () => actions.push("self-revoke"),
        onThemeChange: (value) => actions.push(`theme:${value}`),
        onPersonalSettingsChange: (settings) => actions.push(`personal-theme:${settings.theme}`),
        onMcpServerChange: (server) => actions.push(`mcp:${server.id}:${server.enabled}`),
        onMcpServerDelete: (serverId) => actions.push(`delete-mcp:${serverId}`),
    }
}

describe("OpenADEShell", () => {
    let container: HTMLDivElement
    let root: Root

    beforeAll(async () => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const warmContainer = document.createElement("div")
        document.body.appendChild(warmContainer)
        const warmRoot = createRoot(warmContainer)
        await act(async () => {
            warmRoot.render(createElement(OpenADEShell, { ...createProps(), screen: "task", task: retryableTask }))
            await import("../components/MarkdownMessage")
            await drainAsyncReactWork()
        })
        await act(async () => {
            warmRoot.unmount()
            await drainAsyncReactWork()
        })
        warmContainer.remove()
        didWarmShellSuspense = true
    })

    afterAll(() => {
        didWarmShellSuspense = false
    })

    beforeEach(() => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        await act(async () => {
            await drainAsyncReactWork()
            root.unmount()
            await drainAsyncReactWork()
        })
        container.remove()
    })

    function render(element: ReactElement): void {
        if (!didWarmShellSuspense) throw new Error("OpenADEShell Suspense warmup did not run")
        act(() => {
            root.render(element)
        })
    }

    it("composes shared shell chrome with real project session DTOs", () => {
        const actions: string[] = []
        render(createElement(OpenADEShell, createProps(actions)))

        expect(container.textContent).toContain("Projects")
        expect(container.textContent).toContain("Local Desktop")
        expect(container.textContent).toContain("Connected")
        expect(container.textContent).toContain("Runtime Repo")
        expect(container.textContent).toContain("1 running")

        act(() => buttonByText(container, "Settings").click())
        act(() => buttonByExactText(container, "Session").click())
        act(() => buttonByText(container, "Runtime Repo").click())

        expect(actions).toEqual(["nav:settings", "add-host", "select-project:session-1:repo-1"])
    })

    it("keeps settings navigation and device actions inside the shared shell", () => {
        const actions: string[] = []
        render(
            createElement(OpenADEShell, {
                ...createProps(actions),
                screen: "settings",
            })
        )

        expect(container.textContent).toContain("Settings")
        expect(container.textContent).toContain("Revoke This Device")
        expect(container.textContent).toContain("Matching desktop: Black")
        expect(container.textContent).toContain("Product Preferences")
        expect(container.textContent).toContain("Runtime MCP")
        expect(container.textContent).toContain("1/1 enabled")
        const connectorToggle = container.querySelector('input[aria-label="Enable connector Runtime MCP"]')
        if (!(connectorToggle instanceof HTMLInputElement)) throw new Error("Missing connector toggle")
        expect(connectorToggle.checked).toBe(true)
        const connectorDelete = buttonByTitle(container, "Delete connector Runtime MCP")

        const productThemeSelect = Array.from(container.querySelectorAll("select")).find(
            (select): select is HTMLSelectElement => select.getAttribute("aria-label") === "Product theme"
        )
        if (!productThemeSelect) throw new Error("Missing product theme select")
        act(() => {
            productThemeSelect.value = "code-theme-black"
            productThemeSelect.dispatchEvent(new Event("change", { bubbles: true }))
        })
        act(() => connectorToggle.click())
        act(() => connectorDelete.click())
        act(() => buttonByText(container, "Manage Sessions").click())
        act(() => buttonByText(container, "Revoke This Device").click())

        expect(actions).toEqual(["personal-theme:code-theme-black", "mcp:mcp-1:false", "delete-mcp:mcp-1", "nav:sessions", "self-revoke"])
    })

    it("derives settings controls from shell capabilities instead of preloaded settings data", () => {
        const props = createProps()
        const restrictedSettingsCapabilities = {
            personalSettings: { canRead: false, canReplace: false },
            mcpServers: { canRead: false, canUpsert: false, canDelete: false },
            canSelfRevoke: false,
        }
        const staleSettingsProductData = {
            ...props.settingsProductData,
            personalSettingsLoading: true,
            personalSettingsActionLoading: true,
            mcpServersLoading: true,
            mcpServerActionId: "mcp-1",
        }
        const restrictedProductState = openADEShellSettingsProductStateForCapabilities(staleSettingsProductData, restrictedSettingsCapabilities)

        expect(restrictedProductState.personalSettings).toBeNull()
        expect(restrictedProductState.personalSettingsLoading).toBe(false)
        expect(restrictedProductState.personalSettingsActionLoading).toBe(false)
        expect(restrictedProductState.mcpServers).toEqual([])
        expect(restrictedProductState.mcpServersLoading).toBe(false)
        expect(restrictedProductState.mcpServerActionId).toBeNull()

        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "settings",
                settingsProductData: staleSettingsProductData,
                shellCapabilities: {
                    ...props.shellCapabilities,
                    settingsCapabilities: restrictedSettingsCapabilities,
                },
            })
        )

        expect(container.textContent).toContain("Settings")
        expect(container.textContent).not.toContain("Product Preferences")
        expect(container.textContent).not.toContain("Runtime MCP")
        expect(container.textContent).not.toContain("Revoke This Device")
        expect(container.querySelector('input[aria-label="Enable connector Runtime MCP"]')).toBeNull()
    })

    it("hides task creation navigation when task create is unavailable", () => {
        const props = createProps()
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "project",
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskRecordCapabilities: { ...props.shellCapabilities.taskRecordCapabilities, canCreate: false },
                },
                onNewTask: () => {
                    throw new Error("new task should be unavailable")
                },
            })
        )

        expect(container.textContent).toContain("Runtime Repo")
        expect(queryButtonByExactText(container, "New")).toBeNull()
    })

    it("falls back from stale product routes when required capabilities disappear", () => {
        const props = createProps()
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "new_task",
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskRecordCapabilities: { ...props.shellCapabilities.taskRecordCapabilities, canCreate: false },
                },
                onCreateTask: () => {
                    throw new Error("task creation should be unavailable")
                },
            })
        )

        expect(container.textContent).toContain("Runtime Repo")
        expect(container.textContent).not.toContain("Create Task")

        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskDirectoryCapabilities: { ...props.shellCapabilities.taskDirectoryCapabilities, canRead: false },
                },
                onSendTaskInput: () => {
                    throw new Error("task input should be unavailable")
                },
            })
        )

        expect(container.textContent).toContain("Runtime Repo")
        expect(container.textContent).not.toContain("Loading task")
        expect(container.textContent).not.toContain("Failed run")
    })

    it("filters stale project/session DTOs when project directory capabilities disappear", () => {
        const actions: string[] = []
        const props = createProps(actions)
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "projects",
                shellCapabilities: {
                    ...props.shellCapabilities,
                    projectDirectoryCapabilities: { ...props.shellCapabilities.projectDirectoryCapabilities, canReadSnapshot: false, canReadProjects: false },
                },
                onSelectProject: () => {
                    throw new Error("stale project selection should be unavailable")
                },
                onNewTask: () => {
                    throw new Error("new task should require project directory access")
                },
            })
        )

        expect(container.textContent).toContain("Local Desktop")
        expect(container.textContent).toContain("Open this session to load projects.")
        expect(container.textContent).not.toContain("Runtime Repo")
        expect(container.textContent).not.toContain("1 running")
        expect(queryButtonByExactText(container, "New")).toBeNull()
        expect(actions).toEqual([])
    })

    it("keeps stale image upload state hidden when image-write capability disappears", () => {
        const props = createProps()
        const staleAttachment = {
            attachment: {
                id: "draft-image-1",
                mediaType: "image/png",
                ext: "png",
                originalWidth: 20,
                originalHeight: 10,
                resizedWidth: 20,
                resizedHeight: 10,
            },
            dataUrl: "data:image/png;base64,task-preview",
        }
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                taskImageAttachments: [staleAttachment],
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskImageCapabilities: { ...props.shellCapabilities.taskImageCapabilities, canWrite: false },
                },
                onAttachTaskImage: () => {
                    throw new Error("task image upload should be unavailable")
                },
            })
        )

        expect(container.querySelector('button[title="Attach image"]')).toBeNull()
        expect(container.querySelector('img[src="data:image/png;base64,task-preview"]')).toBeNull()

        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "new_task",
                newTaskImageAttachments: [{ ...staleAttachment, dataUrl: "data:image/png;base64,new-task-preview" }],
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskImageCapabilities: { ...props.shellCapabilities.taskImageCapabilities, canWrite: false },
                },
                onAttachNewTaskImage: () => {
                    throw new Error("new task image upload should be unavailable")
                },
            })
        )

        expect(container.querySelector('button[title="Attach image"]')).toBeNull()
        expect(container.querySelector('img[src="data:image/png;base64,new-task-preview"]')).toBeNull()
    })

    it("keeps stale image upload state hidden when no submit capability is available", () => {
        const props = createProps()
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskTurnCapabilities: { ...props.shellCapabilities.taskTurnCapabilities, canStart: false, canEnqueue: false },
                },
                onAttachTaskImage: () => {
                    throw new Error("task image upload should be unavailable without a submit path")
                },
            })
        )

        expect(container.querySelector('button[title="Attach image"]')).toBeNull()

        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "new_task",
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskTurnCapabilities: { ...props.shellCapabilities.taskTurnCapabilities, canStart: false },
                },
                onAttachNewTaskImage: () => {
                    throw new Error("new task image upload should be unavailable without turn start")
                },
            })
        )

        expect(container.querySelector('button[title="Attach image"]')).toBeNull()
    })

    it("keeps idle task image upload hidden when only queued-turn submit is available", () => {
        const props = createProps()
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                workingTaskIds: [],
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskTurnCapabilities: { ...props.shellCapabilities.taskTurnCapabilities, canStart: false, canEnqueue: true },
                    taskImageCapabilities: { ...props.shellCapabilities.taskImageCapabilities, canWrite: true },
                },
                onAttachTaskImage: () => {
                    throw new Error("idle image upload should be unavailable without turn start")
                },
            })
        )

        expect(container.querySelector('button[title="Attach image"]')).toBeNull()
    })

    it("keeps stale prompt image loaders disabled when image-read capability disappears", async () => {
        const props = createProps()
        let imageLoads = 0
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: taskWithPromptImage,
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskImageCapabilities: { ...props.shellCapabilities.taskImageCapabilities, canRead: false },
                },
                loadTaskImage: async () => {
                    imageLoads += 1
                    return "data:image/png;base64,AA=="
                },
            })
        )

        await act(async () => {
            await Promise.resolve()
        })

        expect(container.textContent).toContain("Inspect this")
        expect(imageLoads).toBe(0)
        expect(container.querySelector('[title="Prompt image"]')).toBeNull()
    })

    it("keeps stale snapshot patch payloads hidden when patch capabilities disappear", () => {
        const props = createProps()
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: taskWithSnapshot,
                taskSnapshotPatches: {
                    "event-snapshot": {
                        eventId: "event-snapshot",
                        patchFileId: "patch-1",
                        patch: "stale full patch content",
                    },
                },
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskResourceCapabilities: { ...props.shellCapabilities.taskResourceCapabilities, canRead: false },
                    taskSnapshotPatchCapabilities: { ...props.shellCapabilities.taskSnapshotPatchCapabilities, canRead: false, canReadSlice: false },
                },
            })
        )

        expect(container.textContent).toContain("Snapshot")
        expect(container.textContent).not.toContain("stale full patch content")
        expect(container.textContent).not.toContain("patch-1")
        expect(queryButtonByExactText(container, "Patch")).toBeNull()

        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: taskWithSnapshot,
                taskSnapshotPatches: {
                    "event-snapshot": {
                        eventId: "event-snapshot",
                        patchFileId: "patch-1",
                        index: {
                            version: 1,
                            patchSize: 24,
                            files: [
                                {
                                    id: "src/app.ts",
                                    path: "src/app.ts",
                                    status: "modified",
                                    binary: false,
                                    insertions: 1,
                                    deletions: 0,
                                    changedLines: 1,
                                    hunkCount: 1,
                                    patchStart: 0,
                                    patchEnd: 24,
                                },
                            ],
                        },
                        slices: {
                            "src/app.ts::0:24": {
                                filePath: "src/app.ts",
                                patch: "stale slice patch content",
                            },
                        },
                    },
                },
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskResourceCapabilities: { ...props.shellCapabilities.taskResourceCapabilities, canRead: false },
                    taskSnapshotPatchCapabilities: { ...props.shellCapabilities.taskSnapshotPatchCapabilities, canRead: true, canReadSlice: false },
                },
            })
        )

        expect(container.textContent).toContain("patch-1")
        expect(container.textContent).toContain("src/app.ts")
        expect(container.textContent).not.toContain("stale slice patch content")
        expect(queryButtonByExactText(container, "Load")).toBeNull()
    })

    it("keeps stale retry unavailable when turn start disappears", () => {
        const props = createProps()
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                workingTaskIds: [],
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskTurnCapabilities: { ...props.shellCapabilities.taskTurnCapabilities, canStart: false },
                },
                onRetryTask: () => {
                    throw new Error("retry should be unavailable without turn start")
                },
            })
        )

        expect(container.querySelector('button[title="Retry"]')).toBeNull()
    })

    it("hides execution command controls when a task has no submit capability", () => {
        const props = createProps()
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                workingTaskIds: [],
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskTurnCapabilities: { ...props.shellCapabilities.taskTurnCapabilities, canStart: false, canEnqueue: false },
                },
                taskAgentControls: {
                    harnessId: "claude-code",
                    allowHarnessSwitch: true,
                    selectedModel: "sonnet",
                    thinking: "max",
                    fastMode: false,
                    mcpControl: createElement("div", {}, "Allowed MCP Control"),
                    onHarnessChange: () => {
                        throw new Error("harness control should be hidden without submit capability")
                    },
                    onModelChange: () => {
                        throw new Error("model control should be hidden without submit capability")
                    },
                    onThinkingChange: () => {
                        throw new Error("thinking control should be hidden without submit capability")
                    },
                    onFastModeChange: () => {
                        throw new Error("fast mode control should be hidden without submit capability")
                    },
                },
                onSendTaskInput: () => {
                    throw new Error("task input should be unavailable without submit capability")
                },
            })
        )

        expect(queryButtonByExactText(container, "Do")).toBeNull()
        expect(queryButtonByExactText(container, "Ask")).toBeNull()
        expect(queryButtonByExactText(container, "Plan")).toBeNull()
        expect(queryButtonByExactText(container, "HyperPlan")).toBeNull()
        expect(container.textContent).toContain("Allowed MCP Control")
        const sendButton = container.querySelector('button[aria-label="Send task input"]')
        if (!(sendButton instanceof HTMLButtonElement)) throw new Error("Missing send button")
        expect(sendButton.disabled).toBe(true)
        const promptInput = container.querySelector('textarea[aria-label="Task input"]')
        if (!(promptInput instanceof HTMLTextAreaElement)) throw new Error("Missing task input")
        expect(promptInput.disabled).toBe(true)
    })

    it("treats withheld shell callbacks as unavailable even when capabilities are advertised", () => {
        const props = createProps()
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                workingTaskIds: [],
                onSendTaskInput: undefined,
                taskAgentControls: {
                    harnessId: "claude-code",
                    allowHarnessSwitch: true,
                    selectedModel: "sonnet",
                    thinking: "max",
                    fastMode: false,
                },
            })
        )

        expect(queryButtonByExactText(container, "Do")).toBeNull()
        const sendButton = container.querySelector('button[aria-label="Send task input"]')
        if (!(sendButton instanceof HTMLButtonElement)) throw new Error("Missing send button")
        expect(sendButton.disabled).toBe(true)

        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "projects",
                onCreateTask: undefined,
                onNewTask: () => {
                    throw new Error("new task navigation should require a create handler")
                },
            })
        )

        expect(queryButtonByExactText(container, "New")).toBeNull()
    })

    it("strips stale MCP composer controls when MCP capabilities disappear", () => {
        const props = createProps()
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                taskAgentControls: {
                    mcpControl: createElement("div", {}, "Denied Task MCP Control"),
                },
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskRecordCapabilities: { ...props.shellCapabilities.taskRecordCapabilities, canUpdateMetadata: false },
                },
            })
        )

        expect(container.textContent).not.toContain("Denied Task MCP Control")

        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "new_task",
                newTaskAgentControls: {
                    mcpControl: createElement("div", {}, "Denied New Task MCP Control"),
                },
                shellCapabilities: {
                    ...props.shellCapabilities,
                    settingsCapabilities: {
                        ...props.shellCapabilities.settingsCapabilities,
                        mcpServers: { canRead: false, canUpsert: false, canDelete: false },
                    },
                },
            })
        )

        expect(container.textContent).not.toContain("Denied New Task MCP Control")
    })

    it("clears task mutation drafts when matching task capabilities disappear", () => {
        const actions: string[] = []
        const props = createProps(actions)
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                taskTitleDraft: "stale title draft",
                commentDraft: "stale comment draft",
                reviewInstructions: "stale review draft",
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskRecordCapabilities: { ...props.shellCapabilities.taskRecordCapabilities, canUpdateMetadata: false },
                    taskCommentCapabilities: { ...props.shellCapabilities.taskCommentCapabilities, canCreate: false },
                    taskReviewCapabilities: { ...props.shellCapabilities.taskReviewCapabilities, canStart: false },
                },
            })
        )

        expect(inputByLabel(container, "Task title").value).toBe("Runtime task")
        expect(container.textContent).not.toContain("stale title draft")
        expect(container.textContent).not.toContain("stale comment draft")
        expect(container.textContent).not.toContain("stale review draft")
        expect(actions).toContain("title:Runtime task")
        expect(actions).toContain("comment:")
        expect(actions).toContain("review-instructions:")
    })

    it("clears hidden new-task drafts when task creation becomes unavailable", () => {
        const actions: string[] = []
        const props = createProps(actions)
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "new_task",
                newTaskMode: "hyperplan",
                newTaskTitle: "stale new task title",
                newTaskPrompt: "stale new task prompt",
                newTaskIsolationStrategy: { type: "worktree", sourceBranch: "feature/stale" },
                newTaskHyperplanPresetId: "cross-review",
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskRecordCapabilities: { ...props.shellCapabilities.taskRecordCapabilities, canCreate: false },
                },
            })
        )

        expect(container.textContent).not.toContain("stale new task title")
        expect(container.textContent).not.toContain("stale new task prompt")
        expect(queryTextareaByLabel(container, "Task input")).toBeNull()
        expect(actions).toContain("new-task-title:")
        expect(actions).toContain("new-task-prompt:")
        expect(actions).toContain("new-task-mode:do")
        expect(actions).toContain("new-task-isolation:head")
        expect(actions).toContain("new-task-hyperplan:ensemble")
    })

    it("clears existing-task composer drafts when no submit capability remains", () => {
        const actions: string[] = []
        const props = createProps(actions)
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                input: "stale task input",
                commandType: "hyperplan",
                taskHyperplanPresetId: "cross-review",
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskTurnCapabilities: { ...props.shellCapabilities.taskTurnCapabilities, canStart: false, canEnqueue: false },
                },
            })
        )

        const promptInput = queryTextareaByLabel(container, "Task input")
        if (!promptInput) throw new Error("Missing task input")
        expect(promptInput.value).toBe("")
        expect(promptInput.disabled).toBe(true)
        expect(container.textContent).not.toContain("stale task input")
        expect(actions).toContain("input:")
        expect(actions).toContain("command:do")
        expect(actions).toContain("task-hyperplan:ensemble")
    })

    it("shows only queueable command controls for running queued-turn-only tasks", () => {
        const props = createProps()
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                commandType: "hyperplan",
                workingTaskIds: ["task-1"],
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskTurnCapabilities: { ...props.shellCapabilities.taskTurnCapabilities, canStart: false, canEnqueue: true },
                },
            })
        )

        expect(buttonByExactText(container, "Do")).toBeTruthy()
        expect(buttonByExactText(container, "Ask")).toBeTruthy()
        expect(buttonByExactText(container, "HyperPlan")).toBeTruthy()
        expect(queryButtonByExactText(container, "Plan")).toBeNull()
        expect(container.textContent).toContain("HyperPlan Strategy")
    })

    it("does not expose submit-only affordances for a running non-queueable command", () => {
        const props = createProps()
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                commandType: "plan",
                workingTaskIds: ["task-1"],
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskTurnCapabilities: { ...props.shellCapabilities.taskTurnCapabilities, canStart: false, canEnqueue: true },
                    taskImageCapabilities: { ...props.shellCapabilities.taskImageCapabilities, canWrite: true },
                },
                onAttachTaskImage: () => {
                    throw new Error("image upload should be unavailable for a non-queueable running command")
                },
                onSendTaskInput: () => {
                    throw new Error("send should be unavailable for a non-queueable running command")
                },
            })
        )

        expect(container.querySelector('button[title="Attach image"]')).toBeNull()
        const sendButton = container.querySelector('button[aria-label="Send task input"]')
        if (!(sendButton instanceof HTMLButtonElement)) throw new Error("Missing send button")
        expect(sendButton.disabled).toBe(true)
        expect(buttonByExactText(container, "Do")).toBeTruthy()
        expect(buttonByExactText(container, "Ask")).toBeTruthy()
        expect(buttonByExactText(container, "HyperPlan")).toBeTruthy()
        expect(queryButtonByExactText(container, "Plan")).toBeNull()
    })

    it("keeps stale terminal adapters hidden when terminal capabilities disappear", () => {
        const props = createProps()
        const staleTerminalAccess: NonNullable<ComponentProps<typeof OpenADEShell>["taskTerminalProductAccess"]> = {
            repoId: "repo-1",
            taskId: "task-1",
            capabilities: {
                canStart: true,
                canReconnect: true,
                canWrite: true,
                canResize: true,
                canStop: true,
            },
            startTaskTerminal: async () => {
                throw new Error("terminal start should be unavailable")
            },
            reconnectTaskTerminal: async () => {
                throw new Error("terminal reconnect should be unavailable")
            },
            writeTaskTerminal: async () => {
                throw new Error("terminal write should be unavailable")
            },
            resizeTaskTerminal: async () => {
                throw new Error("terminal resize should be unavailable")
            },
            stopTaskTerminal: async () => {
                throw new Error("terminal stop should be unavailable")
            },
        }
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                taskTerminalProductAccess: staleTerminalAccess,
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskTerminalCapabilities: {
                        canStart: false,
                        canReconnect: false,
                        canWrite: false,
                        canResize: false,
                        canStop: false,
                    },
                },
            })
        )

        expect(container.textContent).not.toContain("Open Terminal")
    })

    it("filters stale project and task DTOs at the shell boundary", () => {
        const props = createProps()
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "project",
                projectFiles: {
                    repoId: "repo-1",
                    path: "",
                    entries: [{ path: "visible-tree.ts", name: "visible-tree.ts", type: "file" }],
                    truncated: false,
                },
                projectFileRead: {
                    repoId: "repo-1",
                    path: "stale-file.ts",
                    encoding: "utf8",
                    size: 13,
                    tooLarge: false,
                    content: "stale file content",
                },
                projectFileSearchResult: {
                    repoId: "repo-1",
                    results: ["stale-search.ts"],
                    truncated: false,
                    source: "filesystem",
                },
                projectSearchResult: {
                    repoId: "repo-1",
                    matches: [
                        {
                            path: "stale-grep.ts",
                            line: 3,
                            content: "stale grep hit",
                            matchStart: 0,
                            matchEnd: 5,
                        },
                    ],
                    truncated: false,
                },
                projectGitInfo: {
                    repoId: "repo-1",
                    isGitRepo: true,
                    repoRoot: "/tmp/runtime-repo",
                    relativePath: ".",
                    mainBranch: "stale-main",
                    hasGhCli: false,
                },
                projectGitBranches: {
                    repoId: "repo-1",
                    defaultBranch: "stale-main",
                    branches: [{ name: "stale-branch", isDefault: true, isRemote: false }],
                },
                projectGitSummary: {
                    repoId: "repo-1",
                    branch: "visible-summary",
                    headCommit: "abcdef123456",
                    ahead: 0,
                    hasChanges: false,
                    staged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                    unstaged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                    untracked: [],
                },
                shellCapabilities: {
                    ...props.shellCapabilities,
                    projectFileCapabilities: { canList: true, canRead: false, canSearch: false, canWrite: false },
                    projectSearchCapabilities: { canSearch: false },
                    projectGitCapabilities: { canReadInfo: false, canReadBranches: false, canReadSummary: true },
                },
            })
        )

        expect(container.textContent).toContain("visible-tree.ts")
        expect(container.textContent).toContain("visible-summary")
        expect(container.textContent).not.toContain("stale file content")
        expect(container.textContent).not.toContain("stale-search.ts")
        expect(container.textContent).not.toContain("stale grep hit")
        expect(container.textContent).not.toContain("stale-main")
        expect(container.textContent).not.toContain("stale-branch")

        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                workingTaskIds: [],
                taskChanges: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    files: [{ path: "stale-change.ts", status: "modified" }],
                    fromTreeish: "HEAD",
                    toTreeish: "WORKTREE",
                },
                taskGitSummary: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    branch: "visible-task-branch",
                    headCommit: "abcdef123456",
                    ahead: 0,
                    hasChanges: false,
                    staged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                    unstaged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                    untracked: [],
                },
                taskDiff: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    filePath: "stale-change.ts",
                    fromTreeish: "HEAD",
                    toTreeish: "WORKTREE",
                    patch: "stale diff content",
                    truncated: false,
                    heavy: false,
                    stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
                },
                taskResources: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    taskTitle: "stale resource inventory",
                    isRunning: false,
                    snapshotIds: ["snapshot-1"],
                    images: [{ id: "image-1", ext: "png" }],
                    sessions: [{ sessionId: "session-1", harnessId: "claude-code" }],
                    worktree: {
                        slug: "task-1",
                        branchName: "stale-resource-branch",
                        sourceBranch: "main",
                        branchMerged: null,
                    },
                },
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskGitCapabilities: {
                        ...props.shellCapabilities.taskGitCapabilities,
                        canReadChanges: false,
                        canReadDiff: false,
                        canReadSummary: true,
                    },
                    taskResourceCapabilities: { ...props.shellCapabilities.taskResourceCapabilities, canRead: false },
                },
            })
        )

        expect(container.textContent).toContain("visible-task-branch")
        expect(container.textContent).not.toContain("stale-change.ts")
        expect(container.textContent).not.toContain("stale diff content")
        expect(container.textContent).not.toContain("stale resource inventory")
        expect(container.textContent).not.toContain("stale-resource-branch")
    })

    it("drops stale action markers when matching read capabilities disappear", () => {
        const props = createProps()
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "project",
                projectFiles: {
                    repoId: "repo-1",
                    path: "",
                    entries: [{ path: "visible-tree.ts", name: "visible-tree.ts", type: "file" }],
                    truncated: false,
                },
                projectFileActionPath: "visible-tree.ts",
                shellCapabilities: {
                    ...props.shellCapabilities,
                    projectFileCapabilities: { canList: true, canRead: false, canSearch: false, canWrite: false },
                },
            })
        )

        expect(container.textContent).toContain("visible-tree.ts")
        expect(buttonByText(container, "visible-tree.ts").querySelector(".animate-spin")).toBeNull()

        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "task",
                task: retryableTask,
                taskChanges: {
                    repoId: "repo-1",
                    taskId: "task-1",
                    files: [{ path: "stale-change.ts", status: "modified" }],
                    fromTreeish: "HEAD",
                    toTreeish: "WORKTREE",
                },
                taskDiffActionPath: "stale-change.ts",
                shellCapabilities: {
                    ...props.shellCapabilities,
                    taskGitCapabilities: {
                        ...props.shellCapabilities.taskGitCapabilities,
                        canReadChanges: true,
                        canReadDiff: false,
                    },
                },
            })
        )

        expect(container.textContent).toContain("stale-change.ts")
        expect(buttonByText(container, "stale-change.ts").querySelector(".animate-spin")).toBeNull()
    })

    it("drops stale loading markers when matching read capabilities disappear", () => {
        const props = createProps()
        render(
            createElement(OpenADEShell, {
                ...props,
                screen: "project",
                workingTaskIds: [],
                projectFiles: null,
                projectFilesLoading: true,
                projectFileSearchQuery: "app",
                shellCapabilities: {
                    ...props.shellCapabilities,
                    projectFileCapabilities: { canList: false, canRead: false, canSearch: true, canWrite: false },
                },
            })
        )

        expect(container.textContent).toContain("Find")
        expect(container.textContent).not.toContain("Loading files")
        expect(buttonByExactText(container, "Find").querySelector(".animate-spin")).toBeNull()

        expect(container.querySelector(".animate-spin")).toBeNull()
    })

    it("surfaces retry as a classic task command when the last action failed", () => {
        const actions: string[] = []
        render(
            createElement(OpenADEShell, {
                ...createProps(actions),
                screen: "task",
                task: retryableTask,
                workingTaskIds: [],
            })
        )

        act(() => buttonByTitle(container, "Retry").click())

        expect(actions).toContain("retry-task")
        expect(queryButtonByExactText(container, "Run Plan")).toBeNull()
        expect(queryButtonByExactText(container, "Revise Plan")).toBeNull()
    })

    it("shows plan-only composer commands when a task has an active plan", () => {
        render(
            createElement(OpenADEShell, {
                ...createProps(),
                screen: "task",
                task: activePlanTask,
                workingTaskIds: [],
            })
        )

        expect(buttonByExactText(container, "Run Plan")).toBeTruthy()
        expect(buttonByExactText(container, "Revise Plan")).toBeTruthy()
        expect(buttonByText(container, "Cancel Plan")).toBeTruthy()
    })
})
