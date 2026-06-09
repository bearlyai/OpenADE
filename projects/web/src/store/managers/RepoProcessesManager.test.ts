import { describe, expect, it, vi } from "vitest"
import type { ProcessDef, ProcsConfig, RunContext } from "../../electronAPI/procs"
import { RepoProcessesManager, type ProcessInstance, type ProductProjectProcessAccess } from "./RepoProcessesManager"

const context: RunContext = { type: "worktree", root: "/tmp/runtime-worktree" }

const config: ProcsConfig = {
    relativePath: "openade.toml",
    processes: [],
    crons: [],
}

function processDef(id: string): ProcessDef {
    return {
        id,
        name: id,
        command: `echo ${id}`,
        type: "daemon",
    }
}

function processInstance(params: {
    id: string
    processHandle?: Pick<NonNullable<ProcessInstance["processHandle"]>, "kill" | "cleanup"> | null
    productProcessId?: string
}): ProcessInstance {
    const process = processDef(params.id)
    return {
        id: params.id,
        context,
        config: { ...config, processes: [process] },
        process,
        status: "running",
        processHandle: (params.processHandle ?? null) as ProcessInstance["processHandle"],
        productProcessId: params.productProcessId,
        output: "",
    }
}

describe("RepoProcessesManager", () => {
    it("stops product-managed processes through scoped product access during context cleanup", async () => {
        const manager = new RepoProcessesManager()
        const legacyHandle = {
            kill: vi.fn(async () => undefined),
            cleanup: vi.fn(),
        }
        const productAccess: ProductProjectProcessAccess = {
            startProjectProcess: vi.fn(),
            reconnectProjectProcess: vi.fn(),
            stopProjectProcess: vi.fn(async (args) => ({ repoId: "repo-1", taskId: "task-1", processId: args.processId, ok: true })),
        }

        manager.runningProcesses.set(
            "product-daemon",
            processInstance({
                id: "product-daemon",
                productProcessId: "process-runtime-1",
            })
        )
        manager.runningProcesses.set(
            "legacy-daemon",
            processInstance({
                id: "legacy-daemon",
                processHandle: legacyHandle,
            })
        )

        await manager.stopAllForContext(context, productAccess)

        expect(productAccess.stopProjectProcess).toHaveBeenCalledWith({ processId: "process-runtime-1" })
        expect(legacyHandle.kill).toHaveBeenCalledTimes(1)
        expect(legacyHandle.cleanup).toHaveBeenCalledTimes(1)
        expect(manager.getProcessesForContext(context)).toEqual([])
    })

    it("stops stale product-managed processes through scoped product access after config edits", async () => {
        const manager = new RepoProcessesManager()
        const legacyHandle = {
            kill: vi.fn(async () => undefined),
            cleanup: vi.fn(),
        }
        const productAccess: ProductProjectProcessAccess = {
            startProjectProcess: vi.fn(),
            reconnectProjectProcess: vi.fn(),
            stopProjectProcess: vi.fn(async (args) => ({ repoId: "repo-1", taskId: "task-1", processId: args.processId, ok: true })),
        }

        manager.runningProcesses.set(
            "product-daemon",
            processInstance({
                id: "product-daemon",
                productProcessId: "process-runtime-1",
            })
        )
        manager.runningProcesses.set(
            "legacy-daemon",
            processInstance({
                id: "legacy-daemon",
                processHandle: legacyHandle,
            })
        )
        manager.runningProcesses.set(
            "kept-daemon",
            processInstance({
                id: "kept-daemon",
                productProcessId: "process-runtime-2",
            })
        )

        await manager.stopProcessesMissingFromConfig({
            context,
            validProcessIds: new Set(["kept-daemon"]),
            productAccess,
        })

        expect(productAccess.stopProjectProcess).toHaveBeenCalledWith({ processId: "process-runtime-1" })
        expect(legacyHandle.kill).toHaveBeenCalledTimes(1)
        expect(legacyHandle.cleanup).toHaveBeenCalledTimes(1)
        expect(manager.getProcessesForContext(context).map((instance) => instance.id)).toEqual(["kept-daemon"])
    })
})
