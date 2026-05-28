import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as Y from "yjs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { RuntimeMessage } from "../../../../runtime-protocol/src"
import { saveYjsDocument } from "../code/yjsStorage"
import { getRuntimeServer, resetRuntimeServer } from "./runtimeGateway"

const harnessMock = vi.hoisted(() => ({
    startRuntimeHarnessQuery: vi.fn(),
    abortRuntimeHarnessQuery: vi.fn(),
    clearRuntimeHarnessBuffer: vi.fn(),
    checkRuntimeHarnessStatus: vi.fn(),
    deleteRuntimeHarnessSession: vi.fn(),
    reconnectRuntimeHarnessQuery: vi.fn(),
    respondRuntimeHarnessTool: vi.fn(),
    structuredRuntimeHarnessQuery: vi.fn(),
}))
const gitMock = vi.hoisted(() => ({
    checkRuntimeGhCli: vi.fn(),
    commitRuntimeWorkTree: vi.fn(),
    deleteRuntimeBranch: vi.fn(),
    deleteRuntimeWorkTree: vi.fn(),
    getRuntimeChangedFiles: vi.fn(),
    getRuntimeCommitFilePatch: vi.fn(),
    getRuntimeCommitFiles: vi.fn(),
    getRuntimeFileAtTreeish: vi.fn(),
    getRuntimeFilePair: vi.fn(),
    getRuntimeGitLog: vi.fn(),
    getRuntimeGitStatus: vi.fn(),
    getRuntimeGitSummary: vi.fn(),
    getRuntimeMergeBase: vi.fn(),
    getRuntimeWorkTreeDiffPatch: vi.fn(),
    getRuntimeWorktreeFilePatch: vi.fn(),
    getOrCreateRuntimeWorkTree: vi.fn(),
    initRuntimeGit: vi.fn(),
    isRuntimeBranchMerged: vi.fn(),
    isRuntimeGitInstalled: vi.fn(),
    isRuntimeGitDirectory: vi.fn(),
    listRuntimeBranches: vi.fn(),
    listRuntimeGitFiles: vi.fn(),
    listRuntimeWorkTrees: vi.fn(),
    resolveRuntimeGitPath: vi.fn(),
}))

vi.mock("../code/harness", () => harnessMock)
vi.mock("../code/git", () => gitMock)

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

let storageDir = ""
let tempHome = ""

function toY(value: JsonValue): JsonValue | Y.Map<unknown> | Y.Array<unknown> {
    if (Array.isArray(value)) {
        const yArray = new Y.Array<unknown>()
        yArray.push(value.map(toY))
        return yArray
    }

    if (value && typeof value === "object") {
        const yMap = new Y.Map<unknown>()
        for (const [key, nested] of Object.entries(value)) {
            yMap.set(key, toY(nested))
        }
        return yMap
    }

    return value
}

function pushOrdered(doc: Y.Doc, name: string, rows: Array<Record<string, JsonValue> & { id: string }>): void {
    const dataMap = doc.getMap<Y.Map<unknown>>(`${name}:data`)
    const orderArray = doc.getArray<string>(`${name}:order`)
    for (const row of rows) {
        dataMap.set(row.id, toY(row) as Y.Map<unknown>)
        orderArray.push([row.id])
    }
}

async function saveDoc(id: string, build: (doc: Y.Doc) => void): Promise<void> {
    const doc = new Y.Doc()
    try {
        build(doc)
        await saveYjsDocument(id, Y.encodeStateAsUpdate(doc))
    } finally {
        doc.destroy()
    }
}

async function seedExistingTaskWithCompletedPlan(taskId: string): Promise<void> {
    const createdAt = "2026-05-26T00:00:00.000Z"
    await saveDoc("code:repos", (doc) => {
        pushOrdered(doc, "repos", [
            {
                id: "repo-1",
                name: "Runtime Repo",
                path: "/tmp/runtime-repo",
                archived: false,
                createdAt,
                updatedAt: createdAt,
                createdBy: { id: "user-1", email: "user@example.com" },
                tasks: [{ id: taskId, slug: taskId, title: "Existing Task", createdAt }],
            },
        ])
    })
    await saveDoc(`code:task:${taskId}`, (doc) => {
        const meta = doc.getMap("task:meta")
        meta.set("id", taskId)
        meta.set("repoId", "repo-1")
        meta.set("slug", taskId)
        meta.set("title", "Existing Task")
        meta.set("description", "Existing task")
        meta.set("isolationStrategy", toY({ type: "head" }))
        meta.set("sessionIds", toY({}))
        meta.set("createdBy", toY({ id: "user-1", email: "user@example.com" }))
        meta.set("createdAt", createdAt)
        meta.set("updatedAt", createdAt)
        pushOrdered(doc, "task:deviceEnvironments", [
            { id: "device-1", deviceId: "device-1", setupComplete: true, createdAt, lastUsedAt: createdAt },
        ])
        pushOrdered(doc, "task:comments", [
            {
                id: "comment-1",
                content: "Address this plan note",
                source: { type: "plan", eventId: "plan-1", lineStart: 2, lineEnd: 3 },
                selectedText: { text: "Plan line", linesBefore: "Before", linesAfter: "After" },
                author: { id: "user-1", email: "user@example.com" },
                createdAt,
            },
        ])
        pushOrdered(doc, "task:events", [
            {
                id: "plan-1",
                type: "action",
                status: "completed",
                createdAt,
                completedAt: createdAt,
                userInput: "Make a plan",
                source: { type: "plan", userLabel: "Plan" },
                includesCommentIds: [],
                execution: {
                    harnessId: "claude-code",
                    executionId: "execution-plan-1",
                    modelId: "sonnet",
                    events: [],
                    gitRefsBefore: { sha: "abc123", branch: "main" },
                },
                result: { success: true },
            },
        ])
    })
}

