import { describe, expect, it, vi } from "vitest"
import { isValidElement } from "react"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import type { TrayManager } from "../../store/managers/TrayManager"
import type { TaskTerminalProductAccess } from "../terminalSession"
import { TRAY_CONFIGS } from "./trayConfigs"

interface ScratchpadContentProps {
    repoPath: string | null
    resolveRepoPath?: () => Promise<string | null>
}

interface TerminalContentProps {
    productAccess?: TaskTerminalProductAccess | null
}

describe("tray visibility", () => {
    it("keeps git-backed trays visible while an already set-up task reloads its environment cache", () => {
        const changes = TRAY_CONFIGS.find((config) => config.id === "changes")
        const gitlog = TRAY_CONFIGS.find((config) => config.id === "gitlog")
        const tray = {
            taskModel: {
                environment: null,
                needsEnvironmentSetup: false,
            },
        } as unknown as TrayManager

        expect(changes?.isVisible?.(tray)).toBe(true)
        expect(gitlog?.isVisible?.(tray)).toBe(true)
    })

    it("uses cached scoped git summary when the Changes tray is explicitly opened", () => {
        const changes = TRAY_CONFIGS.find((config) => config.id === "changes")
        const refreshGitState = vi.fn()
        const initializeForTray = vi.fn()
        const tray = {
            taskModel: {
                refreshGitState,
                changes: { initializeForTray },
            },
        } as unknown as TrayManager

        changes?.onOpen?.(tray)

        expect(refreshGitState).toHaveBeenCalledWith()
        expect(initializeForTray).toHaveBeenCalledOnce()
    })

    it("initializes file and search trays from the task working directory hint", () => {
        const files = TRAY_CONFIGS.find((config) => config.id === "files")
        const search = TRAY_CONFIGS.find((config) => config.id === "search")
        const calls: string[] = []
        const fileBrowser = {
            workingDir: "",
            setWorkingDir: (dir: string) => {
                calls.push(`files:set:${dir}`)
                fileBrowser.workingDir = dir
            },
            refreshTree: () => {
                calls.push("files:refresh")
            },
        }
        const contentSearch = {
            setWorkingDir: (dir: string) => {
                calls.push(`search:set:${dir}`)
            },
        }
        const tray = {
            taskModel: {
                taskWorkingDirHint: "/repo",
                fileBrowser,
                contentSearch,
            },
        } as unknown as TrayManager

        files?.onOpen?.(tray)
        files?.onOpen?.(tray)
        search?.onOpen?.(tray)

        expect(calls).toEqual(["files:set:/repo", "files:refresh", "search:set:/repo"])
    })

    it("lazily resolves task working directories for explicit task-scoped trays when the hint is not yet cached", async () => {
        const files = TRAY_CONFIGS.find((config) => config.id === "files")
        const search = TRAY_CONFIGS.find((config) => config.id === "search")
        const gitlog = TRAY_CONFIGS.find((config) => config.id === "gitlog")
        const terminal = TRAY_CONFIGS.find((config) => config.id === "terminal")
        const processes = TRAY_CONFIGS.find((config) => config.id === "processes")
        const calls: string[] = []
        const fileBrowser = {
            workingDir: "",
            setWorkingDir: (dir: string) => {
                calls.push(`files:set:${dir}`)
                fileBrowser.workingDir = dir
            },
            refreshTree: () => {
                calls.push("files:refresh")
            },
        }
        const contentSearch = {
            setWorkingDir: (dir: string) => {
                calls.push(`search:set:${dir}`)
            },
        }
        const ensureTaskWorkingDirHint = vi.fn(async () => "/runtime-repo")
        const tray = {
            taskModel: {
                taskWorkingDirHint: null,
                ensureTaskWorkingDirHint,
                fileBrowser,
                contentSearch,
            },
            visibleOpenTray: "files",
        } as unknown as TrayManager
        const mutableTray = tray as unknown as { visibleOpenTray: string }

        files?.onOpen?.(tray)
        await vi.waitFor(() => {
            expect(calls).toEqual(["files:set:/runtime-repo"])
        })
        mutableTray.visibleOpenTray = "search"
        search?.onOpen?.(tray)
        await vi.waitFor(() => {
            expect(calls).toEqual(["files:set:/runtime-repo", "search:set:/runtime-repo"])
        })
        mutableTray.visibleOpenTray = "gitlog"
        gitlog?.onOpen?.(tray)
        mutableTray.visibleOpenTray = "terminal"
        terminal?.onOpen?.(tray)
        mutableTray.visibleOpenTray = "processes"
        processes?.onOpen?.(tray)

        expect(ensureTaskWorkingDirHint).toHaveBeenCalledTimes(5)
    })

    it("passes a lazy Core repo path resolver to scratchpad content when repo projection is missing", async () => {
        const scratchpad = TRAY_CONFIGS.find((config) => config.id === "scratchpad")
        const getRepo = vi.fn(() => undefined)
        const getGitInfo = vi.fn(async () => ({
            isGitRepo: true,
            repoRoot: "/runtime/repo",
            relativePath: "packages/app",
            mainBranch: "main",
            hasGhCli: false,
        }))
        const tray = {
            workspaceId: "repo-1",
            store: {
                repos: { getRepo, getGitInfo },
                shouldUseRuntimeProductAPI: () => false,
                usesCoreOwnedProductRuntime: () => true,
            },
        } as unknown as TrayManager

        const content = scratchpad?.renderContent(tray)
        if (!isValidElement<ScratchpadContentProps>(content)) throw new Error("Expected scratchpad content")

        expect(content.props.repoPath).toBeNull()
        expect(getGitInfo).not.toHaveBeenCalled()
        await expect(content.props.resolveRepoPath?.()).resolves.toBe("/runtime/repo/packages/app")
        expect(getGitInfo).toHaveBeenCalledWith("repo-1")
    })

    it("hides classic task-scoped trays in runtime sessions until scoped read capabilities are advertised", () => {
        const files = TRAY_CONFIGS.find((config) => config.id === "files")
        const search = TRAY_CONFIGS.find((config) => config.id === "search")
        const changes = TRAY_CONFIGS.find((config) => config.id === "changes")
        const gitlog = TRAY_CONFIGS.find((config) => config.id === "gitlog")
        const processes = TRAY_CONFIGS.find((config) => config.id === "processes")
        const taskModel = {
            usesRuntimeProductAPI: true,
            repoId: "repo-1",
            environment: { hasGit: true },
        }
        const deniedTray = {
            taskModel,
            store: {
                canUseProductMethod: vi.fn(() => false),
            },
        } as unknown as TrayManager

        expect(files?.isVisible?.(deniedTray)).toBe(false)
        expect(search?.isVisible?.(deniedTray)).toBe(false)
        expect(changes?.isVisible?.(deniedTray)).toBe(false)
        expect(gitlog?.isVisible?.(deniedTray)).toBe(false)
        expect(processes?.isVisible?.(deniedTray)).toBe(false)

        const grantedMethods = new Set<string>([
            OPENADE_METHOD.projectFilesTree,
            OPENADE_METHOD.projectFileRead,
            OPENADE_METHOD.projectFilesFuzzySearch,
            OPENADE_METHOD.projectSearch,
            OPENADE_METHOD.taskGitSummaryRead,
            OPENADE_METHOD.taskChangesRead,
            OPENADE_METHOD.taskDiffRead,
            OPENADE_METHOD.taskFilePairRead,
            OPENADE_METHOD.taskGitScopesRead,
            OPENADE_METHOD.taskGitLog,
            OPENADE_METHOD.taskGitCommitFilesRead,
            OPENADE_METHOD.taskGitCommitFilePatchRead,
            OPENADE_METHOD.taskGitFileAtTreeishRead,
            OPENADE_METHOD.projectProcessList,
        ])
        const grantedTray = {
            taskModel,
            store: {
                canUseProductMethod: vi.fn((method: string) => grantedMethods.has(method)),
            },
        } as unknown as TrayManager

        expect(files?.isVisible?.(grantedTray)).toBe(true)
        expect(search?.isVisible?.(grantedTray)).toBe(true)
        expect(changes?.isVisible?.(grantedTray)).toBe(true)
        expect(gitlog?.isVisible?.(grantedTray)).toBe(true)
        expect(processes?.isVisible?.(grantedTray)).toBe(true)
    })

    it("derives classic terminal product access from runtime method capabilities", async () => {
        const terminal = TRAY_CONFIGS.find((config) => config.id === "terminal")
        const canUseProductMethod = vi.fn((method: string) => method === OPENADE_METHOD.taskTerminalReconnect)
        const startProductTaskTerminal = vi.fn()
        const reconnectProductTaskTerminal = vi.fn(async (args: { terminalId?: string }) => ({
            repoId: "repo-1",
            taskId: "task-1",
            terminalId: args.terminalId ?? "terminal-1",
            found: true,
            output: [],
            outputCount: 0,
        }))
        const writeProductTaskTerminal = vi.fn()
        const resizeProductTaskTerminal = vi.fn()
        const stopProductTaskTerminal = vi.fn()
        const tray = {
            taskId: "task-1",
            taskModel: {
                taskWorkingDirHint: "/repo",
                usesRuntimeProductAPI: true,
                repoId: "repo-1",
                refreshGitState: vi.fn(),
            },
            store: {
                canUseProductMethod,
                startProductTaskTerminal,
                reconnectProductTaskTerminal,
                writeProductTaskTerminal,
                resizeProductTaskTerminal,
                stopProductTaskTerminal,
            },
            close: vi.fn(),
        } as unknown as TrayManager

        expect(terminal?.isVisible?.(tray)).toBe(true)
        const content = terminal?.renderContent(tray)
        if (!isValidElement<TerminalContentProps>(content)) throw new Error("Expected terminal content")
        const access = content.props.productAccess
        if (!access) throw new Error("Expected product terminal access")

        expect(access.capabilities).toEqual({
            canStart: false,
            canReconnect: true,
            canWrite: false,
            canResize: false,
            canStop: false,
        })

        await expect(access.startTaskTerminal({ cols: 80, rows: 24 })).resolves.toEqual({
            repoId: "repo-1",
            taskId: "task-1",
            terminalId: "",
            ok: false,
            error: "terminal start is not permitted",
        })
        await expect(access.reconnectTaskTerminal({ terminalId: "terminal-1" })).resolves.toEqual({
            repoId: "repo-1",
            taskId: "task-1",
            terminalId: "terminal-1",
            found: true,
            output: [],
            outputCount: 0,
        })
        await expect(access.writeTaskTerminal({ terminalId: "terminal-1", data: "pwd\n" })).resolves.toEqual({
            repoId: "repo-1",
            taskId: "task-1",
            terminalId: "terminal-1",
            ok: false,
        })
        await expect(access.resizeTaskTerminal({ terminalId: "terminal-1", cols: 100, rows: 30 })).resolves.toEqual({
            repoId: "repo-1",
            taskId: "task-1",
            terminalId: "terminal-1",
            ok: false,
        })
        await expect(access.stopTaskTerminal({ terminalId: "terminal-1" })).resolves.toEqual({
            repoId: "repo-1",
            taskId: "task-1",
            terminalId: "terminal-1",
            ok: false,
        })

        expect(startProductTaskTerminal).not.toHaveBeenCalled()
        expect(reconnectProductTaskTerminal).toHaveBeenCalledWith({ repoId: "repo-1", taskId: "task-1", terminalId: "terminal-1" })
        expect(writeProductTaskTerminal).not.toHaveBeenCalled()
        expect(resizeProductTaskTerminal).not.toHaveBeenCalled()
        expect(stopProductTaskTerminal).not.toHaveBeenCalled()
    })

    it("rechecks classic terminal product access capabilities after the access object is created", async () => {
        const terminal = TRAY_CONFIGS.find((config) => config.id === "terminal")
        const grantedMethods = new Set<string>([OPENADE_METHOD.taskTerminalReconnect, OPENADE_METHOD.taskTerminalWrite])
        const writeProductTaskTerminal = vi.fn(async (args: { terminalId: string }) => ({
            repoId: "repo-1",
            taskId: "task-1",
            terminalId: args.terminalId,
            ok: true,
        }))
        const tray = {
            taskId: "task-1",
            taskModel: {
                taskWorkingDirHint: "/repo",
                usesRuntimeProductAPI: true,
                repoId: "repo-1",
                refreshGitState: vi.fn(),
            },
            store: {
                canUseProductMethod: vi.fn((method: string) => grantedMethods.has(method)),
                startProductTaskTerminal: vi.fn(),
                reconnectProductTaskTerminal: vi.fn(async (args: { terminalId?: string }) => ({
                    repoId: "repo-1",
                    taskId: "task-1",
                    terminalId: args.terminalId ?? "terminal-1",
                    found: true,
                    output: [],
                    outputCount: 0,
                })),
                writeProductTaskTerminal,
                resizeProductTaskTerminal: vi.fn(),
                stopProductTaskTerminal: vi.fn(),
            },
            close: vi.fn(),
        } as unknown as TrayManager

        const content = terminal?.renderContent(tray)
        if (!isValidElement<TerminalContentProps>(content)) throw new Error("Expected terminal content")
        const access = content.props.productAccess
        if (!access) throw new Error("Expected product terminal access")

        expect(access.capabilities.canWrite).toBe(true)
        await expect(access.writeTaskTerminal({ terminalId: "terminal-1", data: "pwd\n" })).resolves.toEqual({
            repoId: "repo-1",
            taskId: "task-1",
            terminalId: "terminal-1",
            ok: true,
        })

        grantedMethods.delete(OPENADE_METHOD.taskTerminalWrite)

        expect(access.capabilities.canWrite).toBe(false)
        await expect(access.writeTaskTerminal({ terminalId: "terminal-1", data: "pwd\n" })).resolves.toEqual({
            repoId: "repo-1",
            taskId: "task-1",
            terminalId: "terminal-1",
            ok: false,
        })
        expect(writeProductTaskTerminal).toHaveBeenCalledTimes(1)
    })

    it("hides the classic terminal tray when a runtime product session has no terminal attach methods", () => {
        const terminal = TRAY_CONFIGS.find((config) => config.id === "terminal")
        const tray = {
            taskModel: {
                usesRuntimeProductAPI: true,
                repoId: "repo-1",
            },
            store: {
                canUseProductMethod: vi.fn(() => false),
            },
        } as unknown as TrayManager

        expect(terminal?.isVisible?.(tray)).toBe(false)
    })
})
