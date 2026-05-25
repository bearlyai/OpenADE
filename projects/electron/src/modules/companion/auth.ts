import crypto from "node:crypto"
import Store from "electron-store"
import type { PairingPayload, RemoteDevice, RemotePlatform } from "../../../../shared/companion/src"

const STORE_KEY = "companion"
const TOKEN_BYTES = 32
const PAIRING_TTL_MS = 2 * 60 * 1000
const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 1000

interface StoredDevice extends RemoteDevice {
    tokenHash: string
}

export interface CompanionSettings {
    enabled: boolean
    port: number
    keepAwakeMode: "off" | "while_tasks_running" | "while_companion_enabled"
    hostId: string
    devices: StoredDevice[]
}

interface PairingSession {
    tokenHash: string
    payload: PairingPayload
}

interface StoreShape {
    [STORE_KEY]?: Partial<CompanionSettings>
}

const store = new Store<StoreShape>()
let pairingSession: PairingSession | null = null
const lastSeenCache = new Map<string, string>()
const lastSeenPersistedAt = new Map<string, number>()

function nowIso(): string {
    return new Date().toISOString()
}

function createToken(): string {
    return crypto.randomBytes(TOKEN_BYTES).toString("base64url")
}

export function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex")
}

function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a, "hex")
    const right = Buffer.from(b, "hex")
    if (left.length !== right.length) return false
    return crypto.timingSafeEqual(left, right)
}

function loadRaw(): Partial<CompanionSettings> {
    return store.get(STORE_KEY) ?? {}
}

export function loadSettings(): CompanionSettings {
    const raw = loadRaw()
    return {
        enabled: raw.enabled ?? false,
        port: raw.port ?? 7823,
        keepAwakeMode: raw.keepAwakeMode ?? "off",
        hostId: raw.hostId ?? crypto.randomUUID(),
        devices: raw.devices ?? [],
    }
}

export function saveSettings(next: CompanionSettings): void {
    store.set(STORE_KEY, next)
}

function toPublicDevice(device: StoredDevice): RemoteDevice {
    return {
        id: device.id,
        name: device.name,
        platform: device.platform,
        pairedAt: device.pairedAt,
        lastSeenAt: lastSeenCache.get(device.id) ?? device.lastSeenAt,
        revokedAt: device.revokedAt,
    }
}

export function updateSettings(update: Partial<Omit<CompanionSettings, "hostId" | "devices">>): CompanionSettings {
    const next = { ...loadSettings(), ...update }
    saveSettings(next)
    return next
}

export function listDevices(): RemoteDevice[] {
    return loadSettings().devices.map(toPublicDevice)
}

export function startPairing(baseUrl: string): PairingPayload {
    const settings = loadSettings()
    if (!settings.hostId) {
        settings.hostId = crypto.randomUUID()
        saveSettings(settings)
    }

    const token = createToken()
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString()
    const payload: PairingPayload = {
        url: baseUrl,
        token,
        hostId: settings.hostId,
        expiresAt,
    }

    pairingSession = {
        tokenHash: hashToken(token),
        payload,
    }

    return payload
}

export function getPairingPayload(): PairingPayload | undefined {
    if (!pairingSession) return undefined
    if (Date.parse(pairingSession.payload.expiresAt) <= Date.now()) {
        pairingSession = null
        return undefined
    }
    return pairingSession.payload
}

export function pairDevice(args: { token: string; deviceName: string; platform: RemotePlatform }): { device: RemoteDevice; deviceToken: string } {
    const payload = getPairingPayload()
    if (!payload || !pairingSession || !safeEqual(pairingSession.tokenHash, hashToken(args.token))) {
        throw new Error("Pairing token is invalid or expired")
    }

    pairingSession = null
    const settings = loadSettings()
    const deviceToken = createToken()
    const device: StoredDevice = {
        id: crypto.randomUUID(),
        name: args.deviceName,
        platform: args.platform,
        pairedAt: nowIso(),
        lastSeenAt: nowIso(),
        tokenHash: hashToken(deviceToken),
    }

    settings.devices = [...settings.devices.filter((d) => !d.revokedAt), device]
    saveSettings(settings)

    return { device: toPublicDevice(device), deviceToken }
}

export function authenticateDevice(token: string | undefined): RemoteDevice | null {
    if (!token) return null
    const settings = loadSettings()
    const tokenHash = hashToken(token)
    const device = settings.devices.find((entry) => !entry.revokedAt && safeEqual(entry.tokenHash, tokenHash))
    if (!device) return null

    const now = Date.now()
    const lastSeenAt = new Date(now).toISOString()
    lastSeenCache.set(device.id, lastSeenAt)

    const lastPersistedAt = lastSeenPersistedAt.get(device.id) ?? 0
    if (now - lastPersistedAt >= LAST_SEEN_WRITE_INTERVAL_MS) {
        device.lastSeenAt = lastSeenAt
        lastSeenPersistedAt.set(device.id, now)
        saveSettings(settings)
    }

    return toPublicDevice(device)
}

export function flushLastSeen(): void {
    if (lastSeenCache.size === 0) return

    const settings = loadSettings()
    let changed = false
    settings.devices = settings.devices.map((device) => {
        const lastSeenAt = lastSeenCache.get(device.id)
        if (!lastSeenAt || device.lastSeenAt === lastSeenAt) return device
        changed = true
        return { ...device, lastSeenAt }
    })

    if (changed) saveSettings(settings)
}

export function revokeDevice(deviceId: string): boolean {
    const settings = loadSettings()
    let changed = false
    settings.devices = settings.devices.map((device) => {
        if (device.id !== deviceId || device.revokedAt) return device
        changed = true
        return { ...device, revokedAt: nowIso() }
    })
    if (changed) saveSettings(settings)
    lastSeenCache.delete(deviceId)
    lastSeenPersistedAt.delete(deviceId)
    return changed
}

export function dropAllDevices(): void {
    const settings = loadSettings()
    const revokedAt = nowIso()
    settings.devices = settings.devices.map((device) => (device.revokedAt ? device : { ...device, revokedAt }))
    saveSettings(settings)
    lastSeenCache.clear()
    lastSeenPersistedAt.clear()
}
