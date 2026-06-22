import fs from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { WebSocketServer, type RawData } from "ws"
import {
    type OpenADECoreLegacyYjsMigrationAcceptRequest,
    isOpenADECoreLegacyYjsMigrationAccepted,
    legacyYjsMigrationAcceptanceFilePath,
    markOpenADECoreLegacyYjsMigrationAccepted,
    markOpenADECoreLegacyYjsMigrationAcceptedFromUnknown,
    readOpenADECoreLegacyYjsMigrationAcceptance,
    revokeOpenADECoreLegacyYjsMigrationAcceptance,
} from "./openadeCoreMigration"
import {
    decideManagedOpenADECoreLaunch,
    hasActiveOpenADECoreRuntimeWork,
    hasOpenADECoreRuntimeEndpoint,
    managedOpenADECoreLegacyYjsDocumentsExist,
    planManagedOpenADECoreLaunch,
} from "./runtimeCore"

const cleanupFns: Array<() => Promise<void> | void> = []

type ProbeRuntimeRequest = {
    id: string | number
    method: string
    params?: unknown
}

function rawDataToString(data: RawData): string {
    if (typeof data === "string") return data
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8")
    if (Array.isArray(data)) return Buffer.concat(data).toString("utf8")
    return data.toString("utf8")
}

function isProbeRuntimeRequest(value: unknown): value is ProbeRuntimeRequest {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return (typeof record.id === "string" || typeof record.id === "number") && typeof record.method === "string"
}

function parseProbeRuntimeRequest(raw: RawData): ProbeRuntimeRequest {
    const parsed: unknown = JSON.parse(rawDataToString(raw))
    if (!isProbeRuntimeRequest(parsed)) throw new Error("invalid runtime request")
    return parsed
}

async function listen(server: Server): Promise<number> {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    return (server.address() as AddressInfo).port
}

async function openCoreRuntimeProbeServer(records: unknown[]): Promise<{
    url: string
    requests: ProbeRuntimeRequest[]
    protocols: string[]
}> {
    const httpServer = createServer()
    const wsServer = new WebSocketServer({ server: httpServer })
    const requests: ProbeRuntimeRequest[] = []
    const protocols: string[] = []

    wsServer.on("connection", (socket, request) => {
        protocols.push(String(request.headers["sec-websocket-protocol"] ?? ""))
        socket.on("message", (raw) => {
            const runtimeRequest = parseProbeRuntimeRequest(raw)
            requests.push(runtimeRequest)
            if (runtimeRequest.method === "initialize") {
                socket.send(
                    JSON.stringify({
                        id: runtimeRequest.id,
                        result: {
                            protocolVersion: 1,
                            serverName: "openade-core-test",
                            capabilities: { methods: ["runtime/list"], notifications: [], agentProviders: [] },
                        },
                    })
                )
                return
            }
            if (runtimeRequest.method === "runtime/list") {
                socket.send(JSON.stringify({ id: runtimeRequest.id, result: records }))
                return
            }
            socket.send(JSON.stringify({ id: runtimeRequest.id, error: { code: "method_not_found", message: "Unknown method" } }))
        })
    })

    const port = await listen(httpServer)
    cleanupFns.push(
        () =>
            new Promise<void>((resolve) => {
                wsServer.close(() => httpServer.close(() => resolve()))
            })
    )

    return {
        url: `ws://127.0.0.1:${port}/v1/runtime`,
        requests,
        protocols,
    }
}

afterEach(async () => {
    while (cleanupFns.length > 0) {
        await cleanupFns.pop()?.()
    }
})

function cleanMigrationAcceptRequest(overrides: Partial<OpenADECoreLegacyYjsMigrationAcceptRequest> = {}): OpenADECoreLegacyYjsMigrationAcceptRequest {
    return {
        data: {
            scannedRepos: 1,
            importedRepos: 1,
            scannedTasks: 1,
            importedTasks: 1,
            skipped: 0,
            errors: 0,
            parityMismatches: 0,
        },
        resources: {
            skipped: 0,
            issues: 0,
            images: {
                scannedTasks: 1,
                referenced: 1,
                imported: 1,
                alreadyImported: 0,
                missing: 0,
                conflicted: 0,
                failed: 0,
            },
            snapshots: {
                scannedTasks: 1,
                referenced: 1,
                imported: 1,
                alreadyImported: 0,
                missing: 0,
                conflicted: 0,
                failed: 0,
            },
            sessions: {
                scannedTasks: 1,
                referenced: 1,
                imported: 1,
                alreadyImported: 0,
                missing: 0,
                conflicted: 0,
                failed: 0,
            },
        },
        ...overrides,
    }
}

