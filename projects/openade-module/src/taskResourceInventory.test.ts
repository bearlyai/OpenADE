import { describe, expect, it } from "vitest"
import { buildOpenADETaskResourceInventory } from "./taskResourceInventory"
import type { OpenADETask } from "./types"

describe("buildOpenADETaskResourceInventory", () => {
    it("collects unique task-owned snapshots, images, sessions, and worktree metadata", () => {
        const task: OpenADETask = {
            id: "task-1",
            repoId: "repo-1",
            slug: "task-one",
            title: "Inventory task",
            description: "Delete me",
            isolationStrategy: { type: "worktree", sourceBranch: "main" },
            sessionIds: { main: "session-from-metadata" },
            deviceEnvironments: [],
            events: [
                {
                    id: "event-1",
                    type: "action",
                    execution: { harnessId: "codex", sessionId: "session-from-event" },
                    images: [
                        { id: "image-1", ext: "png" },
                        { id: "image-1", ext: "png" },
                    ],
                    hyperplanSubExecutions: [{ harnessId: "claude-code", sessionId: "session-from-sub-execution" }],
                },
                { id: "snapshot-1", type: "snapshot", patchFileId: "patch-1" },
                { id: "snapshot-2", type: "snapshot", patchFileId: "patch-1" },
            ],
            comments: [],
        }

        expect(buildOpenADETaskResourceInventory({ task, isRunning: true, branchMerged: false })).toEqual({
            repoId: "repo-1",
            taskId: "task-1",
            taskTitle: "Inventory task",
            isRunning: true,
            snapshotIds: ["patch-1"],
            images: [{ id: "image-1", ext: "png" }],
            sessions: [
                { sessionId: "session-from-event", harnessId: "codex" },
                { sessionId: "session-from-sub-execution", harnessId: "claude-code" },
                { sessionId: "session-from-metadata", harnessId: "claude-code" },
            ],
            worktree: {
                slug: "task-one",
                branchName: "openade/task-one",
                sourceBranch: "main",
                branchMerged: false,
            },
        })
    })
})
