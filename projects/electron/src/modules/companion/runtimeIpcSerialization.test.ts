import { describe, expect, it } from "vitest"
import { cloneRuntimeMessageForIpc, serializationErrorResponse } from "./runtimeIpcSerialization"

describe("runtime IPC serialization", () => {
    it("normalizes runtime responses through JSON before returning across Electron IPC", () => {
        const response = {
            id: 1,
            result: {
                taskId: "task-1",
                ignored: undefined,
                nested: { ok: true },
            },
        }

        expect(cloneRuntimeMessageForIpc(response)).toEqual({
            id: 1,
            result: {
                taskId: "task-1",
                nested: { ok: true },
            },
        })
    })

    it("returns a protocol error when a response cannot be serialized", () => {
        const response = serializationErrorResponse(7, new TypeError("Cannot serialize a BigInt"))

        expect(response).toEqual({
            id: 7,
            error: {
                code: "serialization_error",
                message: "Cannot serialize a BigInt",
            },
        })
    })
})
