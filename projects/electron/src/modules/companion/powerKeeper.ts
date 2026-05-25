import { powerSaveBlocker } from "electron"
import type { KeepAwakeMode } from "../../../../shared/companion/src"

let blockerId: number | null = null
let mode: KeepAwakeMode = "off"
let enabled = false
let runningTaskCount = 0

function shouldHoldAwake(): boolean {
    if (mode === "off") return false
    if (mode === "while_companion_enabled") return enabled
    return runningTaskCount > 0
}

function syncBlocker(): void {
    const shouldHold = shouldHoldAwake()
    if (shouldHold && blockerId === null) {
        blockerId = powerSaveBlocker.start("prevent-app-suspension")
        return
    }

    if (!shouldHold && blockerId !== null) {
        powerSaveBlocker.stop(blockerId)
        blockerId = null
    }
}

export function configurePowerKeeper(next: { enabled?: boolean; keepAwakeMode?: KeepAwakeMode; runningTaskCount?: number }): void {
    if (next.enabled !== undefined) enabled = next.enabled
    if (next.keepAwakeMode !== undefined) mode = next.keepAwakeMode
    if (next.runningTaskCount !== undefined) runningTaskCount = next.runningTaskCount
    syncBlocker()
}

export function cleanupPowerKeeper(): void {
    if (blockerId !== null) {
        powerSaveBlocker.stop(blockerId)
        blockerId = null
    }
}
