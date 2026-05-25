import type { CompanionState, KeepAwakeMode, PairingPayload } from "../../../shared/companion/src"

function api() {
    return window.openadeAPI?.companion
}

export function isCompanionApiAvailable(): boolean {
    return !!api()
}

export async function getCompanionState(): Promise<CompanionState> {
    const result = await api()?.getState()
    return result as CompanionState
}

export async function setCompanionEnabled(enabled: boolean): Promise<CompanionState> {
    const result = await api()?.setEnabled(enabled)
    return result as CompanionState
}

export async function setCompanionKeepAwakeMode(mode: KeepAwakeMode): Promise<CompanionState> {
    const result = await api()?.setKeepAwakeMode(mode)
    return result as CompanionState
}

export async function startCompanionPairing(): Promise<PairingPayload> {
    const result = await api()?.startPairing()
    return result as PairingPayload
}

export async function revokeCompanionDevice(deviceId: string): Promise<CompanionState> {
    const result = await api()?.revokeDevice(deviceId)
    return result as CompanionState
}

export async function dropAllCompanionDevices(): Promise<CompanionState> {
    const result = await api()?.dropAllDevices()
    return result as CompanionState
}
