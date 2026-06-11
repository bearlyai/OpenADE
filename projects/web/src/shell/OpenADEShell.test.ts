import { type ComponentProps, type ReactElement, act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADEProject, OpenADESnapshot, OpenADETaskPreview } from "../../../openade-module/src"
import { OpenADEShell } from "./OpenADEShell"

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

const snapshot: OpenADESnapshot = {
    server: {
        version: "test",
        hostName: "Runtime Host",
        theme: { setting: "system", className: "code-theme-black", label: "Black" },
    },
    repos: [project],
    workingTaskIds: ["task-1"],
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

function queryButtonByExactText(container: HTMLElement, text: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.trim() === text) ?? null
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
        projectGitCapabilities: { canRead: true },
        projectCronDefinitions: null,
        projectCronDefinitionsLoading: false,
        projectCronCapabilities: { canRead: true },
        projectProcesses: null,
        projectProcessesLoading: false,
        projectProcessActionId: null,
        projectProcessOutput: null,
        projectFileCapabilities: { canList: true, canRead: true, canSearch: true, canWrite: true },
        projectSearchCapabilities: { canSearch: true, canOpenFile: true },
        projectProcessCapabilities: {
            canRead: true,
            canStart: true,
            canReconnect: true,
            canStop: true,
        },
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
        taskGitCapabilities: {
            canRead: true,
            canReadDiff: true,
            canReadFilePair: true,
            canReadCommitFiles: true,
            canReadCommitFilePatch: true,
            canReadFileAtTreeish: true,
            canCommit: true,
        },
        taskProductCapabilities: {
            canUpdateMetadata: true,
            canGenerateTitle: true,
            canPrepareEnvironment: true,
            canStartReview: true,
            canCreateComment: true,
            canEditComment: true,
            canDeleteComment: true,
            canCancelQueuedTurn: true,
            canReorderQueuedTurns: true,
        },
        taskCanReadResources: true,
        taskCanDelete: true,
        taskCanStartTurn: true,
        taskCanEnqueueQueuedTurn: true,
        taskCanInterrupt: true,
        taskCanReadSnapshotPatch: true,
        taskCanReadSnapshotPatchSlice: true,
        newTaskRepoId: project.id,
        newTaskMode: "do",
        newTaskTitle: "",
        newTaskPrompt: "",
        newTaskCanCreate: true,
        newTaskCanStartTurn: true,
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
        snapshot,
        themeSetting: "desktop",
        settingsCanSelfRevoke: true,
        taskSnapshotPatches: {},
        taskSnapshotPatchActionId: null,
        onBack: () => actions.push("back"),
        onRefresh: () => actions.push("refresh"),
        onNavigate: (screen) => actions.push(`nav:${screen}`),
        onToggleArchivedProjects: () => actions.push("toggle-archived"),
        onSelectProject: (configId, repoId) => actions.push(`select-project:${configId}:${repoId}`),
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
        onInputChange: (value) => actions.push(`input:${value}`),
        onCommandTypeChange: (value) => actions.push(`command:${value}`),
        onTaskTitleChange: (value) => actions.push(`title:${value}`),
        onSaveTaskTitle: () => actions.push("save-title"),
        onGenerateTaskTitle: () => actions.push("generate-title"),
        onPrepareTaskEnvironment: () => actions.push("prepare-environment"),
        onToggleTaskClosed: () => actions.push("toggle-closed"),
        onDeleteTask: () => actions.push("delete-task"),
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
        onNewTaskRepoChange: (repoId) => actions.push(`new-task-repo:${repoId}`),
        onNewTaskModeChange: (value) => actions.push(`new-task-mode:${value}`),
        onNewTaskTitleChange: (value) => actions.push(`new-task-title:${value}`),
        onNewTaskPromptChange: (value) => actions.push(`new-task-prompt:${value}`),
        onCreateTask: () => actions.push("create-task"),
        onSelectHost: (configId) => actions.push(`select-host:${configId}`),
        onRemoveHost: (configId) => actions.push(`remove-host:${configId}`),
        onForget: () => actions.push("forget"),
        onSelfRevoke: () => actions.push("self-revoke"),
        onThemeChange: (value) => actions.push(`theme:${value}`),
    }
}

describe("OpenADEShell", () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    function render(element: ReactElement): void {
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

        act(() => buttonByText(container, "Manage Sessions").click())
        act(() => buttonByText(container, "Revoke This Device").click())

        expect(actions).toEqual(["nav:sessions", "self-revoke"])
    })

    it("hides task creation navigation when task create is unavailable", () => {
        render(
            createElement(OpenADEShell, {
                ...createProps(),
                screen: "project",
                newTaskCanCreate: false,
                onNewTask: () => {
                    throw new Error("new task should be unavailable")
                },
            })
        )

        expect(container.textContent).toContain("Runtime Repo")
        expect(queryButtonByExactText(container, "New")).toBeNull()
    })
})
