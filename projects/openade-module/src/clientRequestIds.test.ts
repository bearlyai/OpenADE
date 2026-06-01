import { describe, expect, it } from "vitest"
import { openADEQueuedTurnIdForClientRequest, openADETaskIdForClientRequest } from "./clientRequestIds"

describe("OpenADE client request id helpers", () => {
    it("keeps stable task ids compatible with existing host adapters", () => {
        expect(openADETaskIdForClientRequest("repo-1", "request-1")).toBe("task-42271778639f6147f5a66694bc")
        expect(openADETaskIdForClientRequest("repo-1", "request-1")).toBe(openADETaskIdForClientRequest("repo-1", "request-1"))
        expect(openADETaskIdForClientRequest("repo-2", "request-1")).not.toBe(openADETaskIdForClientRequest("repo-1", "request-1"))
        expect(openADETaskIdForClientRequest("repo-1", undefined)).toBeUndefined()
    })

    it("keeps stable queued turn ids scoped to the task", () => {
        expect(openADEQueuedTurnIdForClientRequest("task-1", "request-1")).toBe("queued-057f079903fcd046085c8e8b9e")
        expect(openADEQueuedTurnIdForClientRequest("task-2", "request-1")).not.toBe(openADEQueuedTurnIdForClientRequest("task-1", "request-1"))
        expect(openADEQueuedTurnIdForClientRequest("task-1", undefined)).toBeUndefined()
    })
})
