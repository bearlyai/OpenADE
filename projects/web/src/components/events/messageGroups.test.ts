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

function opencodeMessageEvent(message: Record<string, unknown>, id: string = crypto.randomUUID()): HarnessStreamEvent {
    return {
        id,
        type: "raw_message",
        executionId: "exec-1",
        harnessId: "opencode",
        direction: "execution",
        message,
    } as unknown as HarnessStreamEvent
}

function opencodeCompleteEvent(usage: { inputTokens?: number; outputTokens?: number; costUsd?: number; durationMs?: number }, id: string = crypto.randomUUID()): HarnessStreamEvent {
    return {
        id,
        type: "complete",
        executionId: "exec-1",
        harnessId: "opencode",
        direction: "execution",
        usage,
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

describe("groupStreamEvents opencode", () => {
    it("renders opencode text events as one text group", () => {
        const groups = groupStreamEvents(
            [
                opencodeMessageEvent({ type: "step_start", sessionID: "ses_123", part: { id: "prt_start", type: "step-start" } }, "msg-1"),
                opencodeMessageEvent({ type: "text", sessionID: "ses_123", part: { type: "text", text: "hello " } }, "msg-2"),
                opencodeMessageEvent({ type: "text", sessionID: "ses_123", part: { type: "text", text: "world" } }, "msg-3"),
                opencodeMessageEvent({
                    type: "step_finish",
                    sessionID: "ses_123",
                    part: { reason: "stop", cost: 0.01, tokens: { input: 10, output: 2 } },
                }),
            ],
            "opencode"
        )

        expect(groups).toMatchObject([
            { type: "system", subtype: "init" },
            { type: "text", text: "hello world", messageIndex: 1 },
            { type: "result", subtype: "success", totalCostUsd: 0.01, usage: { inputTokens: 10, outputTokens: 2 } },
        ])
    })

    it("renders opencode bash tool_use events", () => {
        const groups = groupStreamEvents(
            [
                opencodeMessageEvent(
                    {
                        type: "tool_use",
                        sessionID: "ses_123",
                        part: {
                            id: "tool_1",
                            tool: "bash",
                            state: {
                                status: "completed",
                                input: { command: "pwd" },
                                output: "/tmp/project",
                                metadata: { exit: 0 },
                            },
                        },
                    },
                    "msg-1"
                ),
            ],
            "opencode"
        )

        expect(groups).toEqual([
            {
                type: "bash",
                toolUseId: "tool_1",
                command: "pwd",
                description: undefined,
                result: "/tmp/project",
                isError: false,
                isPending: false,
                messageIndices: [0, undefined],
            },
        ])
    })

    it("renders opencode JSON stream text and shell events", () => {
        const groups = groupStreamEvents(
            [
                opencodeMessageEvent({ type: "message.part.delta", properties: { partID: "part_1", field: "text", delta: "hello " } }, "msg-1"),
                opencodeMessageEvent({ type: "message.part.delta", properties: { partID: "part_1", field: "text", delta: "world" } }, "msg-2"),
                opencodeMessageEvent({ type: "message.part.updated", properties: { part: { id: "part_1", type: "text", text: "hello world" } } }, "msg-3"),
                opencodeMessageEvent({ type: "session.next.shell.started", properties: { callID: "call_1", command: "pwd" } }, "msg-4"),
                opencodeMessageEvent({ type: "session.next.shell.ended", properties: { callID: "call_1", command: "pwd", output: "/tmp/project", exit: 0 } }, "msg-5"),
                opencodeCompleteEvent({ inputTokens: 12, outputTokens: 3, costUsd: 0.02, durationMs: 500 }, "complete-1"),
            ],
            "opencode"
        )

        expect(groups).toEqual([
            {
                type: "text",
                text: "hello world",
                messageIndex: 0,
            },
            {
                type: "bash",
                toolUseId: "call_1",
                command: "pwd",
                description: undefined,
                result: "/tmp/project",
                isError: false,
                isPending: false,
                messageIndices: [4, undefined],
            },
            {
                type: "result",
                subtype: "success",
                durationMs: 500,
                totalCostUsd: 0.02,
                usage: { inputTokens: 12, outputTokens: 3 },
                isError: false,
                messageIndex: 4,
            },
        ])
    })
})

describe("groupStreamEvents codex file changes", () => {
    it("preserves Codex cached input tokens on completed turns", () => {
        const groups = groupStreamEvents(
            [
                codexMessageEvent(
                    {
                        type: "turn.completed",
                        usage: {
                            input_tokens: 200,
                            cached_input_tokens: 150,
                            output_tokens: 50,
                        },
                    },
                    "msg-1"
                ),
            ],
            "codex"
        )

        expect(groups).toEqual([
            {
                type: "result",
                subtype: "success",
                durationMs: 0,
                totalCostUsd: 0,
                usage: {
                    inputTokens: 200,
                    outputTokens: 50,
                    cacheReadTokens: 150,
                },
                isError: false,
                messageIndex: 0,
            },
        ])
    })

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

describe("groupStreamEvents codex web search", () => {
    it("renders Codex web_search events as tool groups", () => {
        const raw = {
            id: "ws_0443fd158f7546df016a0cd69b8c6c8190abc468d794688059",
            type: "web_search",
            query: "https://developer.apple.com/app-store/review/guidelines/",
            action: {
                type: "other",
            },
        }
        const groups = groupStreamEvents([codexMessageEvent(raw, "msg-1")], "codex")

        expect(groups).toEqual([
            {
                type: "tool",
                toolUseId: "ws_0443fd158f7546df016a0cd69b8c6c8190abc468d794688059",
                toolName: "WebSearch",
                input: {
                    query: "https://developer.apple.com/app-store/review/guidelines/",
                    action: {
                        type: "other",
                    },
                },
                isError: false,
                messageIndices: [0, undefined],
            },
        ])
    })

    it("renders raw_json-wrapped Codex web_search events as tool groups", () => {
        const raw = {
            id: "ws_0443fd158f7546df016a0cd69b8c6c8190abc468d794688059",
            type: "web_search",
            query: "https://developer.apple.com/app-store/review/guidelines/",
            action: {
                type: "other",
            },
        }
        const groups = groupStreamEvents([codexMessageEvent({ type: "raw_json", original_type: "web_search", raw }, "msg-1")], "codex")

        expect(groups).toEqual([
            {
                type: "tool",
                toolUseId: "ws_0443fd158f7546df016a0cd69b8c6c8190abc468d794688059",
                toolName: "WebSearch",
                input: {
                    query: "https://developer.apple.com/app-store/review/guidelines/",
                    action: {
                        type: "other",
                    },
                },
                isError: false,
                messageIndices: [0, undefined],
            },
        ])
    })

    it("renders Codex web_search items as tool groups", () => {
        const raw = {
            id: "ws_0443fd158f7546df016a0cd6946cd881908cb6484aeb14abb5",
            type: "web_search",
            query: "Apple App Review Guidelines 3.1.1 in-app purchase digital goods credits external payment link 2026 official Apple",
            action: {
                type: "search",
                query: "Apple App Review Guidelines 3.1.1 in-app purchase digital goods credits external payment link 2026 official Apple",
                queries: [
                    "Apple App Review Guidelines 3.1.1 in-app purchase digital goods credits external payment link 2026 official Apple",
                    "Apple App Review Guidelines 3.1.3(b) multiplatform services external purchases official Apple",
                    "Apple StoreKit External Purchase Link Entitlement United States guidelines official Apple 2026",
                ],
            },
        }
        const groups = groupStreamEvents([codexMessageEvent({ type: "item.completed", item: raw }, "msg-1")], "codex")

        expect(groups).toEqual([
            {
                type: "tool",
                toolUseId: "ws_0443fd158f7546df016a0cd6946cd881908cb6484aeb14abb5",
                toolName: "WebSearch",
                input: {
                    query: "Apple App Review Guidelines 3.1.1 in-app purchase digital goods credits external payment link 2026 official Apple",
                    action: {
                        type: "search",
                        query: "Apple App Review Guidelines 3.1.1 in-app purchase digital goods credits external payment link 2026 official Apple",
                        queries: [
                            "Apple App Review Guidelines 3.1.1 in-app purchase digital goods credits external payment link 2026 official Apple",
                            "Apple App Review Guidelines 3.1.3(b) multiplatform services external purchases official Apple",
                            "Apple StoreKit External Purchase Link Entitlement United States guidelines official Apple 2026",
                        ],
                    },
                },
                isError: false,
                messageIndices: [0, undefined],
            },
        ])
    })

    it("renders unsupported Codex web_search items as tool groups", () => {
        const raw = {
            id: "ws_0443fd158f7546df016a0cd6946cd881908cb6484aeb14abb5",
            type: "web_search",
            query: "Apple App Review Guidelines 3.1.1 in-app purchase digital goods credits external payment link 2026 official Apple",
            action: {
                type: "search",
                query: "Apple App Review Guidelines 3.1.1 in-app purchase digital goods credits external payment link 2026 official Apple",
                queries: [
                    "Apple App Review Guidelines 3.1.1 in-app purchase digital goods credits external payment link 2026 official Apple",
                    "Apple App Review Guidelines 3.1.3(b) multiplatform services external purchases official Apple",
                    "Apple StoreKit External Purchase Link Entitlement United States guidelines official Apple 2026",
                ],
            },
        }
        const groups = groupStreamEvents(
            [codexMessageEvent({ type: "item.completed", item: { id: raw.id, type: "unsupported", original_type: "web_search", raw } }, "msg-1")],
            "codex"
        )

        expect(groups).toEqual([
            {
                type: "tool",
                toolUseId: "ws_0443fd158f7546df016a0cd6946cd881908cb6484aeb14abb5",
                toolName: "WebSearch",
                input: {
                    query: "Apple App Review Guidelines 3.1.1 in-app purchase digital goods credits external payment link 2026 official Apple",
                    action: {
                        type: "search",
                        query: "Apple App Review Guidelines 3.1.1 in-app purchase digital goods credits external payment link 2026 official Apple",
                        queries: [
                            "Apple App Review Guidelines 3.1.1 in-app purchase digital goods credits external payment link 2026 official Apple",
                            "Apple App Review Guidelines 3.1.3(b) multiplatform services external purchases official Apple",
                            "Apple StoreKit External Purchase Link Entitlement United States guidelines official Apple 2026",
                        ],
                    },
                },
                isError: false,
                messageIndices: [0, undefined],
            },
        ])
    })

    it("renders Codex mcp_tool_call items as tool groups", () => {
        const raw = {
            id: "mcp-1",
            type: "mcp_tool_call",
            server: "linear",
            tool: "list_issues",
            arguments: { assignee: "me" },
            result: {
                content: [{ type: "text", text: "ISSUE-1" }],
                structured_content: { count: 1 },
            },
            status: "completed",
        }
        const groups = groupStreamEvents([codexMessageEvent({ type: "item.completed", item: raw }, "msg-1")], "codex")

        expect(groups).toEqual([
            {
                type: "tool",
                toolUseId: "mcp-1",
                toolName: "MCP: linear.list_issues",
                input: { assignee: "me" },
                result: JSON.stringify({
                    content: [{ type: "text", text: "ISSUE-1" }],
                    structured_content: { count: 1 },
                }),
                isError: false,
                messageIndices: [0, undefined],
            },
        ])
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

    it("ignores Claude rate-limit telemetry events that are not transcript content", () => {
        const groups = groupStreamEvents(
            [
                claudeMessageEvent(
                    {
                        type: "rate_limit_event",
                        rate_limit_info: {
                            status: "allowed",
                            resetsAt: 1779137400,
                            rateLimitType: "five_hour",
                            overageStatus: "allowed",
                            overageResetsAt: 1779127200,
                            isUsingOverage: false,
                        },
                        uuid: "c8169bce-1d40-4f3a-a0f8-9e339aa403ac",
                        session_id: "1e3e7c52-0da2-404b-b30f-c51641575f32",
                    },
                    "msg-1"
                ),
                claudeMessageEvent(
                    {
                        type: "raw_json",
                        original_type: "rate_limit_event",
                        raw: {
                            type: "rate_limit_event",
                            rate_limit_info: { status: "allowed" },
                        },
                    },
                    "msg-2"
                ),
            ],
            "claude-code"
        )

        expect(groups).toEqual([])
    })

    it("folds Claude thinking-token estimates into the thinking group they precede", () => {
        const thinkingTokensEvent = (estimatedTokens: number, id: string) =>
            claudeMessageEvent(
                {
                    type: "raw_json",
                    original_type: "system",
                    original_subtype: "thinking_tokens",
                    raw: {
                        type: "system",
                        subtype: "thinking_tokens",
                        estimated_tokens: estimatedTokens,
                        estimated_tokens_delta: 100,
                        uuid: "4f405d63-be1f-4b0e-ae66-71cae78f4047",
                        session_id: "f1a8462d-edee-4aca-ae64-cb2f1e317f87",
                    },
                },
                id
            )

        const groups = groupStreamEvents(
            [
                thinkingTokensEvent(1850, "tt-1"),
                thinkingTokensEvent(1950, "tt-2"),
                claudeMessageEvent({ type: "assistant", message: { content: [{ type: "thinking", thinking: "Let me reason about this." }] } }, "asst-1"),
            ],
            "claude-code"
        )

        expect(groups).toEqual([{ type: "thinking", text: "Let me reason about this.", estimatedThinkingTokens: 1950, messageIndex: 2 }])
    })

    it("drops Claude thinking-token telemetry with no following thinking instead of showing an unknown card", () => {
        const groups = groupStreamEvents(
            [
                claudeMessageEvent(
                    {
                        type: "raw_json",
                        original_type: "system",
                        original_subtype: "thinking_tokens",
                        raw: { type: "system", subtype: "thinking_tokens", estimated_tokens: 1850, estimated_tokens_delta: 100 },
                    },
                    "tt-1"
                ),
                claudeMessageEvent({ type: "system", subtype: "thinking_tokens", estimated_tokens: 1950, estimated_tokens_delta: 100 }, "tt-2"),
            ],
            "claude-code"
        )

        expect(groups).toEqual([])
    })

    it("renders Claude task_progress events as task system groups", () => {
        const groups = groupStreamEvents(
            [
                claudeMessageEvent(
                    {
                        type: "system",
                        subtype: "task_progress",
                        task_id: "aa6c4249c1723694f",
                        tool_use_id: "toolu_01Nz3nyuFCq5PHarAELVEBej",
                        description: "Reading projects/dashboard/src/pages/funktionalChat/state/roomStats.ts",
                        usage: {
                            total_tokens: 70644,
                            tool_uses: 34,
                            duration_ms: 96978,
                        },
                        last_tool_name: "Read",
                        uuid: "c33bcbb9-be72-422a-b171-7489fdc5e87a",
                        session_id: "1e3e7c52-0da2-404b-b30f-c51641575f32",
                    },
                    "msg-1"
                ),
                claudeMessageEvent(
                    {
                        type: "raw_json",
                        original_type: "system",
                        original_subtype: "task_progress",
                        raw: {
                            type: "system",
                            subtype: "task_progress",
                            description: "Reading projects/dashboard/src/pages/funktionalChat/state/roomStats.ts",
                            last_tool_name: "Read",
                        },
                    },
                    "msg-2"
                ),
            ],
            "claude-code"
        )

        expect(groups).toEqual([
            {
                type: "system",
                subtype: "task_progress",
                metadata: {
                    task_id: "aa6c4249c1723694f",
                    tool_use_id: "toolu_01Nz3nyuFCq5PHarAELVEBej",
                    description: "Reading projects/dashboard/src/pages/funktionalChat/state/roomStats.ts",
                    usage: {
                        total_tokens: 70644,
                        tool_uses: 34,
                        duration_ms: 96978,
                    },
                    last_tool_name: "Read",
                    uuid: "c33bcbb9-be72-422a-b171-7489fdc5e87a",
                    session_id: "1e3e7c52-0da2-404b-b30f-c51641575f32",
                },
                messageIndex: 0,
            },
            {
                type: "system",
                subtype: "task_progress",
                metadata: {
                    description: "Reading projects/dashboard/src/pages/funktionalChat/state/roomStats.ts",
                    last_tool_name: "Read",
                },
                messageIndex: 1,
            },
        ])
    })

    it("renders Claude task lifecycle events as task system groups", () => {
        const groups = groupStreamEvents(
            [
                claudeMessageEvent(
                    {
                        type: "system",
                        subtype: "task_started",
                        task_id: "bfnq7cq4u",
                        tool_use_id: "toolu_01GWjh3CwGWJypAA8rmQjvCU",
                        description: "Show context around the bug pattern",
                        task_type: "local_bash",
                        uuid: "b8b514b2-06a0-4e91-8c71-7e605b35203d",
                        session_id: "a6e94e71-7457-4191-b20a-8d154a9b0ed8",
                    },
                    "msg-1"
                ),
                claudeMessageEvent(
                    {
                        type: "system",
                        subtype: "task_notification",
                        task_id: "bfnq7cq4u",
                        tool_use_id: "toolu_01GWjh3CwGWJypAA8rmQjvCU",
                        status: "completed",
                        output_file: "",
                        summary: "Show context around the bug pattern",
                        uuid: "019f04f4-9b57-4499-88f3-18470e037063",
                        session_id: "a6e94e71-7457-4191-b20a-8d154a9b0ed8",
                    },
                    "msg-2"
                ),
                claudeMessageEvent(
                    {
                        type: "raw_json",
                        original_type: "system",
                        original_subtype: "task_started",
                        raw: {
                            type: "system",
                            subtype: "task_started",
                            description: "Show context around the bug pattern",
                            task_type: "local_bash",
                        },
                    },
                    "msg-3"
                ),
            ],
            "claude-code"
        )

        expect(groups).toEqual([
            {
                type: "system",
                subtype: "task_started",
                metadata: {
                    task_id: "bfnq7cq4u",
                    tool_use_id: "toolu_01GWjh3CwGWJypAA8rmQjvCU",
                    description: "Show context around the bug pattern",
                    task_type: "local_bash",
                    uuid: "b8b514b2-06a0-4e91-8c71-7e605b35203d",
                    session_id: "a6e94e71-7457-4191-b20a-8d154a9b0ed8",
                },
                messageIndex: 0,
            },
            {
                type: "system",
                subtype: "task_notification",
                metadata: {
                    task_id: "bfnq7cq4u",
                    tool_use_id: "toolu_01GWjh3CwGWJypAA8rmQjvCU",
                    status: "completed",
                    output_file: "",
                    summary: "Show context around the bug pattern",
                    uuid: "019f04f4-9b57-4499-88f3-18470e037063",
                    session_id: "a6e94e71-7457-4191-b20a-8d154a9b0ed8",
                },
                messageIndex: 1,
            },
            {
                type: "system",
                subtype: "task_started",
                metadata: {
                    description: "Show context around the bug pattern",
                    task_type: "local_bash",
                },
                messageIndex: 2,
            },
        ])
    })

    it("renders Claude task_updated events as task system groups", () => {
        const groups = groupStreamEvents(
            [
                claudeMessageEvent(
                    {
                        type: "system",
                        subtype: "task_updated",
                        task_id: "bhmrg4eco",
                        patch: {
                            status: "completed",
                            end_time: 1779216586597,
                        },
                        uuid: "c6a59719-b446-41c1-aed0-b0b82cffe62d",
                        session_id: "a6e94e71-7457-4191-b20a-8d154a9b0ed8",
                    },
                    "msg-1"
                ),
                claudeMessageEvent(
                    {
                        type: "raw_json",
                        original_type: "system",
                        original_subtype: "task_updated",
                        raw: {
                            type: "system",
                            subtype: "task_updated",
                            task_id: "bhmrg4eco",
                            patch: {
                                status: "completed",
                                end_time: 1779216586597,
                            },
                        },
                    },
                    "msg-2"
                ),
            ],
            "claude-code"
        )

        expect(groups).toEqual([
            {
                type: "system",
                subtype: "task_updated",
                metadata: {
                    task_id: "bhmrg4eco",
                    patch: {
                        status: "completed",
                        end_time: 1779216586597,
                    },
                    uuid: "c6a59719-b446-41c1-aed0-b0b82cffe62d",
                    session_id: "a6e94e71-7457-4191-b20a-8d154a9b0ed8",
                },
                messageIndex: 0,
            },
            {
                type: "system",
                subtype: "task_updated",
                metadata: {
                    task_id: "bhmrg4eco",
                    patch: {
                        status: "completed",
                        end_time: 1779216586597,
                    },
                },
                messageIndex: 1,
            },
        ])
    })

    it("renders Claude api_retry events as system groups", () => {
        const raw = {
            type: "system",
            subtype: "api_retry",
            attempt: 10,
            max_retries: 10,
            retry_delay_ms: 35624.81064789373,
            error_status: 529,
            error: "rate_limit",
            session_id: "0848323a-5269-439c-9411-1decd4b8dc5f",
            uuid: "e1d4c18f-ba8a-4fd4-a393-b269470a074d",
        }
        const groups = groupStreamEvents([claudeMessageEvent(raw, "msg-1")], "claude-code")

        expect(groups).toEqual([
            {
                type: "system",
                subtype: "api_retry",
                metadata: {
                    attempt: 10,
                    max_retries: 10,
                    retry_delay_ms: 35624.81064789373,
                    error_status: 529,
                    error: "rate_limit",
                    session_id: "0848323a-5269-439c-9411-1decd4b8dc5f",
                    uuid: "e1d4c18f-ba8a-4fd4-a393-b269470a074d",
                },
                messageIndex: 0,
            },
        ])
    })

    it("renders raw_json-wrapped Claude api_retry events as system groups", () => {
        const raw = {
            type: "system",
            subtype: "api_retry",
            attempt: 1,
            max_retries: 10,
            retry_delay_ms: 1000,
            error_status: 529,
            error: "rate_limit",
        }
        const groups = groupStreamEvents(
            [claudeMessageEvent({ type: "raw_json", original_type: "system", original_subtype: "api_retry", raw }, "msg-1")],
            "claude-code"
        )

        expect(groups).toEqual([
            {
                type: "system",
                subtype: "api_retry",
                metadata: {
                    attempt: 1,
                    max_retries: 10,
                    retry_delay_ms: 1000,
                    error_status: 529,
                    error: "rate_limit",
                },
                messageIndex: 0,
            },
        ])
    })

    it("renders Claude hook_started events as system groups", () => {
        const raw = {
            type: "system",
            subtype: "hook_started",
            hook_name: "pre-bash",
            hook_event: "PreToolUse",
            session_id: "0848323a-5269-439c-9411-1decd4b8dc5f",
            uuid: "e1d4c18f-ba8a-4fd4-a393-b269470a074d",
        }
        const groups = groupStreamEvents([claudeMessageEvent(raw, "msg-1")], "claude-code")

        expect(groups).toEqual([
            {
                type: "system",
                subtype: "hook_started",
                metadata: {
                    hook_name: "pre-bash",
                    hook_event: "PreToolUse",
                    session_id: "0848323a-5269-439c-9411-1decd4b8dc5f",
                    uuid: "e1d4c18f-ba8a-4fd4-a393-b269470a074d",
                },
                messageIndex: 0,
            },
        ])
    })

    it("renders Claude hook_progress events as system groups", () => {
        const raw = {
            type: "system",
            subtype: "hook_progress",
            hook_name: "pre-bash",
            content: "Checking command...",
            session_id: "0848323a-5269-439c-9411-1decd4b8dc5f",
            uuid: "e1d4c18f-ba8a-4fd4-a393-b269470a074d",
        }
        const groups = groupStreamEvents([claudeMessageEvent(raw, "msg-1")], "claude-code")

        expect(groups).toEqual([
            {
                type: "system",
                subtype: "hook_progress",
                metadata: {
                    hook_name: "pre-bash",
                    content: "Checking command...",
                    session_id: "0848323a-5269-439c-9411-1decd4b8dc5f",
                    uuid: "e1d4c18f-ba8a-4fd4-a393-b269470a074d",
                },
                messageIndex: 0,
            },
        ])
    })

    it("renders Claude web_search events as tool groups", () => {
        const raw = {
            id: "ws_06a733061430c941016a0bc0dafe9481909d2a5c65720110ba",
            type: "web_search",
            query: "React Router Vercel deployment server-index.mjs ERR_MODULE_NOT_FOUND react-router dist development index.mjs",
            action: {
                type: "search",
                query: "React Router Vercel deployment server-index.mjs ERR_MODULE_NOT_FOUND react-router dist development index.mjs",
                queries: [
                    "React Router Vercel deployment server-index.mjs ERR_MODULE_NOT_FOUND react-router dist development index.mjs",
                    "site:vercel.com/docs react-router Vercel React Router 7 server-index.mjs",
                    "site:reactrouter.com Vercel React Router deployment",
                ],
            },
        }
        const groups = groupStreamEvents([claudeMessageEvent(raw, "msg-1")], "claude-code")

        expect(groups).toEqual([
            {
                type: "tool",
                toolUseId: "ws_06a733061430c941016a0bc0dafe9481909d2a5c65720110ba",
                toolName: "WebSearch",
                input: {
                    query: "React Router Vercel deployment server-index.mjs ERR_MODULE_NOT_FOUND react-router dist development index.mjs",
                    action: {
                        type: "search",
                        query: "React Router Vercel deployment server-index.mjs ERR_MODULE_NOT_FOUND react-router dist development index.mjs",
                        queries: [
                            "React Router Vercel deployment server-index.mjs ERR_MODULE_NOT_FOUND react-router dist development index.mjs",
                            "site:vercel.com/docs react-router Vercel React Router 7 server-index.mjs",
                            "site:reactrouter.com Vercel React Router deployment",
                        ],
                    },
                },
                isError: false,
                messageIndices: [0, undefined],
            },
        ])
    })

    it("renders raw_json-wrapped Claude web_search events as tool groups", () => {
        const raw = {
            id: "ws_1",
            type: "web_search",
            query: "React Router Vercel deployment",
            action: { type: "search", queries: ["React Router Vercel deployment"] },
        }
        const groups = groupStreamEvents([claudeMessageEvent({ type: "raw_json", original_type: "web_search", raw }, "msg-1")], "claude-code")

        expect(groups).toEqual([
            {
                type: "tool",
                toolUseId: "ws_1",
                toolName: "WebSearch",
                input: {
                    query: "React Router Vercel deployment",
                    action: { type: "search", queries: ["React Router Vercel deployment"] },
                },
                isError: false,
                messageIndices: [0, undefined],
            },
        ])
    })

    it("renders Claude assistant messages with only empty thinking signatures as thinking groups", () => {
        const groups = groupStreamEvents(
            [
                claudeMessageEvent(
                    {
                        type: "assistant",
                        message: {
                            model: "claude-opus-4-7",
                            id: "msg_01LpMEPux1L4gd8htanB2Kgx",
                            type: "message",
                            role: "assistant",
                            content: [{ type: "thinking", thinking: "", signature: "EvobClkIDRgCKkDYqw2JzyDrf0txtaHYyXoymZfc5IbjiB" }],
                            stop_reason: null,
                            usage: {
                                input_tokens: 1342,
                                cache_creation_input_tokens: 5989,
                                cache_read_input_tokens: 77866,
                                output_tokens: 40,
                            },
                        },
                        parent_tool_use_id: null,
                        session_id: "a6e94e71-7457-4191-b20a-8d154a9b0ed8",
                        uuid: "c5a66af9-f73c-42c5-8c28-cceba0e823af",
                    },
                    "msg-1"
                ),
            ],
            "claude-code"
        )

        expect(groups).toEqual([
            {
                type: "thinking",
                text: "Thinking",
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
