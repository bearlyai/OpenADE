import { app, ipcMain } from "electron"
import type { KeepAwakeMode } from "../../../../shared/companion/src"
import {
    flushLastSeen,
    getPairingPayload,
    listDevices,
    loadSettings,
    saveSettings,
    startPairing,
    updateSettings,
} from "./auth"
import { getPublicBaseUrl } from "./network"
import { cleanupPowerKeeper, configurePowerKeeper } from "./powerKeeper"
import { getBoundUrls, startCompanionServer, stopCompanionServer } from "./server"

async function ensureServer(): Promise<string[]> {
    const settings = loadSettings()
    if (!settings.enabled) return []
    return startCompanionServer(settings.port)
}

async function currentState() {
    const settings = loadSettings()
    const boundUrls = settings.enabled ? await ensureServer().catch(() => getBoundUrls()) : []
    return {
        enabled: settings.enabled,
        port: settings.port,
        boundUrls,
        keepAwakeMode: settings.keepAwakeMode,
        pairing: getPairingPayload(),
        devices: listDevices(),
    }
}

async function setEnabled(enabled: boolean) {
    const settings = updateSettings({ enabled })
    if (enabled) {
        await startCompanionServer(settings.port)
    } else {
        flushLastSeen()
        await stopCompanionServer()
    }
    configurePowerKeeper({ enabled, keepAwakeMode: settings.keepAwakeMode })
    return currentState()
}

export function load(): void {
    ipcMain.handle("companion:getState", () => currentState())
    ipcMain.handle("companion:setEnabled", async (_event, enabled: boolean) => setEnabled(enabled === true))
    ipcMain.handle("companion:setKeepAwakeMode", async (_event, keepAwakeMode: KeepAwakeMode) => {
        const settings = updateSettings({ keepAwakeMode })
        configurePowerKeeper({ enabled: settings.enabled, keepAwakeMode })
        return currentState()
    })
    ipcMain.handle("companion:startPairing", async () => {
        const settings = loadSettings()
        if (!settings.enabled) {
            await setEnabled(true)
        }
        const boundUrls = await ensureServer()
        const payload = startPairing(getPublicBaseUrl(settings.port, boundUrls))
        return payload
    })
    app.whenReady().then(async () => {
        const settings = loadSettings()
        saveSettings(settings)
        configurePowerKeeper({ enabled: settings.enabled, keepAwakeMode: settings.keepAwakeMode })
        if (settings.enabled) {
            await startCompanionServer(settings.port).catch((error) => {
                console.warn("[Companion] Failed to start server:", error)
            })
        }
    })
}

export async function cleanup(): Promise<void> {
    ipcMain.removeHandler("companion:getState")
    ipcMain.removeHandler("companion:setEnabled")
    ipcMain.removeHandler("companion:setKeepAwakeMode")
    ipcMain.removeHandler("companion:startPairing")
    flushLastSeen()
    cleanupPowerKeeper()
    await stopCompanionServer()
}
