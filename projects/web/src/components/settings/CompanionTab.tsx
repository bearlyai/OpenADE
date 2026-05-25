import { Copy, KeyRound, Loader2, PlugZap, Power, RefreshCw, Smartphone, Trash2, Wifi } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import QRCode from "qrcode"
import type { CompanionState, KeepAwakeMode, PairingPayload } from "../../../../shared/companion/src"
import {
    dropAllCompanionDevices,
    getCompanionState,
    isCompanionApiAvailable,
    revokeCompanionDevice,
    setCompanionEnabled,
    setCompanionKeepAwakeMode,
    startCompanionPairing,
} from "../../electronAPI/companion"
import type { CodeStore } from "../../store/store"

interface CompanionTabProps {
    store: CodeStore
}

function pairingUrl(payload: PairingPayload): string {
    const url = new URL("/pair", payload.url)
    url.searchParams.set("token", payload.token)
    url.searchParams.set("hostId", payload.hostId)
    url.searchParams.set("expiresAt", payload.expiresAt)
    return url.toString()
}

function maskedPairingUrl(value: string): string {
    const url = new URL(value)
    url.searchParams.set("token", "hidden")
    return url.toString()
}

function formatDate(value?: string): string {
    if (!value) return "Never"
    return new Date(value).toLocaleString()
}

