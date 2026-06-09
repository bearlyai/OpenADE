import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { Buffer } from "node:buffer"
import fs from "node:fs"
import { createServer } from "node:net"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { OpenADEClient } from "../../openade-client/src"
import { RuntimeClient } from "../../runtime-client/src"
import { createOpenADENodeYjsStorage } from "./nodeYjsStorage"
import type { OpenADETask } from "./types"
import { importOpenADELegacyYjsData } from "./yjsImport"
import { compareOpenADELegacyYjsToCore } from "./yjsImportParity"
import { createOpenADEYjsWriter } from "./yjsMutation"
import { createOpenADEYjsProjection } from "./yjsProjection"

const CORE_TOKEN = "openade-yjs-import-core-test-token"
const TEST_TIMEOUT_MS = 120_000
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(THIS_DIR, "..")
const CORE_ROOT = path.resolve(PACKAGE_ROOT, "../openade-core")

interface StartedCore {
    process: ChildProcess
    dataDir: string
    port: number
    output: () => string
}

const tempRoots: string[] = []
const startedCores: StartedCore[] = []

afterEach(async () => {
    while (startedCores.length > 0) {
        const core = startedCores.pop()
        if (core) await stopCore(core)
    }
    while (tempRoots.length > 0) {
        fs.rmSync(tempRoots.pop() ?? "", { recursive: true, force: true })
    }
})

