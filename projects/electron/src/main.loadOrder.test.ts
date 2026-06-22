import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

describe("main startup order", () => {
    const readMainSource = () => {
        const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "main.ts")
        return fs.readFileSync(sourcePath, "utf8")
    }

    it("starts managed OpenADE Core before creating the renderer window", () => {
        const source = readMainSource()
        const coreLoadIndex = source.indexOf("loadRuntimeCore({ isDev })")
        const windowLoadIndex = source.indexOf("loadExecutorWindow()")

        expect(coreLoadIndex).toBeGreaterThanOrEqual(0)
        expect(windowLoadIndex).toBeGreaterThanOrEqual(0)
        expect(coreLoadIndex).toBeLessThan(windowLoadIndex)
    })

    it("defers app relaunch until the active-work quit guard allows shutdown", () => {
        const source = readMainSource()
        const restartHandlerStart = source.indexOf('ipcMain.handle("restart-app"')
        const restartHandlerEnd = source.indexOf('ipcMain.handle("open-url"')
        const restartHandler = source.slice(restartHandlerStart, restartHandlerEnd)

        expect(restartHandlerStart).toBeGreaterThanOrEqual(0)
        expect(restartHandlerEnd).toBeGreaterThan(restartHandlerStart)
        expect(restartHandler).toContain("relaunchAfterQuitAllowed = true")
        expect(restartHandler).toContain("app.quit()")
        expect(restartHandler).not.toContain("app.relaunch()")
        expect(source.indexOf("app.relaunch()")).toBeGreaterThan(source.indexOf("const relaunchIfRequested = () => {"))
        expect(source).toContain("cancelPendingRelaunch()")
    })
})
