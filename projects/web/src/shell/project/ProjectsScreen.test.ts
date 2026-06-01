import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADESnapshot } from "../../../../openade-module/src"
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
                onToggleArchived: () => actions.push("toggle-archived"),
                onSelectProject: (sessionId, repoId) => actions.push(`${sessionId}:${repoId}`),
                onAddSession: () => actions.push("add-session"),
            })
        )

        expect(container.textContent).toContain("Local Desktop")
        expect(container.textContent).toContain("Active Project")
        expect(container.textContent).toContain("1 running")
        expect(container.textContent).not.toContain("Archived Project")
        expect(container.textContent).toContain("Remote Desktop")
        expect(container.textContent).toContain("Loading projects")

        act(() => buttonByText(container, "Show archived").click())
        act(() => buttonByText(container, "Session").click())
        act(() => buttonByText(container, "Active Project").click())

        expect(actions).toEqual(["toggle-archived", "add-session", "session-1:repo-active"])
    })

    it("can include archived projects without changing the selection contract", () => {
        const selected: string[] = []
        render(
            createElement(ProjectsScreen, {
                sessions: [{ id: "session-1", host: "Local Desktop", snapshot, isActive: true }],
                showArchived: true,
                onToggleArchived: () => undefined,
                onSelectProject: (sessionId, repoId) => selected.push(`${sessionId}:${repoId}`),
                onAddSession: () => undefined,
            })
        )

        expect(container.textContent).toContain("Archived Project")

        act(() => buttonByText(container, "Archived Project").click())

        expect(selected).toEqual(["session-1:repo-archived"])
    })
})
