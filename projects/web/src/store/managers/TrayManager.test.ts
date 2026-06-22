import { describe, expect, it, vi } from "vitest"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import type { TaskModel } from "../TaskModel"
import type { CodeStore } from "../store"
import { TrayManager } from "./TrayManager"

function createDeferred<T>(): {
    promise: Promise<T>
    resolve: (value: T) => void
    reject: (reason?: unknown) => void
} {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

function createRuntimeFilesTrayManager(canUseProductMethod: (method: string) => boolean): {
    manager: TrayManager
    setWorkingDir: ReturnType<typeof vi.fn>
} {
    const setWorkingDir = vi.fn()
    const store = {
        canUseProductMethod,
    } as unknown as CodeStore
    const taskModel = {
        taskId: "task-1",
        workspaceId: "repo-1",
        usesRuntimeProductAPI: true,
        repoId: "repo-1",
        taskWorkingDirHint: "/repo",
        fileBrowser: {
            workingDir: "",
            setWorkingDir,
            refreshTree: vi.fn(),
        },
    } as unknown as TaskModel

    return { manager: new TrayManager(store, taskModel), setWorkingDir }
}

function createRuntimeChangesTrayManager(): {
    manager: TrayManager
    initializeForTray: ReturnType<typeof vi.fn>
    refreshGitState: ReturnType<typeof vi.fn>
} {
    const initializeForTray = vi.fn()
    const refreshGitState = vi.fn()
    const granted = new Set<string>([
        OPENADE_METHOD.taskGitSummaryRead,
        OPENADE_METHOD.taskChangesRead,
        OPENADE_METHOD.taskDiffRead,
        OPENADE_METHOD.taskFilePairRead,
    ])
    const store = {
        canUseProductMethod: (method: string) => granted.has(method),
    } as unknown as CodeStore
    const taskModel = {
        taskId: "task-1",
        workspaceId: "repo-1",
        usesRuntimeProductAPI: true,
        repoId: "repo-1",
        needsEnvironmentSetup: false,
        environment: { hasGit: true },
        refreshGitState,
        changes: {
            initializeForTray,
        },
        gitStatus: null,
    } as unknown as TaskModel

    return { manager: new TrayManager(store, taskModel), initializeForTray, refreshGitState }
}

describe("TrayManager", () => {
    it("does not open hidden runtime trays or run their onOpen handlers", () => {
        const { manager, setWorkingDir } = createRuntimeFilesTrayManager(() => false)

        manager.open("files")
        manager.toggle("files")

        expect(manager.openTray).toBeNull()
        expect(setWorkingDir).not.toHaveBeenCalled()
    })

    it("opens runtime trays when their scoped capabilities are advertised", () => {
        const granted = new Set<string>([OPENADE_METHOD.projectFilesTree, OPENADE_METHOD.projectFileRead, OPENADE_METHOD.projectFilesFuzzySearch])
        const { manager, setWorkingDir } = createRuntimeFilesTrayManager((method) => granted.has(method))

        manager.open("files")

        expect(manager.openTray).toBe("files")
        expect(setWorkingDir).toHaveBeenCalledWith("/repo")
    })

    it("drops delayed task working-directory resolution after the tray closes", async () => {
        const resolvedDir = createDeferred<string | null>()
        const setWorkingDir = vi.fn()
        const granted = new Set<string>([OPENADE_METHOD.projectFilesTree, OPENADE_METHOD.projectFileRead, OPENADE_METHOD.projectFilesFuzzySearch])
        const store = {
            canUseProductMethod: (method: string) => granted.has(method),
        } as unknown as CodeStore
        const taskModel = {
            taskId: "task-1",
            workspaceId: "repo-1",
            usesRuntimeProductAPI: true,
            repoId: "repo-1",
            taskWorkingDirHint: null,
            ensureTaskWorkingDirHint: vi.fn(() => resolvedDir.promise),
            fileBrowser: {
                workingDir: "",
                setWorkingDir,
                refreshTree: vi.fn(),
            },
        } as unknown as TaskModel
        const manager = new TrayManager(store, taskModel)

        manager.open("files")
        manager.close()
        resolvedDir.resolve("/repo")
        await resolvedDir.promise
        await Promise.resolve()

        expect(setWorkingDir).not.toHaveBeenCalled()
    })

    it("hides stale open tray content as soon as runtime capabilities disappear", () => {
        let canReadFiles = true
        const { manager } = createRuntimeFilesTrayManager(() => canReadFiles)

        manager.open("files")
        expect(manager.openTray).toBe("files")
        expect(manager.visibleOpenTray).toBe("files")
        expect(manager.isOpen).toBe(true)

        canReadFiles = false

        expect(manager.openTray).toBe("files")
        expect(manager.visibleOpenTray).toBeNull()
        expect(manager.isOpen).toBe(false)

        manager.ensureOpenTrayVisible()

        expect(manager.openTray).toBeNull()
    })

    it("still closes an already open tray if its capability disappears", () => {
        const { manager } = createRuntimeFilesTrayManager(() => false)
        manager.openTray = "files"

        manager.toggle("files")

        expect(manager.openTray).toBeNull()
    })

    it("does not rerun tray open side effects when the requested tray is already open", () => {
        const { manager, initializeForTray, refreshGitState } = createRuntimeChangesTrayManager()

        manager.open("changes")
        manager.open("changes")

        expect(manager.openTray).toBe("changes")
        expect(refreshGitState).toHaveBeenCalledTimes(1)
        expect(refreshGitState).toHaveBeenCalledWith()
        expect(initializeForTray).toHaveBeenCalledTimes(1)
    })

    it("keeps passive terminal close git refreshes on legacy sessions only", () => {
        const legacyRefreshGitState = vi.fn()
        const runtimeRefreshGitState = vi.fn()
        const store = {
            canUseProductMethod: (method: string) => method === OPENADE_METHOD.taskTerminalReconnect,
        } as unknown as CodeStore
        const legacyTaskModel = {
            taskId: "task-1",
            workspaceId: "repo-1",
            usesRuntimeProductAPI: false,
            repoId: "repo-1",
            taskWorkingDirHint: "/repo",
            refreshGitState: legacyRefreshGitState,
        } as unknown as TaskModel
        const runtimeTaskModel = {
            taskId: "task-1",
            workspaceId: "repo-1",
            usesRuntimeProductAPI: true,
            repoId: "repo-1",
            taskWorkingDirHint: "/repo",
            refreshGitState: runtimeRefreshGitState,
        } as unknown as TaskModel
        const legacyManager = new TrayManager(store, legacyTaskModel)
        const runtimeManager = new TrayManager(store, runtimeTaskModel)

        legacyManager.open("terminal")
        legacyManager.close()
        runtimeManager.open("terminal")
        runtimeManager.close()

        expect(legacyRefreshGitState).toHaveBeenCalledTimes(1)
        expect(legacyRefreshGitState).toHaveBeenCalledWith()
        expect(runtimeRefreshGitState).not.toHaveBeenCalled()
    })
})
