import { defineConfig } from "vite"
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
    build: {
        outDir: "dist",
    },
    define: {
        "import.meta.env.VITE_OPENADE_ENABLE_DESKTOP_FALLBACK_CHUNKS": JSON.stringify("false"),
    },
    optimizeDeps: {
        include: sharedShellOptimizeDeps,
    },
})
