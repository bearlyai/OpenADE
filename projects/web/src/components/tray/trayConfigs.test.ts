import { describe, expect, it } from "vitest"
import type { TrayManager } from "../../store/managers/TrayManager"
import { TRAY_CONFIGS } from "./trayConfigs"

describe("tray visibility", () => {
    it("keeps git-backed trays visible while an already set-up task reloads its environment cache", () => {
        const changes = TRAY_CONFIGS.find((config) => config.id === "changes")
        const gitlog = TRAY_CONFIGS.find((config) => config.id === "gitlog")
        const tray = {
            taskModel: {
                environment: null,
                needsEnvironmentSetup: false,
            },
        } as unknown as TrayManager

        expect(changes?.isVisible?.(tray)).toBe(true)
        expect(gitlog?.isVisible?.(tray)).toBe(true)
    })
})
