import path from "node:path"
import { describe, expect, it } from "vitest"
import {
    buildOpenADEProjectProcessDefinitions,
    openADEProjectProcessInstanceFromRuntimeInfo,
    openADEProjectProcessReconnectResultFromUnknown,
    openADEProjectProcessScopeMatches,
    openADEProjectProcessStartResponseFromUnknown,
    openADEProjectProcessStopResultFromUnknown,
    openADEProjectProcessTimeout,
    resolveOpenADEProjectProcessCwd,
} from "./scopedProjectProcesses"
import type { OpenADEProcsConfig } from "./types"

describe("OpenADE scoped project process helpers", () => {
    const root = path.resolve("/tmp/openade-process-root")

    it("builds process definitions with cwd resolved relative to each openade.toml", () => {
        const config: OpenADEProcsConfig = {
            relativePath: "packages/app/openade.toml",
            processes: [
                {
                    id: "packages/app/openade.toml::dev",
                    name: "dev",
                    command: "npm run dev",
                    workDir: "../api",
                    url: "http://localhost:3000",
                    type: "daemon",
                },
            ],
            crons: [],
        }

        expect(buildOpenADEProjectProcessDefinitions({ root, configs: [config] })).toEqual({
            processes: [
                {
                    id: "packages/app/openade.toml::dev",
                    name: "dev",
                    command: "npm run dev",
                    workDir: "../api",
                    url: "http://localhost:3000",
                    type: "daemon",
                    configPath: "packages/app/openade.toml",
                    cwd: path.join(root, "packages", "api"),
                },
            ],
            errors: [],
        })
    })

    it("rejects config and process cwd escapes", () => {
        expect(() => resolveOpenADEProjectProcessCwd(root, "../openade.toml")).toThrow("process config path is outside the repository")

        const result = buildOpenADEProjectProcessDefinitions({
            root,
            configs: [
                {
                    relativePath: "openade.toml",
                    processes: [
                        {
                            id: "openade.toml::escape",
                            name: "escape",
                            command: "npm run dev",
                            workDir: "../outside",
                            type: "daemon",
                        },
                    ],
                    crons: [],
                },
            ],
        })

        expect(result.processes).toEqual([])
        expect(result.errors).toEqual([{ relativePath: "openade.toml", error: "process cwd is outside the repository" }])
    })

    it("keeps scoped process timeout and scope matching policy shared", () => {
        const daemon = buildOpenADEProjectProcessDefinitions({
            root,
            configs: [
                {
                    relativePath: "openade.toml",
                    processes: [{ id: "openade.toml::dev", name: "dev", command: "npm run dev", type: "daemon" }],
                    crons: [],
                },
            ],
        }).processes[0]
        if (!daemon) throw new Error("daemon process definition was not built")
        const task = { ...daemon, type: "task" as const }

        expect(openADEProjectProcessTimeout(daemon)).toBe(24 * 60 * 60 * 1000)
        expect(openADEProjectProcessTimeout(task)).toBe(10 * 60 * 1000)
        expect(openADEProjectProcessTimeout(task, 48 * 60 * 60 * 1000)).toBe(24 * 60 * 60 * 1000)
        expect(openADEProjectProcessScopeMatches({ repoId: "repo-1", taskId: "task-1", definitionId: "def-1", cwd: root }, { repoId: "repo-1", taskId: "task-1" })).toBe(
            true
        )
        expect(openADEProjectProcessScopeMatches({ repoId: "repo-1", definitionId: "def-1", cwd: root }, { repoId: "repo-1", taskId: "task-1" })).toBe(false)
    })

    it("normalizes runtime process DTOs at the product boundary", () => {
        const registration = { repoId: "repo-1", taskId: "task-1", definitionId: "def-1", cwd: root }
        expect(
            openADEProjectProcessInstanceFromRuntimeInfo(
                { processId: "proc-1", completed: true, exitCode: 0, signal: null, pid: 123 },
                registration
            )
        ).toEqual({
            processId: "proc-1",
            definitionId: "def-1",
            repoId: "repo-1",
            taskId: "task-1",
            cwd: root,
            completed: true,
            exitCode: 0,
            signal: null,
            pid: 123,
        })
        expect(openADEProjectProcessStartResponseFromUnknown({ processId: "proc-1", runtimeId: "runtime-1" })).toEqual({
            processId: "proc-1",
            runtimeId: "runtime-1",
        })
        expect(() => openADEProjectProcessStartResponseFromUnknown({ runtimeId: "runtime-1" })).toThrow("process start response is invalid")
    })

    it("normalizes reconnect and stop responses from runtime process results", () => {
        expect(
            openADEProjectProcessReconnectResultFromUnknown(
                {
                    found: true,
                    completed: true,
                    exitCode: 0,
                    signal: null,
                    output: [
                        { type: "stdout", data: "ok", timestamp: 1 },
                        { type: "bad", data: "skip", timestamp: 2 },
                    ],
                },
                { repoId: "repo-1", taskId: "task-1", processId: "proc-1" }
            )
        ).toMatchObject({ found: true, outputCount: 1, output: [{ type: "stdout", data: "ok", timestamp: 1 }] })

        expect(openADEProjectProcessReconnectResultFromUnknown({ found: false }, { repoId: "repo-1", processId: "proc-1" })).toEqual({
            repoId: "repo-1",
            processId: "proc-1",
            found: false,
            output: [],
        })
        expect(openADEProjectProcessStopResultFromUnknown({ ok: true }, { repoId: "repo-1", taskId: "task-1", processId: "proc-1" })).toEqual({
            repoId: "repo-1",
            taskId: "task-1",
            processId: "proc-1",
            ok: true,
            error: undefined,
        })
    })
})
