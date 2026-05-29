import path from "node:path"
import { TextDecoder } from "node:util"

export const FILE_SIGNATURE_SAMPLE_BYTES = 8192

export type FilePreviewKind = "image"

export interface FileMetadata {
    isBinary: boolean
    mediaType: string | null
    previewKind: FilePreviewKind | null
}

const IMAGE_EXTENSION_MEDIA_TYPES = new Map<string, string>([
    [".png", "image/png"],
    [".apng", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
    [".avif", "image/avif"],
    [".bmp", "image/bmp"],
    [".ico", "image/x-icon"],
    [".svg", "image/svg+xml"],
])

const KNOWN_BINARY_EXTENSIONS = new Set([
    ".7z",
    ".a",
    ".avi",
    ".bin",
    ".class",
    ".db",
    ".dmg",
    ".dll",
    ".doc",
    ".docx",
    ".dylib",
    ".eot",
    ".exe",
    ".gz",
    ".jar",
    ".mov",
    ".mp3",
    ".mp4",
    ".o",
    ".otf",
    ".pdf",
    ".ppt",
    ".pptx",
    ".rar",
    ".so",
    ".sqlite",
    ".tar",
    ".tgz",
    ".ttf",
    ".wav",
    ".webm",
    ".woff",
    ".woff2",
    ".xls",
    ".xlsx",
    ".zip",
])

const utf8Decoder = new TextDecoder("utf-8", { fatal: true })

function hasPrefix(sample: Uint8Array, prefix: number[]): boolean {
    if (sample.length < prefix.length) return false
    return prefix.every((byte, index) => sample[index] === byte)
}

function asciiAt(sample: Uint8Array, start: number, length: number): string {
    if (sample.length < start + length) return ""
    return String.fromCharCode(...sample.subarray(start, start + length))
}

function mediaTypeFromMagic(sample: Uint8Array): string | null {
    if (hasPrefix(sample, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
    if (hasPrefix(sample, [0xff, 0xd8, 0xff])) return "image/jpeg"
    if (asciiAt(sample, 0, 6) === "GIF87a" || asciiAt(sample, 0, 6) === "GIF89a") return "image/gif"
    if (asciiAt(sample, 0, 4) === "RIFF" && asciiAt(sample, 8, 4) === "WEBP") return "image/webp"
    if (asciiAt(sample, 0, 2) === "BM") return "image/bmp"
    if (hasPrefix(sample, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon"

    if (asciiAt(sample, 4, 4) === "ftyp") {
        const brand = asciiAt(sample, 8, 12)
        if (brand.includes("avif") || brand.includes("avis")) return "image/avif"
    }

    return null
}

function mediaTypeFromExtension(filePath: string): string | null {
    return IMAGE_EXTENSION_MEDIA_TYPES.get(path.extname(filePath).toLowerCase()) ?? null
}

function isKnownBinaryExtension(filePath: string): boolean {
    return KNOWN_BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function isLikelyBinarySample(sample: Uint8Array): boolean {
    if (sample.length === 0) return false
    if (sample.includes(0)) return true

    try {
        utf8Decoder.decode(sample)
    } catch {
        return true
    }

    let suspiciousControlBytes = 0
    for (const byte of sample) {
        if (byte < 0x20 && byte !== 0x08 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) {
            suspiciousControlBytes += 1
        }
    }

    return suspiciousControlBytes / sample.length > 0.01
}

export function classifyFileMetadata(filePath: string, sample: Uint8Array): FileMetadata {
    const mediaType = mediaTypeFromMagic(sample) ?? mediaTypeFromExtension(filePath)
    const previewKind = mediaType?.startsWith("image/") ? "image" : null
    const isBinary = previewKind !== null || isKnownBinaryExtension(filePath) || isLikelyBinarySample(sample)

    return {
        isBinary,
        mediaType,
        previewKind,
    }
}
