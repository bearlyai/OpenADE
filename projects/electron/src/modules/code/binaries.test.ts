import { describe, it, expect, beforeAll, afterAll } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { execFileSync } from "child_process"
import { pipeline } from "stream/promises"
import { Readable } from "stream"
import { MANAGED_BINARY_REGISTRY, type ManagedBinaryPlatformKey, type ManagedBinaryPlatformName } from "./binaries"

type BinaryType = "elf" | "macho" | "pe" | "unknown"

// ============================================================================
// Helpers
// ============================================================================

function detectBinaryType(header: Buffer): BinaryType {
    if (header.length < 4) return "unknown"

    // ELF: 0x7F 'E' 'L' 'F'
    if (header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46) {
        return "elf"
    }

    // Mach-O big-endian 32/64-bit
    if (header[0] === 0xfe && header[1] === 0xed && header[2] === 0xfa && (header[3] === 0xce || header[3] === 0xcf)) {
        return "macho"
    }

    // Mach-O little-endian 32/64-bit (most common on macOS)
    if ((header[0] === 0xcf || header[0] === 0xce) && header[1] === 0xfa && header[2] === 0xed && header[3] === 0xfe) {
        return "macho"
    }

    // Mach-O universal/fat binary
    if (header[0] === 0xca && header[1] === 0xfe && header[2] === 0xba && header[3] === 0xbe) {
        return "macho"
    }

    // PE (Windows): MZ header
    if (header[0] === 0x4d && header[1] === 0x5a) {
        return "pe"
    }

    return "unknown"
}

function expectedBinaryType(): BinaryType {
    switch (process.platform) {
        case "darwin":
            return "macho"
        case "linux":
            return "elf"
        case "win32":
            return "pe"
        default:
            return "unknown"
    }
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
    const response = await fetch(url, { redirect: "follow" })
    if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status} ${response.statusText} for ${url}`)
    }
    if (!response.body) {
        throw new Error(`No response body for ${url}`)
    }
    const nodeStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream)
    await pipeline(nodeStream, fs.createWriteStream(destPath))
}

function currentPlatformKey(): ManagedBinaryPlatformKey {
    return `${process.platform}-${process.arch}` as ManagedBinaryPlatformKey
}

// ============================================================================
// Tests
// ============================================================================

describe("binaries - crossbins download verification", () => {
    let tmpDir: string

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "binaries-test-"))
    })

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    // ------------------------------------------------------------------
    // Download and verify each binary for the current platform
    // ------------------------------------------------------------------

    describe("binary downloads - current platform", () => {
        const platformKey = currentPlatformKey()
        const expected = expectedBinaryType()

        for (const [name, def] of Object.entries(MANAGED_BINARY_REGISTRY)) {
            const url = def.urls[platformKey]

            if (!url) {
                it.skip(`${name} — no URL for ${platformKey}`, () => {})
                continue
            }

            it(`downloads and verifies ${name} (${def.displayName} ${def.version})`, { timeout: 120_000 }, async () => {
                const filename = def.filename[process.platform as ManagedBinaryPlatformName]
                expect(filename, `no filename mapping for platform ${process.platform}`).toBeDefined()

                const destPath = path.join(tmpDir, `${name}-${filename}`)

                // Download
                await downloadToFile(url, destPath)

                // Check file exists and has reasonable size (>100KB for real binaries)
                const stat = fs.statSync(destPath)
                expect(stat.size, `${name} binary is suspiciously small`).toBeGreaterThan(100_000)

                // Check magic bytes
                const headerBuf = Buffer.alloc(16)
                const fd = fs.openSync(destPath, "r")
                try {
                    fs.readSync(fd, headerBuf, 0, 16, 0)
                } finally {
                    fs.closeSync(fd)
                }

                const detectedType = detectBinaryType(headerBuf)
                expect(
                    detectedType,
                    `${name}: expected ${expected} binary but got ${detectedType} (header: ${headerBuf.toString("hex").slice(0, 32)})`,
                ).toBe(expected)

                // Make executable (non-Windows)
                if (process.platform !== "win32") {
                    fs.chmodSync(destPath, 0o755)
                }

                // Run verify command
                const result = execFileSync(destPath, def.verifyArgs, {
                    timeout: 15_000,
                    encoding: "utf-8",
                    stdio: ["ignore", "pipe", "pipe"],
                })
                expect(result.length, `${name} verify command produced no output`).toBeGreaterThan(0)
            })
        }
    })

    // ------------------------------------------------------------------
    // Verify all platform URLs are reachable (HEAD request)
    // ------------------------------------------------------------------

    describe("all platform URLs are reachable", () => {
        for (const [name, def] of Object.entries(MANAGED_BINARY_REGISTRY)) {
            for (const [platform, url] of Object.entries(def.urls)) {
                it(`${name} ${platform} URL returns 200`, { timeout: 30_000 }, async () => {
                    const response = await fetch(url as string, {
                        method: "HEAD",
                        redirect: "follow",
                    })
                    expect(response.ok, `${name} ${platform}: HTTP ${response.status} ${response.statusText}`).toBe(true)
                })
            }
        }
    })
})
