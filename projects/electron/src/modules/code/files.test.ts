import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
    app: {
        getPath: () => process.cwd(),
        whenReady: () => Promise.resolve(),
    },
}))

vi.mock("electron-log", () => ({
    default: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}))

import { describeRuntimePath } from "./files"

let tempDir: string | null = null

async function makeTempDir(): Promise<string> {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "openade-files-test-"))
    return tempDir
}

afterEach(async () => {
    if (!tempDir) return
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
})

describe("describeRuntimePath", () => {
    it("does not return image bytes as text content", async () => {
        const dir = await makeTempDir()
        const pngPath = path.join(dir, "image.png")
        await writeFile(pngPath, Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"))

        const result = await describeRuntimePath({
            path: pngPath,
            readContents: true,
            maxReadSize: 5 * 1024 * 1024,
        })

        expect(result.type).toBe("file")
        if (result.type !== "file") return
        expect(result.content).toBeNull()
        expect(result.isBinary).toBe(true)
        expect(result.mediaType).toBe("image/png")
        expect(result.previewKind).toBe("image")
        expect(result.tooLarge).toBe(false)
    })

    it("keeps ordinary text content readable", async () => {
        const dir = await makeTempDir()
        const textPath = path.join(dir, "note.txt")
        await writeFile(textPath, "hello\nworld\n", "utf8")

        const result = await describeRuntimePath({
            path: textPath,
            readContents: true,
            maxReadSize: 5 * 1024 * 1024,
        })

        expect(result.type).toBe("file")
        if (result.type !== "file") return
        expect(result.content).toBe("hello\nworld\n")
        expect(result.isBinary).toBe(false)
        expect(result.previewKind).toBeNull()
    })

    it("marks non-image binary files without text content", async () => {
        const dir = await makeTempDir()
        const binaryPath = path.join(dir, "data.bin")
        await writeFile(binaryPath, Buffer.from([0x00, 0x01, 0x02, 0x03]))

        const result = await describeRuntimePath({
            path: binaryPath,
            readContents: true,
            maxReadSize: 5 * 1024 * 1024,
        })

        expect(result.type).toBe("file")
        if (result.type !== "file") return
        expect(result.content).toBeNull()
        expect(result.isBinary).toBe(true)
        expect(result.previewKind).toBeNull()
    })
})
