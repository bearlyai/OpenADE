import { type ReactElement, act, createElement } from "react"
import { type Root, createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../openade-client/src"
import type { SmartEditorRef } from "../components/SmartEditor"
import { CodeStoreProvider } from "../store/context"
import type { FileUsageItem, SmartEditorManager } from "../store/managers/SmartEditorManager"
import type { CodeStore } from "../store/store"
import type { Repo } from "../types"
import { TaskCreatePage } from "./TaskCreatePage"

interface CapturedSmartEditorProps {
    fileMentionsDir?: string | null
    enableFileMentions?: boolean
    slashCommandsDir?: string | null
    resolveWorkingDir?: () => Promise<string | null>
    sdkCapabilities?: unknown
    enableImagePasteDrop?: boolean
    placeholder?: string
}

let capturedSmartEditorProps: CapturedSmartEditorProps | null = null
let lastEditorManager: SmartEditorManager | null = null

interface CapturedSdkCapabilities {
    loadCapabilities(cwd: string): Promise<void>
}

function capturedSdkCapabilities(): CapturedSdkCapabilities {
    const candidate = capturedSmartEditorProps?.sdkCapabilities
    if (typeof candidate !== "object" || candidate === null || !("loadCapabilities" in candidate) || typeof candidate.loadCapabilities !== "function") {
        throw new Error("Expected captured SDK capabilities manager")
    }
    return candidate as CapturedSdkCapabilities
}

vi.mock("../components/SmartEditor", async () => {
    const React = await import("react")
    return {
        SmartEditor: React.forwardRef<SmartEditorRef, CapturedSmartEditorProps>((props, ref) => {
            capturedSmartEditorProps = props
            React.useImperativeHandle(ref, () => ({
                focus: () => undefined,
                focusEnd: () => undefined,
                blur: () => undefined,
                clear: () => undefined,
            }))
            return React.createElement("div", { "data-testid": "smart-editor" })
        }),
    }
})

vi.mock("../components/FastModeToggle", async () => {
    const React = await import("react")
    return {
        FastModeToggle: () => React.createElement("button", { type: "button" }, "Fast"),
    }
})

vi.mock("../components/ui", async () => {
    const React = await import("react")
    return {
        Select: () => React.createElement("button", { type: "button" }, "Select"),
        ShortcutBadge: () => null,
        Switch: ({
            checked,
            onCheckedChange,
            "aria-label": ariaLabel,
        }: { checked: boolean; onCheckedChange: (checked: boolean) => void; "aria-label"?: string }) =>
            React.createElement(
                "button",
                {
                    type: "button",
                    "aria-label": ariaLabel,
                    "aria-pressed": checked,
                    onClick: () => onCheckedChange(!checked),
                },
                checked ? "On" : "Off"
            ),
    }
})

vi.mock("@base-ui-components/react/popover", async () => {
    const React = await import("react")
    const Passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children)
    const Trigger = ({ children }: { children?: React.ReactNode }) => React.createElement("button", { type: "button" }, children)
    return {
        Popover: {
            Root: Passthrough,
            Portal: Passthrough,
            Positioner: Passthrough,
            Popup: Passthrough,
            Trigger,
        },
    }
})

vi.mock("../components/mcp/TaskMcpSelector", async () => {
    const React = await import("react")
    return {
        TaskMcpSelector: ({
            selectedServerIds,
            onSelectionChange,
        }: {
            selectedServerIds: string[]
            onSelectionChange: (serverIds: string[]) => void
        }) =>
            React.createElement(
                "button",
                {
                    type: "button",
                    "data-testid": "task-mcp-selector",
                    onClick: () => onSelectionChange([...selectedServerIds, "mcp-runtime"]),
                },
                "MCP"
            ),
    }
})

