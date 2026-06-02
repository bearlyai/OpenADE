/**
 * RepoProcessesManager
 *
 * Manages process lifecycle for workspace processes:
 * - Starting/stopping/restarting processes
 * - Tracking running processes (global and task-scoped)
 * - Running setup processes on first start
 * - Cleaning up processes when tasks close
 *
 * Uses ProcessHandle (not PTY) for better lifecycle tracking.
 * Processes are defined in openade.toml files, not stored in database.
 */

import { makeAutoObservable, runInAction } from "mobx"
import type {
    OpenADEProjectProcessListResult,
    OpenADEProjectProcessReconnectResult,
    OpenADEProjectProcessStartResult,
    OpenADEProjectProcessStopResult,
} from "../../../../openade-module/src"
import { ProcessHandle, type ProcessOutputChunk } from "../../electronAPI/process"
import type { ProcessDef, ProcsConfig, ReadProcsResult, RunContext } from "../../electronAPI/procs"
import { getCwd } from "../../electronAPI/procs"

export type ProcessStatus = "running" | "stopped" | "error" | "starting"

export interface ProcessInstance {
    /** Definition ID from openade.toml: "{relativePath}::{name}" */
    id: string
    /** Run context (repo or worktree) */
    context: RunContext
    /** Reference to the config file */
    config: ProcsConfig
    /** Reference to the process definition */
    process: ProcessDef
    /** Current status */
    status: ProcessStatus
    /** Electron process handle (null when not running) */
    processHandle: ProcessHandle | null
    /** Runtime process id when this instance is managed through OpenADE scoped process APIs. */
    productProcessId?: string
    /** Runtime record id when available. */
    runtimeId?: string
    /** Accumulated stdout/stderr output */
    output: string
    /** Error message if status is "error" */
    error?: string
    /** Exit code from last run */
    exitCode?: number | null
}

export interface ProductProjectProcessAccess {
    startProjectProcess(args: { definitionId: string }): Promise<OpenADEProjectProcessStartResult>
    reconnectProjectProcess(args: { processId: string }): Promise<OpenADEProjectProcessReconnectResult>
    stopProjectProcess(args: { processId: string }): Promise<OpenADEProjectProcessStopResult>
}

/** Key for tracking setup completion */
function makeSetupKey(context: RunContext, configPath: string): string {
    return `${context.root}::${configPath}`
}

function processOutputFromReconnect(result: OpenADEProjectProcessReconnectResult): string {
    return (result.output ?? []).map((chunk) => chunk.data).join("")
}

function processStatusFromReconnect(result: OpenADEProjectProcessReconnectResult): ProcessStatus {
    if (!result.found) return "error"
    if (!result.completed) return "running"
    return result.error || (result.exitCode !== undefined && result.exitCode !== null && result.exitCode !== 0) ? "error" : "stopped"
}

export class RepoProcessesManager {
    /** Map of processId -> ProcessInstance */
    runningProcesses: Map<string, ProcessInstance> = new Map()

    /** Track which configs have had their setup processes run this session */
    setupRanThisSession: Set<string> = new Set()

    /** Currently selected process in the tray (showing output) */
    expandedProcessId: string | null = null

    constructor() {
        makeAutoObservable(this, {
            runningProcesses: true,
            setupRanThisSession: true,
            expandedProcessId: true,
        })
    }

    // ==================== Process Lifecycle ====================

    syncProductProcesses(context: RunContext, procsResult: ReadProcsResult, result: OpenADEProjectProcessListResult): void {
        const definitionsById = new Map(result.processes.map((process) => [process.id, process]))
        const configsByPath = new Map(procsResult.configs.map((config) => [config.relativePath, config]))
        const activeDefinitionIds = new Set<string>()

        runInAction(() => {
            for (const instance of result.instances) {
                const definition = definitionsById.get(instance.definitionId)
                if (!definition) continue
                const config = configsByPath.get(definition.configPath)
                if (!config) continue
                activeDefinitionIds.add(definition.id)

                const existing = this.runningProcesses.get(definition.id)
                this.runningProcesses.set(definition.id, {
                    id: definition.id,
                    context,
                    config,
                    process: definition,
                    status: instance.completed ? (instance.error || (instance.exitCode !== null && instance.exitCode !== 0) ? "error" : "stopped") : "running",
                    processHandle: null,
                    productProcessId: instance.processId,
                    output: existing?.output ?? "",
                    error: instance.error,
                    exitCode: instance.exitCode,
                })
            }

            for (const instance of this.getProcessesForContext(context)) {
                if (!instance.productProcessId || activeDefinitionIds.has(instance.id)) continue
                instance.status = "stopped"
                instance.processHandle = null
            }
        })
    }