describe("importOpenADELegacyYjsData", () => {
    it(
        "imports legacy Yjs projects, tasks, comments, and events into a real Go Core through OpenADEClient",
        async () => {
            const sourceRoot = tempRoot("openade-yjs-import-source-")
            const sourceStorage = createOpenADENodeYjsStorage(sourceRoot, { legacyNestedRootDir: null })
            const sourceWriter = createOpenADEYjsWriter(sourceStorage, {
                createId: () => "generated-id",
                createSlug: () => "generated-slug",
                now: () => "2026-06-01T00:00:00.000Z",
            })
            const sourceProjection = createOpenADEYjsProjection(sourceStorage)

            await sourceWriter.createRepo({
                repoId: "repo-legacy",
                name: "Legacy Repo",
                path: "/tmp/legacy-repo",
                createdBy: { id: "user-legacy", email: "legacy@example.com" },
                createdAt: "2026-06-01T00:00:00.000Z",
            })
            await sourceWriter.createTask({
                repoId: "repo-legacy",
                taskId: "task-legacy",
                slug: "legacy-task",
                title: "Legacy Task",
                input: "Import this legacy task",
                createdBy: { id: "user-legacy", email: "legacy@example.com" },
                deviceId: "device-legacy",
                createdAt: "2026-06-01T00:01:00.000Z",
                isolationStrategy: { type: "head" },
                enabledMcpServerIds: ["filesystem"],
            })
            await sourceWriter.setupTaskEnvironment({
                taskId: "task-legacy",
                deviceEnvironment: {
                    id: "device-legacy",
                    deviceId: "device-legacy",
                    setupComplete: true,
                    createdAt: "2026-06-01T00:01:00.000Z",
                    lastUsedAt: "2026-06-01T00:01:00.000Z",
                },
                setupEvent: {
                    eventId: "setup-legacy",
                    worktreeId: "legacy-task",
                    deviceId: "device-legacy",
                    workingDir: "/tmp/legacy-repo",
                    setupOutput: "Legacy setup complete",
                    createdAt: "2026-06-01T00:01:05.000Z",
                    completedAt: "2026-06-01T00:01:05.000Z",
                },
            })
            await sourceWriter.createActionEvent({
                taskId: "task-legacy",
                eventId: "action-legacy",
                userInput: "Do the legacy work",
                executionId: "execution-legacy",
                harnessId: "codex",
                modelId: "model-legacy",
                source: { type: "do", userLabel: "Do" },
                createdAt: "2026-06-01T00:02:00.000Z",
                images: [{ id: "action-image", ext: "png" }],
            })
            await sourceWriter.appendActionStreamEvent({
                taskId: "task-legacy",
                eventId: "action-legacy",
                streamEvent: {
                    id: "stream-legacy",
                    type: "message",
                    direction: "execution",
                    executionId: "execution-legacy",
                    harnessId: "codex",
                    message: { type: "text", text: "legacy stream" },
                },
            })
            await sourceWriter.addHyperPlanSubExecution({
                taskId: "task-legacy",
                eventId: "action-legacy",
                subExecution: {
                    stepId: "step-legacy",
                    primitive: "plan",
                    harnessId: "claude-code",
                    modelId: "model-sub",
                    executionId: "execution-sub-legacy",
                    sessionId: "session-sub-legacy",
                    status: "completed",
                    events: [
                        {
                            id: "stream-sub-legacy",
                            type: "message",
                            direction: "execution",
                            executionId: "execution-sub-legacy",
                            harnessId: "claude-code",
                            message: { type: "text", text: "legacy sub stream" },
                        },
                    ],
                    resultText: "legacy sub result",
                },
            })
            await sourceWriter.updateActionExecution({
                taskId: "task-legacy",
                eventId: "action-legacy",
                sessionId: "session-legacy",
                gitRefsAfter: { sha: "abc123", branch: "main" },
            })
            await sourceWriter.completeActionEvent({
                taskId: "task-legacy",
                eventId: "action-legacy",
                success: true,
                completedAt: "2026-06-01T00:03:00.000Z",
            })
            await sourceWriter.createSnapshotEvent({
                taskId: "task-legacy",
                eventId: "snapshot-legacy",
                actionEventId: "action-legacy",
                referenceBranch: "main",
                mergeBaseCommit: "abc123",
                fullPatch: "diff --git a/file.txt b/file.txt\nnew file mode 100644\n",
                stats: { filesChanged: 1, insertions: 1, deletions: 0 },
                files: [{ path: "file.txt", status: "added" }],
                createdAt: "2026-06-01T00:03:10.000Z",
            })
            await sourceWriter.createComment({
                taskId: "task-legacy",
                commentId: "comment-legacy",
                content: "Legacy comment",
                source: { type: "file", path: "file.txt" },
                selectedText: { text: "line", linesBefore: "", linesAfter: "" },
                author: { id: "user-legacy", email: "legacy@example.com" },
                createdAt: "2026-06-01T00:04:00.000Z",
            })
            await sourceWriter.updateTaskMetadata({
                taskId: "task-legacy",
                sessionIds: { codex: "session-legacy", claude: "session-metadata-legacy" },
                cancelledPlanEventId: "action-legacy",
                usage: {
                    usageVersion: 2,
                    inputTokens: 1234,
                    outputTokens: 456,
                    totalCostUsd: 0.0789,
                    eventCount: 3,
                    costByModel: { "model-legacy": 0.0789 },
                    durationMs: 98_765,
                },
                queuedTurns: [
                    {
                        id: "queued-legacy",
                        clientRequestId: "legacy-queued-request",
                        type: "do",
                        input: "Do later",
                        status: "queued",
                        createdAt: "2026-06-01T00:05:00.000Z",
                        updatedAt: "2026-06-01T00:05:00.000Z",
                        eventId: "queued-action-legacy",
                        appendSystemPrompt: "Use the migrated context",
                        enabledMcpServerIds: ["filesystem"],
                        harnessId: "codex",
                        modelId: "model-queued",
                        label: "Queued Do",
                        includeComments: true,
                        images: [{ id: "queued-image", ext: "png" }],
                        thinking: "high",
                        fastMode: true,
                    },
                ],
            })

            const core = await startCore()
            const runtime = new RuntimeClient({
                url: runtimeUrl(core.port),
                token: CORE_TOKEN,
                clientName: "OpenADE Legacy Import Test",
                clientPlatform: "cli",
                reconnect: false,
            })
            const client = new OpenADEClient({
                runtime,
                clientName: "OpenADE Legacy Import Test",
                clientPlatform: "cli",
            })

            try {
                const result = await importOpenADELegacyYjsData(sourceProjection, client)
                const parity = await compareOpenADELegacyYjsToCore(sourceProjection, client)

                expect(result).toMatchObject({
                    scannedRepos: 1,
                    importedRepos: 1,
                    scannedTasks: 1,
                    importedTasks: 1,
                    importedSetupEvents: 1,
                    importedActionEvents: 1,
                    importedActionStreamEvents: 1,
                    importedHyperPlanSubExecutions: 1,
                    importedSnapshotEvents: 1,
                    importedComments: 1,
                    importedQueuedTurns: 1,
                    skipped: [],
                    errors: [],
                })
                expect(parity).toMatchObject({ scannedRepos: 1, scannedTasks: 1, mismatches: [] })

                const snapshot = await client.getSnapshot()
                expect(snapshot.repos).toEqual([
                    expect.objectContaining({
                        id: "repo-legacy",
                        name: "Legacy Repo",
                        tasks: [
                            expect.objectContaining({
                                id: "task-legacy",
                                title: "Legacy Task",
                                usage: {
                                    usageVersion: 2,
                                    inputTokens: 1234,
                                    outputTokens: 456,
                                    totalCostUsd: 0.0789,
                                    eventCount: 3,
                                    costByModel: { "model-legacy": 0.0789 },
                                    durationMs: 98_765,
                                },
                            }),
                        ],
                    }),
                ])

                const task = await client.getTask("repo-legacy", "task-legacy", { hydrateSessionEvents: true })
                expect(task.title).toBe("Legacy Task")
                expect(task.description).toBe("Import this legacy task")
                expect(task.createdBy).toEqual({ id: "user-legacy", email: "legacy@example.com" })
                expect(task.enabledMcpServerIds).toEqual(["filesystem"])
                expect(task.sessionIds).toEqual({ codex: "session-legacy", claude: "session-metadata-legacy" })
                expect(task.cancelledPlanEventId).toBe("action-legacy")
                expect(task.comments).toEqual([expect.objectContaining({ id: "comment-legacy", body: "Legacy comment", content: "Legacy comment" })])
                expect(task.queuedTurns).toEqual([
                    expect.objectContaining({
                        id: "queued-legacy",
                        clientRequestId: "legacy-queued-request",
                        status: "queued",
                        input: "Do later",
                        eventId: "queued-action-legacy",
                        appendSystemPrompt: "Use the migrated context",
                        enabledMcpServerIds: ["filesystem"],
                        harnessId: "codex",
                        modelId: "model-queued",
                        label: "Queued Do",
                        includeComments: true,
                        thinking: "high",
                        fastMode: true,
                    }),
                ])
                expect(task.queuedTurns?.[0]?.images).toEqual([expect.objectContaining({ id: "queued-image", ext: "png" })])

                const setup = taskEvent(task, "setup-legacy")
                expect(setup).toMatchObject({ type: "setup_environment", status: "completed", setupOutput: "Legacy setup complete" })

                const action = taskEvent(task, "action-legacy")
                const actionExecution = record(action.execution)
                expect(action).toMatchObject({ type: "action", status: "completed", userInput: "Do the legacy work" })
                expect(action.images).toEqual([expect.objectContaining({ id: "action-image", ext: "png" })])
                expect(action.hyperplanSubExecutions).toEqual([
                    expect.objectContaining({
                        stepId: "step-legacy",
                        sessionId: "session-sub-legacy",
                        status: "completed",
                        resultText: "legacy sub result",
                    }),
                ])
                expect(actionExecution).toMatchObject({ executionId: "execution-legacy", sessionId: "session-legacy" })
                expect(actionExecution?.events).toEqual([expect.objectContaining({ id: "stream-legacy", message: { type: "text", text: "legacy stream" } })])

                const snapshotEvent = taskEvent(task, "snapshot-legacy")
                expect(snapshotEvent).toMatchObject({
                    type: "snapshot",
                    status: "completed",
                    actionEventId: "action-legacy",
                    patchFileId: "snapshot-legacy",
                })

                const inventory = await client.readTaskResourceInventory({ repoId: "repo-legacy", taskId: "task-legacy" })
                expect(inventory).toMatchObject({
                    repoId: "repo-legacy",
                    taskId: "task-legacy",
                    taskTitle: "Legacy Task",
                    isRunning: false,
                    snapshotIds: ["snapshot-legacy"],
                    images: [expect.objectContaining({ id: "action-image", ext: "png" })],
                    sessions: expect.arrayContaining([
                        expect.objectContaining({ sessionId: "session-legacy", harnessId: "codex" }),
                        expect.objectContaining({ sessionId: "session-sub-legacy", harnessId: "claude-code" }),
                        expect.objectContaining({ sessionId: "session-metadata-legacy", harnessId: "claude-code" }),
                    ]),
                    worktree: null,
                })

                await client.updateTaskMetadata({ taskId: "task-legacy", title: "Changed after import", clientRequestId: "parity-negative-title" })
                const mismatchReport = await compareOpenADELegacyYjsToCore(sourceProjection, client)
                expect(mismatchReport.mismatches).toContainEqual(
                    expect.objectContaining({
                        scope: "task",
                        repoId: "repo-legacy",
                        taskId: "task-legacy",
                        field: "title",
                        legacy: "Legacy Task",
                        core: "Changed after import",
                    })
                )
            } finally {
                client.close()
            }
        },
        TEST_TIMEOUT_MS
    )

    it(
        "runs the copied-data import and parity CLI against a real Go Core using the canonical data/yjs layout",
        async () => {
            const dataRoot = tempRoot("openade-yjs-import-cli-data-")
            const sourceRoot = path.join(dataRoot, "yjs")
            fs.mkdirSync(sourceRoot, { recursive: true })
            const cliRepoRoot = tempRoot("openade-yjs-import-cli-repo-")
            const claudeHome = tempRoot("openade-yjs-import-cli-claude-")
            const codexHome = tempRoot("openade-yjs-import-cli-codex-")
            const sourceStorage = createOpenADENodeYjsStorage(sourceRoot, { legacyNestedRootDir: null })
            const sourceWriter = createOpenADEYjsWriter(sourceStorage, {
                createId: () => "generated-id",
                createSlug: () => "generated-slug",
                now: () => "2026-06-01T00:00:00.000Z",
            })

            await sourceWriter.createRepo({
                repoId: "repo-cli",
                name: "CLI Repo",
                path: cliRepoRoot,
                createdBy: { id: "user-cli", email: "cli@example.com" },
                createdAt: "2026-06-01T00:00:00.000Z",
            })
            await sourceWriter.createTask({
                repoId: "repo-cli",
                taskId: "task-cli",
                slug: "cli-task",
                title: "CLI Task",
                input: "Import this task from the CLI",
                createdBy: { id: "user-cli", email: "cli@example.com" },
                deviceId: "device-cli",
                createdAt: "2026-06-01T00:01:00.000Z",
                isolationStrategy: { type: "head" },
                enabledMcpServerIds: ["filesystem"],
            })
            await sourceWriter.createActionEvent({
                taskId: "task-cli",
                eventId: "action-cli",
                userInput: "Do CLI work",
                executionId: "execution-cli",
                harnessId: "codex",
                modelId: "model-cli",
                source: { type: "do", userLabel: "Do" },
                createdAt: "2026-06-01T00:02:00.000Z",
                images: [{ id: "action-image", ext: "png", mediaType: "image/png" }],
            })
            const codexSessionId = "44444444-4444-4444-4444-444444444444"
            await sourceWriter.updateActionExecution({
                taskId: "task-cli",
                eventId: "action-cli",
                sessionId: codexSessionId,
            })
            await sourceWriter.completeActionEvent({
                taskId: "task-cli",
                eventId: "action-cli",
                success: true,
                completedAt: "2026-06-01T00:03:00.000Z",
            })
            await sourceWriter.createSnapshotEvent({
                taskId: "task-cli",
                eventId: "snapshot-cli",
                actionEventId: "action-cli",
                referenceBranch: "main",
                mergeBaseCommit: "abc123",
                fullPatch: "",
                patchFileId: "snapshot-cli",
                stats: { filesChanged: 1, insertions: 1, deletions: 0 },
                files: [{ path: "cli.txt", status: "added" }],
                createdAt: "2026-06-01T00:03:10.000Z",
            })
            await sourceWriter.updateTaskMetadata({
                taskId: "task-cli",
                sessionIds: { claude: "claude-cli-session" },
                cancelledPlanEventId: "cancelled-cli",
                usage: {
                    usageVersion: 2,
                    inputTokens: 12,
                    outputTokens: 34,
                    totalCostUsd: 0.0056,
                    eventCount: 1,
                    costByModel: { "model-cli": 0.0056 },
                    durationMs: 789,
                },
            })
            const imageBytes = Buffer.from("legacy cli image bytes", "utf8")
            const patchText = "diff --git a/cli.txt b/cli.txt\n--- a/cli.txt\n+++ b/cli.txt\n@@ -0,0 +1 @@\n+cli\n"
            const claudeSessionText = "{\"type\":\"claude-cli\"}\n"
            const codexSessionText = "{\"type\":\"codex-cli\"}\n"
            const imageDir = path.join(dataRoot, "images")
            const snapshotDir = path.join(dataRoot, "snapshots")
            fs.mkdirSync(imageDir, { recursive: true })
            fs.mkdirSync(snapshotDir, { recursive: true })
            fs.writeFileSync(path.join(imageDir, "action-image.png"), imageBytes)
            fs.writeFileSync(path.join(snapshotDir, "snapshot-cli.patch"), patchText)
            const claudeProjectDir = path.join(claudeHome, "projects", encodeClaudeProjectPath(cliRepoRoot))
            fs.mkdirSync(claudeProjectDir, { recursive: true })
            fs.writeFileSync(path.join(claudeProjectDir, "claude-cli-session.jsonl"), claudeSessionText)
            const codexSessionPath = path.join(codexHome, "sessions", "2026", "06", "08", `rollout-2026-06-08T18-00-00-${codexSessionId}.jsonl`)
            fs.mkdirSync(path.dirname(codexSessionPath), { recursive: true })
            fs.writeFileSync(codexSessionPath, codexSessionText)

            const core = await startCore()
            const cli = spawnSync(
                process.execPath,
                [
                    "scripts/run-yjs-import-core.mjs",
                    "--data-dir",
                    sourceRoot,
                    "--core-url",
                    runtimeUrl(core.port),
                    "--token",
                    CORE_TOKEN,
                    "--import-resources",
                    "--import-sessions",
                    "--claude-config-dir",
                    claudeHome,
                    "--codex-home",
                    codexHome,
                ],
                { cwd: PACKAGE_ROOT, encoding: "utf8" }
            )

            expect(cli.status, cli.stderr || cli.stdout).toBe(0)
            const report = record(JSON.parse(cli.stdout))
            expect(report).toMatchObject({ ok: true })
            expect(record(report?.imported)).toMatchObject({
                scannedRepos: 1,
                importedRepos: 1,
                scannedTasks: 1,
                importedTasks: 1,
                skipped: [],
                errors: [],
            })
            expect(record(report?.importedResources)).toMatchObject({
                images: expect.objectContaining({
                    referencedImages: 1,
                    importedImages: 1,
                    missingImages: [],
                    conflictedImages: [],
                    failedImages: [],
                }),
                snapshots: expect.objectContaining({
                    referencedPatches: 1,
                    importedPatches: 1,
                    missingPatches: [],
                    conflictedPatches: [],
                    failedPatches: [],
                }),
                sessions: expect.objectContaining({
                    referencedSessions: 2,
                    importedSessions: 2,
                    alreadyImportedSessions: 0,
                    missingSessions: [],
                    conflictedSessions: [],
                    failedSessions: [],
                }),
                skipped: [],
            })
            expect(record(report?.parity)).toMatchObject({ scannedRepos: 1, scannedTasks: 1, mismatches: [] })

            const runtime = new RuntimeClient({
                url: runtimeUrl(core.port),
                token: CORE_TOKEN,
                clientName: "OpenADE Legacy Import Test",
                clientPlatform: "cli",
                reconnect: false,
            })
            const client = new OpenADEClient({
                runtime,
                clientName: "OpenADE Legacy Import Test",
                clientPlatform: "cli",
            })
            try {
                const image = await client.readTaskImage({ repoId: "repo-cli", taskId: "task-cli", imageId: "action-image", ext: "png" })
                expect(image).toMatchObject({
                    mediaType: "image/png",
                    data: imageBytes.toString("base64"),
                })
                const patch = await client.readTaskSnapshotPatch({ repoId: "repo-cli", taskId: "task-cli", eventId: "snapshot-cli" })
                expect(patch).toMatchObject({
                    patchFileId: "snapshot-cli",
                    patch: patchText,
                })
                expect(fs.readFileSync(path.join(core.dataDir, "blobs", "sessions", "claude-code", "claude-cli-session.jsonl"), "utf8")).toBe(
                    claudeSessionText
                )
                expect(fs.readFileSync(path.join(core.dataDir, "blobs", "sessions", "codex", `${codexSessionId}.jsonl`), "utf8")).toBe(codexSessionText)
            } finally {
                client.close()
            }

            const coreDataDir = core.dataDir
            await stopCore(core)
            const restartedCore = await startCore(coreDataDir)
            const rerun = spawnSync(
                process.execPath,
                [
                    "scripts/run-yjs-import-core.mjs",
                    "--data-dir",
                    sourceRoot,
                    "--core-url",
                    runtimeUrl(restartedCore.port),
                    "--token",
                    CORE_TOKEN,
                    "--import-resources",
                    "--import-sessions",
                    "--claude-config-dir",
                    claudeHome,
                    "--codex-home",
                    codexHome,
                ],
                { cwd: PACKAGE_ROOT, encoding: "utf8" }
            )
            expect(rerun.status, rerun.stderr || rerun.stdout).toBe(0)
            const rerunReport = record(JSON.parse(rerun.stdout))
            expect(rerunReport).toMatchObject({ ok: true })
            expect(record(rerunReport?.imported)).toMatchObject({
                scannedRepos: 1,
                importedRepos: 1,
                scannedTasks: 1,
                importedTasks: 1,
                skipped: [],
                errors: [],
            })
            expect(record(rerunReport?.importedResources)).toMatchObject({
                images: expect.objectContaining({
                    referencedImages: 1,
                    importedImages: 0,
                    alreadyImportedImages: 1,
                    missingImages: [],
                    conflictedImages: [],
                    failedImages: [],
                }),
                snapshots: expect.objectContaining({
                    referencedPatches: 1,
                    importedPatches: 0,
                    alreadyImportedPatches: 1,
                    missingPatches: [],
                    conflictedPatches: [],
                    failedPatches: [],
                }),
                sessions: expect.objectContaining({
                    referencedSessions: 2,
                    importedSessions: 0,
                    alreadyImportedSessions: 2,
                    missingSessions: [],
                    conflictedSessions: [],
                    failedSessions: [],
                }),
                skipped: [],
            })
            expect(record(rerunReport?.parity)).toMatchObject({ scannedRepos: 1, scannedTasks: 1, mismatches: [] })
        },
        TEST_TIMEOUT_MS
    )

    it(
        "fails the copied-data CLI when requested resource imports are skipped",
        async () => {
            const sourceRoot = tempRoot("openade-yjs-import-cli-missing-resources-")
            const sourceStorage = createOpenADENodeYjsStorage(sourceRoot, { legacyNestedRootDir: null })
            const sourceWriter = createOpenADEYjsWriter(sourceStorage, {
                createId: () => "generated-id",
                createSlug: () => "generated-slug",
                now: () => "2026-06-01T00:00:00.000Z",
            })

            await sourceWriter.createRepo({
                repoId: "repo-missing-resources",
                name: "Missing Resources Repo",
                path: tempRoot("openade-yjs-import-cli-missing-resources-repo-"),
                createdBy: { id: "user-cli", email: "cli@example.com" },
                createdAt: "2026-06-01T00:00:00.000Z",
            })
            await sourceWriter.createTask({
                repoId: "repo-missing-resources",
                taskId: "task-missing-resources",
                slug: "missing-resources-task",
                title: "Missing Resources Task",
                input: "Verify copied resource directories",
                createdBy: { id: "user-cli", email: "cli@example.com" },
                deviceId: "device-cli",
                createdAt: "2026-06-01T00:01:00.000Z",
                isolationStrategy: { type: "head" },
            })
            await sourceWriter.createActionEvent({
                taskId: "task-missing-resources",
                eventId: "action-missing-resources",
                userInput: "Reference a missing legacy image",
                executionId: "execution-missing-resources",
                harnessId: "codex",
                modelId: "model-cli",
                source: { type: "do", userLabel: "Do" },
                createdAt: "2026-06-01T00:02:00.000Z",
                images: [{ id: "missing-resource-image", ext: "png", mediaType: "image/png" }],
            })

            const core = await startCore()
            const cli = spawnSync(
                process.execPath,
                [
                    "scripts/run-yjs-import-core.mjs",
                    "--data-dir",
                    sourceRoot,
                    "--core-url",
                    runtimeUrl(core.port),
                    "--token",
                    CORE_TOKEN,
                    "--import-resources",
                ],
                { cwd: PACKAGE_ROOT, encoding: "utf8" }
            )

            expect(cli.status, cli.stderr || cli.stdout).toBe(1)
            const report = record(JSON.parse(cli.stdout))
            expect(report).toMatchObject({ ok: false })
            expect(record(report?.imported)).toMatchObject({
                scannedRepos: 1,
                importedRepos: 1,
                scannedTasks: 1,
                importedTasks: 1,
                skipped: [],
                errors: [],
            })
            expect(record(report?.parity)).toMatchObject({ scannedRepos: 1, scannedTasks: 1, mismatches: [] })
            const importedResources = record(report?.importedResources)
            expect(importedResources).toMatchObject({
                images: null,
                snapshots: expect.objectContaining({
                    referencedPatches: 0,
                    missingPatches: [],
                    conflictedPatches: [],
                    failedPatches: [],
                }),
                sessions: null,
                skipped: [expect.objectContaining({ kind: "images", code: "source_missing" })],
            })
        },
        TEST_TIMEOUT_MS
    )
})

