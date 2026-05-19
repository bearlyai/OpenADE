import { defineConfig } from "@playwright/test"

// Smoke tests run against the packaged Electron binary produced by electron-builder.
// Kept separate from the vitest unit tests under src/: different runner, different
// purpose (post-package boot verification vs. logic unit tests).
export default defineConfig({
    testDir: "./tests",
    testMatch: /.*\.spec\.ts$/,
    timeout: 120_000,
    expect: { timeout: 30_000 },
    retries: 0,
    workers: 1,
    reporter: process.env.CI ? [["list"], ["github"]] : "list",
})
