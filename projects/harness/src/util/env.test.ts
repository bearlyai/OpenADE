import { describe, it, expect, afterEach } from "vitest"
import { detectShellEnvironment, clearShellEnvironmentCache } from "./env.js"

describe("detectShellEnvironment", () => {
    afterEach(() => {
        clearShellEnvironmentCache()
    })

    it("returns an object with PATH key", async () => {
        const env = await detectShellEnvironment()
        expect(env).toHaveProperty("PATH")
        expect(typeof env.PATH).toBe("string")
        expect(env.PATH.length).toBeGreaterThan(0)
    })

    it("HOME is set correctly", async () => {
        const env = await detectShellEnvironment()
        expect(env).toHaveProperty("HOME")
        expect(env.HOME).toBeTruthy()
    })

    it("caches the result across calls", async () => {
        const env1 = await detectShellEnvironment()
        const env2 = await detectShellEnvironment()
        expect(env1).toBe(env2) // Same reference
    })

    it("cache can be cleared", async () => {
        const env1 = await detectShellEnvironment()
        clearShellEnvironmentCache()
        const env2 = await detectShellEnvironment()
        // Same content but different reference
        expect(env1).not.toBe(env2)
        expect(env1.PATH).toEqual(env2.PATH)
    })

    it("handles invalid shell gracefully (returns fallback)", async () => {
        const env = await detectShellEnvironment("/bin/nonexistent-shell-xyz")
        // Should return fallback (current process.env)
        expect(env).toHaveProperty("PATH")
    })
})
