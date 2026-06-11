import { spawn, type ChildProcess } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

import { RuntimeClient, RuntimeClientError } from "../../../runtime-client/src"
import { runtimeSocketUrl } from "../../../web/src/kernel/session"
import { OpenADEClient } from "../index"
import { OPENADE_ERROR_CODES, OPENADE_METHODS, OPENADE_NOTIFICATIONS } from "./openade-contracts"

const CORE_TOKEN = "openade-client-contract-test-token"
const TEST_TIMEOUT_MS = 120_000
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(THIS_DIR, "../..")
const CORE_ROOT = path.resolve(PACKAGE_ROOT, "../openade-core")

interface StartedCore {
    process: ChildProcess
    dataDir: string
    port: number
    output: () => string
}

interface InitializeResult {
    protocolVersion: number
    serverName: string
    capabilities: {
        methods: string[]
        notifications: string[]
    }
}

interface PairingStartResult {
    url: string
    token: string
    hostId: string
    expiresAt: string
}

interface RemoteDevice {
    id: string
    name: string
    platform: string
    pairedAt: string
    lastSeenAt?: string
    revokedAt?: string
}

interface PairDeviceResult {
    device: RemoteDevice
    deviceToken: string
}

const startedCores: StartedCore[] = []

afterEach(async () => {
    while (startedCores.length > 0) {
        const core = startedCores.pop()
        if (core) await stopCore(core)
    }
})

