/**
 * SystemConfigTab
 *
 * System configuration settings tab showing binary status and environment variables.
 */

import { CheckCircle, Eye, EyeOff, Loader2, Minus, Plus, RefreshCw, RotateCcw, XCircle } from "lucide-react"
import { observer } from "mobx-react"
import { useEffect, useState } from "react"
import { type ManagedBinaryStatus, ensureBinary, getStatuses } from "../../electronAPI/binaries"
import { isSystemApiAvailable } from "../../electronAPI/system"
import type { CodeStore } from "../../store/store"

interface KeyValuePair {
    key: string
    value: string
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

    const refresh = async () => {
        setIsLoading(true)
        try {
            const result = await getStatuses()
            setStatuses(result)
        } finally {
            setIsLoading(false)
        }
    }

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
    }, [])

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

interface SystemConfigTabProps {
    store: CodeStore
}

export const SystemConfigTab = observer(({ store }: SystemConfigTabProps) => {
    const personalSettings = store.personalSettingsStore
    const currentEnvVars = personalSettings?.settings.current.envVars ?? {}

    // Convert Record to array of pairs for editing
    const [envVarPairs, setEnvVarPairs] = useState<KeyValuePair[]>(Object.entries(currentEnvVars).map(([key, value]) => ({ key, value })))
    const [hasChanges, setHasChanges] = useState(false)
    const [isSaving, setIsSaving] = useState(false)

    // Update local state when store changes externally
    useEffect(() => {
        const storeEnvVars = personalSettings?.settings.current.envVars ?? {}
        setEnvVarPairs(Object.entries(storeEnvVars).map(([key, value]) => ({ key, value })))
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
        setEnvVarPairs(Object.entries(storeEnvVars).map(([key, value]) => ({ key, value })))
        setHasChanges(false)
    }

    return (
        <div className="flex flex-col gap-8">
            {/* Managed Runtimes Section */}
            <ManagedBinariesSection />

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
