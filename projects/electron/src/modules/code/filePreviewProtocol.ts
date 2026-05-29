import { app, net, protocol } from "electron"
import logger from "electron-log"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { classifyFileMetadata, FILE_SIGNATURE_SAMPLE_BYTES } from "../../../../runtime-node/src/fileMetadata"

const FILE_PREVIEW_SCHEME = "openade-file"

let schemesRegistered = false
let handlerRegistered = false

async function readFileSample(filePath: string, size: number): Promise<Uint8Array> {
    if (size <= 0) return new Uint8Array()
    const handle = await fs.open(filePath, "r")
    try {
        const buffer = Buffer.alloc(Math.min(size, FILE_SIGNATURE_SAMPLE_BYTES))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        return buffer.subarray(0, bytesRead)
    } finally {
        await handle.close()
    }
}

async function handleFilePreview(request: Request): Promise<Response> {
    try {
        const url = new URL(request.url)
        const targetPath = url.searchParams.get("path")
        if (url.hostname !== "image" || !targetPath || !path.isAbsolute(targetPath)) {
            return new Response("not found", { status: 404 })
        }

        const stats = await fs.stat(targetPath)
        if (!stats.isFile()) return new Response("not found", { status: 404 })

        const metadata = classifyFileMetadata(targetPath, await readFileSample(targetPath, stats.size))
        if (metadata.previewKind !== "image" || !metadata.mediaType) {
            return new Response("unsupported media type", { status: 415 })
        }

        const response = await net.fetch(pathToFileURL(targetPath).toString())
        if (!response.ok || !response.body) return new Response("not found", { status: 404 })

        return new Response(response.body, {
            status: 200,
            headers: {
                "Cache-Control": "no-store",
                "Content-Length": String(stats.size),
                "Content-Type": metadata.mediaType,
                "X-Content-Type-Options": "nosniff",
            },
        })
    } catch (error) {
        logger.warn("[FilePreviewProtocol] Failed to serve preview", error)
        return new Response("not found", { status: 404 })
    }
}

export function registerSchemes(): void {
    if (schemesRegistered) return
    protocol.registerSchemesAsPrivileged([
        {
            scheme: FILE_PREVIEW_SCHEME,
            privileges: {
                standard: true,
                secure: true,
            },
        },
    ])
    schemesRegistered = true
}

export function load(): void {
    const registerHandler = () => {
        if (handlerRegistered) return
        protocol.handle(FILE_PREVIEW_SCHEME, handleFilePreview)
        handlerRegistered = true
    }

    if (app.isReady()) {
        registerHandler()
        return
    }

    app.whenReady().then(registerHandler).catch((error) => {
        logger.warn("[FilePreviewProtocol] Failed to register protocol handler", error)
    })
}

export function cleanup(): void {
    if (!handlerRegistered) return
    protocol.unhandle(FILE_PREVIEW_SCHEME)
    handlerRegistered = false
}