describe("OpenADE Core active-work probe", () => {
    test("does not probe when no usable Core runtime endpoint is configured", async () => {
        expect(hasOpenADECoreRuntimeEndpoint({})).toBe(false)
        expect(hasOpenADECoreRuntimeEndpoint({ OPENADE_CORE_RUNTIME_URL: "http://127.0.0.1:37376/v1/runtime" })).toBe(false)
        expect(
            hasOpenADECoreRuntimeEndpoint({
                OPENADE_CORE_RUNTIME_URL: "ws://127.0.0.1:37376/v1/runtime",
                OPENADE_DISABLE_OPENADE_CORE: "1",
            })
        ).toBe(false)
        await expect(hasActiveOpenADECoreRuntimeWork({})).resolves.toBe(false)
    })

    test("detects active Core-owned OpenADE task work through the real WebSocket protocol", async () => {
        const runtime = await openCoreRuntimeProbeServer([
            {
                runtimeId: "openade-turn:event-1",
                kind: "agent",
                status: "running",
                scope: { ownerType: "openade-task", ownerId: "task-1" },
            },
        ])

        await expect(
            hasActiveOpenADECoreRuntimeWork(
                {
                    OPENADE_CORE_RUNTIME_URL: runtime.url,
                    OPENADE_CORE_TOKEN: "test-token",
                },
                5_000
            )
        ).resolves.toBe(true)

        expect(runtime.protocols).toEqual(["bearer.test-token"])
        expect(runtime.requests.map((request) => request.method)).toEqual(["initialize", "runtime/list"])
        expect(runtime.requests[1].params).toEqual({
            ownerType: "openade-task",
            statuses: ["starting", "running"],
        })
    })

    test("ignores completed task work and non-task runtimes", async () => {
        const runtime = await openCoreRuntimeProbeServer([
            {
                runtimeId: "openade-turn:event-complete",
                kind: "agent",
                status: "completed",
                scope: { ownerType: "openade-task", ownerId: "task-1" },
            },
            {
                runtimeId: "process-1",
                kind: "process",
                status: "running",
                scope: { ownerType: "process", ownerId: "process-1" },
            },
        ])

        await expect(
            hasActiveOpenADECoreRuntimeWork(
                {
                    OPENADE_CORE_RUNTIME_URL: runtime.url,
                },
                5_000
            )
        ).resolves.toBe(false)
    })
})

