import { describe, expect, it, vi } from "vitest"
import { configureLinuxDisplayBackend, resolveLinuxDisplayBackend, type CommandLineSwitches } from "./linuxDisplayBackend"

describe("resolveLinuxDisplayBackend", () => {
    it("leaves non-Linux platforms unchanged", () => {
        expect(
            resolveLinuxDisplayBackend({
                platform: "darwin",
                sessionType: "wayland",
                envOverride: undefined,
                argv: [],
            })
        ).toEqual({ platform: null, reason: "non-linux" })
    })

    it("respects an explicit ozone platform command-line switch", () => {
        expect(
            resolveLinuxDisplayBackend({
                platform: "linux",
                sessionType: "wayland",
                envOverride: "x11",
                argv: ["/opt/OpenADE/openade", "--ozone-platform=wayland"],
            })
        ).toEqual({ platform: null, reason: "explicit-switch" })
    })

    it("does not treat Electron's implicit ozone switch as a user override", () => {
        expect(
            resolveLinuxDisplayBackend({
                platform: "linux",
                sessionType: "wayland",
                envOverride: undefined,
                argv: ["/opt/OpenADE/openade", "--no-sandbox"],
            })
        ).toEqual({ platform: "x11", reason: "wayland-session" })
    })

    it("uses a valid environment override before session defaults", () => {
        expect(
            resolveLinuxDisplayBackend({
                platform: "linux",
                sessionType: "wayland",
                envOverride: "wayland",
                argv: [],
            })
        ).toEqual({ platform: "wayland", reason: "env-override" })
    })

    it("defaults Wayland sessions to X11 for the packaged Linux app", () => {
        expect(
            resolveLinuxDisplayBackend({
                platform: "linux",
                sessionType: "Wayland",
                envOverride: undefined,
                argv: [],
            })
        ).toEqual({ platform: "x11", reason: "wayland-session" })
    })

    it("does not change non-Wayland Linux sessions", () => {
        expect(
            resolveLinuxDisplayBackend({
                platform: "linux",
                sessionType: "x11",
                envOverride: undefined,
                argv: [],
            })
        ).toEqual({ platform: null, reason: "no-op" })
    })

    it("ignores invalid environment overrides", () => {
        expect(
            resolveLinuxDisplayBackend({
                platform: "linux",
                sessionType: "wayland",
                envOverride: "native",
                argv: [],
            })
        ).toEqual({ platform: "x11", reason: "wayland-session" })
    })
})

describe("configureLinuxDisplayBackend", () => {
    it("appends the resolved ozone platform switch", () => {
        const originalSessionType = process.env.XDG_SESSION_TYPE
        const appendSwitch = vi.fn()
        const commandLine: CommandLineSwitches = {
            appendSwitch,
        }

        process.env.XDG_SESSION_TYPE = "wayland"
        try {
            const decision = configureLinuxDisplayBackend(commandLine)
            if (process.platform === "linux") {
                expect(decision).toEqual({ platform: "x11", reason: "wayland-session" })
                expect(appendSwitch).toHaveBeenCalledWith("ozone-platform", "x11")
            } else {
                expect(decision.reason).toBe("non-linux")
                expect(appendSwitch).not.toHaveBeenCalled()
            }
        } finally {
            if (originalSessionType === undefined) {
                delete process.env.XDG_SESSION_TYPE
            } else {
                process.env.XDG_SESSION_TYPE = originalSessionType
            }
        }
    })
})
