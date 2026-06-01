import { createKernelSessionFromRuntime } from "../kernel/session"
import { localRuntimeClient } from "./localRuntimeClient"

export const localKernelSession = createKernelSessionFromRuntime(localRuntimeClient, {
    clientName: "OpenADE Desktop",
    clientPlatform: "desktop",
    protocolVersion: 1,
})

export const localOpenADEClient = localKernelSession.openade
