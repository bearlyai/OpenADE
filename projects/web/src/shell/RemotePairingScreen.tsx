import { CheckCircle2, CircleAlert, ScanLine, Wifi } from "lucide-react"

export interface RemotePendingConnection {
    host: string
    baseUrl: string
}

export function RemotePairingScreen({
    canScan,
    baseUrl,
    pendingConnection,
    isLoading,
    error,
    canCancel,
    onBaseUrlChange,
    onScan,
    onSubmitPairingLink,
    onConfirm,
    onCancelPending,
    onCancelAdd,
}: {
    canScan: boolean
    baseUrl: string
    pendingConnection: RemotePendingConnection | null
    isLoading: boolean
    error: string | null
    canCancel: boolean
    onBaseUrlChange: (value: string) => void
    onScan: () => void
    onSubmitPairingLink: () => void
    onConfirm: () => void
    onCancelPending: () => void
    onCancelAdd: () => void
}) {
    return (
        <main
            className="code-theme code-theme-black flex min-h-[100dvh] w-screen max-w-full items-center justify-center overflow-x-hidden bg-base-100 px-5 py-8 text-base-content"
            style={{ paddingTop: "max(2rem, env(safe-area-inset-top))", paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
        >
            <div className="relative mx-auto flex min-h-[min(680px,calc(100dvh-4rem))] w-full max-w-sm flex-col justify-center">
                {canCancel && (
                    <button type="button" onClick={onCancelAdd} className="btn absolute right-0 top-0 h-9 px-2 text-sm text-muted">
                        Cancel
                    </button>
                )}

                <div className="mb-10 flex flex-col items-center text-center">
                    <div className="flex min-w-0 flex-col items-center">
                        <div className="mb-4 flex h-12 w-12 items-center justify-center border border-primary/30 bg-primary text-primary-content">
                            <Wifi size={22} />
                        </div>
                        <div className="text-[2.5rem] font-semibold leading-none tracking-normal text-base-content">OpenADE</div>
                        <div className="mt-2 text-sm font-medium uppercase text-muted">Companion</div>
                    </div>
                </div>

                {error && (
                    <div className="mb-4 flex items-start gap-2 border border-error/30 bg-error/10 p-3 text-sm text-error">
                        <CircleAlert size={16} className="mt-0.5 shrink-0" />
                        <span className="min-w-0 break-words">{error}</span>
                    </div>
                )}

                {pendingConnection ? (
                    <div className="flex flex-col gap-4 border border-border bg-base-200/60 p-4">
                        <div className="flex min-w-0 gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-success/25 bg-success/10 text-success">
                                <CheckCircle2 size={18} />
                            </div>
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-base-content">Connect to {pendingConnection.host}</div>
                                <div className="mt-1 break-all text-xs text-muted">{pendingConnection.baseUrl}</div>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={onConfirm}
                                disabled={isLoading}
                                className="btn h-10 flex-1 bg-primary px-3 text-primary-content disabled:opacity-50"
                            >
                                {isLoading ? "Connecting..." : "Connect"}
                            </button>
                            <button
                                type="button"
                                onClick={onCancelPending}
                                disabled={isLoading}
                                className="btn h-10 flex-1 bg-base-300 px-3 text-base-content disabled:opacity-50"
                            >
                                Change
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {canScan && (
                            <button
                                type="button"
                                onClick={onScan}
                                disabled={isLoading}
                                className="btn flex h-14 items-center justify-center gap-2 bg-primary px-4 text-base font-semibold text-primary-content disabled:opacity-50"
                            >
                                <ScanLine size={19} />
                                Scan QR
                            </button>
                        )}

                        <div className="flex flex-col gap-2">
                            <input
                                className="input h-[52px] w-full max-w-full border border-border bg-base-200 px-3 text-base"
                                aria-label="Pairing link"
                                placeholder="Paste pairing link"
                                value={baseUrl}
                                onChange={(event) => onBaseUrlChange(event.target.value)}
                                autoCapitalize="none"
                                autoCorrect="off"
                                inputMode="url"
                            />
                            <button
                                type="button"
                                onClick={onSubmitPairingLink}
                                disabled={isLoading || !baseUrl.trim()}
                                className="btn h-12 bg-base-200 px-4 font-medium text-base-content disabled:opacity-50"
                            >
                                Connect
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </main>
    )
}
