import { describe, expect, it } from "vitest"
import { parseOrphanHarnessProcesses, taskIdFromHarnessCommand } from "./orphanHarness"

describe("taskIdFromHarnessCommand", () => {
    it("extracts the task id from a plain harness label", () => {
        expect(taskIdFromHarnessCommand("OpenADE task-2c1e127e603ebb665142189298 --yolo exec resume --json")).toBe(
            "task-2c1e127e603ebb665142189298"
        )
    })

    it("extracts the task id from a HyperPlan label", () => {
        expect(taskIdFromHarnessCommand("OpenADE HyperPlan task-abc123 step-1 --json")).toBe("task-abc123")
    })

    it("ignores commands without an OpenADE label", () => {
        expect(taskIdFromHarnessCommand("/usr/bin/node some/other/process.js")).toBeNull()
        expect(taskIdFromHarnessCommand("codex exec resume -- 019e7154")).toBeNull()
    })

    it("rejects a non-identifier token after the label", () => {
        expect(taskIdFromHarnessCommand("OpenADE --flag value")).toBeNull()
    })
})

describe("parseOrphanHarnessProcesses", () => {
    it("returns only reparented (ppid 1) OpenADE harness processes", () => {
        const stdout = [
            "  101     1 OpenADE task-aaa --yolo exec resume --json",
            "  202   500 OpenADE task-bbb --yolo exec resume --json", // owned by a live main → skip
            "  303     1 OpenADE HyperPlan task-ccc step-2 --json",
            "  404     1 /usr/bin/node unrelated.js", // not a harness → skip
            "  505     1 codex exec resume -- 019e7154", // no OpenADE label → skip
        ].join("\n")

        const orphans = parseOrphanHarnessProcesses(stdout)
        expect(orphans).toEqual([
            { pid: 101, ppid: 1, taskId: "task-aaa", command: "OpenADE task-aaa --yolo exec resume --json" },
            { pid: 303, ppid: 1, taskId: "task-ccc", command: "OpenADE HyperPlan task-ccc step-2 --json" },
        ])
    })

    it("skips malformed and empty lines", () => {
        const stdout = ["", "garbage line without pid", "   ", "  606     1 OpenADE task-ddd exec"].join("\n")
        const orphans = parseOrphanHarnessProcesses(stdout)
        expect(orphans).toHaveLength(1)
        expect(orphans[0].taskId).toBe("task-ddd")
    })
})
