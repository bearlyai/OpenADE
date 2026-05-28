import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueuedTurn } from "../types"
import { getInputBarQueuedTurns, QUEUED_TURNS_PREVIEW_STORAGE_KEY, setInputBarQueuedTurnsPreviewEnabled } from "./InputBar"

const queuedTurn: QueuedTurn = {
    id: "real-queued",
    type: "do",
    input: "Real queued message",
    status: "queued",
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
}

beforeEach(() => {
    window.localStorage.removeItem(QUEUED_TURNS_PREVIEW_STORAGE_KEY)
})

describe("InputBar queued turn preview", () => {
    it("shows sample queued turns only when preview is enabled and no real queue exists", () => {
        expect(getInputBarQueuedTurns([], false)).toEqual({ turns: [], preview: false })

        const preview = getInputBarQueuedTurns([], true)
        expect(preview.preview).toBe(true)
        expect(preview.turns.map((turn) => turn.type)).toEqual(["do", "ask"])
    })

    it("never replaces real queued turns with preview rows", () => {
        expect(getInputBarQueuedTurns([queuedTurn], true)).toEqual({ turns: [queuedTurn], preview: false })
    })

    it("can be enabled from localStorage for visual inspection", () => {
        window.localStorage.setItem(QUEUED_TURNS_PREVIEW_STORAGE_KEY, "1")

        expect(getInputBarQueuedTurns([]).preview).toBe(true)
    })

    it("emits a browser event when the preview flag changes so mounted input bars can update", () => {
        const listener = vi.fn()
        window.addEventListener("openade:queued-turn-preview-changed", listener)

        setInputBarQueuedTurnsPreviewEnabled(true)

        expect(window.localStorage.getItem(QUEUED_TURNS_PREVIEW_STORAGE_KEY)).toBe("1")
        expect(listener).toHaveBeenCalledTimes(1)

        window.removeEventListener("openade:queued-turn-preview-changed", listener)
    })

    it("exposes the preview helper in built Electron renderers too", async () => {
        await import("./InputBar")

        expect(typeof window.openadePreviewQueuedTurns).toBe("function")
    })
})
