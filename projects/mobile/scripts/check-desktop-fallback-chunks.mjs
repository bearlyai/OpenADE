#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname)
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..")
const DIST_ROOT = path.join(PROJECT_ROOT, "dist")
const ASSET_ROOT = path.join(DIST_ROOT, "assets")
const DESKTOP_ONLY_MARKERS = [
    "electronAPI",
    "dataFolder",
    "rawPtyTerminalSession",
    "CodeApp",
    "store/managers",
    "setTerminalKeyboardCapture",
    "PtyHandle",
]
const SCANNED_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".map", ".mjs", ".svg", ".txt"])

if (!fs.existsSync(ASSET_ROOT)) {
    console.error(`Mobile asset directory is missing: ${path.relative(PROJECT_ROOT, ASSET_ROOT)}. Run vite build before this check.`)
    process.exit(1)
}

const findings = []
for (const filePath of listFiles(DIST_ROOT)) {
    const relativePath = path.relative(PROJECT_ROOT, filePath)
    const pathMarkers = DESKTOP_ONLY_MARKERS.filter((marker) => relativePath.includes(marker))
    for (const marker of pathMarkers) findings.push({ file: relativePath, marker, source: "path" })

    if (!SCANNED_EXTENSIONS.has(path.extname(filePath))) continue
    const content = fs.readFileSync(filePath, "utf8")
    for (const marker of DESKTOP_ONLY_MARKERS) {
        if (content.includes(marker)) findings.push({ file: relativePath, marker, source: "content" })
    }
}

if (findings.length > 0) {
    console.error("Mobile build contains desktop-only fallback markers:")
    for (const finding of findings) {
        console.error(`- ${finding.file}: ${finding.marker} (${finding.source})`)
    }
    process.exit(1)
}

console.log(`Mobile build has no desktop-only fallback markers in ${path.relative(PROJECT_ROOT, DIST_ROOT)}`)

function listFiles(root) {
    const entries = fs.readdirSync(root, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
        const entryPath = path.join(root, entry.name)
        if (entry.isDirectory()) {
            files.push(...listFiles(entryPath))
        } else if (entry.isFile()) {
            files.push(entryPath)
        }
    }
    return files
}
