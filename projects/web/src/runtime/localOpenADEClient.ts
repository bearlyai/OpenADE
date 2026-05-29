import { OpenADEClient } from "../../../openade-client/src"
import { localRuntimeClient } from "./localRuntimeClient"

export const localOpenADEClient = new OpenADEClient({
    runtime: localRuntimeClient,
    clientName: "OpenADE Desktop",
    clientPlatform: "desktop",
    protocolVersion: 1,
})
