import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as Y from "yjs"
import { createOpenADEYjsProjection, type OpenADETaskPreview } from "../../../../openade-module/src"
import { OPENADE_YJS_FIXTURE_V1 } from "../../../../openade-module/src/testing/yjsProjectionFixtures"
import { loadYjsDocument, saveYjsDocument } from "../code/yjsStorage"
import { resetRuntimeServer } from "./runtimeGateway"
import { createOpenADEYjsStorageAdapter } from "./runtimeYjsAdapter"

let storageDir = ""

async function installFixture(): Promise<void> {
    for (const [id, data] of Object.entries(OPENADE_YJS_FIXTURE_V1)) {
        await saveYjsDocument(id, Buffer.from(data, "base64"))
    }
}

function eventId(event: unknown): string {
    if (typeof event !== "object" || event === null || !("id" in event)) {
        return ""
    }
    const id = event.id
    return typeof id === "string" ? id : ""
}

async function loadLegacyDoc(documentId: string): Promise<Y.Doc> {
    const data = await loadYjsDocument(documentId)
    if (!data) throw new Error(`Expected fixture document ${documentId}`)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, data)
    return doc
}

function legacyThemeSetting(settingsDoc: Y.Doc): string | undefined {
    const value = settingsDoc.getMap("personal_settings").get("theme")
    return typeof value === "string" ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toPlain(value: unknown): unknown {
    if (value instanceof Y.Map) {
        const result: Record<string, unknown> = {}
        value.forEach((nested, key) => {
            result[key] = toPlain(nested)
        })
        return result
    }
    if (value instanceof Y.Array) {
        return value.toArray().map(toPlain)
    }
    return value
}

function readMapRecord(doc: Y.Doc, mapName: string): Record<string, unknown> {
    const plain = toPlain(doc.getMap(mapName))
    if (!isRecord(plain)) throw new Error(`Expected ${mapName} to be a record`)
    return plain
}

function readOrderedRecords(doc: Y.Doc, name: string): Record<string, unknown>[] {
    const dataMap = doc.getMap<Y.Map<unknown>>(`${name}:data`)
    const orderArray = doc.getArray<string>(`${name}:order`)
    return orderArray
        .toArray()
        .map((itemId) => dataMap.get(itemId))
        .map(toPlain)
        .filter(isRecord)
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined
}

function previewForComparison(preview: OpenADETaskPreview): {
    id: string
    slug: string
    title: string
    closed: boolean | undefined
    createdAt: string
    lastEvent: unknown
    usage: unknown
} {
    return {
        id: preview.id,
        slug: preview.slug,
        title: preview.title,
        closed: preview.closed,
        createdAt: preview.createdAt,
        lastEvent: preview.lastEvent,
        usage: preview.usage,
    }
}

function legacyPreviewForComparison(preview: Record<string, unknown>): ReturnType<typeof previewForComparison> {
    return {
        id: optionalString(preview.id) ?? "",
        slug: optionalString(preview.slug) ?? "",
        title: optionalString(preview.title) ?? "",
        closed: optionalBoolean(preview.closed),
        createdAt: optionalString(preview.createdAt) ?? "",
        lastEvent: isRecord(preview.lastEvent) ? preview.lastEvent : undefined,
        usage: isRecord(preview.usage) ? preview.usage : undefined,
    }
}

describe("OpenADE Yjs projection fixtures", () => {
    beforeEach(async () => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-projection-fixture-"))
        process.env.OPENADE_YJS_STORAGE_DIR = storageDir
        process.env.OPENADE_RUNTIME_CHECKPOINT_FILE = path.join(storageDir, "runtime-checkpoints.json")
        resetRuntimeServer()
        await installFixture()
    })

    afterEach(() => {
        resetRuntimeServer()
        delete process.env.OPENADE_YJS_STORAGE_DIR
        delete process.env.OPENADE_RUNTIME_CHECKPOINT_FILE
        fs.rmSync(storageDir, { recursive: true, force: true })
    })

    it("projects old persisted repo and task data into the OpenADE snapshot contract", async () => {
        const projection = createOpenADEYjsProjection(
            createOpenADEYjsStorageAdapter({
                hostName: () => "fixture-host",
            })
        )

        const snapshot = await projection.readSnapshot({
            version: "fixture-version",
            workingTaskIds: ["task-action"],
        })

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

    it("matches desktop legacy Yjs stores for project and task preview reads", async () => {
        const projection = createOpenADEYjsProjection(
            createOpenADEYjsStorageAdapter({
                hostName: () => "fixture-host",
            })
        )
        const [repoDoc, settingsDoc] = await Promise.all([loadLegacyDoc("code:repos"), loadLegacyDoc("code:personal_settings")])
        const legacyRepo = readOrderedRecords(repoDoc, "repos").find((repo) => repo.id === "repo-fixture")
        if (!legacyRepo) throw new Error("Expected fixture repo")
        const legacyPreviews = Array.isArray(legacyRepo.tasks) ? legacyRepo.tasks.filter(isRecord) : []

        const snapshot = await projection.readSnapshot({
            version: "fixture-version",
            workingTaskIds: ["task-action"],
        })
        const runtimeProject = snapshot.repos[0]
        if (!runtimeProject) throw new Error("Expected runtime fixture repo")

        expect(snapshot.server.theme.setting).toBe(legacyThemeSetting(settingsDoc))
        expect(runtimeProject).toMatchObject({
            id: legacyRepo.id,
            name: legacyRepo.name,
            path: legacyRepo.path,
            archived: legacyRepo.archived,
        })
        expect(new Set(runtimeProject.tasks.map((task) => task.id))).toEqual(new Set(legacyPreviews.map((task) => task.id)))

        for (const legacyPreview of legacyPreviews) {
            const runtimePreview = runtimeProject.tasks.find((task) => task.id === legacyPreview.id)
            expect(runtimePreview ? previewForComparison(runtimePreview) : null).toEqual(legacyPreviewForComparison(legacyPreview))
        }
    })

    it("projects full task detail, missing task documents, and mismatched task documents explicitly", async () => {
        const projection = createOpenADEYjsProjection(createOpenADEYjsStorageAdapter())

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

    it("matches desktop legacy Yjs task store detail reads", async () => {
        const projection = createOpenADEYjsProjection(createOpenADEYjsStorageAdapter())
        const taskDoc = await loadLegacyDoc("code:task:task-action")
        const legacyMeta = readMapRecord(taskDoc, "task:meta")
        const legacyEvents = readOrderedRecords(taskDoc, "task:events")
        const legacyComments = readOrderedRecords(taskDoc, "task:comments")
        const legacyDeviceEnvironments = readOrderedRecords(taskDoc, "task:deviceEnvironments")

        const task = await projection.readTask("repo-fixture", "task-action")
        const missing = await projection.readTask("repo-fixture", "task-missing")

        expect(task).toMatchObject({
            id: legacyMeta.id,
            repoId: legacyMeta.repoId,
            slug: legacyMeta.slug,
            title: legacyMeta.title,
            description: legacyMeta.description,
            isolationStrategy: legacyMeta.isolationStrategy,
            enabledMcpServerIds: legacyMeta.enabledMcpServerIds,
            sessionIds: legacyMeta.sessionIds,
            cancelledPlanEventId: legacyMeta.cancelledPlanEventId,
            closed: legacyMeta.closed,
        })
        expect(task.events).toEqual(legacyEvents)
        expect(task.comments).toEqual(legacyComments)
        expect(task.deviceEnvironments).toEqual(legacyDeviceEnvironments)
        expect(missing).toMatchObject({
            id: "task-missing",
            repoId: "repo-fixture",
            unavailableReason: "Task data is unavailable on the desktop host.",
            events: [],
            comments: [],
            deviceEnvironments: [],
        })
        await expect(projection.readTask("repo-fixture", "task-mismatch")).rejects.toThrow(
            "Task document task-mismatch has mismatched metadata id wrong-task-id"
        )
    })
})
