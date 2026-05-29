import { describe, expect, it, vi } from "vitest"
import { beginRemoteSubmission, finishRemoteSubmission } from "./submission"

describe("remote submission lock", () => {
    it("allows one in-flight submit and rejects duplicate taps until completion", () => {
        const lock = { current: false }
        const setSubmitting = vi.fn()
        const setLoading = vi.fn()
        const setters = { setSubmitting, setLoading }

        expect(beginRemoteSubmission(lock, setters)).toBe(true)
        expect(beginRemoteSubmission(lock, setters)).toBe(false)
        expect(setSubmitting).toHaveBeenCalledTimes(1)
        expect(setLoading).toHaveBeenCalledTimes(1)
        expect(setSubmitting).toHaveBeenCalledWith(true)
        expect(setLoading).toHaveBeenCalledWith(true)

        finishRemoteSubmission(lock, setters)
        expect(lock.current).toBe(false)
        expect(setSubmitting).toHaveBeenLastCalledWith(false)
        expect(setLoading).toHaveBeenLastCalledWith(false)

        expect(beginRemoteSubmission(lock, setters)).toBe(true)
    })
})
