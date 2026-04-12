import NiceModal, { useModal } from "@ebay/nice-modal-react"
import cx from "classnames"
import { AlertTriangle, Clock3, FileText, Loader2, Plus, Server, Sparkles, Trash2, Wand2 } from "lucide-react"
import { observer } from "mobx-react"
import { Cron } from "croner"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
    type CronInput,
    type ProcessInput,
    type ReadProcsResult,
    type RunContext,
    loadEditableProcsFile,
    parseEditableRaw,
    readProcs,
    saveEditableProcsFile,
    serializeEditableProcs,
} from "../../electronAPI/procs"
import { runStructuredHarnessQuery } from "../../electronAPI/harnessQuery"
import { useCodeStore } from "../../store/context"
import { Modal } from "../ui/Modal"
import { CronAssistSchema, type ProcsRecommendations, ProcsRecommendationsSchema } from "./procsAssistSchemas"

type EditorTab = "processes" | "crons" | "suggestions" | "raw"

interface ConfigFileOption {
    filePath: string
    relativePath: string
}

interface ProcsEditorModalProps {
    workspaceId: string
    searchPath: string
    context?: RunContext
    initialFilePath?: string
    initialTab?: EditorTab
    onSaved?: (result: ReadProcsResult) => Promise<void> | void
}

const PROCESS_PRESETS: Array<{ label: string; type: ProcessInput["type"]; command: string }> = [
    { label: "Setup", type: "setup", command: "npm install" },
    { label: "Daemon", type: "daemon", command: "npm run dev" },
    { label: "Task", type: "task", command: "npm run build" },
    { label: "Check", type: "check", command: "npm run typecheck" },
]

const CRON_PRESETS: Array<{ label: string; schedule: string; type: CronInput["type"] }> = [
    { label: "Daily", schedule: "0 9 * * *", type: "plan" },
    { label: "Weekdays", schedule: "0 9 * * 1-5", type: "ask" },
    { label: "Weekly", schedule: "0 9 * * 1", type: "plan" },
    { label: "Monthly", schedule: "0 9 1 * *", type: "plan" },
]

const TAB_CONFIG: Array<{ id: EditorTab; label: string; icon: typeof Server }> = [
    { id: "processes", label: "Processes", icon: Server },
    { id: "crons", label: "Crons", icon: Clock3 },
    { id: "suggestions", label: "Suggestions", icon: Sparkles },
    { id: "raw", label: "Raw", icon: FileText },
]

function normalizeRelativePath(value: string): string {
    return value.replace(/\\/g, "/").replace(/^\.\/+/, "")
}

function joinFsPath(base: string, relative: string): string {
    const separator = base.includes("\\") ? "\\" : "/"
    const cleanedBase = base.endsWith("/") || base.endsWith("\\") ? base.slice(0, -1) : base
    const cleanedRelative = relative.replace(/[\\/]+/g, separator).replace(new RegExp(`^\\${separator}+`), "")
    return `${cleanedBase}${separator}${cleanedRelative}`
}

function toFileOptions(result: ReadProcsResult): ConfigFileOption[] {
    return result.configs.map((config) => ({
        filePath: joinFsPath(result.repoRoot, config.relativePath),
        relativePath: normalizeRelativePath(config.relativePath),
    }))
}

function validateDraft(processes: ProcessInput[], crons: CronInput[]): string[] {
    const errors: string[] = []

    const processNames = new Set<string>()
    for (const process of processes) {
        if (!process.name.trim()) errors.push("Process name is required")
        if (!process.command.trim()) errors.push(`Process "${process.name || "(unnamed)"}" command is required`)

        const key = process.name.trim().toLowerCase()
        if (key) {
            if (processNames.has(key)) errors.push(`Duplicate process name: ${process.name}`)
            processNames.add(key)
        }
    }

    const cronNames = new Set<string>()
    for (const cron of crons) {
        if (!cron.name.trim()) errors.push("Cron name is required")
        if (!cron.prompt.trim()) errors.push(`Cron "${cron.name || "(unnamed)"}" prompt is required`)
        if (!cron.schedule.trim()) {
            errors.push(`Cron "${cron.name || "(unnamed)"}" schedule is required`)
        } else {
            try {
                new Cron(cron.schedule)
            } catch {
                errors.push(`Cron "${cron.name || "(unnamed)"}" schedule is invalid`)
            }
        }

        const key = cron.name.trim().toLowerCase()
        if (key) {
            if (cronNames.has(key)) errors.push(`Duplicate cron name: ${cron.name}`)
            cronNames.add(key)
        }
    }

    return Array.from(new Set(errors))
}

