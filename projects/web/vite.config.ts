/// <reference types="vitest" />
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tsconfigPaths from "vite-tsconfig-paths"
import svgr from "vite-plugin-svgr"
// @ts-ignore
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
    base: "./", // Relative paths for file:// compatibility in Electron
    server: {
        port: 7000,
        hmr: false,
    },
    build: {
        outDir: "./dist",
        sourcemap: true,
    },
    plugins: [
        tailwindcss(),
        tsconfigPaths({ loose: true }),
        react(),
        svgr({
            svgrOptions: {
                icon: true,
            },
        }),
    ],
    test: {
        browser: {
            enabled: true,
            instances: [{ browser: "chromium" }],
            provider: "playwright",
            headless: true,
        },
        testTimeout: 20000,
        maxConcurrency: 10,
        include: ["src/**/*.test.ts"],
        exclude: ["node_modules/**"],
    },
})
