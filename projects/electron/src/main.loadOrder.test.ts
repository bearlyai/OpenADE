import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

describe("main startup order", () => {
    it("starts managed OpenADE Core before creating the renderer window", () => {
        const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "main.ts")
        const source = fs.readFileSync(sourcePath, "utf8")
        const coreLoadIndex = source.indexOf("loadRuntimeCore({ isDev })")
        const windowLoadIndex = source.indexOf("loadExecutorWindow()")

        expect(coreLoadIndex).toBeGreaterThanOrEqual(0)
        expect(windowLoadIndex).toBeGreaterThanOrEqual(0)
        expect(coreLoadIndex).toBeLessThan(windowLoadIndex)
    })
})
