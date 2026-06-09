import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron, expect, test, type TestInfo } from "@playwright/test"

const SMOKE_ANALYTICS_STORAGE_KEY = "openade-smoke-analytics-events"

const candidateBinaryPaths = () => {
    const dist = resolve(__dirname, "..", "dist", "electron")
    if (process.platform === "darwin") {
        return [
            `${dist}/mac-universal/OpenADE.app/Contents/MacOS/OpenADE`,
            `${dist}/mac-arm64/OpenADE.app/Contents/MacOS/OpenADE`,
            `${dist}/mac/OpenADE.app/Contents/MacOS/OpenADE`,
        ]
    }
    if (process.platform === "win32") return [`${dist}/win-unpacked/OpenADE.exe`]
    if (process.platform === "linux") return [`${dist}/linux-unpacked/openade`, `${dist}/linux-unpacked/OpenADE`]
    throw new Error(`Unsupported smoke-test platform: ${process.platform}`)
}

const resolveBinary = (): string => {
    const override = process.env.OPENADE_SMOKE_BINARY
    if (override) {
        if (!existsSync(override)) throw new Error(`OPENADE_SMOKE_BINARY does not exist: ${override}`)
        return override
    }
    for (const candidate of candidateBinaryPaths()) {
        if (existsSync(candidate)) return candidate
    }
    throw new Error(
        `Could not find a packaged OpenADE binary. Run electron-builder first, or set OPENADE_SMOKE_BINARY. Looked in: ${candidateBinaryPaths().join(", ")}`
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseSmokeTelemetryEvents(raw: string): Array<Record<string, unknown>> {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error("Smoke telemetry is not an array")
    if (!parsed.every(isRecord)) throw new Error("Smoke telemetry contains a non-object event")
    return parsed
}

async function reviewSmokeTelemetry(testInfo: TestInfo, rawSmokeTelemetry: string | null, userDataDir: string, artifactName: string) {
    if (!rawSmokeTelemetry) throw new Error("Packaged smoke did not capture renderer analytics telemetry")
    const smokeTelemetry = parseSmokeTelemetryEvents(rawSmokeTelemetry)
    expect(smokeTelemetry.some((event) => event.event_type === "app_opened")).toBe(true)

    const telemetryPath = join(userDataDir, `${artifactName}.ndjson`)
    writeFileSync(telemetryPath, `${smokeTelemetry.map((event) => JSON.stringify(event)).join("\n")}\n`)
    const reviewOutput = execFileSync("npm", ["run", "review:runtime-product-rollout", "--", telemetryPath], {
        cwd: resolve(__dirname, "..", "..", "web"),
        encoding: "utf8",
    })
    expect(reviewOutput).toContain("Runtime product rollout review: PASS")
    await testInfo.attach(`${artifactName}.ndjson`, { path: telemetryPath, contentType: "application/x-ndjson" })
    await testInfo.attach(`${artifactName}-review.txt`, { body: Buffer.from(reviewOutput), contentType: "text/plain" })
    return smokeTelemetry
}

async function getOpenPort(): Promise<number> {
    return new Promise((resolvePort, reject) => {
        const server = createServer()
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
            const address = server.address()
            if (typeof address !== "object" || address === null) {
                server.close(() => reject(new Error("Could not resolve temporary listener address")))
                return
            }
            const port = address.port
            server.close(() => resolvePort(port))
        })
    })
}

