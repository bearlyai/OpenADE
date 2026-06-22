/// <reference types="vitest" />
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

const sharedShellOptimizeDeps = [
    "@base-ui-components/react/switch",
    "@floating-ui/react-dom",
    "@tiptap/extension-document",
    "@tiptap/extension-hard-break",
    "@tiptap/extension-history",
    "@tiptap/extension-mention",
    "@tiptap/extension-paragraph",
    "@tiptap/extension-placeholder",
    "@tiptap/extension-text",
    "@tiptap/react",
    "@tiptap/suggestion",
    "jstoxml",
    "mobx",
    "ulid",
]

export default defineConfig({
    plugins: [tailwindcss(), react()],
    server: {
        fs: {
            allow: [__dirname, path.resolve(__dirname, "../web/src")],
        },
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "../web/src"),
        },
    },
    optimizeDeps: {
        include: sharedShellOptimizeDeps,
    },
    test: {
        browser: {
            enabled: true,
            instances: [{ browser: "chromium" }],
            provider: "playwright",
            headless: true,
        },
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        testTimeout: 20000,
    },
})
