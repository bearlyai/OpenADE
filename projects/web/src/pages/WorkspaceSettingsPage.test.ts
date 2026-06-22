import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../openade-client/src"
import { CodeStoreProvider } from "../store/context"
import type { CodeStore } from "../store/store"
import type { Repo } from "../types"
import { WorkspaceSettingsPage, syncLegacyRepoStoreBeforeWorkspaceReload } from "./WorkspaceSettingsPage"

const gitApiMocks = vi.hoisted(() => ({
    resolvePath: vi.fn(),
    isGitDirectory: vi.fn(),
    initGit: vi.fn(),
    isGitApiAvailable: vi.fn(() => true),
}))

const shellApiMocks = vi.hoisted(() => ({
    selectDirectory: vi.fn(),
    isDirectorySelectionAvailable: vi.fn(() => true),
}))

vi.mock("../electronAPI/git", () => ({
    resolvePath: gitApiMocks.resolvePath,
    isGitDirectory: gitApiMocks.isGitDirectory,
    initGit: gitApiMocks.initGit,
    isGitApiAvailable: gitApiMocks.isGitApiAvailable,
}))

vi.mock("../electronAPI/shell", () => ({
    selectDirectory: shellApiMocks.selectDirectory,
    isDirectorySelectionAvailable: shellApiMocks.isDirectorySelectionAvailable,
}))

const navigateGo = vi.fn()

vi.mock("../routing", () => ({
    useCodeNavigate: () => ({ go: navigateGo }),
}))

vi.mock("../components/ui", async () => {
    const React = await import("react")
    return {
        ScrollArea: ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children),
    }
})

const repo: Repo = {
    id: "repo-1",
    name: "App",
    path: "/Users/test/Projects/app",
    createdBy: { id: "user-1", email: "user@example.com" },
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
}

function createStore({
    runtimeProductAPI = true,
    coreOwnedProductRuntime = true,
    canUseProductMethod = (method: string) => method === OPENADE_METHOD.repoUpdate || method === OPENADE_METHOD.repoPathInspect,
}: {
    runtimeProductAPI?: boolean
    coreOwnedProductRuntime?: boolean
    canUseProductMethod?: (method: string) => boolean
} = {}): CodeStore {
    let runtimeProductAPIAvailable = runtimeProductAPI
    const canUseProductMethodMock = vi.fn(canUseProductMethod)
    const ensureCoreOwnedProductMethodsAvailable = vi.fn(async () => {
        runtimeProductAPIAvailable = true
    })
    return {
        canUseProductMethod: canUseProductMethodMock,
        canUseProductMethodAfterConnect: vi.fn(async (method: string) => {
            runtimeProductAPIAvailable = true
            return canUseProductMethodMock(method)
        }),
        shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
        usesCoreOwnedProductRuntime: vi.fn(() => coreOwnedProductRuntime),
        ensureCoreOwnedProductMethodsAvailable,
        inspectProductRepoPath: vi
            .fn()
            .mockResolvedValueOnce({
                path: repo.path,
                resolvedPath: repo.path,
                exists: true,
                isDirectory: true,
                isGitRepo: false,
                error: "not a git repository",
            })
            .mockResolvedValue({
                path: repo.path,
                resolvedPath: repo.path,
                exists: true,
                isDirectory: true,
                isGitRepo: true,
                repoRoot: repo.path,
                relativePath: "",
                mainBranch: "main",
                hasGhCli: false,
            }),
        repos: {
            updateRepo: vi.fn(async () => repo),
        },
        syncRepoStore: vi.fn(async () => undefined),
    } as unknown as CodeStore
}

