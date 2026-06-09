import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import {
    isOpenADECoreLegacyYjsMigrationAccepted,
    legacyYjsMigrationAcceptanceFilePath,
    markOpenADECoreLegacyYjsMigrationAccepted,
    readOpenADECoreLegacyYjsMigrationAcceptance,
} from "./openadeCoreMigration"
import { decideManagedOpenADECoreLaunch, managedOpenADECoreLegacyYjsDocumentsExist, planManagedOpenADECoreLaunch } from "./runtimeCore"

describe("managed OpenADE Core launch planning", () => {
    const noPackagedCore = () => null
    const packagedCore = () => "/Applications/OpenADE.app/Contents/Resources/dist/openade-core/openade-core"

    test("does not auto-launch in development or without a packaged Core binary", () => {
        expect(planManagedOpenADECoreLaunch({}, "/repo", () => "token", packagedCore, { isDev: true })).toBeNull()
        expect(
            planManagedOpenADECoreLaunch({}, "/repo", () => "token", noPackagedCore, {
                isDev: false,
                legacyYjsDocumentsExist: () => false,
            })
        ).toBeNull()
    })

    test("auto-launches packaged Core for clean production installs", () => {
        const plan = planManagedOpenADECoreLaunch({}, "/app", () => "token", packagedCore, {
            isDev: false,
            legacyYjsDocumentsExist: () => false,
        })

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.command).toBe(packagedCore())
        expect(plan.args).toEqual([])
        expect(plan.env.OPENADE_USE_OPENADE_CORE).toBe("1")
        expect(plan.env.OPENADE_CORE_MANAGED).toBe("1")
        expect(plan.runtimeEndpoint).toEqual({
            url: "ws://127.0.0.1:37376/v1/runtime",
            token: "token",
        })
    })

    test("does not auto-launch over existing legacy Yjs documents", () => {
        const plan = planManagedOpenADECoreLaunch({}, "/app", () => "token", packagedCore, {
            isDev: false,
            legacyYjsDocumentsExist: () => true,
        })

        expect(plan).toBeNull()
    })

    test("auto-launches packaged Core over legacy Yjs documents after accepted import", () => {
        const decision = decideManagedOpenADECoreLaunch({}, "/app", () => "token", packagedCore, {
            isDev: false,
            legacyYjsDocumentsExist: () => true,
            legacyYjsMigrationAccepted: () => true,
        })

        expect(decision).toMatchObject({
            reason: "legacy-yjs-migration-accepted",
            automatic: true,
            legacyYjsDocumentsPresent: true,
            legacyYjsMigrationAccepted: true,
        })
        expect(decision.plan?.command).toBe(packagedCore())
    })

    test("does not launch when Core is explicitly disabled", () => {
        expect(
            planManagedOpenADECoreLaunch(
                {
                    OPENADE_DISABLE_OPENADE_CORE: "1",
                    OPENADE_CORE_MANAGED: "1",
                },
                "/repo",
                () => "token",
                packagedCore,
                { isDev: false, legacyYjsDocumentsExist: () => false }
            )
        ).toBeNull()
    })

    test("does not launch when an external Core endpoint is already configured", () => {
        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_USE_OPENADE_CORE: "1",
                OPENADE_CORE_MANAGED: "1",
                OPENADE_CORE_RUNTIME_URL: "ws://127.0.0.1:9000/v1/runtime",
            },
            "/repo",
            () => "token",
            noPackagedCore,
            { isDev: false, legacyYjsDocumentsExist: () => false }
        )

        expect(plan).toBeNull()
    })

    test("builds an explicit managed dev Core launch with a preload-compatible endpoint", () => {
        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_CORE_MANAGED: "1",
            },
            "/repo/projects/electron",
            () => "generated-token",
            noPackagedCore,
            { isDev: true, legacyYjsDocumentsExist: () => true }
        )

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.command).toBe("go")
        expect(plan.args).toEqual(["run", "../openade-core/cmd/openade-core"])
        expect(plan.cwd).toBe("/repo/projects/electron")
        expect(plan.runtimeEndpoint).toEqual({
            url: "ws://127.0.0.1:37376/v1/runtime",
            token: "generated-token",
        })
        expect(plan.env.OPENADE_CORE_RUNTIME_URL).toBe(plan.runtimeEndpoint.url)
        expect(plan.env.OPENADE_CORE_TOKEN).toBe("generated-token")
        expect(plan.env.OPENADE_USE_OPENADE_CORE).toBe("1")
        expect(plan.env.OPENADE_CORE_MANAGED).toBe("1")
        expect(plan.env.OPENADE_CORE_PORT).toBe("37376")
        expect(plan.env.OPENADE_CORE_RUNTIME_PATH).toBe("/v1/runtime")
    })

    test("treats OPENADE_USE_OPENADE_CORE without an external endpoint as managed opt-in", () => {
        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_USE_OPENADE_CORE: "1",
            },
            "/repo/projects/electron",
            () => "generated-token",
            noPackagedCore,
            { isDev: true, legacyYjsDocumentsExist: () => true }
        )

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.command).toBe("go")
        expect(plan.args).toEqual(["run", "../openade-core/cmd/openade-core"])
        expect(plan.env.OPENADE_CORE_MANAGED).toBe("1")
    })

    test("honors explicit command, token, host, port, and runtime path", () => {
        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_USE_OPENADE_CORE: "yes",
                OPENADE_CORE_MANAGED: "on",
                OPENADE_CORE_COMMAND: `["/bin/openade-core","--flag"]`,
                OPENADE_CORE_TOKEN: "existing-token",
                OPENADE_CORE_HOST: "localhost",
                OPENADE_CORE_PORT: "4455",
                OPENADE_CORE_RUNTIME_PATH: "runtime",
            },
            "/cwd",
            () => "unused-token",
            noPackagedCore,
            { isDev: true, legacyYjsDocumentsExist: () => true }
        )

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.command).toBe("/bin/openade-core")
        expect(plan.args).toEqual(["--flag"])
        expect(plan.runtimeEndpoint).toEqual({
            url: "ws://localhost:4455/runtime",
            token: "existing-token",
        })
        expect(plan.env.OPENADE_CORE_RUNTIME_PATH).toBe("/runtime")
    })

    test("rejects invalid command JSON and normalizes invalid ports", () => {
        expect(
            planManagedOpenADECoreLaunch(
                {
                    OPENADE_USE_OPENADE_CORE: "1",
                    OPENADE_CORE_MANAGED: "1",
                    OPENADE_CORE_COMMAND: `[""]`,
                },
                "/cwd",
                () => "token",
                noPackagedCore,
                { isDev: true, legacyYjsDocumentsExist: () => true }
            )
        ).toBeNull()

        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_USE_OPENADE_CORE: "1",
                OPENADE_CORE_MANAGED: "1",
                OPENADE_CORE_PORT: "0",
            },
            "/cwd",
            () => "token",
            noPackagedCore,
            { isDev: true, legacyYjsDocumentsExist: () => true }
        )

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.env.OPENADE_CORE_PORT).toBe("37376")
        expect(plan.runtimeEndpoint.url).toBe("ws://127.0.0.1:37376/v1/runtime")
    })

    test("prefers the packaged Core binary when no command override is configured", () => {
        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_USE_OPENADE_CORE: "1",
                OPENADE_CORE_MANAGED: "1",
            },
            "/app",
            () => "token",
            packagedCore,
            { isDev: true, legacyYjsDocumentsExist: () => true }
        )

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.command).toBe(packagedCore())
        expect(plan.args).toEqual([])
    })

    test("keeps explicit command override ahead of the packaged Core binary", () => {
        const plan = planManagedOpenADECoreLaunch(
            {
                OPENADE_USE_OPENADE_CORE: "1",
                OPENADE_CORE_MANAGED: "1",
                OPENADE_CORE_COMMAND: "/custom/openade-core",
            },
            "/app",
            () => "token",
            () => "/packaged/openade-core",
            { isDev: true, legacyYjsDocumentsExist: () => true }
        )

        expect(plan).not.toBeNull()
        if (!plan) throw new Error("expected launch plan")
        expect(plan.command).toBe("/custom/openade-core")
        expect(plan.args).toEqual([])
    })

    test("reports sanitized rollout reasons for renderer telemetry and settings", () => {
        expect(decideManagedOpenADECoreLaunch({ OPENADE_DISABLE_OPENADE_CORE: "1" }, "/repo", () => "token", packagedCore).reason).toBe("disabled")
        expect(decideManagedOpenADECoreLaunch({ OPENADE_CORE_RUNTIME_URL: "ws://127.0.0.1:9000/v1/runtime" }, "/repo", () => "token", packagedCore).reason).toBe(
            "external-endpoint"
        )
        expect(decideManagedOpenADECoreLaunch({}, "/repo", () => "token", packagedCore, { isDev: true }).reason).toBe("development-default-off")

        const legacyDecision = decideManagedOpenADECoreLaunch({}, "/repo", () => "token", packagedCore, {
            isDev: false,
            legacyYjsDocumentsExist: () => true,
        })
        expect(legacyDecision).toMatchObject({
            plan: null,
            reason: "legacy-yjs-documents",
            automatic: false,
            legacyYjsDocumentsPresent: true,
            legacyYjsMigrationAccepted: false,
        })

        const automaticDecision = decideManagedOpenADECoreLaunch({}, "/repo", () => "token", packagedCore, {
            isDev: false,
            legacyYjsDocumentsExist: () => false,
        })
        expect(automaticDecision.reason).toBe("managed-core")
        expect(automaticDecision.automatic).toBe(true)
        expect(automaticDecision.plan?.command).toBe(packagedCore())
    })
})