describe("managed OpenADE Core launch planning", () => {
    const noPackagedCore = () => null
    const packagedCore = () => "/Applications/OpenADE.app/Contents/Resources/dist/openade-core/openade-core"
    const packagedAgentWorker = () => [
        "/Applications/OpenADE.app/Contents/MacOS/OpenADE",
        "/Applications/OpenADE.app/Contents/Resources/dist/harness-worker/worker.js",
    ]

    test("does not auto-launch in development or without a packaged Core binary", () => {
        expect(planManagedOpenADECoreLaunch({}, "/repo", () => "token", packagedCore, { isDev: true })).toBeNull()
        expect(
            planManagedOpenADECoreLaunch({}, "/repo", () => "token", noPackagedCore, {
                isDev: false,
                legacyYjsDocumentsExist: () => false,
            })
        ).toBeNull()
    })

    test("auto-launches packaged Core for clean production installs", () => {
        const plan = planManagedOpenADECoreLaunch({}, "/app", () => "token", packagedCore, {
            isDev: false,
            legacyYjsDocumentsExist: () => false,
        })

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.command).toBe(packagedCore())
        expect(plan.args).toEqual([])
        expect(plan.env.OPENADE_USE_OPENADE_CORE).toBe("1")
        expect(plan.env.OPENADE_CORE_MANAGED).toBe("1")
        expect(plan.runtimeEndpoint).toEqual({
            url: "ws://127.0.0.1:37376/v1/runtime",
            token: "token",
        })
    })

    test("auto-launches packaged Core over existing legacy Yjs documents for migration only", () => {
        const decision = decideManagedOpenADECoreLaunch({}, "/app", () => "token", packagedCore, {
            isDev: false,
            legacyYjsDocumentsExist: () => true,
        })

        expect(decision).toMatchObject({
            reason: "legacy-yjs-documents",
            automatic: true,
            productRuntime: false,
            legacyYjsDocumentsPresent: true,
            legacyYjsMigrationAccepted: false,
        })
        expect(decision.plan?.command).toBe(packagedCore())
    })

    test("auto-launches packaged Core over legacy Yjs documents after accepted import", () => {
        const decision = decideManagedOpenADECoreLaunch({}, "/app", () => "token", packagedCore, {
            isDev: false,
            legacyYjsDocumentsExist: () => true,
            legacyYjsMigrationAccepted: () => true,
        })

        expect(decision).toMatchObject({
            reason: "legacy-yjs-migration-accepted",
            automatic: true,
            productRuntime: true,
            legacyYjsDocumentsPresent: true,
            legacyYjsMigrationAccepted: true,
        })
        expect(decision.plan?.command).toBe(packagedCore())
    })

    test("does not launch when Core is explicitly disabled", () => {
        expect(
            planManagedOpenADECoreLaunch(
                {
                    OPENADE_DISABLE_OPENADE_CORE: "1",
                    OPENADE_CORE_MANAGED: "1",
                },
                "/repo",
                () => "token",
                packagedCore,
                { isDev: false, legacyYjsDocumentsExist: () => false }
            )
        ).toBeNull()
    })

    test("does not launch when an external Core endpoint is already configured", () => {
        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_USE_OPENADE_CORE: "1",
                OPENADE_CORE_MANAGED: "1",
                OPENADE_CORE_RUNTIME_URL: "ws://127.0.0.1:9000/v1/runtime",
            },
            "/repo",
            () => "token",
            noPackagedCore,
            { isDev: false, legacyYjsDocumentsExist: () => false }
        )

        expect(plan).toBeNull()
    })

    test("rejects invalid external Core endpoints before preload can attach", () => {
        const decision = decideManagedOpenADECoreLaunch(
            {
                OPENADE_CORE_RUNTIME_URL: "http://127.0.0.1:9000/v1/runtime",
            },
            "/repo",
            () => "token",
            packagedCore,
            { isDev: false, legacyYjsDocumentsExist: () => false }
        )

        expect(decision).toMatchObject({
            plan: null,
            reason: "invalid-external-endpoint",
            automatic: false,
            legacyYjsDocumentsPresent: false,
            legacyYjsMigrationAccepted: false,
        })
    })

    test("builds an explicit managed dev Core launch with a preload-compatible endpoint", () => {
        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_CORE_MANAGED: "1",
            },
            "/repo/projects/electron",
            () => "generated-token",
            noPackagedCore,
            { isDev: true, legacyYjsDocumentsExist: () => true }
        )

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.command).toBe("go")
        expect(plan.args).toEqual(["run", "../openade-core/cmd/openade-core"])
        expect(plan.cwd).toBe("/repo/projects/electron")
        expect(plan.runtimeEndpoint).toEqual({
            url: "ws://127.0.0.1:37376/v1/runtime",
            token: "generated-token",
        })
        expect(plan.env.OPENADE_CORE_RUNTIME_URL).toBe(plan.runtimeEndpoint.url)
        expect(plan.env.OPENADE_CORE_TOKEN).toBe("generated-token")
        expect(plan.env.OPENADE_USE_OPENADE_CORE).toBe("1")
        expect(plan.env.OPENADE_CORE_MANAGED).toBe("1")
        expect(plan.env.OPENADE_CORE_PORT).toBe("37376")
        expect(plan.env.OPENADE_CORE_RUNTIME_PATH).toBe("/v1/runtime")
    })

    test("treats OPENADE_USE_OPENADE_CORE without an external endpoint as managed opt-in", () => {
        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_USE_OPENADE_CORE: "1",
            },
            "/repo/projects/electron",
            () => "generated-token",
            noPackagedCore,
            { isDev: true, legacyYjsDocumentsExist: () => true }
        )

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.command).toBe("go")
        expect(plan.args).toEqual(["run", "../openade-core/cmd/openade-core"])
        expect(plan.env.OPENADE_CORE_MANAGED).toBe("1")
    })

    test("honors explicit command, token, host, port, and runtime path", () => {
        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_USE_OPENADE_CORE: "yes",
                OPENADE_CORE_MANAGED: "on",
                OPENADE_CORE_COMMAND: `["/bin/openade-core","--flag"]`,
                OPENADE_CORE_TOKEN: "existing-token",
                OPENADE_CORE_HOST: "localhost",
                OPENADE_CORE_PORT: "4455",
                OPENADE_CORE_RUNTIME_PATH: "runtime",
            },
            "/cwd",
            () => "unused-token",
            noPackagedCore,
            { isDev: true, legacyYjsDocumentsExist: () => true }
        )

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.command).toBe("/bin/openade-core")
        expect(plan.args).toEqual(["--flag"])
        expect(plan.runtimeEndpoint).toEqual({
            url: "ws://localhost:4455/runtime",
            token: "existing-token",
        })
        expect(plan.env.OPENADE_CORE_RUNTIME_PATH).toBe("/runtime")
    })

    test("rejects invalid command JSON and normalizes invalid ports", () => {
        expect(
            planManagedOpenADECoreLaunch(
                {
                    OPENADE_USE_OPENADE_CORE: "1",
                    OPENADE_CORE_MANAGED: "1",
                    OPENADE_CORE_COMMAND: `[""]`,
                },
                "/cwd",
                () => "token",
                noPackagedCore,
                { isDev: true, legacyYjsDocumentsExist: () => true }
            )
        ).toBeNull()

        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_USE_OPENADE_CORE: "1",
                OPENADE_CORE_MANAGED: "1",
                OPENADE_CORE_PORT: "0",
            },
            "/cwd",
            () => "token",
            noPackagedCore,
            { isDev: true, legacyYjsDocumentsExist: () => true }
        )

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.env.OPENADE_CORE_PORT).toBe("37376")
        expect(plan.runtimeEndpoint.url).toBe("ws://127.0.0.1:37376/v1/runtime")
    })

    test("prefers the packaged Core binary when no command override is configured", () => {
        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_USE_OPENADE_CORE: "1",
                OPENADE_CORE_MANAGED: "1",
            },
            "/app",
            () => "token",
            packagedCore,
            { isDev: true, legacyYjsDocumentsExist: () => true }
        )

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.command).toBe(packagedCore())
        expect(plan.args).toEqual([])
    })

    test("wires the packaged harness worker into managed Core when no worker override exists", () => {
        const plan = planManagedOpenADECoreLaunch({}, "/app", () => "token", packagedCore, {
            isDev: false,
            legacyYjsDocumentsExist: () => false,
            agentWorkerCommand: packagedAgentWorker,
        })

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.env.OPENADE_CORE_AGENT_WORKER_COMMAND).toBe(JSON.stringify(packagedAgentWorker()))
        expect(plan.env.ELECTRON_RUN_AS_NODE).toBe("1")
    })

    test("preserves an explicit Core worker command override", () => {
        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_CORE_AGENT_WORKER_COMMAND: `["node","custom-worker.js"]`,
                OPENADE_USE_OPENADE_CORE: "1",
            },
            "/app",
            () => "token",
            packagedCore,
            {
                isDev: true,
                legacyYjsDocumentsExist: () => true,
                agentWorkerCommand: packagedAgentWorker,
            }
        )

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.env.OPENADE_CORE_AGENT_WORKER_COMMAND).toBe(`["node","custom-worker.js"]`)
        expect(plan.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    })

    test("launches managed Core without a worker command when the packaged worker is unavailable", () => {
        const plan = planManagedOpenADECoreLaunch({}, "/app", () => "token", packagedCore, {
            isDev: false,
            legacyYjsDocumentsExist: () => false,
            agentWorkerCommand: () => null,
        })

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.env.OPENADE_CORE_AGENT_WORKER_COMMAND).toBeUndefined()
        expect(plan.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    })

    test("keeps explicit command override ahead of the packaged Core binary", () => {
        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_USE_OPENADE_CORE: "1",
                OPENADE_CORE_MANAGED: "1",
                OPENADE_CORE_COMMAND: "/custom/openade-core",
            },
            "/app",
            () => "token",
            () => "/packaged/openade-core",
            { isDev: true, legacyYjsDocumentsExist: () => true }
        )

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.command).toBe("/custom/openade-core")
        expect(plan.args).toEqual([])
    })

    test("reports sanitized rollout reasons for renderer telemetry and settings", () => {
        expect(decideManagedOpenADECoreLaunch({ OPENADE_DISABLE_OPENADE_CORE: "1" }, "/repo", () => "token", packagedCore).reason).toBe("disabled")
        expect(decideManagedOpenADECoreLaunch({ OPENADE_CORE_RUNTIME_URL: "ws://127.0.0.1:9000/v1/runtime" }, "/repo", () => "token", packagedCore).reason).toBe(
            "external-endpoint"
        )
        expect(decideManagedOpenADECoreLaunch({}, "/repo", () => "token", packagedCore, { isDev: true }).reason).toBe("development-default-off")
        expect(decideManagedOpenADECoreLaunch({ OPENADE_CORE_RUNTIME_URL: "file:///tmp/core.sock" }, "/repo", () => "token", packagedCore).reason).toBe(
            "invalid-external-endpoint"
        )

        const legacyDecision = decideManagedOpenADECoreLaunch({}, "/repo", () => "token", packagedCore, {
            isDev: false,
            legacyYjsDocumentsExist: () => true,
        })
        expect(legacyDecision).toMatchObject({
            reason: "legacy-yjs-documents",
            automatic: true,
            productRuntime: false,
            legacyYjsDocumentsPresent: true,
            legacyYjsMigrationAccepted: false,
        })
        expect(legacyDecision.plan?.command).toBe(packagedCore())

        const automaticDecision = decideManagedOpenADECoreLaunch({}, "/repo", () => "token", packagedCore, {
            isDev: false,
            legacyYjsDocumentsExist: () => false,
        })
        expect(automaticDecision.reason).toBe("managed-core")
        expect(automaticDecision.automatic).toBe(true)
        expect(automaticDecision.plan?.command).toBe(packagedCore())
    })
})

