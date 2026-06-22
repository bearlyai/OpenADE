import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, CircleAlert, Pencil, Plus, Server, Trash2, X } from "lucide-react"
import { DEFAULT_HARNESS_ID, getDefaultModelForHarness, HARNESS_META, MODEL_REGISTRY } from "../constants"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { getVisibleModelEntries, getVisibleModelId } from "../modelVisibility"
import type { OpenADEMCPServer, OpenADEPersonalSettings, OpenADESnapshot } from "../../../openade-module/src"
import { type OpenADEChromeStatus, openADEStatusToneClass } from "./OpenADEChrome"

export const openADEThemeClasses = {
    "code-theme-light": { label: "Light" },
    "code-theme-bright": { label: "Bright" },
    "code-theme-clean": { label: "Clean" },
    "code-theme-black": { label: "Black" },
    "code-theme-synthwave": { label: "Synthwave" },
    "code-theme-dracula": { label: "Dracula" },
} as const

export type OpenADEThemeClass = keyof typeof openADEThemeClasses
export type OpenADEThemeSetting = "desktop" | OpenADEThemeClass

export interface OpenADESessionConfig {
    id: string
    host: string
    baseUrl: string
}

export interface OpenADESettingsCapabilities {
    personalSettings: {
        canRead: boolean
        canReplace: boolean
    }
    mcpServers: {
        canRead: boolean
        canUpsert: boolean
        canDelete: boolean
    }
    canSelfRevoke: boolean
}

export interface OpenADESettingsProductState {
    capabilities: OpenADESettingsCapabilities
    personalSettings: OpenADEPersonalSettings | null
    personalSettingsLoading: boolean
    personalSettingsActionLoading: boolean
    mcpServers: OpenADEMCPServer[]
    mcpServersLoading: boolean
    mcpServerActionId: string | null
}

interface OpenADEMCPServerDraft {
    id: string
    editingExisting: boolean
    transportType: OpenADEMCPServer["transportType"]
    name: string
    enabled: boolean
    url: string
    command: string
    argsText: string
    cwd: string
    showAdvanced: boolean
    headersText: string
    headersError: string | null
    envVarsText: string
    envVarsError: string | null
}

interface OpenADEEnvVarsDraft {
    value: string
    error: string | null
}

export function isOpenADEThemeSetting(value: string | null): value is OpenADEThemeSetting {
    return value === "desktop" || (value !== null && value in openADEThemeClasses)
}

function isOpenADEProductThemeSetting(value: string): value is OpenADEPersonalSettings["theme"] {
    return value === "system" || value in openADEThemeClasses
}

function productSettingsHarnessId(settings: OpenADEPersonalSettings): HarnessId {
    const harnessIds = Object.keys(MODEL_REGISTRY) as HarnessId[]
    return settings.newTaskHarnessId && harnessIds.includes(settings.newTaskHarnessId as HarnessId)
        ? (settings.newTaskHarnessId as HarnessId)
        : getDefaultHarnessId()
}

function getDefaultHarnessId(): HarnessId {
    const harnessIds = Object.keys(MODEL_REGISTRY) as HarnessId[]
    return harnessIds.includes(DEFAULT_HARNESS_ID) ? DEFAULT_HARNESS_ID : (harnessIds[0] ?? DEFAULT_HARNESS_ID)
}

function productSettingsModelId(settings: OpenADEPersonalSettings, harnessId: HarnessId): string {
    const modelId = settings.newTaskModelId
    const visibleModelId = modelId ? getVisibleModelId(modelId, harnessId) : null
    if (visibleModelId && getVisibleModelEntries(harnessId).some((model) => model.id === visibleModelId)) return visibleModelId
    return getVisibleModelId(getDefaultModelForHarness(harnessId), harnessId)
}

