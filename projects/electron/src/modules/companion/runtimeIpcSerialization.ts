import { runtimeError, type RuntimeMessage, type RuntimeRequest, type RuntimeResponse } from "../../../../runtime-protocol/src"

export function cloneRuntimeMessageForIpc<T extends RuntimeMessage>(message: T): T {
    const serialized = JSON.stringify(message)
    if (serialized === undefined) {
        throw new Error("Runtime message must be JSON serializable")
    }
    return JSON.parse(serialized) as T
}

export function serializationErrorResponse(id: RuntimeRequest["id"], error: unknown): RuntimeResponse {
    return {
        id,
        error: runtimeError("serialization_error", error instanceof Error ? error.message : "Runtime response is not JSON serializable"),
    }
}
