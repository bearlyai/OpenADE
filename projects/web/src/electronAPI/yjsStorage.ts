/**
 * YJS Storage API Bridge
 *
 * Client-side API for YJS document persistence.
 * Communicates with the trusted local runtime protocol.
 * Used by ElectronStorage driver for filesystem-based YJS persistence.
 */

import { localRuntimeClient } from "../runtime/localRuntimeClient"

// ============================================================================
// YJS Storage API Functions
// ============================================================================

function uint8ArrayToBase64(data: Uint8Array): string {
    let binary = ""
    const chunkSize = 0x8000
    for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.subarray(i, i + chunkSize)
        binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
}

function base64ToUint8Array(data: string): Uint8Array {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

/**
 * Save a YJS document to the filesystem.
 * @param id Document ID (e.g., "code:repos", "code:task:abc123")
 * @param data YJS document state as Uint8Array
 */
export interface YjsStorageOperationOptions {
    operation?: string
}

function operationParams(options?: YjsStorageOperationOptions): { operation?: string } {
    return options?.operation ? { operation: options.operation } : {}
}

export async function saveYjsDoc(id: string, data: Uint8Array, options?: YjsStorageOperationOptions): Promise<void> {
    await localRuntimeClient.request("data/yjs/save", { id, data: uint8ArrayToBase64(data), ...operationParams(options) })
}

/**
 * Load a YJS document from the filesystem.
 * @param id Document ID (e.g., "code:repos", "code:task:abc123")
 * @returns YJS document state as Uint8Array, or null if not found
 */
export async function loadYjsDoc(id: string, options?: YjsStorageOperationOptions): Promise<Uint8Array | null> {
    const result = await localRuntimeClient.request<{ id: string; data: string } | null>("data/yjs/read", { id, ...operationParams(options) })
    return result ? base64ToUint8Array(result.data) : null
}

export async function listYjsDocs(): Promise<string[]> {
    return localRuntimeClient.request<string[]>("data/yjs/list", {})
}

/**
 * Delete a YJS document from the filesystem.
 * @param id Document ID (e.g., "code:repos", "code:task:abc123")
 */
export async function deleteYjsDoc(id: string, options?: YjsStorageOperationOptions): Promise<void> {
    await localRuntimeClient.request("data/yjs/delete", { id, ...operationParams(options) })
}