describe("generated OpenADE contracts", () => {
    it(
        "match live Go Core capabilities and drive the typed client over WebSocket",
        async () => {
            const core = await startCore()
            const initialize = await initializeRuntime(core.port)
            const advertised = new Set(initialize.capabilities.methods)
            const missingMethods = OPENADE_METHODS.filter((method) => !advertised.has(method))
            const advertisedNotifications = new Set(initialize.capabilities.notifications)
            const missingNotifications = OPENADE_NOTIFICATIONS.filter((notification) => !advertisedNotifications.has(notification))

            expect(initialize.protocolVersion).toBe(1)
            expect(initialize.serverName).toBe("openade-core")
            expect(missingMethods).toEqual([])
            expect(missingNotifications).toEqual([])

            const runtime = new RuntimeClient({
                url: runtimeUrl(core.port),
                token: CORE_TOKEN,
                clientName: "OpenADE Client Contract Test",
                clientPlatform: "cli",
                reconnect: false,
            })
            const client = new OpenADEClient({
                runtime,
                clientName: "OpenADE Client Contract Test",
                clientPlatform: "cli",
            })

            try {
                const snapshot = await client.getSnapshot()
                expect(snapshot.server.version).toBeDefined()
                expect(snapshot.repos).toEqual([])
                expect(snapshot.workingTaskIds).toEqual([])

                const repoPath = path.join(core.dataDir, "contract-repo")
                mkdirSync(repoPath, { recursive: true })
                await client.createRepo({
                    repoId: "repo-contract",
                    name: "Contract Repo",
                    path: repoPath,
                    createdBy: { id: "contract-user", email: "contract@example.com" },
                    clientRequestId: "contract-repo-create",
                })
                const createdTask = await client.createTask({
                    repoId: "repo-contract",
                    taskId: "task-contract",
                    slug: "contract-task",
                    title: "Contract task",
                    input: "Exercise typed usage backfill",
                    createdBy: { id: "contract-user", email: "contract@example.com" },
                    deviceId: "device-contract",
                    isolationStrategy: { type: "head" },
                    clientRequestId: "contract-task-create",
                })
                const taskPreviews = await client.listTasks("repo-contract")
                expect(taskPreviews).toEqual([
                    expect.objectContaining({
                        id: createdTask.taskId,
                        title: "Contract task",
                    }),
                ])
                await client.createActionEvent({
                    taskId: createdTask.taskId,
                    eventId: "event-contract-usage",
                    userInput: "Track usage",
                    executionId: "exec-contract-usage",
                    harnessId: "codex",
                    modelId: "gpt-contract",
                    source: { type: "do", userLabel: "Do" },
                    clientRequestId: "contract-action-create",
                })
                await client.appendActionStreamEvent({
                    taskId: createdTask.taskId,
                    eventId: "event-contract-usage",
                    streamEvent: {
                        id: "complete-contract-usage",
                        direction: "execution",
                        type: "complete",
                        executionId: "exec-contract-usage",
                        harnessId: "codex",
                        usage: {
                            inputTokens: 17,
                            outputTokens: 11,
                            costUsd: 0.017,
                            durationMs: 123,
                        },
                    },
                    clientRequestId: "contract-action-stream",
                })
                await client.completeActionEvent({
                    taskId: createdTask.taskId,
                    eventId: "event-contract-usage",
                    success: true,
                    clientRequestId: "contract-action-complete",
                })

                const backfill = await client.backfillTaskUsage({
                    repoId: "repo-contract",
                    taskIds: [createdTask.taskId],
                    clientRequestId: "contract-usage-backfill",
                })
                expect(backfill).toMatchObject({
                    updatedTasks: 1,
                    skippedTasks: 0,
                    tasks: [
                        {
                            repoId: "repo-contract",
                            taskId: createdTask.taskId,
                            usage: {
                                usageVersion: 2,
                                inputTokens: 17,
                                outputTokens: 11,
                                totalCostUsd: 0.017,
                                eventCount: 1,
                                costByModel: { "gpt-contract": 0.017 },
                                durationMs: 123,
                            },
                        },
                    ],
                })

                const updatedSnapshot = await client.getSnapshot()
                expect(updatedSnapshot.repos[0]?.tasks[0]?.usage).toMatchObject({
                    usageVersion: 2,
                    inputTokens: 17,
                    outputTokens: 11,
                    durationMs: 123,
                })
            } finally {
                client.close()
            }
        },
        TEST_TIMEOUT_MS
    )

    it(
        "pairs a mobile-style client and attaches through the shared Core WebSocket protocol",
        async () => {
            const core = await startCore()
            const trustedRuntime = new RuntimeClient({
                url: runtimeUrl(core.port),
                token: CORE_TOKEN,
                clientName: "OpenADE Trusted Pairing Contract Test",
                clientPlatform: "desktop",
                reconnect: false,
            })
            const trustedClient = new OpenADEClient({
                runtime: trustedRuntime,
                clientName: "OpenADE Trusted Pairing Contract Test",
                clientPlatform: "desktop",
            })

            try {
                const repoPath = path.join(core.dataDir, "paired-repo")
                mkdirSync(repoPath, { recursive: true })
                writeFileSync(
                    path.join(repoPath, "openade.toml"),
                    [
                        "[[cron]]",
                        'name = "Paired Nightly"',
                        'schedule = "0 9 * * 1"',
                        'type = "ask"',
                        'prompt = "Summarize paired contract progress"',
                        "",
                    ].join("\n")
                )
                await trustedClient.createRepo({
                    repoId: "repo-paired-contract",
                    name: "Paired Contract Repo",
                    path: repoPath,
                    createdBy: { id: "trusted-user", email: "trusted@example.com" },
                    clientRequestId: "paired-contract-repo-create",
                })

                const paired = await pairMobileClient(core, trustedRuntime)
                expect(paired.device).toMatchObject({
                    name: "Contract iPhone",
                    platform: "ios",
                })
                expect(paired.device.id).toMatch(/^device-/)
                expect(paired.deviceToken.length).toBeGreaterThan(16)

                const pairedInitialize = await initializeRuntime(core.port, paired.deviceToken, "mobile")
                const pairedMethods = new Set(pairedInitialize.capabilities.methods)
                expect(pairedMethods.has("openade/snapshot/read")).toBe(true)
                expect(pairedMethods.has("openade/task/list")).toBe(true)
                expect(pairedMethods.has("openade/task/create")).toBe(true)
                expect(pairedMethods.has("openade/turn/start")).toBe(true)
                expect(pairedMethods.has("openade/cron/definitions/read")).toBe(true)
                expect(pairedMethods.has("openade/queued-turn/enqueue")).toBe(true)
                expect(pairedMethods.has("openade/queued-turn/reorder")).toBe(true)
                expect(pairedMethods.has("openade/queued-turn/cancel")).toBe(true)
                expect(pairedMethods.has("remote/device/selfRevoke")).toBe(true)
                expect(pairedMethods.has("openade/project/file/write")).toBe(false)
                expect(pairedMethods.has("openade/repo/create")).toBe(false)
                expect(pairedMethods.has("remote/pairing/start")).toBe(false)
                const pairedNotifications = new Set(pairedInitialize.capabilities.notifications)
                expect(pairedNotifications.has("openade/task/updated")).toBe(true)
                expect(pairedNotifications.has("remote/device/changed")).toBe(true)
                expect(pairedNotifications.has("runtime/completed")).toBe(false)

                const pairedRuntime = new RuntimeClient({
                    url: runtimeUrl(core.port),
                    token: paired.deviceToken,
                    clientName: "OpenADE Mobile Contract Test",
                    clientPlatform: "mobile",
                    reconnect: false,
                })
                const pairedClient = new OpenADEClient({
                    runtime: pairedRuntime,
                    clientName: "OpenADE Mobile Contract Test",
                    clientPlatform: "mobile",
                })

                try {
                    const snapshot = await pairedClient.getSnapshot()
                    expect(snapshot.repos.map((repo) => repo.id)).toContain("repo-paired-contract")
                    const initialTaskPreviews = await pairedClient.listTasks("repo-paired-contract")
                    expect(initialTaskPreviews).toEqual([])

                    const cronDefinitions = await pairedClient.readCronDefinitions({ repoId: "repo-paired-contract" })
                    expect(cronDefinitions.configs).toEqual([
                        expect.objectContaining({
                            relativePath: "openade.toml",
                            crons: [
                                expect.objectContaining({
                                    id: "openade.toml::Paired Nightly",
                                    name: "Paired Nightly",
                                    prompt: "Summarize paired contract progress",
                                    type: "ask",
                                }),
                            ],
                        }),
                    ])

                    const turn = await pairedClient.startTurn({
                        repoId: "repo-paired-contract",
                        type: "ask",
                        input: "Can a paired client attach through Core?",
                        harnessId: "codex",
                        modelId: "gpt-paired-contract",
                        title: "Paired attach contract",
                        clientRequestId: "paired-contract-turn-start",
                    })
                    expect(turn.taskId).toMatch(/^task-/)
                    expect(turn.eventId).toMatch(/^event-/)

                    const task = await pairedClient.getTask("repo-paired-contract", turn.taskId, { hydrateSessionEvents: true })
                    expect(task.events[0]).toMatchObject({
                        id: turn.eventId,
                        type: "action",
                        userInput: "Can a paired client attach through Core?",
                    })
                    const pairedTaskPreviews = await pairedClient.listTasks("repo-paired-contract")
                    expect(pairedTaskPreviews).toEqual([
                        expect.objectContaining({
                            id: turn.taskId,
                            title: "Paired attach contract",
                        }),
                    ])

                    const firstQueued = await pairedClient.enqueueQueuedTurn({
                        repoId: "repo-paired-contract",
                        taskId: turn.taskId,
                        type: "ask",
                        input: "First paired queued turn",
                        clientRequestId: "paired-contract-queue-first",
                    })
                    const secondQueued = await pairedClient.enqueueQueuedTurn({
                        repoId: "repo-paired-contract",
                        taskId: turn.taskId,
                        type: "do",
                        input: "Second paired queued turn",
                        clientRequestId: "paired-contract-queue-second",
                    })
                    expect(firstQueued).toMatchObject({
                        taskId: turn.taskId,
                        queued: true,
                        turn: expect.objectContaining({
                            input: "First paired queued turn",
                            status: "queued",
                        }),
                    })
                    expect(secondQueued).toMatchObject({
                        taskId: turn.taskId,
                        queued: true,
                        turn: expect.objectContaining({
                            input: "Second paired queued turn",
                            status: "queued",
                        }),
                    })

                    const reordered = await pairedClient.reorderQueuedTurns({
                        repoId: "repo-paired-contract",
                        taskId: turn.taskId,
                        queuedTurnIds: [secondQueued.queuedTurnId, firstQueued.queuedTurnId],
                        clientRequestId: "paired-contract-queue-reorder",
                    })
                    expect(reordered).toMatchObject({
                        taskId: turn.taskId,
                        reordered: true,
                    })
                    expect(reordered.turns.map((queuedTurn) => queuedTurn.id)).toEqual([
                        secondQueued.queuedTurnId,
                        firstQueued.queuedTurnId,
                    ])

                    const taskAfterQueue = await pairedClient.getTask("repo-paired-contract", turn.taskId)
                    expect(taskAfterQueue.queuedTurns?.map((queuedTurn) => queuedTurn.id)).toEqual([
                        secondQueued.queuedTurnId,
                        firstQueued.queuedTurnId,
                    ])

                    await pairedClient.interruptTurn(turn.taskId, { clientRequestId: "paired-contract-turn-interrupt" })

                    const deniedWrite = await rejectedError(() =>
                        pairedClient.writeProjectFile({
                            repoId: "repo-paired-contract",
                            path: "denied.txt",
                            encoding: "utf8",
                            content: "paired clients must not write files by default",
                            clientRequestId: "paired-contract-file-write-denied",
                        })
                    )
                    expectRuntimeClientErrorCode(deniedWrite, "permission_denied")

                    const unknownMethod = await rejectedError(() => pairedRuntime.request("openade/contract-test/unknown"))
                    expectRuntimeClientErrorCode(unknownMethod, "method_not_found")

                    const selfRevoked = await pairedRuntime.request<{ ok: boolean; revoked: boolean }>("remote/device/selfRevoke")
                    expect(selfRevoked).toEqual({ ok: true, revoked: true })
                } finally {
                    pairedClient.close()
                }
            } finally {
                trustedClient.close()
            }
        },
        TEST_TIMEOUT_MS
    )
})

