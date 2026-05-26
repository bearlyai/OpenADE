import { defineConfig } from "vite"
import { resolve } from "node:path"

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        privacy: resolve(__dirname, "privacy/index.html"),
      },
    },
  },
  server: {
    port: 3000,
  },
})
