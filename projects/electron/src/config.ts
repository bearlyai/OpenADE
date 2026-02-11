import * as path from "path"

export const isDev = process.env.NODE_ENV === "dev"

// In development, load from the Vite dev server
// In production, load from the bundled web build
export const getMainUrl = (): string => {
    if (isDev) {
        return process.env.OPENADE_DEV_URL || "http://localhost:7000"
    }
    // Production: load from bundled files
    const webPath = path.join(process.resourcesPath, "dist", "web", "index.html")
    return `file://${webPath}`
}

