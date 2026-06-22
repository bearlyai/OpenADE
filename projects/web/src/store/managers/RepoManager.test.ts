import { describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import { gitApi } from "../../electronAPI/git"
import type { CodeStore } from "../store"
import { RepoManager } from "./RepoManager"

function createStore({
    useRuntimeProductAPI,
    usesCoreOwnedProductRuntime = false,
    canUseProductMethod = () => true,
    hasRepoStore = true,
}: {
    useRuntimeProductAPI: boolean
    usesCoreOwnedProductRuntime?: boolean
    canUseProductMethod?: (method: string) => boolean
    hasRepoStore?: boolean
}): CodeStore {
    let runtimeProductAPIAvailable = useRuntimeProductAPI
    const canUseProductMethodAfterConnect = vi.fn(async (method: string) => {
        if (!canUseProductMethod(method)) return false
        runtimeProductAPIAvailable = true
        return true
    })
    return {
        repoStore: hasRepoStore ? { repos: { all: vi.fn(() => []) } } : null,
        currentUser: { id: "user-1", email: "user@example.com" },
        getRuntimeProductProjectProjection: vi.fn(() =>
            runtimeProductAPIAvailable
                ? [
                      {
                          id: "repo-1",
                          name: "Runtime Repo",
                          path: "/tmp/repo",
                      },
                  ]
                : null
        ),
        shouldUseRuntimeProductAPI: vi.fn(() => runtimeProductAPIAvailable),
        usesCoreOwnedProductRuntime: vi.fn(() => usesCoreOwnedProductRuntime),
        canUseProductMethod: vi.fn((method: string) => {
            if (usesCoreOwnedProductRuntime && !runtimeProductAPIAvailable) return false
            if (!runtimeProductAPIAvailable) return true
            return canUseProductMethod(method)
        }),
        canUseProductMethodAfterConnect,
        createProductRepo: vi.fn(async () => ({ repoId: "repo-1" })),
        updateProductRepo: vi.fn(async () => undefined),
        deleteProductRepo: vi.fn(async () => undefined),
        readProductProjectGitInfo: vi.fn(async () => ({
            repoId: "repo-1",
            isGitRepo: true,
            repoRoot: "/tmp/repo",
            relativePath: "",
            mainBranch: "main",
            hasGhCli: true,
        })),
        readProductProjectGitBranches: vi.fn(async () => ({
            repoId: "repo-1",
            defaultBranch: "main",
            branches: [{ name: "main", isDefault: true, isRemote: false }],
        })),
        readProductProjectGitSummary: vi.fn(async () => ({
            repoId: "repo-1",
            branch: "main",
            headCommit: "abc123",
            ahead: 0,
            hasChanges: false,
            staged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
            unstaged: { files: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } },
            untracked: [],
        })),
        refreshProductStateAfterRepoMutation: vi.fn(async () => undefined),
    } as unknown as CodeStore
}

