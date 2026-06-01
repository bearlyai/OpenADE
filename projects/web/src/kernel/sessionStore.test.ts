import { beforeEach, describe, expect, it } from "vitest"
import { KernelSessionConfigStore, parseKernelSessionConfigStore } from "./sessionStore"

const storage = new Map<string, string>()
const storageKey = "kernel-session-configs"

const storageAdapter = {
    getItem(key: string): string | null {
        return storage.get(key) ?? null
    },
    setItem(key: string, value: string): void {
        storage.set(key, value)
    },
    removeItem(key: string): void {
        storage.delete(key)
    },
}

describe("KernelSessionConfigStore", () => {
    beforeEach(() => {
        storage.clear()
    })

    it("stores multiple kernel sessions, switches active sessions, and preserves v2 shape", () => {
        const changes: Array<string | null> = []
        const store = new KernelSessionConfigStore({ storage: storageAdapter, storageKey, onChange: (value) => changes.push(value) })

        const first = store.save({ baseUrl: "http://100.64.1.2:7823/pair?token=ignored", token: "token-1", hostId: "host-1" })
        const second = store.save({ baseUrl: "http://100.64.1.3:7823", token: "token-2", hostId: "host-2" })

        expect(store.loadConfigs().map((config) => config.id)).toEqual([second.id, first.id])
        expect(store.loadActive()?.id).toBe(second.id)

        expect(store.activate(first.id)?.id).toBe(first.id)
        expect(store.loadActive()?.token).toBe("token-1")

        expect(store.remove(first.id)?.id).toBe(second.id)
        expect(store.loadConfigs()).toHaveLength(1)

        const raw = storageAdapter.getItem(storageKey)
        expect(raw).not.toBeNull()
        const parsed = parseKernelSessionConfigStore(raw)
        expect(parsed.version).toBe(2)
        expect(parsed.activeId).toBe(second.id)
        expect(changes).toHaveLength(4)

        store.clear()
        expect(store.loadConfigs()).toEqual([])
        expect(changes.at(-1)).toBeNull()
    })

    it("normalizes old single-session storage and drops invalid sessions", () => {
        expect(
            parseKernelSessionConfigStore(
                JSON.stringify({
                    baseUrl: "http://127.0.0.1:7823/pair?token=ignored",
                    token: "legacy-token",
                    hostId: "legacy-host",
                })
            )
        ).toEqual(
            expect.objectContaining({
                activeId: "legacy-host",
                configs: [expect.objectContaining({ id: "legacy-host", baseUrl: "http://127.0.0.1:7823", token: "legacy-token" })],
            })
        )

        expect(
            parseKernelSessionConfigStore(
                JSON.stringify({
                    activeId: "missing",
                    configs: [
                        { baseUrl: "https://public.example", token: "denied" },
                        { baseUrl: "http://host.local:7823", token: "ok", id: "local" },
                    ],
                })
            )
        ).toEqual(expect.objectContaining({ activeId: "local", configs: [expect.objectContaining({ id: "local" })] }))
    })
})