export function CompanionTab({ store: _store }: CompanionTabProps) {
    const [state, setState] = useState<CompanionState | null>(null)
    const [pairing, setPairing] = useState<PairingPayload | null>(null)
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
    const [isBusy, setIsBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const apiAvailable = isCompanionApiAvailable()

    const pairUrl = useMemo(() => (pairing ? pairingUrl(pairing) : ""), [pairing])
    const maskedPairUrl = useMemo(() => (pairUrl ? maskedPairingUrl(pairUrl) : ""), [pairUrl])

    const refresh = async () => {
        if (!apiAvailable) return
        setError(null)
        try {
            const next = await getCompanionState()
            setState(next)
            setPairing(next.pairing ?? null)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to load Companion state")
        }
    }

    useEffect(() => {
        refresh()
    }, [apiAvailable])

    useEffect(() => {
        if (!pairUrl) {
            setQrDataUrl(null)
            return
        }

        QRCode.toDataURL(pairUrl, { margin: 1, width: 220 })
            .then(setQrDataUrl)
            .catch((err) => setError(err instanceof Error ? err.message : "Unable to render QR code"))
    }, [pairUrl])

    const run = async (action: () => Promise<CompanionState | PairingPayload>) => {
        setIsBusy(true)
        setError(null)
        try {
            const result = await action()
            if ("token" in result) {
                setPairing(result)
                setState(await getCompanionState())
            } else {
                setState(result)
                setPairing(result.pairing ?? null)
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Companion action failed")
        } finally {
            setIsBusy(false)
        }
    }

    if (!apiAvailable) {
        return <div className="p-3 border border-border bg-base-200/40 text-sm text-muted">Companion controls are available in the desktop app.</div>
    }

    const enabled = state?.enabled ?? false
    const devices = state?.devices ?? []
    const keepAwakeMode = state?.keepAwakeMode ?? "off"

    return (
        <div className="flex flex-col gap-6">
            <section>
                <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                        <h3 className="text-base font-semibold text-base-content">Companion</h3>
                        <p className="text-sm text-muted">Remote control over your private network.</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => run(() => setCompanionEnabled(!enabled))}
                        disabled={isBusy}
                        className={`btn flex items-center gap-2 px-3 py-2 text-sm ${enabled ? "bg-success/15 text-success" : "bg-base-200 text-base-content"}`}
                    >
                        {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
                        {enabled ? "Enabled" : "Disabled"}
                    </button>
                </div>

                {error && <div className="p-3 border border-error/30 bg-error/10 text-sm text-error mb-3">{error}</div>}

                <div className="p-3 border border-border bg-base-200/40">
                    <div className="flex items-center gap-2 text-sm font-medium text-base-content mb-2">
                        <Wifi size={15} className="text-muted" />
                        Bound URLs
                    </div>
                    {state?.boundUrls.length ? (
                        <div className="flex flex-col gap-1">
                            {state.boundUrls.map((url) => (
                                <code key={url} className="text-xs bg-base-100 border border-border px-2 py-1 text-base-content break-all">
                                    {url}
                                </code>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted">Enable Companion to listen on loopback and detected Tailscale addresses.</p>
                    )}
                </div>
            </section>

            <section>
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h3 className="text-base font-semibold text-base-content">Pairing</h3>
                        <p className="text-sm text-muted">QR sessions expire quickly and can be used once.</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => run(startCompanionPairing)}
                        disabled={isBusy}
                        className="btn flex items-center gap-2 px-3 py-2 bg-primary text-primary-content hover:bg-primary/80 text-sm disabled:opacity-50"
                    >
                        <KeyRound size={14} />
                        Pair
                    </button>
                </div>

                {pairing && (
                    <div className="flex flex-col sm:flex-row gap-4 p-3 border border-border bg-base-200/40">
                        {qrDataUrl && <img src={qrDataUrl} alt="OpenADE Companion pairing QR" className="w-[220px] h-[220px] bg-white p-2" />}
                        <div className="min-w-0 flex-1">
                            <p className="text-sm text-base-content mb-1">Expires {formatDate(pairing.expiresAt)}</p>
                            <code className="block text-xs bg-base-100 border border-border p-2 text-base-content break-all">{maskedPairUrl}</code>
                            <button
                                type="button"
                                onClick={() => navigator.clipboard?.writeText(pairUrl)}
                                className="btn mt-2 flex items-center gap-2 px-3 py-1.5 bg-base-200 hover:bg-base-300 text-sm"
                            >
                                <Copy size={14} />
                                Copy Full Link
                            </button>
                        </div>
                    </div>
                )}
            </section>

            <section>
                <h3 className="text-base font-semibold text-base-content mb-3">Power</h3>
                <select
                    value={keepAwakeMode}
                    onChange={(event) => run(() => setCompanionKeepAwakeMode(event.target.value as KeepAwakeMode))}
                    className="input w-full bg-base-200 border border-border p-2 px-3 text-sm rounded-none"
                >
                    <option value="off">Do not keep awake</option>
                    <option value="while_tasks_running">Keep awake while tasks are running</option>
                    <option value="while_companion_enabled">Keep awake while Companion is enabled</option>
                </select>
            </section>

            <section>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold text-base-content">Devices</h3>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={refresh}
                            className="btn w-8 h-8 flex items-center justify-center bg-transparent hover:bg-base-300"
                            title="Refresh"
                        >
                            <RefreshCw size={14} />
                        </button>
                        <button
                            type="button"
                            onClick={() => run(dropAllCompanionDevices)}
                            disabled={devices.length === 0}
                            className="btn w-8 h-8 flex items-center justify-center bg-error/10 hover:bg-error text-error hover:text-error-content disabled:opacity-40"
                            title="Drop all"
                        >
                            <PlugZap size={14} />
                        </button>
                    </div>
                </div>

                <div className="flex flex-col gap-2">
                    {devices.length === 0 && <div className="p-3 border border-border bg-base-200/40 text-sm text-muted">No paired devices.</div>}
                    {devices.map((device) => (
                        <div key={device.id} className="flex items-center justify-between gap-3 p-3 border border-border bg-base-200/40">
                            <div className="min-w-0 flex items-center gap-3">
                                <Smartphone size={16} className="text-muted shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-base-content truncate">{device.name}</p>
                                    <p className="text-xs text-muted">
                                        {device.platform} · last seen {formatDate(device.lastSeenAt)}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => run(() => revokeCompanionDevice(device.id))}
                                disabled={!!device.revokedAt}
                                className="btn w-8 h-8 flex items-center justify-center bg-error/10 hover:bg-error text-error hover:text-error-content disabled:opacity-40"
                                title="Revoke"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    )
}
