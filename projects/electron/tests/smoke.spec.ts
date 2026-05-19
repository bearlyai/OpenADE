import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron, expect, test } from "@playwright/test"

const candidateBinaryPaths = () => {
    const dist = resolve(__dirname, "..", "dist", "electron")
    if (process.platform === "darwin") {
        return [
            `${dist}/mac-universal/OpenADE.app/Contents/MacOS/OpenADE`,
            `${dist}/mac-arm64/OpenADE.app/Contents/MacOS/OpenADE`,
            `${dist}/mac/OpenADE.app/Contents/MacOS/OpenADE`,
        ]
    }
    if (process.platform === "win32") return [`${dist}/win-unpacked/OpenADE.exe`]
    if (process.platform === "linux") return [`${dist}/linux-unpacked/openade`, `${dist}/linux-unpacked/OpenADE`]
    throw new Error(`Unsupported smoke-test platform: ${process.platform}`)
}

const resolveBinary = (): string => {
    const override = process.env.OPENADE_SMOKE_BINARY
    if (override) {
        if (!existsSync(override)) throw new Error(`OPENADE_SMOKE_BINARY does not exist: ${override}`)
        return override
    }
    for (const candidate of candidateBinaryPaths()) {
        if (existsSync(candidate)) return candidate
    }
    throw new Error(
        `Could not find a packaged OpenADE binary. Run electron-builder first, or set OPENADE_SMOKE_BINARY. Looked in: ${candidateBinaryPaths().join(", ")}`
    )
}

test("packaged app launches and loads the bundled web UI", async () => {
    const executablePath = resolveBinary()
    const userDataDir = mkdtempSync(join(tmpdir(), "openade-smoke-"))
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined

    try {
        app = await electron.launch({
            executablePath,
            timeout: 60_000,
            args: [`--user-data-dir=${userDataDir}`],
            env: {
                ...process.env,
                OPENADE_SMOKE_TEST: "1",
            },
        })

        const page = await app.firstWindow({ timeout: 30_000 })
        await page.waitForURL(/dist\/web\/index\.html|web\/index\.html/, { timeout: 30_000 })

        const finalUrl = page.url()
        expect(finalUrl).not.toMatch(/cantLoad/i)
        expect(finalUrl).not.toBe("about:blank")
        await page.waitForFunction(() => "openadeAPI" in window, null, { timeout: 30_000 })
    } finally {
        if (app) {
            await app.close().catch(() => undefined)
        }
        rmSync(userDataDir, { recursive: true, force: true })
    }
})
