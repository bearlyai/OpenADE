import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createOpenADENodeYjsStorage } from "./nodeYjsStorage"
import {
    createOpenADEYjsWriter,
    deleteYjsMcpServer,
    readYjsMcpServers,
    replaceYjsMcpServers,
    type OpenADEYjsMutationStorageAdapter,
    upsertYjsMcpServer,
} from "./yjsMutation"
import { createOpenADEYjsProjection } from "./yjsProjection"
import type { OpenADEMCPServer } from "./types"

type Deferred = {
    promise: Promise<void>
    resolve: () => void
}

function record(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function deferred(): Deferred {
    let resolvePromise: (() => void) | undefined
    const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve
    })
    return {
        promise,
        resolve: () => resolvePromise?.(),
    }
}

describe("createOpenADEYjsWriter", () => {
    let storageDir = ""

    beforeEach(() => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-module-yjs-mutation-"))
    })

    afterEach(() => {
        fs.rmSync(storageDir, { recursive: true, force: true })
    })

    it("does not resurrect stale action status when stream appends save after completion", async () => {
        const baseStorage = createOpenADENodeYjsStorage(storageDir, { legacyNestedRootDir: null })
        const taskDocId = "code:task:task-1"
        const heldSaveStarted = deferred()
        const releaseHeldSave = deferred()
        let holdNextTaskSave = false

        const storage: OpenADEYjsMutationStorageAdapter = {
            ...baseStorage,
            async saveDocumentUpdate(id, data) {
                if (id === taskDocId && holdNextTaskSave) {
                    holdNextTaskSave = false
                    heldSaveStarted.resolve()
                    await releaseHeldSave.promise
                }
                await baseStorage.saveDocumentUpdate(id, data)
            },
        }
        const writer = createOpenADEYjsWriter(storage, {
            createId: () => "generated-id",
            createSlug: () => "generated-slug",
            now: () => "2026-06-01T00:00:00.000Z",
        })
        const projection = createOpenADEYjsProjection(storage)

        await writer.createRepo({
            repoId: "repo-1",
            name: "Mutation Repo",
            path: "/tmp/mutation-repo",
            createdBy: { id: "user-1", email: "user@example.com" },
        })
        await writer.createTask({
            repoId: "repo-1",
            taskId: "task-1",
            slug: "task-1",
            title: "Mutation Task",
            input: "Exercise concurrent saves",
            createdBy: { id: "user-1", email: "user@example.com" },
            deviceId: "device-1",
            isolationStrategy: { type: "head" },
        })
        await writer.createActionEvent({
            taskId: "task-1",
            eventId: "event-1",
            userInput: "Ask",
            executionId: "execution-1",
            harnessId: "codex",
            source: { type: "ask", userLabel: "Ask" },
            includesCommentIds: [],
        })

        holdNextTaskSave = true
        const staleAppend = writer.appendActionStreamEvent({
            taskId: "task-1",
            eventId: "event-1",
            streamEvent: {
                id: "stream-1",
                direction: "execution",
                type: "raw_message",
                executionId: "execution-1",
                harnessId: "codex",
                message: { type: "text", text: "late stream event" },
            },
        })

        await heldSaveStarted.promise
        await writer.completeActionEvent({ taskId: "task-1", eventId: "event-1", success: true })
        releaseHeldSave.resolve()
        await staleAppend

        const task = await projection.readTask("repo-1", "task-1")
        const action = task.events.map(record).find((event) => event?.type === "action")
        const execution = record(action?.execution)
        const streamEvents = Array.isArray(execution?.events) ? execution.events : []

        expect(action).toMatchObject({
            id: "event-1",
            status: "completed",
            result: { success: true },
        })
        expect(streamEvents).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: "stream-1",
                    type: "raw_message",
                    message: { type: "text", text: "late stream event" },
                }),
            ])
        )
    })

    it("updates lastViewedAt in repo previews without loading the task document", async () => {
        const baseStorage = createOpenADENodeYjsStorage(storageDir, { legacyNestedRootDir: null })
        const readIds: string[] = []
        const saveIds: string[] = []
        const storage: OpenADEYjsMutationStorageAdapter = {
            ...baseStorage,
            async readDocumentUpdate(id) {
                readIds.push(id)
                return baseStorage.readDocumentUpdate(id)
            },
            async saveDocumentUpdate(id, data) {
                saveIds.push(id)
                await baseStorage.saveDocumentUpdate(id, data)
            },
        }
        const writer = createOpenADEYjsWriter(storage, {
            createId: () => "generated-id",
            createSlug: () => "generated-slug",
            now: () => "2026-06-01T00:00:00.000Z",
        })
        const projection = createOpenADEYjsProjection(storage)

        await writer.createRepo({
            repoId: "repo-1",
            name: "Mutation Repo",
            path: "/tmp/mutation-repo",
            createdBy: { id: "user-1", email: "user@example.com" },
        })
        await writer.createTask({
            repoId: "repo-1",
            taskId: "task-1",
            slug: "task-1",
            title: "Mutation Task",
            input: "Exercise viewed metadata",
            createdBy: { id: "user-1", email: "user@example.com" },
            deviceId: "device-1",
            isolationStrategy: { type: "head" },
        })

        readIds.length = 0
        saveIds.length = 0
        await writer.updateTaskMetadata({
            taskId: "task-1",
            lastViewedAt: "2026-06-01T00:10:00.000Z",
        })

        expect(readIds).toEqual(["code:repos"])
        expect(saveIds).toEqual(["code:repos"])
        const snapshot = await projection.readSnapshot()
        expect(snapshot.repos[0]?.tasks[0]?.lastViewedAt).toBe("2026-06-01T00:10:00.000Z")

        readIds.length = 0
        saveIds.length = 0
        await writer.updateTaskMetadata({
            taskId: "task-1",
            lastViewedAt: "2026-06-01T00:10:00.000Z",
        })

        expect(readIds).toEqual(["code:repos"])
        expect(saveIds).toEqual([])
    })

    it("updates preview usage without saving the task document", async () => {
        const baseStorage = createOpenADENodeYjsStorage(storageDir, { legacyNestedRootDir: null })
        const readIds: string[] = []
        const saveIds: string[] = []
        const storage: OpenADEYjsMutationStorageAdapter = {
            ...baseStorage,
            async readDocumentUpdate(id) {
                readIds.push(id)
                return baseStorage.readDocumentUpdate(id)
            },
            async saveDocumentUpdate(id, data) {
                saveIds.push(id)
                await baseStorage.saveDocumentUpdate(id, data)
            },
        }
        const writer = createOpenADEYjsWriter(storage, {
            createId: () => "generated-id",
            createSlug: () => "generated-slug",
            now: () => "2026-06-01T00:00:00.000Z",
        })
        const projection = createOpenADEYjsProjection(storage)

        await writer.createRepo({
            repoId: "repo-1",
            name: "Mutation Repo",
            path: "/tmp/mutation-repo",
            createdBy: { id: "user-1", email: "user@example.com" },
        })
        await writer.createTask({
            repoId: "repo-1",
            taskId: "task-1",
            slug: "task-1",
            title: "Mutation Task",
            input: "Exercise usage metadata",
            createdBy: { id: "user-1", email: "user@example.com" },
            deviceId: "device-1",
            isolationStrategy: { type: "head" },
        })

        const usage = {
            inputTokens: 12,
            outputTokens: 34,
            totalCostUsd: 0.056,
            eventCount: 7,
            costByModel: { "claude-sonnet": 0.056 },
            durationMs: 890,
        }

        readIds.length = 0
        saveIds.length = 0
        await writer.updateTaskMetadata({
            taskId: "task-1",
            usage,
        })

        expect(readIds).toEqual(["code:task:task-1", "code:repos"])
        expect(saveIds).toEqual(["code:repos"])
        const snapshot = await projection.readSnapshot()
        expect(snapshot.repos[0]?.tasks[0]?.usage).toEqual(usage)
    })

    it("round trips MCP server settings rows through real Yjs storage", async () => {
        const storage = createOpenADENodeYjsStorage(storageDir, { legacyNestedRootDir: null })
        const stdioServer: OpenADEMCPServer = {
            id: "mcp-stdio-1",
            name: "Stdio MCP",
            transportType: "stdio",
            enabled: true,
            command: "node",
            args: ["server.js"],
            envVars: { NODE_ENV: "test" },
            cwd: "/tmp/mcp",
            healthStatus: "unknown",
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
        }
        const httpServer: OpenADEMCPServer = {
            id: "mcp-http-1",
            name: "HTTP MCP",
            transportType: "http",
            enabled: true,
            url: "https://mcp.example.test/mcp",
            headers: { "X-Test": "1" },
            oauthTokens: { accessToken: "token-1", tokenType: "Bearer", refreshToken: "refresh-1" },
            healthStatus: "healthy",
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
        }

        await expect(readYjsMcpServers(storage)).resolves.toEqual({ servers: [] })
        await expect(replaceYjsMcpServers(storage, [stdioServer])).resolves.toEqual({ servers: [stdioServer], replacedServers: 1 })
        await expect(upsertYjsMcpServer(storage, httpServer)).resolves.toEqual({ server: httpServer, created: true })
        await expect(readYjsMcpServers(storage)).resolves.toEqual({ servers: [stdioServer, httpServer] })
        await expect(deleteYjsMcpServer(storage, "mcp-stdio-1")).resolves.toEqual({ serverId: "mcp-stdio-1", deleted: true })
        await expect(readYjsMcpServers(storage)).resolves.toEqual({ servers: [httpServer] })
    })
})