function taskEvent(task: OpenADETask, eventId: string): Record<string, unknown> {
    const event = task.events.map(record).find((candidate) => candidate?.id === eventId)
    if (!event) throw new Error(`Task event ${eventId} was not imported`)
    return event
}

function record(value: unknown): Record<string, unknown> | null {
    return isRecord(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function tempRoot(prefix: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    tempRoots.push(root)
    return root
}

function encodeClaudeProjectPath(cwd: string): string {
    return cwd.replaceAll("/", "-").replaceAll("\\", "-")
}

async function startCore(dataDirOverride?: string): Promise<StartedCore> {
    const port = await getAvailablePort()
    const dataDir = dataDirOverride ?? tempRoot("openade-yjs-import-core-")
    let output = ""
    const coreProcess = spawn("go", ["run", "./cmd/openade-core"], {
        cwd: CORE_ROOT,
        env: {
            ...process.env,
            OPENADE_CORE_HOST: "127.0.0.1",
            OPENADE_CORE_PORT: String(port),
            OPENADE_CORE_DATA_DIR: dataDir,
            OPENADE_CORE_TOKEN: CORE_TOKEN,
            OPENADE_CORE_ALLOW_UNAUTHENTICATED_LOOPBACK: "false",
            OPENADE_CORE_SLOW_REQUEST_MS: "5000",
        },
        stdio: ["ignore", "pipe", "pipe"],
    })

    coreProcess.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8")
    })
    coreProcess.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8")
    })

    const core: StartedCore = {
        process: coreProcess,
        dataDir,
        port,
        output: () => output,
    }
    startedCores.push(core)

    await waitForCoreHealth(core)
    return core
}

