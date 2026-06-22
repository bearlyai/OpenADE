import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADERepoPathInspectResult, OpenADESnapshot } from "../../../../openade-module/src"
import { ProjectsScreen } from "./ProjectsScreen"

const snapshot: OpenADESnapshot = {
    server: {
        version: "test",
        hostName: "Runtime Host",
        theme: { setting: "system", className: "code-theme-black" },
    },
    repos: [
        {
            id: "repo-active",
            name: "Active Project",
            path: "/tmp/active-project",
            tasks: [
                {
                    id: "task-running",
                    slug: "task-running",
                    title: "Running task",
                    createdAt: "2026-06-01T00:00:00.000Z",
                },
            ],
        },
        {
            id: "repo-archived",
            name: "Archived Project",
            path: "/tmp/archived-project",
            archived: true,
            tasks: [],
        },
    ],
    workingTaskIds: ["task-running"],
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true)
    if (!button) throw new Error(`Missing button: ${text}`)
    return button
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")
        descriptor?.set?.call(input, value)
        input.dispatchEvent(new Event("input", { bubbles: true }))
        input.dispatchEvent(new Event("change", { bubbles: true }))
    })
}

describe("ProjectsScreen", () => {
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

    it("renders OpenADE project sessions and reports selected repo ids", () => {
        const actions: string[] = []
        render(
            createElement(ProjectsScreen, {
                sessions: [
                    { id: "session-1", host: "Local Desktop", snapshot, isActive: true },
                    { id: "session-2", host: "Remote Desktop", snapshot: null, isActive: false },
                ],
                showArchived: false,
                createProjectLoading: false,
                onToggleArchived: () => actions.push("toggle-archived"),
                onSelectSession: (sessionId) => actions.push(`select-session:${sessionId}`),
                onSelectProject: (sessionId, repoId) => actions.push(`${sessionId}:${repoId}`),
                onAddSession: () => actions.push("add-session"),
            })
        )

        expect(container.textContent).toContain("Local Desktop")
        expect(container.textContent).toContain("Active Project")
        expect(container.textContent).toContain("1 running")
        expect(container.textContent).not.toContain("Archived Project")
        expect(container.textContent).toContain("Remote Desktop")
        expect(container.textContent).toContain("Open this session to load projects.")
        expect(container.textContent).not.toContain("Project name")

        act(() => buttonByText(container, "Show archived").click())
        act(() => buttonByText(container, "Session").click())
        act(() => buttonByText(container, "Open Session").click())
        act(() => buttonByText(container, "Active Project").click())

        expect(actions).toEqual(["toggle-archived", "add-session", "select-session:session-2", "session-1:repo-active"])
    })

    it("can include archived projects without changing the selection contract", () => {
        const selected: string[] = []
        render(
            createElement(ProjectsScreen, {
                sessions: [{ id: "session-1", host: "Local Desktop", snapshot, isActive: true }],
                showArchived: true,
                createProjectLoading: false,
                onToggleArchived: () => undefined,
                onSelectSession: () => undefined,
                onSelectProject: (sessionId, repoId) => selected.push(`${sessionId}:${repoId}`),
                onAddSession: () => undefined,
            })
        )

        expect(container.textContent).toContain("Archived Project")

        act(() => buttonByText(container, "Archived Project").click())

        expect(selected).toEqual(["session-1:repo-archived"])
    })

    it("submits project creation only when the capability is visible", async () => {
        const created: Array<{ name: string; path: string }> = []
        render(
            createElement(ProjectsScreen, {
                sessions: [{ id: "session-1", host: "Local Desktop", snapshot, isActive: true }],
                showArchived: false,
                createProjectLoading: false,
                onToggleArchived: () => undefined,
                onSelectSession: () => undefined,
                onSelectProject: () => undefined,
                onAddSession: () => undefined,
                onCreateProject: async (project) => {
                    created.push(project)
                    return true
                },
            })
        )

        act(() => buttonByText(container, "Project").click())
        const inputs = Array.from(container.querySelectorAll("input"))
        const [nameInput, pathInput] = inputs
        if (!nameInput || !pathInput) throw new Error("Missing project form inputs")

        await typeInto(nameInput, "New Runtime Project")
        await typeInto(pathInput, "/tmp/new-runtime-project")
        await act(async () => buttonByText(container, "Create").click())

        expect(created).toEqual([{ name: "New Runtime Project", path: "/tmp/new-runtime-project" }])
        expect(container.textContent).not.toContain("Project name")
    })

    it("validates project paths before creation when path inspection is advertised", async () => {
        const created: Array<{ name: string; path: string }> = []
        const inspected: string[] = []
        render(
            createElement(ProjectsScreen, {
                sessions: [{ id: "session-1", host: "Local Desktop", snapshot, isActive: true }],
                showArchived: false,
                createProjectLoading: false,
                onToggleArchived: () => undefined,
                onSelectSession: () => undefined,
                onSelectProject: () => undefined,
                onAddSession: () => undefined,
                onInspectProjectPath: async (path) => {
                    inspected.push(path)
                    return {
                        path,
                        resolvedPath: `/resolved${path}`,
                        exists: path !== "/tmp/missing",
                        isDirectory: path !== "/tmp/file",
                        isGitRepo: true,
                    }
                },
                onCreateProject: async (project) => {
                    created.push(project)
                    return true
                },
            })
        )

        act(() => buttonByText(container, "Project").click())
        const inputs = Array.from(container.querySelectorAll("input"))
        const [nameInput, pathInput] = inputs
        if (!nameInput || !pathInput) throw new Error("Missing project form inputs")

        await typeInto(nameInput, "Missing Project")
        await typeInto(pathInput, "/tmp/missing")
        await act(async () => buttonByText(container, "Create").click())

        expect(inspected).toEqual(["/tmp/missing"])
        expect(created).toEqual([])
        expect(container.textContent).toContain("Path does not exist.")

        await typeInto(pathInput, "/tmp/valid")
        await act(async () => buttonByText(container, "Create").click())

        expect(inspected).toEqual(["/tmp/missing", "/tmp/valid"])
        expect(created).toEqual([{ name: "Missing Project", path: "/resolved/tmp/valid" }])
    })

    it("drops project creation drafts when create capability disappears", async () => {
        const created: Array<{ name: string; path: string }> = []
        const renderWithCreateCapability = (canCreateProject: boolean) =>
            render(
                createElement(ProjectsScreen, {
                    sessions: [{ id: "session-1", host: "Local Desktop", snapshot, isActive: true }],
                    showArchived: false,
                    createProjectLoading: false,
                    onToggleArchived: () => undefined,
                    onSelectSession: () => undefined,
                    onSelectProject: () => undefined,
                    onAddSession: () => undefined,
                    onCreateProject: canCreateProject
                        ? async (project) => {
                              created.push(project)
                              return true
                          }
                        : undefined,
                })
            )

        renderWithCreateCapability(true)
        act(() => buttonByText(container, "Project").click())
        const nameInput = container.querySelector<HTMLInputElement>('input[placeholder="Project name"]')
        const pathInput = container.querySelector<HTMLInputElement>('input[placeholder="/path/to/project"]')
        if (!nameInput || !pathInput) throw new Error("Missing project form inputs")

        await typeInto(nameInput, "Stale Project")
        await typeInto(pathInput, "/tmp/stale-project")

        renderWithCreateCapability(false)

        expect(container.querySelector('input[placeholder="Project name"]')).toBeNull()

        renderWithCreateCapability(true)
        act(() => buttonByText(container, "Project").click())
        const reopenedNameInput = container.querySelector<HTMLInputElement>('input[placeholder="Project name"]')
        const reopenedPathInput = container.querySelector<HTMLInputElement>('input[placeholder="/path/to/project"]')
        if (!reopenedNameInput || !reopenedPathInput) throw new Error("Missing reopened project form inputs")

        expect(reopenedNameInput.value).toBe("")
        expect(reopenedPathInput.value).toBe("")
        expect(created).toEqual([])
    })

    it("does not create a project from an in-flight inspection after create capability disappears", async () => {
        const created: Array<{ name: string; path: string }> = []
        let resolveInspection: ((result: OpenADERepoPathInspectResult) => void) | null = null
        const renderWithCreateCapability = (canCreateProject: boolean) =>
            render(
                createElement(ProjectsScreen, {
                    sessions: [{ id: "session-1", host: "Local Desktop", snapshot, isActive: true }],
                    showArchived: false,
                    createProjectLoading: false,
                    onToggleArchived: () => undefined,
                    onSelectSession: () => undefined,
                    onSelectProject: () => undefined,
                    onAddSession: () => undefined,
                    onInspectProjectPath: canCreateProject
                        ? (path) => {
                              expect(path).toBe("/tmp/delayed-project")
                              return new Promise<OpenADERepoPathInspectResult>((resolve) => {
                                  resolveInspection = resolve
                              })
                          }
                        : undefined,
                    onCreateProject: canCreateProject
                        ? async (project) => {
                              created.push(project)
                              return true
                          }
                        : undefined,
                })
            )

        renderWithCreateCapability(true)
        act(() => buttonByText(container, "Project").click())
        const nameInput = container.querySelector<HTMLInputElement>('input[placeholder="Project name"]')
        const pathInput = container.querySelector<HTMLInputElement>('input[placeholder="/path/to/project"]')
        if (!nameInput || !pathInput) throw new Error("Missing project form inputs")

        await typeInto(nameInput, "Delayed Project")
        await typeInto(pathInput, "/tmp/delayed-project")
        act(() => buttonByText(container, "Create").click())

        renderWithCreateCapability(false)

        await act(async () => {
            resolveInspection?.({
                path: "/tmp/delayed-project",
                resolvedPath: "/resolved/tmp/delayed-project",
                exists: true,
                isDirectory: true,
                isGitRepo: true,
            })
            await Promise.resolve()
            await Promise.resolve()
        })

        expect(created).toEqual([])
        expect(container.querySelector('input[placeholder="Project name"]')).toBeNull()
    })
})
