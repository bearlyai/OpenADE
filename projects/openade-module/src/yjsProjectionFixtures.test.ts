import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createOpenADENodeYjsStorage } from "./nodeYjsStorage"
import { OPENADE_YJS_FIXTURE_V1 } from "./testing/yjsProjectionFixtures"
import { createOpenADEYjsProjection } from "./yjsProjection"

let storageDir = ""
let storage: ReturnType<typeof createOpenADENodeYjsStorage>

async function installFixture(): Promise<void> {
    for (const [id, data] of Object.entries(OPENADE_YJS_FIXTURE_V1)) {
        await storage.saveDocumentUpdate(id, Buffer.from(data, "base64"))
    }
}

function eventId(event: unknown): string {
    if (typeof event !== "object" || event === null || !("id" in event)) {
        return ""
    }
    const id = event.id
    return typeof id === "string" ? id : ""
}

describe("createOpenADEYjsProjection fixtures", () => {
    beforeEach(async () => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-module-projection-fixture-"))
        storage = createOpenADENodeYjsStorage(storageDir, { legacyNestedRootDir: null })
        await installFixture()
    })

    afterEach(() => {
        fs.rmSync(storageDir, { recursive: true, force: true })
    })

    it("projects committed old Yjs repo data into the OpenADE snapshot contract", async () => {
        const projection = createOpenADEYjsProjection({
            ...storage,
            hostName: () => "fixture-host",
        })

        const snapshot = await projection.readSnapshot({
            version: "fixture-version",
            workingTaskIds: ["task-action"],
        })
        const documentIds = await projection.listDataDocuments()

        expect(documentIds.sort()).toEqual(Object.keys(OPENADE_YJS_FIXTURE_V1).sort())
        expect(snapshot.server).toEqual({
            version: "fixture-version",
            hostName: "fixture-host",
            theme: {
                setting: "code-theme-synthwave",
                className: "code-theme-synthwave",
                label: "Synthwave",
            },
        })
        expect(snapshot.workingTaskIds).toEqual(["task-action"])
        expect(snapshot.repos).toHaveLength(1)
        expect(snapshot.repos[0]).toMatchObject({
            id: "repo-fixture",
            name: "Fixture Repo",
            path: "/tmp/openade-fixture-repo",
            archived: false,
        })
        expect(snapshot.repos[0].tasks.map((task) => task.id)).toEqual([
            "task-action",
            "task-missing",
            "task-mismatch",
            "task-old-open",
            "task-closed",
        ])
        expect(snapshot.repos[0].tasks.find((task) => task.id === "task-action")).toMatchObject({
            title: "Action task",
            usage: {
                usageVersion: 1,
                inputTokens: 3,
                outputTokens: 5,
                totalCostUsd: 0.01,
                eventCount: 1,
                costByModel: { "gpt-test": 0.01 },
            },
            lastEvent: {
                type: "action",
                status: "completed",
                sourceType: "do",
                sourceLabel: "Do",
                at: "2026-05-02T01:00:00.000Z",
            },
        })
    })

    it("projects task detail while preserving missing and mismatched task behavior", async () => {
        const projection = createOpenADEYjsProjection(storage)

        const task = await projection.readTask("repo-fixture", "task-action")
        const missing = await projection.readTask("repo-fixture", "task-missing")

        await expect(projection.readTask("repo-fixture", "task-mismatch")).rejects.toThrow(
            "Task document task-mismatch has mismatched metadata id wrong-task-id"
        )

        expect(task).toMatchObject({
            id: "task-action",
            repoId: "repo-fixture",
            slug: "action-task",
            title: "Action task",
            description: "Legacy fixture action task.",
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            enabledMcpServerIds: ["mcp-a"],
            sessionIds: { codex: "session-a" },
            cancelledPlanEventId: "event-plan-cancelled",
            queuedTurns: [
                {
                    id: "queued-a",
                    type: "do",
                    input: "Queued work",
                    status: "queued",
                    createdAt: "2026-05-02T02:00:00.000Z",
                    updatedAt: "2026-05-02T02:00:00.000Z",
                },
            ],
            deviceEnvironments: [
                {
                    id: "env-a",
                    deviceId: "device-a",
                    worktreeDir: "/tmp/openade-fixture-repo/.worktrees/action-task",
                    setupComplete: true,
                    mergeBaseCommit: "abc123",
                },
            ],
            comments: [
                {
                    id: "comment-a",
                    content: "Comment content",
                    source: { type: "llm_output", eventId: "event-action", lineStart: 1, lineEnd: 1 },
                    selectedText: { text: "selected", linesBefore: "", linesAfter: "" },
                    author: { id: "user-fixture", email: "fixture@example.com" },
                },
            ],
        })
        expect(task.events.map(eventId)).toEqual(["event-setup", "event-action", "event-snapshot"])
        expect(missing).toMatchObject({
            id: "task-missing",
            repoId: "repo-fixture",
            slug: "missing-task",
            title: "Missing task doc",
            description: "",
            isolationStrategy: { type: "head" },
            unavailableReason: "Task data is unavailable on the desktop host.",
            events: [],
            comments: [],
            deviceEnvironments: [],
        })
    })
})
