import { type ReactElement, act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { OpenADEMCPServer, OpenADEPersonalSettings, OpenADESnapshot } from "../../../openade-module/src"
import {
    OpenADESessionsScreen,
    OpenADESettingsScreen,
    type OpenADESettingsCapabilities,
    type OpenADESettingsProductState,
    isOpenADEThemeSetting,
} from "./OpenADESessionScreens"

const snapshot: OpenADESnapshot = {
    server: {
        version: "test",
        hostName: "Runtime Host",
        theme: { setting: "code-theme-dracula", className: "code-theme-dracula", label: "Dracula" },
    },
    repos: [],
    workingTaskIds: [],
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true)
    if (!button) throw new Error(`Missing button: ${text}`)
    return button
}

function queryButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.textContent?.includes(text) === true) ?? null
}

function buttonByTitle(container: HTMLElement, title: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.title === title)
    if (!button) throw new Error(`Missing button title: ${title}`)
    return button
}

function queryButtonByTitle(container: HTMLElement, title: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((item): item is HTMLButtonElement => item.title === title) ?? null
}

function inputByLabel(container: HTMLElement, label: string): HTMLInputElement {
    const input = container.querySelector(`input[aria-label="${label}"]`)
    if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input label: ${label}`)
    return input
}

function textareaByLabel(container: HTMLElement, label: string): HTMLTextAreaElement {
    const textarea = container.querySelector(`textarea[aria-label="${label}"]`)
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error(`Missing textarea label: ${label}`)
    return textarea
}

function changeInput(input: HTMLInputElement, value: string): void {
    act(() => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")
        descriptor?.set?.call(input, value)
        input.dispatchEvent(new Event("input", { bubbles: true }))
        input.dispatchEvent(new Event("change", { bubbles: true }))
    })
}

function changeTextarea(textarea: HTMLTextAreaElement, value: string): void {
    act(() => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value")
        descriptor?.set?.call(textarea, value)
        textarea.dispatchEvent(new Event("input", { bubbles: true }))
        textarea.dispatchEvent(new Event("change", { bubbles: true }))
    })
}

function settingsCapabilities(
    overrides: {
        personalSettings?: Partial<OpenADESettingsCapabilities["personalSettings"]>
        mcpServers?: Partial<OpenADESettingsCapabilities["mcpServers"]>
        canSelfRevoke?: boolean
    } = {}
): OpenADESettingsCapabilities {
    return {
        personalSettings: {
            canRead: overrides.personalSettings?.canRead ?? false,
            canReplace: overrides.personalSettings?.canReplace ?? false,
        },
        mcpServers: {
            canRead: overrides.mcpServers?.canRead ?? false,
            canUpsert: overrides.mcpServers?.canUpsert ?? false,
            canDelete: overrides.mcpServers?.canDelete ?? false,
        },
        canSelfRevoke: overrides.canSelfRevoke ?? false,
    }
}

const emptyProductState: OpenADESettingsProductState = {
    capabilities: settingsCapabilities(),
    personalSettings: null,
    personalSettingsLoading: false,
    personalSettingsActionLoading: false,
    mcpServers: [],
    mcpServersLoading: false,
    mcpServerActionId: null,
}

describe("OpenADESessionScreens", () => {
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

    it("routes saved session selection, removal, and add actions", () => {
        const actions: string[] = []
        render(
            createElement(OpenADESessionsScreen, {
                configs: [
                    { id: "local", host: "Local Desktop", baseUrl: "http://127.0.0.1:1977" },
                    { id: "office", host: "Office Desktop", baseUrl: "http://10.0.0.5:1977" },
                ],
                activeConfigId: "local",
                onSelect: (configId) => actions.push(`select:${configId}`),
                onRemove: (configId) => actions.push(`remove:${configId}`),
                onAdd: () => actions.push("add"),
            })
        )

        expect(container.textContent).toContain("Local Desktop")
        expect(container.textContent).toContain("Office Desktop")

        act(() => buttonByText(container, "Office Desktop").click())
        act(() => buttonByTitle(container, "Remove Office Desktop").click())
        act(() => buttonByText(container, "Add OpenADE Session").click())

        expect(actions).toEqual(["select:office", "remove:office", "add"])
    })

    it("routes session settings actions and validates theme selections", () => {
        const actions: string[] = []
        render(
            createElement(OpenADESettingsScreen, {
                config: { id: "local", host: "Local Desktop", baseUrl: "http://127.0.0.1:1977" },
                snapshot,
                status: { label: "Connected", tone: "ok" },
                themeSetting: "desktop",
                productState: emptyProductState,
                onRefresh: () => actions.push("refresh"),
                onForget: () => actions.push("forget"),
                onSelfRevoke: () => actions.push("self-revoke"),
                onSessions: () => actions.push("sessions"),
                onAdd: () => actions.push("add"),
                onThemeChange: (value) => actions.push(`theme:${value}`),
                onPersonalSettingsChange: (settings) => actions.push(`personal-theme:${settings.theme}`),
                onMcpServerChange: (server) => actions.push(`mcp:${server.id}:${server.enabled}`),
                onMcpServerDelete: (serverId) => actions.push(`delete-mcp:${serverId}`),
            })
        )

        expect(container.textContent).toContain("Local Desktop")
        expect(container.textContent).toContain("Connected")
        expect(container.textContent).toContain("Matching desktop: Dracula")

        act(() => buttonByText(container, "Test").click())
        act(() => buttonByText(container, "Forget").click())
        act(() => buttonByText(container, "Revoke This Device").click())
        act(() => buttonByText(container, "Manage Sessions").click())
        act(() => buttonByText(container, "Add Session").click())

        const themeSelect = container.querySelector("select")
        if (!(themeSelect instanceof HTMLSelectElement)) throw new Error("Missing theme select")
        act(() => {
            themeSelect.value = "code-theme-light"
            themeSelect.dispatchEvent(new Event("change", { bubbles: true }))
        })

        expect(actions).toEqual(["refresh", "forget", "self-revoke", "sessions", "add", "theme:code-theme-light"])
    })

    it("hides self-revoke when the runtime session does not grant it", () => {
        const actions: string[] = []
        render(
            createElement(OpenADESettingsScreen, {
                config: { id: "local", host: "Local Desktop", baseUrl: "http://127.0.0.1:1977" },
                snapshot,
                status: { label: "Connected", tone: "ok" },
                themeSetting: "desktop",
                productState: emptyProductState,
                onRefresh: () => actions.push("refresh"),
                onForget: () => actions.push("forget"),
                onSessions: () => actions.push("sessions"),
                onAdd: () => actions.push("add"),
                onThemeChange: (value) => actions.push(`theme:${value}`),
                onPersonalSettingsChange: (settings) => actions.push(`personal-theme:${settings.theme}`),
                onMcpServerChange: (server) => actions.push(`mcp:${server.id}:${server.enabled}`),
                onMcpServerDelete: (serverId) => actions.push(`delete-mcp:${serverId}`),
            })
        )

        expect(container.textContent).toContain("Local Desktop")
        expect(queryButtonByText(container, "Revoke This Device")).toBeNull()

        act(() => buttonByText(container, "Test").click())
        act(() => buttonByText(container, "Forget").click())

        expect(actions).toEqual(["refresh", "forget"])
    })

    it("accepts only supported shell theme settings", () => {
        expect(isOpenADEThemeSetting("desktop")).toBe(true)
        expect(isOpenADEThemeSetting("code-theme-clean")).toBe(true)
        expect(isOpenADEThemeSetting("not-a-theme")).toBe(false)
        expect(isOpenADEThemeSetting(null)).toBe(false)
    })

    it("creates and edits connectors only through the upsert handler", () => {
        const changedServers: OpenADEMCPServer[] = []
        const productState: OpenADESettingsProductState = {
            ...emptyProductState,
            capabilities: settingsCapabilities({ mcpServers: { canRead: true, canUpsert: true, canDelete: true } }),
            mcpServers: [
                {
                    id: "mcp-stdio-1",
                    name: "Runtime MCP",
                    transportType: "stdio",
                    command: "echo",
                    args: ["hello"],
                    envVars: { SECRET_TOKEN: "hidden" },
                    enabled: true,
                    healthStatus: "healthy",
                    createdAt: "2026-06-10T10:00:00Z",
                    updatedAt: "2026-06-10T10:00:00Z",
                },
            ],
        }
        render(
            createElement(OpenADESettingsScreen, {
                config: { id: "local", host: "Local Desktop", baseUrl: "http://127.0.0.1:1977" },
                snapshot,
                status: { label: "Connected", tone: "ok" },
                themeSetting: "desktop",
                productState,
                onRefresh: () => undefined,
                onForget: () => undefined,
                onSelfRevoke: () => undefined,
                onSessions: () => undefined,
                onAdd: () => undefined,
                onThemeChange: () => undefined,
                onPersonalSettingsChange: () => undefined,
                onMcpServerChange: (server) => changedServers.push(server),
                onMcpServerDelete: () => undefined,
            })
        )

        act(() => buttonByTitle(container, "Add connector").click())
        changeInput(inputByLabel(container, "Connector name"), "Docs MCP")
        changeInput(inputByLabel(container, "Connector URL"), "https://mcp.example.test/mcp")
        act(() => buttonByText(container, "Advanced").click())
        changeTextarea(textareaByLabel(container, "Connector headers JSON"), "{")
        act(() => buttonByText(container, "Save Connector").click())
        expect(container.textContent).toContain("Invalid headers JSON.")
        changeTextarea(textareaByLabel(container, "Connector headers JSON"), JSON.stringify({ Authorization: "Bearer docs-token" }, null, 2))
        act(() => buttonByText(container, "Save Connector").click())

        expect(changedServers[0]).toMatchObject({
            name: "Docs MCP",
            transportType: "http",
            url: "https://mcp.example.test/mcp",
            headers: { Authorization: "Bearer docs-token" },
            enabled: true,
            healthStatus: "unknown",
        })

        act(() => buttonByTitle(container, "Edit connector Runtime MCP").click())
        changeInput(inputByLabel(container, "Connector name"), "Runtime MCP Edited")
        changeInput(inputByLabel(container, "Connector command"), "node")
        changeInput(inputByLabel(container, "Connector arguments"), "worker.js --stdio")
        changeInput(inputByLabel(container, "Connector cwd"), "/tmp/runtime-mcp")
        act(() => buttonByText(container, "Advanced").click())
        const envVarsTextarea = textareaByLabel(container, "Connector environment variables JSON")
        expect(envVarsTextarea.value).toContain('"SECRET_TOKEN": "hidden"')
        changeTextarea(envVarsTextarea, JSON.stringify({ SECRET_TOKEN: "updated", MCP_MODE: "runtime" }, null, 2))
        act(() => buttonByText(container, "Save Connector").click())

        expect(changedServers[1]).toMatchObject({
            id: "mcp-stdio-1",
            name: "Runtime MCP Edited",
            transportType: "stdio",
            command: "node",
            args: ["worker.js", "--stdio"],
            cwd: "/tmp/runtime-mcp",
            envVars: { SECRET_TOKEN: "updated", MCP_MODE: "runtime" },
            enabled: true,
            healthStatus: "healthy",
            createdAt: "2026-06-10T10:00:00Z",
        })
    })

    it("keeps connector create and edit unavailable without an upsert handler", () => {
        render(
            createElement(OpenADESettingsScreen, {
                config: { id: "local", host: "Local Desktop", baseUrl: "http://127.0.0.1:1977" },
                snapshot,
                status: { label: "Connected", tone: "ok" },
                themeSetting: "desktop",
                productState: {
                    ...emptyProductState,
                    capabilities: settingsCapabilities({ mcpServers: { canRead: true, canUpsert: true } }),
                    mcpServers: [
                        {
                            id: "mcp-stdio-1",
                            name: "Runtime MCP",
                            transportType: "stdio",
                            command: "echo",
                            enabled: true,
                            healthStatus: "healthy",
                            createdAt: "2026-06-10T10:00:00Z",
                            updatedAt: "2026-06-10T10:00:00Z",
                        },
                    ],
                },
                onRefresh: () => undefined,
                onForget: () => undefined,
                onSelfRevoke: () => undefined,
                onSessions: () => undefined,
                onAdd: () => undefined,
                onThemeChange: () => undefined,
                onPersonalSettingsChange: () => undefined,
                onMcpServerDelete: () => undefined,
            })
        )

        expect(queryButtonByTitle(container, "Add connector")).toBeNull()
        expect(queryButtonByTitle(container, "Edit connector Runtime MCP")).toBeNull()
        expect(container.querySelector('input[aria-label="Connector name"]')).toBeNull()
        expect(container.querySelector('textarea[aria-label="Connector environment variables JSON"]')).toBeNull()
        expect(container.querySelector('textarea[aria-label="Connector headers JSON"]')).toBeNull()
        expect(container.textContent).toContain("Enabled")
    })

    it("keeps stale settings write handlers unavailable when capabilities deny writes", () => {
        const actions: string[] = []
        render(
            createElement(OpenADESettingsScreen, {
                config: { id: "local", host: "Local Desktop", baseUrl: "http://127.0.0.1:1977" },
                snapshot,
                status: { label: "Connected", tone: "ok" },
                themeSetting: "desktop",
                productState: {
                    ...emptyProductState,
                    capabilities: settingsCapabilities({
                        personalSettings: { canRead: true, canReplace: false },
                        mcpServers: { canRead: true, canUpsert: false, canDelete: false },
                    }),
                    personalSettings: {
                        envVars: { SECRET_TOKEN: "hidden-value" },
                        theme: "code-theme-clean",
                        renderMarkdownMessages: false,
                    },
                    mcpServers: [
                        {
                            id: "mcp-stdio-1",
                            name: "Runtime MCP",
                            transportType: "stdio",
                            command: "echo",
                            envVars: { MCP_SECRET: "hidden" },
                            enabled: true,
                            healthStatus: "healthy",
                            createdAt: "2026-06-10T10:00:00Z",
                            updatedAt: "2026-06-10T10:00:00Z",
                        },
                    ],
                },
                onRefresh: () => undefined,
                onForget: () => undefined,
                onSelfRevoke: () => undefined,
                onSessions: () => undefined,
                onAdd: () => undefined,
                onThemeChange: () => undefined,
                onPersonalSettingsChange: () => actions.push("personal-settings"),
                onMcpServerChange: () => actions.push("mcp-upsert"),
                onMcpServerDelete: () => actions.push("mcp-delete"),
            })
        )

        expect(container.textContent).toContain("Product Preferences")
        expect(container.textContent).toContain("Runtime MCP")
        expect(container.textContent).toContain("STDIO")
        expect(container.textContent).toContain("Enabled")
        expect(container.textContent).not.toContain("hidden-value")
        expect(container.textContent).not.toContain("MCP_SECRET")
        expect(container.textContent).not.toContain("echo")
        expect(container.querySelector('select[aria-label="Product theme"]')).toBeNull()
        expect(queryButtonByTitle(container, "Edit environment vars")).toBeNull()
        expect(queryButtonByTitle(container, "Add connector")).toBeNull()
        expect(queryButtonByTitle(container, "Edit connector Runtime MCP")).toBeNull()
        expect(queryButtonByTitle(container, "Delete connector Runtime MCP")).toBeNull()
        expect(container.querySelector('input[aria-label="Enable connector Runtime MCP"]')).toBeNull()
        expect(actions).toEqual([])
    })

    it("keeps connector delete unavailable without a delete handler", () => {
        render(
            createElement(OpenADESettingsScreen, {
                config: { id: "local", host: "Local Desktop", baseUrl: "http://127.0.0.1:1977" },
                snapshot,
                status: { label: "Connected", tone: "ok" },
                themeSetting: "desktop",
                productState: {
                    ...emptyProductState,
                    capabilities: settingsCapabilities({ mcpServers: { canRead: true, canUpsert: true, canDelete: true } }),
                    mcpServers: [
                        {
                            id: "mcp-stdio-1",
                            name: "Runtime MCP",
                            transportType: "stdio",
                            command: "echo",
                            enabled: true,
                            healthStatus: "healthy",
                            createdAt: "2026-06-10T10:00:00Z",
                            updatedAt: "2026-06-10T10:00:00Z",
                        },
                    ],
                },
                onRefresh: () => undefined,
                onForget: () => undefined,
                onSelfRevoke: () => undefined,
                onSessions: () => undefined,
                onAdd: () => undefined,
                onThemeChange: () => undefined,
                onMcpServerChange: () => undefined,
            })
        )

        expect(queryButtonByTitle(container, "Add connector")).not.toBeNull()
        expect(queryButtonByTitle(container, "Edit connector Runtime MCP")).not.toBeNull()
        expect(queryButtonByTitle(container, "Delete connector Runtime MCP")).toBeNull()
    })

    it("drops connector edit drafts when the upsert handler disappears", () => {
        const productState: OpenADESettingsProductState = {
            ...emptyProductState,
            capabilities: settingsCapabilities({ mcpServers: { canRead: true, canUpsert: true, canDelete: true } }),
            mcpServers: [
                {
                    id: "mcp-stdio-1",
                    name: "Runtime MCP",
                    transportType: "stdio",
                    command: "echo",
                    envVars: { SECRET_TOKEN: "hidden" },
                    enabled: true,
                    healthStatus: "healthy",
                    createdAt: "2026-06-10T10:00:00Z",
                    updatedAt: "2026-06-10T10:00:00Z",
                },
            ],
        }
        const renderSettings = (canUpsert: boolean) =>
            render(
                createElement(OpenADESettingsScreen, {
                    config: { id: "local", host: "Local Desktop", baseUrl: "http://127.0.0.1:1977" },
                    snapshot,
                    status: { label: "Connected", tone: "ok" },
                    themeSetting: "desktop",
                    productState,
                    onRefresh: () => undefined,
                    onForget: () => undefined,
                    onSelfRevoke: () => undefined,
                    onSessions: () => undefined,
                    onAdd: () => undefined,
                    onThemeChange: () => undefined,
                    onPersonalSettingsChange: () => undefined,
                    onMcpServerChange: canUpsert ? () => undefined : undefined,
                    onMcpServerDelete: () => undefined,
                })
            )

        renderSettings(true)
        act(() => buttonByTitle(container, "Edit connector Runtime MCP").click())
        act(() => buttonByText(container, "Advanced").click())
        expect(textareaByLabel(container, "Connector environment variables JSON").value).toContain("SECRET_TOKEN")

        renderSettings(false)

        expect(container.querySelector('textarea[aria-label="Connector environment variables JSON"]')).toBeNull()
        expect(container.querySelector('input[aria-label="Connector name"]')).toBeNull()

        renderSettings(true)

        expect(container.querySelector('textarea[aria-label="Connector environment variables JSON"]')).toBeNull()
        expect(container.querySelector('input[aria-label="Connector name"]')).toBeNull()
    })

    it("edits personal environment vars only through the replace handler", () => {
        const changedSettings: OpenADEPersonalSettings[] = []
        const personalSettings: OpenADEPersonalSettings = {
            envVars: {
                OPENADE_ENV: "configured",
                MULTILINE_SECRET: "first\nsecond",
            },
            theme: "code-theme-clean",
            renderMarkdownMessages: false,
        }
        render(
            createElement(OpenADESettingsScreen, {
                config: { id: "local", host: "Local Desktop", baseUrl: "http://127.0.0.1:1977" },
                snapshot,
                status: { label: "Connected", tone: "ok" },
                themeSetting: "desktop",
                productState: {
                    ...emptyProductState,
                    capabilities: settingsCapabilities({ personalSettings: { canRead: true, canReplace: true } }),
                    personalSettings,
                },
                onRefresh: () => undefined,
                onForget: () => undefined,
                onSelfRevoke: () => undefined,
                onSessions: () => undefined,
                onAdd: () => undefined,
                onThemeChange: () => undefined,
                onPersonalSettingsChange: (settings) => changedSettings.push(settings),
                onMcpServerChange: () => undefined,
                onMcpServerDelete: () => undefined,
            })
        )

        expect(container.querySelector('textarea[aria-label="Environment variables JSON"]')).toBeNull()
        expect(container.textContent).not.toContain("configured")

        act(() => buttonByTitle(container, "Edit environment vars").click())
        const textarea = textareaByLabel(container, "Environment variables JSON")
        expect(textarea.value).toContain('"OPENADE_ENV": "configured"')
        expect(textarea.value).toContain('"MULTILINE_SECRET": "first\\nsecond"')

        changeTextarea(textarea, "{")
        act(() => buttonByText(container, "Save Environment Vars").click())
        expect(container.textContent).toContain("Invalid environment JSON.")
        expect(changedSettings).toEqual([])

        changeTextarea(
            textareaByLabel(container, "Environment variables JSON"),
            JSON.stringify({ OPENADE_ENV: "updated", MULTILINE_SECRET: "line\nnext" }, null, 2)
        )
        act(() => buttonByText(container, "Save Environment Vars").click())

        expect(changedSettings).toHaveLength(1)
        expect(changedSettings[0]).toMatchObject({
            theme: "code-theme-clean",
            renderMarkdownMessages: false,
            envVars: {
                OPENADE_ENV: "updated",
                MULTILINE_SECRET: "line\nnext",
            },
        })
        expect(container.querySelector('textarea[aria-label="Environment variables JSON"]')).toBeNull()
    })

    it("keeps personal environment values hidden without a replace handler", () => {
        render(
            createElement(OpenADESettingsScreen, {
                config: { id: "local", host: "Local Desktop", baseUrl: "http://127.0.0.1:1977" },
                snapshot,
                status: { label: "Connected", tone: "ok" },
                themeSetting: "desktop",
                productState: {
                    ...emptyProductState,
                    capabilities: settingsCapabilities({ personalSettings: { canRead: true, canReplace: true } }),
                    personalSettings: {
                        envVars: { SECRET_TOKEN: "hidden-value" },
                        theme: "code-theme-clean",
                        renderMarkdownMessages: true,
                    },
                },
                onRefresh: () => undefined,
                onForget: () => undefined,
                onSelfRevoke: () => undefined,
                onSessions: () => undefined,
                onAdd: () => undefined,
                onThemeChange: () => undefined,
                onMcpServerChange: () => undefined,
                onMcpServerDelete: () => undefined,
            })
        )

        expect(container.textContent).toContain("Environment Vars")
        expect(container.textContent).toContain("1")
        expect(container.textContent).not.toContain("hidden-value")
        expect(queryButtonByTitle(container, "Edit environment vars")).toBeNull()
        expect(container.querySelector('textarea[aria-label="Environment variables JSON"]')).toBeNull()
    })

    it("keeps personal preferences read-only without a replace handler", () => {
        render(
            createElement(OpenADESettingsScreen, {
                config: { id: "local", host: "Local Desktop", baseUrl: "http://127.0.0.1:1977" },
                snapshot,
                status: { label: "Connected", tone: "ok" },
                themeSetting: "desktop",
                productState: {
                    ...emptyProductState,
                    capabilities: settingsCapabilities({ personalSettings: { canRead: true, canReplace: true } }),
                    personalSettings: {
                        envVars: { SECRET_TOKEN: "hidden-value" },
                        theme: "code-theme-clean",
                        renderMarkdownMessages: true,
                    },
                },
                onRefresh: () => undefined,
                onForget: () => undefined,
                onSelfRevoke: () => undefined,
                onSessions: () => undefined,
                onAdd: () => undefined,
                onThemeChange: () => undefined,
            })
        )

        expect(container.textContent).toContain("Environment Vars")
        expect(container.textContent).toContain("1")
        expect(container.textContent).not.toContain("hidden-value")
        expect(queryButtonByTitle(container, "Edit environment vars")).toBeNull()
        expect(container.querySelector('textarea[aria-label="Environment variables JSON"]')).toBeNull()
    })

    it("drops personal environment drafts when the replace handler disappears", () => {
        const personalSettings: OpenADEPersonalSettings = {
            envVars: { SECRET_TOKEN: "hidden-value" },
            theme: "code-theme-clean",
            renderMarkdownMessages: true,
        }
        const renderSettings = (hasReplaceHandler: boolean) =>
            render(
                createElement(OpenADESettingsScreen, {
                    config: { id: "local", host: "Local Desktop", baseUrl: "http://127.0.0.1:1977" },
                    snapshot,
                    status: { label: "Connected", tone: "ok" },
                    themeSetting: "desktop",
                    productState: {
                        ...emptyProductState,
                        capabilities: settingsCapabilities({ personalSettings: { canRead: true, canReplace: true } }),
                        personalSettings,
                    },
                    onRefresh: () => undefined,
                    onForget: () => undefined,
                    onSelfRevoke: () => undefined,
                    onSessions: () => undefined,
                    onAdd: () => undefined,
                    onThemeChange: () => undefined,
                    onPersonalSettingsChange: hasReplaceHandler ? () => undefined : undefined,
                    onMcpServerChange: () => undefined,
                    onMcpServerDelete: () => undefined,
                })
            )

        renderSettings(true)
        act(() => buttonByTitle(container, "Edit environment vars").click())
        expect(textareaByLabel(container, "Environment variables JSON").value).toContain("hidden-value")

        renderSettings(false)

        expect(container.querySelector('textarea[aria-label="Environment variables JSON"]')).toBeNull()
        expect(container.textContent).not.toContain("hidden-value")

        renderSettings(true)

        expect(container.querySelector('textarea[aria-label="Environment variables JSON"]')).toBeNull()
    })
})