function createEditorManager(value = "", favorites: FileUsageItem[] = []): SmartEditorManager {
    const manager = {
        workspaceId: "repo-1",
        id: "task-create",
        value,
        pendingImages: [],
        pendingImageDataUrls: new Map(),
        favorites,
        stashedDrafts: [],
        hasDraftableContent: false,
        validateFiles: vi.fn(async () => undefined),
        insertFile: vi.fn(),
        addImage: vi.fn(),
        removeImage: vi.fn(),
        clear: vi.fn(),
        stashCurrentDraft: vi.fn(),
        popStash: vi.fn(),
        deleteStash: vi.fn(),
    } as unknown as SmartEditorManager
    lastEditorManager = manager
    return manager
}

function createStore({
    runtimeProductAPI,
    coreOwnedProductRuntime = false,
    gitInfo = null,
    editorValue = "",
    favorites = [],
    canUseProductMethod = () => true,
}: {
    runtimeProductAPI: boolean
    coreOwnedProductRuntime?: boolean
    gitInfo?: { isGitRepo: boolean; repoRoot: string; relativePath: string; mainBranch: string; hasGhCli: boolean } | null
    editorValue?: string
    favorites?: FileUsageItem[]
    canUseProductMethod?: (method: string) => boolean
}): CodeStore {
    let runtimeProductAPIAvailable = runtimeProductAPI
    const editorManager = createEditorManager(editorValue, favorites)
    const ensureCoreOwnedProductMethodsAvailable = vi.fn(async () => {
        runtimeProductAPIAvailable = true
    })
    return {
        shouldUseRuntimeProductAPI: () => runtimeProductAPIAvailable,
        usesCoreOwnedProductRuntime: () => coreOwnedProductRuntime,
        canUseProductMethod: vi.fn(canUseProductMethod),
        ensureCoreOwnedProductMethodsAvailable,
        smartEditors: {
            getManager: () => editorManager,
        },
        repos: {
            getGitInfo: vi.fn(async () => gitInfo),
            listBranches: vi.fn(async () => ({ branches: [{ name: "main", isDefault: true, isRemote: false }], defaultBranch: "main" })),
            getGitSummary: vi.fn(async () => ({
                branch: "main",
                headCommit: "abc123",
                ahead: 0,
                hasChanges: false,
                staged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                unstaged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
                untracked: [],
            })),
        },
        creation: {
            newTask: vi.fn(() => "creation-1"),
            getCreationsForRepo: vi.fn(() => []),
            getCreation: vi.fn(() => null),
            retryCreation: vi.fn(),
            dismissCreation: vi.fn(),
        },
        mcpServers: {
            enabledServers: [],
        },
        defaultHarnessId: "claude-code",
        defaultModel: "sonnet",
        defaultThinking: "max",
        defaultFastMode: false,
        setDefaultHarnessId: vi.fn(),
        setDefaultModel: vi.fn(),
        setDefaultThinking: vi.fn(),
        setDefaultFastMode: vi.fn(),
        persistProductTaskImage: vi.fn(),
        readProductProjectSdkCapabilities: vi.fn(async () => ({
            slash_commands: ["compact"],
            skills: [],
            plugins: [],
            cachedAt: 1,
        })),
        personalSettingsStore: {
            settings: {
                current: {
                    shortcutHintsHidden: true,
                },
            },
        },
    } as unknown as CodeStore
}

const repo: Repo = {
    id: "repo-1",
    name: "Repo",
    path: "/tmp/repo",
    createdBy: { id: "user-1", email: "user@example.com" },
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
}

