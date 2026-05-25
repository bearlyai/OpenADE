import { BarcodeFormat, BarcodeScanner } from "@capacitor-mlkit/barcode-scanning"
import { CapacitorUpdater } from "@capgo/capacitor-updater"
import { SecureStoragePlugin } from "capacitor-secure-storage-plugin"
import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from "react"
import { RemoteApp } from "../../web/src/remote/RemoteApp"
import { REMOTE_CONFIG_STORAGE_KEY, clearRemoteConfig } from "../../web/src/remote/client"
import "./index.css"

interface AppErrorBoundaryState {
    error: Error | null
}

class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
    state: AppErrorBoundaryState = { error: null }

    static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
        return { error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("[OpenADE Companion] render failed", error, info.componentStack)
    }

    private reset = () => {
        clearRemoteConfig()
        this.setState({ error: null })
        window.location.reload()
    }

    render() {
        if (!this.state.error) return this.props.children

        return (
            <main
                style={{
                    minHeight: "100vh",
                    background: "#000",
                    color: "#f5f5f5",
                    padding: "max(1rem, env(safe-area-inset-top)) 1rem 1rem",
                    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
                }}
            >
                <h1 style={{ fontSize: 20, marginBottom: 12 }}>OpenADE Companion</h1>
                <div style={{ border: "1px solid #7f1d1d", background: "#2a0505", color: "#ffb4b4", padding: 12, marginBottom: 12 }}>
                    {this.state.error.message || "The companion UI failed to load."}
                </div>
                <button type="button" onClick={this.reset} style={{ background: "#f97316", color: "#fff", padding: "10px 14px", border: 0 }}>
                    Reset mobile connection
                </button>
            </main>
        )
    }
}

async function scanPairingCode(): Promise<string | null> {
    const { supported } = await BarcodeScanner.isSupported()
    if (!supported) throw new Error("QR scanning is not supported on this device")

    const permissions = await BarcodeScanner.requestPermissions()
    if (permissions.camera !== "granted" && permissions.camera !== "limited") {
        throw new Error("Camera permission is required to scan a pairing QR")
    }

    const result = await BarcodeScanner.scan({
        formats: [BarcodeFormat.QrCode],
        autoZoom: true,
    })
    return result.barcodes[0]?.rawValue ?? null
}

export function App() {
    const [isStorageReady, setIsStorageReady] = useState(false)
    const [storageVersion, setStorageVersion] = useState(0)

    useEffect(() => {
        void CapacitorUpdater.notifyAppReady().catch(() => {})
    }, [])

    useEffect(() => {
        let cancelled = false
        const readyTimeout = window.setTimeout(() => {
            if (!cancelled) setIsStorageReady(true)
        }, 1000)

        SecureStoragePlugin.get({ key: REMOTE_CONFIG_STORAGE_KEY })
            .then(({ value }) => {
                localStorage.setItem(REMOTE_CONFIG_STORAGE_KEY, value)
            })
            .catch(() => {})
            .finally(() => {
                window.clearTimeout(readyTimeout)
                if (!cancelled) {
                    setIsStorageReady(true)
                    setStorageVersion((version) => version + 1)
                }
            })

        return () => {
            cancelled = true
            window.clearTimeout(readyTimeout)
        }
    }, [])

    useEffect(() => {
        const syncSecureStorage = (event: Event) => {
            const value = (event as CustomEvent<string | null>).detail
            if (value) {
                void SecureStoragePlugin.set({ key: REMOTE_CONFIG_STORAGE_KEY, value })
            } else {
                void SecureStoragePlugin.remove({ key: REMOTE_CONFIG_STORAGE_KEY })
            }
        }
        window.addEventListener("openade-companion-config", syncSecureStorage)
        return () => window.removeEventListener("openade-companion-config", syncSecureStorage)
    }, [])

    if (!isStorageReady) {
        return (
            <main className="code-theme-black min-h-screen bg-base-100 px-4 text-base-content" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
                <div className="text-lg font-semibold">OpenADE Companion</div>
            </main>
        )
    }

    return (
        <AppErrorBoundary key={storageVersion}>
            <RemoteApp scanPairingCode={scanPairingCode} />
        </AppErrorBoundary>
    )
}
