import { describe, expect, it } from "vitest"
import type { RemoteTask } from "../../../shared/companion/src"
import { taskMessages } from "./messagePresentation"

function remoteTask(events: unknown[]): RemoteTask {
    return {
        id: "task-1",
        repoId: "repo-1",
        slug: "task-1",
        title: "Task",
        description: "",
        events,
        comments: [],
        deviceEnvironments: [],
    }
}

describe("taskMessages", () => {
    it("renders Codex assistant text and compact activity breadcrumbs", () => {
        const messages = taskMessages(
            remoteTask([
                {
                    id: "event-1",
                    type: "action",
                    status: "completed",
                    source: { type: "do", userLabel: "Do" },
                    userInput: "Check the tests",
                    execution: {
                        harnessId: "codex",
                        executionId: "exec-1",
                        events: [
                            {
                                id: "msg-1",
                                direction: "execution",
                                type: "raw_message",
                                executionId: "exec-1",
                                harnessId: "codex",
                                message: {
                                    type: "item.completed",
                                    item: {
                                        id: "agent-1",
                                        type: "agent_message",
                                        text: "The tests are passing.",
                                    },
                                },
                            },
                            {
                                id: "msg-2",
                                direction: "execution",
                                type: "raw_message",
                                executionId: "exec-1",
                                harnessId: "codex",
                                message: {
                                    type: "item.completed",
                                    item: {
                                        id: "cmd-1",
                                        type: "command_execution",
                                        command: "npm test",
                                        aggregated_output: "ok",
                                        exit_code: 0,
                                        status: "completed",
                                    },
                                },
                            },
                        ],
                    },
                },
            ])
        )

        expect(messages).toMatchObject([
            { kind: "user", body: "Check the tests" },
            { kind: "assistant", body: "The tests are passing." },
            {
                kind: "activity",
                activity: [
                    {
                        label: "Shell",
                        detail: "npm test",
                    },
                ],
            },
        ])
    })
})
