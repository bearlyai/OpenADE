import { describe, expect, it } from "vitest"
import { envFlag } from "./envFlag"

describe("envFlag", () => {
    it("accepts common true values case-insensitively with surrounding whitespace", () => {
        for (const value of ["1", "true", "TRUE", " yes ", "On"]) {
            expect(envFlag(value)).toBe(true)
        }
    })

    it("uses the fallback for missing or blank values", () => {
        expect(envFlag(undefined)).toBe(false)
        expect(envFlag(undefined, true)).toBe(true)
        expect(envFlag("   ", true)).toBe(true)
    })

    it("treats other values as false", () => {
        for (const value of ["0", "false", "no", "off", "maybe"]) {
            expect(envFlag(value, true)).toBe(false)
        }
    })
})
