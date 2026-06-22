import { afterEach, describe, expect, it, vi } from "vitest"
import { localRuntimeClient } from "../runtime/localRuntimeClient"
import { type CodeModuleCapabilities, initCodeModuleCapabilities, resetCodeModuleCapabilitiesForTests } from "./capabilities"
import { type PlatformInfo, fetchPlatformInfo, resetPlatformInfoForTests } from "./platform"

function createDeferred<T>(): {
    promise: Promise<T>
    resolve: (value: T) => void
} {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve
    })
    return { promise, resolve }
}

describe("host probe electron APIs", () => {
    const previousOpenADEAPI = window.openadeAPI

    afterEach(() => {
        window.openadeAPI = previousOpenADEAPI
        resetCodeModuleCapabilitiesForTests()
        resetPlatformInfoForTests()
        vi.restoreAllMocks()
    })

    it("coalesces concurrent code module capability reads", async () => {
        const deferred = createDeferred<CodeModuleCapabilities>()
        const response: CodeModuleCapabilities = { enabled: true, version: "test-version" }
        const request = vi.spyOn(localRuntimeClient, "request").mockImplementation(<T>(method: string): Promise<T> => {
            expect(method).toBe("host/capabilities/read")
            return deferred.promise as Promise<T>
        })
        window.openadeAPI = { runtime: {} } as unknown as typeof window.openadeAPI

        const first = initCodeModuleCapabilities()
        const second = initCodeModuleCapabilities()

        expect(request).toHaveBeenCalledTimes(1)
        deferred.resolve(response)
        await expect(first).resolves.toEqual(response)
        await expect(second).resolves.toEqual(response)

        await expect(initCodeModuleCapabilities()).resolves.toEqual(response)
        expect(request).toHaveBeenCalledTimes(1)
    })

    it("coalesces concurrent platform info reads", async () => {
        const deferred = createDeferred<PlatformInfo>()
        const response: PlatformInfo = {
            platform: "darwin",
            pathSeparator: "/",
            homeDir: "/Users/test",
            isWindows: false,
            isMac: true,
            isLinux: false,
        }
        const request = vi.spyOn(localRuntimeClient, "request").mockImplementation(<T>(method: string): Promise<T> => {
            expect(method).toBe("host/platform/info")
            return deferred.promise as Promise<T>
        })
        window.openadeAPI = { runtime: {} } as unknown as typeof window.openadeAPI

        const first = fetchPlatformInfo()
        const second = fetchPlatformInfo()

        expect(request).toHaveBeenCalledTimes(1)
        deferred.resolve(response)
        await expect(first).resolves.toEqual(response)
        await expect(second).resolves.toEqual(response)

        await expect(fetchPlatformInfo()).resolves.toEqual(response)
        expect(request).toHaveBeenCalledTimes(1)
    })
})
