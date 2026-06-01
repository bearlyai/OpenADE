import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"
import { OpenADEClient } from "../../openade-client/src"
import { RuntimeClient } from "../../runtime-client/src"
import type { RuntimeConnection, RuntimeServer } from "../../runtime/src"
import type { AgentProviderSummary, RuntimeInitializeResult, RuntimeResponse } from "../../runtime-protocol/src"
import type { RuntimeNodeAgentExecutor, RuntimeNodeAgentStartCallbacks, RuntimeNodeAgentStartParams } from "../../runtime-node/src"
import { createOpenADEKernel, serveOpenADEKernelHttp, type OpenADEKernel } from "./kernel"
import type { OpenADETask } from "./types"

const agentProvider: AgentProviderSummary = {
    providerId: "codex",
    label: "Deterministic Codex",
    kind: "process",
    capabilities: {
        execution: true,
        streaming: true,
        sessions: true,
        steering: false,
        interrupt: true,
        goals: false,
        approvals: false,
        filesystem: true,
        processExec: true,
    },
}

function createDeterministicAgentExecutor(): RuntimeNodeAgentExecutor {
    return {
        providers() {
            return [agentProvider]
        },
        async status() {
            return { installed: true, version: "fixture", authType: "none", authenticated: true }
        },
        start(params: RuntimeNodeAgentStartParams, callbacks?: RuntimeNodeAgentStartCallbacks) {
            callbacks?.onSpawn?.({
                executionId: params.executionId,
                pid: 12345,
                processLabel: params.processLabel,
                processStartedAt: "2026-05-31T00:00:00.000Z",
            })
            callbacks?.onEvent?.({
                id: `session-${params.executionId}`,
                type: "session_started",
                direction: "execution",
                executionId: params.executionId,
                harnessId: params.harnessId,
                sessionId: "session-kernel-fixture",
            })
            callbacks?.onEvent?.({
                id: `message-${params.executionId}`,
                type: "message",
                direction: "execution",
                executionId: params.executionId,
                harnessId: params.harnessId,
                message: { type: "text", text: "deterministic response" },
            })
            callbacks?.onEvent?.({
                id: `complete-${params.executionId}`,
                type: "complete",
                direction: "execution",
                executionId: params.executionId,
                harnessId: params.harnessId,
                usage: { inputTokens: 1, outputTokens: 2 },
            })
            callbacks?.onSettled?.({
                executionId: params.executionId,
                status: "completed",
                sessionId: "session-kernel-fixture",
            })
            return Promise.resolve({ ok: true })
        },
        interrupt() {
            return { ok: true }
        },
    }
}

function eventRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function actionEvent(task: OpenADETask): Record<string, unknown> | null {
    return task.events.map(eventRecord).find((event) => event?.type === "action") ?? null
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

function execGit(cwd: string, args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "pipe" })
}

function gitOutput(cwd: string, args: string[]): string {
    return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).trim()
}

function initializeGitRepo(repoPath: string): void {
    execGit(repoPath, ["init"])
    execGit(repoPath, ["config", "user.email", "kernel@example.com"])
    execGit(repoPath, ["config", "user.name", "Kernel Test"])
    execGit(repoPath, ["add", "README.md"])
    execGit(repoPath, ["commit", "-m", "Initial kernel fixture"])
}

async function waitForCompletedTask(client: OpenADEClient, repoId: string, taskId: string): Promise<OpenADETask> {
    for (let attempt = 0; attempt < 50; attempt++) {
        const task = await client.getTask(repoId, taskId, { hydrateSessionEvents: false })
        if (actionEvent(task)?.status === "completed") return task
        await delay(20)
    }
    throw new Error(`Task ${taskId} did not complete`)
}

async function waitForCompletedProjectProcess(client: OpenADEClient, repoId: string, processId: string): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt++) {
        const result = await client.reconnectProjectProcess({ repoId, processId })
        if (result.found && result.completed) return result.output?.map((chunk) => chunk.data).join("") ?? ""
        await delay(20)
    }
    throw new Error(`Project process ${processId} did not complete`)
}

