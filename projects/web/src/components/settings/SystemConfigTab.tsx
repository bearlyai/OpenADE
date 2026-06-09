/**
 * SystemConfigTab
 *
 * System configuration settings tab showing binary status and environment variables.
 */

import { AlertTriangle, CheckCircle, Database, Eye, EyeOff, FolderOpen, Loader2, Minus, Plus, RefreshCw, RotateCcw, XCircle } from "lucide-react"
import { observer } from "mobx-react"
import { useCallback, useEffect, useState } from "react"
import type { OpenADECoreRolloutState } from "../../../../electron/src/preload-api"
import type { OpenADELegacyResourcesImportResult } from "../../../../openade-module/src"
import { type ManagedBinaryStatus, ensureBinary, getStatuses } from "../../electronAPI/binaries"
import { type HarnessStatusMap, getHarnessStatuses, isHarnessStatusApiAvailable } from "../../electronAPI/harnessStatus"
import { selectDirectory } from "../../electronAPI/shell"
import { isSystemApiAvailable } from "../../electronAPI/system"
import { isCoreLegacyResourceImportClean, isCoreLegacyYjsImportClean, shouldAcceptCoreLegacyYjsMigration } from "../../runtime/coreMigration"
import { resolveCoreRolloutState, resolveCoreRuntimeEndpoint } from "../../runtime/localProductRuntimeClient"
import type { CodeStore } from "../../store/store"
import { formatCoreLegacyResourceImportResult, importCoreLegacyResourcesFromSelection } from "./coreResourceMigration"
import { type CoreLegacyYjsImportReport, formatCoreLegacyYjsImportResult, importCoreLegacyYjsDataFromLocalStore } from "./coreYjsMigration"
import { getHarnessAuthTypeLabel, getHarnessDisplayName, toHarnessStatusView } from "./harnessStatusUtils"

interface KeyValuePair {
    key: string
    value: string
}

function envVarPairsFromRecord(envVars: Record<string, string>): KeyValuePair[] {
    return Object.entries(envVars).map(([key, value]) => ({ key, value }))
}

