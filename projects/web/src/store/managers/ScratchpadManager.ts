import { makeAutoObservable, observable, runInAction } from "mobx"
import type { ScratchpadContentStore, ScratchpadIndexStore, ScratchpadMeta } from "../../persistence/scratchpadStore"
import { connectScratchpadContent, connectScratchpadIndex } from "../../persistence/scratchpadStoreBootstrap"
import { ulid } from "../../utils/ulid"

export class ScratchpadManager {
    // Per-workspace index connections
    private indexConnections = new Map<string, { store: ScratchpadIndexStore; disconnect: () => void }>()
    private indexLoading = new Map<string, Promise<void>>()
    indexStores = observable.map<string, ScratchpadIndexStore>()

    // Per-pad content connections
    private contentConnections = new Map<string, { store: ScratchpadContentStore; disconnect: () => void }>()
    private contentLoading = new Map<string, Promise<ScratchpadContentStore>>()
    contentStores = observable.map<string, ScratchpadContentStore>()

    constructor() {
        makeAutoObservable(this, {
            indexStores: false,
            contentStores: false,
        })
    }

    async ensureIndexLoaded(workspaceId: string): Promise<void> {
        if (this.indexConnections.has(workspaceId)) return
        if (this.indexLoading.has(workspaceId)) return this.indexLoading.get(workspaceId)

        const promise = (async () => {
            const conn = await connectScratchpadIndex(workspaceId)
            runInAction(() => {
                this.indexConnections.set(workspaceId, { store: conn.store, disconnect: conn.disconnect })
                this.indexStores.set(workspaceId, conn.store)
            })
        })()
        this.indexLoading.set(workspaceId, promise)
        try {
            await promise
        } finally {
            this.indexLoading.delete(workspaceId)
        }
    }

    getPads(workspaceId: string): ScratchpadMeta[] {
        const store = this.indexStores.get(workspaceId)
        if (!store) return []
        return store.pads.all().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    }

    getPadMeta(workspaceId: string, padId: string): ScratchpadMeta | undefined {
        const store = this.indexStores.get(workspaceId)
        return store?.pads.get(padId)
    }

    async loadContent(padId: string): Promise<ScratchpadContentStore> {
        const existing = this.contentConnections.get(padId)
        if (existing) return existing.store

        const loading = this.contentLoading.get(padId)
        if (loading) return loading

        const promise = (async () => {
            const conn = await connectScratchpadContent(padId)
            runInAction(() => {
                this.contentConnections.set(padId, { store: conn.store, disconnect: conn.disconnect })
                this.contentStores.set(padId, conn.store)
            })
            return conn.store
        })()
        this.contentLoading.set(padId, promise)
        try {
            return await promise
        } finally {
            this.contentLoading.delete(padId)
        }
    }

    getContentStore(padId: string): ScratchpadContentStore | undefined {
        return this.contentStores.get(padId)
    }

    createPad(workspaceId: string, title?: string): string {
        const store = this.indexStores.get(workspaceId)
        if (!store) throw new Error("Scratchpad index not loaded for workspace")
        const id = ulid()
        const now = new Date().toISOString()
        store.pads.push({
            id,
            title: title ?? "Untitled",
            preview: "",
            createdAt: now,
            updatedAt: now,
        })
        return id
    }

    updateContent(workspaceId: string, padId: string, content: Record<string, unknown> | null, plainText: string): void {
        const contentStore = this.contentConnections.get(padId)?.store
        contentStore?.data.set({ content, plainText })

        const firstLine = plainText
            .split("\n")
            .find((l) => l.trim())
            ?.trim()
        const indexStore = this.indexStores.get(workspaceId)
        indexStore?.pads.update(padId, (draft) => {
            if (firstLine) draft.title = firstLine
            draft.preview = plainText.slice(0, 100)
            draft.updatedAt = new Date().toISOString()
        })
    }

    deletePad(workspaceId: string, padId: string): void {
        const indexStore = this.indexStores.get(workspaceId)
        indexStore?.pads.delete(padId)

        const contentConn = this.contentConnections.get(padId)
        if (contentConn) {
            contentConn.disconnect()
            this.contentConnections.delete(padId)
            this.contentStores.delete(padId)
        }
    }

    disconnectAll(): void {
        for (const conn of this.indexConnections.values()) conn.disconnect()
        for (const conn of this.contentConnections.values()) conn.disconnect()
        this.indexConnections.clear()
        this.contentConnections.clear()
        this.indexStores.clear()
        this.contentStores.clear()
        this.indexLoading.clear()
        this.contentLoading.clear()
    }
}
