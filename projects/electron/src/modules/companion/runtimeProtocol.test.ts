import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
    AgentProviderIdParamsSchema,
    RuntimeInitializeParamsSchema,
    RuntimeIdParamsSchema,
    RuntimeListParamsSchema,
    RuntimeNotificationSchema,
    RuntimeRecordSchema,
    RuntimeRequestSchema,
    RuntimeResponseSchema,
    RuntimeScopeSchema,
    RuntimeStopParamsSchema,
    RuntimeSubscriptionUpdateParamsSchema,
    validateRuntimeRecord,
    type RuntimeMessage,
} from "../../../../runtime-protocol/src"
import { RuntimeServer } from "../../../../runtime/src"
import { notifyRuntimeNodeAgentBridgeEvent, registerRuntimeNodeAgentModule, type RuntimeNodeAgentExecutor } from "../../../../runtime-node/src"
import { registerRuntimeAgentModule, registerServerProtocolAgentBridge } from "./runtimeAgents"
import { registerRuntimeHostModule } from "./runtimeHost"

function connection(id = "test", metadata?: Record<string, unknown>) {
    const messages: RuntimeMessage[] = []
    return {
        messages,
        connection: {
            id,
            metadata,
            send(message: RuntimeMessage) {
                messages.push(message)
            },
        },
    }
}