function createMcpDraftId(): string {
    const cryptoValue = globalThis.crypto
    if (cryptoValue?.randomUUID) return `mcp-${cryptoValue.randomUUID()}`
    return `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function stringRecordDraftValue(values: Record<string, string> | undefined): string {
    return JSON.stringify(values ?? {}, null, 2)
}

function parseStringRecordDraft(value: string): Record<string, string> | null {
    const trimmed = value.trim()
    if (!trimmed) return {}
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        return null
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
    const result: Record<string, string> = {}
    for (const [key, rawValue] of Object.entries(parsed)) {
        if (typeof rawValue !== "string") return null
        result[key] = rawValue
    }
    return result
}

function optionalStringRecord(values: Record<string, string>): Record<string, string> | undefined {
    return Object.keys(values).length > 0 ? values : undefined
}

function mcpServerDraftFromServer(server?: OpenADEMCPServer): OpenADEMCPServerDraft {
    if (server) {
        return {
            id: server.id,
            editingExisting: true,
            transportType: server.transportType,
            name: server.name,
            enabled: server.enabled,
            url: server.transportType === "http" ? server.url : "",
            command: server.transportType === "stdio" ? server.command : "",
            argsText: server.transportType === "stdio" ? (server.args ?? []).join(" ") : "",
            cwd: server.transportType === "stdio" ? (server.cwd ?? "") : "",
            showAdvanced: false,
            headersText: server.transportType === "http" ? stringRecordDraftValue(server.headers) : stringRecordDraftValue(undefined),
            headersError: null,
            envVarsText: server.transportType === "stdio" ? stringRecordDraftValue(server.envVars) : stringRecordDraftValue(undefined),
            envVarsError: null,
        }
    }
    return {
        id: createMcpDraftId(),
        editingExisting: false,
        transportType: "http",
        name: "",
        enabled: true,
        url: "",
        command: "",
        argsText: "",
        cwd: "",
        showAdvanced: false,
        headersText: stringRecordDraftValue(undefined),
        headersError: null,
        envVarsText: stringRecordDraftValue(undefined),
        envVarsError: null,
    }
}

function mcpDraftArgs(argsText: string): string[] | undefined {
    const args = argsText
        .split(/\s+/)
        .map((arg) => arg.trim())
        .filter(Boolean)
    return args.length > 0 ? args : undefined
}

function mcpServerDraftIsValid(draft: OpenADEMCPServerDraft): boolean {
    if (!draft.name.trim()) return false
    if (draft.transportType === "http") return Boolean(draft.url.trim())
    return Boolean(draft.command.trim())
}

function mcpServerFromDraft(
    draft: OpenADEMCPServerDraft,
    existing: OpenADEMCPServer | undefined,
    secretFields: { headers?: Record<string, string>; envVars?: Record<string, string> }
): OpenADEMCPServer | null {
    if (!mcpServerDraftIsValid(draft)) return null
    const now = new Date().toISOString()
    const base = {
        id: draft.id,
        name: draft.name.trim(),
        enabled: draft.enabled,
        presetId: existing?.presetId,
        lastTested: existing?.lastTested,
        healthStatus: existing?.healthStatus ?? "unknown",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    }
    if (draft.transportType === "http") {
        return {
            ...base,
            transportType: "http",
            url: draft.url.trim(),
            ...(secretFields.headers && optionalStringRecord(secretFields.headers) ? { headers: secretFields.headers } : {}),
            ...(existing?.transportType === "http" && existing.oauthTokens ? { oauthTokens: existing.oauthTokens } : {}),
        }
    }
    return {
        ...base,
        transportType: "stdio",
        command: draft.command.trim(),
        ...(mcpDraftArgs(draft.argsText) ? { args: mcpDraftArgs(draft.argsText) } : {}),
        ...(secretFields.envVars && optionalStringRecord(secretFields.envVars) ? { envVars: secretFields.envVars } : {}),
        ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
    }
}

export function OpenADESessionsScreen({
    configs,
    activeConfigId,
    onSelect,
    onRemove,
    onAdd,
}: {
    configs: OpenADESessionConfig[]
    activeConfigId: string
    onSelect: (configId: string) => void
    onRemove: (configId: string) => void
    onAdd: () => void
}) {
    return (
        <div className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-3">
            <div className="flex w-full max-w-full flex-col gap-2 overflow-hidden">
                {configs.map((config) => (
                    <div
                        key={config.id}
                        className={`flex min-w-0 items-center gap-2 overflow-hidden border p-2 ${config.id === activeConfigId ? "border-primary bg-primary/10" : "border-border bg-base-200/40"}`}
                    >
                        <button
                            type="button"
                            onClick={() => onSelect(config.id)}
                            className="btn flex min-w-0 flex-1 items-center gap-3 bg-transparent p-1 text-left"
                        >
                            <Server size={16} className={config.id === activeConfigId ? "shrink-0 text-primary" : "shrink-0 text-muted"} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-base-content">{config.host}</span>
                                <span className="block truncate text-xs text-muted">{config.baseUrl}</span>
                            </span>
                        </button>
                        <button
                            type="button"
                            aria-label={`Remove ${config.host}`}
                            title={`Remove ${config.host}`}
                            onClick={() => onRemove(config.id)}
                            className="btn flex h-8 w-8 shrink-0 items-center justify-center bg-transparent text-muted"
                        >
                            <Trash2 size={15} />
                        </button>
                    </div>
                ))}
                <button type="button" onClick={onAdd} className="btn mt-2 flex h-11 items-center justify-center gap-2 bg-base-200 px-3 text-sm">
                    <Plus size={15} />
                    Add OpenADE Session
                </button>
            </div>
        </div>
    )
}

export function OpenADESettingsScreen({
    config,
    snapshot,
    status,
    themeSetting,
    productState,
    onRefresh,
    onForget,
    onSelfRevoke,
    onSessions,
    onAdd,
    onThemeChange,
    onPersonalSettingsChange,
    onMcpServerChange,
    onMcpServerDelete,
}: {
    config: OpenADESessionConfig
    snapshot: OpenADESnapshot | null
    status: OpenADEChromeStatus
    themeSetting: OpenADEThemeSetting
    productState: OpenADESettingsProductState
    onRefresh: () => void
    onForget: () => void
    onSelfRevoke?: () => void
    onSessions: () => void
    onAdd: () => void
    onThemeChange: (value: OpenADEThemeSetting) => void
    onPersonalSettingsChange?: (settings: OpenADEPersonalSettings) => void
    onMcpServerChange?: (server: OpenADEMCPServer) => void
    onMcpServerDelete?: (serverId: string) => void
}) {
    const { personalSettings: personalSettingsCapabilities, mcpServers: mcpServerCapabilities } = productState.capabilities
    const canReplacePersonalSettings = personalSettingsCapabilities.canRead && personalSettingsCapabilities.canReplace && Boolean(onPersonalSettingsChange)
    const canUpsertMcpServers = mcpServerCapabilities.canRead && mcpServerCapabilities.canUpsert && Boolean(onMcpServerChange)
    const canDeleteMcpServers = mcpServerCapabilities.canRead && mcpServerCapabilities.canDelete && Boolean(onMcpServerDelete)
    const writableHarnessId =
        productState.personalSettings && canReplacePersonalSettings ? productSettingsHarnessId(productState.personalSettings) : null
    const writableModelId = productState.personalSettings && writableHarnessId ? productSettingsModelId(productState.personalSettings, writableHarnessId) : null
    const writableHarnesses = Object.keys(MODEL_REGISTRY) as HarnessId[]
    const writableModels = writableHarnessId ? getVisibleModelEntries(writableHarnessId) : []
    const productTheme =
        productState.personalSettings?.theme === "system"
            ? "System"
            : productState.personalSettings
              ? openADEThemeClasses[productState.personalSettings.theme].label
              : null
    const envVarCount = Object.keys(productState.personalSettings?.envVars ?? {}).length
    const enabledMcpServers = productState.mcpServers.filter((server) => server.enabled).length
    const [mcpDraft, setMcpDraft] = useState<OpenADEMCPServerDraft | null>(null)
    const [envVarsDraft, setEnvVarsDraft] = useState<OpenADEEnvVarsDraft | null>(null)
    const editingMcpServer = useMemo(
        () => (mcpDraft ? productState.mcpServers.find((server) => server.id === mcpDraft.id) : undefined),
        [mcpDraft, productState.mcpServers]
    )
    const canSaveMcpDraft = mcpDraft ? mcpServerDraftIsValid(mcpDraft) && productState.mcpServerActionId !== mcpDraft.id : false

    useEffect(() => {
        if (!mcpServerCapabilities.canRead || !canUpsertMcpServers) setMcpDraft(null)
    }, [canUpsertMcpServers, mcpServerCapabilities.canRead])

    useEffect(() => {
        if (!personalSettingsCapabilities.canRead || !canReplacePersonalSettings) setEnvVarsDraft(null)
    }, [canReplacePersonalSettings, personalSettingsCapabilities.canRead])

    return (
        <div className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-3">
            <div className="flex w-full max-w-full flex-col gap-3 overflow-hidden">
                <div className="border border-border bg-base-200/40 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{config.host}</div>
                            <div className="truncate text-xs text-muted">{config.baseUrl}</div>
                        </div>
                        <span className={`flex shrink-0 items-center gap-1 text-xs ${openADEStatusToneClass(status.tone)}`}>
                            {status.tone === "ok" ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
                            {status.label}
                        </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={onRefresh} className="btn h-10 bg-base-300 px-3 text-sm">
                            Test
                        </button>
                        <button type="button" onClick={onForget} className="btn h-10 bg-error/10 px-3 text-sm text-error">
                            Forget
                        </button>
                    </div>
                    {onSelfRevoke && (
                        <button type="button" onClick={onSelfRevoke} className="btn mt-2 h-10 w-full bg-error/10 px-3 text-sm text-error">
                            Revoke This Device
                        </button>
                    )}
                </div>
                <div className="border border-border bg-base-200/40 p-3">
                    <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-xs font-medium uppercase tracking-wide text-muted">Theme</div>
                            <div className="mt-1 truncate text-sm">
                                {themeSetting === "desktop"
                                    ? `Matching desktop: ${snapshot?.server.theme?.label ?? "Desktop"}`
                                    : openADEThemeClasses[themeSetting].label}
                            </div>
                        </div>
                    </div>
                    <select
                        value={themeSetting}
                        onChange={(event) => {
                            if (isOpenADEThemeSetting(event.target.value)) onThemeChange(event.target.value)
                        }}
                        className="input h-11 w-full border border-border bg-base-100 px-3 text-sm"
                    >
                        <option value="desktop">Match desktop</option>
                        {(Object.keys(openADEThemeClasses) as OpenADEThemeClass[]).map((key) => (
                            <option key={key} value={key}>
                                {openADEThemeClasses[key].label}
                            </option>
                        ))}
                    </select>
                    <div className="mt-2 text-xs text-muted">Stored on this device. Switch back to Match desktop any time.</div>
                </div>
                {personalSettingsCapabilities.canRead && (
                    <div className="border border-border bg-base-200/40 p-3">
                        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Product Preferences</div>
                        {productState.personalSettingsLoading && !productState.personalSettings ? (
                            <div className="text-sm text-muted">Loading preferences...</div>
                        ) : productState.personalSettings && canReplacePersonalSettings ? (
                            <div className="flex flex-col gap-3 text-sm">
                                <label className="flex min-w-0 flex-col gap-1">
                                    <span className="text-muted">Theme</span>
                                    <select
                                        aria-label="Product theme"
                                        value={productState.personalSettings.theme}
                                        disabled={productState.personalSettingsActionLoading}
                                        onChange={(event) => {
                                            const settings = productState.personalSettings
                                            if (!settings) return
                                            if (isOpenADEProductThemeSetting(event.target.value)) {
                                                onPersonalSettingsChange?.({
                                                    ...settings,
                                                    theme: event.target.value,
                                                })
                                            }
                                        }}
                                        className="input h-10 w-full border border-border bg-base-100 px-3 text-sm"
                                    >
                                        <option value="system">System</option>
                                        {(Object.keys(openADEThemeClasses) as OpenADEThemeClass[]).map((key) => (
                                            <option key={key} value={key}>
                                                {openADEThemeClasses[key].label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex min-w-0 items-center justify-between gap-3">
                                    <span className="min-w-0 truncate text-muted">Render Markdown</span>
                                    <input
                                        type="checkbox"
                                        aria-label="Render markdown messages"
                                        checked={productState.personalSettings.renderMarkdownMessages !== false}
                                        disabled={productState.personalSettingsActionLoading}
                                        onChange={(event) => {
                                            const settings = productState.personalSettings
                                            if (!settings) return
                                            onPersonalSettingsChange?.({
                                                ...settings,
                                                renderMarkdownMessages: event.target.checked,
                                            })
                                        }}
                                        className="checkbox"
                                    />
                                </label>
                                <label className="flex min-w-0 items-center justify-between gap-3">
                                    <span className="min-w-0 truncate text-muted">Telemetry</span>
                                    <input
                                        type="checkbox"
                                        aria-label="Share telemetry"
                                        checked={productState.personalSettings.telemetryDisabled !== true}
                                        disabled={productState.personalSettingsActionLoading}
                                        onChange={(event) => {
                                            const settings = productState.personalSettings
                                            if (!settings) return
                                            onPersonalSettingsChange?.({
                                                ...settings,
                                                telemetryDisabled: !event.target.checked,
                                            })
                                        }}
                                        className="checkbox"
                                    />
                                </label>
                                {writableHarnessId && writableModelId && (
                                    <div className="flex min-w-0 items-center justify-between gap-3">
                                        <span className="min-w-0 truncate text-muted">Default Agent</span>
                                        <div className="flex shrink-0 items-center gap-2">
                                            <select
                                                aria-label="Default agent harness"
                                                value={writableHarnessId}
                                                disabled={productState.personalSettingsActionLoading}
                                                onChange={(event) => {
                                                    const settings = productState.personalSettings
                                                    if (!settings) return
                                                    const harnessId = event.target.value as HarnessId
                                                    onPersonalSettingsChange?.({
                                                        ...settings,
                                                        newTaskHarnessId: harnessId,
                                                        newTaskModelId: getVisibleModelId(getDefaultModelForHarness(harnessId), harnessId),
                                                    })
                                                }}
                                                className="input h-9 max-w-36 border border-border bg-base-100 px-2 text-xs"
                                            >
                                                {writableHarnesses.map((harnessId) => (
                                                    <option key={harnessId} value={harnessId}>
                                                        {HARNESS_META[harnessId]?.name ?? harnessId}
                                                    </option>
                                                ))}
                                            </select>
                                            <select
                                                aria-label="Default agent model"
                                                value={writableModelId}
                                                disabled={productState.personalSettingsActionLoading}
                                                onChange={(event) => {
                                                    const settings = productState.personalSettings
                                                    if (!settings) return
                                                    onPersonalSettingsChange?.({
                                                        ...settings,
                                                        newTaskHarnessId: writableHarnessId,
                                                        newTaskModelId: event.target.value,
                                                    })
                                                }}
                                                className="input h-9 max-w-44 border border-border bg-base-100 px-2 text-xs"
                                            >
                                                {writableModels.map((model) => (
                                                    <option key={model.id} value={model.id}>
                                                        {model.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                )}
                                <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2">
                                    <dt className="min-w-0 truncate text-muted">Pinned Tasks</dt>
                                    <dd className="min-w-0 truncate text-right">{productState.personalSettings.pinnedTaskIds?.length ?? 0}</dd>
                                    <dt className="min-w-0 truncate text-muted">Environment Vars</dt>
                                    <dd className="flex min-w-0 items-center justify-end gap-2 text-right">
                                        <span className="truncate">{envVarCount}</span>
                                        <button
                                            type="button"
                                            aria-label="Edit environment vars"
                                            title="Edit environment vars"
                                            onClick={() =>
                                                setEnvVarsDraft({
                                                    value: stringRecordDraftValue(productState.personalSettings?.envVars ?? {}),
                                                    error: null,
                                                })
                                            }
                                            disabled={productState.personalSettingsActionLoading}
                                            className="btn flex h-7 w-7 items-center justify-center bg-base-300 p-0 text-muted"
                                        >
                                            <Pencil size={13} />
                                        </button>
                                    </dd>
                                </dl>
                                {envVarsDraft && (
                                    <div className="flex flex-col gap-2 border border-border/70 bg-base-100/70 p-2">
                                        <div className="flex min-w-0 items-center justify-between gap-2">
                                            <div className="truncate text-sm font-medium">Environment Vars</div>
                                            <button
                                                type="button"
                                                aria-label="Cancel environment vars edit"
                                                title="Cancel environment vars edit"
                                                onClick={() => setEnvVarsDraft(null)}
                                                className="btn flex h-7 w-7 items-center justify-center bg-transparent p-0 text-muted"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                        <textarea
                                            aria-label="Environment variables JSON"
                                            value={envVarsDraft.value}
                                            disabled={productState.personalSettingsActionLoading}
                                            onChange={(event) => setEnvVarsDraft({ value: event.target.value, error: null })}
                                            className="input min-h-32 w-full border border-border bg-base-100 px-2 py-2 font-mono text-xs"
                                        />
                                        {envVarsDraft.error && <div className="text-xs text-error">{envVarsDraft.error}</div>}
                                        <button
                                            type="button"
                                            disabled={productState.personalSettingsActionLoading}
                                            onClick={() => {
                                                const settings = productState.personalSettings
                                                if (!settings) return
                                                const envVars = parseStringRecordDraft(envVarsDraft.value)
                                                if (!envVars) {
                                                    setEnvVarsDraft({ ...envVarsDraft, error: "Invalid environment JSON." })
                                                    return
                                                }
                                                onPersonalSettingsChange?.({
                                                    ...settings,
                                                    envVars,
                                                })
                                                setEnvVarsDraft(null)
                                            }}
                                            className="btn h-9 bg-primary px-3 text-sm text-primary-content"
                                        >
                                            Save Environment Vars
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : productState.personalSettings ? (
                            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-sm">
                                <dt className="min-w-0 truncate text-muted">Theme</dt>
                                <dd className="min-w-0 truncate text-right">{productTheme}</dd>
                                <dt className="min-w-0 truncate text-muted">Markdown</dt>
                                <dd className="min-w-0 truncate text-right">
                                    {productState.personalSettings.renderMarkdownMessages === false ? "Plain text" : "Rendered"}
                                </dd>
                                <dt className="min-w-0 truncate text-muted">Telemetry</dt>
                                <dd className="min-w-0 truncate text-right">
                                    {productState.personalSettings.telemetryDisabled === true ? "Disabled" : "Enabled"}
                                </dd>
                                <dt className="min-w-0 truncate text-muted">New Task Agent</dt>
                                <dd className="min-w-0 truncate text-right">
                                    {[productState.personalSettings.newTaskHarnessId, productState.personalSettings.newTaskModelId]
                                        .filter(Boolean)
                                        .join(" / ") || "Default"}
                                </dd>
                                <dt className="min-w-0 truncate text-muted">Pinned Tasks</dt>
                                <dd className="min-w-0 truncate text-right">{productState.personalSettings.pinnedTaskIds?.length ?? 0}</dd>
                                <dt className="min-w-0 truncate text-muted">Environment Vars</dt>
                                <dd className="min-w-0 truncate text-right">{envVarCount}</dd>
                            </dl>
                        ) : (
                            <div className="text-sm text-muted">Preferences unavailable.</div>
                        )}
                    </div>
                )}
                {mcpServerCapabilities.canRead && (
                    <div className="border border-border bg-base-200/40 p-3">
                        <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                            <div className="text-xs font-medium uppercase tracking-wide text-muted">Connectors</div>
                            <div className="flex shrink-0 items-center gap-2">
                                <div className="text-xs text-muted">
                                    {enabledMcpServers}/{productState.mcpServers.length} enabled
                                </div>
                                {canUpsertMcpServers && (
                                    <button
                                        type="button"
                                        aria-label="Add connector"
                                        title="Add connector"
                                        onClick={() => setMcpDraft(mcpServerDraftFromServer())}
                                        className="btn flex h-8 items-center gap-1 bg-base-300 px-2 text-xs"
                                    >
                                        <Plus size={13} />
                                        Add
                                    </button>
                                )}
                            </div>
                        </div>
                        {mcpDraft && canUpsertMcpServers && (
                            <div className="mb-3 flex flex-col gap-2 border border-border/70 bg-base-100/70 p-2">
                                <div className="flex min-w-0 items-center justify-between gap-2">
                                    <div className="truncate text-sm font-medium">{mcpDraft.editingExisting ? "Edit Connector" : "New Connector"}</div>
                                    <button
                                        type="button"
                                        aria-label="Cancel connector edit"
                                        title="Cancel connector edit"
                                        onClick={() => setMcpDraft(null)}
                                        className="btn flex h-7 w-7 items-center justify-center bg-transparent p-0 text-muted"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                                <label className="flex min-w-0 flex-col gap-1">
                                    <span className="text-xs text-muted">Name</span>
                                    <input
                                        aria-label="Connector name"
                                        value={mcpDraft.name}
                                        disabled={productState.mcpServerActionId === mcpDraft.id}
                                        onChange={(event) => setMcpDraft({ ...mcpDraft, name: event.target.value })}
                                        className="input h-9 w-full border border-border bg-base-100 px-2 text-sm"
                                    />
                                </label>
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                                    <label className="flex min-w-0 flex-col gap-1">
                                        <span className="text-xs text-muted">Transport</span>
                                        <select
                                            aria-label="Connector transport"
                                            value={mcpDraft.transportType}
                                            disabled={mcpDraft.editingExisting || productState.mcpServerActionId === mcpDraft.id}
                                            onChange={(event) => {
                                                const transportType = event.target.value === "stdio" ? "stdio" : "http"
                                                setMcpDraft({ ...mcpDraft, transportType })
                                            }}
                                            className="input h-9 w-full border border-border bg-base-100 px-2 text-sm"
                                        >
                                            <option value="http">HTTP</option>
                                            <option value="stdio">Stdio</option>
                                        </select>
                                    </label>
                                    <label className="flex min-w-0 items-end gap-2 pb-2 text-xs text-muted">
                                        <input
                                            type="checkbox"
                                            aria-label="Connector enabled"
                                            checked={mcpDraft.enabled}
                                            disabled={productState.mcpServerActionId === mcpDraft.id}
                                            onChange={(event) => setMcpDraft({ ...mcpDraft, enabled: event.target.checked })}
                                            className="checkbox"
                                        />
                                        Enabled
                                    </label>
                                </div>
                                {mcpDraft.transportType === "http" ? (
                                    <label className="flex min-w-0 flex-col gap-1">
                                        <span className="text-xs text-muted">URL</span>
                                        <input
                                            aria-label="Connector URL"
                                            value={mcpDraft.url}
                                            disabled={productState.mcpServerActionId === mcpDraft.id}
                                            onChange={(event) => setMcpDraft({ ...mcpDraft, url: event.target.value })}
                                            className="input h-9 w-full border border-border bg-base-100 px-2 text-sm"
                                        />
                                    </label>
                                ) : (
                                    <>
                                        <label className="flex min-w-0 flex-col gap-1">
                                            <span className="text-xs text-muted">Command</span>
                                            <input
                                                aria-label="Connector command"
                                                value={mcpDraft.command}
                                                disabled={productState.mcpServerActionId === mcpDraft.id}
                                                onChange={(event) => setMcpDraft({ ...mcpDraft, command: event.target.value })}
                                                className="input h-9 w-full border border-border bg-base-100 px-2 text-sm"
                                            />
                                        </label>
                                        <label className="flex min-w-0 flex-col gap-1">
                                            <span className="text-xs text-muted">Arguments</span>
                                            <input
                                                aria-label="Connector arguments"
                                                value={mcpDraft.argsText}
                                                disabled={productState.mcpServerActionId === mcpDraft.id}
                                                onChange={(event) => setMcpDraft({ ...mcpDraft, argsText: event.target.value })}
                                                className="input h-9 w-full border border-border bg-base-100 px-2 text-sm"
                                            />
                                        </label>
                                        <label className="flex min-w-0 flex-col gap-1">
                                            <span className="text-xs text-muted">Working Directory</span>
                                            <input
                                                aria-label="Connector cwd"
                                                value={mcpDraft.cwd}
                                                disabled={productState.mcpServerActionId === mcpDraft.id}
                                                onChange={(event) => setMcpDraft({ ...mcpDraft, cwd: event.target.value })}
                                                className="input h-9 w-full border border-border bg-base-100 px-2 text-sm"
                                            />
                                        </label>
                                    </>
                                )}
                                {!mcpDraft.showAdvanced ? (
                                    <button
                                        type="button"
                                        onClick={() => setMcpDraft({ ...mcpDraft, showAdvanced: true, headersError: null, envVarsError: null })}
                                        className="btn h-8 bg-base-300 px-2 text-xs"
                                    >
                                        Advanced
                                    </button>
                                ) : mcpDraft.transportType === "http" ? (
                                    <label className="flex min-w-0 flex-col gap-1">
                                        <span className="text-xs text-muted">Headers JSON</span>
                                        <textarea
                                            aria-label="Connector headers JSON"
                                            value={mcpDraft.headersText}
                                            disabled={productState.mcpServerActionId === mcpDraft.id}
                                            onChange={(event) => setMcpDraft({ ...mcpDraft, headersText: event.target.value, headersError: null })}
                                            className="input min-h-24 w-full border border-border bg-base-100 px-2 py-2 font-mono text-xs"
                                        />
                                        {mcpDraft.headersError && <span className="text-xs text-error">{mcpDraft.headersError}</span>}
                                    </label>
                                ) : (
                                    <label className="flex min-w-0 flex-col gap-1">
                                        <span className="text-xs text-muted">Environment Vars JSON</span>
                                        <textarea
                                            aria-label="Connector environment variables JSON"
                                            value={mcpDraft.envVarsText}
                                            disabled={productState.mcpServerActionId === mcpDraft.id}
                                            onChange={(event) => setMcpDraft({ ...mcpDraft, envVarsText: event.target.value, envVarsError: null })}
                                            className="input min-h-24 w-full border border-border bg-base-100 px-2 py-2 font-mono text-xs"
                                        />
                                        {mcpDraft.envVarsError && <span className="text-xs text-error">{mcpDraft.envVarsError}</span>}
                                    </label>
                                )}
                                <button
                                    type="button"
                                    disabled={!canSaveMcpDraft}
                                    onClick={() => {
                                        if (!mcpDraft) return
                                        if (mcpDraft.transportType === "http") {
                                            const headers = parseStringRecordDraft(mcpDraft.headersText)
                                            if (!headers) {
                                                setMcpDraft({ ...mcpDraft, headersError: "Invalid headers JSON." })
                                                return
                                            }
                                            const nextServer = mcpServerFromDraft(mcpDraft, editingMcpServer, { headers })
                                            if (!nextServer) return
                                            onMcpServerChange?.(nextServer)
                                            setMcpDraft(null)
                                            return
                                        }
                                        const envVars = parseStringRecordDraft(mcpDraft.envVarsText)
                                        if (!envVars) {
                                            setMcpDraft({ ...mcpDraft, envVarsError: "Invalid environment vars JSON." })
                                            return
                                        }
                                        const nextServer = mcpServerFromDraft(mcpDraft, editingMcpServer, { envVars })
                                        if (!nextServer) return
                                        onMcpServerChange?.(nextServer)
                                        setMcpDraft(null)
                                    }}
                                    className="btn h-9 bg-primary px-3 text-sm text-primary-content"
                                >
                                    Save Connector
                                </button>
                            </div>
                        )}
                        {productState.mcpServersLoading && productState.mcpServers.length === 0 ? (
                            <div className="text-sm text-muted">Loading connectors...</div>
                        ) : productState.mcpServers.length > 0 ? (
                            <div className="flex flex-col gap-2">
                                {productState.mcpServers.map((server) => (
                                    <div
                                        key={server.id}
                                        className="flex min-w-0 items-center justify-between gap-2 border border-border/60 bg-base-100/60 px-2 py-1.5"
                                    >
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-medium">{server.name}</div>
                                            <div className="truncate text-xs text-muted">
                                                {server.transportType.toUpperCase()} · {server.healthStatus.replace("_", " ")}
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            {canUpsertMcpServers ? (
                                                <input
                                                    type="checkbox"
                                                    aria-label={`Enable connector ${server.name}`}
                                                    checked={server.enabled}
                                                    disabled={productState.mcpServerActionId === server.id}
                                                    onChange={(event) => {
                                                        onMcpServerChange?.({
                                                            ...server,
                                                            enabled: event.target.checked,
                                                        })
                                                    }}
                                                    className="checkbox"
                                                />
                                            ) : (
                                                <span className={server.enabled ? "text-xs text-success" : "text-xs text-muted"}>
                                                    {server.enabled ? "Enabled" : "Off"}
                                                </span>
                                            )}
                                            {canDeleteMcpServers && (
                                                <button
                                                    type="button"
                                                    aria-label={`Delete connector ${server.name}`}
                                                    title={`Delete connector ${server.name}`}
                                                    disabled={productState.mcpServerActionId === server.id}
                                                    onClick={() => onMcpServerDelete?.(server.id)}
                                                    className="btn flex h-8 w-8 items-center justify-center bg-error/10 p-0 text-error"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                            {canUpsertMcpServers && (
                                                <button
                                                    type="button"
                                                    aria-label={`Edit connector ${server.name}`}
                                                    title={`Edit connector ${server.name}`}
                                                    disabled={productState.mcpServerActionId === server.id}
                                                    onClick={() => setMcpDraft(mcpServerDraftFromServer(server))}
                                                    className="btn flex h-8 w-8 items-center justify-center bg-base-300 p-0 text-muted"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-sm text-muted">No connectors configured.</div>
                        )}
                    </div>
                )}
                <button type="button" onClick={onSessions} className="btn flex h-11 items-center justify-center gap-2 bg-base-200 px-3 text-sm">
                    <Server size={15} />
                    Manage Sessions
                </button>
                <button type="button" onClick={onAdd} className="btn flex h-11 items-center justify-center gap-2 bg-base-200 px-3 text-sm">
                    <Plus size={15} />
                    Add Session
                </button>
            </div>
        </div>
    )
}
