import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        watch: false,
        include: ["src/**/*.integration.test.ts"],
        pool: "forks",
        isolate: false,
        testTimeout: 120_000,
        hookTimeout: 30_000,
        sequence: { concurrent: false },
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
})