describe("RuntimeServer", () => {
    it("keeps generated protocol envelope schemas stable", () => {
        expect({
            agentProviderId: AgentProviderIdParamsSchema,
            initialize: RuntimeInitializeParamsSchema,
            notification: RuntimeNotificationSchema,
            runtimeRecord: RuntimeRecordSchema,
            runtimeScope: RuntimeScopeSchema,
            request: RuntimeRequestSchema,
            response: RuntimeResponseSchema,
            runtimeId: RuntimeIdParamsSchema,
            runtimeList: RuntimeListParamsSchema,
            runtimeStop: RuntimeStopParamsSchema,
            subscriptionUpdate: RuntimeSubscriptionUpdateParamsSchema,
        }).toMatchInlineSnapshot(`
          {
            "agentProviderId": {
              "additionalProperties": true,
              "properties": {
                "providerId": {
                  "minLength": 1,
                  "type": "string",
                },
              },
              "required": [
                "providerId",
              ],
              "type": "object",
            },
            "initialize": {
              "additionalProperties": true,
              "properties": {
                "clientName": {
                  "type": "string",
                },
                "clientPlatform": {
                  "enum": [
                    "desktop",
                    "mobile",
                    "web",
                    "cli",
                    "unknown",
                  ],
                },
                "clientVersion": {
                  "type": "string",
                },
                "protocolVersion": {
                  "type": "number",
                },
              },
              "type": "object",
            },
            "notification": {
              "additionalProperties": true,
              "properties": {
                "cursor": {
                  "type": "string",
                },
                "method": {
                  "minLength": 1,
                  "type": "string",
                },
                "params": {},
              },
              "required": [
                "method",
              ],
              "type": "object",
            },
            "request": {
              "additionalProperties": true,
              "properties": {
                "id": {
                  "anyOf": [
                    {
                      "type": "string",
                    },
                    {
                      "type": "number",
                    },
                  ],
                },
                "method": {
                  "minLength": 1,
                  "type": "string",
                },
                "params": {},
              },
              "required": [
                "id",
                "method",
              ],
              "type": "object",
            },
            "response": {
              "additionalProperties": true,
              "properties": {
                "error": {
                  "additionalProperties": true,
                  "properties": {
                    "code": {
                      "minLength": 1,
                      "type": "string",
                    },
                    "data": {},
                    "message": {
                      "minLength": 1,
                      "type": "string",
                    },
                  },
                  "required": [
                    "code",
                    "message",
                  ],
                  "type": "object",
                },
                "id": {
                  "anyOf": [
                    {
                      "type": "string",
                    },
                    {
                      "type": "number",
                    },
                  ],
                },
                "result": {},
              },
              "required": [
                "id",
              ],
              "type": "object",
            },
            "runtimeId": {
              "additionalProperties": true,
              "properties": {
                "runtimeId": {
                  "minLength": 1,
                  "type": "string",
                },
              },
              "required": [
                "runtimeId",
              ],
              "type": "object",
            },
            "runtimeList": {
              "additionalProperties": true,
              "properties": {
                "ownerId": {
                  "minLength": 1,
                  "type": "string",
                },
                "ownerType": {
                  "minLength": 1,
                  "type": "string",
                },
              },
              "type": "object",
            },
            "runtimeRecord": {
              "additionalProperties": false,
              "properties": {
                "error": {
                  "type": "string",
                },
                "exitCode": {
                  "anyOf": [
                    {
                      "type": "number",
                    },
                    {
                      "type": "null",
                    },
                  ],
                },
                "exitedAt": {
                  "type": "string",
                },
                "kind": {
                  "enum": [
                    "agent",
                    "process",
                    "pty",
                    "git",
                    "fsWatch",
                    "composite",
                  ],
                },
                "lastActivityAt": {
                  "minLength": 1,
                  "type": "string",
                },
                "nativeId": {
                  "type": "string",
                },
                "pgid": {
                  "type": "number",
                },
                "pid": {
                  "type": "number",
                },
                "processLabel": {
                  "type": "string",
                },
                "processStartedAt": {
                  "type": "string",
                },
                "runtimeId": {
                  "minLength": 1,
                  "type": "string",
                },
                "scope": {
                  "additionalProperties": false,
                  "properties": {
                    "correlationId": {
                      "type": "string",
                    },
                    "labels": {
                      "additionalProperties": {
                        "type": "string",
                      },
                      "type": "object",
                    },
                    "ownerId": {
                      "type": "string",
                    },
                    "ownerType": {
                      "type": "string",
                    },
                    "repoPath": {
                      "type": "string",
                    },
                    "rootPath": {
                      "type": "string",
                    },
                    "workspaceId": {
                      "type": "string",
                    },
                  },
                  "type": "object",
                },
                "signal": {
                  "anyOf": [
                    {
                      "type": "string",
                    },
                    {
                      "type": "null",
                    },
                  ],
                },
                "startedAt": {
                  "minLength": 1,
                  "type": "string",
                },
                "status": {
                  "enum": [
                    "starting",
                    "running",
                    "completed",
                    "failed",
                    "stopped",
                    "orphaned",
                  ],
                },
                "updatedAt": {
                  "minLength": 1,
                  "type": "string",
                },
              },
              "required": [
                "runtimeId",
                "kind",
                "status",
                "scope",
                "startedAt",
                "updatedAt",
                "lastActivityAt",
              ],
              "type": "object",
            },
            "runtimeScope": {
              "additionalProperties": false,
              "properties": {
                "correlationId": {
                  "type": "string",
                },
                "labels": {
                  "additionalProperties": {
                    "type": "string",
                  },
                  "type": "object",
                },
                "ownerId": {
                  "type": "string",
                },
                "ownerType": {
                  "type": "string",
                },
                "repoPath": {
                  "type": "string",
                },
                "rootPath": {
                  "type": "string",
                },
                "workspaceId": {
                  "type": "string",
                },
              },
              "type": "object",
            },
            "runtimeStop": {
              "additionalProperties": true,
              "properties": {
                "reason": {
                  "type": "string",
                },
                "runtimeId": {
                  "minLength": 1,
                  "type": "string",
                },
              },
              "required": [
                "runtimeId",
              ],
              "type": "object",
            },
            "subscriptionUpdate": {
              "additionalProperties": true,
              "properties": {
                "cursor": {
                  "anyOf": [
                    {
                      "type": "string",
                    },
                    {
                      "type": "number",
                    },
                  ],
                },
                "methods": {
                  "items": {
                    "minLength": 1,
                    "type": "string",
                  },
                  "type": "array",
                },
              },
              "type": "object",
            },
          }
        `)
    })

    it("validates scoped runtime records and rejects legacy flat owner fields on the wire", () => {
        expect(
            validateRuntimeRecord({
                runtimeId: "runtime-1",
                kind: "agent",
                status: "running",
                scope: {
                    ownerType: "openade-task",
                    ownerId: "task-1",
                    rootPath: "/tmp/project",
                    labels: { source: "integration" },
                },
                startedAt: "2026-05-26T00:00:00.000Z",
                updatedAt: "2026-05-26T00:00:00.000Z",
                lastActivityAt: "2026-05-26T00:00:00.000Z",
                pid: 123,
                signal: null,
            })
        ).toEqual({
            ok: true,
            value: {
                runtimeId: "runtime-1",
                kind: "agent",
                status: "running",
                scope: {
                    ownerType: "openade-task",
                    ownerId: "task-1",
                    rootPath: "/tmp/project",
                    labels: { source: "integration" },
                },
                startedAt: "2026-05-26T00:00:00.000Z",
                updatedAt: "2026-05-26T00:00:00.000Z",
                lastActivityAt: "2026-05-26T00:00:00.000Z",
                pid: 123,
                signal: null,
            },
        })

        expect(
            validateRuntimeRecord({
                runtimeId: "runtime-1",
                kind: "agent",
                status: "running",
                ownerType: "openade-task",
                ownerId: "task-1",
                startedAt: "2026-05-26T00:00:00.000Z",
                updatedAt: "2026-05-26T00:00:00.000Z",
                lastActivityAt: "2026-05-26T00:00:00.000Z",
            })
        ).toEqual({
            ok: false,
            error: {
                code: "invalid_message",
                message: "ownerType is not allowed in runtime record",
                path: "$.ownerType",
            },
        })
    })

    it("handles typed requests and notifications", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const testConnection = connection()
        runtime.connect(testConnection.connection)

        await runtime.handleMessage(testConnection.connection, JSON.stringify({ id: 1, method: "initialize" }))

        expect(testConnection.messages[0]).toMatchObject({
            id: 1,
            result: {
                protocolVersion: 1,
                serverName: "test-runtime",
            },
        })

        const status = await runtime.handleRequest({ id: 2, method: "server/status/read" }, testConnection.connection)
        expect(status).toMatchObject({
            id: 2,
            result: {
                protocolVersion: 1,
                serverName: "test-runtime",
                connectionCount: 1,
            },
        })

        runtime.registerNotification("test/changed")
        runtime.notify("test/changed", { ok: true })

        expect(testConnection.messages[1]).toMatchObject({
            method: "test/changed",
            params: { ok: true },
        })
        expect(testConnection.messages[1]).toHaveProperty("cursor", "1")
    })

    it("rejects unsupported protocol versions during initialize", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime", protocolVersion: 2 })
        const testConnection = connection()
        runtime.connect(testConnection.connection)

        const response = await runtime.handleRequest({ id: 1, method: "initialize", params: { protocolVersion: 1 } }, testConnection.connection)

        expect(response).toMatchObject({
            id: 1,
            error: {
                code: "unsupported_protocol_version",
                message: expect.stringContaining("Desktop update required"),
                data: {
                    clientProtocolVersion: 1,
                    serverProtocolVersion: 2,
                },
            },
        })
    })

    it("requires wire clients to initialize before runtime methods", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const testConnection = connection()
        runtime.connect(testConnection.connection)

        await runtime.handleMessage(testConnection.connection, JSON.stringify({ id: 1, method: "runtime/list" }))
        await runtime.handleMessage(testConnection.connection, JSON.stringify({ id: 2, method: "initialize" }))
        await runtime.handleMessage(testConnection.connection, JSON.stringify({ id: 3, method: "runtime/list" }))

        expect(testConnection.messages).toEqual([
            {
                id: 1,
                error: {
                    code: "not_initialized",
                    message: "Call initialize before invoking runtime methods",
                },
            },
            expect.objectContaining({ id: 2, result: expect.objectContaining({ protocolVersion: 1 }) }),
            { id: 3, result: [] },
        ])
    })

    it("deduplicates successful mutating requests with stable clientRequestId values", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        let count = 0
        runtime.register("test/start", async () => {
            await new Promise((resolve) => setTimeout(resolve, 5))
            count += 1
            return { count }
        })
        const testConnection = connection()
        const params = { clientRequestId: "request-1" }

        await expect(
            Promise.all([
                runtime.handleRequest({ id: 1, method: "test/start", params }, testConnection.connection),
                runtime.handleRequest({ id: 2, method: "test/start", params }, testConnection.connection),
            ])
        ).resolves.toEqual([
            { id: 1, result: { count: 1 } },
            { id: 2, result: { count: 1 } },
        ])
        await expect(runtime.handleRequest({ id: 3, method: "test/start", params }, testConnection.connection)).resolves.toEqual({
            id: 3,
            result: { count: 1 },
        })
        expect(count).toBe(1)
    })

    it("deduplicates stable clientRequestId values across connections that share a request principal", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        let count = 0
        runtime.register("test/start", () => {
            count += 1
            return { count }
        })
        const params = { clientRequestId: "request-1" }

        await expect(runtime.handleRequest({ id: 1, method: "test/start", params }, connection("first", { clientRequestPrincipal: "token:shared" }).connection)).resolves.toEqual({
            id: 1,
            result: { count: 1 },
        })
        await expect(runtime.handleRequest({ id: 2, method: "test/start", params }, connection("second", { clientRequestPrincipal: "token:shared" }).connection)).resolves.toEqual({
            id: 2,
            result: { count: 1 },
        })
        await expect(runtime.handleRequest({ id: 3, method: "test/start", params }, connection("third", { clientRequestPrincipal: "token:other" }).connection)).resolves.toEqual({
            id: 3,
            result: { count: 2 },
        })
        expect(count).toBe(2)
    })

    it("does not retain failed clientRequestId attempts at the runtime boundary", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        let count = 0
        runtime.register("test/start", () => {
            count += 1
            throw new Error(`failed ${count}`)
        })
        const testConnection = connection()
        const params = { clientRequestId: "request-1" }

        await expect(runtime.handleRequest({ id: 1, method: "test/start", params }, testConnection.connection)).resolves.toMatchObject({
            id: 1,
            error: { code: "handler_error", message: "failed 1" },
        })
        await expect(runtime.handleRequest({ id: 2, method: "test/start", params }, testConnection.connection)).resolves.toMatchObject({
            id: 2,
            error: { code: "handler_error", message: "failed 2" },
        })
        expect(count).toBe(2)
    })

    it("rejects malformed method params with structured errors", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const testConnection = connection()

        const badInitialize = await runtime.handleRequest({ id: 1, method: "initialize", params: { protocolVersion: "1" } }, testConnection.connection)
        const badRuntimeRead = await runtime.handleRequest({ id: 2, method: "runtime/read", params: { runtimeId: "" } }, testConnection.connection)
        const badSubscription = await runtime.handleRequest({ id: 3, method: "subscription/update", params: { methods: ["runtime/updated", ""] } }, testConnection.connection)

        expect(badInitialize).toEqual({
            id: 1,
            error: {
                code: "invalid_params",
                message: "protocolVersion must be a finite number",
                data: { path: "$.protocolVersion" },
            },
        })
        expect(badRuntimeRead).toEqual({
            id: 2,
            error: {
                code: "invalid_params",
                message: "runtimeId must be a non-empty string",
                data: { path: "$.runtimeId" },
            },
        })
        expect(badSubscription).toEqual({
            id: 3,
            error: {
                code: "invalid_params",
                message: "methods entries must be non-empty strings",
                data: { path: "$.methods[1]" },
            },
        })
    })

    it("rejects malformed runtime request envelopes instead of silently ignoring them", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const testConnection = connection()
        runtime.connect(testConnection.connection)

        await runtime.handleMessage(testConnection.connection, JSON.stringify({ id: 1, method: "" }))
        await runtime.handleMessage(testConnection.connection, JSON.stringify({ id: 2 }))

        expect(testConnection.messages).toEqual([
            {
                id: 1,
                error: {
                    code: "invalid_message",
                    message: "Runtime request method must be a non-empty string",
                    data: { path: "$.method" },
                },
            },
            {
                id: 2,
                error: {
                    code: "invalid_message",
                    message: "Runtime request method must be a non-empty string",
                    data: { path: "$.method" },
                },
            },
        ])
    })

    it("replays notifications after the requested cursor", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        runtime.registerNotification("test/changed")

        runtime.notify("test/changed", { value: 1 })
        runtime.notify("test/changed", { value: 2 })

        const testConnection = connection()
        runtime.connect(testConnection.connection)

        const response = await runtime.handleRequest(
            { id: 1, method: "subscription/update", params: { methods: ["test/changed"], cursor: "1" } },
            testConnection.connection
        )

        expect(response).toEqual({ id: 1, result: { ok: true } })
        expect(testConnection.messages).toEqual([
            expect.objectContaining({
                method: "test/changed",
                params: { value: 2 },
                cursor: "2",
            }),
        ])
    })

    it("reports lag when replay cursor is older than the retained notification log", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime", notificationLogSize: 1 })
        runtime.registerNotification("test/changed")

        runtime.notify("test/changed", { value: 1 })
        runtime.notify("test/changed", { value: 2 })

        const testConnection = connection()
        runtime.connect(testConnection.connection)

        await runtime.handleRequest({ id: 1, method: "subscription/update", params: { methods: ["test/changed"], cursor: "0" } }, testConnection.connection)

        expect(testConnection.messages).toEqual([
            expect.objectContaining({
                method: "connection/lagged",
                params: {
                    requestedCursor: "0",
                    oldestCursor: "2",
                },
            }),
            expect.objectContaining({
                method: "test/changed",
                params: { value: 2 },
                cursor: "2",
            }),
        ])
    })

    it("does not delete active runtime records as terminal cleanup", () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        runtime.supervisor.create({
            runtimeId: "runtime-1",
            kind: "agent",
            status: "running",
        })

        expect(runtime.supervisor.deleteTerminal("runtime-1", "timer")).toBe(false)
        expect(runtime.supervisor.get("runtime-1")?.status).toBe("running")

        runtime.supervisor.update("runtime-1", { status: "completed" })

        expect(runtime.supervisor.deleteTerminal("runtime-1", "timer")).toBe(true)
        expect(runtime.supervisor.get("runtime-1")).toBeUndefined()
    })

    it("does not delete orphaned runtime records as terminal cleanup", () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        runtime.supervisor.create({
            runtimeId: "runtime-1",
            kind: "agent",
            status: "orphaned",
        })

        expect(runtime.supervisor.deleteTerminal("runtime-1", "timer")).toBe(false)
        expect(runtime.supervisor.get("runtime-1")?.status).toBe("orphaned")
    })

    it("loads checkpointed active runtimes as orphaned", () => {
        const saved: unknown[][] = []
        const checkpointStore = {
            load: () => [
                {
                    runtimeId: "runtime-1",
                    kind: "process" as const,
                    status: "running" as const,
                    startedAt: "2026-05-26T00:00:00.000Z",
                    updatedAt: "2026-05-26T00:00:00.000Z",
                    lastActivityAt: "2026-05-26T00:00:00.000Z",
                },
            ],
            save: (records: unknown[]) => {
                saved.push(records)
            },
        }

        const runtime = new RuntimeServer({ serverName: "test-runtime", checkpointStore })

        expect(runtime.supervisor.get("runtime-1")?.status).toBe("orphaned")
        expect(runtime.supervisor.get("runtime-1")?.scope).toEqual({})
        expect(saved.length).toBeGreaterThan(0)
    })

    it("normalizes legacy flat runtime checkpoint owner fields into scope", () => {
        const checkpointStore = {
            load: () => [
                {
                    runtimeId: "runtime-1",
                    kind: "agent" as const,
                    status: "running" as const,
                    ownerType: "openade-task",
                    ownerId: "task-1",
                    rootPath: "/tmp/project",
                    repoPath: "/tmp/project",
                    startedAt: "2026-05-26T00:00:00.000Z",
                    updatedAt: "2026-05-26T00:00:00.000Z",
                    lastActivityAt: "2026-05-26T00:00:00.000Z",
                },
            ],
            save: () => {},
        }

        const runtime = new RuntimeServer({ serverName: "test-runtime", checkpointStore })

        expect(runtime.supervisor.get("runtime-1")).toMatchObject({
            runtimeId: "runtime-1",
            status: "orphaned",
            scope: {
                ownerType: "openade-task",
                ownerId: "task-1",
                rootPath: "/tmp/project",
                repoPath: "/tmp/project",
            },
        })
    })

    it("adopts checkpointed active runtimes only when the host verifies them as adoptable", () => {
        const checkpointStore = {
            load: () => [
                {
                    runtimeId: "runtime-1",
                    kind: "process" as const,
                    status: "running" as const,
                    startedAt: "2026-05-26T00:00:00.000Z",
                    updatedAt: "2026-05-26T00:00:00.000Z",
                    lastActivityAt: "2026-05-26T00:00:00.000Z",
                    pid: 123,
                    pgid: 123,
                    processLabel: "node test",
                },
            ],
            save: () => {},
        }

        const runtime = new RuntimeServer({
            serverName: "test-runtime",
            checkpointStore,
            livenessProbe: {
                probe(record) {
                    return record.pid === 123 ? { state: "alive" as const, verified: true, adoptable: true } : { state: "unknown" as const }
                },
            },
        })

        expect(runtime.supervisor.get("runtime-1")?.status).toBe("running")
    })

    it("keeps pid-only alive checkpointed runtimes orphaned instead of adopting them", () => {
        const checkpointStore = {
            load: () => [
                {
                    runtimeId: "runtime-1",
                    kind: "process" as const,
                    status: "running" as const,
                    startedAt: "2026-05-26T00:00:00.000Z",
                    updatedAt: "2026-05-26T00:00:00.000Z",
                    lastActivityAt: "2026-05-26T00:00:00.000Z",
                    pid: 123,
                },
            ],
            save: () => {},
        }

        const runtime = new RuntimeServer({
            serverName: "test-runtime",
            checkpointStore,
            livenessProbe: {
                probe() {
                    return { state: "alive" as const }
                },
            },
        })

        expect(runtime.supervisor.get("runtime-1")?.status).toBe("orphaned")
        expect(runtime.supervisor.reconcileRuntime("runtime-1")).toMatchObject({
            state: "orphaned",
            runtime: { runtimeId: "runtime-1", status: "orphaned" },
        })
    })

    it("uses host liveness probes during runtime reconciliation", () => {
        const runtime = new RuntimeServer({
            serverName: "test-runtime",
            livenessProbe: {
                probe(record) {
                    return record.pid === 123_456 ? { state: "dead" as const, reason: "test process exited" } : { state: "unknown" as const }
                },
            },
        })
        runtime.supervisor.create({
            runtimeId: "runtime-1",
            kind: "process",
            status: "running",
            pid: 123_456,
            processLabel: "node test",
        })

        expect(runtime.supervisor.reconcileRuntime("runtime-1")).toMatchObject({
            state: "failed",
            runtime: {
                runtimeId: "runtime-1",
                status: "failed",
                error: "test process exited",
            },
        })
    })

    it("adopts an orphaned runtime on reconciliation when the host later verifies ownership", () => {
        const runtime = new RuntimeServer({
            serverName: "test-runtime",
            livenessProbe: {
                probe(record) {
                    return record.pgid === 123 ? { state: "alive" as const, verified: true, adoptable: true } : { state: "unknown" as const }
                },
            },
        })
        runtime.supervisor.create({
            runtimeId: "runtime-1",
            kind: "process",
            status: "orphaned",
            pid: 123,
            pgid: 123,
            processLabel: "node test",
        })

        expect(runtime.supervisor.reconcileRuntime("runtime-1")).toMatchObject({
            state: "running",
            runtime: { runtimeId: "runtime-1", status: "running" },
        })
    })

    it("registers low-level host methods on the same runtime server", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        registerRuntimeAgentModule(runtime)
        registerRuntimeHostModule(runtime)

        const testConnection = connection()
        await runtime.handleMessage(testConnection.connection, JSON.stringify({ id: 1, method: "initialize" }))

        expect(testConnection.messages[0]).toMatchObject({
            id: 1,
            result: {
                capabilities: {
                    methods: expect.arrayContaining([
                        "fs/path/describe",
                        "fs/file/read",
                        "fs/file/write",
                        "fs/directory/create",
                        "fs/path/copy",
                        "fs/path/remove",
                        "agent/thread/start",
                        "agent/goal/set",
                        "git/status/read",
                        "process/command/start",
                        "pty/spawn",
                    ]),
                },
            },
        })
        const initializeResponse = testConnection.messages[0] as { result: { capabilities: { methods: string[] } } }
        expect(initializeResponse.result.capabilities.methods).not.toContain("git/dir/read")
    })

    it("keeps OpenADE product verbs out of low-level runtime method names", () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        registerRuntimeAgentModule(runtime)
        registerRuntimeHostModule(runtime)

        const productVerbs = new Set(["do", "ask", "plan", "run", "run_plan", "review", "revise", "hyperplan"])
        const leakedMethods = runtime
            .capabilities()
            .methods.filter((method) => method.split("/").some((segment) => productVerbs.has(segment)))

        expect(leakedMethods).toEqual([])
    })

    it("keeps OpenADE product modes out of the core protocol contract", () => {
        const genericRuntimeSources = [
            "../../../../runtime-protocol/src/protocol.ts",
            "../../../../runtime/src/server.ts",
            "../../../../runtime/src/supervisor.ts",
            "../../../../runtime-client/src/client.ts",
            "../../../../runtime-client/src/cache.ts",
            "../../../../runtime-node/src/agents.ts",
            "../../../../runtime-node/src/checkpoint.ts",
            "../../../../runtime-node/src/files.ts",
            "../../../../runtime-node/src/fsWatch.ts",
            "../../../../runtime-node/src/git.ts",
            "../../../../runtime-node/src/process.ts",
            "../../../../runtime-node/src/pty.ts",
            "../../../../runtime-node/src/server.ts",
        ]
        const productModeLiterals = /"do"|"ask"|"plan"|"run"|"run_plan"|"review"|"revise"|"hyperplan"/g

        for (const sourcePath of genericRuntimeSources) {
            const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8")
            expect(source.match(productModeLiterals) ?? [], sourcePath).toEqual([])
        }
    })

    it("routes server-protocol thread, turn, and goal calls through a connected provider bridge", async () => {
        const calls: string[] = []
        const unregister = registerServerProtocolAgentBridge({
            providerId: "codex-server",
            label: "Codex Server",
            capabilities: { goals: true },
            async startThread(params) {
                calls.push(`thread:${params.providerId}`)
                return { thread: { id: "thread-1" } }
            },
            async resumeThread(params) {
                calls.push(`resume:${params.threadId}`)
                return { thread: { id: params.threadId } }
            },
            async startTurn(params) {
                calls.push(`turn:${params.threadId}`)
                return { turn: { id: "turn-1" } }
            },
            async interruptTurn(params) {
                calls.push(`interrupt:${params.threadId}`)
                return { interrupted: true }
            },
            async setGoal(params) {
                calls.push(`goal:${params.threadId}:${params.status ?? "none"}`)
                return {
                    goal: {
                        providerId: params.providerId,
                        threadId: params.threadId,
                        objective: params.objective ?? "existing objective",
                        status: params.status ?? "active",
                        tokenBudget: params.tokenBudget ?? null,
                        tokensUsed: 0,
                        timeUsedSeconds: 0,
                    },
                }
            },
            async getGoal(params) {
                calls.push(`goal-read:${params.threadId}`)
                return { goal: { providerId: params.providerId, threadId: params.threadId, objective: "Ship it", status: "active" } }
            },
            async clearGoal(params) {
                calls.push(`goal-clear:${params.threadId}`)
                return { cleared: true }
            },
        })

        try {
            const runtime = new RuntimeServer({ serverName: "test-runtime" })
            registerRuntimeAgentModule(runtime)
            const testConnection = connection()

            const initialized = await runtime.handleRequest({ id: 1, method: "initialize" }, testConnection.connection)
            expect(initialized.result).toMatchObject({
                capabilities: {
                    agentProviders: [
                        expect.objectContaining({
                            providerId: "codex-server",
                            kind: "serverProtocol",
                            capabilities: expect.objectContaining({ goals: true }),
                        }),
                    ],
                },
            })

            await expect(runtime.handleRequest({ id: 2, method: "agent/thread/start", params: { providerId: "codex-server" } }, testConnection.connection)).resolves.toMatchObject({
                result: { thread: { id: "thread-1" } },
            })
            await expect(
                runtime.handleRequest({ id: 3, method: "agent/turn/start", params: { providerId: "codex-server", threadId: "thread-1", input: "go" } }, testConnection.connection)
            ).resolves.toMatchObject({ result: { turn: { id: "turn-1" } } })
            await expect(runtime.handleRequest({ id: 11, method: "runtime/list", params: { ownerType: "agent-server-turn", ownerId: "thread-1" } }, testConnection.connection)).resolves.toMatchObject({
                result: [
                    expect.objectContaining({
                        kind: "agent",
                        status: "running",
                        nativeId: "turn-1",
                        scope: expect.objectContaining({
                            ownerType: "agent-server-turn",
                            ownerId: "thread-1",
                            labels: expect.objectContaining({ providerId: "codex-server", turnId: "turn-1" }),
                        }),
                    }),
                ],
            })
            notifyRuntimeNodeAgentBridgeEvent(runtime, "agent/turn/completed", { providerId: "codex-server", threadId: "thread-1", turnId: "turn-1" })
            await expect(runtime.handleRequest({ id: 12, method: "runtime/list", params: { ownerType: "agent-server-turn", ownerId: "thread-1" } }, testConnection.connection)).resolves.toMatchObject({
                result: [expect.objectContaining({ status: "completed", nativeId: "turn-1" })],
            })
            await expect(
                runtime.handleRequest(
                    { id: 4, method: "agent/goal/create", params: { providerId: "codex-server", threadId: "thread-1", objective: "Complete the migration" } },
                    testConnection.connection
                )
            ).resolves.toMatchObject({ result: { goal: { threadId: "thread-1", status: "active" } } })
            await expect(
                runtime.handleRequest({ id: 5, method: "agent/goal/update", params: { providerId: "codex-server", goalId: "thread-1", objective: "Refine the migration" } }, testConnection.connection)
            ).resolves.toMatchObject({ result: { goal: { objective: "Refine the migration", status: "active" } } })
            await expect(runtime.handleRequest({ id: 6, method: "agent/goal/block", params: { providerId: "codex-server", goalId: "thread-1" } }, testConnection.connection)).resolves.toMatchObject({
                result: { goal: { status: "blocked" } },
            })
            await expect(
                runtime.handleRequest({ id: 7, method: "agent/goal/complete", params: { providerId: "codex-server", goalId: "thread-1" } }, testConnection.connection)
            ).resolves.toMatchObject({ result: { goal: { status: "complete" } } })
            await expect(
                runtime.handleRequest({ id: 8, method: "agent/goal/read", params: { providerId: "codex-server", goalId: "thread-1" } }, testConnection.connection)
            ).resolves.toMatchObject({ result: { goal: { objective: "Ship it" } } })
            await expect(
                runtime.handleRequest({ id: 9, method: "agent/goal/get", params: { providerId: "codex-server", threadId: "thread-1" } }, testConnection.connection)
            ).resolves.toMatchObject({ result: { goal: { objective: "Ship it" } } })
            await expect(
                runtime.handleRequest({ id: 10, method: "agent/goal/clear", params: { providerId: "codex-server", threadId: "thread-1" } }, testConnection.connection)
            ).resolves.toMatchObject({ result: { cleared: true } })

            expect(calls).toEqual([
                "thread:codex-server",
                "turn:thread-1",
                "goal:thread-1:active",
                "goal:thread-1:none",
                "goal:thread-1:blocked",
                "goal:thread-1:complete",
                "goal-read:thread-1",
                "goal-read:thread-1",
                "goal-clear:thread-1",
            ])
        } finally {
            unregister()
        }
    })

    it("routes provider lifecycle calls through server-protocol bridges", async () => {
        const calls: string[] = []
        const unregister = registerServerProtocolAgentBridge({
            providerId: "codex-server",
            label: "Codex Server",
            async connect() {
                calls.push("connect")
            },
            async disconnect() {
                calls.push("disconnect")
            },
            async startThread() {
                return { thread: { id: "thread-1" } }
            },
            async resumeThread() {
                return { thread: { id: "thread-1" } }
            },
            async startTurn() {
                return { turn: { id: "turn-1" } }
            },
            async interruptTurn() {
                return { interrupted: true }
            },
            async setGoal() {
                return { goal: { threadId: "thread-1", status: "active" } }
            },
            async getGoal() {
                return { goal: { threadId: "thread-1", status: "active" } }
            },
            async clearGoal() {
                return { cleared: true }
            },
        })

        try {
            const runtime = new RuntimeServer({ serverName: "test-runtime" })
            registerRuntimeAgentModule(runtime)
            const testConnection = connection()

            await expect(runtime.handleRequest({ id: 1, method: "agent/provider/connect", params: { providerId: "codex-server" } }, testConnection.connection)).resolves.toMatchObject({
                result: { ok: true },
            })
            await expect(runtime.handleRequest({ id: 2, method: "agent/provider/disconnect", params: { providerId: "codex-server" } }, testConnection.connection)).resolves.toMatchObject({
                result: { ok: true },
            })

            expect(calls).toEqual(["connect", "disconnect"])
        } finally {
            unregister()
        }
    })

    it("routes server-protocol approval list, response, and rejection calls", async () => {
        const resolved: unknown[] = []
        const rejected: unknown[] = []
        const unregister = registerServerProtocolAgentBridge({
            providerId: "approval-provider",
            pendingServerRequestList() {
                return [
                    { requestId: "approval-1", method: "item/requestApproval", params: { command: ["echo", "yes"] } },
                    { requestId: "approval-2", method: "item/requestApproval", params: { command: ["echo", "no"] } },
                ]
            },
            resolveServerRequest(requestId, result) {
                resolved.push({ requestId, result })
                return requestId === "approval-1"
            },
            rejectServerRequest(requestId, error) {
                rejected.push({ requestId, message: error.message })
                return requestId === "approval-2"
            },
            async startThread() {
                return { thread: { id: "thread-1" } }
            },
            async resumeThread() {
                return { thread: { id: "thread-1" } }
            },
            async startTurn() {
                return { turn: { id: "turn-1" } }
            },
            async interruptTurn() {
                return { interrupted: true }
            },
            async setGoal() {
                return { goal: { threadId: "thread-1", status: "active" } }
            },
            async getGoal() {
                return { goal: { threadId: "thread-1", status: "active" } }
            },
            async clearGoal() {
                return { cleared: true }
            },
        })

        try {
            const runtime = new RuntimeServer({ serverName: "test-runtime" })
            registerRuntimeAgentModule(runtime)
            const testConnection = connection()

            await expect(runtime.handleRequest({ id: 1, method: "agent/approval/list", params: { providerId: "approval-provider" } }, testConnection.connection)).resolves.toMatchObject({
                result: [
                    { requestId: "approval-1", method: "item/requestApproval" },
                    { requestId: "approval-2", method: "item/requestApproval" },
                ],
            })
            await expect(
                runtime.handleRequest(
                    { id: 2, method: "agent/approval/respond", params: { providerId: "approval-provider", requestId: "approval-1", response: { decision: "accept" } } },
                    testConnection.connection
                )
            ).resolves.toMatchObject({ result: { ok: true } })
            await expect(
                runtime.handleRequest({ id: 3, method: "agent/approval/reject", params: { providerId: "approval-provider", requestId: "approval-2", message: "Denied" } }, testConnection.connection)
            ).resolves.toMatchObject({ result: { ok: true } })

            expect(resolved).toEqual([{ requestId: "approval-1", result: { decision: "accept" } }])
            expect(rejected).toEqual([{ requestId: "approval-2", message: "Denied" }])
        } finally {
            unregister()
        }
    })

    it("exposes generic provider, model, session, and replay methods", async () => {
        const calls: string[] = []
        const unregister = registerServerProtocolAgentBridge({
            providerId: "session-provider",
            label: "Session Provider",
            listModels() {
                calls.push("models")
                return { providerId: "session-provider", models: [{ id: "model-a" }], defaultModel: "model-a" }
            },
            listSessions(params) {
                calls.push(`sessions:${params.limit ?? "none"}`)
                return [{ sessionId: "session-1", providerId: params.providerId }]
            },
            readSession(params) {
                calls.push(`read:${params.sessionId}`)
                return [{ type: "message", sessionId: params.sessionId }]
            },
            activeSession(params) {
                calls.push(`active:${params.sessionId}`)
                return { active: true }
            },
            replayTurn(params) {
                calls.push(`replay:${params.threadId}`)
                return { replayed: true }
            },
            async startThread() {
                return { thread: { id: "thread-1" } }
            },
            async resumeThread() {
                return { thread: { id: "thread-1" } }
            },
            async startTurn() {
                return { turn: { id: "turn-1" } }
            },
            async interruptTurn() {
                return { interrupted: true }
            },
            async setGoal() {
                return { goal: { threadId: "thread-1", status: "active" } }
            },
            async getGoal() {
                return { goal: { threadId: "thread-1", status: "active" } }
            },
            async clearGoal() {
                return { cleared: true }
            },
        })

        try {
            const runtime = new RuntimeServer({ serverName: "test-runtime" })
            registerRuntimeAgentModule(runtime)
            const testConnection = connection()

            await expect(runtime.handleRequest({ id: 0, method: "agent/serverProtocol/list" }, testConnection.connection)).resolves.toMatchObject({
                result: [{ providerId: "session-provider", connected: true }],
            })
            await expect(runtime.handleRequest({ id: 1, method: "agent/provider/read", params: { providerId: "session-provider" } }, testConnection.connection)).resolves.toMatchObject({
                result: { providerId: "session-provider", kind: "serverProtocol" },
            })
            await expect(runtime.handleRequest({ id: 2, method: "agent/model/list", params: { providerId: "session-provider" } }, testConnection.connection)).resolves.toMatchObject({
                result: { models: [{ id: "model-a" }] },
            })
            await expect(runtime.handleRequest({ id: 3, method: "agent/session/list", params: { providerId: "session-provider", limit: 1 } }, testConnection.connection)).resolves.toMatchObject({
                result: [{ sessionId: "session-1" }],
            })
            await expect(runtime.handleRequest({ id: 4, method: "agent/session/read", params: { providerId: "session-provider", sessionId: "session-1" } }, testConnection.connection)).resolves.toMatchObject({
                result: [{ type: "message", sessionId: "session-1" }],
            })
            await expect(runtime.handleRequest({ id: 5, method: "agent/session/active", params: { providerId: "session-provider", sessionId: "session-1" } }, testConnection.connection)).resolves.toMatchObject({
                result: { active: true },
            })
            await expect(runtime.handleRequest({ id: 6, method: "agent/turn/replay", params: { providerId: "session-provider", threadId: "thread-1", input: "again" } }, testConnection.connection)).resolves.toMatchObject({
                result: { replayed: true },
            })

            expect(calls).toEqual(["models", "sessions:1", "read:session-1", "active:session-1", "replay:thread-1"])
        } finally {
            unregister()
        }
    })

    it("routes process-backed session deletes through the agent executor", async () => {
        const deleted: unknown[] = []
        const executor: RuntimeNodeAgentExecutor = {
            providers() {
                return [
                    {
                        providerId: "codex",
                        label: "Codex",
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
                    },
                ]
            },
            async status() {
                return null
            },
            async start() {
                return { ok: true }
            },
            async interrupt() {
                return { ok: true }
            },
            async deleteSession(params) {
                deleted.push(params)
                return { ok: true }
            },
        }
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        registerRuntimeNodeAgentModule(runtime, executor)
        const testConnection = connection()

        await expect(
            runtime.handleRequest({ id: 1, method: "agent/session/delete", params: { harnessId: "codex", sessionId: "session-1", cwd: "/repo" } }, testConnection.connection)
        ).resolves.toMatchObject({ result: { ok: true } })

        expect(deleted).toEqual([{ harnessId: "codex", sessionId: "session-1", cwd: "/repo" }])
    })

    it("returns a typed unsupported-capability error when a server-protocol provider has no goal support", async () => {
        const unregister = registerServerProtocolAgentBridge({
            providerId: "no-goals",
            capabilities: { goals: false },
            async startThread() {
                return { thread: { id: "thread-1" } }
            },
            async resumeThread() {
                return { thread: { id: "thread-1" } }
            },
            async startTurn() {
                return { turn: { id: "turn-1" } }
            },
            async interruptTurn() {
                return { interrupted: true }
            },
            async setGoal() {
                throw new Error("should not be called")
            },
            async getGoal() {
                throw new Error("should not be called")
            },
            async clearGoal() {
                throw new Error("should not be called")
            },
        })

        try {
            const runtime = new RuntimeServer({ serverName: "test-runtime" })
            registerRuntimeAgentModule(runtime)
            const denied = await runtime.handleRequest(
                { id: 1, method: "agent/goal/create", params: { providerId: "no-goals", threadId: "thread-1", objective: "x" } },
                connection().connection
            )

            expect(denied.error).toMatchObject({
                code: "unsupported_capability",
                message: "Agent provider no-goals does not support goals",
            })
        } finally {
            unregister()
        }
    })

    it("rejects malformed runtime-node agent params at the protocol boundary", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        registerRuntimeAgentModule(runtime)
        const testConnection = connection()

        const missingExecutionCwd = await runtime.handleRequest(
            { id: 1, method: "agent/execution/start", params: { executionId: "execution-1", prompt: "hello", options: { harnessId: "codex" } } },
            testConnection.connection
        )
        const missingTurnInput = await runtime.handleRequest(
            { id: 2, method: "agent/turn/start", params: { providerId: "codex-server", threadId: "thread-1" } },
            testConnection.connection
        )
        const missingGoalId = await runtime.handleRequest(
            { id: 3, method: "agent/goal/read", params: { providerId: "codex-server" } },
            testConnection.connection
        )

        expect(missingExecutionCwd).toEqual({
            id: 1,
            error: {
                code: "invalid_params",
                message: "options.cwd must be a non-empty string",
                data: { path: "$.options.cwd" },
            },
        })
        expect(missingTurnInput).toEqual({
            id: 2,
            error: {
                code: "invalid_params",
                message: "input must be a non-empty string",
                data: { path: "$.input" },
            },
        })
        expect(missingGoalId).toEqual({
            id: 3,
            error: {
                code: "invalid_params",
                message: "threadId or goalId must be a non-empty string",
                data: { path: "$.threadId" },
            },
        })
    })

    it("rejects malformed low-level host params at the protocol boundary", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        registerRuntimeHostModule(runtime)
        const testConnection = connection()

        const badProcess = await runtime.handleRequest({ id: 1, method: "process/command/start", params: { cmd: "node", cwd: 42 } }, testConnection.connection)
        const badPty = await runtime.handleRequest({ id: 2, method: "pty/spawn", params: { cwd: "/tmp", cols: "100" } }, testConnection.connection)
        const badWatch = await runtime.handleRequest({ id: 3, method: "fs/watch/start", params: { dir: "" } }, testConnection.connection)
        const badFiles = await runtime.handleRequest({ id: 4, method: "fs/search/fuzzy", params: { dir: "/tmp", query: "", limit: "100" } }, testConnection.connection)
        const badFileEncoding = await runtime.handleRequest({ id: 5, method: "fs/file/read", params: { path: "/tmp/file.txt", encoding: "binary" } }, testConnection.connection)
        const badGit = await runtime.handleRequest({ id: 6, method: "git/status/read", params: { repoDir: "" } }, testConnection.connection)

        expect(badProcess).toEqual({
            id: 1,
            error: {
                code: "invalid_params",
                message: "cwd must be a non-empty string",
                data: { path: "$.cwd" },
            },
        })
        expect(badPty).toEqual({
            id: 2,
            error: {
                code: "invalid_params",
                message: "cols must be a positive integer",
                data: { path: "$.cols" },
            },
        })
        expect(badWatch).toEqual({
            id: 3,
            error: {
                code: "invalid_params",
                message: "dir must be a non-empty string",
                data: { path: "$.dir" },
            },
        })
        expect(badFiles).toEqual({
            id: 4,
            error: {
                code: "invalid_params",
                message: "limit must be a finite number",
                data: { path: "$.limit" },
            },
        })
        expect(badGit).toEqual({
            id: 6,
            error: {
                code: "invalid_params",
                message: "repoDir must be a non-empty string",
                data: { path: "$.repoDir" },
            },
        })
        expect(badFileEncoding).toEqual({
            id: 5,
            error: {
                code: "invalid_params",
                message: "encoding must be one of: utf8, base64",
                data: { path: "$.encoding" },
            },
        })
    })

    it("honors connection method permissions", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        registerRuntimeHostModule(runtime)
        const testConnection = {
            id: "remote-device",
            permissions: ["initialize", "openade/*"],
            send(_message: RuntimeMessage) {},
        }

        const denied = await runtime.handleRequest({ id: 1, method: "process/list" }, testConnection)
        const allowed = await runtime.handleRequest({ id: 2, method: "initialize" }, testConnection)

        expect(denied.error?.code).toBe("permission_denied")
        expect(allowed.error).toBeUndefined()
    })

    it("honors connection notification permissions", () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime" })
        const messages: RuntimeMessage[] = []
        runtime.connect({
            id: "remote-device",
            notificationPermissions: ["openade/*", "connection/lagged"],
            send(message) {
                messages.push(message)
            },
        })

        runtime.notify("process/output", { processId: "process-1", output: "hidden" })
        runtime.notify("runtime/updated", { runtimeId: "runtime-1" })
        runtime.notify("openade/task/updated", { taskId: "task-1" })

        expect(messages).toEqual([
            expect.objectContaining({
                method: "openade/task/updated",
                params: { taskId: "task-1" },
            }),
        ])
    })

    it("filters replay lag notifications through connection notification permissions", async () => {
        const runtime = new RuntimeServer({ serverName: "test-runtime", notificationLogSize: 1 })
        runtime.registerNotification("test/changed")
        runtime.notify("test/changed", { value: 1 })
        runtime.notify("test/changed", { value: 2 })

        const messages: RuntimeMessage[] = []
        const testConnection = {
            id: "remote-device",
            notificationPermissions: ["test/*"],
            send(message: RuntimeMessage) {
                messages.push(message)
            },
        }
        runtime.connect(testConnection)

        await runtime.handleRequest({ id: 1, method: "subscription/update", params: { methods: ["*"], cursor: "0" } }, testConnection)

        expect(messages).toEqual([
            expect.objectContaining({
                method: "test/changed",
                params: { value: 2 },
            }),
        ])
    })
})
