import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        watch: false,
        fileParallelism: false,
        setupFiles: [],
        include: ["src/**/*.test.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html"],
            exclude: ["node_modules/", "src/**/*.test.ts", "dist/"],
        },
        testTimeout: 30000,
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            yjs: path.resolve(__dirname, "./node_modules/yjs/src/index.js"),
        },
    },
})