describe("managed OpenADE Core legacy Yjs migration acceptance", () => {
    test("persists a narrow accepted-import marker under the OpenADE data directory", () => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-core-migration-home-"))
        try {
            expect(isOpenADECoreLegacyYjsMigrationAccepted(homeDir)).toBe(false)
            const evidence = cleanMigrationAcceptRequest()
            const accepted = markOpenADECoreLegacyYjsMigrationAccepted(evidence, {
                homeDir,
                acceptedAt: "2026-06-09T12:00:00.000Z",
                source: "test",
            })

            expect(legacyYjsMigrationAcceptanceFilePath(homeDir)).toBe(
                path.join(homeDir, ".openade", "data", "core", "legacy-yjs-import-accepted.json")
            )
            expect(accepted).toEqual({
                version: 1,
                acceptedAt: "2026-06-09T12:00:00.000Z",
                source: "test",
                data: evidence.data,
                resources: evidence.resources,
            })
            expect(readOpenADECoreLegacyYjsMigrationAcceptance(homeDir)).toEqual(accepted)
            expect(isOpenADECoreLegacyYjsMigrationAccepted(homeDir)).toBe(true)
        } finally {
            fs.rmSync(homeDir, { recursive: true, force: true })
        }
    })

    test("revokes accepted-import marker so the next launch returns to legacy while Yjs documents remain", () => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-core-migration-home-"))
        const packagedCore = () => "/Applications/OpenADE.app/Contents/Resources/dist/openade-core/openade-core"
        try {
            markOpenADECoreLegacyYjsMigrationAccepted(cleanMigrationAcceptRequest(), {
                homeDir,
                acceptedAt: "2026-06-09T12:00:00.000Z",
                source: "test",
            })

            const acceptedDecision = decideManagedOpenADECoreLaunch({}, "/repo", () => "token", packagedCore, {
                isDev: false,
                legacyYjsDocumentsExist: () => true,
                legacyYjsMigrationAccepted: () => isOpenADECoreLegacyYjsMigrationAccepted(homeDir),
            })
            expect(acceptedDecision.reason).toBe("legacy-yjs-migration-accepted")
            expect(acceptedDecision.plan?.command).toBe(packagedCore())

            expect(revokeOpenADECoreLegacyYjsMigrationAcceptance({ homeDir })).toEqual({ revoked: true, requiresRestart: true })
            expect(isOpenADECoreLegacyYjsMigrationAccepted(homeDir)).toBe(false)

            const revokedDecision = decideManagedOpenADECoreLaunch({}, "/repo", () => "token", packagedCore, {
                isDev: false,
                legacyYjsDocumentsExist: () => true,
                legacyYjsMigrationAccepted: () => isOpenADECoreLegacyYjsMigrationAccepted(homeDir),
            })
            expect(revokedDecision).toMatchObject({
                reason: "legacy-yjs-documents",
                automatic: true,
                productRuntime: false,
                legacyYjsDocumentsPresent: true,
                legacyYjsMigrationAccepted: false,
            })
            expect(revokedDecision.plan?.command).toBe(packagedCore())
            expect(revokeOpenADECoreLegacyYjsMigrationAcceptance({ homeDir })).toEqual({ revoked: false, requiresRestart: true })
        } finally {
            fs.rmSync(homeDir, { recursive: true, force: true })
        }
    })

    test("fails closed for malformed accepted-import markers", () => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-core-migration-home-"))
        try {
            const markerPath = legacyYjsMigrationAcceptanceFilePath(homeDir)
            fs.mkdirSync(path.dirname(markerPath), { recursive: true })
            fs.writeFileSync(markerPath, JSON.stringify({ version: 2, acceptedAt: "2026-06-09T12:00:00.000Z", source: "test" }))

            expect(readOpenADECoreLegacyYjsMigrationAcceptance(homeDir)).toBeNull()
            expect(isOpenADECoreLegacyYjsMigrationAccepted(homeDir)).toBe(false)

            fs.writeFileSync(markerPath, JSON.stringify({ version: 1, acceptedAt: "2026-06-09T12:00:00.000Z", source: "test" }))

            expect(readOpenADECoreLegacyYjsMigrationAcceptance(homeDir)).toBeNull()
            expect(isOpenADECoreLegacyYjsMigrationAccepted(homeDir)).toBe(false)
        } finally {
            fs.rmSync(homeDir, { recursive: true, force: true })
        }
    })

    test("refuses to write accepted-import markers for non-clean summaries", () => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-core-migration-home-"))
        try {
            expect(() =>
                markOpenADECoreLegacyYjsMigrationAccepted(cleanMigrationAcceptRequest({ data: { ...cleanMigrationAcceptRequest().data, errors: 1 } }), {
                    homeDir,
                    acceptedAt: "2026-06-09T12:00:00.000Z",
                    source: "test",
                })
            ).toThrow("legacy Yjs import summary is not clean")
            expect(() =>
                markOpenADECoreLegacyYjsMigrationAccepted(
                    cleanMigrationAcceptRequest({ data: { ...cleanMigrationAcceptRequest().data, scannedTasks: 2, importedTasks: 1 } }),
                    {
                        homeDir,
                        acceptedAt: "2026-06-09T12:00:00.000Z",
                        source: "test",
                    }
                )
            ).toThrow("legacy Yjs import summary is incomplete")
            expect(() =>
                markOpenADECoreLegacyYjsMigrationAccepted(
                    cleanMigrationAcceptRequest({
                        resources: {
                            ...cleanMigrationAcceptRequest().resources,
                            images: {
                                scannedTasks: 1,
                                referenced: 2,
                                imported: 1,
                                alreadyImported: 0,
                                missing: 0,
                                conflicted: 0,
                                failed: 0,
                            },
                        },
                    }),
                    {
                        homeDir,
                        acceptedAt: "2026-06-09T12:00:00.000Z",
                        source: "test",
                    }
                )
            ).toThrow("legacy resource import summary is inconsistent")
            expect(() =>
                markOpenADECoreLegacyYjsMigrationAccepted(
                    cleanMigrationAcceptRequest({
                        resources: {
                            skipped: 0,
                            issues: 0,
                            images: cleanMigrationAcceptRequest().resources.images,
                        },
                    }),
                    {
                        homeDir,
                        acceptedAt: "2026-06-09T12:00:00.000Z",
                        source: "test",
                    }
                )
            ).toThrow("legacy resource import summary is incomplete")
            expect(() =>
                markOpenADECoreLegacyYjsMigrationAccepted(
                    cleanMigrationAcceptRequest({
                        resources: {
                            skipped: 0,
                            issues: 0,
                            images: cleanMigrationAcceptRequest().resources.images,
                            snapshots: cleanMigrationAcceptRequest().resources.snapshots,
                        },
                    }),
                    {
                        homeDir,
                        acceptedAt: "2026-06-09T12:00:00.000Z",
                        source: "test",
                    }
                )
            ).toThrow("legacy resource import summary is incomplete")
            expect(isOpenADECoreLegacyYjsMigrationAccepted(homeDir)).toBe(false)
        } finally {
            fs.rmSync(homeDir, { recursive: true, force: true })
        }
    })

    test("refuses runtime acceptance requests without clean evidence", () => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-core-migration-home-"))
        try {
            const evidence = cleanMigrationAcceptRequest()
            if (!evidence.resources.images) throw new Error("expected clean evidence to include image summary")
            expect(() => markOpenADECoreLegacyYjsMigrationAcceptedFromUnknown({}, { homeDir })).toThrow("data is invalid")
            expect(() =>
                markOpenADECoreLegacyYjsMigrationAcceptedFromUnknown(
                    {
                        ...evidence,
                        resources: {
                            ...evidence.resources,
                            images: {
                                ...evidence.resources.images,
                                imported: 0,
                                missing: 1,
                            },
                        },
                    },
                    { homeDir }
                )
            ).toThrow("legacy resource import summary is not clean")
            expect(isOpenADECoreLegacyYjsMigrationAccepted(homeDir)).toBe(false)
        } finally {
            fs.rmSync(homeDir, { recursive: true, force: true })
        }
    })
})