    async startProductProcess(process: ProcessDef, config: ProcsConfig, context: RunContext, access: ProductProjectProcessAccess): Promise<boolean> {
        const processId = process.id
        const existing = this.runningProcesses.get(processId)
        if (existing?.productProcessId && existing.status === "running") return true

        if (existing?.processHandle) {
            await existing.processHandle.kill()
            existing.processHandle.cleanup()
        }

        const instance: ProcessInstance = {
            id: processId,
            context,
            config,
            process,
            status: "starting",
            processHandle: null,
            output: "=== Starting Process ===\n",
        }

        runInAction(() => {
            this.runningProcesses.set(processId, instance)
        })

        try {
            const started = await access.startProjectProcess({ definitionId: process.id })
            const reconnected = await access.reconnectProjectProcess({ processId: started.processId }).catch(
                (): OpenADEProjectProcessReconnectResult => ({
                    repoId: started.repoId,
                    taskId: started.taskId,
                    processId: started.processId,
                    found: true,
                    completed: false,
                    output: [],
                })
            )

            runInAction(() => {
                const current = this.runningProcesses.get(processId)
                if (!current) return
                current.productProcessId = started.processId
                current.runtimeId = started.runtimeId
                current.status = processStatusFromReconnect(reconnected)
                current.output = processOutputFromReconnect(reconnected)
                current.error = reconnected.error
                current.exitCode = reconnected.exitCode
            })
            return true
        } catch (err) {
            runInAction(() => {
                const current = this.runningProcesses.get(processId)
                if (!current) return
                current.status = "error"
                current.error = err instanceof Error ? err.message : "Unknown error"
                current.output += `\n[Process] Failed to start: ${current.error}\n`
            })
            return false
        }
    }

    async refreshProductProcessOutput(definitionId: string, access: ProductProjectProcessAccess): Promise<void> {
        const instance = this.runningProcesses.get(definitionId)
        if (!instance?.productProcessId) return

        const result = await access.reconnectProjectProcess({ processId: instance.productProcessId })
        runInAction(() => {
            const current = this.runningProcesses.get(definitionId)
            if (!current) return
            current.status = processStatusFromReconnect(result)
            current.output = processOutputFromReconnect(result)
            current.error = result.error
            current.exitCode = result.exitCode
        })
    }

    async stopProductProcess(definitionId: string, access: ProductProjectProcessAccess): Promise<void> {
        const instance = this.runningProcesses.get(definitionId)
        if (!instance?.productProcessId) return

        runInAction(() => {
            instance.output += "\n[Process] Stopping...\n"
        })

        const result = await access.stopProjectProcess({ processId: instance.productProcessId })
        runInAction(() => {
            const current = this.runningProcesses.get(definitionId)
            if (!current) return
            current.status = result.ok ? "stopped" : "error"
            current.error = result.error
            current.output += result.ok ? "[Process] Stopped.\n" : `[Process] Failed to stop: ${result.error ?? "Unknown error"}\n`
        })
    }

    async restartProductProcess(processId: string, access: ProductProjectProcessAccess): Promise<boolean> {
        const instance = this.runningProcesses.get(processId)
        if (!instance) return false
        await this.stopProductProcess(processId, access)
        runInAction(() => {
            const current = this.runningProcesses.get(processId)
            if (current) current.output = ""
        })
        return this.startProductProcess(instance.process, instance.config, instance.context, access)
    }

