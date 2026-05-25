import type { CapacitorConfig } from "@capacitor/cli"

declare const process: {
    env: Record<string, string | undefined>
}

const otaChannel = process.env.OPENADE_OTA_CHANNEL?.trim() || "production"

const config: CapacitorConfig = {
    appId: "ai.openade.app",
    appName: "OpenADE",
    webDir: "dist",
    server: {
        androidScheme: "https",
    },
    plugins: {
        CapacitorUpdater: {
            autoUpdate: false,
            statsUrl: "",
            defaultChannel: otaChannel,
            appReadyTimeout: 10000,
            resetWhenUpdate: true,
        },
    },
}

export default config