describe("WorkspaceSettingsPage Core-owned repo path inspection", () => {
    let container: HTMLDivElement
    let root: Root
    let previousActEnvironment: boolean | undefined

    beforeEach(() => {
        previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        vi.useFakeTimers()
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
        navigateGo.mockReset()
        gitApiMocks.resolvePath.mockReset()
        gitApiMocks.isGitDirectory.mockReset()
        gitApiMocks.initGit.mockReset()
        gitApiMocks.isGitApiAvailable.mockReturnValue(true)
        shellApiMocks.selectDirectory.mockReset()
        shellApiMocks.isDirectorySelectionAvailable.mockReturnValue(true)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        vi.useRealTimers()
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

    it("uses Core path inspection and initializes git through repo update instead of Electron git helpers", async () => {
        const store = createStore({ runtimeProductAPI: false })
        gitApiMocks.isGitApiAvailable.mockReturnValue(false)

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(WorkspaceSettingsPage, { workspaceId: repo.id, repo })))
            await vi.advanceTimersByTimeAsync(350)
        })

        await vi.waitFor(() => expect(store.ensureCoreOwnedProductMethodsAvailable).toHaveBeenCalledWith(expect.arrayContaining([OPENADE_METHOD.repoUpdate])))

        await act(async () => {
            await vi.waitFor(() => expect(store.inspectProductRepoPath).toHaveBeenCalledWith({ path: repo.path }))
        })
        expect(gitApiMocks.resolvePath).not.toHaveBeenCalled()
        expect(gitApiMocks.isGitDirectory).not.toHaveBeenCalled()
        expect(container.textContent).toContain("Browse")
        await act(async () => {
            await vi.waitFor(() => expect(container.textContent).toContain("OpenADE Core will initialize one when you save these settings."))
        })
        expect(container.textContent).not.toContain("Initialize Git Repository")

        const submit = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Changes"))
        if (!submit) throw new Error("save button not found")

        await act(async () => {
            submit.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            await Promise.resolve()
        })

        expect(store.repos.updateRepo).toHaveBeenCalledWith(repo.id, {
            path: repo.path,
            initializeGit: true,
        })
        expect(gitApiMocks.initGit).not.toHaveBeenCalled()
        await act(async () => {
            await vi.waitFor(() => expect(store.inspectProductRepoPath).toHaveBeenCalledTimes(2))
            await vi.waitFor(() => expect(container.textContent).toContain("Git repository detected (default branch: main)"))
        })
    })

    it("fails closed instead of using Electron git helpers while Core owns repo config but is not attached", async () => {
        const store = {
            ...createStore(),
            canUseProductMethod: vi.fn(() => false),
            canUseProductMethodAfterConnect: vi.fn(async () => false),
            shouldUseRuntimeProductAPI: vi.fn(() => false),
            usesCoreOwnedProductRuntime: vi.fn(() => true),
            ensureCoreOwnedProductMethodsAvailable: vi.fn(async () => undefined),
            inspectProductRepoPath: vi.fn(),
            repos: {
                updateRepo: vi.fn(),
            },
            syncRepoStore: vi.fn(),
        } as unknown as CodeStore

        await act(async () => {
            root.render(createElement(CodeStoreProvider, { store }, createElement(WorkspaceSettingsPage, { workspaceId: repo.id, repo })))
            await vi.advanceTimersByTimeAsync(350)
        })

        expect(store.inspectProductRepoPath).not.toHaveBeenCalled()
        expect(gitApiMocks.resolvePath).not.toHaveBeenCalled()
        expect(gitApiMocks.isGitDirectory).not.toHaveBeenCalled()
        expect(gitApiMocks.initGit).not.toHaveBeenCalled()
        expect(container.textContent).not.toContain("Initialize Git Repository")

        const submit = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Changes"))
        if (!submit) throw new Error("save button not found")
        expect(submit.disabled).toBe(true)
        expect(store.repos.updateRepo).not.toHaveBeenCalled()
    })

    it("keeps the pre-reload legacy repo-store sync out of Core-owned path updates", async () => {
        const syncRepoStore = vi.fn(async () => undefined)

        await syncLegacyRepoStoreBeforeWorkspaceReload({ syncRepoStore }, { coreOwnsRepoHostConfig: true })
        expect(syncRepoStore).not.toHaveBeenCalled()

        await syncLegacyRepoStoreBeforeWorkspaceReload({ syncRepoStore }, { coreOwnsRepoHostConfig: false })
        expect(syncRepoStore).toHaveBeenCalledTimes(1)
    })
})