async function stopCore(core: StartedCore): Promise<void> {
    if (core.process.exitCode === null) {
        await new Promise<void>((resolve) => {
            const killTimer = globalThis.setTimeout(() => {
                core.process.kill("SIGKILL")
                resolve()
            }, 5_000)
            core.process.once("exit", () => {
                globalThis.clearTimeout(killTimer)
                resolve()
            })
            core.process.kill("SIGTERM")
        })
    }
}

async function waitForCoreHealth(core: StartedCore): Promise<void> {
    let lastError = ""
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (core.process.exitCode !== null) {
            throw new Error(`OpenADE Core exited before health check passed.\n${core.output()}`)
        }
        try {
            const response = await fetch(`http://127.0.0.1:${core.port}/v1/health`)
            if (response.ok) return
            lastError = `HTTP ${response.status}`
        } catch (error) {
            lastError = error instanceof Error ? error.message : "health request failed"
        }
        await delay(250)
    }
    throw new Error(`OpenADE Core did not become healthy: ${lastError}\n${core.output()}`)
}

async function getAvailablePort(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        const server = createServer()
        server.unref()
        server.on("error", reject)
        server.listen(0, "127.0.0.1", () => {
            const address = server.address()
            if (!address || typeof address === "string") {
                server.close()
                reject(new Error("Failed to allocate TCP port"))
                return
            }
            const port = address.port
            server.close((error) => {
                if (error) reject(error)
                else resolve(port)
            })
        })
    })
}

function runtimeUrl(port: number): string {
    return `ws://127.0.0.1:${port}/v1/runtime`
}
