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
            canStartProjectProcess: true,
            canReconnectProjectProcess: true,
            canStopProjectProcess: true,
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
            canStartProjectProcess: true,
            canReconnectProjectProcess: true,
            canStopProjectProcess: true,
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

    it("does not raw-stop or remove product-managed processes when context cleanup lacks stop capability", async () => {
        const manager = new RepoProcessesManager()
        const legacyHandle = {
            kill: vi.fn(async () => undefined),
            cleanup: vi.fn(),
        }
        const productAccess: ProductProjectProcessAccess = {
            canStartProjectProcess: true,
            canReconnectProjectProcess: true,
            canStopProjectProcess: false,
            startProjectProcess: vi.fn(),
            reconnectProjectProcess: vi.fn(),
            stopProjectProcess: vi.fn(async (args) => ({ repoId: "repo-1", taskId: "task-1", processId: args.processId, ok: true })),
        }

        manager.runningProcesses.set(
            "product-daemon",
            processInstance({
                id: "product-daemon",
                processHandle: legacyHandle,
                productProcessId: "process-runtime-1",
            })
        )
        manager.setExpandedProcess("product-daemon")

        await manager.stopAllForContext(context, productAccess)

        expect(productAccess.stopProjectProcess).not.toHaveBeenCalled()
        expect(legacyHandle.kill).not.toHaveBeenCalled()
        expect(legacyHandle.cleanup).not.toHaveBeenCalled()
        expect(manager.getProcessesForContext(context).map((instance) => instance.id)).toEqual(["product-daemon"])
        expect(manager.expandedProcessId).toBe("product-daemon")
    })

    it("does not drop stale product-managed processes when config cleanup lacks stop capability", async () => {
        const manager = new RepoProcessesManager()
        const legacyHandle = {
            kill: vi.fn(async () => undefined),
            cleanup: vi.fn(),
        }
        const productAccess: ProductProjectProcessAccess = {
            canStartProjectProcess: true,
            canReconnectProjectProcess: true,
            canStopProjectProcess: false,
            startProjectProcess: vi.fn(),
            reconnectProjectProcess: vi.fn(),
            stopProjectProcess: vi.fn(async (args) => ({ repoId: "repo-1", taskId: "task-1", processId: args.processId, ok: true })),
        }

        manager.runningProcesses.set(
            "product-daemon",
            processInstance({
                id: "product-daemon",
                processHandle: legacyHandle,
                productProcessId: "process-runtime-1",
            })
        )
        manager.setExpandedProcess("product-daemon")

        await manager.stopProcessesMissingFromConfig({
            context,
            validProcessIds: new Set(),
            productAccess,
        })

        expect(productAccess.stopProjectProcess).not.toHaveBeenCalled()
        expect(legacyHandle.kill).not.toHaveBeenCalled()
        expect(legacyHandle.cleanup).not.toHaveBeenCalled()
        expect(manager.getProcessesForContext(context).map((instance) => instance.id)).toEqual(["product-daemon"])
        expect(manager.expandedProcessId).toBe("product-daemon")
    })

    it("does not call denied product process lifecycle methods", async () => {
        const manager = new RepoProcessesManager()
        const process = processDef("product-daemon")
        const productAccess: ProductProjectProcessAccess = {
            canStartProjectProcess: false,
            canReconnectProjectProcess: false,
            canStopProjectProcess: false,
            startProjectProcess: vi.fn(async (args) => ({
                repoId: "repo-1",
                taskId: "task-1",
                definitionId: args.definitionId,
                processId: "process-runtime-1",
            })),
            reconnectProjectProcess: vi.fn(async (args) => ({
                repoId: "repo-1",
                taskId: "task-1",
                processId: args.processId,
                found: true,
                completed: false,
                output: [],
            })),
            stopProjectProcess: vi.fn(async (args) => ({ repoId: "repo-1", taskId: "task-1", processId: args.processId, ok: true })),
        }

        const started = await manager.startProductProcess(process, { ...config, processes: [process] }, context, productAccess)
        manager.runningProcesses.set("product-daemon", processInstance({ id: "product-daemon", productProcessId: "process-runtime-1" }))

        await manager.refreshProductProcessOutput("product-daemon", productAccess)
        await manager.stopProductProcess("product-daemon", productAccess)

        expect(started).toBe(false)
        expect(productAccess.startProjectProcess).not.toHaveBeenCalled()
        expect(productAccess.reconnectProjectProcess).not.toHaveBeenCalled()
        expect(productAccess.stopProjectProcess).not.toHaveBeenCalled()
    })

    it("starts product processes without reconnecting when output reconnect is denied", async () => {
        const manager = new RepoProcessesManager()
        const process = processDef("product-daemon")
        const productAccess: ProductProjectProcessAccess = {
            canStartProjectProcess: true,
            canReconnectProjectProcess: false,
            canStopProjectProcess: true,
            startProjectProcess: vi.fn(async (args) => ({
                repoId: "repo-1",
                taskId: "task-1",
                definitionId: args.definitionId,
                processId: "process-runtime-1",
                runtimeId: "runtime-1",
            })),
            reconnectProjectProcess: vi.fn(),
            stopProjectProcess: vi.fn(async (args) => ({ repoId: "repo-1", taskId: "task-1", processId: args.processId, ok: true })),
        }

        const started = await manager.startProductProcess(process, { ...config, processes: [process] }, context, productAccess)
        const instance = manager.getProcess("product-daemon")

        expect(started).toBe(true)
        expect(productAccess.startProjectProcess).toHaveBeenCalledWith({ definitionId: "product-daemon" })
        expect(productAccess.reconnectProjectProcess).not.toHaveBeenCalled()
        expect(instance?.status).toBe("running")
        expect(instance?.productProcessId).toBe("process-runtime-1")
        expect(instance?.runtimeId).toBe("runtime-1")
    })
})
