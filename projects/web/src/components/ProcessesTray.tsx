import cx from "classnames"
import { AlertTriangle, CheckCircle, ExternalLink, FileText, Folder, FolderOpen, Play, Plus, RefreshCw, RotateCcw, Server, Square, Wrench } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useEffect, useState } from "react"
import { type ProcessDef, type ProcessType, type ProcsConfig, type ReadProcsResult, type RunContext, readProcs } from "../electronAPI/procs"
import { openUrlInNativeBrowser, selectDirectory } from "../electronAPI/shell"
import { getProcsCreationPrompt } from "../prompts/procsSpec"
import { useCodeNavigate } from "../routing"
import { useCodeStore } from "../store/context"
import type { ProcessInstance, ProcessStatus } from "../store/managers/RepoProcessesManager"
import { ProcessOutput } from "./ProcessOutput"

interface ProcessesTrayProps {
    /** Path to search for procs.toml (repo root or worktree root) */
    searchPath: string
    /** Run context for processes */
    context: RunContext
    /** Workspace ID for creating tasks */
    workspaceId: string
    /** Whether the panel is currently open */
    isOpen?: boolean
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

const TYPE_INFO: Record<ProcessType, { label: string; icon: typeof Server }> = {
    setup: { label: "Setup", icon: Wrench },
    daemon: { label: "Daemons", icon: Server },
    task: { label: "Tasks", icon: Play },
    check: { label: "Checks", icon: CheckCircle },
}

export const ProcessesTray = observer(function ProcessesTray({ searchPath, context, workspaceId, isOpen }: ProcessesTrayProps) {
    const codeStore = useCodeStore()
    const { repoProcesses } = codeStore
    const navigate = useCodeNavigate()
    const [procsResult, setProcsResult] = useState<ReadProcsResult | null>(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)

    // Create procs.toml state
    const [showCreateForm, setShowCreateForm] = useState(false)
    const [subdirPath, setSubdirPath] = useState("")

    // Load procs.toml files
    const loadProcs = useCallback(
        async (isRefresh = false) => {
            if (isRefresh) {
                setRefreshing(true)
            } else {
                setLoading(true)
            }
            try {
                const result = await readProcs(searchPath)
                setProcsResult(result)
            } catch (err) {
                console.error("[ProcessesTray] Failed to read procs:", err)
                setProcsResult(null)
            } finally {
                setLoading(false)
                setRefreshing(false)
            }
        },
        [searchPath]
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

    const handleCreateProcs = useCallback(() => {
        // Use subdirectory if provided, otherwise root
        const targetDir = subdirPath.trim() || "."
        const prompt = getProcsCreationPrompt(targetDir)

        // Create task immediately in plan mode
        const creationId = codeStore.creation.newTask({
            repoId: workspaceId,
            description: prompt,
            mode: "plan",
            isolationStrategy: { type: "head" },
        })

        // Navigate to creation page
        navigate.go("CodeWorkspaceTaskCreating", { workspaceId, creationId })
    }, [subdirPath, workspaceId, navigate])

    const handleBrowse = useCallback(async () => {
        const selected = await selectDirectory(searchPath)
        if (selected) {
            setSubdirPath(selected)
        }
    }, [searchPath])

    const selectedProcessId = repoProcesses.expandedProcessId
    const selectedProcess = selectedProcessId ? repoProcesses.getProcess(selectedProcessId) : null

    // Group processes by config file, excluding setup processes from display
    const configGroups: ConfigGroup[] = []
    if (procsResult) {
        const runningProcesses = repoProcesses.getProcessesForContext(context)

        for (const config of procsResult.configs) {
            // Only show non-setup processes
            const displayProcesses = config.processes.filter((p) => DISPLAY_TYPES.includes(p.type))
            if (displayProcesses.length === 0) continue

            const group: ConfigGroup = {
                config,
                processes: displayProcesses.map((process) => ({
                    process,
                    instance: runningProcesses.find((p) => p.id === process.id),
                })),
            }
            configGroups.push(group)
        }
    }

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

                {!showCreateForm ? (
                    <button
                        type="button"
                        onClick={() => setShowCreateForm(true)}
                        className="btn flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-content text-sm hover:bg-primary/90 transition-colors"
                    >
                        <Plus size={14} />
                        Create procs.toml
                    </button>
                ) : (
                    <div className="w-full max-w-xs">
                        <div className="text-xs text-muted mb-2 text-left">Subdirectory (optional):</div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={subdirPath}
                                onChange={(e) => setSubdirPath(e.target.value)}
                                placeholder="e.g., packages/api (leave empty for root)"
                                className="flex-1 px-3 py-2 text-sm bg-input text-base-content border border-border focus:outline-none focus:border-primary transition-all placeholder:text-muted/50"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        handleCreateProcs()
                                    } else if (e.key === "Escape") {
                                        setShowCreateForm(false)
                                        setSubdirPath("")
                                    }
                                }}
                                autoFocus
                            />
                            <button
                                type="button"
                                onClick={handleBrowse}
                                className="btn px-3 py-2 bg-base-200 text-base-content border border-border hover:bg-base-300 transition-colors flex items-center gap-1.5"
                            >
                                <FolderOpen size={14} />
                            </button>
                        </div>
                        <div className="flex items-center gap-2 mt-3">
                            <button
                                type="button"
                                onClick={handleCreateProcs}
                                className="btn flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-primary text-primary-content text-sm hover:bg-primary/90 transition-colors"
                            >
                                <Plus size={14} />
                                Create
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowCreateForm(false)
                                    setSubdirPath("")
                                }}
                                className="btn px-3 py-1.5 text-sm text-muted hover:text-base-content transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="flex h-full">
            {/* Left sidebar - Process list */}
            <div className="w-72 flex-shrink-0 flex flex-col border-r border-border">
                {/* Header with refresh */}
                <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-border bg-base-200/50">
                    <span className="text-sm font-medium text-base-content">Processes</span>
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={refreshing}
                        className={cx("btn p-1.5 text-muted hover:text-base-content hover:bg-base-300 transition-colors", refreshing && "animate-spin")}
                        title="Refresh"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>

