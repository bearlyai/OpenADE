import { type ScratchpadContentStore, type ScratchpadIndexStore, createScratchpadContentStore, createScratchpadIndexStore } from "./scratchpadStore"
import { getStorageDriver } from "./storage"

export interface ScratchpadIndexConnection {
    store: ScratchpadIndexStore
    sync: () => Promise<void>
    disconnect: () => void
}

export async function connectScratchpadIndex(workspaceId: string): Promise<ScratchpadIndexConnection> {
    const storage = getStorageDriver()
    const { doc, sync, disconnect } = await storage.getYDoc(`code:scratchpad-index:${workspaceId}`)
    const store = createScratchpadIndexStore(doc)
    await sync()
    return { store, sync, disconnect }
}

export interface ScratchpadContentConnection {
    store: ScratchpadContentStore
    sync: () => Promise<void>
    disconnect: () => void
}

export async function connectScratchpadContent(padId: string): Promise<ScratchpadContentConnection> {
    const storage = getStorageDriver()
    const { doc, sync, disconnect } = await storage.getYDoc(`code:scratchpad:${padId}`)
    const store = createScratchpadContentStore(doc)
    await sync()
    return { store, sync, disconnect }
}
