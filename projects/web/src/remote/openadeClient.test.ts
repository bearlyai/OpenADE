import { describe, expect, it, vi } from "vitest"
import { RuntimeClientError, type RuntimeClient } from "../../../runtime-client/src"
import { OpenADEClient } from "../../../openade-client/src"
import { remoteErrorMessage } from "./client"

type RuntimeNotification = { method: string; params?: unknown }

function fakeRuntime() {
    return {
        request: vi.fn(async (_method: string) => ({})),
        subscribe: vi.fn((_listener: (notification: RuntimeNotification) => void) => () => {}),
        close: vi.fn(),
    } as unknown as RuntimeClient & {
        request: ReturnType<typeof vi.fn>
        subscribe: ReturnType<typeof vi.fn>
        close: ReturnType<typeof vi.fn>
    }
}

describe("OpenADEClient", () => {
    it("delegates typed OpenADE methods to the runtime client", async () => {
        const runtime = fakeRuntime()
        runtime.request.mockResolvedValueOnce({
            repos: [],
            workingTaskIds: [],
            server: { version: "test", hostName: "host", theme: { setting: "system", className: "code-theme-light" } },
        })
        const client = new OpenADEClient({ runtime, clientName: "test", clientPlatform: "mobile" })

        await client.getSnapshot()
        await client.startTurn(
            {
                repoId: "repo-1",
                type: "ask",
                input: "hello",
            },
            { clientRequestId: "request-1" }
        )
        await client.readProjectGitInfo({ repoId: "repo-1" })
        await client.readProjectGitBranches({ repoId: "repo-1", includeRemote: true })
        await client.readProjectGitSummary({ repoId: "repo-1" })
        await client.readTaskGitScopes({ repoId: "repo-1", taskId: "task-1", includeRemote: true })
        await client.readTaskResourceInventory({ repoId: "repo-1", taskId: "task-1" })
        await client.generateTaskTitle({ repoId: "repo-1", taskId: "task-1", harnessId: "codex" }, { clientRequestId: "request-title" })
        await client.prepareTaskEnvironment({ repoId: "repo-1", taskId: "task-1" }, { clientRequestId: "request-2" })

        expect(runtime.request).toHaveBeenNthCalledWith(1, "openade/snapshot/read", undefined)
        expect(runtime.request).toHaveBeenNthCalledWith(2, "openade/turn/start", {
            repoId: "repo-1",
            type: "ask",
            input: "hello",
            clientRequestId: "request-1",
        })
        expect(runtime.request).toHaveBeenNthCalledWith(3, "openade/project/git/info/read", { repoId: "repo-1" })
        expect(runtime.request).toHaveBeenNthCalledWith(4, "openade/project/git/branches/read", { repoId: "repo-1", includeRemote: true })
        expect(runtime.request).toHaveBeenNthCalledWith(5, "openade/project/git/summary/read", { repoId: "repo-1" })
        expect(runtime.request).toHaveBeenNthCalledWith(6, "openade/task/git/scopes/read", { repoId: "repo-1", taskId: "task-1", includeRemote: true })
        expect(runtime.request).toHaveBeenNthCalledWith(7, "openade/task/resourceInventory/read", { repoId: "repo-1", taskId: "task-1" })
        expect(runtime.request).toHaveBeenNthCalledWith(8, "openade/task/title/generate", {
            repoId: "repo-1",
            taskId: "task-1",
            harnessId: "codex",
            clientRequestId: "request-title",
        })
        expect(runtime.request).toHaveBeenNthCalledWith(9, "openade/task/environment/prepare", {
            repoId: "repo-1",
            taskId: "task-1",
            clientRequestId: "request-2",
        })
    })

    it("filters subscriptions to OpenADE-relevant notifications", () => {
        const runtime = fakeRuntime()
        let listener: (notification: RuntimeNotification) => void = () => {
            throw new Error("not subscribed")
        }
        runtime.subscribe.mockImplementation((next: (notification: RuntimeNotification) => void) => {
            listener = next
            return () => {}
        })
        const onEvent = vi.fn()
        const client = new OpenADEClient({ runtime })

        client.subscribeToChanges(onEvent)
        listener({ method: "process/output" })
        listener({ method: "openade/task/updated" })
        listener({ method: "runtime/updated" })
        listener({ method: "connection/lagged" })

        expect(onEvent).toHaveBeenCalledTimes(3)
    })

    it("adds clientRequestId to non-turn OpenADE mutations by default", async () => {
        const runtime = fakeRuntime()
        const client = new OpenADEClient({ runtime })

        await client.createComment({
            taskId: "task-1",
            content: "note",
            source: { type: "file" },
            selectedText: { text: "x", linesBefore: "", linesAfter: "" },
            author: { id: "user-1", email: "user@example.com" },
        })

        expect(runtime.request).toHaveBeenNthCalledWith(1, "openade/comment/create", {
            taskId: "task-1",
            content: "note",
            source: { type: "file" },
            selectedText: { text: "x", linesBefore: "", linesAfter: "" },
            author: { id: "user-1", email: "user@example.com" },
            clientRequestId: expect.any(String),
        })
    })

    it("maps unsupported protocol errors to a clear desktop-update message", () => {
        const error = new RuntimeClientError("unsupported_protocol_version", "client protocol 1 is not compatible", {
            clientProtocolVersion: 1,
            serverProtocolVersion: 2,
        })

        expect(remoteErrorMessage(error, "fallback")).toBe("Desktop update required. Update OpenADE on your desktop, then reconnect this app.")
    })
})
