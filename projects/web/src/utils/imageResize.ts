/**
 * Image Resize Utility
 *
 * Resizes images to stay within Claude's Vision API recommended limits:
 * - Max 1568px on any edge
 * - Max ~1.15 megapixels
 *
 * Uses HTMLCanvasElement for resizing. Skips resize if image is already within limits.
 */

// ============================================================================
// Configuration
// ============================================================================

export const IMAGE_CONSTRAINTS = {
    maxDimension: 1568,
    maxMegapixels: 1.15,
    jpegQuality: 0.85,
} as const

const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

// ============================================================================
// Types
// ============================================================================

export interface ResizeResult {
    blob: Blob
    width: number
    height: number
    originalWidth: number
    originalHeight: number
    mediaType: string
}

// ============================================================================
// Core Functions
// ============================================================================

function loadImage(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        const url = URL.createObjectURL(blob)
        img.onload = () => {
            URL.revokeObjectURL(url)
            resolve(img)
        }
        img.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error("Failed to load image"))
        }
        img.src = url
    })
}

function calculateTargetDimensions(width: number, height: number): { targetWidth: number; targetHeight: number; needsResize: boolean } {
    let targetWidth = width
    let targetHeight = height
    let needsResize = false

    // Constrain by max dimension
    if (targetWidth > IMAGE_CONSTRAINTS.maxDimension || targetHeight > IMAGE_CONSTRAINTS.maxDimension) {
        const scale = IMAGE_CONSTRAINTS.maxDimension / Math.max(targetWidth, targetHeight)
        targetWidth = Math.round(targetWidth * scale)
        targetHeight = Math.round(targetHeight * scale)
        needsResize = true
    }

    // Constrain by megapixels
    const megapixels = (targetWidth * targetHeight) / 1_000_000
    if (megapixels > IMAGE_CONSTRAINTS.maxMegapixels) {
        const scale = Math.sqrt(IMAGE_CONSTRAINTS.maxMegapixels / megapixels)
        targetWidth = Math.round(targetWidth * scale)
        targetHeight = Math.round(targetHeight * scale)
        needsResize = true
    }

    return { targetWidth, targetHeight, needsResize }
}

export async function resizeImage(blob: Blob): Promise<ResizeResult> {
    if (!SUPPORTED_TYPES.has(blob.type)) {
        throw new Error(`Unsupported image type: ${blob.type}`)
    }

    const img = await loadImage(blob)
    const originalWidth = img.naturalWidth
    const originalHeight = img.naturalHeight

    const { targetWidth, targetHeight, needsResize } = calculateTargetDimensions(originalWidth, originalHeight)

    if (!needsResize) {
        return {
            blob,
            width: originalWidth,
            height: originalHeight,
            originalWidth,
            originalHeight,
            mediaType: blob.type,
        }
    }

    const canvas = document.createElement("canvas")
    canvas.width = targetWidth
    canvas.height = targetHeight

    const ctx = canvas.getContext("2d")
    if (!ctx) {
        throw new Error("Failed to get canvas 2d context")
    }

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

    // Use JPEG for JPEG sources, PNG for everything else
    const outputType = blob.type === "image/jpeg" ? "image/jpeg" : "image/png"
    const quality = outputType === "image/jpeg" ? IMAGE_CONSTRAINTS.jpegQuality : undefined

    const resizedBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (result) => {
                if (result) resolve(result)
                else reject(new Error("Canvas toBlob failed"))
            },
            outputType,
            quality
        )
    })

    return {
        blob: resizedBlob,
        width: targetWidth,
        height: targetHeight,
        originalWidth,
        originalHeight,
        mediaType: outputType,
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => {
            const result = reader.result as string
            // Strip the data:... prefix, return raw base64
            const base64 = result.split(",")[1]
            if (base64) resolve(base64)
            else reject(new Error("Failed to convert blob to base64"))
        }
        reader.onerror = () => reject(new Error("FileReader error"))
        reader.readAsDataURL(blob)
    })
}

export function mimeToExt(mimeType: string): string {
    switch (mimeType) {
        case "image/jpeg":
            return "jpg"
        case "image/png":
            return "png"
        case "image/gif":
            return "gif"
        case "image/webp":
            return "webp"
        default:
            return "png"
    }
}