async function seedExistingTaskWithSessionBackedAction(taskId: string, sessionId: string): Promise<void> {
    const createdAt = "2026-05-26T00:00:00.000Z"
    await saveDoc("code:repos", (doc) => {
        pushOrdered(doc, "repos", [
            {
                id: "repo-1",
                name: "Runtime Repo",
                path: "/tmp/runtime-repo",
                archived: false,
                createdAt,
                updatedAt: createdAt,
                createdBy: { id: "user-1", email: "user@example.com" },
                tasks: [{ id: taskId, slug: taskId, title: "Session Task", createdAt }],
            },
        ])
    })
    await saveDoc(`code:task:${taskId}`, (doc) => {
        const meta = doc.getMap("task:meta")
        meta.set("id", taskId)
        meta.set("repoId", "repo-1")
        meta.set("slug", taskId)
        meta.set("title", "Session Task")
        meta.set("description", "Session task")
        meta.set("isolationStrategy", toY({ type: "head" }))
        meta.set("sessionIds", toY({}))
        meta.set("createdBy", toY({ id: "user-1", email: "user@example.com" }))
        meta.set("createdAt", createdAt)
        meta.set("updatedAt", createdAt)
        pushOrdered(doc, "task:deviceEnvironments", [
            { id: "device-1", deviceId: "device-1", setupComplete: true, createdAt, lastUsedAt: createdAt },
        ])
        pushOrdered(doc, "task:events", [
            {
                id: "action-1",
                type: "action",
                status: "completed",
                createdAt,
                completedAt: createdAt,
                userInput: "Use session",
                source: { type: "do", userLabel: "Do" },
                includesCommentIds: [],
                execution: {
                    harnessId: "claude-code",
                    executionId: "execution-session-1",
                    sessionId,
                    events: [],
                },
                result: { success: true },
            },
        ])
    })
}

async function writeClaudeSession(cwd: string, sessionId: string, rows: Record<string, JsonValue>[]): Promise<void> {
    const claudeHome = path.join(tempHome, ".claude")
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeHome)
    const projectDir = path.join(claudeHome, "projects", cwd.replace(/[/\\]/g, "-"))
    await fs.promises.mkdir(projectDir, { recursive: true })
    await fs.promises.writeFile(path.join(projectDir, `${sessionId}.jsonl`), rows.map((row) => JSON.stringify(row)).join("\n") + "\n")
}

function connection() {
    return {
        id: "trusted-runtime-turn-start-test",
        send(_message: RuntimeMessage) {},
    }
}

