import { describe, expect, it } from "vitest"
import type { HarnessStreamEvent } from "../../electronAPI/harnessEventTypes"
import { groupStreamEvents } from "./messageGroups"

function stderrEvent(data: string, id: string = crypto.randomUUID()): HarnessStreamEvent {
    return {
        id,
        type: "stderr",
        executionId: "exec-1",
        harnessId: "codex",
        direction: "execution",
        data,
    } as unknown as HarnessStreamEvent
}

function codexMessageEvent(message: Record<string, unknown>, id: string = crypto.randomUUID()): HarnessStreamEvent {
    return {
        id,
        type: "raw_message",
        executionId: "exec-1",
        harnessId: "codex",
        direction: "execution",
        message,
    } as unknown as HarnessStreamEvent
}

describe("groupStreamEvents stderr grouping", () => {
    it("merges adjacent stderr events into one stderr group", () => {
        const groups = groupStreamEvents(
            [stderrEvent("first line", "stderr-1"), stderrEvent("second line", "stderr-2"), stderrEvent("third line", "stderr-3")],
            "codex"
        )

        const stderrGroups = groups.filter((group) => group.type === "stderr")
        expect(stderrGroups).toHaveLength(1)
        expect(stderrGroups[0]).toMatchObject({
            type: "stderr",
            eventId: "stderr-1",
            data: "first line\nsecond line\nthird line",
        })
    })

    it("does not merge stderr across non-stderr execution events", () => {
        const groups = groupStreamEvents(
            [
                stderrEvent("first line", "stderr-1"),
                codexMessageEvent({ type: "item.completed", item: { id: "item-1", type: "agent_message", text: "hello" } }, "msg-1"),
                stderrEvent("second line", "stderr-2"),
            ],
            "codex"
        )

        const stderrGroups = groups.filter((group) => group.type === "stderr")
        expect(stderrGroups).toHaveLength(2)
        expect(stderrGroups[0]).toMatchObject({ type: "stderr", eventId: "stderr-1", data: "first line" })
        expect(stderrGroups[1]).toMatchObject({ type: "stderr", eventId: "stderr-2", data: "second line" })
    })

    it("ignores filtered stderr noise when merging", () => {
        const groups = groupStreamEvents(
            [
                stderrEvent("user-visible line", "stderr-1"),
                stderrEvent("2026-04-13T01:05:42Z ERROR codex_core::rollout noisy internals", "stderr-noise"),
                stderrEvent("follow-up user-visible line", "stderr-2"),
            ],
            "codex"
        )

        const stderrGroups = groups.filter((group) => group.type === "stderr")
        expect(stderrGroups).toHaveLength(2)
        expect(stderrGroups[0]).toMatchObject({ type: "stderr", eventId: "stderr-1", data: "user-visible line" })
        expect(stderrGroups[1]).toMatchObject({ type: "stderr", eventId: "stderr-2", data: "follow-up user-visible line" })
    })
})
