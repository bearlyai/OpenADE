#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
    createRuntimeNodeAgentBridgeRegistry,
    createRuntimeNodeHarnessAgentExecutor,
    notifyRuntimeNodeAgentBridgeEvent,
    registerRuntimeNodeAgentModule,
    registerRuntimeNodeServerProtocolAgentBridge,
} from "./agents"
import { createRuntimeNodeCheckpointStore } from "./checkpoint"
import {
    createRuntimeNodeCodexAppServerBridge,
    type RuntimeNodeCodexAppServerBridge,
    type RuntimeNodeCodexManagedAppServerProcessOptions,
} from "./codexAppServerBridge"
import { registerRuntimeNodeFilesModule } from "./files"
import { registerRuntimeNodeFsWatchModule } from "./fsWatch"
import { registerRuntimeNodeGitModule } from "./git"
import { createRuntimeNodeLocalFilesAdapter } from "./localFiles"
import { createRuntimeNodeLocalGitAdapter } from "./localGit"
import { createRuntimeNodeLocalProcessAdapter } from "./localProcess"
import { createRuntimeNodeLocalPtyAdapter } from "./localPty"
import { registerRuntimeNodeProcessModule } from "./process"
import { registerRuntimeNodePtyModule } from "./pty"
import { createRuntimeNodeServer, serveRuntimeNodeHttp, type RuntimeNodeHttpServer, type RuntimeNodeHttpServerOptions } from "./server"

export interface RuntimeNodeCodexAppServerConfig {
    providerId?: string
    label?: string
    websocketUrl: string
    authToken?: string
    clientName?: string
    clientVersion?: string
    experimentalApi?: boolean
    requestTimeoutMs?: number
    serverRequestTimeoutMs?: number
    managedProcess?: RuntimeNodeCodexManagedAppServerProcessOptions
}

export interface RuntimeNodeServeConfig {
    host?: string
    port?: number
    path?: string
    token?: string
    checkpointFile?: string
    allowUnauthenticatedLoopback?: boolean
    codexAppServers?: RuntimeNodeCodexAppServerConfig[]
}

function defaultCheckpointFile(): string {
    return path.join(process.cwd(), ".runtime", "checkpoint.json")
}