                {/* Errors banner */}
                {hasErrors && (
                    <div className="flex-shrink-0 p-3 bg-error/10 border-b border-error/20">
                        <div className="flex items-center gap-2 text-error text-sm font-medium">
                            <AlertTriangle size={16} />
                            <span>
                                {procsResult.errors.length} config error{procsResult.errors.length > 1 ? "s" : ""}
                            </span>
                        </div>
                        <div className="mt-2 space-y-1">
                            {procsResult.errors.map((err, i) => (
                                <div key={i} className="text-sm text-error/80 font-mono">
                                    {err.relativePath}: {err.error}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Process list */}
                <div className="flex-1 overflow-auto">
                    {configGroups.map((group) => (
                        <ConfigGroupView key={group.config.relativePath} group={group} context={context} procsResult={procsResult!} />
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
}

const ConfigGroupView = observer(function ConfigGroupView({ group, context, procsResult }: ConfigGroupViewProps) {
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
            await repoProcesses.startProcess(item.process, group.config, context, procsResult)
        }
    }, [stoppedDaemons, group.config, context, procsResult, repoProcesses])

    const handleStopAllDaemons = useCallback(async () => {
        for (const item of runningDaemons) {
            await repoProcesses.stopProcess(item.process.id)
        }
    }, [runningDaemons, repoProcesses])

    // Extract directory from config path (e.g., "packages/api/procs.toml" -> "packages/api")
    const configDir = group.config.relativePath.replace(/\/procs\.toml$/, "") || "."

    return (
        <div>
            {/* Config header - only show if multiple configs */}
            {configDir !== "." && (
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-base-200/50">
                    <Folder size={14} className="text-muted" />
                    <span className="flex-1 text-sm text-base-content font-mono truncate">{configDir}</span>
                    <div className="flex items-center gap-1">
                        {stoppedDaemons.length > 0 && (
                            <button
                                type="button"
                                onClick={handleStartAllDaemons}
                                className="btn p-1.5 text-muted hover:text-success hover:bg-success/10 transition-colors"
                                title="Start all daemons"
                            >
                                <Play size={14} />
                            </button>
                        )}
                        {runningDaemons.length > 0 && (
                            <button
                                type="button"
                                onClick={handleStopAllDaemons}
                                className="btn p-1.5 text-muted hover:text-error hover:bg-error/10 transition-colors"
                                title="Stop all daemons"
                            >
                                <Square size={14} />
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
    isSelected: boolean
    showTypeIcon?: boolean
}

const ProcessRowView = observer(function ProcessRowView({ process, instance, config, context, procsResult, isSelected, showTypeIcon }: ProcessRowViewProps) {
    const codeStore = useCodeStore()
    const { repoProcesses } = codeStore
    const status = instance?.status ?? "stopped"
    const isStarting = status === "starting"
    const canStart = status === "stopped" || status === "error"

    const handleStart = useCallback(async () => {
        repoProcesses.setExpandedProcess(process.id)
        await repoProcesses.startProcess(process, config, context, procsResult)
    }, [repoProcesses, process, config, context, procsResult])

    const handleStop = useCallback(() => repoProcesses.stopProcess(process.id), [repoProcesses, process.id])

    const handleRestart = useCallback(() => repoProcesses.restartProcess(process.id, procsResult), [repoProcesses, process.id, procsResult])

    const handleSelect = useCallback(() => repoProcesses.setExpandedProcess(process.id), [repoProcesses, process.id])

    const TypeIcon = TYPE_INFO[process.type].icon

    return (
        <div
            className={cx(
                "flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors",
                isSelected ? "bg-primary/10 border-l-3 border-l-primary" : "hover:bg-base-200 border-l-3 border-l-transparent"
            )}
            onClick={handleSelect}
        >
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <div className={cx("w-2.5 h-2.5 rounded-full flex-shrink-0", STATUS_STYLES[status])} />
                    {showTypeIcon && <TypeIcon size={14} className="text-muted flex-shrink-0" />}
                    <span className="text-sm text-base-content truncate font-medium">{process.name}</span>
                </div>
                <div className="text-xs text-muted truncate font-mono">{process.command}</div>
            </div>
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {instance?.exitCode !== undefined && instance.exitCode !== null && status !== "running" && (
                    <span className={cx("text-xs font-mono px-1.5 py-0.5", instance.exitCode === 0 ? "text-success bg-success/10" : "text-error bg-error/10")}>
                        exit {instance.exitCode}
                    </span>
                )}
                {process.url && (
                    <button
                        type="button"
                        onClick={() => openUrlInNativeBrowser(process.url!)}
                        className="btn p-1.5 text-muted hover:text-base-content hover:bg-base-300 transition-colors"
                        title={`Open ${process.url}`}
                    >
                        <ExternalLink size={14} />
                    </button>
                )}
                {canStart ? (
                    <button
                        type="button"
                        onClick={handleStart}
                        className="btn p-1.5 text-success/70 hover:text-success hover:bg-success/10 transition-colors"
                        title="Start"
                    >
                        <Play size={14} />
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={handleStop}
                        disabled={isStarting}
                        className={cx(
                            "btn p-1.5 transition-colors",
                            isStarting ? "text-muted cursor-not-allowed" : "text-error/70 hover:text-error hover:bg-error/10"
                        )}
                        title="Stop"
                    >
                        <Square size={14} />
                    </button>
                )}
                <button
                    type="button"
                    onClick={handleRestart}
                    disabled={isStarting}
                    className={cx(
                        "btn p-1.5 transition-colors",
                        isStarting ? "text-muted cursor-not-allowed" : "text-muted hover:text-base-content hover:bg-base-300"
                    )}
                    title="Restart"
                >
                    <RotateCcw size={14} />
                </button>
            </div>
        </div>
    )
})