describe("managed OpenADE Core legacy Yjs detection", () => {
    test("detects existing default and nested legacy Yjs documents", () => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-yjs-home-"))
        try {
            expect(managedOpenADECoreLegacyYjsDocumentsExist({}, homeDir)).toBe(false)

            const primaryYjsDir = path.join(homeDir, ".openade", "data", "yjs")
            fs.mkdirSync(primaryYjsDir, { recursive: true })
            fs.writeFileSync(path.join(primaryYjsDir, "code_repos"), "data")
            expect(managedOpenADECoreLegacyYjsDocumentsExist({}, homeDir)).toBe(true)

            fs.rmSync(primaryYjsDir, { recursive: true, force: true })
            const nestedYjsDir = path.join(homeDir, ".openade", ".openade", "data", "yjs")
            fs.mkdirSync(nestedYjsDir, { recursive: true })
            fs.writeFileSync(path.join(nestedYjsDir, "code_personal_settings"), "data")
            expect(managedOpenADECoreLegacyYjsDocumentsExist({}, homeDir)).toBe(true)
        } finally {
            fs.rmSync(homeDir, { recursive: true, force: true })
        }
    })

    test("uses OPENADE_YJS_STORAGE_DIR when configured", () => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-yjs-home-"))
        const configuredDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-yjs-configured-"))
        try {
            const primaryYjsDir = path.join(homeDir, ".openade", "data", "yjs")
            fs.mkdirSync(primaryYjsDir, { recursive: true })
            fs.writeFileSync(path.join(primaryYjsDir, "code_repos"), "data")

            expect(managedOpenADECoreLegacyYjsDocumentsExist({ OPENADE_YJS_STORAGE_DIR: configuredDir }, homeDir)).toBe(false)

            fs.writeFileSync(path.join(configuredDir, "code_repos"), "data")
            expect(managedOpenADECoreLegacyYjsDocumentsExist({ OPENADE_YJS_STORAGE_DIR: configuredDir }, homeDir)).toBe(true)
        } finally {
            fs.rmSync(homeDir, { recursive: true, force: true })
            fs.rmSync(configuredDir, { recursive: true, force: true })
        }
    })
})
