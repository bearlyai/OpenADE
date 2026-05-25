import type { CapacitorConfig } from "@capacitor/cli"

declare const process: {
    env: Record<string, string | undefined>
}

const otaUpdateUrl = process.env.OPENADE_OTA_UPDATE_URL?.trim() ?? ""
const otaChannel = process.env.OPENADE_OTA_CHANNEL?.trim() || "production"

const config: CapacitorConfig = {
    appId: "org.openade.companion",
    appName: "OpenADE Companion",
    webDir: "dist",
    server: {
        androidScheme: "https",
    },
    plugins: {
        CapacitorUpdater: {
            autoUpdate: Boolean(otaUpdateUrl),
            updateUrl: otaUpdateUrl,
            statsUrl: "",
            defaultChannel: otaChannel,
            appReadyTimeout: 10000,
            resetWhenUpdate: true,
        },
    },
}

export default config
