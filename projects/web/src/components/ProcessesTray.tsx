import NiceModal from "@ebay/nice-modal-react"
import cx from "classnames"
import { AlertTriangle, CheckCircle, ExternalLink, FileText, Folder, Pencil, Play, RefreshCw, RotateCcw, Server, Square, Wrench } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { type ProcessDef, type ProcessType, type ProcsConfig, type ReadProcsResult, type RunContext, readProcs } from "../electronAPI/procs"
import { openUrlInNativeBrowser } from "../electronAPI/shell"
import { useCodeStore } from "../store/context"
import type { ProcessInstance, ProcessStatus, ProductProjectProcessAccess } from "../store/managers/RepoProcessesManager"
import { type ProductProjectScope, createProductProjectProcessAccess } from "../store/productProjectProcessAccess"
import { readProcsResultFromProductProcesses } from "../store/projectProcessReadResult"
import { ProcessOutput } from "./ProcessOutput"
import { ProcsEditorModal } from "./procs/ProcsEditorModal"
import { Menu, type MenuItem } from "./ui/Menu"

interface ProcessesTrayProps {
    /** Path to search for config files (repo root or worktree root) */
    searchPath: string
    /** Run context for processes */
    context: RunContext
    /** Workspace ID for creating tasks */
    workspaceId: string
    /** Whether the panel is currently open */
    isOpen?: boolean
    productScope?: ProductProjectScope | null
}

interface ConfigGroup {
    config: ProcsConfig
    processes: Array<{
        process: ProcessDef
        instance?: ProcessInstance
    }>
}

/** Process types to show in the UI */
const DISPLAY_TYPES: ProcessType[] = ["setup", "daemon", "task", "check"]
const DISPLAY_TYPE_SET = new Set<ProcessType>(DISPLAY_TYPES)

const TYPE_INFO: Record<ProcessType, { label: string; icon: typeof Server }> = {
    setup: { label: "Setup", icon: Wrench },
    daemon: { label: "Daemons", icon: Server },
    task: { label: "Tasks", icon: Play },
    check: { label: "Checks", icon: CheckCircle },
}

function joinPath(root: string, relativePath: string): string {
    const separator = root.includes("\\") ? "\\" : "/"
    if (root.endsWith("/") || root.endsWith("\\")) {
        return `${root}${relativePath}`
    }
    return `${root}${separator}${relativePath}`
}