export const ProcsEditorModal = NiceModal.create(
    observer(({ workspaceId, searchPath, context, initialFilePath, initialTab = "processes", onSaved }: ProcsEditorModalProps) => {
        const modal = useModal()
        const codeStore = useCodeStore()
        const [discovering, setDiscovering] = useState(true)
        const [loadingFile, setLoadingFile] = useState(false)
        const [saving, setSaving] = useState(false)
        const [error, setError] = useState<string | null>(null)
        const [discoverResult, setDiscoverResult] = useState<ReadProcsResult | null>(null)
        const [configOptions, setConfigOptions] = useState<ConfigFileOption[]>([])
        const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
        const [relativePath, setRelativePath] = useState<string>("openade.toml")
        const [activeTab, setActiveTab] = useState<EditorTab>(initialTab)
        const [processes, setProcesses] = useState<ProcessInput[]>([])
        const [crons, setCrons] = useState<CronInput[]>([])
        const [rawMode, setRawMode] = useState<"preview" | "edit">("preview")
        const [rawContent, setRawContent] = useState("")
        const [rawError, setRawError] = useState<string | null>(null)
        const [showNewFileForm, setShowNewFileForm] = useState(false)
        const [newFileDir, setNewFileDir] = useState("")
        const [cronAssistLoadingIndex, setCronAssistLoadingIndex] = useState<number | null>(null)
        const [cronAssistError, setCronAssistError] = useState<string | null>(null)
        const [cronAssistHints, setCronAssistHints] = useState<Record<number, string>>({})
        const [recommendations, setRecommendations] = useState<ProcsRecommendations | null>(null)
        const [recommendationsLoading, setRecommendationsLoading] = useState(false)
        const [recommendationsError, setRecommendationsError] = useState<string | null>(null)

        const repoRoot = discoverResult?.repoRoot ?? searchPath
        const hasMultipleConfigs = configOptions.length > 1
        const validationErrors = useMemo(() => validateDraft(processes, crons), [processes, crons])

        const loadFile = useCallback(
            async (filePath: string) => {
                setLoadingFile(true)
                setError(null)
                try {
                    const editable = await loadEditableProcsFile(filePath, searchPath)
                    setSelectedFilePath(filePath)
                    setRelativePath(normalizeRelativePath(editable.relativePath))
                    setProcesses(editable.processes)
                    setCrons(editable.crons)
                    setRawContent(editable.rawContent)
                    setRawMode("preview")
                    setRawError(null)
                    setCronAssistHints({})
                    setRecommendations(null)
                } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to load config")
                } finally {
                    setLoadingFile(false)
                }
            },
            [searchPath]
        )

        useEffect(() => {
            let cancelled = false

            async function discover(): Promise<void> {
                setDiscovering(true)
                setError(null)
                try {
                    const result = await readProcs(searchPath)
                    if (cancelled) return

                    const options = toFileOptions(result)
                    setDiscoverResult(result)
                    setConfigOptions(options)

                    if (initialFilePath) {
                        await loadFile(initialFilePath)
                        return
                    }

                    if (options.length === 1) {
                        await loadFile(options[0].filePath)
                        return
                    }

                    if (options.length === 0) {
                        const targetRelativePath = "openade.toml"
                        setSelectedFilePath(joinFsPath(result.repoRoot, targetRelativePath))
                        setRelativePath(targetRelativePath)
                        setProcesses([])
                        setCrons([])
                        setRawContent("")
                    } else {
                        setSelectedFilePath(null)
                        setRelativePath("openade.toml")
                    }
                } catch (err) {
                    if (cancelled) return
                    setError(err instanceof Error ? err.message : "Failed to read config files")
                } finally {
                    if (!cancelled) setDiscovering(false)
                }
            }

            void discover()

            return () => {
                cancelled = true
            }
        }, [searchPath, initialFilePath, loadFile])

        const selectedOption = useMemo(() => configOptions.find((option) => option.filePath === selectedFilePath) ?? null, [configOptions, selectedFilePath])

        const parseRawAndApply = useCallback(async (): Promise<boolean> => {
            setRawError(null)
            try {
                const parsed = await parseEditableRaw(rawContent, relativePath)
                setProcesses(parsed.processes)
                setCrons(parsed.crons)
                setRawMode("preview")
                return true
            } catch (err) {
                setRawError(err instanceof Error ? err.message : "Invalid TOML")
                return false
            }
        }, [rawContent, relativePath])

        const switchTab = useCallback(
            async (nextTab: EditorTab) => {
                if (nextTab === activeTab) return

                if (activeTab === "raw" && rawMode === "edit") {
                    const ok = await parseRawAndApply()
                    if (!ok) return
                }

                if (nextTab === "raw") {
                    try {
                        const serialized = await serializeEditableProcs({ processes, crons })
                        setRawContent(serialized)
                        setRawMode("preview")
                        setRawError(null)
                    } catch (err) {
                        setRawError(err instanceof Error ? err.message : "Failed to build TOML preview")
                    }
                }

                setActiveTab(nextTab)
            },
            [activeTab, rawMode, parseRawAndApply, processes, crons]
        )

        const handleCreateNewFile = useCallback(() => {
            const dir = normalizeRelativePath(newFileDir.trim()).replace(/\/+$/, "")
            const targetRelativePath = dir ? `${dir}/openade.toml` : "openade.toml"
            setSelectedFilePath(joinFsPath(repoRoot, targetRelativePath))
            setRelativePath(targetRelativePath)
            setProcesses([])
            setCrons([])
            setRawContent("")
            setRawMode("preview")
            setRawError(null)
            setShowNewFileForm(false)
            setError(null)
        }, [newFileDir, repoRoot])

        const handleSave = useCallback(async () => {
            if (!selectedFilePath) {
                setError("Choose a config file first")
                return
            }

            setSaving(true)
            setError(null)

            try {
                let nextProcesses = processes
                let nextCrons = crons

                if (activeTab === "raw" && rawMode === "edit") {
                    const parsed = await parseEditableRaw(rawContent, relativePath)
                    nextProcesses = parsed.processes
                    nextCrons = parsed.crons
                    setProcesses(parsed.processes)
                    setCrons(parsed.crons)
                }

                const nextErrors = validateDraft(nextProcesses, nextCrons)
                if (nextErrors.length > 0) {
                    throw new Error(nextErrors[0])
                }

                const saveResult = await saveEditableProcsFile({
                    filePath: selectedFilePath,
                    relativePath,
                    processes: nextProcesses,
                    crons: nextCrons,
                    searchPath,
                })

                if (saveResult.readResult) {
                    codeStore.crons.updateCronDefs(workspaceId, saveResult.readResult)

                    if (context) {
                        const validProcessIds = new Set<string>()
                        for (const config of saveResult.readResult.configs) {
                            for (const process of config.processes) {
                                validProcessIds.add(process.id)
                            }
                        }
                        await codeStore.repoProcesses.stopProcessesMissingFromConfig({
                            context,
                            validProcessIds,
                        })
                    }

                    await onSaved?.(saveResult.readResult)
                }

                modal.remove()
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to save config")
            } finally {
                setSaving(false)
            }
        }, [
            selectedFilePath,
            processes,
            crons,
            activeTab,
            rawMode,
            rawContent,
            relativePath,
            searchPath,
            codeStore.crons,
            codeStore.repoProcesses,
            workspaceId,
            context,
            onSaved,
            modal,
        ])

        const runCronAssist = useCallback(
            async (index: number) => {
                const current = crons[index]
                if (!current) return

                setCronAssistLoadingIndex(index)
                setCronAssistError(null)
                try {
                    const response = await runStructuredHarnessQuery({
                        prompt: `Convert this schedule request to a 5-field cron expression:\n\n${current.schedule}\n\nReturn a concise summary and any assumptions.`,
                        options: {
                            harnessId: codeStore.defaultHarnessId,
                            cwd: searchPath,
                            mode: "read-only",
                            model: "haiku",
                            disablePlanningTools: true,
                        },
                        schema: {
                            type: "object",
                            properties: {
                                schedule: { type: "string" },
                                summary: { type: "string" },
                                assumptions: { type: "array", items: { type: "string" } },
                            },
                            required: ["schedule", "summary"],
                        },
                        parse: (value) => CronAssistSchema.parse(value),
                    })

                    setCrons((prev) => prev.map((cron, i) => (i === index ? { ...cron, schedule: response.schedule } : cron)))
                    const details = [response.summary, ...response.assumptions].join(" | ")
                    setCronAssistHints((prev) => ({ ...prev, [index]: details }))
                } catch (err) {
                    setCronAssistError(err instanceof Error ? err.message : "Failed to generate schedule")
                } finally {
                    setCronAssistLoadingIndex(null)
                }
            },
            [crons, codeStore.defaultHarnessId, searchPath]
        )

        const runRecommendations = useCallback(async () => {
            setRecommendationsLoading(true)
            setRecommendationsError(null)
            try {
                const currentToml = await serializeEditableProcs({ processes, crons })
                const response = await runStructuredHarnessQuery({
                    prompt: `Analyze this repository and suggest practical openade processes and cron jobs.\n\nCurrent config:\n${currentToml || "(empty)"}`,
                    options: {
                        harnessId: codeStore.defaultHarnessId,
                        cwd: searchPath,
                        mode: "read-only",
                        model: "haiku",
                        disablePlanningTools: true,
                    },
                    schema: {
                        type: "object",
                        properties: {
                            processes: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        name: { type: "string" },
                                        type: { type: "string", enum: ["setup", "daemon", "task", "check"] },
                                        command: { type: "string" },
                                        workDir: { type: "string" },
                                        url: { type: "string" },
                                        reason: { type: "string" },
                                    },
                                    required: ["name", "type", "command", "reason"],
                                },
                            },
                            crons: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        name: { type: "string" },
                                        schedule: { type: "string" },
                                        type: { type: "string", enum: ["plan", "do", "ask", "hyperplan"] },
                                        prompt: { type: "string" },
                                        reason: { type: "string" },
                                    },
                                    required: ["name", "schedule", "type", "prompt", "reason"],
                                },
                            },
                        },
                        required: ["processes", "crons"],
                    },
                    parse: (value) => ProcsRecommendationsSchema.parse(value),
                })

                setRecommendations(response)
            } catch (err) {
                setRecommendationsError(err instanceof Error ? err.message : "Failed to scan repository")
            } finally {
                setRecommendationsLoading(false)
            }
        }, [processes, crons, codeStore.defaultHarnessId, searchPath])

        const footer = (
            <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                    {validationErrors.length > 0 ? (
                        <div className="text-xs text-warning truncate" title={validationErrors.join("\n")}>
                            {validationErrors[0]}
                        </div>
                    ) : (
                        <div className="text-xs text-muted truncate">{relativePath}</div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="btn px-3 py-1.5 text-sm text-muted hover:text-base-content transition-colors"
                        onClick={() => modal.remove()}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn px-3 py-1.5 text-sm bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={handleSave}
                        disabled={saving || loadingFile || discovering || !selectedFilePath || validationErrors.length > 0}
                    >
                        {saving ? "Saving..." : "Save"}
                    </button>
                </div>
            </div>
        )

        const emptyProcess: ProcessInput = { name: "", type: "daemon", command: "" }
        const emptyCron: CronInput = { name: "", schedule: "", type: "plan", prompt: "" }

        return (
            <Modal title="Edit Config" footer={footer}>
                <div className="flex flex-col gap-4">
                    {error && (
                        <div className="px-3 py-2 text-xs bg-error/10 border border-error/20 text-error flex items-center gap-2">
                            <AlertTriangle size={13} />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="flex items-end gap-2">
                        <div className="flex-1">
                            <label htmlFor="procs-editor-config-file" className="block text-[11px] text-muted mb-1">
                                Config file
                            </label>
                            <select
                                id="procs-editor-config-file"
                                className="w-full h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                value={selectedFilePath ?? ""}
                                onChange={(e) => {
                                    const value = e.target.value
                                    if (!value) {
                                        setSelectedFilePath(null)
                                        return
                                    }
                                    void loadFile(value)
                                }}
                                disabled={discovering || loadingFile}
                            >
                                <option value="">{hasMultipleConfigs ? "Choose a file..." : "Select file"}</option>
                                {selectedFilePath && !selectedOption && <option value={selectedFilePath}>{relativePath} (new)</option>}
                                {configOptions.map((option) => (
                                    <option key={option.filePath} value={option.filePath}>
                                        {option.relativePath}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <button
                            type="button"
                            className="btn h-9 px-3 text-sm bg-base-200 hover:bg-base-300 text-base-content border border-border"
                            onClick={() => setShowNewFileForm((prev) => !prev)}
                        >
                            New file
                        </button>
                    </div>

                    {showNewFileForm && (
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 p-3 bg-base-200/40 border border-border">
                            <input
                                type="text"
                                value={newFileDir}
                                onChange={(e) => setNewFileDir(e.target.value)}
                                placeholder="Subdirectory (optional), e.g. projects/api"
                                className="h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                            />
                            <button
                                type="button"
                                className="btn h-9 px-3 text-sm bg-primary text-primary-content hover:bg-primary/90"
                                onClick={handleCreateNewFile}
                            >
                                Create openade.toml
                            </button>
                        </div>
                    )}

                    {hasMultipleConfigs && !selectedFilePath && (
                        <div className="px-3 py-2 text-xs bg-warning/10 border border-warning/20 text-warning">Select a target config file before editing.</div>
                    )}

                    <div className="flex items-center gap-1 border-b border-border pb-2">
                        {TAB_CONFIG.map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                className={cx(
                                    "btn px-2.5 py-1 text-xs transition-colors flex items-center gap-1.5",
                                    activeTab === tab.id ? "bg-primary/15 text-primary" : "text-muted hover:text-base-content hover:bg-base-200"
                                )}
                                onClick={() => void switchTab(tab.id)}
                            >
                                <tab.icon size={12} />
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </div>

                    {discovering || loadingFile ? (
                        <div className="flex items-center justify-center py-10 text-muted text-sm gap-2">
                            <Loader2 size={16} className="animate-spin" />
                            Loading...
                        </div>
                    ) : (
                        <>
                            {activeTab === "processes" && (
                                <div className="flex flex-col gap-3">
                                    <div className="flex flex-col gap-2">
                                        <div className="text-[11px] uppercase tracking-wide text-muted">Quick Add Process</div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {PROCESS_PRESETS.map((preset) => (
                                                <button
                                                    key={preset.label}
                                                    type="button"
                                                    className="btn px-2 py-1 text-xs bg-base-200 text-base-content hover:bg-base-300"
                                                    onClick={() =>
                                                        setProcesses((prev) => [
                                                            ...prev,
                                                            {
                                                                name: "",
                                                                type: preset.type,
                                                                command: preset.command,
                                                            },
                                                        ])
                                                    }
                                                >
                                                    Add {preset.label}
                                                </button>
                                            ))}
                                            <button
                                                type="button"
                                                className="btn px-2 py-1 text-xs bg-primary text-primary-content hover:bg-primary/90 flex items-center gap-1"
                                                onClick={() => setProcesses((prev) => [...prev, { ...emptyProcess }])}
                                            >
                                                <Plus size={12} />
                                                Add Empty Process
                                            </button>
                                        </div>
                                    </div>
                                    {processes.length === 0 && <div className="text-xs text-muted">No processes yet.</div>}
                                    {processes.map((process, index) => (
                                        <div
                                            key={`process-${index}`}
                                            className="grid grid-cols-1 md:grid-cols-12 gap-2 p-3 border border-border bg-base-200/20"
                                        >
                                            <div className="md:col-span-12 text-[11px] text-muted">Process {index + 1}</div>
                                            <input
                                                value={process.name}
                                                onChange={(e) => setProcesses((prev) => prev.map((p, i) => (i === index ? { ...p, name: e.target.value } : p)))}
                                                placeholder="Name"
                                                className="md:col-span-3 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                            />
                                            <select
                                                value={process.type}
                                                onChange={(e) =>
                                                    setProcesses((prev) =>
                                                        prev.map((p, i) => (i === index ? { ...p, type: e.target.value as ProcessInput["type"] } : p))
                                                    )
                                                }
                                                className="md:col-span-2 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                            >
                                                <option value="setup">setup</option>
                                                <option value="daemon">daemon</option>
                                                <option value="task">task</option>
                                                <option value="check">check</option>
                                            </select>
                                            <input
                                                value={process.command}
                                                onChange={(e) =>
                                                    setProcesses((prev) => prev.map((p, i) => (i === index ? { ...p, command: e.target.value } : p)))
                                                }
                                                placeholder="Command"
                                                className="md:col-span-5 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                            />
                                            <button
                                                type="button"
                                                className="btn md:col-span-2 h-9 px-2 text-xs text-error hover:bg-error/10"
                                                onClick={() => setProcesses((prev) => prev.filter((_, i) => i !== index))}
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                            <input
                                                value={process.workDir ?? ""}
                                                onChange={(e) =>
                                                    setProcesses((prev) =>
                                                        prev.map((p, i) => (i === index ? { ...p, workDir: e.target.value || undefined } : p))
                                                    )
                                                }
                                                placeholder="workDir (optional)"
                                                className="md:col-span-6 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                            />
                                            <input
                                                value={process.url ?? ""}
                                                onChange={(e) =>
                                                    setProcesses((prev) => prev.map((p, i) => (i === index ? { ...p, url: e.target.value || undefined } : p)))
                                                }
                                                placeholder="url (optional)"
                                                className="md:col-span-6 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}

                            {activeTab === "crons" && (
                                <div className="flex flex-col gap-3">
                                    <div className="flex flex-col gap-2">
                                        <div className="text-[11px] uppercase tracking-wide text-muted">Quick Add Cron</div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {CRON_PRESETS.map((preset) => (
                                                <button
                                                    key={preset.label}
                                                    type="button"
                                                    className="btn px-2 py-1 text-xs bg-base-200 text-base-content hover:bg-base-300"
                                                    onClick={() =>
                                                        setCrons((prev) => [
                                                            ...prev,
                                                            {
                                                                ...emptyCron,
                                                                schedule: preset.schedule,
                                                                type: preset.type,
                                                            },
                                                        ])
                                                    }
                                                >
                                                    Add {preset.label}
                                                </button>
                                            ))}
                                            <button
                                                type="button"
                                                className="btn px-2 py-1 text-xs bg-primary text-primary-content hover:bg-primary/90 flex items-center gap-1"
                                                onClick={() => setCrons((prev) => [...prev, { ...emptyCron }])}
                                            >
                                                <Plus size={12} />
                                                Add Empty Cron
                                            </button>
                                        </div>
                                    </div>
                                    {cronAssistError && <div className="text-xs text-warning">{cronAssistError}</div>}
                                    {crons.length === 0 && <div className="text-xs text-muted">No crons yet.</div>}
                                    {crons.map((cron, index) => (
                                        <div key={`cron-${index}`} className="grid grid-cols-1 md:grid-cols-12 gap-2 p-3 border border-border bg-base-200/20">
                                            <div className="md:col-span-12 text-[11px] text-muted">Cron {index + 1}</div>
                                            <input
                                                value={cron.name}
                                                onChange={(e) => setCrons((prev) => prev.map((c, i) => (i === index ? { ...c, name: e.target.value } : c)))}
                                                placeholder="Name"
                                                className="md:col-span-3 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                            />
                                            <select
                                                value={cron.type}
                                                onChange={(e) =>
                                                    setCrons((prev) =>
                                                        prev.map((c, i) => (i === index ? { ...c, type: e.target.value as CronInput["type"] } : c))
                                                    )
                                                }
                                                className="md:col-span-2 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                            >
                                                <option value="plan">plan</option>
                                                <option value="do">do</option>
                                                <option value="ask">ask</option>
                                                <option value="hyperplan">hyperplan</option>
                                            </select>
                                            <div className="md:col-span-6 flex items-center gap-1">
                                                <input
                                                    value={cron.schedule}
                                                    onChange={(e) =>
                                                        setCrons((prev) => prev.map((c, i) => (i === index ? { ...c, schedule: e.target.value } : c)))
                                                    }
                                                    placeholder="Cron schedule or natural language"
                                                    className="flex-1 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                                />
                                                <button
                                                    type="button"
                                                    className="btn h-9 w-9 text-muted hover:text-primary hover:bg-primary/10"
                                                    onClick={() => void runCronAssist(index)}
                                                    title="Generate schedule"
                                                    disabled={cronAssistLoadingIndex === index}
                                                >
                                                    {cronAssistLoadingIndex === index ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                                                </button>
                                            </div>
                                            <button
                                                type="button"
                                                className="btn md:col-span-1 h-9 px-2 text-xs text-error hover:bg-error/10"
                                                onClick={() => setCrons((prev) => prev.filter((_, i) => i !== index))}
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                            <textarea
                                                value={cron.prompt}
                                                onChange={(e) => setCrons((prev) => prev.map((c, i) => (i === index ? { ...c, prompt: e.target.value } : c)))}
                                                placeholder="Prompt"
                                                rows={3}
                                                className="md:col-span-12 px-2 py-1.5 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary resize-y"
                                            />
                                            <input
                                                value={cron.appendSystemPrompt ?? ""}
                                                onChange={(e) =>
                                                    setCrons((prev) =>
                                                        prev.map((c, i) => (i === index ? { ...c, appendSystemPrompt: e.target.value || undefined } : c))
                                                    )
                                                }
                                                placeholder="appendSystemPrompt (optional)"
                                                className="md:col-span-6 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                            />
                                            <input
                                                value={cron.harness ?? ""}
                                                onChange={(e) =>
                                                    setCrons((prev) => prev.map((c, i) => (i === index ? { ...c, harness: e.target.value || undefined } : c)))
                                                }
                                                placeholder="harness (optional)"
                                                className="md:col-span-3 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                            />
                                            <select
                                                value={cron.isolation ?? ""}
                                                onChange={(e) =>
                                                    setCrons((prev) =>
                                                        prev.map((c, i) =>
                                                            i === index ? { ...c, isolation: (e.target.value || undefined) as CronInput["isolation"] } : c
                                                        )
                                                    )
                                                }
                                                className="md:col-span-3 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                            >
                                                <option value="">isolation (default)</option>
                                                <option value="head">head</option>
                                                <option value="worktree">worktree</option>
                                            </select>
                                            {cronAssistHints[index] && (
                                                <div className="md:col-span-12 text-[11px] text-muted flex items-start gap-1">
                                                    <Sparkles size={11} className="mt-0.5" />
                                                    <span>{cronAssistHints[index]}</span>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {activeTab === "suggestions" && (
                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs text-muted">Scan repository for quick install recommendations.</div>
                                        <button
                                            type="button"
                                            className="btn h-8 px-3 text-xs bg-base-200 text-base-content hover:bg-base-300"
                                            onClick={() => void runRecommendations()}
                                            disabled={recommendationsLoading}
                                        >
                                            {recommendationsLoading ? (
                                                <span className="flex items-center gap-1">
                                                    <Loader2 size={12} className="animate-spin" />
                                                    Scanning...
                                                </span>
                                            ) : (
                                                "Scan repository"
                                            )}
                                        </button>
                                    </div>

                                    {recommendationsError && <div className="text-xs text-warning">{recommendationsError}</div>}
                                    {!recommendations && !recommendationsLoading && <div className="text-xs text-muted">No suggestions loaded yet.</div>}

                                    {recommendations && (
                                        <>
                                            <div className="text-xs font-medium text-base-content">Processes</div>
                                            {recommendations.processes.length === 0 && <div className="text-xs text-muted">No process suggestions.</div>}
                                            {recommendations.processes.map((suggestion, idx) => (
                                                <div
                                                    key={`suggested-process-${idx}`}
                                                    className="flex items-start justify-between gap-3 p-3 border border-border bg-base-200/20"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="text-sm text-base-content">
                                                            {suggestion.name} <span className="text-muted">({suggestion.type})</span>
                                                        </div>
                                                        <div className="text-xs text-muted font-mono truncate">{suggestion.command}</div>
                                                        <div className="text-xs text-muted mt-1">{suggestion.reason}</div>
                                                    </div>
                                                    {(() => {
                                                        const alreadyExists = processes.some(
                                                            (p) => p.name.trim().toLowerCase() === suggestion.name.trim().toLowerCase()
                                                        )

                                                        return (
                                                            <button
                                                                type="button"
                                                                className="btn h-8 px-2 text-xs bg-primary text-primary-content hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                disabled={alreadyExists}
                                                                onClick={() =>
                                                                    setProcesses((prev) => {
                                                                        if (
                                                                            prev.some(
                                                                                (p) =>
                                                                                    p.name.trim().toLowerCase() ===
                                                                                    suggestion.name.trim().toLowerCase()
                                                                            )
                                                                        ) {
                                                                            return prev
                                                                        }
                                                                        return [
                                                                            ...prev,
                                                                            {
                                                                                name: suggestion.name,
                                                                                type: suggestion.type,
                                                                                command: suggestion.command,
                                                                                workDir: suggestion.workDir,
                                                                                url: suggestion.url,
                                                                            },
                                                                        ]
                                                                    })
                                                                }
                                                            >
                                                                {alreadyExists ? "Added" : "Add Process"}
                                                            </button>
                                                        )
                                                    })()}
                                                </div>
                                            ))}

                                            <div className="text-xs font-medium text-base-content mt-1">Crons</div>
                                            {recommendations.crons.length === 0 && <div className="text-xs text-muted">No cron suggestions.</div>}
                                            {recommendations.crons.map((suggestion, idx) => (
                                                <div
                                                    key={`suggested-cron-${idx}`}
                                                    className="flex items-start justify-between gap-3 p-3 border border-border bg-base-200/20"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="text-sm text-base-content">
                                                            {suggestion.name} <span className="text-muted">({suggestion.type})</span>
                                                        </div>
                                                        <div className="text-xs text-muted font-mono truncate">{suggestion.schedule}</div>
                                                        <div className="text-xs text-muted mt-1">{suggestion.reason}</div>
                                                    </div>
                                                    {(() => {
                                                        const alreadyExists = crons.some(
                                                            (c) => c.name.trim().toLowerCase() === suggestion.name.trim().toLowerCase()
                                                        )

                                                        return (
                                                            <button
                                                                type="button"
                                                                className="btn h-8 px-2 text-xs bg-primary text-primary-content hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                disabled={alreadyExists}
                                                                onClick={() =>
                                                                    setCrons((prev) => {
                                                                        if (
                                                                            prev.some(
                                                                                (c) =>
                                                                                    c.name.trim().toLowerCase() ===
                                                                                    suggestion.name.trim().toLowerCase()
                                                                            )
                                                                        ) {
                                                                            return prev
                                                                        }
                                                                        return [
                                                                            ...prev,
                                                                            {
                                                                                name: suggestion.name,
                                                                                schedule: suggestion.schedule,
                                                                                type: suggestion.type,
                                                                                prompt: suggestion.prompt,
                                                                            },
                                                                        ]
                                                                    })
                                                                }
                                                            >
                                                                {alreadyExists ? "Added" : "Add Cron"}
                                                            </button>
                                                        )
                                                    })()}
                                                </div>
                                            ))}
                                        </>
                                    )}
                                </div>
                            )}

                            {activeTab === "raw" && (
                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-xs text-muted">
                                            {rawMode === "preview"
                                                ? "Preview generated TOML from structured fields."
                                                : "Raw edit mode is active. Invalid TOML blocks save and tab switch."}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {rawMode === "preview" ? (
                                                <button
                                                    type="button"
                                                    className="btn h-8 px-3 text-xs bg-base-200 text-base-content hover:bg-base-300"
                                                    onClick={() => setRawMode("edit")}
                                                >
                                                    Edit raw
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="btn h-8 px-3 text-xs bg-base-200 text-base-content hover:bg-base-300"
                                                    onClick={() => void parseRawAndApply()}
                                                >
                                                    Apply raw
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {rawError && <div className="text-xs text-error">{rawError}</div>}
                                    <textarea
                                        value={rawContent}
                                        onChange={(e) => setRawContent(e.target.value)}
                                        readOnly={rawMode === "preview"}
                                        className={cx(
                                            "w-full h-[360px] font-mono text-xs p-3 border resize-y",
                                            rawMode === "preview"
                                                ? "bg-base-200 text-muted border-border"
                                                : "bg-input text-base-content border-border focus:outline-none focus:border-primary"
                                        )}
                                        spellCheck={false}
                                    />
                                </div>
                            )}
                        </>
                    )}
                </div>
            </Modal>
        )
    })
)