const KeyValueEditor = ({
    pairs,
    onChange,
    keyPlaceholder = "Key",
    valuePlaceholder = "Value",
    secretMode = false,
}: {
    pairs: KeyValuePair[]
    onChange: (pairs: KeyValuePair[]) => void
    keyPlaceholder?: string
    valuePlaceholder?: string
    secretMode?: boolean
}) => {
    const [revealedIndices, setRevealedIndices] = useState<Set<number>>(new Set())

    const toggleReveal = (index: number) => {
        const newRevealed = new Set(revealedIndices)
        if (newRevealed.has(index)) {
            newRevealed.delete(index)
        } else {
            newRevealed.add(index)
        }
        setRevealedIndices(newRevealed)
    }

    const addPair = () => {
        onChange([...pairs, { key: "", value: "" }])
    }

    const removePair = (index: number) => {
        onChange(pairs.filter((_, i) => i !== index))
    }

    const updatePair = (index: number, field: "key" | "value", value: string) => {
        const newPairs = [...pairs]
        newPairs[index] = { ...newPairs[index], [field]: value }
        onChange(newPairs)
    }

    return (
        <div className="flex flex-col gap-2">
            {pairs.map((pair, index) => (
                <div key={index} className="flex items-center gap-2">
                    <input
                        type="text"
                        placeholder={keyPlaceholder}
                        value={pair.key}
                        onChange={(e) => updatePair(index, "key", e.target.value)}
                        className="input flex-1 bg-base-200 border border-border p-2 px-3 text-sm font-mono rounded-none"
                    />
                    <div className="relative flex-1">
                        <input
                            type={secretMode && !revealedIndices.has(index) ? "password" : "text"}
                            placeholder={valuePlaceholder}
                            value={pair.value}
                            onChange={(e) => updatePair(index, "value", e.target.value)}
                            className="input w-full bg-base-200 border border-border p-2 px-3 pr-10 text-sm font-mono rounded-none"
                        />
                        {secretMode && pair.value && (
                            <button
                                type="button"
                                onClick={() => toggleReveal(index)}
                                className="btn absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center bg-transparent text-muted hover:text-base-content"
                            >
                                {revealedIndices.has(index) ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => removePair(index)}
                        className="btn w-8 h-8 flex items-center justify-center bg-error/10 hover:bg-error text-error hover:text-error-content transition-colors"
                    >
                        <Minus size={14} />
                    </button>
                </div>
            ))}
            <button
                type="button"
                onClick={addPair}
                className="btn flex items-center justify-center gap-2 p-2 bg-base-200 hover:bg-base-300 text-muted hover:text-base-content transition-colors text-sm border border-dashed border-border"
            >
                <Plus size={14} />
                Add Variable
            </button>
        </div>
    )
}

const HarnessStatusSection = () => {
    const [statuses, setStatuses] = useState<HarnessStatusMap>({})
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const refresh = useCallback(async () => {
        setIsLoading(true)
        try {
            const result = await getHarnessStatuses()
            setStatuses(result.statuses)
            setError(result.error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        if (!isHarnessStatusApiAvailable()) {
            setIsLoading(false)
            return
        }

        refresh()
    }, [refresh])

    if (!isSystemApiAvailable()) return null

    const entries = Object.entries(statuses).sort((a, b) => getHarnessDisplayName(a[0]).localeCompare(getHarnessDisplayName(b[0])))

    return (
        <section>
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold text-base-content">Harness Status</h3>
                <button
                    type="button"
                    onClick={refresh}
                    disabled={isLoading}
                    className="btn w-8 h-8 flex items-center justify-center bg-transparent hover:bg-base-300 text-muted hover:text-base-content transition-colors disabled:opacity-50"
                    title="Refresh"
                >
                    <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
                </button>
            </div>
            <p className="text-sm text-muted mb-4">Install and authentication status for each configured harness CLI.</p>

            {isLoading && entries.length === 0 && (
                <div className="flex items-center gap-2 p-3 text-sm text-muted">
                    <Loader2 size={16} className="animate-spin" />
                    Loading...
                </div>
            )}

            {error && <div className="p-3 border border-warning/30 bg-warning/10 text-sm text-warning">{error}</div>}

            {!isLoading && entries.length === 0 && !error && (
                <div className="p-3 border border-border bg-base-200/40 text-sm text-muted">No harnesses registered.</div>
            )}

            {entries.length > 0 && (
                <div className="flex flex-col gap-2">
                    {entries.map(([harnessId, status]) => {
                        const view = toHarnessStatusView(status)
                        const toneClass =
                            view.tone === "success"
                                ? "bg-success/15 text-success border-success/30"
                                : view.tone === "warning"
                                  ? "bg-warning/15 text-warning border-warning/30"
                                  : "bg-error/15 text-error border-error/30"
                        const StatusIcon = view.tone === "success" ? CheckCircle : view.tone === "warning" ? AlertTriangle : XCircle

                        return (
                            <div key={harnessId} className="p-3 bg-base-200/40 border border-border">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-base-content">{getHarnessDisplayName(harnessId)}</p>
                                        <p className="text-xs text-muted mt-1">{view.subtitle}</p>
                                    </div>
                                    <div className={`px-2 py-1 border text-xs font-medium shrink-0 flex items-center gap-1.5 ${toneClass}`}>
                                        <StatusIcon size={12} />
                                        <span>{view.label}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 mt-2 text-xs text-muted">
                                    <span className="px-1.5 py-0.5 border border-border bg-base-100 font-mono">{status.version ?? "version unknown"}</span>
                                    <span className="px-1.5 py-0.5 border border-border bg-base-100">{getHarnessAuthTypeLabel(status.authType)}</span>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </section>
    )
}

const ManagedBinaryRow = ({ binary, onRefresh }: { binary: ManagedBinaryStatus; onRefresh: () => void }) => {
    const [isVerifying, setIsVerifying] = useState(false)

    const handleVerify = async () => {
        setIsVerifying(true)
        try {
            await ensureBinary(binary.name)
            onRefresh()
        } finally {
            setIsVerifying(false)
        }
    }

    const getStatusIcon = () => {
        if (isVerifying || binary.status === "downloading") {
            return <Loader2 size={16} className="text-muted animate-spin" />
        }
        if (binary.status === "available") {
            return <CheckCircle size={16} className="text-success" />
        }
        if (binary.status === "error") {
            return <XCircle size={16} className="text-error" />
        }
        return <Loader2 size={16} className="text-muted animate-spin" />
    }

    const getStatusText = () => {
        if (isVerifying) return "Verifying..."
        if (binary.status === "downloading") return "Downloading..."
        if (binary.status === "available") return binary.path
        if (binary.status === "error") return binary.error
        return "Installing..."
    }

    return (
        <div className="flex items-center justify-between p-3 bg-base-200 border border-border min-w-0">
            <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="shrink-0">{getStatusIcon()}</div>
                <div className="min-w-0">
                    <p className="text-sm font-medium text-base-content">
                        {binary.displayName} <span className="text-muted font-normal">v{binary.version}</span>
                    </p>
                    <p
                        className={`text-xs mt-1 font-mono truncate ${binary.status === "error" ? "text-error" : "text-muted"}`}
                        title={getStatusText() ?? undefined}
                    >
                        {getStatusText()}
                    </p>
                </div>
            </div>
            <button
                type="button"
                onClick={handleVerify}
                disabled={isVerifying || binary.status === "downloading"}
                className="btn w-8 h-8 shrink-0 flex items-center justify-center bg-transparent hover:bg-base-300 text-muted hover:text-base-content transition-colors disabled:opacity-50"
                title="Re-verify / re-download"
            >
                <RotateCcw size={14} className={isVerifying ? "animate-spin" : ""} />
            </button>
        </div>
    )
}

const ManagedBinariesSection = () => {
    const [statuses, setStatuses] = useState<ManagedBinaryStatus[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const refresh = useCallback(async () => {
        setIsLoading(true)
        try {
            const result = await getStatuses()
            setStatuses(result)
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        if (!isSystemApiAvailable()) {
            setIsLoading(false)
            return
        }

        refresh()

        // Poll while any binary is still downloading/installing
        const interval = setInterval(async () => {
            const result = await getStatuses()
            setStatuses(result)
            const allSettled = result.every((s) => s.status === "available" || s.status === "error")
            if (allSettled) clearInterval(interval)
        }, 2000)

        return () => clearInterval(interval)
    }, [refresh])

    if (!isSystemApiAvailable()) return null

    return (
        <section>
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold text-base-content">Managed Runtimes</h3>
                <button
                    type="button"
                    onClick={refresh}
                    disabled={isLoading}
                    className="btn w-8 h-8 flex items-center justify-center bg-transparent hover:bg-base-300 text-muted hover:text-base-content transition-colors disabled:opacity-50"
                    title="Refresh"
                >
                    <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
                </button>
            </div>
            <p className="text-sm text-muted mb-4">Runtimes downloaded and managed by the app. Available to Claude and all subprocesses.</p>
            {isLoading && statuses.length === 0 ? (
                <div className="flex items-center gap-2 p-3 text-sm text-muted">
                    <Loader2 size={16} className="animate-spin" />
                    Loading...
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {statuses.map((binary) => (
                        <ManagedBinaryRow key={binary.name} binary={binary} onRefresh={refresh} />
                    ))}
                </div>
            )}
        </section>
    )
}

function coreRolloutStatusText(state: OpenADECoreRolloutState | null, hasCoreRuntimeEndpoint: boolean): string {
    if (hasCoreRuntimeEndpoint) {
        if (state?.source === "external") return "OpenADE Core is connected through an external endpoint."
        if (state?.reason === "legacy-yjs-migration-accepted") return "OpenADE Core is connected after accepted legacy Yjs import."
        if (state?.automatic) return "OpenADE Core is connected for this clean install."
        return "OpenADE Core is connected."
    }

    switch (state?.reason) {
        case "legacy-yjs-documents":
            return "Legacy Yjs data detected; Core is waiting for migration."
        case "disabled":
            return "OpenADE Core is disabled by environment."
        case "development-default-off":
            return "Development launch is using the legacy IPC backend."
        case "missing-core-binary":
            return "OpenADE Core binary was not found."
        case "invalid-managed-command":
            return "Managed OpenADE Core command is invalid."
        default:
            return "OpenADE Core is not connected."
    }
}

function coreRolloutTone(state: OpenADECoreRolloutState | null, hasCoreRuntimeEndpoint: boolean): "success" | "warning" | "muted" {
    if (hasCoreRuntimeEndpoint) return "success"
    if (state?.reason === "legacy-yjs-documents" || state?.reason === "disabled" || state?.reason === "invalid-managed-command") return "warning"
    return "muted"
}

interface SystemConfigTabProps {
    store: CodeStore
}

export const SystemConfigTab = observer(({ store }: SystemConfigTabProps) => {
    const personalSettings = store.personalSettingsStore
    const currentEnvVars = personalSettings?.settings.current.envVars ?? {}
    const hasCoreRuntimeEndpoint = resolveCoreRuntimeEndpoint() !== null
    const coreRolloutState = resolveCoreRolloutState()
    const coreTone = coreRolloutTone(coreRolloutState, hasCoreRuntimeEndpoint)
    const coreStatusIconClass = coreTone === "success" ? "text-success mt-0.5" : coreTone === "warning" ? "text-warning mt-0.5" : "text-muted mt-0.5"

    // Convert Record to array of pairs for editing
    const [envVarPairs, setEnvVarPairs] = useState<KeyValuePair[]>(() => envVarPairsFromRecord(currentEnvVars))
    const [hasChanges, setHasChanges] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [isImportingLegacyYjs, setIsImportingLegacyYjs] = useState(false)
    const [legacyYjsImportMessage, setLegacyYjsImportMessage] = useState<string | null>(null)
    const [legacyYjsImportError, setLegacyYjsImportError] = useState<string | null>(null)
    const [lastCleanLegacyYjsReport, setLastCleanLegacyYjsReport] = useState<CoreLegacyYjsImportReport | null>(null)
    const [importSessions, setImportSessions] = useState(true)
    const [isImportingLegacyResources, setIsImportingLegacyResources] = useState(false)
    const [legacyResourceImportMessage, setLegacyResourceImportMessage] = useState<string | null>(null)
    const [legacyResourceImportError, setLegacyResourceImportError] = useState<string | null>(null)
    const [lastCleanLegacyResourcesResult, setLastCleanLegacyResourcesResult] = useState<OpenADELegacyResourcesImportResult | null>(null)

    // Update local state when store changes externally
    useEffect(() => {
        const storeEnvVars = personalSettings?.settings.current.envVars ?? {}
        setEnvVarPairs(envVarPairsFromRecord(storeEnvVars))
        setHasChanges(false)
    }, [personalSettings?.settings.current.envVars])

    const handleEnvVarsChange = (pairs: KeyValuePair[]) => {
        setEnvVarPairs(pairs)
        setHasChanges(true)
    }

    const handleSave = () => {
        if (!personalSettings) return

        setIsSaving(true)
        try {
            // Convert pairs back to Record, filtering out empty keys
            const envVarsObj = envVarPairs.reduce(
                (acc, { key, value }) => {
                    if (key.trim()) {
                        acc[key.trim()] = value
                    }
                    return acc
                },
                {} as Record<string, string>
            )

            personalSettings.settings.set({ envVars: envVarsObj })
            setHasChanges(false)
        } finally {
            setIsSaving(false)
        }
    }

    const handleReset = () => {
        const storeEnvVars = personalSettings?.settings.current.envVars ?? {}
        setEnvVarPairs(envVarPairsFromRecord(storeEnvVars))
        setHasChanges(false)
    }

    const handleImportLegacyYjsData = async () => {
        if (!hasCoreRuntimeEndpoint || isImportingLegacyYjs) return
        setIsImportingLegacyYjs(true)
        setLegacyYjsImportMessage(null)
        setLegacyYjsImportError(null)
        try {
            const result = await importCoreLegacyYjsDataFromLocalStore(store)
            const cleanYjsReport = isCoreLegacyYjsImportClean(result) ? result : null
            const cleanResourcesResult = lastCleanLegacyResourcesResult
            let accepted = false
            if (cleanYjsReport && cleanResourcesResult && shouldAcceptCoreLegacyYjsMigration(cleanYjsReport, cleanResourcesResult)) {
                await store.markProductLegacyYjsMigrationAccepted()
                accepted = true
                setLegacyResourceImportMessage(
                    `${formatCoreLegacyResourceImportResult(cleanResourcesResult)}; Core launch accepted after clean data and resources import`
                )
            }
            setLastCleanLegacyYjsReport(cleanYjsReport)
            const acceptedReport = { ...result, legacyYjsMigrationAccepted: accepted }
            const messageParts = [formatCoreLegacyYjsImportResult(acceptedReport)]
            if (!accepted && cleanYjsReport) messageParts.push("import legacy resources to accept Core launch")
            setLegacyYjsImportMessage(messageParts.join("; "))
        } catch (err) {
            const message = err instanceof Error ? err.message : "Legacy data import failed"
            setLegacyYjsImportError(message)
            console.error("[SystemConfigTab] Failed to import legacy Yjs data into Core:", err)
        } finally {
            setIsImportingLegacyYjs(false)
        }
    }

    const handleImportLegacyResources = async () => {
        if (!hasCoreRuntimeEndpoint || isImportingLegacyResources) return
        setIsImportingLegacyResources(true)
        setLegacyResourceImportMessage(null)
        setLegacyResourceImportError(null)
        try {
            const result = await importCoreLegacyResourcesFromSelection({
                store,
                selectDataDir: () => selectDirectory(),
                importSessions,
            })
            if (result) {
                const cleanResources = isCoreLegacyResourceImportClean(result) ? result : null
                const cleanYjsReport = lastCleanLegacyYjsReport
                let accepted = false
                if (cleanYjsReport && cleanResources && shouldAcceptCoreLegacyYjsMigration(cleanYjsReport, cleanResources)) {
                    await store.markProductLegacyYjsMigrationAccepted()
                    accepted = true
                }
                setLastCleanLegacyResourcesResult(cleanResources)
                const messageParts = [formatCoreLegacyResourceImportResult(result)]
                if (accepted && cleanYjsReport) {
                    setLegacyYjsImportMessage(formatCoreLegacyYjsImportResult({ ...cleanYjsReport, legacyYjsMigrationAccepted: true }))
                    messageParts.push("Core launch accepted after clean data and resources import")
                } else if (cleanResources) {
                    messageParts.push("import legacy data to accept Core launch")
                }
                setLegacyResourceImportMessage(messageParts.join("; "))
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : "Legacy resource import failed"
            setLegacyResourceImportError(message)
            console.error("[SystemConfigTab] Failed to import legacy Core resources:", err)
        } finally {
            setIsImportingLegacyResources(false)
        }
    }

    return (
        <div className="flex flex-col gap-8">
            {/* Harnesses Section */}
            <HarnessStatusSection />

            {/* Managed Runtimes Section */}
            <ManagedBinariesSection />

            {/* Core Migration Section */}
            <section>
                <h3 className="text-base font-semibold text-base-content mb-1">Core Migration</h3>
                <p className="text-sm text-muted mb-4">Import local desktop data into the active OpenADE Core store.</p>

                <div className="flex flex-col gap-3 p-3 bg-base-200/40 border border-border">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                            <Database size={16} className={coreStatusIconClass} />
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-base-content">Legacy Data Import</p>
                                <p className="text-xs text-muted mt-1">{coreRolloutStatusText(coreRolloutState, hasCoreRuntimeEndpoint)}</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleImportLegacyYjsData}
                            disabled={!hasCoreRuntimeEndpoint || isImportingLegacyYjs}
                            className="btn px-3 py-1.5 text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {isImportingLegacyYjs ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                            Import
                        </button>
                    </div>
                    {legacyYjsImportMessage && <p className="text-xs text-success">{legacyYjsImportMessage}</p>}
                    {legacyYjsImportError && <p className="text-xs text-error">{legacyYjsImportError}</p>}
                </div>

                <div className="flex flex-col gap-3 p-3 bg-base-200/40 border border-border mt-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                            <FolderOpen size={16} className={coreStatusIconClass} />
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-base-content">Legacy Resource Import</p>
                                <p className="text-xs text-muted mt-1">Import image, snapshot, and session blobs after legacy repo/task rows exist in Core.</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleImportLegacyResources}
                            disabled={!hasCoreRuntimeEndpoint || isImportingLegacyResources}
                            className="btn px-3 py-1.5 text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {isImportingLegacyResources ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                            Import
                        </button>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-base-content">
                        <input
                            type="checkbox"
                            checked={importSessions}
                            onChange={(event) => setImportSessions(event.target.checked)}
                            disabled={isImportingLegacyResources}
                            className="checkbox checkbox-sm bg-base-200 border-border"
                        />
                        Include Claude Code and Codex transcripts
                    </label>
                    {legacyResourceImportMessage && <p className="text-xs text-success">{legacyResourceImportMessage}</p>}
                    {legacyResourceImportError && <p className="text-xs text-error">{legacyResourceImportError}</p>}
                </div>
            </section>

            {/* Environment Variables Section */}
            <section>
                <h3 className="text-base font-semibold text-base-content mb-1">Environment Variables</h3>
                <p className="text-sm text-muted mb-4">
                    Custom environment variables that propagate to all subprocesses, Claude queries, and terminal sessions.
                </p>

                <KeyValueEditor pairs={envVarPairs} onChange={handleEnvVarsChange} keyPlaceholder="VARIABLE_NAME" valuePlaceholder="value" secretMode />

                {/* Save/Reset buttons */}
                {hasChanges && (
                    <div className="flex gap-2 mt-4">
                        <button
                            type="button"
                            onClick={handleReset}
                            disabled={isSaving}
                            className="btn py-2 px-4 bg-base-200 hover:bg-base-300 text-base-content font-medium transition-colors border border-border disabled:opacity-50"
                        >
                            Reset
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={isSaving}
                            className="btn py-2 px-4 bg-primary hover:bg-primary/90 text-primary-content font-medium transition-colors disabled:opacity-50"
                        >
                            {isSaving ? "Saving..." : "Save Changes"}
                        </button>
                    </div>
                )}
            </section>

            {/* Telemetry Section */}
            <section>
                <h3 className="text-base font-semibold text-base-content mb-1">Telemetry</h3>
                <p className="text-sm text-muted mb-4">
                    Help improve the app by sending anonymous usage data. We track feature usage frequency and command types (plan/do/ask) to help us decide
                    what features to prioritize. No code, prompts, file contents, or personal information is ever collected.
                </p>
                <label className="flex items-center gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={!(personalSettings?.settings.current.telemetryDisabled ?? false)}
                        onChange={(e) => personalSettings?.settings.set({ telemetryDisabled: !e.target.checked })}
                        className="checkbox checkbox-sm bg-base-200 border-border"
                    />
                    <span className="text-sm text-base-content">Enable anonymous telemetry</span>
                </label>
            </section>
        </div>
    )
})