test("packaged app launches and loads the bundled web UI", async () => {
    test.setTimeout(180_000)
    const executablePath = resolveBinary()
    const userDataDir = mkdtempSync(join(tmpdir(), "openade-smoke-"))
    const repoDir = mkdtempSync(join(tmpdir(), "openade-smoke-repo-"))
    const yjsStorageDir = join(userDataDir, ".openade", "data", "yjs")
    const smokeId = `packaged-smoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    const repoId = `${smokeId}-repo`
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined
    let passed = false

    try {
        writeFileSync(join(repoDir, "README.md"), "OpenADE packaged smoke fixture\n")
        writeFileSync(
            join(repoDir, "openade.toml"),
            '[[process]]\nname = "Packaged Echo"\ncommand = "echo packaged scoped process ok"\ntype = "task"\n'
        )
        try {
            execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" })
            execFileSync("git", ["config", "user.email", "smoke@example.com"], { cwd: repoDir, stdio: "ignore" })
            execFileSync("git", ["config", "user.name", "OpenADE Smoke"], { cwd: repoDir, stdio: "ignore" })
            execFileSync("git", ["add", "README.md", "openade.toml"], { cwd: repoDir, stdio: "ignore" })
            execFileSync("git", ["commit", "-m", "Initial smoke fixture"], { cwd: repoDir, stdio: "ignore" })
        } catch {
            // Git is not required for the packaged boot smoke; task workflow still exercises storage and runtime lifecycle.
        }

        const launchSmokeApp = async () => {
            const launchedApp = await electron.launch({
                executablePath,
                timeout: 60_000,
                args: [`--user-data-dir=${userDataDir}`],
                env: {
                    ...process.env,
                    HOME: userDataDir,
                    OPENADE_DISABLE_ACTIVE_WORK_UNLOAD_BLOCKER: "1",
                    OPENADE_SMOKE_DETERMINISTIC_HARNESS: "1",
                    OPENADE_SMOKE_TEST: "1",
                    OPENADE_YJS_STORAGE_DIR: yjsStorageDir,
                    USERPROFILE: userDataDir,
                },
            })

            const page = await launchedApp.firstWindow({ timeout: 30_000 })
            await page.waitForURL(/dist\/web\/index\.html|web\/index\.html/, { timeout: 30_000 })

            const finalUrl = page.url()
            expect(finalUrl).not.toMatch(/cantLoad/i)
            expect(finalUrl).not.toBe("about:blank")
            await page.waitForFunction(() => "openadeAPI" in window, null, { timeout: 30_000 })
            return { app: launchedApp, page }
        }

        const launched = await launchSmokeApp()
        app = launched.app

        const runtimeSmoke = await launched.page.evaluate(async ({ smokeRepoPath, smokeRepoId }) => {
            const api = window.openadeAPI
            if (!api?.runtime) throw new Error("openadeAPI.runtime is not available")

            let nextId = 1
            let nextRequestId = 1
            const request = async <T>(method: string, params?: unknown): Promise<T> => {
                const response = (await api.runtime.request(params === undefined ? { id: nextId++, method } : { id: nextId++, method, params })) as {
                    error?: { message?: string }
                    result?: T
                }
                if (response.error) throw new Error(response.error.message ?? `Runtime request failed: ${method}`)
                return response.result as T
            }
            type SmokeTurnType = "plan" | "revise" | "run_plan" | "ask"
            type SmokeTask = {
                id: string
                closed?: boolean
                events: Array<{
                    id?: string
                    status?: string
                    source?: { type?: string }
                    execution?: { events?: unknown[] }
                }>
            }
            type SmokeSnapshot = {
                repos: Array<{
                    id: string
                    tasks: Array<{
                        id: string
                        lastEvent?: { status?: string; sourceType?: string }
                    }>
                }>
            }
            type SmokeRuntime = { status?: string }
            type SmokeProjectProcessReconnectResult = {
                found: boolean
                completed?: boolean
                output?: Array<{ type: "stdout" | "stderr"; data: string }>
            }
            const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
            const waitForProjectProcessOutput = async (processId: string, needle: string): Promise<SmokeProjectProcessReconnectResult> => {
                let lastResult: SmokeProjectProcessReconnectResult | null = null
                for (let attempt = 0; attempt < 80; attempt++) {
                    const result = await request<SmokeProjectProcessReconnectResult>("openade/project/process/reconnect", {
                        repoId: smokeRepoId,
                        processId,
                    })
                    lastResult = result
                    const output = result.output?.map((chunk) => chunk.data).join("") ?? ""
                    if (output.includes(needle)) return result
                    await sleep(250)
                }
                throw new Error(`Project process ${processId} did not produce ${needle}; last result: ${JSON.stringify(lastResult)}`)
            }
            const waitForTaskEvent = async (taskId: string, eventId: string, type: SmokeTurnType): Promise<SmokeTask> => {
                let lastEventStates: Array<{ id?: string; status?: string; sourceType?: string }> = []
                for (let attempt = 0; attempt < 180; attempt++) {
                    let task: SmokeTask
                    try {
                        task = await request<SmokeTask>("openade/task/read", { repoId: smokeRepoId, taskId, hydrateSessionEvents: false })
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error)
                        if (message === `Task ${taskId} not found`) {
                            await sleep(500)
                            continue
                        }
                        throw error
                    }
                    lastEventStates = task.events.map((candidate) => ({
                        id: candidate.id,
                        status: candidate.status,
                        sourceType: candidate.source?.type,
                    }))
                    const event = task.events.find((candidate) => candidate.id === eventId)
                    if (event?.status === "completed") return task
                    if (event?.status === "error" || event?.status === "stopped") {
                        throw new Error(`Task event ${eventId} settled as ${event.status}`)
                    }
                    const snapshot = await request<SmokeSnapshot>("openade/snapshot/read")
                    const preview = snapshot.repos.find((repo) => repo.id === smokeRepoId)?.tasks.find((candidate) => candidate.id === taskId)
                    if (preview?.lastEvent?.sourceType === type) {
                        if (preview.lastEvent.status === "completed") return task
                        if (preview.lastEvent.status === "error" || preview.lastEvent.status === "stopped") {
                            throw new Error(`Task preview for ${eventId} settled as ${preview.lastEvent.status}`)
                        }
                    }
                    await sleep(500)
                }
                throw new Error(`Task event ${eventId} did not complete; last events: ${JSON.stringify(lastEventStates)}`)
            }
            const waitForTaskIdle = async (taskId: string): Promise<void> => {
                for (let attempt = 0; attempt < 120; attempt++) {
                    const runtimes = await request<SmokeRuntime[]>("runtime/list", { ownerType: "openade-task", ownerId: taskId })
                    if (!runtimes.some((runtime) => runtime.status === "running")) return
                    await sleep(250)
                }
                throw new Error(`Task ${taskId} still has running runtimes`)
            }
            const startTurn = async (type: SmokeTurnType, input: string, inTaskId?: string) => {
                const baseClientRequestId = `${smokeRepoId}-${type}-${nextRequestId++}`
                let turn: { taskId: string; eventId?: string; queued?: boolean } | null = null
                let lastStartError = ""
                for (let attempt = 0; attempt < 40; attempt++) {
                    const params = {
                        repoId: smokeRepoId,
                        inTaskId,
                        type,
                        input,
                        harnessId: "codex",
                        modelId: "gpt-smoke",
                        clientRequestId: inTaskId ? `${baseClientRequestId}-attempt-${attempt}` : baseClientRequestId,
                    }
                    try {
                        turn = await request<{ taskId: string; eventId?: string; queued?: boolean }>("openade/turn/start", params)
                        break
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error)
                        lastStartError = message
                        if (inTaskId && message === `Task ${inTaskId} not found`) {
                            await sleep(250)
                            continue
                        }
                        throw error
                    }
                }
                if (!turn) {
                    throw new Error(`Smoke ${type} turn could not start for task ${inTaskId ?? "<new>"}; last error: ${lastStartError}`)
                }
                if (!turn.eventId) throw new Error(`Smoke ${type} turn did not return an event id${turn.queued ? " because it queued" : ""}`)
                const task = await waitForTaskEvent(turn.taskId, turn.eventId, type)
                await waitForTaskIdle(turn.taskId)
                return { turn, task }
            }

            await api.runtime.connect()
            await request("initialize", { clientName: "OpenADE packaged smoke", clientPlatform: "desktop", protocolVersion: 1 })
            const platform = await request<{ platform: string }>("host/platform/info")
            const snapshot = await request<{ server: { version: string }; repos: unknown[]; workingTaskIds: unknown[] }>("openade/snapshot/read")
            const repoCreate = await request<{ repoId: string }>("openade/repo/create", {
                repoId: smokeRepoId,
                name: "Packaged Smoke Repo",
                path: smokeRepoPath,
                createdBy: { id: "smoke-user", email: "smoke@example.com" },
                clientRequestId: `${smokeRepoId}-create`,
            })
            const snapshotAfterCreate = await request<{ repos: Array<{ id: string; name: string }> }>("openade/snapshot/read")
            const tree = await request<{ entries: Array<{ path: string; type: string }>; truncated: boolean }>("openade/project/files/tree", {
                repoId: repoCreate.repoId,
                maxDepth: 2,
                maxEntries: 20,
            })
            const readme = await request<{ content: string | null; tooLarge: boolean }>("openade/project/file/read", {
                repoId: repoCreate.repoId,
                path: "README.md",
                encoding: "utf8",
            })
            const writeResult = await request<{ path: string; size: number }>("openade/project/file/write", {
                repoId: repoCreate.repoId,
                path: "notes/smoke.txt",
                encoding: "utf8",
                content: "packaged scoped write smoke\n",
                createDirs: true,
                clientRequestId: `${smokeRepoId}-file-write`,
            })
            const search = await request<{ matches: Array<{ path: string; content: string }>; truncated: boolean }>("openade/project/search", {
                repoId: repoCreate.repoId,
                query: "packaged",
                limit: 10,
            })
            const processes = await request<{ processes: Array<{ id: string; name: string }>; errors: unknown[]; instances: unknown[] }>(
                "openade/project/process/list",
                { repoId: repoCreate.repoId }
            )
            const processStart = await request<{ processId: string; runtimeId: string; definitionId: string }>("openade/project/process/start", {
                repoId: repoCreate.repoId,
                definitionId: "openade.toml::Packaged Echo",
                clientRequestId: `${smokeRepoId}-process-start`,
            })
            const processOutput = await waitForProjectProcessOutput(processStart.processId, "packaged scoped process ok")
            const processStop = await request<{ ok: boolean }>("openade/project/process/stop", {
                repoId: repoCreate.repoId,
                processId: processStart.processId,
                clientRequestId: `${smokeRepoId}-process-stop`,
            })
            const plan = await startTurn("plan", "Create a packaged workflow smoke plan")
            const revise = await startTurn("revise", "Tighten the packaged workflow smoke plan", plan.turn.taskId)
            const runPlan = await startTurn("run_plan", "Run the packaged workflow smoke plan", plan.turn.taskId)
            const ask = await startTurn("ask", "Summarize the packaged workflow smoke state", plan.turn.taskId)
            await request("openade/task/metadata/update", {
                taskId: plan.turn.taskId,
                closed: true,
                clientRequestId: `${smokeRepoId}-close`,
            })
            const closedTask = await request<SmokeTask>("openade/task/read", { repoId: smokeRepoId, taskId: plan.turn.taskId, hydrateSessionEvents: false })
            await request("openade/task/metadata/update", {
                taskId: plan.turn.taskId,
                closed: false,
                clientRequestId: `${smokeRepoId}-reopen`,
            })
            const reopenedTask = await request<SmokeTask>("openade/task/read", { repoId: smokeRepoId, taskId: plan.turn.taskId, hydrateSessionEvents: false })

            return {
                platform,
                snapshot,
                repoCreate,
                snapshotAfterCreate,
                tree,
                readme,
                writeResult,
                search,
                processes,
                processStart,
                processOutput,
                processStop,
                workflow: {
                    taskId: plan.turn.taskId,
                    eventIds: [plan.turn.eventId, revise.turn.eventId, runPlan.turn.eventId, ask.turn.eventId],
                    closedState: closedTask.closed,
                    reopenedState: reopenedTask.closed ?? false,
                },
            }
        }, { smokeRepoPath: repoDir, smokeRepoId: repoId })

        expect(runtimeSmoke.platform.platform).toBe(process.platform)
        expect(runtimeSmoke.snapshot.server.version).toBeTruthy()
        expect(Array.isArray(runtimeSmoke.snapshot.repos)).toBe(true)
        expect(Array.isArray(runtimeSmoke.snapshot.workingTaskIds)).toBe(true)
        expect(runtimeSmoke.repoCreate.repoId).toBe(repoId)
        expect(runtimeSmoke.snapshotAfterCreate.repos).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: repoId, name: "Packaged Smoke Repo" })])
        )
        expect(runtimeSmoke.tree.truncated).toBe(false)
        expect(runtimeSmoke.tree.entries).toEqual(expect.arrayContaining([expect.objectContaining({ path: "README.md", type: "file" })]))
        expect(runtimeSmoke.readme).toEqual(expect.objectContaining({ content: "OpenADE packaged smoke fixture\n", tooLarge: false }))
        expect(runtimeSmoke.writeResult).toEqual(expect.objectContaining({ path: "notes/smoke.txt", size: 28 }))
        expect(runtimeSmoke.search.truncated).toBe(false)
        expect(runtimeSmoke.search.matches).toEqual(expect.arrayContaining([expect.objectContaining({ path: "notes/smoke.txt" })]))
        expect(runtimeSmoke.processes).toMatchObject({
            errors: [],
            processes: [expect.objectContaining({ id: "openade.toml::Packaged Echo", name: "Packaged Echo" })],
        })
        expect(runtimeSmoke.processStart.runtimeId).toBe(`process:${runtimeSmoke.processStart.processId}`)
        expect(runtimeSmoke.processOutput.found).toBe(true)
        expect(runtimeSmoke.processOutput.output?.map((chunk) => chunk.data).join("")).toContain("packaged scoped process ok")
        expect(runtimeSmoke.processStop.ok).toBe(true)
        expect(runtimeSmoke.workflow.eventIds).toHaveLength(4)
        expect(runtimeSmoke.workflow.closedState).toBe(true)
        expect(runtimeSmoke.workflow.reopenedState).toBe(false)

        await app.close()
        app = undefined

        const relaunched = await launchSmokeApp()
        app = relaunched.app
        const reloadedWorkflow = await relaunched.page.evaluate(async ({ smokeRepoId, smokeTaskId }) => {
            const api = window.openadeAPI
            if (!api?.runtime) throw new Error("openadeAPI.runtime is not available")
            let nextId = 1
            const request = async <T>(method: string, params?: unknown): Promise<T> => {
                const response = (await api.runtime.request(params === undefined ? { id: nextId++, method } : { id: nextId++, method, params })) as {
                    error?: { message?: string }
                    result?: T
                }
                if (response.error) throw new Error(response.error.message ?? `Runtime request failed: ${method}`)
                return response.result as T
            }
            await api.runtime.connect()
            await request("initialize", { clientName: "OpenADE packaged smoke reload", clientPlatform: "desktop", protocolVersion: 1 })
            const task = await request<{ closed?: boolean; events: Array<{ id?: string; status?: string; source?: { type?: string } }> }>(
                "openade/task/read",
                { repoId: smokeRepoId, taskId: smokeTaskId, hydrateSessionEvents: false }
            )
            return {
                closed: task.closed ?? false,
                completedSources: task.events
                    .filter((event) => event.status === "completed")
                    .map((event) => event.source?.type)
                    .filter(Boolean),
            }
        }, { smokeRepoId: repoId, smokeTaskId: runtimeSmoke.workflow.taskId })

        expect(reloadedWorkflow.closed).toBe(false)
        expect(reloadedWorkflow.completedSources).toEqual(expect.arrayContaining(["plan", "revise", "run_plan", "ask"]))

        await relaunched.page.evaluate(({ smokeRepoId }) => {
            window.location.hash = `/dashboard/code/workspace/${smokeRepoId}`
        }, { smokeRepoId: repoId })
        const classicTask = relaunched.page.locator('[data-openade-surface="desktop-classic-task"]')
        await expect(classicTask).toBeVisible({ timeout: 30_000 })
        await expect(classicTask).toContainText("Create a packaged workflow smoke plan")
        await expect(classicTask).toContainText("Summarize the packaged workflow smoke state")
        await expect(relaunched.page.locator('[data-openade-surface="desktop-shared-project"]')).toHaveCount(0)
        await expect(relaunched.page.locator('[data-openade-surface="desktop-shared-task"]')).toHaveCount(0)

        const rawSmokeTelemetry = await relaunched.page.evaluate((storageKey) => window.localStorage.getItem(storageKey), SMOKE_ANALYTICS_STORAGE_KEY)
        await reviewSmokeTelemetry(test.info(), rawSmokeTelemetry, userDataDir, "runtime-product-smoke-telemetry")
        passed = true
    } finally {
        if (app) {
            await app.close().catch(() => undefined)
        }
        if (passed || process.env.OPENADE_SMOKE_KEEP_ARTIFACTS !== "1") {
            rmSync(userDataDir, { recursive: true, force: true })
            rmSync(repoDir, { recursive: true, force: true })
        } else {
            console.log(`OPENADE_SMOKE_KEEP_ARTIFACTS retained userDataDir=${userDataDir} repoDir=${repoDir}`)
        }
    }
})

test("packaged app launches managed OpenADE Core and exposes the Core runtime endpoint", async () => {
    test.setTimeout(120_000)
    const executablePath = resolveBinary()
    const userDataDir = mkdtempSync(join(tmpdir(), "openade-core-smoke-"))
    const repoDir = mkdtempSync(join(tmpdir(), "openade-core-smoke-repo-"))
    const yjsStorageDir = join(userDataDir, ".openade", "data", "yjs")
    const coreDataDir = join(userDataDir, ".openade", "core")
    const corePort = await getOpenPort()
    const smokeId = `managed-core-smoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    const repoId = `${smokeId}-repo`
    const liveRecoveryPrompt = "managed Core live recovery smoke"
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined
    let passed = false

    const launchManagedCoreSmokeApp = async () => {
        const launchedApp = await electron.launch({
            executablePath,
            timeout: 60_000,
            args: [`--user-data-dir=${userDataDir}`],
            env: {
                ...process.env,
                HOME: userDataDir,
                OPENADE_CORE_DATA_DIR: coreDataDir,
                OPENADE_CORE_PORT: String(corePort),
                OPENADE_CORE_TOKEN: "managed-core-smoke-token",
                OPENADE_DISABLE_ACTIVE_WORK_UNLOAD_BLOCKER: "1",
                OPENADE_SMOKE_DETERMINISTIC_HARNESS: "1",
                OPENADE_SMOKE_DETERMINISTIC_HARNESS_DELAY_MS: "6000",
                OPENADE_SMOKE_DETERMINISTIC_HARNESS_DELAY_PROMPT: liveRecoveryPrompt,
                OPENADE_SMOKE_TEST: "1",
                OPENADE_YJS_STORAGE_DIR: yjsStorageDir,
                USERPROFILE: userDataDir,
            },
        })

        const smokePage = await launchedApp.firstWindow({ timeout: 30_000 })
        await smokePage.waitForURL(/dist\/web\/index\.html|web\/index\.html/, { timeout: 30_000 })
        await smokePage.waitForFunction(() => "openadeAPI" in window, null, { timeout: 30_000 })
        return { app: launchedApp, page: smokePage }
    }

    try {
        writeFileSync(join(repoDir, "README.md"), "OpenADE managed Core smoke fixture\n")
        writeFileSync(
            join(repoDir, "openade.toml"),
            '[[process]]\nname = "Managed Core Echo"\ncommand = "echo managed core scoped process ok"\ntype = "task"\n'
        )
        execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" })
        execFileSync("git", ["config", "user.email", "managed-core-smoke@example.com"], { cwd: repoDir, stdio: "ignore" })
        execFileSync("git", ["config", "user.name", "OpenADE Managed Core Smoke"], { cwd: repoDir, stdio: "ignore" })
        execFileSync("git", ["add", "README.md", "openade.toml"], { cwd: repoDir, stdio: "ignore" })
        execFileSync("git", ["commit", "-m", "Initial managed Core smoke fixture"], { cwd: repoDir, stdio: "ignore" })

        const launched = await launchManagedCoreSmokeApp()
        app = launched.app
        const page = launched.page

        const coreSmoke = await page.evaluate(async ({ hostPlatform, smokeRepoId, smokeRepoPath }) => {
            type RuntimeResponse<T> = { id: number; result?: T; error?: { code?: string; message?: string } }
            type InitializeResult = {
                serverName: string
                protocolVersion: number
                capabilities: { methods: string[]; notifications: string[] }
            }
            type SnapshotResult = {
                server: { version?: string }
                repos: Array<{ id: string; name: string; tasks?: Array<{ id: string; title: string; closed?: boolean }> }>
                workingTaskIds: unknown[]
            }
            type RepoCreateResult = { repoId: string; createdAt: string }
            type TaskCreateResult = { taskId: string; title: string; createdAt: string }
            type TaskEvent = {
                id?: string
                status?: string
                source?: { type?: string }
                userInput?: string
                execution?: {
                    sessionId?: string
                    events?: Array<{ type?: string; usage?: { inputTokens?: number; outputTokens?: number; durationMs?: number } }>
                }
            }
            type TaskReadResult = {
                id: string
                repoId: string
                title: string
                closed?: boolean
                comments: Array<{ id: string; body: string }>
                events: TaskEvent[]
            }
            type TurnStartResult = { taskId: string; eventId?: string; queued?: boolean }
            type RuntimeReadResult = { runtimeId: string; kind?: string; status?: string; processStartedAt?: string }
            type ProjectFilesTreeResult = { entries: Array<{ path: string; type: string }>; truncated: boolean }
            type ProjectFileReadResult = { content: string | null; tooLarge: boolean }
            type ProjectFileWriteResult = { path: string; size: number }
            type ProjectFuzzySearchResult = { results: string[]; truncated: boolean }
            type ProjectSearchResult = { matches: Array<{ path: string; content: string }>; truncated: boolean }
            type ProjectGitInfoResult = { isGitRepo: boolean; mainBranch?: string }
            type GitChangedFile = { path: string; status?: string }
            type GitChangeGroup = { files: GitChangedFile[] }
            type ProjectGitBranchesResult = { defaultBranch: string; branches: Array<{ name: string; isDefault?: boolean }> }
            type GitSummaryResult = {
                branch?: string
                hasChanges: boolean
                staged: GitChangeGroup
                unstaged: GitChangeGroup
                untracked: GitChangedFile[]
            }
            type TaskChangesResult = { files: GitChangedFile[]; fromTreeish: string; toTreeish: string }
            type TaskDiffResult = { filePath: string; patch: string; truncated: boolean }
            type TaskFilePairResult = { filePath: string; before: string; after: string; tooLarge?: boolean }
            type TaskGitLogResult = { commits: Array<{ sha: string; message: string }>; hasMore: boolean }
            type TaskGitCommitResult = { committed: boolean; status: string; sha?: string }
            type ProjectProcessListResult = {
                processes: Array<{ id: string; name: string }>
                errors: unknown[]
                instances: unknown[]
            }
            type ProjectProcessStartResult = { processId: string; runtimeId: string; definitionId: string }
            type ProjectProcessReconnectResult = {
                found: boolean
                completed?: boolean
                output?: Array<{ type: "stdout" | "stderr"; data: string }>
            }
            type TaskTerminalStartResult = { terminalId: string; runtimeId: string; ok: boolean }
            type TaskTerminalReconnectResult = {
                found: boolean
                output?: Array<{ data: string }>
            }
            type MutationOK = { ok: boolean }
            type CommentCreateResult = { commentId: string; createdAt: string }
            type SmokeTelemetryEvent = {
                event_type?: string
                event_properties?: {
                    runtimeProductStoreEnabled?: boolean
                    runtimeProductStoreStatus?: string
                    runtimeProductStoreHasSnapshot?: boolean
                    coreRolloutStatus?: string
                    coreRolloutSource?: string
                    coreRolloutReason?: string
                    coreRolloutAutomatic?: boolean
                    coreLegacyYjsDocumentsPresent?: boolean
                    coreLegacyYjsMigrationAccepted?: boolean
                }
            }

            const endpoint = window.openadeAPI?.core?.runtimeEndpoint
            if (!endpoint) throw new Error("openadeAPI.core.runtimeEndpoint is not available")
            const rolloutState = window.openadeAPI?.core?.rolloutState
            if (!rolloutState) throw new Error("openadeAPI.core.rolloutState is not available")

            const readSmokeEvents = (): SmokeTelemetryEvent[] => {
                const raw = window.localStorage.getItem("openade-smoke-analytics-events")
                if (!raw) return []
                const parsed: unknown = JSON.parse(raw)
                return Array.isArray(parsed) ? (parsed as SmokeTelemetryEvent[]) : []
            }

            const waitForReadyAppOpened = async (): Promise<SmokeTelemetryEvent> => {
                for (let attempt = 0; attempt < 120; attempt++) {
                    const event = readSmokeEvents().find((candidate) => {
                        const props = candidate.event_properties
                        return (
                            candidate.event_type === "app_opened" &&
                            props?.runtimeProductStoreEnabled === true &&
                            props.runtimeProductStoreStatus === "ready" &&
                            props.runtimeProductStoreHasSnapshot === true
                        )
                    })
                    if (event) return event
                    await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 250))
                }
                throw new Error(`Renderer did not report ready Core product store; events: ${JSON.stringify(readSmokeEvents())}`)
            }

            const connect = async (): Promise<WebSocket> => {
                let lastError = ""
                for (let attempt = 0; attempt < 80; attempt++) {
                    try {
                        const socket = new WebSocket(endpoint.url, [`bearer.${endpoint.token}`])
                        await new Promise<void>((resolveSocket, rejectSocket) => {
                            const timeout = window.setTimeout(() => rejectSocket(new Error("Core WebSocket timed out")), 1_000)
                            socket.addEventListener(
                                "open",
                                () => {
                                    window.clearTimeout(timeout)
                                    resolveSocket()
                                },
                                { once: true }
                            )
                            socket.addEventListener(
                                "error",
                                () => {
                                    window.clearTimeout(timeout)
                                    rejectSocket(new Error("Core WebSocket connection failed"))
                                },
                                { once: true }
                            )
                        })
                        return socket
                    } catch (error) {
                        lastError = error instanceof Error ? error.message : String(error)
                        await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 250))
                    }
                }
                throw new Error(`Could not connect to managed Core runtime: ${lastError}`)
            }

            const socket = await connect()
            let nextId = 1
            const request = async <T>(method: string, params?: unknown): Promise<T> => {
                const id = nextId++
                const responsePromise = new Promise<RuntimeResponse<T>>((resolveResponse, rejectResponse) => {
                    const timeout = window.setTimeout(() => rejectResponse(new Error(`Timed out waiting for ${method}`)), 10_000)
                    const onMessage = (event: MessageEvent<string>) => {
                        const parsed = JSON.parse(event.data) as RuntimeResponse<T> | { method?: string }
                        if (!("id" in parsed) || parsed.id !== id) return
                        window.clearTimeout(timeout)
                        socket.removeEventListener("message", onMessage)
                        resolveResponse(parsed)
                    }
                    socket.addEventListener("message", onMessage)
                })
                socket.send(JSON.stringify(params === undefined ? { id, method } : { id, method, params }))
                const response = await responsePromise
                if (response.error) throw new Error(response.error.message ?? `Core request failed: ${method}`)
                return response.result as T
            }
            const sleep = (ms: number) => new Promise((resolveDelay) => window.setTimeout(resolveDelay, ms))
            const waitForProcessOutput = async (processId: string, expectedOutput: string): Promise<ProjectProcessReconnectResult> => {
                let lastResult: ProjectProcessReconnectResult | null = null
                for (let attempt = 0; attempt < 80; attempt++) {
                    const result = await request<ProjectProcessReconnectResult>("openade/project/process/reconnect", {
                        repoId: smokeRepoId,
                        processId,
                    })
                    lastResult = result
                    const output = result.output?.map((chunk) => chunk.data).join("") ?? ""
                    if (output.includes(expectedOutput)) return result
                    await sleep(250)
                }
                throw new Error(`Managed Core process ${processId} did not produce ${expectedOutput}; last result: ${JSON.stringify(lastResult)}`)
            }
            const waitForTerminalOutput = async (
                taskId: string,
                terminalId: string,
                expectedOutput: string
            ): Promise<TaskTerminalReconnectResult> => {
                let lastResult: TaskTerminalReconnectResult | null = null
                for (let attempt = 0; attempt < 80; attempt++) {
                    const result = await request<TaskTerminalReconnectResult>("openade/task/terminal/reconnect", {
                        repoId: smokeRepoId,
                        taskId,
                        terminalId,
                    })
                    lastResult = result
                    const output = result.output?.map((chunk) => chunk.data).join("") ?? ""
                    if (output.includes(expectedOutput)) return result
                    await sleep(250)
                }
                throw new Error(`Managed Core terminal ${terminalId} did not produce ${expectedOutput}; last result: ${JSON.stringify(lastResult)}`)
            }
            const waitForTurnCompletion = async (taskId: string, eventId: string): Promise<TaskReadResult> => {
                let lastEventStates: Array<{ id?: string; status?: string; sourceType?: string }> = []
                for (let attempt = 0; attempt < 80; attempt++) {
                    const task = await request<TaskReadResult>("openade/task/read", {
                        repoId: smokeRepoId,
                        taskId,
                        hydrateSessionEvents: true,
                    })
                    lastEventStates = task.events.map((candidate) => ({
                        id: candidate.id,
                        status: candidate.status,
                        sourceType: candidate.source?.type,
                    }))
                    const event = task.events.find((candidate) => candidate.id === eventId)
                    if (event?.status === "completed") return task
                    if (event?.status === "error" || event?.status === "stopped") {
                        throw new Error(`Managed Core turn event ${eventId} settled as ${event.status}`)
                    }
                    await sleep(250)
                }
                throw new Error(`Managed Core turn event ${eventId} did not complete; last events: ${JSON.stringify(lastEventStates)}`)
            }

            const createdBy = { id: "managed-core-smoke-user", email: "managed-core-smoke@example.com" }
            const initialize = await request<InitializeResult>("initialize", {
                clientName: "OpenADE packaged managed Core smoke",
                clientPlatform: "desktop",
                protocolVersion: 1,
            })
            const snapshot = await request<SnapshotResult>("openade/snapshot/read")
            const repoCreate = await request<RepoCreateResult>("openade/repo/create", {
                repoId: smokeRepoId,
                name: "Managed Core Smoke Repo",
                path: smokeRepoPath,
                createdBy,
                clientRequestId: `${smokeRepoId}-repo-create`,
            })
            const tree = await request<ProjectFilesTreeResult>("openade/project/files/tree", {
                repoId: repoCreate.repoId,
                maxDepth: 2,
                maxEntries: 20,
            })
            const readme = await request<ProjectFileReadResult>("openade/project/file/read", {
                repoId: repoCreate.repoId,
                path: "README.md",
                encoding: "utf8",
            })
            const fileWrite = await request<ProjectFileWriteResult>("openade/project/file/write", {
                repoId: repoCreate.repoId,
                path: "notes/managed-core.txt",
                encoding: "utf8",
                content: "managed Core scoped write smoke\n",
                createDirs: true,
                clientRequestId: `${smokeRepoId}-file-write`,
            })
            const fuzzySearch = await request<ProjectFuzzySearchResult>("openade/project/files/fuzzySearch", {
                repoId: repoCreate.repoId,
                query: "managed-core",
                limit: 10,
            })
            const contentSearch = await request<ProjectSearchResult>("openade/project/search", {
                repoId: repoCreate.repoId,
                query: "managed Core",
                limit: 10,
            })
            const gitInfo = await request<ProjectGitInfoResult>("openade/project/git/info/read", { repoId: repoCreate.repoId })
            const gitBranches = await request<ProjectGitBranchesResult>("openade/project/git/branches/read", {
                repoId: repoCreate.repoId,
                includeRemote: false,
            })
            const projectGitSummary = await request<GitSummaryResult>("openade/project/git/summary/read", { repoId: repoCreate.repoId })
            const processes = await request<ProjectProcessListResult>("openade/project/process/list", { repoId: repoCreate.repoId })
            const processStart = await request<ProjectProcessStartResult>("openade/project/process/start", {
                repoId: repoCreate.repoId,
                definitionId: "openade.toml::Managed Core Echo",
                clientRequestId: `${smokeRepoId}-process-start`,
            })
            const processOutput = await waitForProcessOutput(processStart.processId, "managed core scoped process ok")
            const processStop = await request<MutationOK>("openade/project/process/stop", {
                repoId: repoCreate.repoId,
                processId: processStart.processId,
                clientRequestId: `${smokeRepoId}-process-stop`,
            })
            const taskCreate = await request<TaskCreateResult>("openade/task/create", {
                repoId: repoCreate.repoId,
                input: "Managed Core task create smoke",
                title: "Managed Core Smoke Task",
                createdBy,
                deviceId: "managed-core-smoke-device",
                clientRequestId: `${smokeRepoId}-task-create`,
            })
            const turnStart = await request<TurnStartResult>("openade/turn/start", {
                repoId: repoCreate.repoId,
                inTaskId: taskCreate.taskId,
                type: "ask",
                input: "Run managed Core packaged turn smoke",
                harnessId: "codex",
                modelId: "gpt-smoke",
                clientRequestId: `${smokeRepoId}-turn-start`,
            })
            if (!turnStart.eventId) throw new Error(`Managed Core turn did not return an event id${turnStart.queued ? " because it queued" : ""}`)
            const turnTask = await waitForTurnCompletion(turnStart.taskId, turnStart.eventId)
            const turnRuntime = await request<RuntimeReadResult>("runtime/read", { runtimeId: `openade-turn:${turnStart.eventId}` })
            const taskGitSummary = await request<GitSummaryResult>("openade/task/git/summary/read", {
                repoId: repoCreate.repoId,
                taskId: taskCreate.taskId,
            })
            const taskChanges = await request<TaskChangesResult>("openade/task/changes/read", {
                repoId: repoCreate.repoId,
                taskId: taskCreate.taskId,
            })
            const taskDiff = await request<TaskDiffResult>("openade/task/diff/read", {
                repoId: repoCreate.repoId,
                taskId: taskCreate.taskId,
                filePath: "notes/managed-core.txt",
                contextLines: 3,
            })
            const taskFilePair = await request<TaskFilePairResult>("openade/task/filePair/read", {
                repoId: repoCreate.repoId,
                taskId: taskCreate.taskId,
                filePath: "notes/managed-core.txt",
            })
            const taskGitLog = await request<TaskGitLogResult>("openade/task/git/log", {
                repoId: repoCreate.repoId,
                taskId: taskCreate.taskId,
                limit: 1,
            })
            const taskGitCommit = await request<TaskGitCommitResult>("openade/task/git/commit", {
                repoId: repoCreate.repoId,
                taskId: taskCreate.taskId,
                message: "Managed Core smoke commit",
                clientRequestId: `${smokeRepoId}-git-commit`,
            })
            const taskGitSummaryAfterCommit = await request<GitSummaryResult>("openade/task/git/summary/read", {
                repoId: repoCreate.repoId,
                taskId: taskCreate.taskId,
            })
            const taskGitLogAfterCommit = await request<TaskGitLogResult>("openade/task/git/log", {
                repoId: repoCreate.repoId,
                taskId: taskCreate.taskId,
                limit: 1,
            })
            let terminalLifecycle:
                | {
                      skipped: false
                      start: TaskTerminalStartResult
                      output: TaskTerminalReconnectResult
                      resize: MutationOK
                      stop: MutationOK
                  }
                | { skipped: true; reason: string }
            if (hostPlatform === "win32") {
                terminalLifecycle = { skipped: true, reason: "pty smoke is unix-only" }
            } else {
                const terminalStart = await request<TaskTerminalStartResult>("openade/task/terminal/start", {
                    repoId: repoCreate.repoId,
                    taskId: taskCreate.taskId,
                    cols: 80,
                    rows: 24,
                    clientRequestId: `${smokeRepoId}-terminal-start`,
                })
                await request<MutationOK>("openade/task/terminal/write", {
                    repoId: repoCreate.repoId,
                    taskId: taskCreate.taskId,
                    terminalId: terminalStart.terminalId,
                    data: 'printf "managed core terminal smoke\\n"\n',
                    clientRequestId: `${smokeRepoId}-terminal-write`,
                })
                const terminalOutput = await waitForTerminalOutput(taskCreate.taskId, terminalStart.terminalId, "managed core terminal smoke")
                const terminalResize = await request<MutationOK>("openade/task/terminal/resize", {
                    repoId: repoCreate.repoId,
                    taskId: taskCreate.taskId,
                    terminalId: terminalStart.terminalId,
                    cols: 100,
                    rows: 30,
                    clientRequestId: `${smokeRepoId}-terminal-resize`,
                })
                const terminalStop = await request<MutationOK>("openade/task/terminal/stop", {
                    repoId: repoCreate.repoId,
                    taskId: taskCreate.taskId,
                    terminalId: terminalStart.terminalId,
                    clientRequestId: `${smokeRepoId}-terminal-stop`,
                })
                terminalLifecycle = {
                    skipped: false,
                    start: terminalStart,
                    output: terminalOutput,
                    resize: terminalResize,
                    stop: terminalStop,
                }
            }
            const commentCreate = await request<CommentCreateResult>("openade/comment/create", {
                taskId: taskCreate.taskId,
                content: "Managed Core comment smoke",
                source: { type: "task" },
                selectedText: { value: "", start: 0, end: 0 },
                author: createdBy,
                clientRequestId: `${smokeRepoId}-comment-create`,
            })
            const titleUpdate = await request<MutationOK>("openade/task/metadata/update", {
                taskId: taskCreate.taskId,
                title: "Managed Core Smoke Task Updated",
                closed: true,
                lastViewedAt: new Date().toISOString(),
                clientRequestId: `${smokeRepoId}-metadata-update`,
            })
            const task = await request<TaskReadResult>("openade/task/read", {
                repoId: repoCreate.repoId,
                taskId: taskCreate.taskId,
                hydrateSessionEvents: false,
            })
            const snapshotAfterWorkflow = await request<SnapshotResult>("openade/snapshot/read")
            socket.close()
            const appOpened = await waitForReadyAppOpened()

            return {
                endpointUrl: endpoint.url,
                endpointHasToken: endpoint.token.length > 0,
                rolloutState,
                initialize,
                snapshot,
                repoCreate,
                tree,
                readme,
                fileWrite,
                fuzzySearch,
                contentSearch,
                gitInfo,
                gitBranches,
                projectGitSummary,
                processes,
                processStart,
                processOutput,
                processStop,
                taskCreate,
                turnStart,
                turnTask,
                turnRuntime,
                taskGitSummary,
                taskChanges,
                taskDiff,
                taskFilePair,
                taskGitLog,
                taskGitCommit,
                taskGitSummaryAfterCommit,
                taskGitLogAfterCommit,
                terminalLifecycle,
                commentCreate,
                titleUpdate,
                task,
                snapshotAfterWorkflow,
                appOpened,
            }
        }, { hostPlatform: process.platform, smokeRepoId: repoId, smokeRepoPath: repoDir })

        expect(coreSmoke.endpointUrl).toBe(`ws://127.0.0.1:${corePort}/v1/runtime`)
        expect(coreSmoke.endpointHasToken).toBe(true)
        expect(coreSmoke.rolloutState).toEqual({
            status: "connected",
            source: "managed",
            reason: "managed-core",
            automatic: true,
            legacyYjsDocumentsPresent: false,
            legacyYjsMigrationAccepted: false,
        })
        expect(coreSmoke.initialize.serverName).toBe("openade-core")
        expect(coreSmoke.initialize.protocolVersion).toBe(1)
        expect(coreSmoke.initialize.capabilities.methods).toEqual(
            expect.arrayContaining([
                "initialize",
                "openade/snapshot/read",
                "openade/repo/create",
                "openade/task/create",
                "openade/turn/start",
                "openade/comment/create",
                "runtime/read",
                "openade/project/files/fuzzySearch",
                "openade/project/git/branches/read",
                "openade/project/git/summary/read",
                "openade/task/git/summary/read",
                "openade/task/changes/read",
                "openade/task/diff/read",
                "openade/task/filePair/read",
                "openade/task/git/log",
                "openade/task/git/commit",
                "openade/project/process/start",
                "openade/project/process/reconnect",
                "openade/project/process/stop",
                "openade/task/terminal/start",
                "openade/task/terminal/reconnect",
                "openade/task/terminal/write",
                "openade/task/terminal/resize",
                "openade/task/terminal/stop",
            ])
        )
        expect(Array.isArray(coreSmoke.snapshot.repos)).toBe(true)
        expect(Array.isArray(coreSmoke.snapshot.workingTaskIds)).toBe(true)
        expect(coreSmoke.repoCreate.repoId).toBe(repoId)
        expect(coreSmoke.tree.truncated).toBe(false)
        expect(coreSmoke.tree.entries).toEqual(expect.arrayContaining([expect.objectContaining({ path: "README.md", type: "file" })]))
        expect(coreSmoke.readme).toEqual(expect.objectContaining({ content: "OpenADE managed Core smoke fixture\n", tooLarge: false }))
        expect(coreSmoke.fileWrite).toEqual(expect.objectContaining({ path: "notes/managed-core.txt", size: 32 }))
        expect(coreSmoke.fuzzySearch.truncated).toBe(false)
        expect(coreSmoke.fuzzySearch.results).toEqual(expect.arrayContaining(["notes/managed-core.txt"]))
        expect(coreSmoke.contentSearch.truncated).toBe(false)
        expect(coreSmoke.contentSearch.matches).toEqual(expect.arrayContaining([expect.objectContaining({ path: "notes/managed-core.txt" })]))
        expect(coreSmoke.gitInfo.isGitRepo).toBe(true)
        expect(coreSmoke.gitInfo.mainBranch).toBeTruthy()
        expect(coreSmoke.gitBranches.defaultBranch).toBeTruthy()
        expect(coreSmoke.gitBranches.branches.length).toBeGreaterThan(0)
        expect(coreSmoke.projectGitSummary.hasChanges).toBe(true)
        expect(coreSmoke.projectGitSummary.untracked).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: "notes/managed-core.txt" })])
        )
        expect(coreSmoke.processes).toMatchObject({
            errors: [],
            processes: [expect.objectContaining({ id: "openade.toml::Managed Core Echo", name: "Managed Core Echo" })],
        })
        expect(coreSmoke.processStart).toMatchObject({
            definitionId: "openade.toml::Managed Core Echo",
            runtimeId: `process:${coreSmoke.processStart.processId}`,
        })
        expect(coreSmoke.processOutput).toMatchObject({ found: true })
        expect(coreSmoke.processOutput.output?.map((chunk) => chunk.data).join("")).toContain("managed core scoped process ok")
        expect(coreSmoke.processStop.ok).toBe(true)
        expect(coreSmoke.taskCreate.title).toBe("Managed Core Smoke Task")
        expect(coreSmoke.turnStart).toMatchObject({
            taskId: coreSmoke.taskCreate.taskId,
        })
        expect(coreSmoke.turnStart.eventId).toBeTruthy()
        expect(coreSmoke.turnRuntime).toMatchObject({
            runtimeId: `openade-turn:${coreSmoke.turnStart.eventId}`,
            kind: "agent",
            status: "completed",
        })
        expect(coreSmoke.turnRuntime.processStartedAt).toBeTruthy()
        const turnEvent = coreSmoke.turnTask.events.find((event) => event.id === coreSmoke.turnStart.eventId)
        expect(turnEvent).toMatchObject({
            id: coreSmoke.turnStart.eventId,
            status: "completed",
            source: { type: "ask" },
            userInput: "Run managed Core packaged turn smoke",
            execution: { sessionId: "smoke-codex-session" },
        })
        expect(turnEvent?.execution?.events).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: "complete", usage: expect.objectContaining({ inputTokens: 1, outputTokens: 1 }) })])
        )
        expect(coreSmoke.taskGitSummary.hasChanges).toBe(true)
        expect(coreSmoke.taskGitSummary.untracked).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: "notes/managed-core.txt" })])
        )
        expect(coreSmoke.taskChanges.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: "notes/managed-core.txt" })]))
        expect(coreSmoke.taskDiff).toMatchObject({ filePath: "notes/managed-core.txt", truncated: false })
        expect(coreSmoke.taskDiff.patch).toContain("managed Core scoped write smoke")
        expect(coreSmoke.taskFilePair).toMatchObject({
            filePath: "notes/managed-core.txt",
            before: "",
            after: "managed Core scoped write smoke\n",
        })
        expect(coreSmoke.taskFilePair.tooLarge).not.toBe(true)
        expect(coreSmoke.taskGitLog.commits[0]?.message).toBe("Initial managed Core smoke fixture")
        expect(coreSmoke.taskGitCommit).toMatchObject({
            committed: true,
            status: "committed",
        })
        expect(coreSmoke.taskGitCommit.sha).toBeTruthy()
        expect(coreSmoke.taskGitSummaryAfterCommit.hasChanges).toBe(false)
        expect(coreSmoke.taskGitSummaryAfterCommit.untracked).toEqual([])
        expect(coreSmoke.taskGitLogAfterCommit.commits[0]).toMatchObject({
            sha: coreSmoke.taskGitCommit.sha,
            message: "Managed Core smoke commit",
        })
        if (process.platform === "win32") {
            expect(coreSmoke.terminalLifecycle).toEqual({ skipped: true, reason: "pty smoke is unix-only" })
        } else {
            expect(coreSmoke.terminalLifecycle.skipped).toBe(false)
            if (coreSmoke.terminalLifecycle.skipped) throw new Error("terminal lifecycle should run on non-Windows smoke")
            const terminalLifecycle = coreSmoke.terminalLifecycle
            expect(terminalLifecycle).toMatchObject({
                skipped: false,
                start: {
                    ok: true,
                    runtimeId: `pty:${terminalLifecycle.start.terminalId}`,
                },
                resize: { ok: true },
                stop: { ok: true },
            })
            expect(terminalLifecycle.output).toMatchObject({ found: true })
            expect(terminalLifecycle.output.output?.map((chunk) => chunk.data).join("")).toContain("managed core terminal smoke")
        }
        expect(coreSmoke.commentCreate.commentId).toBeTruthy()
        expect(coreSmoke.titleUpdate.ok).toBe(true)
        expect(coreSmoke.task).toMatchObject({
            id: coreSmoke.taskCreate.taskId,
            repoId,
            title: "Managed Core Smoke Task Updated",
            closed: true,
            comments: [expect.objectContaining({ id: coreSmoke.commentCreate.commentId, body: "Managed Core comment smoke" })],
        })
        expect(coreSmoke.snapshotAfterWorkflow.repos).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: repoId,
                    name: "Managed Core Smoke Repo",
                    tasks: [expect.objectContaining({ id: coreSmoke.taskCreate.taskId, title: "Managed Core Smoke Task Updated", closed: true })],
                }),
            ])
        )
        expect(coreSmoke.appOpened.event_properties).toMatchObject({
            runtimeProductStoreEnabled: true,
            runtimeProductStoreStatus: "ready",
            runtimeProductStoreHasSnapshot: true,
            coreRolloutStatus: "connected",
            coreRolloutSource: "managed",
            coreRolloutReason: "managed-core",
            coreRolloutAutomatic: true,
            coreLegacyYjsDocumentsPresent: false,
            coreLegacyYjsMigrationAccepted: false,
        })
        const rawSmokeTelemetry = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), SMOKE_ANALYTICS_STORAGE_KEY)
        await reviewSmokeTelemetry(test.info(), rawSmokeTelemetry, userDataDir, "managed-core-runtime-product-smoke-telemetry")

        await page.evaluate(({ smokeRepoId, smokeTaskId }) => {
            window.location.hash = `/dashboard/code/workspace/${smokeRepoId}/task/${smokeTaskId}`
        }, { smokeRepoId: repoId, smokeTaskId: coreSmoke.taskCreate.taskId })
        const classicCoreTask = page.locator('[data-openade-surface="desktop-classic-task"]')
        await expect(classicCoreTask).toBeVisible({ timeout: 30_000 })
        await expect(classicCoreTask).toContainText("Run managed Core packaged turn smoke")
        await expect(page.locator('[data-openade-surface="desktop-shared-project"]')).toHaveCount(0)
        await expect(page.locator('[data-openade-surface="desktop-shared-task"]')).toHaveCount(0)

        const liveRecovery = await page.evaluate(async ({ smokeRepoId, smokeTaskId, prompt }) => {
            type RuntimeResponse<T> = { id: number; result?: T; error?: { code?: string; message?: string } }
            type TurnStartResult = { taskId: string; eventId?: string; queued?: boolean }
            type RuntimeReadResult = { runtimeId: string; kind?: string; status?: string; processStartedAt?: string }

            const endpoint = window.openadeAPI?.core?.runtimeEndpoint
            if (!endpoint) throw new Error("openadeAPI.core.runtimeEndpoint is not available")
            const socket = new WebSocket(endpoint.url, [`bearer.${endpoint.token}`])
            await new Promise<void>((resolveSocket, rejectSocket) => {
                const timeout = window.setTimeout(() => rejectSocket(new Error("Core WebSocket timed out")), 3_000)
                socket.addEventListener(
                    "open",
                    () => {
                        window.clearTimeout(timeout)
                        resolveSocket()
                    },
                    { once: true }
                )
                socket.addEventListener(
                    "error",
                    () => {
                        window.clearTimeout(timeout)
                        rejectSocket(new Error("Core WebSocket connection failed"))
                    },
                    { once: true }
                )
            })
            let nextId = 1
            const request = async <T>(method: string, params?: unknown): Promise<T> => {
                const id = nextId++
                const responsePromise = new Promise<RuntimeResponse<T>>((resolveResponse, rejectResponse) => {
                    const timeout = window.setTimeout(() => rejectResponse(new Error(`Timed out waiting for ${method}`)), 12_000)
                    const onMessage = (event: MessageEvent<string>) => {
                        const parsed = JSON.parse(event.data) as RuntimeResponse<T> | { method?: string }
                        if (!("id" in parsed) || parsed.id !== id) return
                        window.clearTimeout(timeout)
                        socket.removeEventListener("message", onMessage)
                        resolveResponse(parsed)
                    }
                    socket.addEventListener("message", onMessage)
                })
                socket.send(JSON.stringify(params === undefined ? { id, method } : { id, method, params }))
                const response = await responsePromise
                if (response.error) throw new Error(response.error.message ?? `Core request failed: ${method}`)
                return response.result as T
            }
            await request("initialize", {
                clientName: "OpenADE packaged managed Core live recovery smoke",
                clientPlatform: "desktop",
                protocolVersion: 1,
            })
            const turnStart = await request<TurnStartResult>("openade/turn/start", {
                repoId: smokeRepoId,
                inTaskId: smokeTaskId,
                type: "ask",
                input: prompt,
                harnessId: "codex",
                modelId: "gpt-smoke",
                clientRequestId: `${smokeRepoId}-live-recovery-turn`,
            })
            if (!turnStart.eventId) throw new Error(`Live recovery turn did not return an event id${turnStart.queued ? " because it queued" : ""}`)
            const runtimeId = `openade-turn:${turnStart.eventId}`
            let runtime: RuntimeReadResult | null = null
            for (let attempt = 0; attempt < 80; attempt++) {
                runtime = await request<RuntimeReadResult>("runtime/read", { runtimeId })
                if (runtime?.status === "running" && runtime.processStartedAt) {
                    socket.close()
                    return { taskId: turnStart.taskId, eventId: turnStart.eventId, runtimeId, runtime }
                }
                await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 100))
            }
            throw new Error(`Live recovery runtime did not start with process metadata: ${JSON.stringify(runtime)}`)
        }, { smokeRepoId: repoId, smokeTaskId: coreSmoke.taskCreate.taskId, prompt: liveRecoveryPrompt })

        await app.close()
        app = undefined

        const relaunched = await launchManagedCoreSmokeApp()
        app = relaunched.app
        const relaunchRolloutState = await relaunched.page.evaluate(() => window.openadeAPI?.core?.rolloutState)
        expect(relaunchRolloutState).toEqual({
            status: "connected",
            source: "managed",
            reason: "managed-core",
            automatic: true,
            legacyYjsDocumentsPresent: false,
            legacyYjsMigrationAccepted: false,
        })
        const recoveredLiveTurn = await relaunched.page.evaluate(async ({ smokeRepoId, smokeTaskId, eventId, runtimeId, prompt }) => {
            type RuntimeResponse<T> = { id: number; result?: T; error?: { code?: string; message?: string } }
            type RuntimeReadResult = { runtimeId: string; kind?: string; status?: string; processStartedAt?: string }
            type TaskEvent = {
                id?: string
                status?: string
                userInput?: string
                execution?: {
                    sessionId?: string
                    events?: Array<{ type?: string; usage?: { inputTokens?: number; outputTokens?: number; durationMs?: number } }>
                }
            }
            type TaskReadResult = { id: string; events: TaskEvent[] }

            const endpoint = window.openadeAPI?.core?.runtimeEndpoint
            if (!endpoint) throw new Error("openadeAPI.core.runtimeEndpoint is not available after relaunch")
            const socket = new WebSocket(endpoint.url, [`bearer.${endpoint.token}`])
            await new Promise<void>((resolveSocket, rejectSocket) => {
                const timeout = window.setTimeout(() => rejectSocket(new Error("Core WebSocket timed out after relaunch")), 3_000)
                socket.addEventListener(
                    "open",
                    () => {
                        window.clearTimeout(timeout)
                        resolveSocket()
                    },
                    { once: true }
                )
                socket.addEventListener(
                    "error",
                    () => {
                        window.clearTimeout(timeout)
                        rejectSocket(new Error("Core WebSocket connection failed after relaunch"))
                    },
                    { once: true }
                )
            })
            let nextId = 1
            const request = async <T>(method: string, params?: unknown): Promise<T> => {
                const id = nextId++
                const responsePromise = new Promise<RuntimeResponse<T>>((resolveResponse, rejectResponse) => {
                    const timeout = window.setTimeout(() => rejectResponse(new Error(`Timed out waiting for ${method}`)), 15_000)
                    const onMessage = (event: MessageEvent<string>) => {
                        const parsed = JSON.parse(event.data) as RuntimeResponse<T> | { method?: string }
                        if (!("id" in parsed) || parsed.id !== id) return
                        window.clearTimeout(timeout)
                        socket.removeEventListener("message", onMessage)
                        resolveResponse(parsed)
                    }
                    socket.addEventListener("message", onMessage)
                })
                socket.send(JSON.stringify(params === undefined ? { id, method } : { id, method, params }))
                const response = await responsePromise
                if (response.error) throw new Error(response.error.message ?? `Core request failed: ${method}`)
                return response.result as T
            }
            await request("initialize", {
                clientName: "OpenADE packaged managed Core live recovery relaunch smoke",
                clientPlatform: "desktop",
                protocolVersion: 1,
            })
            let runtime: RuntimeReadResult | null = null
            let task: TaskReadResult | null = null
            for (let attempt = 0; attempt < 100; attempt++) {
                runtime = await request<RuntimeReadResult>("runtime/read", { runtimeId })
                task = await request<TaskReadResult>("openade/task/read", {
                    repoId: smokeRepoId,
                    taskId: smokeTaskId,
                    hydrateSessionEvents: true,
                })
                const event = task.events.find((candidate) => candidate.id === eventId)
                if (runtime?.status === "completed" && event?.status === "completed") {
                    socket.close()
                    return { runtime, event }
                }
                if (runtime?.status === "failed" || runtime?.status === "stopped" || event?.status === "error" || event?.status === "stopped") {
                    throw new Error(`Live recovery turn settled incorrectly: ${JSON.stringify({ runtime, event })}`)
                }
                await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 250))
            }
            throw new Error(`Live recovery turn did not complete after relaunch: ${JSON.stringify({ runtime, task, prompt })}`)
        }, { smokeRepoId: repoId, smokeTaskId: coreSmoke.taskCreate.taskId, eventId: liveRecovery.eventId, runtimeId: liveRecovery.runtimeId, prompt: liveRecoveryPrompt })
        expect(recoveredLiveTurn.runtime).toMatchObject({
            runtimeId: liveRecovery.runtimeId,
            kind: "agent",
            status: "completed",
        })
        expect(recoveredLiveTurn.runtime.processStartedAt).toBeTruthy()
        expect(recoveredLiveTurn.event).toMatchObject({
            id: liveRecovery.eventId,
            status: "completed",
            userInput: liveRecoveryPrompt,
            execution: { sessionId: "smoke-codex-session" },
        })
        expect(recoveredLiveTurn.event.execution?.events).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: "complete", usage: expect.objectContaining({ inputTokens: 1, outputTokens: 1 }) })])
        )
        await relaunched.page.evaluate(({ smokeRepoId, smokeTaskId }) => {
            window.location.hash = `/dashboard/code/workspace/${smokeRepoId}/task/${smokeTaskId}`
        }, { smokeRepoId: repoId, smokeTaskId: coreSmoke.taskCreate.taskId })
        const relaunchedClassicCoreTask = relaunched.page.locator('[data-openade-surface="desktop-classic-task"]')
        await expect(relaunchedClassicCoreTask).toBeVisible({ timeout: 30_000 })
        await expect(relaunchedClassicCoreTask).toContainText("Run managed Core packaged turn smoke")
        await expect(relaunchedClassicCoreTask).toContainText(liveRecoveryPrompt)
        await expect(relaunched.page.locator('[data-openade-surface="desktop-shared-project"]')).toHaveCount(0)
        await expect(relaunched.page.locator('[data-openade-surface="desktop-shared-task"]')).toHaveCount(0)

        passed = true
    } finally {
        if (app) {
            await app.close().catch(() => undefined)
        }
        if (passed || process.env.OPENADE_SMOKE_KEEP_ARTIFACTS !== "1") {
            rmSync(userDataDir, { recursive: true, force: true })
            rmSync(repoDir, { recursive: true, force: true })
        } else {
            console.log(`OPENADE_SMOKE_KEEP_ARTIFACTS retained managed Core userDataDir=${userDataDir} repoDir=${repoDir}`)
        }
    }
})
