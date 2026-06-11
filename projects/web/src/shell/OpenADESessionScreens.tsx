import { CheckCircle2, CircleAlert, Plus, Server, Trash2 } from "lucide-react"
import type { OpenADESnapshot } from "../../../openade-module/src"
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

export function isOpenADEThemeSetting(value: string | null): value is OpenADEThemeSetting {
    return value === "desktop" || (value !== null && value in openADEThemeClasses)
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
    canSelfRevoke,
    onRefresh,
    onForget,
    onSelfRevoke,
    onSessions,
    onAdd,
    onThemeChange,
}: {
    config: OpenADESessionConfig
    snapshot: OpenADESnapshot | null
    status: OpenADEChromeStatus
    themeSetting: OpenADEThemeSetting
    canSelfRevoke: boolean
    onRefresh: () => void
    onForget: () => void
    onSelfRevoke: () => void
    onSessions: () => void
    onAdd: () => void
    onThemeChange: (value: OpenADEThemeSetting) => void
}) {
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
                    {canSelfRevoke && (
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