describe("OpenADE runtime turn start integration", () => {
    beforeEach(async () => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-runtime-turn-start-"))
        tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openade-runtime-home-"))
        process.env.OPENADE_YJS_STORAGE_DIR = storageDir
        process.env.OPENADE_RUNTIME_CHECKPOINT_FILE = path.join(storageDir, "runtime-checkpoints.json")
        vi.stubEnv("HOME", tempHome)
        vi.stubEnv("USERPROFILE", tempHome)
        harnessMock.startRuntimeHarnessQuery.mockReset()
        harnessMock.startRuntimeHarnessQuery.mockResolvedValue({ ok: true })
        harnessMock.abortRuntimeHarnessQuery.mockReset()
        harnessMock.abortRuntimeHarnessQuery.mockReturnValue({ ok: true })
        harnessMock.clearRuntimeHarnessBuffer.mockReset()
        harnessMock.clearRuntimeHarnessBuffer.mockReturnValue({ ok: true })
        harnessMock.checkRuntimeHarnessStatus.mockReset()
        harnessMock.checkRuntimeHarnessStatus.mockReturnValue({})
        harnessMock.deleteRuntimeHarnessSession.mockReset()
        harnessMock.deleteRuntimeHarnessSession.mockResolvedValue({ ok: true })
        harnessMock.reconnectRuntimeHarnessQuery.mockReset()
        harnessMock.reconnectRuntimeHarnessQuery.mockReturnValue({ ok: true, found: false })
        harnessMock.respondRuntimeHarnessTool.mockReset()
        harnessMock.respondRuntimeHarnessTool.mockReturnValue({ ok: true })
        harnessMock.structuredRuntimeHarnessQuery.mockReset()
        harnessMock.structuredRuntimeHarnessQuery.mockResolvedValue({ ok: true })
        for (const value of Object.values(gitMock)) value.mockReset()
        gitMock.getRuntimeGitSummary.mockResolvedValue({ headCommit: "abc123", branch: "main" })
        gitMock.isRuntimeGitDirectory.mockResolvedValue({
            isGitDirectory: true,
            repoRoot: "/tmp/runtime-repo",
            relativePath: "packages/app",
            mainBranch: "main",
            hasGhCli: true,
        })
        gitMock.getOrCreateRuntimeWorkTree.mockResolvedValue({
            worktreeDir: "/tmp/openade-worktree",
            matchingDir: "/tmp/openade-worktree",
            created: true,
        })
        gitMock.getRuntimeMergeBase.mockResolvedValue({ mergeBaseCommit: "mergebase1234567890" })
        gitMock.getRuntimeChangedFiles.mockResolvedValue({ files: [], fromTreeish: "HEAD", toTreeish: "" })
        gitMock.getRuntimeWorktreeFilePatch.mockResolvedValue({
            patch: "",
            truncated: false,
            heavy: false,
            stats: { insertions: 0, deletions: 0, changedLines: 0, hunkCount: 0 },
        })
        resetRuntimeServer()

        await saveDoc("code:repos", (doc) => {
            pushOrdered(doc, "repos", [
                {
                    id: "repo-1",
                    name: "Runtime Repo",
                    path: "/tmp/runtime-repo",
                    archived: false,
                    createdAt: "2026-05-26T00:00:00.000Z",
                    updatedAt: "2026-05-26T00:00:00.000Z",
                    createdBy: { id: "user-1", email: "user@example.com" },
                    tasks: [],
                },
            ])
        })
    })

    afterEach(() => {
        resetRuntimeServer()
        delete process.env.OPENADE_YJS_STORAGE_DIR
        delete process.env.OPENADE_RUNTIME_CHECKPOINT_FILE
        vi.unstubAllEnvs()
        fs.rmSync(storageDir, { recursive: true, force: true })
        fs.rmSync(tempHome, { recursive: true, force: true })
    })

    it("creates head-mode task documents and starts execution in main without the renderer", async () => {
        const runtime = getRuntimeServer()
        const response = await runtime.handleRequest(
            { id: 1, method: "openade/turn/start", params: { repoId: "repo-1", type: "do", input: "Create Runtime Task" } },
            connection()
        )

        expect(response.error).toBeUndefined()
        expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledTimes(1)
        expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: "Create Runtime Task",
                options: expect.objectContaining({
                    harnessId: "claude-code",
                    cwd: "/tmp/runtime-repo",
                    mode: undefined,
                    processLabel: expect.stringContaining("OpenADE"),
                }),
            })
        )

        const taskId = (response.result as { taskId: string }).taskId

        const task = await runtime.handleRequest({ id: 2, method: "openade/task/read", params: { repoId: "repo-1", taskId } }, connection())
        expect(task.error).toBeUndefined()
        expect(task.result).toMatchObject({
            id: taskId,
            repoId: "repo-1",
            title: "Create Runtime Task",
            description: "Create Runtime Task",
            events: [
                expect.objectContaining({
                    type: "action",
                    status: "in_progress",
                    userInput: "Create Runtime Task",
                    source: { type: "do", userLabel: "Do" },
                    execution: expect.objectContaining({
                        harnessId: "claude-code",
                        gitRefsBefore: { sha: "abc123", branch: "main" },
                    }),
                }),
            ],
        })
        const event = (task.result as { events: Array<{ id: string; execution: { executionId: string } }> }).events[0]
        expect(runtime.supervisor.list({ ownerType: "openade-task" }).find((record) => record.scope.ownerId === taskId)?.scope.labels).toMatchObject({
            eventId: event.id,
            executionId: event.execution.executionId,
        })
    })

    it("passes image attachments through server-owned turn starts without dropping task history", async () => {
        const imageDir = path.join(tempHome, ".openade", "data", "images")
        fs.mkdirSync(imageDir, { recursive: true })
        fs.writeFileSync(path.join(imageDir, "runtime-image.png"), Buffer.from("image-bytes"))

        const runtime = getRuntimeServer()
        const response = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-1",
                    type: "do",
                    input: "Use this image",
                    images: [{ id: "runtime-image", ext: "png", mediaType: "image/png", width: 1, height: 1 }],
                },
            },
            connection()
        )

        expect(response.error).toBeUndefined()
        expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: [
                    { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("image-bytes").toString("base64") } },
                    { type: "text", text: "Use this image" },
                ],
            })
        )

        const taskId = (response.result as { taskId: string }).taskId
        const task = await runtime.handleRequest({ id: 2, method: "openade/task/read", params: { repoId: "repo-1", taskId } }, connection())
        const events = (task.result as { events: Array<{ images?: unknown[] }> }).events
        expect(events[0].images).toEqual([{ id: "runtime-image", ext: "png", mediaType: "image/png", width: 1, height: 1 }])
    })

    it("honors custom labels and comment-consumption flags for existing task turns", async () => {
        const createdAt = "2026-05-26T00:00:00.000Z"
        await saveDoc("code:repos", (doc) => {
            pushOrdered(doc, "repos", [
                {
                    id: "repo-1",
                    name: "Runtime Repo",
                    path: "/tmp/runtime-repo",
                    archived: false,
                    createdAt,
                    updatedAt: createdAt,
                    createdBy: { id: "user-1", email: "user@example.com" },
                    tasks: [{ id: "existing-task", slug: "existing-task", title: "Existing Task", createdAt }],
                },
            ])
        })
        await saveDoc("code:task:existing-task", (doc) => {
            const meta = doc.getMap("task:meta")
            meta.set("id", "existing-task")
            meta.set("repoId", "repo-1")
            meta.set("slug", "existing-task")
            meta.set("title", "Existing Task")
            meta.set("description", "Existing task")
            meta.set("isolationStrategy", toY({ type: "head" }))
            meta.set("sessionIds", toY({}))
            meta.set("createdBy", toY({ id: "user-1", email: "user@example.com" }))
            meta.set("createdAt", createdAt)
            meta.set("updatedAt", createdAt)
            pushOrdered(doc, "task:deviceEnvironments", [
                { id: "device-1", deviceId: "device-1", setupComplete: true, createdAt, lastUsedAt: createdAt },
            ])
            pushOrdered(doc, "task:comments", [
                {
                    id: "comment-1",
                    content: "SECRET COMMENT SHOULD NOT BE SENT",
                    source: { type: "file", filePath: "src/app.ts", lineStart: 1, lineEnd: 1 },
                    selectedText: { text: "selected", linesBefore: "", linesAfter: "" },
                    author: { id: "user-1", email: "user@example.com" },
                    createdAt,
                },
            ])
        })

        const runtime = getRuntimeServer()
        const response = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-1",
                    inTaskId: "existing-task",
                    type: "do",
                    input: "Existing turn",
                    label: "Retry",
                    includeComments: false,
                },
            },
            connection()
        )

        expect(response.error).toBeUndefined()
        expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: "Existing turn",
            })
        )

        const task = await runtime.handleRequest({ id: 2, method: "openade/task/read", params: { repoId: "repo-1", taskId: "existing-task" } }, connection())
        expect(JSON.stringify(harnessMock.startRuntimeHarnessQuery.mock.calls[0][0].prompt)).not.toContain("SECRET COMMENT")
        expect(task.result).toMatchObject({
            events: [
                expect.objectContaining({
                    source: { type: "do", userLabel: "Retry" },
                    includesCommentIds: [],
                }),
            ],
        })
    })

    it("passes enabled MCP server configs to server-owned harness starts", async () => {
        const mcpDoc = new Y.Doc()
        pushOrdered(mcpDoc, "mcp_servers", [
            {
                id: "mcp-http",
                name: "runtime-http",
                enabled: true,
                transportType: "http",
                url: "https://mcp.example.test",
                headers: { "X-Test": "yes" },
                oauthTokens: { accessToken: "test-access-token", tokenType: "Bearer" },
                healthStatus: "healthy",
                createdAt: "2026-05-26T00:00:00.000Z",
                updatedAt: "2026-05-26T00:00:00.000Z",
            },
            {
                id: "mcp-disabled",
                name: "disabled",
                enabled: false,
                transportType: "stdio",
                command: "ignored",
                healthStatus: "unknown",
                createdAt: "2026-05-26T00:00:00.000Z",
                updatedAt: "2026-05-26T00:00:00.000Z",
            },
        ])
        await saveYjsDocument("code:mcp_servers", Y.encodeStateAsUpdate(mcpDoc))

        const runtime = getRuntimeServer()
        const response = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/turn/start",
                params: { repoId: "repo-1", type: "do", input: "Use MCP", enabledMcpServerIds: ["mcp-http", "mcp-disabled"] },
            },
            connection()
        )

        expect(response.error).toBeUndefined()
        expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    mcpServerConfigs: {
                        "runtime-http": {
                            type: "http",
                            url: "https://mcp.example.test",
                            headers: { "X-Test": "yes", Authorization: "Bearer test-access-token" },
                        },
                    },
                }),
            })
        )
    })

    it("queues do and ask turns for a task that already has a running server-owned turn and drains them after settle", async () => {
        await seedExistingTaskWithCompletedPlan("task-with-queue")
        const settleCallbacks: Array<(result: Record<string, unknown>) => void> = []
        harnessMock.startRuntimeHarnessQuery.mockImplementation(
            async (request: { onSettled?: (result: Record<string, unknown>) => void }) => {
                if (request.onSettled) settleCallbacks.push(request.onSettled)
                return { ok: true }
            }
        )

        const runtime = getRuntimeServer()
        const first = await runtime.handleRequest(
            { id: 1, method: "openade/turn/start", params: { repoId: "repo-1", inTaskId: "task-with-queue", type: "do", input: "First running turn" } },
            connection()
        )
        expect(first.error).toBeUndefined()
        expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledTimes(1)

        const queued = await runtime.handleRequest(
            {
                id: 2,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-1",
                    inTaskId: "task-with-queue",
                    type: "do",
                    input: "Queued turn",
                    clientRequestId: "queued-turn-1",
                },
            },
            connection()
        )

        expect(queued.error).toBeUndefined()
        expect(queued.result).toMatchObject({ taskId: "task-with-queue", queued: true, queuedTurnId: expect.any(String) })
        const queuedAsk = await runtime.handleRequest(
            {
                id: 3,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-1",
                    inTaskId: "task-with-queue",
                    type: "ask",
                    input: "Queued ask",
                    clientRequestId: "queued-ask-1",
                },
            },
            connection()
        )

        expect(queuedAsk.error).toBeUndefined()
        expect(queuedAsk.result).toMatchObject({ taskId: "task-with-queue", queued: true, queuedTurnId: expect.any(String) })
        expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledTimes(1)

        const queuedTask = await runtime.handleRequest({ id: 4, method: "openade/task/read", params: { repoId: "repo-1", taskId: "task-with-queue" } }, connection())
        expect(queuedTask.result).toMatchObject({
            queuedTurns: [
                expect.objectContaining({
                    id: (queued.result as { queuedTurnId: string }).queuedTurnId,
                    type: "do",
                    input: "Queued turn",
                    status: "queued",
                }),
                expect.objectContaining({
                    id: (queuedAsk.result as { queuedTurnId: string }).queuedTurnId,
                    type: "ask",
                    input: "Queued ask",
                    status: "queued",
                }),
            ],
        })

        settleCallbacks[0]?.({ status: "completed" })
        await vi.waitFor(() => {
            expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledTimes(2)
        })
        expect(harnessMock.startRuntimeHarnessQuery.mock.calls[1][0]).toMatchObject({
            prompt: expect.stringContaining("Queued turn"),
        })

        const drainedTask = await runtime.handleRequest({ id: 5, method: "openade/task/read", params: { repoId: "repo-1", taskId: "task-with-queue" } }, connection())
        expect(drainedTask.result).toMatchObject({
            queuedTurns: expect.arrayContaining([
                expect.objectContaining({
                    id: (queued.result as { queuedTurnId: string }).queuedTurnId,
                    status: "running",
                    eventId: expect.any(String),
                }),
                expect.objectContaining({
                    id: (queuedAsk.result as { queuedTurnId: string }).queuedTurnId,
                    status: "queued",
                }),
            ]),
        })
    })

    it("cancels queued turns before they drain", async () => {
        await seedExistingTaskWithCompletedPlan("task-with-cancellable-queue")
        const settleCallbacks: Array<(result: Record<string, unknown>) => void> = []
        harnessMock.startRuntimeHarnessQuery.mockImplementation(
            async (request: { onSettled?: (result: Record<string, unknown>) => void }) => {
                if (request.onSettled) settleCallbacks.push(request.onSettled)
                return { ok: true }
            }
        )

        const runtime = getRuntimeServer()
        const first = await runtime.handleRequest(
            { id: 1, method: "openade/turn/start", params: { repoId: "repo-1", inTaskId: "task-with-cancellable-queue", type: "do", input: "Running" } },
            connection()
        )
        expect(first.error).toBeUndefined()

        const queued = await runtime.handleRequest(
            {
                id: 2,
                method: "openade/turn/start",
                params: { repoId: "repo-1", inTaskId: "task-with-cancellable-queue", type: "ask", input: "Cancel me", clientRequestId: "cancel-me" },
            },
            connection()
        )
        expect(queued.error).toBeUndefined()

        const cancel = await runtime.handleRequest(
            {
                id: 3,
                method: "openade/queued-turn/cancel",
                params: {
                    repoId: "repo-1",
                    taskId: "task-with-cancellable-queue",
                    queuedTurnId: (queued.result as { queuedTurnId: string }).queuedTurnId,
                },
            },
            connection()
        )
        expect(cancel.error).toBeUndefined()
        expect(cancel.result).toMatchObject({ taskId: "task-with-cancellable-queue", cancelled: true })

        const cancelledTask = await runtime.handleRequest(
            { id: 4, method: "openade/task/read", params: { repoId: "repo-1", taskId: "task-with-cancellable-queue" } },
            connection()
        )
        expect(cancelledTask.result).toMatchObject({
            queuedTurns: [expect.objectContaining({ input: "Cancel me", type: "ask", status: "cancelled" })],
        })

        settleCallbacks[0]?.({ status: "completed" })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledTimes(1)
    })

    it("rejects non-do and non-ask turns while a task has a running server-owned turn", async () => {
        await seedExistingTaskWithCompletedPlan("task-with-active-turn")
        harnessMock.startRuntimeHarnessQuery.mockResolvedValue({ ok: true })

        const runtime = getRuntimeServer()
        const first = await runtime.handleRequest(
            { id: 1, method: "openade/turn/start", params: { repoId: "repo-1", inTaskId: "task-with-active-turn", type: "do", input: "Keep running" } },
            connection()
        )
        expect(first.error).toBeUndefined()

        const rejected = await runtime.handleRequest(
            { id: 2, method: "openade/turn/start", params: { repoId: "repo-1", inTaskId: "task-with-active-turn", type: "plan", input: "Can I plan now?" } },
            connection()
        )

        expect(rejected.error).toMatchObject({
            code: "handler_error",
            message: expect.stringContaining("Only Do and Ask turns can be queued"),
        })
        expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledTimes(1)
    })

    it("hydrates action stream events from harness sessions when reading a task", async () => {
        const sessionId = "session-backed-1"
        await seedExistingTaskWithSessionBackedAction("task-with-session", sessionId)
        await writeClaudeSession("/tmp/runtime-repo", sessionId, [
            {
                type: "assistant",
                message: {
                    id: "msg-1",
                    type: "message",
                    role: "assistant",
                    content: [{ type: "text", text: "Loaded from session" }],
                    model: "claude-sonnet-4-20250514",
                    stop_reason: "end_turn",
                    usage: { input_tokens: 1, output_tokens: 2 },
                },
                uuid: "assistant-1",
                sessionId,
            },
            {
                type: "future_event",
                sessionId,
                payload: { preserved: true },
            },
        ])

        const runtime = getRuntimeServer()
        const task = await runtime.handleRequest({ id: 1, method: "openade/task/read", params: { repoId: "repo-1", taskId: "task-with-session" } }, connection())

        expect(task.error).toBeUndefined()
        const events = (task.result as { events: Array<{ execution: { events: Array<Record<string, unknown>> } }> }).events[0].execution.events
        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "raw_message",
                    message: expect.objectContaining({
                        type: "assistant",
                        message: expect.objectContaining({ content: [{ type: "text", text: "Loaded from session" }] }),
                    }),
                }),
                expect.objectContaining({
                    type: "raw_message",
                    message: expect.objectContaining({
                        type: "raw_json",
                        original_type: "future_event",
                        raw: expect.objectContaining({ payload: { preserved: true } }),
                    }),
                }),
            ])
        )
    })

    it("starts revise turns from the server protocol with the latest completed plan as parent", async () => {
        await seedExistingTaskWithCompletedPlan("task-with-plan")

        const runtime = getRuntimeServer()
        const response = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-1",
                    inTaskId: "task-with-plan",
                    type: "revise",
                    input: "Tighten the testing section",
                },
            },
            connection()
        )

        expect(response.error).toBeUndefined()
        expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.stringContaining("<update_request>Tighten the testing section</update_request>"),
                options: expect.objectContaining({
                    mode: "read-only",
                    appendSystemPrompt: expect.stringContaining('mode="revise"'),
                }),
            })
        )

        const task = await runtime.handleRequest({ id: 2, method: "openade/task/read", params: { repoId: "repo-1", taskId: "task-with-plan" } }, connection())
        expect(task.result).toMatchObject({
            events: [
                expect.objectContaining({ id: "plan-1" }),
                expect.objectContaining({
                    source: { type: "revise", userLabel: "Revise Plan", parentEventId: "plan-1" },
                    includesCommentIds: ["comment-1"],
                }),
            ],
        })
    })

    it("starts run-plan turns from the server protocol even when the user adds no final notes", async () => {
        await seedExistingTaskWithCompletedPlan("task-with-run-plan")

        const runtime = getRuntimeServer()
        const response = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-1",
                    inTaskId: "task-with-run-plan",
                    type: "run_plan",
                    input: "",
                },
            },
            connection()
        )

        expect(response.error).toBeUndefined()
        expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.stringContaining("The plan has been approved. Please proceed with the implementation."),
                options: expect.objectContaining({
                    mode: undefined,
                    appendSystemPrompt: expect.stringContaining('mode="execute"'),
                }),
            })
        )
        expect(JSON.stringify(harnessMock.startRuntimeHarnessQuery.mock.calls[0][0].prompt)).not.toContain("final_notes")

        const task = await runtime.handleRequest({ id: 2, method: "openade/task/read", params: { repoId: "repo-1", taskId: "task-with-run-plan" } }, connection())
        expect(task.result).toMatchObject({
            events: [
                expect.objectContaining({ id: "plan-1" }),
                expect.objectContaining({
                    source: { type: "run_plan", userLabel: "Run Plan", planEventId: "plan-1" },
                    includesCommentIds: ["comment-1"],
                }),
            ],
        })
    })

    it("starts server-owned reviews and persists the review follow-up ask", async () => {
        await seedExistingTaskWithCompletedPlan("task-with-review")
        harnessMock.startRuntimeHarnessQuery.mockImplementation(
            async (request: {
                executionId: string
                onEvent?: (event: Record<string, unknown>) => void
                onSettled?: (result: Record<string, unknown>) => void
            }) => {
                request.onEvent?.({
                    id: `review-session-${request.executionId}`,
                    direction: "execution",
                    type: "session_started",
                    executionId: request.executionId,
                    harnessId: "claude-code",
                    sessionId: `session-${request.executionId}`,
                })
                request.onEvent?.({
                    id: `review-result-${request.executionId}`,
                    direction: "execution",
                    type: "raw_message",
                    executionId: request.executionId,
                    harnessId: "claude-code",
                    message: {
                        type: "result",
                        result: `Review output for ${request.executionId}`,
                    },
                })
                request.onEvent?.({
                    id: `review-complete-${request.executionId}`,
                    direction: "execution",
                    type: "complete",
                    executionId: request.executionId,
                    harnessId: "claude-code",
                })
                request.onSettled?.({
                    executionId: request.executionId,
                    status: "completed",
                    sessionId: `session-${request.executionId}`,
                    events: [],
                })
                return { ok: true }
            }
        )

        const runtime = getRuntimeServer()
        const response = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/review/start",
                params: {
                    repoId: "repo-1",
                    taskId: "task-with-review",
                    reviewType: "plan",
                    harnessId: "claude-code",
                    modelId: "sonnet",
                    customInstructions: "Focus on runtime boundaries",
                },
            },
            connection()
        )

        expect(response.error).toBeUndefined()
        await vi.waitFor(async () => {
            expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledTimes(2)
            const task = await runtime.handleRequest({ id: 2, method: "openade/task/read", params: { repoId: "repo-1", taskId: "task-with-review" } }, connection())
            expect(task.result).toMatchObject({
                events: [
                    expect.objectContaining({ id: "plan-1" }),
                    expect.objectContaining({
                        source: {
                            type: "review",
                            userLabel: "Review Plan",
                            reviewType: "plan",
                            userInstructions: expect.stringContaining("Focus on runtime boundaries"),
                        },
                        status: "completed",
                    }),
                    expect.objectContaining({
                        userInput: "Review Plan Follow-up",
                        source: { type: "ask", userLabel: "Review Plan Follow-up", origin: "review_follow_up" },
                    }),
                ],
            })
        })
        expect(harnessMock.startRuntimeHarnessQuery.mock.calls[1][0].prompt).toContain("Review output for")
    })

    it("persists runtime harness session and terminal events into task documents", async () => {
        gitMock.getRuntimeChangedFiles.mockResolvedValueOnce({
            files: [{ path: "src/app.ts", status: "modified" }],
            fromTreeish: "HEAD",
            toTreeish: "",
        })
        gitMock.getRuntimeWorktreeFilePatch.mockResolvedValueOnce({
            patch: "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
            truncated: false,
            heavy: false,
            stats: { insertions: 1, deletions: 1, changedLines: 2, hunkCount: 1 },
        })
        harnessMock.startRuntimeHarnessQuery.mockImplementationOnce(
            async (request: {
                executionId: string
                onEvent: (event: Record<string, unknown>) => void
            }) => {
                request.onEvent({
                    id: "session-started-1",
                    direction: "execution",
                    type: "session_started",
                    executionId: request.executionId,
                    harnessId: "claude-code",
                    sessionId: "session-1",
                })
                request.onEvent({
                    id: "complete-1",
                    direction: "execution",
                    type: "complete",
                    executionId: request.executionId,
                    harnessId: "claude-code",
                })
                return { ok: true }
            }
        )

        const runtime = getRuntimeServer()
        const response = await runtime.handleRequest(
            { id: 1, method: "openade/turn/start", params: { repoId: "repo-1", type: "ask", input: "Finish from runtime" } },
            connection()
        )
        const taskId = (response.result as { taskId: string }).taskId

        await vi.waitFor(async () => {
            const read = await runtime.handleRequest({ id: 2, method: "openade/task/read", params: { repoId: "repo-1", taskId } }, connection())
            const task = read.result as { events: Array<{ id: string; type: string; status: string; patchFileId?: string; execution?: { events?: unknown[] } & Record<string, unknown> }> }
            expect(task.events[0]).toMatchObject({
                status: "completed",
                execution: {
                    sessionId: "session-1",
                    gitRefsAfter: { sha: "abc123", branch: "main" },
                },
            })
            expect(task.events[0].execution?.events).toHaveLength(2)
            expect(task.events[1]).toMatchObject({
                type: "snapshot",
                status: "completed",
                patchFileId: expect.stringContaining("snapshot-"),
            })
            expect(fs.existsSync(path.join(tempHome, ".openade", "data", "snapshots", `${task.events[1].patchFileId}.patch`))).toBe(true)
        })
        expect(harnessMock.clearRuntimeHarnessBuffer).toHaveBeenCalledWith({
            executionId: expect.stringContaining(taskId),
        })
    })

    it("creates worktree task setup and starts execution in the worktree without the renderer", async () => {
        const runtime = getRuntimeServer()
        const response = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-1",
                    type: "do",
                    input: "Create Worktree Task",
                    isolationStrategy: { type: "worktree", sourceBranch: "main" },
                },
            },
            connection()
        )

        expect(response.error).toBeUndefined()
        expect(gitMock.getOrCreateRuntimeWorkTree).toHaveBeenCalledWith(
            expect.objectContaining({
                repoDir: "/tmp/runtime-repo",
                sourceTreeish: "main",
            })
        )
        expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    cwd: "/tmp/openade-worktree/packages/app",
                }),
            })
        )

        const taskId = (response.result as { taskId: string }).taskId
        const task = await runtime.handleRequest({ id: 2, method: "openade/task/read", params: { repoId: "repo-1", taskId } }, connection())
        expect(task.result).toMatchObject({
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            deviceEnvironments: [
                expect.objectContaining({
                    worktreeDir: "/tmp/openade-worktree",
                    mergeBaseCommit: "mergebase1234567890",
                }),
            ],
            events: [
                expect.objectContaining({
                    type: "setup_environment",
                    status: "completed",
                    workingDir: "/tmp/openade-worktree/packages/app",
                    setupOutput: expect.stringContaining("Worktree: /tmp/openade-worktree"),
                }),
                expect.objectContaining({
                    type: "action",
                    status: "in_progress",
                }),
            ],
        })
    })

    it("reuses the same server-created task after a runtime restart when clientRequestId is stable", async () => {
        const firstRuntime = getRuntimeServer()
        const params = {
            repoId: "repo-1",
            type: "ask",
            input: "Retry Durable Task",
            clientRequestId: "stable-request-1",
        }

        const first = await firstRuntime.handleRequest({ id: 1, method: "openade/turn/start", params }, connection())
        const firstTaskId = (first.result as { taskId: string }).taskId

        resetRuntimeServer()

        const secondRuntime = getRuntimeServer()
        const second = await secondRuntime.handleRequest({ id: 2, method: "openade/turn/start", params }, connection())
        const secondTaskId = (second.result as { taskId: string }).taskId
        const snapshot = await secondRuntime.handleRequest({ id: 3, method: "openade/snapshot/read" }, connection())
        const repos = (snapshot.result as { repos: Array<{ id: string; tasks: Array<{ id: string }> }> }).repos
        const taskMatches = repos.find((repo) => repo.id === "repo-1")?.tasks.filter((task) => task.id === firstTaskId) ?? []

        expect(first.error).toBeUndefined()
        expect(second.error).toBeUndefined()
        expect(secondTaskId).toBe(firstTaskId)
        expect(taskMatches).toHaveLength(1)
        expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledWith(expect.objectContaining({ executionId: expect.stringContaining(firstTaskId) }))
    })

    it("interrupts server-owned head-mode turns through the runtime harness", async () => {
        const runtime = getRuntimeServer()
        const started = await runtime.handleRequest(
            { id: 1, method: "openade/turn/start", params: { repoId: "repo-1", type: "ask", input: "Keep running" } },
            connection()
        )
        const taskId = (started.result as { taskId: string }).taskId
        const interrupted = await runtime.handleRequest({ id: 2, method: "openade/turn/interrupt", params: { taskId } }, connection())

        expect(interrupted.error).toBeUndefined()
        expect(interrupted.result).toEqual({ ok: true })
        expect(harnessMock.abortRuntimeHarnessQuery).toHaveBeenCalledWith({
            executionId: expect.stringContaining(taskId),
        })
    })

    it("stops server-owned turns through runtime/stop without waiting for harness settlement", async () => {
        const runtime = getRuntimeServer()
        const started = await runtime.handleRequest(
            { id: 1, method: "openade/turn/start", params: { repoId: "repo-1", type: "ask", input: "Keep running" } },
            connection()
        )
        const taskId = (started.result as { taskId: string }).taskId
        const listed = await runtime.handleRequest({ id: 2, method: "runtime/list", params: { ownerType: "openade-task", ownerId: taskId } }, connection())
        const runtimeId = (listed.result as Array<{ runtimeId: string }>)[0]?.runtimeId

        const stopped = await runtime.handleRequest({ id: 3, method: "runtime/stop", params: { runtimeId, reason: "user stop" } }, connection())
        const task = await runtime.handleRequest({ id: 4, method: "openade/task/read", params: { repoId: "repo-1", taskId } }, connection())
        const events = (task.result as { events: Array<{ status: string }> }).events

        expect(stopped.error).toBeUndefined()
        expect(stopped.result).toMatchObject({ runtimeId, status: "stopped" })
        expect(harnessMock.abortRuntimeHarnessQuery).toHaveBeenCalledWith({
            executionId: expect.stringContaining(taskId),
        })
        expect(events[0]?.status).toBe("stopped")
    })

    it("runs HyperPlan strategies in main without the renderer and persists sub-executions", async () => {
        harnessMock.startRuntimeHarnessQuery.mockImplementation(
            async (request: {
                executionId: string
                onEvent?: (event: Record<string, unknown>) => void
                onSettled?: (result: Record<string, unknown>) => void
            }) => {
                request.onEvent?.({
                    id: `session-${request.executionId}`,
                    direction: "execution",
                    type: "session_started",
                    executionId: request.executionId,
                    harnessId: "claude-code",
                    sessionId: `session-${request.executionId}`,
                })
                request.onEvent?.({
                    id: `raw-${request.executionId}`,
                    direction: "execution",
                    type: "raw_message",
                    executionId: request.executionId,
                    harnessId: "claude-code",
                    message: {
                        type: "result",
                        result: `Result text for ${request.executionId}`,
                    },
                })
                request.onEvent?.({
                    id: `complete-${request.executionId}`,
                    direction: "execution",
                    type: "complete",
                    executionId: request.executionId,
                    harnessId: "claude-code",
                })
                request.onSettled?.({
                    executionId: request.executionId,
                    status: "completed",
                    sessionId: `session-${request.executionId}`,
                    events: [],
                })
                return { ok: true }
            }
        )

        const runtime = getRuntimeServer()
        const response = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-1",
                    type: "hyperplan",
                    input: "Compare runtime plans",
                    hyperplanStrategy: {
                        id: "ensemble",
                        name: "Ensemble",
                        description: "Two planners then reconcile",
                        steps: [
                            { id: "plan_a", primitive: "plan", agent: { harnessId: "claude-code", modelId: "sonnet" }, inputs: [] },
                            { id: "plan_b", primitive: "plan", agent: { harnessId: "claude-code", modelId: "sonnet" }, inputs: [] },
                            {
                                id: "reconcile_0",
                                primitive: "reconcile",
                                agent: { harnessId: "claude-code", modelId: "sonnet" },
                                inputs: ["plan_a", "plan_b"],
                            },
                        ],
                        terminalStepId: "reconcile_0",
                    },
                },
            },
            connection()
        )

        expect(response.error).toBeUndefined()

        const taskId = (response.result as { taskId: string }).taskId
        await vi.waitFor(async () => {
            expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledTimes(3)
            const read = await runtime.handleRequest({ id: 2, method: "openade/task/read", params: { repoId: "repo-1", taskId } }, connection())
            const task = read.result as {
                events: Array<{
                    type: string
                    status: string
                    source?: { type: string; strategyId?: string }
                    result?: { success?: boolean }
                    hyperplanSubExecutions?: Array<{ stepId: string; status: string; resultText?: string; events?: unknown[]; reconcileLabel?: string }>
                    execution?: { events?: unknown[]; sessionId?: string }
                }>
            }
            expect(task.events[0]).toMatchObject({
                type: "action",
                status: "completed",
                source: { type: "hyperplan", strategyId: "ensemble" },
                result: { success: true },
            })
            expect(task.events[0].hyperplanSubExecutions).toHaveLength(2)
            expect(task.events[0].hyperplanSubExecutions?.map((sub) => sub.status)).toEqual(["completed", "completed"])
            expect(task.events[0].hyperplanSubExecutions?.every((sub) => sub.resultText?.includes("Result text"))).toBe(true)
            expect(task.events[0].hyperplanSubExecutions?.filter((sub) => sub.reconcileLabel).length).toBe(2)
            expect(task.events[0].execution?.events?.length).toBeGreaterThan(0)
            expect(task.events[0].execution?.sessionId).toBeTruthy()
        })
    })

    it("marks server-owned HyperPlan turns stopped when a child execution is aborted", async () => {
        harnessMock.startRuntimeHarnessQuery.mockImplementation(
            async (request: {
                executionId: string
                onEvent?: (event: Record<string, unknown>) => void
                onSettled?: (result: Record<string, unknown>) => void
            }) => {
                request.onEvent?.({
                    id: `session-${request.executionId}`,
                    direction: "execution",
                    type: "session_started",
                    executionId: request.executionId,
                    harnessId: "claude-code",
                    sessionId: `session-${request.executionId}`,
                })

                if (request.executionId.includes("-plan_a-")) {
                    request.onSettled?.({
                        executionId: request.executionId,
                        status: "aborted",
                        sessionId: `session-${request.executionId}`,
                        events: [],
                    })
                    return { ok: true }
                }

                request.onEvent?.({
                    id: `raw-${request.executionId}`,
                    direction: "execution",
                    type: "raw_message",
                    executionId: request.executionId,
                    harnessId: "claude-code",
                    message: {
                        type: "result",
                        result: `Result text for ${request.executionId}`,
                    },
                })
                request.onSettled?.({
                    executionId: request.executionId,
                    status: "completed",
                    sessionId: `session-${request.executionId}`,
                    events: [],
                })
                return { ok: true }
            }
        )

        const runtime = getRuntimeServer()
        const response = await runtime.handleRequest(
            {
                id: 1,
                method: "openade/turn/start",
                params: {
                    repoId: "repo-1",
                    type: "hyperplan",
                    input: "Stop one child",
                    hyperplanStrategy: {
                        id: "ensemble",
                        name: "Ensemble",
                        description: "Two planners then reconcile",
                        steps: [
                            { id: "plan_a", primitive: "plan", agent: { harnessId: "claude-code", modelId: "sonnet" }, inputs: [] },
                            { id: "plan_b", primitive: "plan", agent: { harnessId: "claude-code", modelId: "sonnet" }, inputs: [] },
                            {
                                id: "reconcile_0",
                                primitive: "reconcile",
                                agent: { harnessId: "claude-code", modelId: "sonnet" },
                                inputs: ["plan_a", "plan_b"],
                            },
                        ],
                        terminalStepId: "reconcile_0",
                    },
                },
            },
            connection()
        )

        expect(response.error).toBeUndefined()

        const taskId = (response.result as { taskId: string }).taskId
        await vi.waitFor(async () => {
            const read = await runtime.handleRequest({ id: 2, method: "openade/task/read", params: { repoId: "repo-1", taskId } }, connection())
            const task = read.result as {
                events: Array<{
                    type: string
                    status: string
                    result?: { success?: boolean }
                    hyperplanSubExecutions?: Array<{ stepId: string; status: string; resultText?: string }>
                }>
            }
            expect(harnessMock.startRuntimeHarnessQuery).toHaveBeenCalledTimes(2)
            expect(task.events[0]).toMatchObject({
                type: "action",
                status: "stopped",
            })
            expect(task.events[0].result).toBeUndefined()
            expect(task.events[0].hyperplanSubExecutions?.map((sub) => [sub.stepId, sub.status])).toEqual([
                ["plan_a", "stopped"],
                ["plan_b", "completed"],
            ])
        })
    })
})
