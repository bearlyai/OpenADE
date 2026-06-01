import { describe, expect, it } from "vitest"
import { parseEditableProcsFile, parseProcsFile, serializeProcsFile } from "./procs"

describe("openade.toml shared parser", () => {
    it("parses process and cron config with comments, literals, and arrays", () => {
        const result = parseProcsFile(
            [
                "# comments outside quoted strings are ignored",
                "[[process]]",
                "name = 'Dev Server'",
                'command = "npm run dev # not a comment" # trailing comment',
                'type = "daemon"',
                'work_dir = "apps/web"',
                'url = "http://localhost:5173/#tasks"',
                "",
                "[[cron]]",
                'name = "Daily"',
                'schedule = "0 9 * * *"',
                'type = "ask"',
                'prompt = "Status?"',
                'images = ["screen#1.png", \'screen-2.png\']',
                "reuse_task = false",
                "",
            ].join("\n"),
            "openade.toml"
        )

        expect("config" in result).toBe(true)
        if ("error" in result) return
        expect(result.config.processes).toEqual([
            {
                id: "openade.toml::Dev Server",
                name: "Dev Server",
                command: "npm run dev # not a comment",
                type: "daemon",
                workDir: "apps/web",
                url: "http://localhost:5173/#tasks",
            },
        ])
        expect(result.config.crons[0]).toMatchObject({
            id: "openade.toml::Daily",
            name: "Daily",
            images: ["screen#1.png", "screen-2.png"],
            reuseTask: false,
        })
    })

    it("serializes editable config back into the same shared parser shape", () => {
        const toml = serializeProcsFile({
            processes: [{ name: "Check", type: "check", command: "npm test", workDir: "packages/app" }],
            crons: [{ name: "Daily", schedule: "0 9 * * *", type: "plan", prompt: "Plan", reuseTask: false }],
        })

        const result = parseEditableProcsFile(toml, "openade.toml")
        expect("error" in result).toBe(false)
        if ("error" in result) return
        expect(result.processes[0]).toMatchObject({ name: "Check", type: "check", workDir: "packages/app" })
        expect(result.crons[0]).toMatchObject({ name: "Daily", reuseTask: false })
    })

    it("rejects malformed TOML table headers and invalid cron isolation", () => {
        expect(parseProcsFile("[[cron]\nname = \"bad\"\n", "openade.toml")).toMatchObject({
            error: { relativePath: "openade.toml", line: 1 },
        })
        expect(
            parseProcsFile(
                '[[cron]]\nname = "bad"\nschedule = "0 9 * * *"\ntype = "ask"\nprompt = "x"\nisolation = "branch"\n',
                "openade.toml"
            )
        ).toMatchObject({ error: { error: "cron.isolation 'branch' is invalid" } })
    })
})