export const ProcessesTray = observer(function ProcessesTray({ searchPath, context, workspaceId, isOpen, productScope = null }: ProcessesTrayProps) {
    const codeStore = useCodeStore()
    const { repoProcesses } = codeStore
    const [procsResult, setProcsResult] = useState<ReadProcsResult | null>(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const productRepoId = productScope?.repoId ?? null
    const productTaskId = productScope?.taskId
    const productRequest = useMemo(() => (productRepoId ? { repoId: productRepoId, taskId: productTaskId } : null), [productRepoId, productTaskId])
    const productAccess = useMemo<ProductProjectProcessAccess | null>(() => {
        if (!productRepoId) return null
        return createProductProjectProcessAccess(codeStore, { repoId: productRepoId, taskId: productTaskId })
    }, [codeStore, productRepoId, productTaskId])

    // Load config files
    const loadProcs = useCallback(
        async (isRefresh = false) => {
            if (isRefresh) {
                setRefreshing(true)
            } else {
                setLoading(true)
            }
            try {
                if (productRequest) {
                    const result = await codeStore.listProductProjectProcesses(productRequest)
                    const readResult = readProcsResultFromProductProcesses(result)
                    setProcsResult(readResult)
                    codeStore.repoProcesses.syncProductProcesses(context, readResult, result)
                    return
                }

                const result = await readProcs(searchPath)
                setProcsResult(result)
                // Keep CronManager in sync with latest config
                codeStore.crons.updateCronDefs(workspaceId, result)
            } catch (err) {
                console.error("[ProcessesTray] Failed to read procs:", err)
                setProcsResult(null)
            } finally {
                setLoading(false)
                setRefreshing(false)
            }
        },
        [searchPath, codeStore, context, productRequest, workspaceId]
    )

    // Load when panel opens or path changes
    useEffect(() => {
        if (isOpen) {
            loadProcs()
        }
    }, [loadProcs, isOpen])

    const handleRefresh = useCallback(() => {
        loadProcs(true)
    }, [loadProcs])

    const openEditor = useCallback(
        (initialTab: "processes" | "crons" | "suggestions" | "raw" = "processes", initialFilePath?: string) => {
            NiceModal.show(ProcsEditorModal, {
                workspaceId,
                searchPath,
                context,
                initialTab,
                initialFilePath,
                productScope,
                productAccess,
                onSaved: (result: ReadProcsResult) => {
                    setProcsResult(result)
                },
            })
        },
        [workspaceId, searchPath, context, productScope, productAccess]
    )

    const editMenuItems: MenuItem[] = [
        {
            id: "edit",
            label: (
                <div className="flex items-center gap-2">
                    <Pencil size={14} />
                    <span>Edit config</span>
                </div>
            ),
            onSelect: () => openEditor("processes"),
        },
        {
            id: "suggest",
            label: (
                <div className="flex items-center gap-2">
                    <Wrench size={14} />
                    <span>Scan suggestions</span>
                </div>
            ),
            onSelect: () => openEditor("suggestions"),
        },
    ]

    const rawSelectedId = repoProcesses.expandedProcessId
    const rawSelectedProcess = rawSelectedId ? repoProcesses.getProcess(rawSelectedId) : null
    // Only show selected process if it belongs to this context
    const selectedProcess = rawSelectedProcess && rawSelectedProcess.context.root === context.root ? rawSelectedProcess : null

    // Group processes by config file, excluding setup processes from display
    const configGroups: ConfigGroup[] = []
    if (procsResult) {
        const runningProcesses = repoProcesses.getProcessesForContext(context)
        const runningByProcessId = new Map(runningProcesses.map((process) => [process.id, process]))

        for (const config of procsResult.configs) {
            const displayProcesses: ConfigGroup["processes"] = []
            for (const process of config.processes) {
                if (!DISPLAY_TYPE_SET.has(process.type)) continue
                displayProcesses.push({ process, instance: runningByProcessId.get(process.id) })
            }
            if (displayProcesses.length === 0) continue

            const group: ConfigGroup = {
                config,
                processes: displayProcesses,
            }
            configGroups.push(group)
        }
    }

    // Collect all daemon items across all config groups for global start/stop
    const allDaemonItems = []
    for (const group of configGroups) {
        for (const item of group.processes) {
            if (item.process.type === "daemon") allDaemonItems.push({ ...item, config: group.config })
        }
    }
    const allStoppedDaemons = allDaemonItems.filter((item) => {
        const status = item.instance?.status ?? "stopped"
        return status === "stopped" || status === "error"
    })
    const allRunningDaemons = allDaemonItems.filter((item) => item.instance?.status === "running")

    const handleStartAllDaemons = useCallback(async () => {
        for (const item of allStoppedDaemons) {
            if (productAccess) {
                await repoProcesses.startProductProcess(item.process, item.config, context, productAccess)
            } else {
                await repoProcesses.startProcess(item.process, item.config, context, procsResult!)
            }
        }
    }, [allStoppedDaemons, context, productAccess, procsResult, repoProcesses])

    const handleStopAllDaemons = useCallback(async () => {
        for (const item of allRunningDaemons) {
            if (productAccess) {
                await repoProcesses.stopProductProcess(item.process.id, productAccess)
            } else {
                await repoProcesses.stopProcess(item.process.id)
            }
        }
    }, [allRunningDaemons, productAccess, repoProcesses])

    const hasProcesses = configGroups.length > 0
    const hasErrors = procsResult && procsResult.errors.length > 0

    if (loading) {
        return <div className="flex items-center justify-center h-full text-muted text-sm">Loading processes...</div>
    }

    if (!hasProcesses && !hasErrors) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <FileText size={32} className="text-muted mb-3" />
                <div className="text-muted mb-3">No processes configured</div>
                <button
                    type="button"
                    className="btn flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-content text-sm hover:bg-primary/90 transition-colors"
                    onClick={() => openEditor("processes")}
                >
                    <Pencil size={14} />
                    Edit
                </button>
            </div>
        )
    }

    return (
        <div className="flex h-full">
            {/* Left sidebar - Process list */}
            <div className="w-60 flex-shrink-0 flex flex-col border-r border-border">
                {/* Header with edit + refresh */}
                <div className="flex-shrink-0 flex items-center justify-between px-2.5 py-1.5 border-b border-border bg-base-200/50">
                    <span className="text-xs font-medium text-muted uppercase tracking-wider">Processes</span>
                    <div className="flex items-center">
                        {allStoppedDaemons.length > 0 && (
                            <button
                                type="button"
                                onClick={handleStartAllDaemons}
                                className="btn p-1 text-muted hover:text-success transition-colors"
                                title="Start all daemons"
                            >
                                <Play size={12} />
                            </button>
                        )}
                        {allRunningDaemons.length > 0 && (
                            <button
                                type="button"
                                onClick={handleStopAllDaemons}
                                className="btn p-1 text-muted hover:text-error transition-colors"
                                title="Stop all daemons"
                            >
                                <Square size={12} />
                            </button>
                        )}
                        <Menu
                            trigger={
                                <span className="flex items-center justify-center">
                                    <Pencil size={12} />
                                    <span className="sr-only">Edit processes</span>
                                </span>
                            }
                            sections={[{ items: editMenuItems }]}
                            side="bottom"
                            align="end"
                            className={{
                                trigger:
                                    "!h-auto !p-0 !border-0 !bg-transparent hover:!bg-transparent active:!bg-transparent data-[popup-open]:!bg-transparent",
                            }}
                        />
                        <button
                            type="button"
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className={cx("btn p-1 text-muted hover:text-base-content transition-colors", refreshing && "animate-spin")}
                            title="Refresh"
                        >
                            <RefreshCw size={12} />
                        </button>
                    </div>
                </div>

                {/* Errors banner */}
                {hasErrors && (
                    <div className="flex-shrink-0 px-2.5 py-2 bg-error/10 border-b border-error/20">
                        <div className="flex items-center gap-1.5 text-error text-xs font-medium">
                            <AlertTriangle size={12} />
                            <span>
                                {procsResult.errors.length} config error{procsResult.errors.length > 1 ? "s" : ""}
                            </span>
                        </div>
                        <div className="mt-1 space-y-0.5">
                            {procsResult.errors.map((err) => (
                                <div key={`${err.relativePath}:${err.line ?? "file"}:${err.error}`} className="text-[10px] text-error/80 font-mono truncate">
                                    {err.relativePath}: {err.error}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Process list */}
                <div className="flex-1 overflow-auto">
                    {configGroups.map((group) => (
                        <ConfigGroupView
                            key={group.config.relativePath}
                            group={group}
                            context={context}
                            procsResult={procsResult!}
                            productAccess={productAccess}
                            onEditConfig={() => openEditor("processes", joinPath(procsResult!.repoRoot, group.config.relativePath))}
                        />
                    ))}
                </div>
            </div>

            {/* Right side - Process output */}
            <div className="flex-1 min-w-0">
                {selectedProcess ? (
                    <ProcessOutput output={selectedProcess.output} status={selectedProcess.status} processName={selectedProcess.process.name} />
                ) : (
                    <div className="flex items-center justify-center h-full text-muted text-sm">Select a process to view output</div>
                )}
            </div>
        </div>
    )
})

// ==================== ConfigGroupView ====================

interface ConfigGroupViewProps {
    group: ConfigGroup
    context: RunContext
    procsResult: ReadProcsResult
    productAccess: ProductProjectProcessAccess | null
    onEditConfig: () => void
}

const ConfigGroupView = observer(function ConfigGroupView({ group, context, procsResult, productAccess, onEditConfig }: ConfigGroupViewProps) {
    const codeStore = useCodeStore()
    const { repoProcesses } = codeStore
    const selectedProcessId = repoProcesses.expandedProcessId

    // Group by type for display
    const processesByType = new Map<ProcessType, typeof group.processes>()
    for (const item of group.processes) {
        const existing = processesByType.get(item.process.type) ?? []
        existing.push(item)
        processesByType.set(item.process.type, existing)
    }

    // Get daemon processes for start/stop all buttons
    const daemonItems = processesByType.get("daemon") ?? []
    const stoppedDaemons = daemonItems.filter((item) => {
        const status = item.instance?.status ?? "stopped"
        return status === "stopped" || status === "error"
    })
    const runningDaemons = daemonItems.filter((item) => item.instance?.status === "running")

    const handleStartAllDaemons = useCallback(async () => {
        for (const item of stoppedDaemons) {
            if (productAccess) {
                await repoProcesses.startProductProcess(item.process, group.config, context, productAccess)
            } else {
                await repoProcesses.startProcess(item.process, group.config, context, procsResult)
            }
        }
    }, [stoppedDaemons, group.config, context, productAccess, procsResult, repoProcesses])

    const handleStopAllDaemons = useCallback(async () => {
        for (const item of runningDaemons) {
            if (productAccess) {
                await repoProcesses.stopProductProcess(item.process.id, productAccess)
            } else {
                await repoProcesses.stopProcess(item.process.id)
            }
        }
    }, [runningDaemons, productAccess, repoProcesses])

    // Extract directory from config path (e.g., "packages/api/openade.toml" -> "packages/api")
    const configDir = group.config.relativePath.replace(/\/openade\.toml$/, "") || "."

    return (
        <div>
            {/* Config header - only show if multiple configs */}
            {configDir !== "." && (
                <div className="group/header flex items-center gap-2 px-2.5 py-1.5 border-b border-border bg-base-200/50">
                    <Folder size={12} className="text-muted flex-shrink-0" />
                    <span className="flex-1 text-xs text-muted font-mono truncate">{configDir}</span>
                    <div className="flex items-center opacity-0 group-hover/header:opacity-100 transition-opacity">
                        <button
                            type="button"
                            onClick={onEditConfig}
                            className="btn p-1 text-muted hover:text-base-content transition-colors"
                            title="Edit config"
                        >
                            <Pencil size={12} />
                        </button>
                        {stoppedDaemons.length > 0 && (
                            <button
                                type="button"
                                onClick={handleStartAllDaemons}
                                className="btn p-1 text-muted hover:text-success transition-colors"
                                title="Start all daemons"
                            >
                                <Play size={12} />
                            </button>
                        )}
                        {runningDaemons.length > 0 && (
                            <button
                                type="button"
                                onClick={handleStopAllDaemons}
                                className="btn p-1 text-muted hover:text-error transition-colors"
                                title="Stop all daemons"
                            >
                                <Square size={12} />
                            </button>
                        )}
                    </div>
                </div>
            )}
            {DISPLAY_TYPES.map((type) => {
                const items = processesByType.get(type)
                if (!items || items.length === 0) return null

                return (
                    <div key={type}>
                        {items.map((item) => (
                            <ProcessRowView
                                key={item.process.id}
                                process={item.process}
                                instance={item.instance}
                                config={group.config}
                                context={context}
                                procsResult={procsResult}
                                productAccess={productAccess}
                                isSelected={selectedProcessId === item.process.id}
                                showTypeIcon={processesByType.size > 1}
                            />
                        ))}
                    </div>
                )
            })}
        </div>
    )
})

// ==================== ProcessRowView ====================

const STATUS_STYLES: Record<ProcessStatus, string> = {
    running: "bg-success/70",
    stopped: "bg-muted/50",
    error: "bg-error",
    starting: "bg-warning animate-pulse",
}

interface ProcessRowViewProps {
    process: ProcessDef
    instance?: ProcessInstance
    config: ProcsConfig
    context: RunContext
    procsResult: ReadProcsResult
    productAccess: ProductProjectProcessAccess | null
    isSelected: boolean
    showTypeIcon?: boolean
}

const ProcessRowView = observer(function ProcessRowView({
    process,
    instance,
    config,
    context,
    procsResult,
    productAccess,
    isSelected,
    showTypeIcon,
}: ProcessRowViewProps) {
    const codeStore = useCodeStore()
    const { repoProcesses } = codeStore
    const status = instance?.status ?? "stopped"
    const isStarting = status === "starting"
    const canStart = status === "stopped" || status === "error"

    const handleStart = useCallback(async () => {
        repoProcesses.setExpandedProcess(process.id)
        if (productAccess) {
            await repoProcesses.startProductProcess(process, config, context, productAccess)
        } else {
            await repoProcesses.startProcess(process, config, context, procsResult)
        }
    }, [repoProcesses, process, config, context, productAccess, procsResult])

    const handleStop = useCallback(() => {
        if (productAccess) return repoProcesses.stopProductProcess(process.id, productAccess)
        return repoProcesses.stopProcess(process.id)
    }, [repoProcesses, process.id, productAccess])

    const handleRestart = useCallback(() => {
        if (productAccess) return repoProcesses.restartProductProcess(process.id, productAccess)
        return repoProcesses.restartProcess(process.id, procsResult)
    }, [repoProcesses, process.id, productAccess, procsResult])

    const handleSelect = useCallback(() => {
        repoProcesses.setExpandedProcess(process.id)
        if (productAccess && instance?.productProcessId) {
            void repoProcesses.refreshProductProcessOutput(process.id, productAccess)
        }
    }, [repoProcesses, process.id, productAccess, instance?.productProcessId])

    const TypeIcon = TYPE_INFO[process.type].icon

    return (
        <div
            className={cx(
                "group flex items-center gap-2.5 px-2.5 py-1.5 transition-colors",
                isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-base-200 border-l-2 border-l-transparent"
            )}
        >
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={handleSelect}>
                <div className={cx("w-2 h-2 rounded-full flex-shrink-0", STATUS_STYLES[status])} />
                {showTypeIcon && <TypeIcon size={12} className="text-muted flex-shrink-0" />}
                <span className="text-xs text-base-content truncate flex-1 min-w-0">{process.name}</span>
                {instance?.exitCode !== undefined && instance.exitCode !== null && status !== "running" && (
                    <span className={cx("text-[10px] font-mono flex-shrink-0", instance.exitCode === 0 ? "text-success" : "text-error")}>
                        {instance.exitCode}
                    </span>
                )}
            </button>
            <div className="flex items-center flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {process.url && (
                    <button
                        type="button"
                        onClick={() => openUrlInNativeBrowser(process.url!)}
                        className="btn p-1 text-muted hover:text-base-content transition-colors"
                        title={`Open ${process.url}`}
                    >
                        <ExternalLink size={12} />
                    </button>
                )}
                {canStart ? (
                    <button type="button" onClick={handleStart} className="btn p-1 text-success/70 hover:text-success transition-colors" title="Start">
                        <Play size={12} />
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={handleStop}
                        disabled={isStarting}
                        className={cx("btn p-1 transition-colors", isStarting ? "text-muted cursor-not-allowed" : "text-error/70 hover:text-error")}
                        title="Stop"
                    >
                        <Square size={12} />
                    </button>
                )}
                <button
                    type="button"
                    onClick={handleRestart}
                    disabled={isStarting}
                    className={cx("btn p-1 transition-colors", isStarting ? "text-muted cursor-not-allowed" : "text-muted hover:text-base-content")}
                    title="Restart"
                >
                    <RotateCcw size={12} />
                </button>
            </div>
        </div>
    )
})
