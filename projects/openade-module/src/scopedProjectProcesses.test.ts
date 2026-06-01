import path from "node:path"
import { describe, expect, it } from "vitest"
import { buildOpenADEProjectProcessDefinitions, resolveOpenADEProjectProcessCwd } from "./scopedProjectProcesses"
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
})
