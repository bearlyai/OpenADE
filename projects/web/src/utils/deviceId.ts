import { ulid } from "./ulid"

export const getDeviceId = (): string => {
    const key = "openade-device-id"

    // Check if localStorage is available (browser environment)
    if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
        let deviceId = localStorage.getItem(key)
        if (!deviceId) {
            deviceId = ulid()
            localStorage.setItem(key, deviceId)
        }
        return deviceId
    }

    // Non-browser environment - use in-memory storage
    return `unknown-device-${ulid()}`
}
