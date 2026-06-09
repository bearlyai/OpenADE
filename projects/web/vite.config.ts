/// <reference types="vitest" />
import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import tsconfigPaths from "vite-tsconfig-paths"
import svgr from "vite-plugin-svgr"
// @ts-ignore
import tailwindcss from "@tailwindcss/vite"

const yjsBundlePath = fileURLToPath(new URL("./node_modules/yjs/dist/yjs.mjs", import.meta.url))

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
    worker: {
        format: "es",
    },
    resolve: {
        alias: {
            yjs: yjsBundlePath,
        },
        dedupe: ["yjs"],
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
