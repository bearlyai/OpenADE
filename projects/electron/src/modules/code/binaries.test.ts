import { describe, it, expect, beforeAll, afterAll } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { execFileSync } from "child_process"
import { pipeline } from "stream/promises"
import { Readable } from "stream"

// ============================================================================
// Types — mirrors BinaryDef from binaries.ts
// ============================================================================

type PlatformKey = "darwin-arm64" | "darwin-x64" | "linux-arm64" | "linux-x64" | "win32-x64"
type PlatformName = "darwin" | "linux" | "win32"
type BinaryType = "elf" | "macho" | "pe" | "unknown"

interface BinaryDef {
    displayName: string
    version: string
    urls: Partial<Record<PlatformKey, string>>
    filename: Partial<Record<PlatformName, string>>
    verifyArgs: string[]
}

// ============================================================================
// Test registry — must stay in sync with binaries.ts REGISTRY
// ============================================================================

const REGISTRY: Record<string, BinaryDef> = {
    bun: {
        displayName: "Bun",
        version: "1.3.8",
        urls: {
            "darwin-arm64": "https://github.com/bearlyai/crossbins/releases/download/v1/bun-1.3.8-darwin-aarch64",
            "darwin-x64": "https://github.com/bearlyai/crossbins/releases/download/v1/bun-1.3.8-darwin-x86_64",
            "linux-arm64": "https://github.com/bearlyai/crossbins/releases/download/v1/bun-1.3.8-linux-aarch64",
            "linux-x64": "https://github.com/bearlyai/crossbins/releases/download/v1/bun-1.3.8-linux-x86_64",
            "win32-x64": "https://github.com/bearlyai/crossbins/releases/download/v1/bun-1.3.8-windows-x86_64.exe",
        },
        filename: {
            darwin: "bun",
            linux: "bun",
            win32: "bun.exe",
        },
        verifyArgs: ["--help"],
    },
    rg: {
        displayName: "ripgrep",
        version: "15.1.0",
        urls: {
            "darwin-arm64": "https://github.com/bearlyai/crossbins/releases/download/v1/rg-15.1.0-darwin-aarch64",
            "darwin-x64": "https://github.com/bearlyai/crossbins/releases/download/v1/rg-15.1.0-darwin-x86_64",
            "linux-arm64": "https://github.com/bearlyai/crossbins/releases/download/v1/rg-15.1.0-linux-aarch64",
            "linux-x64": "https://github.com/bearlyai/crossbins/releases/download/v1/rg-15.1.0-linux-x86_64-musl",
            "win32-x64": "https://github.com/bearlyai/crossbins/releases/download/v1/rg-15.1.0-windows-x86_64.exe",
        },
        filename: {
            darwin: "rg",
            linux: "rg",
            win32: "rg.exe",
        },
        verifyArgs: ["--version"],
    },
}

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

function currentPlatformKey(): PlatformKey {
    return `${process.platform}-${process.arch}` as PlatformKey
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
    // Registry sync check — ensure our test registry matches the source
    // ------------------------------------------------------------------

    describe("registry sync check", () => {
        it("test registry matches binaries.ts source", () => {
            const sourceFile = fs.readFileSync(path.resolve(__dirname, "binaries.ts"), "utf-8")

            for (const [name, def] of Object.entries(REGISTRY)) {
                // Check version appears in source
                expect(sourceFile, `version ${def.version} for ${name} not found in source`).toContain(def.version)

                // Check every URL appears in source
                for (const [platform, url] of Object.entries(def.urls)) {
                    expect(sourceFile, `URL for ${name}/${platform} not found in source`).toContain(url as string)
                }

                // Check verifyArgs appear in source
                for (const arg of def.verifyArgs) {
                    expect(sourceFile, `verifyArg "${arg}" for ${name} not found in source`).toContain(arg)
                }
            }

            // Also verify we haven't missed any binaries in the source REGISTRY
            const registryKeyPattern = /^\s{4}(\w+):\s*\{$/gm
            const sourceKeys: string[] = []
            // Only match keys inside the REGISTRY block
            const registryBlock = sourceFile.match(/const REGISTRY[^{]*\{([\s\S]*?)^}/m)
            if (registryBlock) {
                let match: RegExpExecArray | null
                while ((match = registryKeyPattern.exec(registryBlock[1])) !== null) {
                    sourceKeys.push(match[1])
                }
            }
            const testKeys = Object.keys(REGISTRY).sort()
            expect(sourceKeys.sort()).toEqual(testKeys)
        })
    })

    // ------------------------------------------------------------------
    // Download and verify each binary for the current platform
    // ------------------------------------------------------------------

    describe("binary downloads - current platform", () => {
        const platformKey = currentPlatformKey()
        const expected = expectedBinaryType()

        for (const [name, def] of Object.entries(REGISTRY)) {
            const url = def.urls[platformKey]

            if (!url) {
                it.skip(`${name} — no URL for ${platformKey}`, () => {})
                continue
            }

            it(`downloads and verifies ${name} (${def.displayName} ${def.version})`, { timeout: 120_000 }, async () => {
                const filename = def.filename[process.platform as PlatformName]
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
        for (const [name, def] of Object.entries(REGISTRY)) {
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