describe("managed OpenADE Core legacy Yjs migration acceptance", () => {
    test("persists a narrow accepted-import marker under the OpenADE data directory", () => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-core-migration-home-"))
        try {
            expect(isOpenADECoreLegacyYjsMigrationAccepted(homeDir)).toBe(false)
            const accepted = markOpenADECoreLegacyYjsMigrationAccepted({
                homeDir,
                acceptedAt: "2026-06-09T12:00:00.000Z",
                source: "test",
            })

            expect(legacyYjsMigrationAcceptanceFilePath(homeDir)).toBe(
                path.join(homeDir, ".openade", "data", "core", "legacy-yjs-import-accepted.json")
            )
            expect(accepted).toEqual({
                version: 1,
                acceptedAt: "2026-06-09T12:00:00.000Z",
                source: "test",
            })
            expect(readOpenADECoreLegacyYjsMigrationAcceptance(homeDir)).toEqual(accepted)
            expect(isOpenADECoreLegacyYjsMigrationAccepted(homeDir)).toBe(true)
        } finally {
            fs.rmSync(homeDir, { recursive: true, force: true })
        }
    })

    test("fails closed for malformed accepted-import markers", () => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-core-migration-home-"))
        try {
            const markerPath = legacyYjsMigrationAcceptanceFilePath(homeDir)
            fs.mkdirSync(path.dirname(markerPath), { recursive: true })
            fs.writeFileSync(markerPath, JSON.stringify({ version: 2, acceptedAt: "2026-06-09T12:00:00.000Z", source: "test" }))

            expect(readOpenADECoreLegacyYjsMigrationAcceptance(homeDir)).toBeNull()
            expect(isOpenADECoreLegacyYjsMigrationAccepted(homeDir)).toBe(false)
        } finally {
            fs.rmSync(homeDir, { recursive: true, force: true })
        }
    })
})

