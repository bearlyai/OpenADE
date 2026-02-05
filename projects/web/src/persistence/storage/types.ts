import type * as Y from "yjs"

export interface GetDocResult {
    doc: Y.Doc
    sync: () => Promise<void>
    disconnect: () => void
}

export interface StorageDriver {
    getYDoc(id: string): Promise<GetDocResult>
    deleteDoc(id: string): Promise<void>
    disconnect(): void
}
