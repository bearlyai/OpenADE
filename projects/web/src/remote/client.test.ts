import { beforeEach, describe, expect, it } from "vitest"
import { activateRemoteConfig, buildPairingTarget, loadRemoteConfig, loadRemoteConfigs, parsePairingCode, removeRemoteConfig, saveRemoteConfig } from "./client"

beforeEach(() => {
    localStorage.clear()
})

describe("companion remote client pairing", () => {
    it("parses HTTP pairing URLs", () => {
        expect(parsePairingCode("http://100.64.1.2:7823/pair?token=abc123")).toEqual({
            baseUrl: "http://100.64.1.2:7823",
            token: "abc123",
            host: "100.64.1.2:7823",
        })
    })

    it("ignores non-auth metadata in pairing URLs", () => {
        expect(parsePairingCode("http://127.0.0.1:7823/pair?token=abc123&hostId=host-1&expiresAt=2026-05-24T22%3A10%3A41.275Z")).toEqual({
            baseUrl: "http://127.0.0.1:7823",
            token: "abc123",
            host: "127.0.0.1:7823",
            hostId: "host-1",
        })
    })

    it("rejects custom deep-link pairing URLs", () => {
        expect(() => parsePairingCode("openade://pair?baseUrl=http://100.64.1.2:7823&token=abc123")).toThrow(/deep-link/i)
    })

    it("rejects public hosts by default", () => {
        expect(() => buildPairingTarget("https://evil.example", "abc123")).toThrow(/public host/i)
    })

    it("stores multiple paired hosts and switches the active host", () => {
        const first = saveRemoteConfig({ baseUrl: "http://100.64.1.2:7823", token: "token-1", hostId: "host-1" })
        const second = saveRemoteConfig({ baseUrl: "http://100.64.1.3:7823", token: "token-2", hostId: "host-2" })

        expect(loadRemoteConfigs().map((config) => config.id)).toEqual([second.id, first.id])
        expect(loadRemoteConfig()?.id).toBe(second.id)

        expect(activateRemoteConfig(first.id)?.id).toBe(first.id)
        expect(loadRemoteConfig()?.token).toBe("token-1")

        expect(removeRemoteConfig(first.id)?.id).toBe(second.id)
        expect(loadRemoteConfigs()).toHaveLength(1)
    })
})
