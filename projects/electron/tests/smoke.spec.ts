import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron, expect, test } from "@playwright/test"

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
