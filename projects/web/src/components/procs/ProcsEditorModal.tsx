import NiceModal, { useModal } from "@ebay/nice-modal-react"
import cx from "classnames"
import { Cron } from "croner"
import { AlertTriangle, Clock3, FileText, Loader2, Plus, Server, Sparkles, Trash2, Wand2 } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { OPENADE_METHOD } from "../../../../openade-client/src"
import { parseEditableProcsFile, serializeProcsFile } from "../../../../openade-module/src/procs"
import { type HarnessId, runStructuredHarnessQuery } from "../../electronAPI/harnessQuery"
import {
    type CronInput,
    type EditableProcsFile,
    type ProcessInput,
    type ReadProcsResult,
    type RunContext,
    loadEditableProcsFile,
    parseEditableRaw,
    readProcs,
    saveEditableProcsFile,
    serializeEditableProcs,
} from "../../electronAPI/procs"
import { useCodeStore } from "../../store/context"
import type { ProductProjectProcessAccess } from "../../store/managers/RepoProcessesManager"
import type { ProductProjectScope } from "../../store/productProjectProcessAccess"
import { readProcsResultFromProductProcesses } from "../../store/projectProcessReadResult"
import type { CodeStore } from "../../store/store"
import { Modal } from "../ui/Modal"
import { CronAssistSchema, type CronAssistResult, type ProcsRecommendations, ProcsRecommendationsSchema } from "./procsAssistSchemas"

type EditorTab = "processes" | "crons" | "suggestions" | "raw"

interface ConfigFileOption {
    filePath: string
    relativePath: string
}

interface SidebarFileNode {
    filePath: string
    relativePath: string
    processes: string[]
    crons: string[]
}