describe("RepoManager runtime capabilities", () => {
    it("does not issue runtime repo mutations when repo admin capabilities are unavailable", async () => {
        const store = createStore({
            useRuntimeProductAPI: true,
            canUseProductMethod: (method) =>
                method !== OPENADE_METHOD.repoCreate && method !== OPENADE_METHOD.repoUpdate && method !== OPENADE_METHOD.repoDelete,
        })
        const manager = new RepoManager(store)

        await expect(manager.createRepo({ name: "Workspace", path: "/tmp/workspace" })).resolves.toBeNull()
        await expect(manager.updateRepo("repo-1", { name: "Renamed" })).resolves.toBeNull()
        await manager.setRepoArchived("repo-1", true)
        await expect(manager.deleteRepo("repo-1")).resolves.toBe(false)

        expect(store.createProductRepo).not.toHaveBeenCalled()
        expect(store.updateProductRepo).not.toHaveBeenCalled()
        expect(store.deleteProductRepo).not.toHaveBeenCalled()
        expect(store.refreshProductStateAfterRepoMutation).not.toHaveBeenCalled()
    })

    it("keeps legacy repo mutations available outside runtime product mode", async () => {
        const store = createStore({
            useRuntimeProductAPI: false,
        })
        const manager = new RepoManager(store)

        await manager.createRepo({ name: "Workspace", path: "/tmp/workspace" })
        await manager.updateRepo("repo-1", { path: "/tmp/renamed" })
        await manager.setRepoArchived("repo-1", true)
        await expect(manager.deleteRepo("repo-1")).resolves.toBe(true)

        expect(store.createProductRepo).toHaveBeenCalledWith({
            name: "Workspace",
            path: "/tmp/workspace",
            createdBy: store.currentUser,
            createDirectory: undefined,
            initializeGit: undefined,
        })
        expect(store.updateProductRepo).toHaveBeenCalledWith({ repoId: "repo-1", path: "/tmp/renamed" })
        expect(store.updateProductRepo).toHaveBeenCalledWith({ repoId: "repo-1", archived: true })
        expect(store.deleteProductRepo).toHaveBeenCalledWith({ repoId: "repo-1" })
    })

    it("does not issue runtime project git reads when project git capabilities are unavailable", async () => {
        const store = createStore({
            useRuntimeProductAPI: true,
            canUseProductMethod: (method) =>
                method !== OPENADE_METHOD.projectGitInfoRead &&
                method !== OPENADE_METHOD.projectGitBranchesRead &&
                method !== OPENADE_METHOD.projectGitSummaryRead,
        })
        const manager = new RepoManager(store)

        await expect(manager.getGitInfo("repo-1")).resolves.toBeNull()
        await expect(manager.refreshGhCliStatus("repo-1")).resolves.toBe(false)
        await expect(manager.listBranches("repo-1")).resolves.toEqual({ branches: [], defaultBranch: "main" })
        await expect(manager.getGitSummary("repo-1")).resolves.toMatchObject({
            branch: null,
            headCommit: "",
            hasChanges: false,
            staged: { files: [] },
            unstaged: { files: [] },
            untracked: [],
        })

        expect(store.readProductProjectGitInfo).not.toHaveBeenCalled()
        expect(store.readProductProjectGitBranches).not.toHaveBeenCalled()
        expect(store.readProductProjectGitSummary).not.toHaveBeenCalled()
    })

    it("does not fall back to raw gh status checks while Core owns product state", async () => {
        const ghStatus = vi.spyOn(gitApi, "checkGhCli").mockRejectedValue(new Error("legacy gh status should not be used"))
        const store = createStore({
            useRuntimeProductAPI: false,
            usesCoreOwnedProductRuntime: true,
            canUseProductMethod: () => false,
        })
        const manager = new RepoManager(store)

        await expect(manager.refreshGhCliStatus("repo-1")).resolves.toBe(false)

        expect(ghStatus).not.toHaveBeenCalled()
        expect(store.readProductProjectGitInfo).not.toHaveBeenCalled()
    })

    it("does not fall back to raw project git reads while Core owns product state", async () => {
        const gitInfo = vi.spyOn(gitApi, "isGitDirectory").mockRejectedValue(new Error("legacy git info should not be used"))
        const gitSummary = vi.spyOn(gitApi, "getGitSummary").mockRejectedValue(new Error("legacy git summary should not be used"))
        const branches = vi.spyOn(gitApi, "listBranches").mockRejectedValue(new Error("legacy branches should not be used"))
        const store = createStore({
            useRuntimeProductAPI: false,
            usesCoreOwnedProductRuntime: true,
            canUseProductMethod: () => false,
        })
        const manager = new RepoManager(store)

        await expect(manager.getGitInfo("repo-1")).resolves.toBeNull()
        await expect(manager.getGitSummary("repo-1")).resolves.toMatchObject({
            branch: null,
            headCommit: "",
            hasChanges: false,
        })
        await expect(manager.listBranches("repo-1")).resolves.toEqual({ branches: [], defaultBranch: "main" })

        expect(gitInfo).not.toHaveBeenCalled()
        expect(gitSummary).not.toHaveBeenCalled()
        expect(branches).not.toHaveBeenCalled()
        expect(store.readProductProjectGitInfo).not.toHaveBeenCalled()
        expect(store.readProductProjectGitSummary).not.toHaveBeenCalled()
        expect(store.readProductProjectGitBranches).not.toHaveBeenCalled()
    })

    it("attaches Core-owned product git info without falling back to raw git reads", async () => {
        const gitInfo = vi.spyOn(gitApi, "isGitDirectory").mockRejectedValue(new Error("legacy git info should not be used"))
        const store = createStore({
            useRuntimeProductAPI: false,
            usesCoreOwnedProductRuntime: true,
            canUseProductMethod: () => true,
        })
        const manager = new RepoManager(store)

        await expect(manager.getGitInfo("repo-1")).resolves.toMatchObject({ repoRoot: "/tmp/repo", mainBranch: "main" })

        expect(store.canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.projectGitInfoRead)
        expect(gitInfo).not.toHaveBeenCalled()
        expect(store.readProductProjectGitInfo).toHaveBeenCalledWith({ repoId: "repo-1" })
    })

    it("does not refresh legacy repo storage after repo mutations while Core owns product state", async () => {
        const store = createStore({
            useRuntimeProductAPI: false,
            usesCoreOwnedProductRuntime: true,
            canUseProductMethod: () => true,
        })
        const manager = new RepoManager(store)

        await manager.createRepo({ name: "Workspace", path: "/tmp/workspace" })
        await manager.updateRepo("repo-1", { name: "Renamed" })
        await manager.setRepoArchived("repo-1", true)
        await manager.deleteRepo("repo-1")

        expect(store.canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.repoCreate)
        expect(store.createProductRepo).toHaveBeenCalled()
        expect(store.updateProductRepo).toHaveBeenCalledWith({ repoId: "repo-1", name: "Renamed" })
        expect(store.updateProductRepo).toHaveBeenCalledWith({ repoId: "repo-1", archived: true })
        expect(store.deleteProductRepo).toHaveBeenCalledWith({ repoId: "repo-1" })
        expect(store.refreshProductStateAfterRepoMutation).not.toHaveBeenCalled()
    })

    it("uses Core-owned repo mutations without requiring a legacy repo store before runtime projection attaches", async () => {
        const store = createStore({
            useRuntimeProductAPI: false,
            usesCoreOwnedProductRuntime: true,
            hasRepoStore: false,
            canUseProductMethod: (method) =>
                method === OPENADE_METHOD.repoCreate || method === OPENADE_METHOD.repoUpdate || method === OPENADE_METHOD.repoDelete,
        })
        const manager = new RepoManager(store)

        await expect(manager.createRepo({ name: "Workspace", path: "/tmp/workspace" })).resolves.toEqual(
            expect.objectContaining({ id: "repo-1", path: "/tmp/repo" })
        )
        await expect(manager.updateRepo("repo-1", { name: "Renamed" })).resolves.toEqual(expect.objectContaining({ id: "repo-1", path: "/tmp/repo" }))
        await manager.setRepoArchived("repo-1", true)
        await expect(manager.deleteRepo("repo-1")).resolves.toBe(true)

        expect(store.createProductRepo).toHaveBeenCalledWith({
            name: "Workspace",
            path: "/tmp/workspace",
            createdBy: store.currentUser,
            createDirectory: undefined,
            initializeGit: undefined,
        })
        expect(store.updateProductRepo).toHaveBeenCalledWith({ repoId: "repo-1", name: "Renamed" })
        expect(store.updateProductRepo).toHaveBeenCalledWith({ repoId: "repo-1", archived: true })
        expect(store.deleteProductRepo).toHaveBeenCalledWith({ repoId: "repo-1" })
        expect(store.refreshProductStateAfterRepoMutation).not.toHaveBeenCalled()
    })

    it("passes Core-owned repo host creation flags through the product repo mutation", async () => {
        const store = createStore({
            useRuntimeProductAPI: true,
            usesCoreOwnedProductRuntime: true,
        })
        const manager = new RepoManager(store)

        await manager.createRepo({
            name: "Workspace",
            path: "/tmp/workspace",
            createDirectory: true,
            initializeGit: true,
        })

        expect(store.createProductRepo).toHaveBeenCalledWith({
            name: "Workspace",
            path: "/tmp/workspace",
            createdBy: store.currentUser,
            createDirectory: true,
            initializeGit: true,
        })
        expect(store.canUseProductMethodAfterConnect).toHaveBeenCalledWith(OPENADE_METHOD.repoCreate)
    })
})