async function startCore(): Promise<StartedCore> {
    const port = await getAvailablePort()
    const dataDir = mkdtempSync(path.join(tmpdir(), "openade-client-core-"))
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
    rmSync(core.dataDir, { recursive: true, force: true })
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

function initializeRuntime(port: number, token = CORE_TOKEN, clientPlatform: "desktop" | "mobile" | "web" | "cli" | "unknown" = "cli"): Promise<InitializeResult> {
    return new Promise<InitializeResult>((resolve, reject) => {
        const socket = new WebSocket(runtimeUrl(port), [`bearer.${token}`])
        let settled = false
        const timeout = globalThis.setTimeout(() => {
            fail(new Error("Timed out waiting for runtime initialize response"))
        }, 5_000)

        const fail = (error: Error) => {
            if (settled) return
            settled = true
            globalThis.clearTimeout(timeout)
            socket.close()
            reject(error)
        }

        const finish = (result: InitializeResult) => {
            if (settled) return
            settled = true
            globalThis.clearTimeout(timeout)
            socket.close()
            resolve(result)
        }

        socket.onopen = () => {
            socket.send(
                JSON.stringify({
                    id: 1,
                    method: "initialize",
                    params: {
                        clientName: "OpenADE Client Contract Test",
                        clientPlatform,
                        protocolVersion: 1,
                    },
                })
            )
        }
        socket.onmessage = (event) => {
            try {
                finish(parseInitializeResponse(String(event.data)))
            } catch (error) {
                fail(error instanceof Error ? error : new Error("Failed to parse initialize response"))
            }
        }
        socket.onerror = () => {
            fail(new Error("Runtime WebSocket failed during initialize"))
        }
        socket.onclose = () => {
            fail(new Error("Runtime WebSocket closed before initialize completed"))
        }
    })
}

async function pairMobileClient(core: StartedCore, trustedRuntime: RuntimeClient): Promise<PairDeviceResult> {
    const baseUrl = `http://127.0.0.1:${core.port}`
    const pairing = pairingStartResult(
        await trustedRuntime.request("remote/pairing/start", {
            baseUrl,
            hostId: "contract-host",
        })
    )
    expect(pairing).toMatchObject({
        url: baseUrl,
        hostId: "contract-host",
    })
    expect(pairing.token.length).toBeGreaterThan(16)

    const response = await fetch(`${baseUrl}/v1/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            token: pairing.token,
            deviceName: "Contract iPhone",
            platform: "ios",
        }),
    })
    if (!response.ok) {
        throw new Error(`Pair device failed with HTTP ${response.status}: ${await response.text()}`)
    }
    return pairDeviceResult(await response.json())
}

async function rejectedError(action: () => Promise<unknown>): Promise<unknown> {
    try {
        await action()
    } catch (error) {
        return error
    }
    throw new Error("Expected request to reject")
}

function expectRuntimeClientErrorCode(error: unknown, code: (typeof OPENADE_ERROR_CODES)[number]): asserts error is RuntimeClientError {
    expect(error).toBeInstanceOf(RuntimeClientError)
    if (!(error instanceof RuntimeClientError)) throw error
    expect(error.code).toBe(code)
    expect(OPENADE_ERROR_CODES).toContain(error.code)
}

function parseInitializeResponse(raw: string): InitializeResult {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) throw new Error("Initialize response is not an object")
    if (isRecord(value.error)) {
        const code = typeof value.error.code === "string" ? value.error.code : "unknown"
        const message = typeof value.error.message === "string" ? value.error.message : "Runtime initialize failed"
        throw new Error(`${code}: ${message}`)
    }
    if (!isRecord(value.result)) throw new Error("Initialize response is missing result")
    if (!isRecord(value.result.capabilities)) throw new Error("Initialize response is missing capabilities")
    const methods = stringArray(value.result.capabilities.methods)
    const notifications = stringArray(value.result.capabilities.notifications)
    const protocolVersion = typeof value.result.protocolVersion === "number" ? value.result.protocolVersion : 0
    const serverName = typeof value.result.serverName === "string" ? value.result.serverName : ""
    return {
        protocolVersion,
        serverName,
        capabilities: { methods, notifications },
    }
}

function stringArray(value: unknown): string[] {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
        throw new Error("Expected string array")
    }
    return value
}

function pairingStartResult(value: unknown): PairingStartResult {
    if (!isRecord(value)) throw new Error("Pairing start result is not an object")
    if (typeof value.url !== "string") throw new Error("Pairing start result is missing url")
    if (typeof value.token !== "string") throw new Error("Pairing start result is missing token")
    if (typeof value.hostId !== "string") throw new Error("Pairing start result is missing hostId")
    if (typeof value.expiresAt !== "string") throw new Error("Pairing start result is missing expiresAt")
    return {
        url: value.url,
        token: value.token,
        hostId: value.hostId,
        expiresAt: value.expiresAt,
    }
}

function pairDeviceResult(value: unknown): PairDeviceResult {
    if (!isRecord(value)) throw new Error("Pair device result is not an object")
    if (typeof value.deviceToken !== "string") throw new Error("Pair device result is missing deviceToken")
    return {
        device: remoteDevice(value.device),
        deviceToken: value.deviceToken,
    }
}

function remoteDevice(value: unknown): RemoteDevice {
    if (!isRecord(value)) throw new Error("Remote device is not an object")
    if (typeof value.id !== "string") throw new Error("Remote device is missing id")
    if (typeof value.name !== "string") throw new Error("Remote device is missing name")
    if (typeof value.platform !== "string") throw new Error("Remote device is missing platform")
    if (typeof value.pairedAt !== "string") throw new Error("Remote device is missing pairedAt")
    return {
        id: value.id,
        name: value.name,
        platform: value.platform,
        pairedAt: value.pairedAt,
        ...(typeof value.lastSeenAt === "string" ? { lastSeenAt: value.lastSeenAt } : {}),
        ...(typeof value.revokedAt === "string" ? { revokedAt: value.revokedAt } : {}),
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
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
    return runtimeSocketUrl({ baseUrl: `http://127.0.0.1:${port}` })
}
