import { afterEach, describe, expect, it, vi } from "vitest"
import { restartApp } from "./app"

describe("app electron API", () => {
    const previousOpenADEAPI = window.openadeAPI

    afterEach(() => {
        window.openadeAPI = previousOpenADEAPI
    })

    it("restarts through the trusted preload app bridge when available", async () => {
        const restart = vi.fn(async () => undefined)
        window.openadeAPI = {
            app: {
                restart,
            },
        } as unknown as typeof window.openadeAPI

        await restartApp()

        expect(restart).toHaveBeenCalledTimes(1)
    })

    it("is a no-op outside the Electron preload bridge", async () => {
        window.openadeAPI = undefined

        await expect(restartApp()).resolves.toBeUndefined()
    })
})