interface ProcsEditorModalProps {
    workspaceId: string
    searchPath: string
    context?: RunContext
    initialFilePath?: string
    initialTab?: EditorTab
    productScope?: ProductProjectScope | null
    productAccess?: ProductProjectProcessAccess | null
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

const LOCAL_ASSIST_UNAVAILABLE_MESSAGE = "Process config suggestions are not available from this runtime"

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

function emptyProcsReadResult(searchPath: string): ReadProcsResult {
    return {
        repoRoot: searchPath,
        searchRoot: searchPath,
        isWorktree: false,
        configs: [],
        errors: [],
    }
}

function getDraftLabel(value: string, kind: "process" | "cron", index: number): string {
    const trimmed = value.trim()
    if (trimmed) return trimmed
    return `Untitled ${kind} ${index + 1}`
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

export async function saveProcsEditorFile(args: {
    codeStore: Pick<CodeStore, "canUseProductMethod" | "listProductProjectProcesses" | "writeProductProjectFile">
    selectedFilePath: string
    relativePath: string
    processes: ProcessInput[]
    crons: CronInput[]
    searchPath: string
    productScope?: ProductProjectScope | null
    productRuntimeOwnsProjectConfig?: boolean
}): Promise<ReadProcsResult | null> {
    if (args.productScope) {
        if (!args.codeStore.canUseProductMethod(OPENADE_METHOD.projectFileWrite)) {
            throw new Error("Project file writes are not available from this runtime")
        }
        const rawContentToSave = serializeProcsFile({ processes: args.processes, crons: args.crons })
        await args.codeStore.writeProductProjectFile({
            repoId: args.productScope.repoId,
            taskId: args.productScope.taskId,
            path: args.relativePath,
            encoding: "utf8",
            content: rawContentToSave,
            createDirs: true,
        })
        if (!args.codeStore.canUseProductMethod(OPENADE_METHOD.projectProcessList)) return null
        const processesResult = await args.codeStore.listProductProjectProcesses({
            repoId: args.productScope.repoId,
            taskId: args.productScope.taskId,
        })
        return readProcsResultFromProductProcesses(processesResult)
    }

    if (args.productRuntimeOwnsProjectConfig) {
        throw new Error("Project process config scope is not available from this runtime")
    }

    const saveResult = await saveEditableProcsFile({
        filePath: args.selectedFilePath,
        relativePath: args.relativePath,
        processes: args.processes,
        crons: args.crons,
        searchPath: args.searchPath,
    })
    return saveResult.readResult ?? null
}

function relativePathFromFilePath(repoRoot: string, filePath: string): string {
    const normalizedRoot = normalizeRelativePath(repoRoot).replace(/\/+$/, "")
    const normalizedFile = normalizeRelativePath(filePath)
    const rootPrefix = `${normalizedRoot}/`
    if (normalizedFile === normalizedRoot) return ""
    if (normalizedFile.startsWith(rootPrefix)) return normalizedFile.slice(rootPrefix.length)
    return normalizedFile
}

function parseEditableResult(content: string, relativePath: string): { processes: ProcessInput[]; crons: CronInput[] } {
    const parsed = parseEditableProcsFile(content, relativePath)
    if ("error" in parsed) {
        throw new Error(parsed.error.line ? `${parsed.error.error} at line ${parsed.error.line}` : parsed.error.error)
    }
    return parsed
}

export async function readProcsEditorConfigs(args: {
    codeStore: Pick<CodeStore, "canUseProductMethod" | "listProductProjectProcesses">
    searchPath: string
    productScope?: ProductProjectScope | null
    productRuntimeOwnsProjectConfig?: boolean
}): Promise<ReadProcsResult> {
    if (args.productScope) {
        if (!args.codeStore.canUseProductMethod(OPENADE_METHOD.projectProcessList)) return emptyProcsReadResult(args.searchPath)
        const result = await args.codeStore.listProductProjectProcesses({
            repoId: args.productScope.repoId,
            taskId: args.productScope.taskId,
        })
        return readProcsResultFromProductProcesses(result)
    }

    if (args.productRuntimeOwnsProjectConfig) return emptyProcsReadResult(args.searchPath)

    return readProcs(args.searchPath)
}

export async function loadProcsEditorFile(args: {
    codeStore: Pick<CodeStore, "canUseProductMethod" | "readProductProjectFile">
    filePath: string
    repoRoot: string
    searchPath: string
    productScope?: ProductProjectScope | null
    productRuntimeOwnsProjectConfig?: boolean
}): Promise<EditableProcsFile> {
    if (args.productScope) {
        if (!args.codeStore.canUseProductMethod(OPENADE_METHOD.projectFileRead)) {
            throw new Error("Project file reads are not available from this runtime")
        }
        const relativePath = relativePathFromFilePath(args.repoRoot, args.filePath)
        const file = await args.codeStore.readProductProjectFile({
            repoId: args.productScope.repoId,
            taskId: args.productScope.taskId,
            path: relativePath,
            encoding: "utf8",
        })
        if (file.tooLarge) throw new Error(`Config file is too large to edit: ${relativePath}`)
        const rawContent = file.content ?? ""
        const parsed = parseEditableResult(rawContent, relativePath)
        return {
            filePath: args.filePath,
            relativePath,
            processes: parsed.processes,
            crons: parsed.crons,
            rawContent,
        }
    }

    if (args.productRuntimeOwnsProjectConfig) {
        throw new Error("Project process config scope is not available from this runtime")
    }

    return loadEditableProcsFile(args.filePath, args.searchPath)
}

export async function parseProcsEditorRaw(args: {
    rawContent: string
    relativePath: string
    productScope?: ProductProjectScope | null
}): Promise<{ processes: ProcessInput[]; crons: CronInput[] }> {
    if (args.productScope) return parseEditableResult(args.rawContent, args.relativePath)
    return parseEditableRaw(args.rawContent, args.relativePath)
}

export async function serializeProcsEditorRaw(args: {
    processes: ProcessInput[]
    crons: CronInput[]
    productScope?: ProductProjectScope | null
}): Promise<string> {
    if (args.productScope) return serializeProcsFile({ processes: args.processes, crons: args.crons })
    return serializeEditableProcs({ processes: args.processes, crons: args.crons })
}

export function canUseLocalProcsEditorAssist(args: { productRuntimeOwnsProjectConfig?: boolean }): boolean {
    return args.productRuntimeOwnsProjectConfig !== true
}

export async function runProcsEditorCronAssist(args: {
    canUseLocalAssist: boolean
    schedule: string
    harnessId: HarnessId
    searchPath: string
}): Promise<CronAssistResult> {
    if (!args.canUseLocalAssist) throw new Error(LOCAL_ASSIST_UNAVAILABLE_MESSAGE)

    return runStructuredHarnessQuery({
        prompt: `Convert this schedule request to a 5-field cron expression:\n\n${args.schedule}\n\nReturn a concise summary and any assumptions.`,
        options: {
            harnessId: args.harnessId,
            cwd: args.searchPath,
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
}

export async function runProcsEditorRecommendations(args: {
    canUseLocalAssist: boolean
    currentToml: string
    harnessId: HarnessId
    searchPath: string
}): Promise<ProcsRecommendations> {
    if (!args.canUseLocalAssist) throw new Error(LOCAL_ASSIST_UNAVAILABLE_MESSAGE)

    return runStructuredHarnessQuery({
        prompt: `Analyze this repository and suggest practical openade processes and cron jobs.\n\nCurrent config:\n${args.currentToml || "(empty)"}`,
        options: {
            harnessId: args.harnessId,
            cwd: args.searchPath,
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
}

export const ProcsEditorModal = NiceModal.create(
    observer(
        ({
            workspaceId,
            searchPath,
            context,
            initialFilePath,
            initialTab = "processes",
            productScope = null,
            productAccess = null,
            onSaved,
        }: ProcsEditorModalProps) => {
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
            const productRuntimeOwnsProjectConfig = codeStore.shouldUseRuntimeProductTaskRoute()
            const canSaveProductFile = productScope
                ? codeStore.canUseProductMethod(OPENADE_METHOD.projectFileWrite)
                : !productRuntimeOwnsProjectConfig
            const canUseLocalAssist = canUseLocalProcsEditorAssist({ productRuntimeOwnsProjectConfig })
            const visibleTabs = useMemo(() => TAB_CONFIG.filter((tab) => tab.id !== "suggestions" || canUseLocalAssist), [canUseLocalAssist])

            const loadFile = useCallback(
                async (filePath: string, discoveredRepoRoot = repoRoot) => {
                    setLoadingFile(true)
                    setError(null)
                    try {
                        const editable = await loadProcsEditorFile({
                            codeStore,
                            filePath,
                            repoRoot: discoveredRepoRoot,
                            searchPath,
                            productScope,
                            productRuntimeOwnsProjectConfig,
                        })
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
                [codeStore, repoRoot, searchPath, productScope, productRuntimeOwnsProjectConfig]
            )

            useEffect(() => {
                let cancelled = false

                async function discover(): Promise<void> {
                    setDiscovering(true)
                    setError(null)
                    try {
                        const result = await readProcsEditorConfigs({ codeStore, searchPath, productScope, productRuntimeOwnsProjectConfig })
                        if (cancelled) return

                        const options = toFileOptions(result)
                        setDiscoverResult(result)
                        setConfigOptions(options)

                        if (initialFilePath) {
                            await loadFile(initialFilePath, result.repoRoot)
                            return
                        }

                        if (options.length === 1) {
                            await loadFile(options[0].filePath, result.repoRoot)
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
            }, [codeStore, searchPath, productScope, productRuntimeOwnsProjectConfig, initialFilePath, loadFile])

            const selectedOption = useMemo(
                () => configOptions.find((option) => option.filePath === selectedFilePath) ?? null,
                [configOptions, selectedFilePath]
            )

            const sidebarNodes = useMemo(() => {
                const nodes = new Map<string, SidebarFileNode>()

                for (const config of discoverResult?.configs ?? []) {
                    const nextRelativePath = normalizeRelativePath(config.relativePath)
                    const filePath = joinFsPath(repoRoot, nextRelativePath)
                    nodes.set(filePath, {
                        filePath,
                        relativePath: nextRelativePath,
                        processes: config.processes.map((process, index) => getDraftLabel(process.name, "process", index)),
                        crons: config.crons.map((cron, index) => getDraftLabel(cron.name, "cron", index)),
                    })
                }

                if (selectedFilePath) {
                    nodes.set(selectedFilePath, {
                        filePath: selectedFilePath,
                        relativePath: normalizeRelativePath(relativePath),
                        processes: processes.map((process, index) => getDraftLabel(process.name, "process", index)),
                        crons: crons.map((cron, index) => getDraftLabel(cron.name, "cron", index)),
                    })
                }

                return Array.from(nodes.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath))
            }, [crons, discoverResult?.configs, processes, relativePath, repoRoot, selectedFilePath])

            const handleSelectFile = useCallback(
                async (filePath: string) => {
                    if (!filePath) {
                        setSelectedFilePath(null)
                        return
                    }

                    if (filePath === selectedFilePath) return
                    await loadFile(filePath)
                },
                [loadFile, selectedFilePath]
            )

            const parseRawAndApply = useCallback(async (): Promise<boolean> => {
                setRawError(null)
                try {
                    const parsed = await parseProcsEditorRaw({ rawContent, relativePath, productScope })
                    setProcesses(parsed.processes)
                    setCrons(parsed.crons)
                    setRawMode("preview")
                    return true
                } catch (err) {
                    setRawError(err instanceof Error ? err.message : "Invalid TOML")
                    return false
                }
            }, [rawContent, relativePath, productScope])

            const switchTab = useCallback(
                async (nextTab: EditorTab) => {
                    if (nextTab === activeTab) return
                    if (nextTab === "suggestions" && !canUseLocalAssist) return

                    if (activeTab === "raw" && rawMode === "edit") {
                        const ok = await parseRawAndApply()
                        if (!ok) return
                    }

                    if (nextTab === "raw") {
                        try {
                            const serialized = await serializeProcsEditorRaw({ processes, crons, productScope })
                            setRawContent(serialized)
                            setRawMode("preview")
                            setRawError(null)
                        } catch (err) {
                            setRawError(err instanceof Error ? err.message : "Failed to build TOML preview")
                        }
                    }

                    setActiveTab(nextTab)
                },
                [activeTab, rawMode, parseRawAndApply, processes, crons, productScope, canUseLocalAssist]
            )

            useEffect(() => {
                if (activeTab === "suggestions" && !canUseLocalAssist) setActiveTab("processes")
            }, [activeTab, canUseLocalAssist])

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

            const handleSelectSidebarTab = useCallback(
                async (filePath: string, nextTab: Extract<EditorTab, "processes" | "crons">) => {
                    if (filePath !== selectedFilePath) {
                        await loadFile(filePath)
                        setActiveTab(nextTab)
                        return
                    }

                    await switchTab(nextTab)
                },
                [loadFile, selectedFilePath, switchTab]
            )

            const handleSave = useCallback(async () => {
                if (!selectedFilePath) {
                    setError("Choose a config file first")
                    return
                }
                if (!canSaveProductFile) {
                    setError("Project file writes are not available from this runtime")
                    return
                }

                setSaving(true)
                setError(null)

                try {
                    let nextProcesses = processes
                    let nextCrons = crons

                    if (activeTab === "raw" && rawMode === "edit") {
                        const parsed = await parseProcsEditorRaw({ rawContent, relativePath, productScope })
                        nextProcesses = parsed.processes
                        nextCrons = parsed.crons
                        setProcesses(parsed.processes)
                        setCrons(parsed.crons)
                    }

                    const nextErrors = validateDraft(nextProcesses, nextCrons)
                    if (nextErrors.length > 0) {
                        throw new Error(nextErrors[0])
                    }

                    const nextReadResult = await saveProcsEditorFile({
                        codeStore,
                        selectedFilePath,
                        relativePath,
                        processes: nextProcesses,
                        crons: nextCrons,
                        searchPath,
                        productScope,
                        productRuntimeOwnsProjectConfig,
                    })

                    if (nextReadResult) {
                        codeStore.crons.updateCronDefs(workspaceId, nextReadResult)

                        if (context) {
                            const validProcessIds = new Set<string>()
                            for (const config of nextReadResult.configs) {
                                for (const process of config.processes) {
                                    validProcessIds.add(process.id)
                                }
                            }
                            await codeStore.repoProcesses.stopProcessesMissingFromConfig({
                                context,
                                validProcessIds,
                                productAccess,
                            })
                        }

                        await onSaved?.(nextReadResult)
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
                codeStore,
                workspaceId,
                context,
                productScope,
                productAccess,
                canSaveProductFile,
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
                        const response = await runProcsEditorCronAssist({
                            canUseLocalAssist,
                            schedule: current.schedule,
                            harnessId: codeStore.defaultHarnessId,
                            searchPath,
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
                [crons, canUseLocalAssist, codeStore.defaultHarnessId, searchPath]
            )

            const runRecommendations = useCallback(async () => {
                setRecommendationsLoading(true)
                setRecommendationsError(null)
                try {
                    const currentToml = await serializeProcsEditorRaw({ processes, crons, productScope })
                    const response = await runProcsEditorRecommendations({
                        canUseLocalAssist,
                        currentToml,
                        harnessId: codeStore.defaultHarnessId,
                        searchPath,
                    })

                    setRecommendations(response)
                } catch (err) {
                    setRecommendationsError(err instanceof Error ? err.message : "Failed to scan repository")
                } finally {
                    setRecommendationsLoading(false)
                }
            }, [processes, crons, productScope, canUseLocalAssist, codeStore.defaultHarnessId, searchPath])

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
                            disabled={saving || loadingFile || discovering || !selectedFilePath || validationErrors.length > 0 || !canSaveProductFile}
                        >
                            {saving ? "Saving..." : "Save"}
                        </button>
                    </div>
                </div>
            )

            const emptyProcess: ProcessInput = { name: "", type: "daemon", command: "" }
            const emptyCron: CronInput = { name: "", schedule: "", type: "plan", prompt: "" }

            return (
                <Modal title="Edit Config" footer={footer} size="xl">
                    <div className="flex flex-col gap-4">
                        {error && (
                            <div className="px-3 py-2 text-xs bg-error/10 border border-error/20 text-error flex items-center gap-2">
                                <AlertTriangle size={13} />
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="md:hidden flex items-end gap-2">
                            <div className="flex-1">
                                <label htmlFor="procs-editor-config-file" className="block text-[11px] text-muted mb-1">
                                    Config file
                                </label>
                                <select
                                    id="procs-editor-config-file"
                                    className="w-full h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                    value={selectedFilePath ?? ""}
                                    onChange={(e) => void handleSelectFile(e.target.value)}
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

                        <div className="grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] gap-4 min-h-[520px]">
                            <aside className="hidden md:flex md:flex-col gap-3 pr-4 border-r border-border">
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        <div className="text-[11px] uppercase tracking-wide text-muted">Config files</div>
                                        <div className="text-xs text-muted">Select a file, then jump into processes or crons.</div>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn h-8 px-2 text-xs bg-base-200 hover:bg-base-300 text-base-content border border-border"
                                        onClick={() => setShowNewFileForm((prev) => !prev)}
                                    >
                                        New
                                    </button>
                                </div>

                                {showNewFileForm && (
                                    <div className="flex flex-col gap-2 p-3 bg-base-200/40 border border-border">
                                        <input
                                            type="text"
                                            value={newFileDir}
                                            onChange={(e) => setNewFileDir(e.target.value)}
                                            placeholder="Subdirectory, e.g. projects/api"
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

                                <div className="flex flex-col gap-2 min-h-0 overflow-y-auto">
                                    {sidebarNodes.length === 0 ? (
                                        <div className="text-xs text-muted p-3 border border-dashed border-border">No openade.toml files found yet.</div>
                                    ) : (
                                        sidebarNodes.map((node) => {
                                            const fileSelected = node.filePath === selectedFilePath
                                            const activeSection = fileSelected && (activeTab === "processes" || activeTab === "crons") ? activeTab : null

                                            return (
                                                <div
                                                    key={node.filePath}
                                                    className={cx(
                                                        "border transition-colors",
                                                        fileSelected ? "border-primary/30 bg-primary/5" : "border-border bg-base-200/10"
                                                    )}
                                                >
                                                    <button
                                                        type="button"
                                                        className={cx(
                                                            "btn w-full px-3 py-2 text-left flex items-center gap-2 border-b transition-colors",
                                                            fileSelected
                                                                ? "border-primary/20 text-base-content"
                                                                : "border-border text-muted hover:text-base-content hover:bg-base-200/40"
                                                        )}
                                                        onClick={() => void handleSelectFile(node.filePath)}
                                                    >
                                                        <FileText size={13} />
                                                        <span className="min-w-0 truncate text-sm">{node.relativePath}</span>
                                                    </button>

                                                    <div className="px-2 py-2 flex flex-col gap-1">
                                                        <button
                                                            type="button"
                                                            className={cx(
                                                                "btn w-full px-2 py-1.5 flex items-center justify-between text-xs transition-colors",
                                                                activeSection === "processes"
                                                                    ? "bg-primary/15 text-primary"
                                                                    : "text-muted hover:text-base-content hover:bg-base-200"
                                                            )}
                                                            onClick={() => void handleSelectSidebarTab(node.filePath, "processes")}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <Server size={12} />
                                                                <span>Processes</span>
                                                            </span>
                                                            <span>{node.processes.length}</span>
                                                        </button>
                                                        {node.processes.length > 0 && (
                                                            <div className="flex flex-col gap-0.5 pl-5">
                                                                {node.processes.map((processName, index) => (
                                                                    <button
                                                                        key={`${node.filePath}-process-${index}`}
                                                                        type="button"
                                                                        className="btn w-full px-2 py-1 text-left text-xs text-muted hover:text-base-content hover:bg-base-200/60 transition-colors truncate"
                                                                        onClick={() => void handleSelectSidebarTab(node.filePath, "processes")}
                                                                        title={processName}
                                                                    >
                                                                        {processName}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}

                                                        <button
                                                            type="button"
                                                            className={cx(
                                                                "btn w-full px-2 py-1.5 flex items-center justify-between text-xs transition-colors",
                                                                activeSection === "crons"
                                                                    ? "bg-primary/15 text-primary"
                                                                    : "text-muted hover:text-base-content hover:bg-base-200"
                                                            )}
                                                            onClick={() => void handleSelectSidebarTab(node.filePath, "crons")}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <Clock3 size={12} />
                                                                <span>Crons</span>
                                                            </span>
                                                            <span>{node.crons.length}</span>
                                                        </button>
                                                        {node.crons.length > 0 && (
                                                            <div className="flex flex-col gap-0.5 pl-5">
                                                                {node.crons.map((cronName, index) => (
                                                                    <button
                                                                        key={`${node.filePath}-cron-${index}`}
                                                                        type="button"
                                                                        className="btn w-full px-2 py-1 text-left text-xs text-muted hover:text-base-content hover:bg-base-200/60 transition-colors truncate"
                                                                        onClick={() => void handleSelectSidebarTab(node.filePath, "crons")}
                                                                        title={cronName}
                                                                    >
                                                                        {cronName}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </aside>

                            <div className="flex flex-col gap-4 min-w-0">
                                {showNewFileForm && (
                                    <div className="md:hidden grid grid-cols-1 gap-2 p-3 bg-base-200/40 border border-border">
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

                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-[11px] uppercase tracking-wide text-muted">Editing</div>
                                        <div className="text-sm text-base-content truncate">{selectedFilePath ? relativePath : "Choose a config file"}</div>
                                    </div>
                                    {selectedFilePath && (
                                        <div className="hidden md:flex items-center gap-2 text-[11px] text-muted">
                                            <FileText size={12} />
                                            <span>{relativePath}</span>
                                        </div>
                                    )}
                                </div>

                                {hasMultipleConfigs && !selectedFilePath && (
                                    <div className="px-3 py-2 text-xs bg-warning/10 border border-warning/20 text-warning">
                                        Select a target config file before editing.
                                    </div>
                                )}

                                <div className="flex items-center gap-1 border-b border-border pb-2 flex-wrap">
                                    {visibleTabs.map((tab) => (
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
                                                            onChange={(e) =>
                                                                setProcesses((prev) => prev.map((p, i) => (i === index ? { ...p, name: e.target.value } : p)))
                                                            }
                                                            placeholder="Name"
                                                            className="md:col-span-3 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                                        />
                                                        <select
                                                            value={process.type}
                                                            onChange={(e) =>
                                                                setProcesses((prev) =>
                                                                    prev.map((p, i) =>
                                                                        i === index ? { ...p, type: e.target.value as ProcessInput["type"] } : p
                                                                    )
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
                                                                setProcesses((prev) =>
                                                                    prev.map((p, i) => (i === index ? { ...p, command: e.target.value } : p))
                                                                )
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
                                                                setProcesses((prev) =>
                                                                    prev.map((p, i) => (i === index ? { ...p, url: e.target.value || undefined } : p))
                                                                )
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
                                                    <div
                                                        key={`cron-${index}`}
                                                        className="grid grid-cols-1 md:grid-cols-12 gap-2 p-3 border border-border bg-base-200/20"
                                                    >
                                                        <div className="md:col-span-12 text-[11px] text-muted">Cron {index + 1}</div>
                                                        <input
                                                            value={cron.name}
                                                            onChange={(e) =>
                                                                setCrons((prev) => prev.map((c, i) => (i === index ? { ...c, name: e.target.value } : c)))
                                                            }
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
                                                                    setCrons((prev) =>
                                                                        prev.map((c, i) => (i === index ? { ...c, schedule: e.target.value } : c))
                                                                    )
                                                                }
                                                                placeholder="Cron schedule or natural language"
                                                                className="flex-1 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                                            />
                                                            <button
                                                                type="button"
                                                                className="btn h-9 w-9 text-muted hover:text-primary hover:bg-primary/10"
                                                                onClick={() => void runCronAssist(index)}
                                                                title={canUseLocalAssist ? "Generate schedule" : LOCAL_ASSIST_UNAVAILABLE_MESSAGE}
                                                                disabled={!canUseLocalAssist || cronAssistLoadingIndex === index}
                                                            >
                                                                {cronAssistLoadingIndex === index ? (
                                                                    <Loader2 size={13} className="animate-spin" />
                                                                ) : (
                                                                    <Wand2 size={13} />
                                                                )}
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
                                                            onChange={(e) =>
                                                                setCrons((prev) => prev.map((c, i) => (i === index ? { ...c, prompt: e.target.value } : c)))
                                                            }
                                                            placeholder="Prompt"
                                                            rows={3}
                                                            className="md:col-span-12 px-2 py-1.5 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary resize-y"
                                                        />
                                                        <input
                                                            value={cron.appendSystemPrompt ?? ""}
                                                            onChange={(e) =>
                                                                setCrons((prev) =>
                                                                    prev.map((c, i) =>
                                                                        i === index ? { ...c, appendSystemPrompt: e.target.value || undefined } : c
                                                                    )
                                                                )
                                                            }
                                                            placeholder="appendSystemPrompt (optional)"
                                                            className="md:col-span-6 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                                        />
                                                        <input
                                                            value={cron.harness ?? ""}
                                                            onChange={(e) =>
                                                                setCrons((prev) =>
                                                                    prev.map((c, i) => (i === index ? { ...c, harness: e.target.value || undefined } : c))
                                                                )
                                                            }
                                                            placeholder="harness (optional)"
                                                            className="md:col-span-3 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                                        />
                                                        <select
                                                            value={cron.isolation ?? ""}
                                                            onChange={(e) =>
                                                                setCrons((prev) =>
                                                                    prev.map((c, i) =>
                                                                        i === index
                                                                            ? { ...c, isolation: (e.target.value || undefined) as CronInput["isolation"] }
                                                                            : c
                                                                    )
                                                                )
                                                            }
                                                            className="md:col-span-3 h-9 px-2 bg-input text-base-content border border-border text-sm focus:outline-none focus:border-primary"
                                                        >
                                                            <option value="">isolation (default)</option>
                                                            <option value="head">head</option>
                                                            <option value="worktree">worktree</option>
                                                        </select>
                                                        <label className="md:col-span-12 h-9 flex items-center gap-2 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={cron.reuseTask ?? true}
                                                                onChange={(e) =>
                                                                    setCrons((prev) =>
                                                                        prev.map((c, i) => (i === index ? { ...c, reuseTask: e.target.checked } : c))
                                                                    )
                                                                }
                                                                className="accent-primary"
                                                            />
                                                            <span className="text-xs text-muted">Reuse the same task thread across runs</span>
                                                        </label>
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
                                                {!recommendations && !recommendationsLoading && (
                                                    <div className="text-xs text-muted">No suggestions loaded yet.</div>
                                                )}

                                                {recommendations && (
                                                    <>
                                                        <div className="text-xs font-medium text-base-content">Processes</div>
                                                        {recommendations.processes.length === 0 && (
                                                            <div className="text-xs text-muted">No process suggestions.</div>
                                                        )}
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
                        </div>
                    </div>
                </Modal>
            )
        }
    )
)
