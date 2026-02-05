/**
 * Simple IndexedDB key-value store for YJS document updates.
 * Simplified from magicbase - no version tracking, single value per key.
 */

export class SimpleIndexDB<ValueType> {
    private dbPromise: Promise<IDBDatabase>

    constructor(private name: string) {
        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(name, 1)

            request.onupgradeneeded = () => {
                const db = request.result
                if (!db.objectStoreNames.contains("data")) {
                    db.createObjectStore("data", { keyPath: "key" })
                }
            }

            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
        })
    }

    get = async (key: string): Promise<ValueType | undefined> => {
        const db = await this.dbPromise
        const transaction = db.transaction("data", "readonly")
        const store = transaction.objectStore("data")

        return new Promise((resolve, reject) => {
            const request = store.get(key)
            request.onsuccess = () => {
                const result = request.result as { key: string; value: ValueType } | undefined
                resolve(result?.value)
            }
            request.onerror = () => reject(request.error)
        })
    }

    set = async (key: string, value: ValueType): Promise<void> => {
        const db = await this.dbPromise
        const transaction = db.transaction("data", "readwrite")
        const store = transaction.objectStore("data")

        return new Promise((resolve, reject) => {
            const request = store.put({ key, value })
            request.onsuccess = () => resolve()
            request.onerror = () => reject(request.error)
        })
    }

    delete = async (key: string): Promise<void> => {
        const db = await this.dbPromise
        const transaction = db.transaction("data", "readwrite")
        const store = transaction.objectStore("data")

        return new Promise((resolve, reject) => {
            const request = store.delete(key)
            request.onsuccess = () => resolve()
            request.onerror = () => reject(request.error)
        })
    }

    deletePrefix = async (keyPrefix: string): Promise<void> => {
        const db = await this.dbPromise
        const transaction = db.transaction("data", "readwrite")
        const store = transaction.objectStore("data")

        return new Promise((resolve, reject) => {
            const request = store.openCursor()
            request.onsuccess = () => {
                const cursor = request.result
                if (cursor) {
                    const key = cursor.key as string
                    if (key.startsWith(keyPrefix)) {
                        cursor.delete()
                    }
                    cursor.continue()
                } else {
                    resolve()
                }
            }
            request.onerror = () => reject(request.error)
        })
    }

    listKeysWithPrefix = async (keyPrefix: string): Promise<string[]> => {
        const db = await this.dbPromise
        const transaction = db.transaction("data", "readonly")
        const store = transaction.objectStore("data")

        return new Promise((resolve, reject) => {
            const keys: string[] = []
            const request = store.openKeyCursor()

            request.onsuccess = () => {
                const cursor = request.result
                if (cursor) {
                    const key = cursor.key as string
                    if (key.startsWith(keyPrefix)) {
                        keys.push(key)
                    }
                    cursor.continue()
                } else {
                    resolve(keys)
                }
            }

            request.onerror = () => reject(request.error)
        })
    }

    async destroy() {
        const db = await this.dbPromise
        db.close()
        return new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(this.name)
            request.onsuccess = () => resolve()
            request.onerror = () => reject(request.error)
        })
    }
}