async function waitForTaskTerminalOutput(client: OpenADEClient, repoId: string, taskId: string, terminalId: string, needle: string): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt++) {
        const result = await client.reconnectTaskTerminal({ repoId, taskId, terminalId })
        const output = result.output?.map((chunk) => chunk.data).join("") ?? ""
        if (result.found && output.includes(needle)) return output
        await delay(20)
    }
    throw new Error(`Task terminal ${terminalId} did not produce ${needle}`)
}

let requestId = 0

async function runtimeRequest<T>(server: RuntimeServer, method: string, params?: unknown): Promise<T> {
    const connection: RuntimeConnection = {
        id: "kernel-integration",
        send() {},
    }
    const response = await server.handleRequest({ id: `request-${++requestId}`, method, params }, connection)
    return runtimeResult<T>(response)
}

function runtimeResult<T>(response: RuntimeResponse): T {
    if (response.error) throw new Error(`${response.error.code}: ${response.error.message}`)
    return response.result as T
}

describe("OpenADE kernel composition", () => {
    const tempRoots: string[] = []
    const kernels: OpenADEKernel[] = []

    afterEach(async () => {
        while (kernels.length > 0) {
            await kernels.pop()?.close()
        }
        while (tempRoots.length > 0) {
            fs.rmSync(tempRoots.pop() ?? "", { recursive: true, force: true })
        }
    })

    function tempRoot(): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "openade-kernel-"))
        tempRoots.push(root)
        return root
    }

    it("composes OpenADE, host, agent, runtime, and notification capabilities outside Electron", async () => {
        const root = tempRoot()
        const kernel = createOpenADEKernel({
            dataDir: path.join(root, "yjs"),
            checkpointFile: path.join(root, "runtime-checkpoints.json"),
            hostName: "kernel-host",
            serverVersion: "kernel-test",
            agentExecutor: createDeterministicAgentExecutor(),
        })
        kernels.push(kernel)

        const initialized = await runtimeRequest<RuntimeInitializeResult>(kernel.server, "initialize", {
            clientName: "kernel-test",
            protocolVersion: 1,
        })

        expect(initialized).toMatchObject({
            protocolVersion: 1,
            serverName: "openade-runtime",
            serverVersion: "kernel-test",
        })
        expect(initialized.capabilities.methods).toEqual(
            expect.arrayContaining([
                "initialize",
                "openade/snapshot/read",
                "openade/project/files/tree",
                "openade/project/file/read",
                "openade/project/file/write",
                "openade/project/search",
                "openade/task/terminal/start",
                "openade/task/terminal/write",
                "openade/task/terminal/reconnect",
                "openade/task/terminal/resize",
                "openade/task/terminal/stop",
                "openade/task/image/read",
                "openade/task/git/commit",
                "openade/turn/start",
                "openade/task/read",
                "fs/file/read",
                "git/status/read",
                "process/command/start",
                "pty/spawn",
                "fs/watch/start",
            ])
        )
        expect(initialized.capabilities.notifications).toEqual(
            expect.arrayContaining(["openade/task/updated", "openade/workingTasks", "runtime/completed", "agent/event"])
        )
        expect(initialized.capabilities.agentProviders).toContainEqual(agentProvider)
    })

    it("serves a real WebSocket OpenADE kernel that persists turn results across reload", async () => {
        const root = tempRoot()
        const dataDir = path.join(root, "yjs")
        const checkpointFile = path.join(root, "runtime-checkpoints.json")
        const repoPath = path.join(root, "repo")
        fs.mkdirSync(repoPath, { recursive: true })
        fs.writeFileSync(path.join(repoPath, "README.md"), "scoped kernel file search\n")
        fs.writeFileSync(
            path.join(repoPath, "openade.toml"),
            [
                "# The kernel process list must use the shared openade.toml parser.",
                "[[process]]",
                "name = 'Echo'",
                'command = "printf \'scoped process ok\\n\'" # inline comments outside strings are ignored',
                'type = "task"',
                'work_dir = "."',
                'url = "http://localhost:5173/#task"',
                "",
                "[[cron]]",
                'name = "Ignored Cron"',
                'schedule = "0 9 * * 1"',
                'type = "ask"',
                'prompt = "Should not appear in project process results"',
                'images = ["screen#1.png"]',
                "reuse_task = false",
                "",
            ].join("\n")
        )
        fs.mkdirSync(path.join(root, "images"), { recursive: true })
        fs.writeFileSync(path.join(root, "images", "image-kernel.png"), Buffer.from("kernel image bytes"))
        initializeGitRepo(repoPath)

        const served = await serveOpenADEKernelHttp({
            dataDir,
            checkpointFile,
            serverVersion: "kernel-test",
            hostName: "kernel-host",
            host: "127.0.0.1",
            port: 0,
            token: "kernel-token",
            allowUnauthenticatedLoopback: false,
            agentExecutor: createDeterministicAgentExecutor(),
        })
        kernels.push(served.kernel)

        const runtime = new RuntimeClient({
            url: served.url,
            token: "kernel-token",
            clientName: "kernel-test",
            clientPlatform: "cli",
            reconnect: false,
        })
        const client = new OpenADEClient({ runtime })

        try {
            const repo = await client.createRepo(
                {
                    repoId: "repo-kernel",
                    name: "Kernel Repo",
                    path: repoPath,
                    createdBy: { id: "user-kernel", email: "kernel@example.com" },
                },
                { clientRequestId: "repo-create" }
            )
            await expect(client.listProjectFiles({ repoId: repo.repoId, maxDepth: 2 })).resolves.toMatchObject({
                repoId: repo.repoId,
                entries: expect.arrayContaining([expect.objectContaining({ path: "README.md", name: "README.md", type: "file" })]),
            })
            await expect(client.readProjectFile({ repoId: repo.repoId, path: "README.md" })).resolves.toMatchObject({
                repoId: repo.repoId,
                path: "README.md",
                content: "scoped kernel file search\n",
            })
            await expect(
                client.writeProjectFile(
                    { repoId: repo.repoId, path: "notes/out.txt", content: "written through scoped kernel\n", createDirs: true },
                    { clientRequestId: "file-write" }
                )
            ).resolves.toMatchObject({ repoId: repo.repoId, path: "notes/out.txt", size: 30 })
            await expect(client.readProjectFile({ repoId: repo.repoId, path: "notes/out.txt" })).resolves.toMatchObject({
                content: "written through scoped kernel\n",
            })
            await expect(client.searchProject({ repoId: repo.repoId, query: "file search" })).resolves.toMatchObject({
                repoId: repo.repoId,
                matches: [expect.objectContaining({ path: "README.md", line: 1, content: "scoped kernel file search" })],
            })
            const processes = await client.listProjectProcesses({ repoId: repo.repoId })
            expect(processes).toMatchObject({
                repoId: repo.repoId,
                processes: [
                    expect.objectContaining({
                        id: "openade.toml::Echo",
                        name: "Echo",
                        cwd: fs.realpathSync(repoPath),
                        url: "http://localhost:5173/#task",
                    }),
                ],
                errors: [],
            })
            const projectProcess = await client.startProjectProcess(
                { repoId: repo.repoId, definitionId: "openade.toml::Echo" },
                { clientRequestId: "process-start" }
            )
            expect(projectProcess).toMatchObject({
                repoId: repo.repoId,
                definitionId: "openade.toml::Echo",
                runtimeId: `process:${projectProcess.processId}`,
            })
            await expect(waitForCompletedProjectProcess(client, repo.repoId, projectProcess.processId)).resolves.toContain("scoped process ok")
            await expect(
                client.stopProjectProcess({ repoId: repo.repoId, processId: projectProcess.processId }, { clientRequestId: "process-stop" })
            ).resolves.toMatchObject({ ok: true })
            fs.appendFileSync(
                path.join(repoPath, "openade.toml"),
                '\n[[process]]\nname = "Outside"\ncommand = "printf nope"\nwork_dir = "../outside"\ntype = "task"\n'
            )
            await expect(client.listProjectProcesses({ repoId: repo.repoId })).resolves.toMatchObject({
                errors: [expect.objectContaining({ relativePath: "openade.toml", error: expect.stringContaining("outside the repository") })],
            })
            await expect(
                client.startProjectProcess({ repoId: repo.repoId, definitionId: "openade.toml::Outside" }, { clientRequestId: "process-outside" })
            ).rejects.toThrow(/not found/)
            await expect(client.readProjectFile({ repoId: repo.repoId, path: "../outside.txt" })).rejects.toThrow(/path is invalid/)
            await expect(client.writeProjectFile({ repoId: repo.repoId, path: "../outside.txt", content: "nope" })).rejects.toThrow(/path is invalid/)
            const started = await client.startTurn(
                {
                    repoId: repo.repoId,
                    type: "do",
                    input: "Run deterministic kernel turn",
                    title: "Kernel turn",
                    harnessId: "codex",
                    modelId: "fixture-model",
                    isolationStrategy: { type: "head" },
                },
                { clientRequestId: "turn-start" }
            )
            const task = await waitForCompletedTask(client, repo.repoId, started.taskId)
            const action = actionEvent(task)
            const execution = eventRecord(action?.execution)
            const streamEvents = Array.isArray(execution?.events) ? execution.events.map(eventRecord) : []

            expect(action).toMatchObject({
                status: "completed",
                userInput: "Run deterministic kernel turn",
                source: { type: "do" },
            })
            expect(streamEvents.map((event) => event?.type).sort()).toEqual(["complete", "message", "session_started"])

            await client.createActionEvent(
                {
                    taskId: started.taskId,
                    eventId: "event-image",
                    userInput: "Prompt with image",
                    executionId: "execution-image",
                    harnessId: "codex",
                    source: { type: "do", userLabel: "Do" },
                    images: [
                        { id: "image-kernel", ext: "png", mediaType: "image/png", originalWidth: 1, originalHeight: 1, resizedWidth: 1, resizedHeight: 1 },
                    ],
                },
                { clientRequestId: "image-action" }
            )
            await expect(client.readTaskImage({ repoId: repo.repoId, taskId: started.taskId, imageId: "image-kernel", ext: "png" })).resolves.toMatchObject({
                repoId: repo.repoId,
                taskId: started.taskId,
                imageId: "image-kernel",
                mediaType: "image/png",
                data: Buffer.from("kernel image bytes").toString("base64"),
            })
            await expect(client.readTaskImage({ repoId: repo.repoId, taskId: started.taskId, imageId: "missing-image", ext: "png" })).resolves.toMatchObject({
                data: null,
            })
            await expect(client.readTaskImage({ repoId: repo.repoId, taskId: started.taskId, imageId: "../image-kernel", ext: "png" })).rejects.toThrow(
                /imageId is invalid/
            )

            const terminal = await client.startTaskTerminal(
                { repoId: repo.repoId, taskId: started.taskId, cols: 80, rows: 24 },
                { clientRequestId: "terminal-start" }
            )
            expect(terminal).toMatchObject({ repoId: repo.repoId, taskId: started.taskId, ok: true, runtimeId: `pty:${terminal.terminalId}` })
            await expect(client.reconnectTaskTerminal({ repoId: repo.repoId, taskId: started.taskId })).resolves.toMatchObject({
                repoId: repo.repoId,
                taskId: started.taskId,
                terminalId: terminal.terminalId,
                found: true,
            })
            await expect(
                client.writeTaskTerminal({
                    repoId: repo.repoId,
                    taskId: started.taskId,
                    terminalId: terminal.terminalId,
                    data: "printf 'scoped terminal ok\\n'\nexit\n",
                })
            ).resolves.toMatchObject({ ok: true })
            await expect(waitForTaskTerminalOutput(client, repo.repoId, started.taskId, terminal.terminalId, "scoped terminal ok")).resolves.toContain(
                "scoped terminal ok"
            )
            await expect(
                client.resizeTaskTerminal({ repoId: repo.repoId, taskId: started.taskId, terminalId: terminal.terminalId, cols: 100, rows: 30 })
            ).resolves.toMatchObject({ ok: true })
            await expect(client.writeTaskTerminal({ repoId: repo.repoId, taskId: started.taskId, terminalId: "bad-terminal", data: "nope\n" })).rejects.toThrow(
                /terminalId is invalid/
            )
            await expect(client.stopTaskTerminal({ repoId: repo.repoId, taskId: started.taskId, terminalId: terminal.terminalId })).resolves.toMatchObject({
                ok: true,
            })

            fs.writeFileSync(path.join(repoPath, "README.md"), "scoped kernel file search\nruntime task git change\n")
            fs.mkdirSync(path.join(repoPath, "src"), { recursive: true })
            fs.writeFileSync(path.join(repoPath, "src", "new.ts"), "export const created = true\n")

            const summary = await client.readTaskGitSummary({ repoId: repo.repoId, taskId: started.taskId })
            expect(summary).toMatchObject({
                repoId: repo.repoId,
                taskId: started.taskId,
                branch: "main",
                hasChanges: true,
                unstaged: { files: expect.arrayContaining([expect.objectContaining({ path: "README.md", status: "modified" })]) },
                untracked: expect.arrayContaining([
                    expect.objectContaining({ path: "notes/out.txt", status: "added" }),
                    expect.objectContaining({ path: "src/new.ts", status: "added" }),
                ]),
            })

            const changes = await client.readTaskChanges({ repoId: repo.repoId, taskId: started.taskId })
            expect(changes).toMatchObject({
                repoId: repo.repoId,
                taskId: started.taskId,
                fromTreeish: "HEAD",
                files: expect.arrayContaining([
                    expect.objectContaining({ path: "README.md", status: "modified" }),
                    expect.objectContaining({ path: "notes/out.txt", status: "added" }),
                    expect.objectContaining({ path: "src/new.ts", status: "added" }),
                ]),
            })

            const readmeDiff = await client.readTaskDiff({ repoId: repo.repoId, taskId: started.taskId, filePath: "README.md", contextLines: 3 })
            expect(readmeDiff).toMatchObject({
                repoId: repo.repoId,
                taskId: started.taskId,
                filePath: "README.md",
                fromTreeish: "HEAD",
                truncated: false,
                stats: { insertions: 1, deletions: 0, changedLines: 1 },
            })
            expect(readmeDiff.patch).toContain("+runtime task git change")

            const readmeFilePair = await client.readTaskFilePair({ repoId: repo.repoId, taskId: started.taskId, filePath: "README.md" })
            expect(readmeFilePair).toMatchObject({
                repoId: repo.repoId,
                taskId: started.taskId,
                filePath: "README.md",
                fromTreeish: "HEAD",
                before: "scoped kernel file search\n",
                after: "scoped kernel file search\nruntime task git change\n",
            })

            const untrackedDiff = await client.readTaskDiff({ repoId: repo.repoId, taskId: started.taskId, filePath: "notes/out.txt", contextLines: 3 })
            expect(untrackedDiff).toMatchObject({
                filePath: "notes/out.txt",
                stats: { insertions: 1, deletions: 0, changedLines: 1 },
            })
            expect(untrackedDiff.patch).toContain("+written through scoped kernel")

            await expect(client.readTaskDiff({ repoId: repo.repoId, taskId: started.taskId, filePath: "../outside.txt" })).rejects.toThrow(
                /filePath is invalid/
            )
            await expect(client.readTaskGitLog({ repoId: repo.repoId, taskId: started.taskId, limit: 5 })).resolves.toMatchObject({
                repoId: repo.repoId,
                taskId: started.taskId,
                commits: [expect.objectContaining({ message: "Initial kernel fixture", author: "Kernel Test" })],
                hasMore: false,
            })
            const initialCommit = gitOutput(repoPath, ["rev-parse", "HEAD"])
            await expect(client.readTaskGitCommitFiles({ repoId: repo.repoId, taskId: started.taskId, commit: initialCommit })).resolves.toMatchObject({
                repoId: repo.repoId,
                taskId: started.taskId,
                commit: initialCommit,
                files: [expect.objectContaining({ path: "README.md", status: "added" })],
            })
            await expect(
                client.readTaskGitFileAtTreeish({ repoId: repo.repoId, taskId: started.taskId, treeish: initialCommit, filePath: "README.md" })
            ).resolves.toMatchObject({
                repoId: repo.repoId,
                taskId: started.taskId,
                treeish: initialCommit,
                filePath: "README.md",
                content: "scoped kernel file search\n",
                exists: true,
            })
            const initialCommitPatch = await client.readTaskGitCommitFilePatch({
                repoId: repo.repoId,
                taskId: started.taskId,
                commit: initialCommit,
                filePath: "README.md",
                contextLines: 3,
            })
            expect(initialCommitPatch).toMatchObject({
                repoId: repo.repoId,
                taskId: started.taskId,
                commit: initialCommit,
                filePath: "README.md",
                stats: { insertions: 1, deletions: 0, changedLines: 1, hunkCount: 1 },
            })
            expect(initialCommitPatch.patch).toContain("+scoped kernel file search")
            await expect(
                client.readTaskGitFileAtTreeish({ repoId: repo.repoId, taskId: started.taskId, treeish: initialCommit, filePath: "../README.md" })
            ).rejects.toThrow(/filePath is invalid/)
            await expect(client.readTaskGitCommitFiles({ repoId: repo.repoId, taskId: started.taskId, commit: "../HEAD" })).rejects.toThrow(/commit is invalid/)
            await expect(
                client.commitTaskGit(
                    { repoId: repo.repoId, taskId: started.taskId, message: "Commit scoped kernel task changes" },
                    { clientRequestId: "git-commit" }
                )
            ).resolves.toMatchObject({
                repoId: repo.repoId,
                taskId: started.taskId,
                committed: true,
                status: "committed",
                sha: expect.any(String),
            })
            expect(gitOutput(repoPath, ["log", "-1", "--format=%s"])).toBe("Commit scoped kernel task changes")
            await expect(
                client.commitTaskGit(
                    { repoId: repo.repoId, taskId: started.taskId, message: "Commit scoped kernel task changes" },
                    { clientRequestId: "git-commit" }
                )
            ).resolves.toMatchObject({ committed: true, status: "committed" })
            await expect(
                client.commitTaskGit({ repoId: repo.repoId, taskId: started.taskId, message: "No changes" }, { clientRequestId: "git-commit-empty" })
            ).resolves.toMatchObject({ committed: false, status: "nothing_to_commit" })
            await expect(client.commitTaskGit({ repoId: repo.repoId, taskId: started.taskId, message: " " })).rejects.toThrow(/message is invalid/)
            const snapshotPatch = "diff --git a/README.md b/README.md\n+kernel snapshot patch\n"
            await client.createSnapshotEvent(
                {
                    taskId: started.taskId,
                    actionEventId: typeof action?.id === "string" ? action.id : "event-1",
                    referenceBranch: "main",
                    mergeBaseCommit: "HEAD",
                    fullPatch: snapshotPatch,
                    stats: { filesChanged: 1, insertions: 1, deletions: 0 },
                    eventId: "snapshot-kernel",
                },
                { clientRequestId: "snapshot-create" }
            )
            await expect(client.readTaskSnapshotPatch({ repoId: repo.repoId, taskId: started.taskId, eventId: "snapshot-kernel" })).resolves.toMatchObject({
                patch: snapshotPatch,
            })
            await expect(client.readTaskSnapshotIndex({ repoId: repo.repoId, taskId: started.taskId, eventId: "snapshot-kernel" })).resolves.toMatchObject({
                index: { files: [expect.objectContaining({ path: "README.md", insertions: 1 })] },
            })
            await expect(
                client.readTaskSnapshotPatchSlice({ repoId: repo.repoId, taskId: started.taskId, eventId: "snapshot-kernel", start: 35, end: 58 })
            ).resolves.toMatchObject({ patch: "+kernel snapshot patch\n" })

            expect(await client.getSnapshot()).toMatchObject({
                server: { version: "kernel-test", hostName: "kernel-host" },
                repos: [{ id: "repo-kernel", tasks: [{ id: started.taskId, title: "Kernel turn" }] }],
            })

            runtime.close()
            await served.close()
            kernels.pop()

            const reloaded = createOpenADEKernel({
                dataDir,
                checkpointFile,
                serverVersion: "kernel-test",
                hostName: "kernel-host",
                agentExecutor: createDeterministicAgentExecutor(),
                hostCapabilities: { process: false, pty: false, fsWatch: false },
            })
            kernels.push(reloaded)
            const persistedTask = await runtimeRequest<OpenADETask>(reloaded.server, "openade/task/read", {
                repoId: "repo-kernel",
                taskId: started.taskId,
                hydrateSessionEvents: false,
            })

            expect(actionEvent(persistedTask)).toMatchObject({ status: "completed" })
        } finally {
            runtime.close()
        }
    }, 20_000)
})
