#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(packageRoot, "../..")
const esbuildBin = path.join(repoRoot, "projects/electron/node_modules/esbuild/bin/esbuild")
const yjsEntry = path.join(repoRoot, "projects/electron/node_modules/yjs/dist/yjs.mjs")
const entry = path.join(packageRoot, "src/yjsImportCoreCli.ts")
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openade-yjs-import-core-cli-"))
const outfile = path.join(tempDir, "yjsImportCoreCli.mjs")

try {
    const build = spawnSync(
        process.execPath,
        [
            esbuildBin,
            entry,
            "--bundle",
            "--platform=node",
            "--format=esm",
            `--alias:yjs=${yjsEntry}`,
            `--outfile=${outfile}`,
            "--log-level=warning",
        ],
        { stdio: "inherit" }
    )
    if (build.status !== 0) process.exit(build.status ?? 1)
    const run = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: "inherit" })
    process.exit(run.status ?? 1)
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
}