describe("TaskCreatePage runtime product editor capabilities", () => {
    let container: HTMLDivElement
    let root: Root
    let previousActEnvironment: boolean | undefined

    beforeEach(() => {
        previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        capturedSmartEditorProps = null
        lastEditorManager = null
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
        capturedSmartEditorProps = null
        lastEditorManager = null
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    async function render(element: ReactElement): Promise<void> {
        await act(async () => {
            root.render(element)
            await Promise.resolve()
            await new Promise((resolve) => window.setTimeout(resolve, 0))
        })
    }

    it("uses scoped SDK capability discovery for Core-backed task creation without eager host reads", async () => {
        const store = createStore({ runtimeProductAPI: true })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo })))
        )

        await vi.waitFor(() => expect(capturedSmartEditorProps).not.toBeNull())
        expect(capturedSmartEditorProps?.fileMentionsDir).toBe("/tmp/repo")
        expect(capturedSmartEditorProps?.enableFileMentions).toBe(true)
        expect(capturedSmartEditorProps?.slashCommandsDir).toBe("/tmp/repo")
        expect(capturedSmartEditorProps?.placeholder).toBe("Describe your task... Use @ to reference files, / for commands")
        expect(capturedSmartEditorProps?.resolveWorkingDir).toBeDefined()
        expect(capturedSmartEditorProps?.sdkCapabilities).toBeDefined()
        expect(store.readProductProjectSdkCapabilities).not.toHaveBeenCalled()
        expect(store.repos.getGitInfo).not.toHaveBeenCalled()
        expect(store.repos.listBranches).not.toHaveBeenCalled()
        expect(store.repos.getGitSummary).not.toHaveBeenCalled()
        expect(lastEditorManager?.validateFiles).not.toHaveBeenCalled()

        await capturedSdkCapabilities().loadCapabilities("/tmp/repo")
        expect(store.readProductProjectSdkCapabilities).toHaveBeenCalledWith({ repoId: "repo-1" })
    })

    it("hides Core-backed task creation slash discovery when project SDK capability reads are unavailable", async () => {
        const store = createStore({
            runtimeProductAPI: true,
            canUseProductMethod: (method) => method !== OPENADE_METHOD.projectSdkCapabilitiesRead,
        })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo })))
        )

        await vi.waitFor(() => expect(capturedSmartEditorProps).not.toBeNull())
        expect(capturedSmartEditorProps?.fileMentionsDir).toBe("/tmp/repo")
        expect(capturedSmartEditorProps?.enableFileMentions).toBe(true)
        expect(capturedSmartEditorProps?.slashCommandsDir).toBe("/tmp/repo")
        expect(capturedSmartEditorProps?.sdkCapabilities).toBeUndefined()
        expect(capturedSmartEditorProps?.placeholder).toBe("Describe your task... Use @ to reference files")
        expect(store.readProductProjectSdkCapabilities).not.toHaveBeenCalled()
        expect(store.repos.getGitInfo).not.toHaveBeenCalled()
    })

    it("resolves Core-backed task creation file mentions lazily when repo projection is missing", async () => {
        const store = createStore({
            runtimeProductAPI: true,
            gitInfo: { isGitRepo: true, repoRoot: "/tmp/runtime-repo", relativePath: "", mainBranch: "main", hasGhCli: true },
        })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo: null })))
        )

        await vi.waitFor(() => expect(capturedSmartEditorProps).not.toBeNull())
        expect(capturedSmartEditorProps?.fileMentionsDir).toBeNull()
        expect(capturedSmartEditorProps?.enableFileMentions).toBe(true)
        expect(capturedSmartEditorProps?.slashCommandsDir).toBeNull()
        expect(capturedSmartEditorProps?.sdkCapabilities).toBeDefined()
        expect(store.readProductProjectSdkCapabilities).not.toHaveBeenCalled()
        expect(store.repos.getGitInfo).not.toHaveBeenCalled()

        await expect(capturedSmartEditorProps?.resolveWorkingDir?.()).resolves.toBe("/tmp/runtime-repo")
        expect(store.repos.getGitInfo).toHaveBeenCalledTimes(1)

        await capturedSdkCapabilities().loadCapabilities("/tmp/runtime-repo")
        expect(store.readProductProjectSdkCapabilities).toHaveBeenCalledWith({ repoId: "repo-1" })
    })

    it("loads branches lazily when Core-backed task creation opts into worktrees", async () => {
        const store = createStore({ runtimeProductAPI: true })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo })))
        )

        await vi.waitFor(() => expect(capturedSmartEditorProps).not.toBeNull())
        expect(store.repos.listBranches).not.toHaveBeenCalled()

        const worktreeToggle = container.querySelector<HTMLButtonElement>('button[aria-label="Use worktree"]')
        expect(worktreeToggle).not.toBeNull()
        await act(async () => {
            worktreeToggle?.click()
            await Promise.resolve()
        })

        await vi.waitFor(() => expect(store.repos.listBranches).toHaveBeenCalledTimes(1))
        expect(store.repos.getGitInfo).not.toHaveBeenCalled()
    })

    it("submits head isolation when a stale Core-backed worktree draft loses branch capability", async () => {
        const allowedStore = createStore({ runtimeProductAPI: true, editorValue: "describe worktree task" })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store: allowedStore }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo })))
        )

        const worktreeToggle = container.querySelector<HTMLButtonElement>('button[aria-label="Use worktree"]')
        expect(worktreeToggle).toBeInstanceOf(HTMLButtonElement)
        await act(async () => {
            worktreeToggle?.click()
            await Promise.resolve()
        })
        await vi.waitFor(() => expect(allowedStore.repos.listBranches).toHaveBeenCalledTimes(1))

        const deniedStore = createStore({
            runtimeProductAPI: true,
            editorValue: "describe worktree task",
            canUseProductMethod: (method) => method !== OPENADE_METHOD.projectGitBranchesRead,
        })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store: deniedStore }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo })))
        )

        expect(container.querySelector('button[aria-label="Use worktree"]')).toBeNull()
        const doButton = container.querySelector<HTMLButtonElement>('[title="Do (⌘1)"]')
        expect(doButton).toBeInstanceOf(HTMLButtonElement)
        expect(doButton?.disabled).toBe(false)

        await act(async () => {
            doButton?.click()
            await Promise.resolve()
        })

        expect(deniedStore.repos.listBranches).not.toHaveBeenCalled()
        expect(deniedStore.repos.getGitSummary).not.toHaveBeenCalled()
        expect(deniedStore.creation.newTask).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                description: "describe worktree task",
                mode: "do",
                isolationStrategy: { type: "head" },
            })
        )
    })

    it("fails closed before Core-backed task creation APIs attach", async () => {
        const store = createStore({
            runtimeProductAPI: false,
            coreOwnedProductRuntime: true,
            favorites: [{ path: "src/local-only.ts", fileName: "local-only.ts", parentDir: "src" }],
            canUseProductMethod: () => false,
        })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo })))
        )

        await vi.waitFor(() => expect(capturedSmartEditorProps).not.toBeNull())
        expect(capturedSmartEditorProps?.sdkCapabilities).toBeUndefined()
        expect(capturedSmartEditorProps?.enableFileMentions).toBe(false)
        expect(capturedSmartEditorProps?.fileMentionsDir).toBeNull()
        expect(capturedSmartEditorProps?.placeholder).toBe("Describe your task...")
        expect(capturedSmartEditorProps?.resolveWorkingDir).toBeUndefined()
        expect(store.readProductProjectSdkCapabilities).not.toHaveBeenCalled()
        expect(store.repos.getGitInfo).not.toHaveBeenCalled()
        expect(store.repos.listBranches).not.toHaveBeenCalled()
        expect(store.repos.getGitSummary).not.toHaveBeenCalled()
        expect(lastEditorManager?.validateFiles).not.toHaveBeenCalled()
        expect(container.querySelector('button[aria-label="Use worktree"]')).toBeNull()
        expect(container.textContent).not.toContain("local-only.ts")
    })

    it("attaches Core-backed task creation APIs before app-store initialization", async () => {
        const store = createStore({
            runtimeProductAPI: false,
            coreOwnedProductRuntime: true,
        })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo })))
        )

        await vi.waitFor(() => expect(capturedSmartEditorProps?.enableFileMentions).toBe(true))
        expect(store.ensureCoreOwnedProductMethodsAvailable).toHaveBeenCalledWith(
            expect.arrayContaining([
                OPENADE_METHOD.taskCreate,
                OPENADE_METHOD.turnStart,
                OPENADE_METHOD.taskTitleGenerate,
                OPENADE_METHOD.taskImageWrite,
                OPENADE_METHOD.projectSdkCapabilitiesRead,
                OPENADE_METHOD.projectFilesFuzzySearch,
                OPENADE_METHOD.projectGitBranchesRead,
                OPENADE_METHOD.settingsMcpServersRead,
            ])
        )
        expect(capturedSmartEditorProps?.fileMentionsDir).toBe("/tmp/repo")
        expect(capturedSmartEditorProps?.slashCommandsDir).toBe("/tmp/repo")
        expect(capturedSmartEditorProps?.sdkCapabilities).toBeDefined()
        expect(container.querySelector('button[aria-label="Use worktree"]')).toBeInstanceOf(HTMLButtonElement)
    })

    it("hides Core-backed task creation file mentions when project file search is unavailable", async () => {
        const store = createStore({
            runtimeProductAPI: true,
            favorites: [{ path: "src/local-only.ts", fileName: "local-only.ts", parentDir: "src" }],
            canUseProductMethod: (method) => method !== OPENADE_METHOD.projectFilesFuzzySearch,
        })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo })))
        )

        await vi.waitFor(() => expect(capturedSmartEditorProps).not.toBeNull())
        expect(capturedSmartEditorProps?.enableFileMentions).toBe(false)
        expect(capturedSmartEditorProps?.fileMentionsDir).toBeNull()
        expect(capturedSmartEditorProps?.slashCommandsDir).toBe("/tmp/repo")
        expect(capturedSmartEditorProps?.sdkCapabilities).toBeDefined()
        expect(capturedSmartEditorProps?.placeholder).toBe("Describe your task... Use / for commands")
        expect(capturedSmartEditorProps?.resolveWorkingDir).toBeDefined()
        expect(container.textContent).not.toContain("local-only.ts")
        expect(lastEditorManager?.validateFiles).not.toHaveBeenCalled()
        expect(store.repos.getGitInfo).not.toHaveBeenCalled()
    })

    it("keeps legacy task creation slash commands on the trusted local path", async () => {
        await render(
            createElement(
                MemoryRouter,
                null,
                createElement(
                    CodeStoreProvider,
                    { store: createStore({ runtimeProductAPI: false }) },
                    createElement(TaskCreatePage, { workspaceId: "repo-1", repo })
                )
            )
        )

        await vi.waitFor(() => expect(capturedSmartEditorProps).not.toBeNull())
        expect(capturedSmartEditorProps?.fileMentionsDir).toBe("/tmp/repo")
        expect(capturedSmartEditorProps?.enableFileMentions).toBe(true)
        expect(capturedSmartEditorProps?.slashCommandsDir).toBe("/tmp/repo")
        expect(capturedSmartEditorProps?.sdkCapabilities).toBeDefined()
    })

    it("hides runtime-backed execution-mode buttons when turn start is unavailable", async () => {
        const store = createStore({
            runtimeProductAPI: true,
            editorValue: "describe runtime task",
            canUseProductMethod: (method) => method !== OPENADE_METHOD.turnStart,
        })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo })))
        )

        await vi.waitFor(() => expect(capturedSmartEditorProps).not.toBeNull())
        expect(container.querySelector('[title="Do (⌘1)"]')).toBeNull()
        expect(container.querySelector('[title="Plan (⌘2)"]')).toBeNull()
        expect(container.querySelector('[title="Ask (⌘3)"]')).toBeNull()
        expect(container.querySelector('[title="HyperPlan (⌘4)"]')).toBeNull()
        expect(container.querySelector('[title="Create Task (⌘1)"]')).toBeInstanceOf(HTMLButtonElement)
        expect(store.creation.newTask).not.toHaveBeenCalled()
    })

    it("allows Core-backed task creation without turn start when task create is advertised", async () => {
        const store = createStore({
            runtimeProductAPI: true,
            editorValue: "describe create-only task",
            canUseProductMethod: (method) => method !== OPENADE_METHOD.turnStart,
        })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo })))
        )

        await vi.waitFor(() => expect(capturedSmartEditorProps).not.toBeNull())
        const createButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Create Task"))
        expect(createButton).toBeInstanceOf(HTMLButtonElement)
        expect((createButton as HTMLButtonElement).disabled).toBe(false)
        expect(container.querySelector('[title="Do (⌘1)"]')).toBeNull()
        expect(container.querySelector('[title="Attach image"]')).toBeNull()

        await act(async () => {
            ;(createButton as HTMLButtonElement).click()
            await Promise.resolve()
        })

        expect(store.creation.newTask).toHaveBeenCalledWith(
            expect.objectContaining({
                repoId: "repo-1",
                description: "describe create-only task",
                mode: "do",
                isolationStrategy: { type: "head" },
            })
        )
    })

    it("drops stale MCP connector ids when Core-backed task creation loses MCP read capability", async () => {
        const allowedStore = createStore({
            runtimeProductAPI: true,
            editorValue: "describe allowed mcp task",
        })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store: allowedStore }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo })))
        )

        const mcpSelector = container.querySelector<HTMLButtonElement>('[data-testid="task-mcp-selector"]')
        expect(mcpSelector).toBeInstanceOf(HTMLButtonElement)
        await act(async () => {
            mcpSelector?.click()
            await Promise.resolve()
        })

        const deniedStore = createStore({
            runtimeProductAPI: true,
            editorValue: "describe denied mcp task",
            canUseProductMethod: (method) => method !== OPENADE_METHOD.settingsMcpServersRead,
        })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store: deniedStore }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo })))
        )

        expect(container.querySelector('[data-testid="task-mcp-selector"]')).toBeNull()

        const doButton = container.querySelector<HTMLButtonElement>('[title="Do (⌘1)"]')
        expect(doButton).toBeInstanceOf(HTMLButtonElement)
        await act(async () => {
            doButton?.click()
            await Promise.resolve()
        })

        const request = vi.mocked(deniedStore.creation.newTask).mock.calls.at(-1)?.[0]
        if (!request) throw new Error("Missing task-create request")
        expect(request).toMatchObject({
            repoId: "repo-1",
            description: "describe denied mcp task",
        })
        expect("enabledMcpServerIds" in request).toBe(false)
    })

    it("disables Core-backed task creation and image upload when task create is unavailable", async () => {
        const store = createStore({
            runtimeProductAPI: true,
            editorValue: "describe denied task",
            canUseProductMethod: (method) => method !== OPENADE_METHOD.taskCreate,
        })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo })))
        )

        await vi.waitFor(() => expect(capturedSmartEditorProps).not.toBeNull())
        const doButton = Array.from(container.querySelectorAll("button")).find((button) => button.title === "Do (⌘1)")
        expect(doButton).toBeInstanceOf(HTMLButtonElement)
        expect((doButton as HTMLButtonElement).disabled).toBe(true)
        expect(capturedSmartEditorProps?.enableImagePasteDrop).toBe(false)
        expect(container.querySelector('[title="Attach image"]')).toBeNull()

        await act(async () => {
            ;(doButton as HTMLButtonElement).click()
        })

        expect(store.creation.newTask).not.toHaveBeenCalled()
        expect(store.persistProductTaskImage).not.toHaveBeenCalled()
    })

    it("hides image upload when runtime task image write is unavailable", async () => {
        const store = createStore({
            runtimeProductAPI: true,
            editorValue: "describe runtime task",
            canUseProductMethod: (method) => method !== OPENADE_METHOD.taskImageWrite,
        })
        await render(
            createElement(MemoryRouter, null, createElement(CodeStoreProvider, { store }, createElement(TaskCreatePage, { workspaceId: "repo-1", repo })))
        )

        await vi.waitFor(() => expect(capturedSmartEditorProps).not.toBeNull())

        expect(capturedSmartEditorProps?.enableImagePasteDrop).toBe(false)
        expect(container.querySelector('[title="Attach image"]')).toBeNull()
        expect(store.persistProductTaskImage).not.toHaveBeenCalled()
    })
})
