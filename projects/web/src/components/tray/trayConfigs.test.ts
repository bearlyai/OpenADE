import { describe, expect, it, vi } from "vitest"
import { isValidElement } from "react"
import type { TrayManager } from "../../store/managers/TrayManager"
import { TRAY_CONFIGS } from "./trayConfigs"

interface ScratchpadContentProps {
    repoPath: string | null
    resolveRepoPath?: () => Promise<string | null>
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
        } as unknown as TrayManager

        files?.onOpen?.(tray)
        search?.onOpen?.(tray)
        gitlog?.onOpen?.(tray)
        terminal?.onOpen?.(tray)
        processes?.onOpen?.(tray)

        await vi.waitFor(() => {
            expect(calls).toEqual(["files:set:/runtime-repo", "search:set:/runtime-repo"])
        })
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
                shouldUseRuntimeProductAPI: () => true,
            },
        } as unknown as TrayManager

        const content = scratchpad?.renderContent(tray)
        if (!isValidElement<ScratchpadContentProps>(content)) throw new Error("Expected scratchpad content")

        expect(content.props.repoPath).toBeNull()
        expect(getGitInfo).not.toHaveBeenCalled()
        await expect(content.props.resolveRepoPath?.()).resolves.toBe("/runtime/repo/packages/app")
        expect(getGitInfo).toHaveBeenCalledWith("repo-1")
    })
})
