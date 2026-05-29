import { describe, expect, it } from "vitest"
import { presentMessageGroup } from "./presentation"

describe("presentMessageGroup", () => {
    it("classifies shell groups with shared labels and status tone", () => {
        expect(
            presentMessageGroup(
                {
                    type: "bash",
                    toolUseId: "tool-1",
                    command: '/bin/zsh -lc "rg companion projects/web/src"',
                    result: "projects/web/src/remote/RemoteApp.tsx",
                    isError: false,
                    isPending: false,
                    messageIndices: [0, 1],
                },
                0
            )
        ).toMatchObject({
            id: "bash:tool-1:0",
            label: "Search: companion",
            detail: '/bin/zsh -lc "rg companion projects/web/src"',
            tone: "muted",
        })
    })

    it("summarizes todos without coupling to a renderer", () => {
        expect(
            presentMessageGroup(
                {
                    type: "todoWrite",
                    toolUseId: "todo-1",
                    todos: [
                        { content: "Read", status: "completed", activeForm: "Reading" },
                        { content: "Patch", status: "in_progress", activeForm: "Patching" },
                        { content: "Verify", status: "pending", activeForm: "Verifying" },
                    ],
                    isError: false,
                    isPending: true,
                    messageIndices: [0, undefined],
                },
                2
            )
        ).toMatchObject({
            id: "todoWrite:todo-1:2",
            label: "Todo",
            detail: "1/3 done, 1 active",
            tone: "warn",
        })
    })

    it("includes input cache rate for completed results when cache usage is present", () => {
        expect(
            presentMessageGroup(
                {
                    type: "result",
                    subtype: "success",
                    durationMs: 1200,
                    totalCostUsd: 0.002,
                    usage: {
                        inputTokens: 200,
                        outputTokens: 50,
                        cacheReadTokens: 150,
                    },
                    isError: false,
                    messageIndex: 1,
                },
                0
            )
        ).toMatchObject({
            id: "result:1:0",
            label: "Completed",
            detail: "200 in, 50 out, 75% input cache",
            tone: "ok",
        })
    })
})
