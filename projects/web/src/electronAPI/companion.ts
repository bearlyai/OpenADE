import type {
    CompanionState,
    KeepAwakeMode,
    PairingPayload,
    RemoteDevice,
    RemoteDeviceDropAllResult,
    RemoteDeviceListResult,
    RemoteDeviceRevokeResult,
} from "../../../shared/companion/src"
import { OPENADE_REMOTE_METHOD, type RuntimeClientLike } from "../../../openade-client/src"
import { requestKernelRemoteMethod } from "../kernel/session"
import { resolveCoreRuntimeEndpoint, selectedLocalProductRuntimeClient } from "../runtime/localProductRuntimeClient"

function api() {
    return window.openadeAPI?.companion
}

function requireApi() {
    const companionApi = api()
    if (!companionApi) throw new Error("Companion API is not available")
    return companionApi
}

export function isCompanionApiAvailable(): boolean {
    return !!api()
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function isRemoteDevice(value: unknown): value is RemoteDevice {
    if (!isRecord(value)) return false
    return (
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        (value.platform === "ios" || value.platform === "android" || value.platform === "web" || value.platform === "unknown") &&
        typeof value.pairedAt === "string" &&
        (value.lastSeenAt === undefined || typeof value.lastSeenAt === "string") &&
        (value.revokedAt === undefined || typeof value.revokedAt === "string")
    )
}

function isPairingPayload(value: unknown): value is PairingPayload {
    if (!isRecord(value)) return false
    return typeof value.url === "string" && typeof value.token === "string" && typeof value.hostId === "string" && typeof value.expiresAt === "string"
}

function isKeepAwakeMode(value: unknown): value is KeepAwakeMode {
    return value === "off" || value === "while_tasks_running" || value === "while_companion_enabled"
}

function parseCompanionState(value: unknown): CompanionState {
    if (!isRecord(value)) throw new Error("Companion state is invalid")
    if (typeof value.enabled !== "boolean") throw new Error("Companion state is missing enabled")
    if (typeof value.port !== "number") throw new Error("Companion state is missing port")
    if (!Array.isArray(value.boundUrls) || !value.boundUrls.every((entry) => typeof entry === "string")) {
        throw new Error("Companion state is missing bound URLs")
    }
    if (!isKeepAwakeMode(value.keepAwakeMode)) throw new Error("Companion state is missing keep-awake mode")
    if (!Array.isArray(value.devices) || !value.devices.every(isRemoteDevice)) throw new Error("Companion state is missing devices")
    if (value.pairing !== undefined && !isPairingPayload(value.pairing)) throw new Error("Companion state pairing payload is invalid")

    return {
        enabled: value.enabled,
        port: value.port,
        boundUrls: value.boundUrls,
        keepAwakeMode: value.keepAwakeMode,
        ...(value.pairing ? { pairing: value.pairing } : {}),
        devices: value.devices,
    }
}

function parseDeviceListResult(value: unknown): RemoteDeviceListResult {
    if (!isRecord(value) || !Array.isArray(value.devices) || !value.devices.every(isRemoteDevice)) {
        throw new Error("Companion device list result is invalid")
    }
    return { devices: value.devices }
}

function parseDeviceRevokeResult(value: unknown): RemoteDeviceRevokeResult {
    if (!isRecord(value) || value.ok !== true || typeof value.revoked !== "boolean" || !Array.isArray(value.devices) || !value.devices.every(isRemoteDevice)) {
        throw new Error("Companion device revoke result is invalid")
    }
    return { ok: true, revoked: value.revoked, devices: value.devices }
}

function parseDeviceDropAllResult(value: unknown): RemoteDeviceDropAllResult {
    if (!isRecord(value) || value.ok !== true || !Array.isArray(value.devices) || !value.devices.every(isRemoteDevice)) {
        throw new Error("Companion device drop-all result is invalid")
    }
    return { ok: true, devices: value.devices }
}

function publicCompanionBaseUrl(state: CompanionState): string {
    return state.boundUrls.find((url) => url.includes("://100.")) ?? `http://127.0.0.1:${state.port}`
}

function companionRuntimeClient(): RuntimeClientLike {
    return selectedLocalProductRuntimeClient()
}

function usesCoreCompanionRuntime(): boolean {
    return resolveCoreRuntimeEndpoint() !== null
}

async function listDevicesFromRuntime(): Promise<RemoteDevice[]> {
    return parseDeviceListResult(await requestKernelRemoteMethod(companionRuntimeClient(), OPENADE_REMOTE_METHOD.remoteDeviceList)).devices
}

async function stateWithRuntimeDevices(state: CompanionState): Promise<CompanionState> {
    const devices = await listDevicesFromRuntime()
    if (!usesCoreCompanionRuntime()) return { ...state, devices }
    return {
        enabled: state.enabled,
        port: state.port,
        boundUrls: state.boundUrls,
        keepAwakeMode: state.keepAwakeMode,
        devices,
    }
}

export async function getCompanionState(): Promise<CompanionState> {
    return stateWithRuntimeDevices(parseCompanionState(await requireApi().getState()))
}

export async function setCompanionEnabled(enabled: boolean): Promise<CompanionState> {
    return stateWithRuntimeDevices(parseCompanionState(await requireApi().setEnabled(enabled)))
}

export async function setCompanionKeepAwakeMode(mode: KeepAwakeMode): Promise<CompanionState> {
    return stateWithRuntimeDevices(parseCompanionState(await requireApi().setKeepAwakeMode(mode)))
}

export async function startCompanionPairing(): Promise<PairingPayload> {
    if (usesCoreCompanionRuntime()) {
        const initialState = parseCompanionState(await requireApi().getState())
        const state = initialState.enabled ? initialState : parseCompanionState(await requireApi().setEnabled(true))
        const result = await requestKernelRemoteMethod(companionRuntimeClient(), OPENADE_REMOTE_METHOD.remotePairingStart, {
            baseUrl: publicCompanionBaseUrl(state),
        })
        if (!isPairingPayload(result)) throw new Error("Companion pairing payload is invalid")
        return result
    }

    const result = await requireApi().startPairing()
    if (!isPairingPayload(result)) throw new Error("Companion pairing payload is invalid")
    return result
}

export async function revokeCompanionDevice(deviceId: string): Promise<CompanionState> {
    parseDeviceRevokeResult(await requestKernelRemoteMethod(companionRuntimeClient(), OPENADE_REMOTE_METHOD.remoteDeviceRevoke, { deviceId }))
    return getCompanionState()
}

export async function dropAllCompanionDevices(): Promise<CompanionState> {
    parseDeviceDropAllResult(await requestKernelRemoteMethod(companionRuntimeClient(), OPENADE_REMOTE_METHOD.remoteDeviceDropAll))
    return getCompanionState()
}
