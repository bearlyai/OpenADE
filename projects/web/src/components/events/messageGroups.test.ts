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

function claudeMessageEvent(message: Record<string, unknown>, id: string = crypto.randomUUID()): HarnessStreamEvent {
    return {
        id,
        type: "raw_message",
        executionId: "exec-1",
        harnessId: "claude-code",
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

describe("groupStreamEvents codex file changes", () => {
    it("renders one fileChange group per Codex file_change entry", () => {
        const groups = groupStreamEvents(
            [
                codexMessageEvent(
                    {
                        type: "item.completed",
                        item: {
                            id: "item-1",
                            type: "file_change",
                            status: "completed",
                            changes: [
                                { path: "src/a.ts", kind: "update", diff: "diff --git a/src/a.ts b/src/a.ts\n" },
                                { path: "src/b.ts", kind: "add" },
                            ],
                        },
                    },
                    "msg-1"
                ),
            ],
            "codex"
        )

        expect(groups).toEqual([
            {
                type: "fileChange",
                toolUseId: "item-1",
                filePath: "src/a.ts",
                kind: "update",
                status: "completed",
                diff: "diff --git a/src/a.ts b/src/a.ts\n",
                isError: false,
                isPending: false,
                messageIndex: 0,
                changeIndex: 0,
            },
            {
                type: "fileChange",
                toolUseId: "item-1",
                filePath: "src/b.ts",
                kind: "add",
                status: "completed",
                diff: undefined,
                isError: false,
                isPending: false,
                messageIndex: 0,
                changeIndex: 1,
            },
        ])
    })

    it("marks failed Codex file_change entries as errors", () => {
        const groups = groupStreamEvents(
            [
                codexMessageEvent(
                    {
                        type: "item.completed",
                        item: {
                            id: "item-1",
                            type: "file_change",
                            status: "failed",
                            changes: [{ path: "src/a.ts", kind: "update" }],
                        },
                    },
                    "msg-1"
                ),
            ],
            "codex"
        )

        expect(groups[0]).toMatchObject({
            type: "fileChange",
            isError: true,
            isPending: false,
        })
    })
})

describe("groupStreamEvents unknown harness events", () => {
    it("renders Codex raw_json events as unknown groups", () => {
        const raw = { type: "future.event", data: "new shape" }
        const groups = groupStreamEvents([codexMessageEvent({ type: "raw_json", original_type: "future.event", raw }, "msg-1")], "codex")

        expect(groups).toEqual([
            {
                type: "unknown",
                harnessId: "codex",
                label: "Unknown Codex event: future.event",
                originalType: "future.event",
                raw,
                messageIndex: 0,
            },
        ])
    })

    it("renders Codex unsupported items as unknown groups", () => {
        const raw = { id: "item-1", type: "future_item", payload: true }
        const groups = groupStreamEvents(
            [
                codexMessageEvent(
                    {
                        type: "item.completed",
                        item: { id: "item-1", type: "unsupported", original_type: "future_item", raw },
                    },
                    "msg-1"
                ),
            ],
            "codex"
        )

        expect(groups).toEqual([
            {
                type: "unknown",
                harnessId: "codex",
                label: "Unknown Codex item: future_item",
                originalType: "future_item",
                raw,
                messageIndex: 0,
            },
        ])
    })

    it("renders Claude raw_json events as unknown groups", () => {
        const raw = { type: "future_event", data: "new shape" }
        const groups = groupStreamEvents([claudeMessageEvent({ type: "raw_json", original_type: "future_event", raw }, "msg-1")], "claude-code")

        expect(groups).toEqual([
            {
                type: "unknown",
                harnessId: "claude-code",
                label: "Unknown Claude event: future_event",
                originalType: "future_event",
                raw,
                messageIndex: 0,
            },
        ])
    })

    it("renders known-but-unhandled Claude events as unknown groups", () => {
        const raw = { type: "tool_progress", tool_use_id: "tool-1", progress: "still running" }
        const groups = groupStreamEvents([claudeMessageEvent(raw, "msg-1")], "claude-code")

        expect(groups).toEqual([
            {
                type: "unknown",
                harnessId: "claude-code",
                label: "Unknown Claude event: tool_progress",
                originalType: "tool_progress",
                raw,
                messageIndex: 0,
            },
        ])
    })
})