    async startProcess(process: ProcessDef, config: ProcsConfig, context: RunContext, procsResult: ReadProcsResult): Promise<boolean> {
        const processId = process.id

        // Check if already running
        const existing = this.runningProcesses.get(processId)
        if (existing && existing.status === "running") {
            return true
        }

        // If there's an existing instance in error/stopped/starting state, clean it up
        if (existing) {
            if (existing.processHandle) {
                await existing.processHandle.kill()
                existing.processHandle.cleanup()
            }
            runInAction(() => {
                this.runningProcesses.delete(processId)
            })
        }

        // Compute working directory
        const workDir = getCwd(config, process, context, procsResult)

        // Create process instance in starting state
        const instance: ProcessInstance = {
            id: processId,
            context,
            config,
            process,
            status: "starting",
            processHandle: null,
            output: "",
        }

        runInAction(() => {
            this.runningProcesses.set(processId, instance)
        })

        try {
            // Run setup processes first if this is a daemon process
            if (process.type === "daemon") {
                const setupKey = makeSetupKey(context, config.relativePath)
                const setupAlreadyRan = this.setupRanThisSession.has(setupKey)

                if (!setupAlreadyRan) {
                    // Find setup processes in this config
                    const setupProcesses = config.processes.filter((p) => p.type === "setup")

                    if (setupProcesses.length > 0) {
                        runInAction(() => {
                            const inst = this.runningProcesses.get(processId)
                            if (inst) {
                                inst.output += "=== Running Setup ===\n"
                            }
                        })

                        for (const setupProcess of setupProcesses) {
                            const setupWorkDir = getCwd(config, setupProcess, context, procsResult)

                            runInAction(() => {
                                const inst = this.runningProcesses.get(processId)
                                if (inst) {
                                    inst.output += `\n$ ${setupProcess.command}\n`
                                    inst.output += `[cwd: ${setupWorkDir}]\n\n`
                                }
                            })

                            const setupResult = await this.runSetupProcess(setupProcess.command, setupWorkDir, (chunk) => {
                                runInAction(() => {
                                    const inst = this.runningProcesses.get(processId)
                                    if (inst) {
                                        inst.output += chunk.data
                                    }
                                })
                            })

                            if (!setupResult.success) {
                                runInAction(() => {
                                    const inst = this.runningProcesses.get(processId)
                                    if (inst) {
                                        inst.status = "error"
                                        inst.error = `Setup '${setupProcess.name}' failed (exit code: ${setupResult.exitCode})`
                                        inst.output += "\n=== Setup failed ===\n"
                                    }
                                })
                                return false
                            }
                        }

                        runInAction(() => {
                            this.setupRanThisSession.add(setupKey)
                            const inst = this.runningProcesses.get(processId)
                            if (inst) {
                                inst.output += "\n=== Setup complete ===\n\n"
                            }
                        })
                    }
                }
            }

            // Spawn the process
            runInAction(() => {
                const inst = this.runningProcesses.get(processId)
                if (inst) {
                    inst.output += "=== Starting Process ===\n"
                    inst.output += `$ ${process.command}\n`
                    inst.output += `[cwd: ${workDir}]\n\n`
                }
            })

            // Determine timeout based on process type
            const timeoutMs =
                process.type === "daemon"
                    ? 24 * 60 * 60 * 1000 // 24hr for daemons
                    : 10 * 60 * 1000 // 10min for setup/task/check

            const handle = await ProcessHandle.startScript({
                script: process.command,
                cwd: workDir,
                timeoutMs,
            })

            if (!handle) {
                runInAction(() => {
                    const inst = this.runningProcesses.get(processId)
                    if (inst) {
                        inst.status = "error"
                        inst.error = "Failed to spawn process (Electron API not available)"
                    }
                })
                return false
            }

            // Set up output handler
            handle.on("output", (chunk: unknown) => {
                const outputChunk = chunk as ProcessOutputChunk
                runInAction(() => {
                    const inst = this.runningProcesses.get(processId)
                    if (inst) {
                        inst.output += outputChunk.data
                    }
                })
            })

            // Set up exit handler
            handle.on("exit", (event: unknown) => {
                const exitEvent = event as { exitCode: number | null; signal: string | null }
                runInAction(() => {
                    const inst = this.runningProcesses.get(processId)
                    if (inst) {
                        inst.status = exitEvent.exitCode === 0 ? "stopped" : "error"
                        inst.exitCode = exitEvent.exitCode
                        inst.processHandle = null

                        let exitMsg = "\n--- Process exited"
                        if (exitEvent.exitCode !== null) {
                            exitMsg += ` (code: ${exitEvent.exitCode})`
                        }
                        if (exitEvent.signal) {
                            exitMsg += ` (signal: ${exitEvent.signal})`
                        }
                        exitMsg += " ---\n"
                        inst.output += exitMsg

                        if (exitEvent.exitCode !== 0) {
                            inst.error = `Process exited with code ${exitEvent.exitCode ?? "unknown"}`
                        }
                    }
                })
            })

            // Set up error handler
            handle.on("error", (error: unknown) => {
                runInAction(() => {
                    const inst = this.runningProcesses.get(processId)
                    if (inst) {
                        inst.status = "error"
                        inst.error = String(error)
                        inst.processHandle = null
                        inst.output += `\n--- Error: ${error} ---\n`
                    }
                })
            })

            // Mark as running
            runInAction(() => {
                const inst = this.runningProcesses.get(processId)
                if (inst) {
                    inst.status = "running"
                    inst.processHandle = handle
                    inst.error = undefined
                }
            })

            return true
        } catch (err) {
            console.error("[RepoProcessesManager] Failed to start process:", err)
            runInAction(() => {
                const inst = this.runningProcesses.get(processId)
                if (inst) {
                    inst.status = "error"
                    inst.error = err instanceof Error ? err.message : "Unknown error"
                    inst.output += `\n[Process] Failed to start: ${inst.error}\n`
                }
            })
            return false
        }
    }