describe("managed OpenADE Core legacy Yjs detection", () => {
    test("detects existing default and nested legacy Yjs documents", () => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-yjs-home-"))
        try {
            expect(managedOpenADECoreLegacyYjsDocumentsExist({}, homeDir)).toBe(false)

            const primaryYjsDir = path.join(homeDir, ".openade", "data", "yjs")
            fs.mkdirSync(primaryYjsDir, { recursive: true })
            fs.writeFileSync(path.join(primaryYjsDir, "code_repos"), "data")
            expect(managedOpenADECoreLegacyYjsDocumentsExist({}, homeDir)).toBe(true)

            fs.rmSync(primaryYjsDir, { recursive: true, force: true })
            const nestedYjsDir = path.join(homeDir, ".openade", ".openade", "data", "yjs")
            fs.mkdirSync(nestedYjsDir, { recursive: true })
            fs.writeFileSync(path.join(nestedYjsDir, "code_personal_settings"), "data")
            expect(managedOpenADECoreLegacyYjsDocumentsExist({}, homeDir)).toBe(true)
        } finally {
            fs.rmSync(homeDir, { recursive: true, force: true })
        }
    })

    test("uses OPENADE_YJS_STORAGE_DIR when configured", () => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-yjs-home-"))
        const configuredDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-yjs-configured-"))
        try {
            const primaryYjsDir = path.join(homeDir, ".openade", "data", "yjs")
            fs.mkdirSync(primaryYjsDir, { recursive: true })
            fs.writeFileSync(path.join(primaryYjsDir, "code_repos"), "data")

            expect(managedOpenADECoreLegacyYjsDocumentsExist({ OPENADE_YJS_STORAGE_DIR: configuredDir }, homeDir)).toBe(false)

            fs.writeFileSync(path.join(configuredDir, "code_repos"), "data")
            expect(managedOpenADECoreLegacyYjsDocumentsExist({ OPENADE_YJS_STORAGE_DIR: configuredDir }, homeDir)).toBe(true)
        } finally {
            fs.rmSync(homeDir, { recursive: true, force: true })
            fs.rmSync(configuredDir, { recursive: true, force: true })
        }
    })
})
