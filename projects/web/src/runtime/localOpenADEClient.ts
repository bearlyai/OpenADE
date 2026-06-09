import { createKernelSessionFromRuntime } from "../kernel/session"
import { localProductRuntimeClient } from "./localProductRuntimeClient"

export const localKernelSession = createKernelSessionFromRuntime(localProductRuntimeClient, {
    clientName: "OpenADE Desktop",
    clientPlatform: "desktop",
    protocolVersion: 1,
})

export const localOpenADEClient = localKernelSession.openade
