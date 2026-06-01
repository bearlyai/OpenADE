import os from "node:os"
import path from "node:path"
import {
    createRuntimeNodeAgentBridgeRegistry,
    createRuntimeNodeHarnessAgentExecutor,
    registerRuntimeNodeAgentModule,
    type RuntimeNodeAgentBridgeRegistry,
    type RuntimeNodeAgentExecutor,
} from "../../runtime-node/src/agents"
import { createRuntimeNodeCheckpointStore } from "../../runtime-node/src/checkpoint"
import { registerRuntimeNodeFilesModule } from "../../runtime-node/src/files"
import { registerRuntimeNodeFsWatchModule } from "../../runtime-node/src/fsWatch"
import { registerRuntimeNodeGitModule } from "../../runtime-node/src/git"
import { createRuntimeNodeLocalFilesAdapter } from "../../runtime-node/src/localFiles"
import { createRuntimeNodeLocalGitAdapter } from "../../runtime-node/src/localGit"
import { createRuntimeNodeLocalProcessAdapter } from "../../runtime-node/src/localProcess"
import { createRuntimeNodeLocalPtyAdapter } from "../../runtime-node/src/localPty"
import { registerRuntimeNodeProcessModule } from "../../runtime-node/src/process"
import { registerRuntimeNodePtyModule } from "../../runtime-node/src/pty"
import {
    createRuntimeNodeServer,
    serveRuntimeNodeHttp,
    type RuntimeNodeHttpServer,
    type RuntimeNodeHttpServerOptions,
} from "../../runtime-node/src/server"
import type { RuntimeServer } from "../../runtime/src"
import { registerRuntimeNodeOpenADEModule } from "./node"

export interface OpenADEKernelHostCapabilities {
    files?: boolean
    git?: boolean
    process?: boolean
    pty?: boolean
    fsWatch?: boolean
}

export interface OpenADEKernelOptions {
    dataDir?: string
    checkpointFile?: string
    hostName?: string
    serverName?: string
    serverVersion?: string
    protocolVersion?: number
    agentExecutor?: RuntimeNodeAgentExecutor
    bridgeRegistry?: RuntimeNodeAgentBridgeRegistry
    hostCapabilities?: OpenADEKernelHostCapabilities
}

export interface OpenADEKernel {
    server: RuntimeServer
    close(): Promise<void>
}

export interface OpenADEKernelHttpServer extends RuntimeNodeHttpServer {
    kernel: OpenADEKernel
}

export type OpenADEKernelHttpOptions = OpenADEKernelOptions & Omit<RuntimeNodeHttpServerOptions, "runtime" | "runtimeOptions">

function defaultCheckpointFile(dataDir: string): string {
    return path.join(dataDir, "..", "runtime-checkpoints.json")
}

function enabled(value: boolean | undefined): boolean {
    return value !== false
}

export function createOpenADEKernel(options: OpenADEKernelOptions = {}): OpenADEKernel {
    const dataDir = options.dataDir ?? path.join(os.homedir(), ".openade", "data", "yjs")
    const agentExecutor = options.agentExecutor ?? createRuntimeNodeHarnessAgentExecutor()
    const bridgeRegistry = options.bridgeRegistry ?? createRuntimeNodeAgentBridgeRegistry()
    const hostCapabilities = options.hostCapabilities ?? {}
    const cleanup: Array<() => void | Promise<void>> = []

    const server = createRuntimeNodeServer({
        serverName: options.serverName ?? "openade-runtime",
        serverVersion: options.serverVersion ?? process.env.RELEASE ?? "headless",
        protocolVersion: options.protocolVersion,
        checkpointStore: createRuntimeNodeCheckpointStore(options.checkpointFile ?? defaultCheckpointFile(dataDir)),
    })

    registerRuntimeNodeAgentModule(server, agentExecutor, { bridgeRegistry })
    if (enabled(hostCapabilities.files)) registerRuntimeNodeFilesModule(server, createRuntimeNodeLocalFilesAdapter())
    if (enabled(hostCapabilities.git)) registerRuntimeNodeGitModule(server, createRuntimeNodeLocalGitAdapter())

    const processAdapter = enabled(hostCapabilities.process) ? createRuntimeNodeLocalProcessAdapter() : null
    if (processAdapter) cleanup.push(registerRuntimeNodeProcessModule(server, processAdapter))

    const ptyAdapter = enabled(hostCapabilities.pty) ? createRuntimeNodeLocalPtyAdapter() : null
    if (ptyAdapter) cleanup.push(registerRuntimeNodePtyModule(server, ptyAdapter))

    if (enabled(hostCapabilities.fsWatch)) cleanup.push(registerRuntimeNodeFsWatchModule(server))

    registerRuntimeNodeOpenADEModule(server, {
        dataDir,
        hostName: options.hostName ?? os.hostname(),
        version: options.serverVersion ?? process.env.RELEASE ?? "headless",
        agentExecutor,
        registerAgentModule: false,
    })

    return {
        server,
        async close() {
            try {
                await Promise.all([processAdapter?.killAll(), ptyAdapter?.killAll()])
            } finally {
                for (const dispose of cleanup.splice(0).reverse()) {
                    await dispose()
                }
            }
        },
    }
}

export async function serveOpenADEKernelHttp(options: OpenADEKernelHttpOptions = {}): Promise<OpenADEKernelHttpServer> {
    const kernel = createOpenADEKernel(options)
    const runtimeServer = await serveRuntimeNodeHttp({
        runtime: kernel.server,
        host: options.host,
        port: options.port,
        path: options.path,
        token: options.token,
        permissions: options.permissions,
        allowUnauthenticatedLoopback: options.allowUnauthenticatedLoopback,
        maxBufferedBytes: options.maxBufferedBytes,
        heartbeatMs: options.heartbeatMs,
    })

    return {
        ...runtimeServer,
        kernel,
        async close() {
            try {
                await runtimeServer.close()
            } finally {
                await kernel.close()
            }
        },
    }
}
