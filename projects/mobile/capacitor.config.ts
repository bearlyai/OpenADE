import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
    appId: "org.openade.companion",
    appName: "OpenADE Companion",
    webDir: "dist",
    server: {
        androidScheme: "https",
    },
}

export default config
