import { describe, expect, it } from "vitest"
import {
    assertOpenADETaskTerminalId,
    decodeOpenADETaskTerminalOutputChunk,
    encodeOpenADETaskTerminalInput,
    openADETaskTerminalId,
    openADETaskTerminalOutputChunkFromUnknown,
} from "./scopedTaskTerminal"

describe("OpenADE scoped task terminal helpers", () => {
    it("derives stable terminal ids from repo and task ids", () => {
        expect(openADETaskTerminalId("repo-1", "task-1")).toBe("openade-task-terminal-74f38310727a4eebc756c2b6")
        expect(openADETaskTerminalId("repo-1", "task-1")).not.toBe(openADETaskTerminalId("repo-2", "task-1"))
        expect(() =>
            assertOpenADETaskTerminalId({
                repoId: "repo-1",
                taskId: "task-1",
                terminalId: "task-1",
            })
        ).toThrow("terminalId is invalid")
    })

    it("keeps product terminal data plain text around the raw base64 PTY boundary", () => {
        const encoded = encodeOpenADETaskTerminalInput("npm test\n")
        expect(encoded).toBe("bnBtIHRlc3QK")
        expect(decodeOpenADETaskTerminalOutputChunk({ data: encoded, timestamp: 123 })).toEqual({
            data: "npm test\n",
            timestamp: 123,
        })
        expect(openADETaskTerminalOutputChunkFromUnknown({ data: encoded })).toEqual({ data: "npm test\n", timestamp: undefined })
        expect(openADETaskTerminalOutputChunkFromUnknown("already decoded")).toEqual({ data: "already decoded" })
        expect(openADETaskTerminalOutputChunkFromUnknown({ data: 123 })).toBeNull()
    })
})
