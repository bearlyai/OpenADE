import { beforeEach, describe, expect, it, vi } from "vitest"
import { loadEditableProcsFile, readProcs, saveEditableProcsFile } from "../../electronAPI/procs"
import {
    loadProcsEditorFile,
    readProcsEditorConfigs,
    runProcsEditorCronAssist,
    runProcsEditorRecommendations,
    saveProcsEditorFile,
} from "./ProcsEditorModal"

const harnessQueryMock = vi.hoisted(() => ({
    runStructuredHarnessQuery: vi.fn(),
}))

vi.mock("../../electronAPI/harnessQuery", () => ({
    runStructuredHarnessQuery: harnessQueryMock.runStructuredHarnessQuery,
}))

vi.mock("../../electronAPI/procs", () => ({
    readProcs: vi.fn(async () => ({
        repoRoot: "/repo",
        searchRoot: "/repo",
        isWorktree: false,
        configs: [],
        errors: [],
    })),
    loadEditableProcsFile: vi.fn(async () => ({
        filePath: "/repo/openade.toml",
        relativePath: "openade.toml",
        processes: [],
        crons: [],
        rawContent: "",
    })),
    saveEditableProcsFile: vi.fn(async () => ({
        readResult: {
            repoRoot: "/repo",
            searchRoot: "/repo",
            isWorktree: false,
            configs: [],
            errors: [],
        },
    })),
    parseEditableRaw: vi.fn(async () => ({ processes: [], crons: [] })),
    serializeEditableProcs: vi.fn(async () => ""),
}))

type ProcsHelperCodeStore = Parameters<typeof readProcsEditorConfigs>[0]["codeStore"] &
    Parameters<typeof loadProcsEditorFile>[0]["codeStore"] &
    Parameters<typeof saveProcsEditorFile>[0]["codeStore"]

function createCodeStore(): ProcsHelperCodeStore {
    return {
        canUseProductMethod: vi.fn(() => false),
        listProductProjectProcesses: vi.fn(async () => {
            throw new Error("runtime process list should not run")
        }),
        readProductProjectFile: vi.fn(async () => {
            throw new Error("runtime file read should not run")
        }),
        writeProductProjectFile: vi.fn(async () => {
            throw new Error("runtime file write should not run")
        }),
    }
}

describe("ProcsEditorModal Core-owned process config guards", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("does not fall back to legacy config discovery when Core owns process config and scope is missing", async () => {
        const result = await readProcsEditorConfigs({
            codeStore: createCodeStore(),
            searchPath: "/repo",
            productRuntimeOwnsProjectConfig: true,
        })

        expect(result).toEqual({
            repoRoot: "/repo",
            searchRoot: "/repo",
            isWorktree: false,
            configs: [],
            errors: [],
        })
        expect(readProcs).not.toHaveBeenCalled()
    })

    it("does not fall back to legacy file load/save when Core owns process config and scope is missing", async () => {
        const codeStore = createCodeStore()

        await expect(
            loadProcsEditorFile({
                codeStore,
                filePath: "/repo/openade.toml",
                repoRoot: "/repo",
                searchPath: "/repo",
                productRuntimeOwnsProjectConfig: true,
            })
        ).rejects.toThrow("Project process config scope is not available from this runtime")

        await expect(
            saveProcsEditorFile({
                codeStore,
                selectedFilePath: "/repo/openade.toml",
                relativePath: "openade.toml",
                processes: [],
                crons: [],
                searchPath: "/repo",
                productRuntimeOwnsProjectConfig: true,
            })
        ).rejects.toThrow("Project process config scope is not available from this runtime")

        expect(loadEditableProcsFile).not.toHaveBeenCalled()
        expect(saveEditableProcsFile).not.toHaveBeenCalled()
    })

    it("does not call local harness suggestions when Core owns process config", async () => {
        await expect(
            runProcsEditorCronAssist({
                canUseLocalAssist: false,
                schedule: "daily",
                harnessId: "codex",
                searchPath: "/repo",
            })
        ).rejects.toThrow("Process config suggestions are not available from this runtime")

        await expect(
            runProcsEditorRecommendations({
                canUseLocalAssist: false,
                currentToml: "",
                harnessId: "codex",
                searchPath: "/repo",
            })
        ).rejects.toThrow("Process config suggestions are not available from this runtime")

        expect(harnessQueryMock.runStructuredHarnessQuery).not.toHaveBeenCalled()
    })

    it("uses local harness suggestions only when the legacy path owns process config", async () => {
        harnessQueryMock.runStructuredHarnessQuery
            .mockResolvedValueOnce({ schedule: "0 9 * * *", summary: "Daily", assumptions: [] })
            .mockResolvedValueOnce({ processes: [], crons: [] })

        await expect(
            runProcsEditorCronAssist({
                canUseLocalAssist: true,
                schedule: "daily",
                harnessId: "codex",
                searchPath: "/repo",
            })
        ).resolves.toEqual({ schedule: "0 9 * * *", summary: "Daily", assumptions: [] })

        await expect(
            runProcsEditorRecommendations({
                canUseLocalAssist: true,
                currentToml: "",
                harnessId: "codex",
                searchPath: "/repo",
            })
        ).resolves.toEqual({ processes: [], crons: [] })

        expect(harnessQueryMock.runStructuredHarnessQuery).toHaveBeenCalledTimes(2)
        expect(harnessQueryMock.runStructuredHarnessQuery).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    cwd: "/repo",
                    harnessId: "codex",
                    mode: "read-only",
                }),
            })
        )
    })
})
