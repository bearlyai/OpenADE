import { describe, expect, it } from "vitest"
import { getCompanionBindAddresses } from "./network"

describe("companion network binding", () => {
    it("always includes loopback and never uses a wildcard bind", () => {
        const addresses = getCompanionBindAddresses()
        expect(addresses.some((entry) => entry.host === "127.0.0.1")).toBe(true)
        expect(addresses.some((entry) => entry.host === "0.0.0.0")).toBe(false)
    })
})