function numberValue(value: string | undefined): number | undefined {
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function booleanValue(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined
    if (value === "1" || value === "true") return true
    if (value === "0" || value === "false") return false
    return undefined
}

function stringArrayValue(value: string | undefined): string[] | undefined {
    if (!value) return undefined
    try {
        const parsed = JSON.parse(value) as unknown
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed
    } catch {
        // Fall through to whitespace splitting for local shell convenience.
    }
    return value.split(/\s+/).map((item) => item.trim()).filter(Boolean)
}

function readConfigFile(filePath: string | undefined): RuntimeNodeServeConfig {
    if (!filePath) return {}
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === "object" && parsed !== null ? (parsed as RuntimeNodeServeConfig) : {}
}

function flagValue(args: string[], name: string): string | undefined {
    const prefix = `${name}=`
    const inline = args.find((arg) => arg.startsWith(prefix))
    if (inline) return inline.slice(prefix.length)
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
}

function codexAppServerFromEnvOrFlags(command: string[], env: NodeJS.ProcessEnv): RuntimeNodeCodexAppServerConfig | undefined {
    const websocketUrl = flagValue(command, "--codex-server-url") ?? env.RUNTIME_NODE_CODEX_SERVER_URL
    if (!websocketUrl) return undefined

    const commandPath = flagValue(command, "--codex-server-command") ?? env.RUNTIME_NODE_CODEX_SERVER_COMMAND
    const args = stringArrayValue(flagValue(command, "--codex-server-args") ?? env.RUNTIME_NODE_CODEX_SERVER_ARGS)
    const cwd = flagValue(command, "--codex-server-cwd") ?? env.RUNTIME_NODE_CODEX_SERVER_CWD

    return {
        providerId: flagValue(command, "--codex-server-provider-id") ?? env.RUNTIME_NODE_CODEX_SERVER_PROVIDER_ID,
        label: flagValue(command, "--codex-server-label") ?? env.RUNTIME_NODE_CODEX_SERVER_LABEL,
        websocketUrl,
        authToken: flagValue(command, "--codex-server-token") ?? env.RUNTIME_NODE_CODEX_SERVER_TOKEN,
        clientName: flagValue(command, "--codex-server-client-name") ?? env.RUNTIME_NODE_CODEX_SERVER_CLIENT_NAME,
        clientVersion: flagValue(command, "--codex-server-client-version") ?? env.RUNTIME_NODE_CODEX_SERVER_CLIENT_VERSION,
        experimentalApi: booleanValue(flagValue(command, "--codex-server-experimental-api") ?? env.RUNTIME_NODE_CODEX_SERVER_EXPERIMENTAL_API),
        managedProcess: commandPath
            ? {
                  command: commandPath,
                  args: args ?? [],
                  cwd,
                  readyProbeUrl: flagValue(command, "--codex-server-ready-url") ?? env.RUNTIME_NODE_CODEX_SERVER_READY_URL,
                  readyTimeoutMs: numberValue(flagValue(command, "--codex-server-ready-timeout-ms") ?? env.RUNTIME_NODE_CODEX_SERVER_READY_TIMEOUT_MS),
                  killOnDisconnect: booleanValue(flagValue(command, "--codex-server-kill-on-disconnect") ?? env.RUNTIME_NODE_CODEX_SERVER_KILL_ON_DISCONNECT),
              }
            : undefined,
    }
}

export function parseRuntimeNodeServeConfig(args: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): RuntimeNodeServeConfig {
    const command = args[0] === "serve" ? args.slice(1) : args
    const configPath = flagValue(command, "--config") ?? env.RUNTIME_NODE_CONFIG
    const fileConfig = readConfigFile(configPath)
    const codexAppServer = codexAppServerFromEnvOrFlags(command, env)

    return {
        ...fileConfig,
        host: flagValue(command, "--host") ?? env.RUNTIME_NODE_HOST ?? fileConfig.host,
        port: numberValue(flagValue(command, "--port") ?? env.RUNTIME_NODE_PORT) ?? fileConfig.port,
        path: flagValue(command, "--path") ?? env.RUNTIME_NODE_PATH ?? fileConfig.path,
        token: flagValue(command, "--token") ?? env.RUNTIME_NODE_TOKEN ?? fileConfig.token,
        checkpointFile: flagValue(command, "--checkpoint-file") ?? env.RUNTIME_NODE_CHECKPOINT_FILE ?? fileConfig.checkpointFile,
        allowUnauthenticatedLoopback:
            booleanValue(flagValue(command, "--allow-unauthenticated-loopback") ?? env.RUNTIME_NODE_ALLOW_UNAUTHENTICATED_LOOPBACK) ??
            fileConfig.allowUnauthenticatedLoopback,
        codexAppServers: codexAppServer ? [...(fileConfig.codexAppServers ?? []), codexAppServer] : fileConfig.codexAppServers,
    }
}

export async function startRuntimeNodeServe(config: RuntimeNodeServeConfig): Promise<RuntimeNodeHttpServer> {
    const agentExecutor = createRuntimeNodeHarnessAgentExecutor()
    const runtime = createRuntimeNodeServer({
        serverName: "runtime-node",
        serverVersion: process.env.RELEASE ?? "headless",
        checkpointStore: createRuntimeNodeCheckpointStore(config.checkpointFile ?? defaultCheckpointFile()),
    })
    const bridgeRegistry = createRuntimeNodeAgentBridgeRegistry()
    const bridgeRegistrations: Array<{ bridge: RuntimeNodeCodexAppServerBridge; unregister: () => void }> = []
    const cleanupRuntimeModules: Array<() => void> = []
    for (const bridgeConfig of config.codexAppServers ?? []) {
        const bridge = createRuntimeNodeCodexAppServerBridge({
            ...bridgeConfig,
            onNotification(method, params) {
                notifyRuntimeNodeAgentBridgeEvent(runtime, method, params)
            },
        })
        bridgeRegistrations.push({ bridge, unregister: registerRuntimeNodeServerProtocolAgentBridge(bridge, bridgeRegistry) })
    }
    const processAdapter = createRuntimeNodeLocalProcessAdapter()
    const ptyAdapter = createRuntimeNodeLocalPtyAdapter()
    registerRuntimeNodeFilesModule(runtime, createRuntimeNodeLocalFilesAdapter())
    registerRuntimeNodeGitModule(runtime, createRuntimeNodeLocalGitAdapter())
    cleanupRuntimeModules.push(registerRuntimeNodeProcessModule(runtime, processAdapter))
    cleanupRuntimeModules.push(registerRuntimeNodePtyModule(runtime, ptyAdapter))
    cleanupRuntimeModules.push(registerRuntimeNodeFsWatchModule(runtime))
    registerRuntimeNodeAgentModule(runtime, agentExecutor, { bridgeRegistry })

    const options: RuntimeNodeHttpServerOptions = {
        runtime,
        host: config.host,
        port: config.port,
        path: config.path,
        token: config.token,
        allowUnauthenticatedLoopback: config.allowUnauthenticatedLoopback,
    }
    const server = await serveRuntimeNodeHttp(options)
    return {
        ...server,
        async close() {
            try {
                await Promise.all(bridgeRegistrations.map(({ bridge }) => bridge.disconnect()))
                await Promise.all([processAdapter.killAll(), ptyAdapter.killAll()])
            } finally {
                for (const cleanup of cleanupRuntimeModules.splice(0).reverse()) cleanup()
                for (const { unregister } of bridgeRegistrations) unregister()
                await server.close()
            }
        },
    }
}

export async function startRuntimeNodeCli(args: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<RuntimeNodeHttpServer> {
    if (args[0] !== "serve") {
        throw new Error("Usage: runtime-node serve [--host HOST] [--port PORT] [--token TOKEN]")
    }

    const server = await startRuntimeNodeServe(parseRuntimeNodeServeConfig(args, env))
    console.log(`Runtime listening at ${server.url}`)
    return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    startRuntimeNodeCli().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    })
}
