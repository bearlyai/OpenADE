import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADEProject } from "../../../../openade-module/src"
import { ProjectTasksScreen } from "./ProjectTasksScreen"

const project: OpenADEProject = {
    id: "repo-1",
    name: "Runtime Project",
    path: "/tmp/runtime-project",
    tasks: [
        {
            id: "task-1",
            slug: "task-1",
            title: "Running task",
            createdAt: "2026-05-31T00:00:00.000Z",
            lastEvent: {
                type: "action",
                status: "in_progress",
                sourceLabel: "Do",
                sourceType: "do",
                at: "2026-05-31T00:01:00.000Z",
            },
        },
    ],
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true)
    if (!button) throw new Error(`Missing button: ${text}`)
    return button
}

describe("ProjectTasksScreen", () => {
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

    it("renders project host panels and task rows from OpenADE DTOs", () => {
        const actions: string[] = []
        render(
            createElement(ProjectTasksScreen, {
                repo: project,
                workingTaskIds: ["task-1"],
                files: {
                    repoId: "repo-1",
                    path: "",
                    entries: [{ path: "README.md", name: "README.md", type: "file", size: 20 }],
                    truncated: false,
                },
                filesLoading: false,
                fileRead: { repoId: "repo-1", path: "README.md", encoding: "utf8", size: 20, tooLarge: false, content: "readme content" },
                fileActionPath: null,
                searchQuery: "readme",
                searchResult: {
                    repoId: "repo-1",
                    matches: [{ path: "README.md", line: 1, content: "readme content", matchStart: 0, matchEnd: 6 }],
                    truncated: false,
                },
                searchLoading: false,
                processes: {
                    repoId: "repo-1",
                    repoRoot: "/tmp/runtime-project",
                    searchRoot: "/tmp/runtime-project",
                    isWorktree: false,
                    processes: [
                        { id: "proc-1", name: "Dev Server", command: "npm start", type: "task", configPath: "openade.toml", cwd: "/tmp/runtime-project" },
                    ],
                    instances: [
                        {
                            processId: "proc-running",
                            definitionId: "proc-1",
                            repoId: "repo-1",
                            cwd: "/tmp/runtime-project",
                            completed: false,
                            exitCode: null,
                            signal: null,
                        },
                    ],
                    errors: [],
                },
                processesLoading: false,
                processActionId: null,
                processOutput: {
                    repoId: "repo-1",
                    processId: "proc-running",
                    found: true,
                    completed: false,
                    output: [
                        { type: "stdout", data: "dev server ready\n", timestamp: 1 },
                        { type: "stderr", data: "watch warning\n", timestamp: 2 },
                    ],
                },
                onSelectTask: (taskId) => actions.push(`task:${taskId}`),
                onNewTask: () => actions.push("new-task"),
                onRefreshFiles: () => actions.push("refresh-files"),
                onReadFile: (path) => actions.push(`file:${path}`),
                onSearchQueryChange: (value) => actions.push(`search-query:${value}`),
                onSearch: () => actions.push("search"),
                onRefreshProcesses: () => actions.push("refresh-processes"),
                onStartProcess: (definitionId) => actions.push(`start-process:${definitionId}`),
                onReconnectProcess: (processId) => actions.push(`output-process:${processId}`),
                onStopProcess: (processId) => actions.push(`stop-process:${processId}`),
            })
        )

        expect(container.textContent).toContain("Runtime Project")
        expect(container.textContent).toContain("README.md")
        expect(container.textContent).toContain("Dev Server")
        expect(container.textContent).toContain("dev server ready")
        expect(container.textContent).toContain("watch warning")
        expect(container.textContent).toContain("Running task")

        act(() => buttonByText(container, "New").click())
        act(() => buttonByText(container, "README.md").click())
        act(() => buttonByText(container, "Output").click())
        act(() => buttonByText(container, "Stop").click())
        act(() => buttonByText(container, "Running task").click())

        expect(actions).toEqual(["new-task", "file:README.md", "output-process:proc-running", "stop-process:proc-running", "task:task-1"])
    })
})
