/**
 * Data Folder API Bridge
 *
 * Client-side API for unified file storage operations.
 * Communicates with the trusted local runtime protocol.
 *
 * Files are stored at ~/.openade/data/{folder}/{id}.{ext}
 */

import { isCodeModuleAvailable } from "./capabilities"
import { localRuntimeClient } from "../runtime/localRuntimeClient"

// ============================================================================
// Data Folder API Functions
// ============================================================================

function bytesToBase64(bytes: Uint8Array): string {
    let binary = ""
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
}

function arrayBufferToBase64(data: ArrayBuffer): string {
    return bytesToBase64(new Uint8Array(data))
}

function base64ToArrayBuffer(data: string): ArrayBuffer {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function save(folder: string, id: string, data: string | ArrayBuffer, ext: string): Promise<void> {
    const encoded = typeof data === "string" ? bytesToBase64(new TextEncoder().encode(data)) : arrayBufferToBase64(data)
    await localRuntimeClient.request("data/file/save", { folder, id, data: encoded, ext })
}

async function load(folder: string, id: string, ext: string): Promise<ArrayBuffer | string | null> {
    const result = await localRuntimeClient.request<{ data: string } | null>("data/file/load", { folder, id, ext })
    return result ? base64ToArrayBuffer(result.data) : null
}

async function deleteFile(folder: string, id: string, ext: string): Promise<void> {
    await localRuntimeClient.request("data/file/delete", { folder, id, ext })
}

function isAvailable(): boolean {
    return isCodeModuleAvailable() && !!window.openadeAPI?.runtime
}

// ============================================================================
// Export
// ============================================================================

export const dataFolderApi = {
    save,
    load,
    delete: deleteFile,
    isAvailable,
}
