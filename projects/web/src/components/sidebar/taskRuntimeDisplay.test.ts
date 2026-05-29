import { describe, expect, it } from "vitest"
import { runtimeFirstTaskDisplayEvent } from "./taskRuntimeDisplay"

describe("runtimeFirstTaskDisplayEvent", () => {
    it("shows active runtime state before stale terminal transcript state", () => {
        expect(
            runtimeFirstTaskDisplayEvent(
                {
                    type: "action",
                    status: "error",
                    sourceType: "do",
                    sourceLabel: "Do",
                    at: "2026-05-27T00:00:00.000Z",
                },
                true
            )
        ).toEqual({
            type: "action",
            status: "in_progress",
            sourceType: "do",
            sourceLabel: "Do",
            at: "2026-05-27T00:00:00.000Z",
        })
    })

    it("does not synthesize running state for idle tasks", () => {
        expect(
            runtimeFirstTaskDisplayEvent(
                {
                    type: "action",
                    status: "completed",
                    sourceType: "ask",
                    sourceLabel: "Ask",
                    at: "2026-05-27T00:00:00.000Z",
                },
                false
            )
        ).toBeNull()
    })
})