    private async runSetupProcess(
        command: string,
        workDir: string,
        onOutput: (chunk: ProcessOutputChunk) => void
    ): Promise<{ success: boolean; exitCode: number | null }> {
        const handle = await ProcessHandle.startScript({
            script: command,
            cwd: workDir,
            timeoutMs: 10 * 60 * 1000, // 10 minute timeout for setup
        })

        if (!handle) {
            return { success: false, exitCode: null }
        }

        return new Promise((resolve) => {
            handle.on("output", (chunk: unknown) => {
                onOutput(chunk as ProcessOutputChunk)
            })

            handle.on("exit", (event: unknown) => {
                const exitEvent = event as { exitCode: number | null }
                handle.cleanup()
                resolve({ success: exitEvent.exitCode === 0, exitCode: exitEvent.exitCode })
            })

            handle.on("error", (error: unknown) => {
                onOutput({ type: "stderr", data: `Error: ${error}\n`, timestamp: Date.now() })
                handle.cleanup()
                resolve({ success: false, exitCode: null })
            })
        })
    }

    async stopProcess(processId: string): Promise<void> {
        const instance = this.runningProcesses.get(processId)
        if (!instance) return

        if (instance.processHandle) {
            runInAction(() => {
                instance.output += "\n[Process] Stopping...\n"
            })
            await instance.processHandle.kill()
            instance.processHandle.cleanup()
        }

        runInAction(() => {
            instance.status = "stopped"
            instance.processHandle = null
            instance.output += "[Process] Stopped.\n"
        })
    }

    async restartProcess(processId: string, procsResult: ReadProcsResult): Promise<boolean> {
        const instance = this.runningProcesses.get(processId)
        if (!instance) return false

        // Stop if running
        if (instance.processHandle) {
            await instance.processHandle.kill()
            instance.processHandle.cleanup()
        }

        // Clear output for fresh start
        runInAction(() => {
            instance.output = ""
        })

        // Start again
        return this.startProcess(instance.process, instance.config, instance.context, procsResult)
    }

    // ==================== Queries ====================

    /** Get all running processes for a given context (matched by root path) */
    getProcessesForContext(context: RunContext): ProcessInstance[] {
        const result: ProcessInstance[] = []
        for (const instance of this.runningProcesses.values()) {
            if (instance.context.root === context.root) {
                result.push(instance)
            }
        }
        return result
    }

    getProcess(processId: string): ProcessInstance | undefined {
        return this.runningProcesses.get(processId)
    }

    get runningCount(): number {
        let count = 0
        for (const instance of this.runningProcesses.values()) {
            if (instance.status === "running") {
                count++
            }
        }
        return count
    }

    runningCountForContext(context: RunContext): number {
        let count = 0
        for (const instance of this.runningProcesses.values()) {
            if (instance.context.root === context.root && instance.status === "running") {
                count++
            }
        }
        return count
    }

    // ==================== Cleanup ====================

    async stopAllForContext(context: RunContext, productAccess?: ProductProjectProcessAccess): Promise<void> {
        const processes = this.getProcessesForContext(context)
        await Promise.all(processes.map((p) => (productAccess && p.productProcessId ? this.stopProductProcess(p.id, productAccess) : this.stopProcess(p.id))))

        runInAction(() => {
            for (const p of processes) {
                this.runningProcesses.delete(p.id)
            }

            if (this.expandedProcessId && processes.some((p) => p.id === this.expandedProcessId)) {
                this.expandedProcessId = null
            }
        })
    }

    async stopProcessesMissingFromConfig(args: {
        context: RunContext
        validProcessIds: Set<string>
    }): Promise<void> {
        const stale = this.getProcessesForContext(args.context).filter((instance) => !args.validProcessIds.has(instance.id))
        await Promise.all(stale.map((instance) => this.stopProcess(instance.id)))

        runInAction(() => {
            for (const instance of stale) {
                this.runningProcesses.delete(instance.id)
            }

            if (this.expandedProcessId && stale.some((instance) => instance.id === this.expandedProcessId)) {
                this.expandedProcessId = null
            }
        })
    }

    // ==================== UI State ====================

    setExpandedProcess(processId: string | null): void {
        this.expandedProcessId = processId
    }

    toggleExpandedProcess(processId: string): void {
        if (this.expandedProcessId === processId) {
            this.expandedProcessId = null
        } else {
            this.expandedProcessId = processId
        }
    }
}
