import { type ObservableMap, action, makeObservable, observable, runInAction } from "mobx"
import * as Y from "yjs"
import { asJavascriptObject, asYObject, mutate } from "./y-utils"

// ============ Types ============

// Relaxed type constraint - any object that can be JSON-serialized
// biome-ignore lint/suspicious/noExplicitAny: Necessary for flexible type constraints
type JSONSerializable = Record<string, any>

export interface YObjectHandle<T extends JSONSerializable> {
    /** Current value as plain JS (observable.ref - changes trigger MobX reactions) */
    current: T
    /** Get current value */
    get(): T
    /** Partial update - merges with existing */
    set(partial: Partial<T>): void
    /** Immer-style mutation */
    update(recipe: (draft: T) => void): void
    /** Subscribe to changes, returns unsubscribe function */
    subscribe(callback: () => void): () => void
}

export interface YArrayHandle<T extends JSONSerializable & { id: string }> {
    /** Ordered list of item ids (observable.ref) */
    ids: string[]
    /** Map of id -> item (observable MobX map) */
    items: ObservableMap<string, T>
    /** Get all items in order */
    all(): T[]
    /** Get single item by id */
    get(id: string): T | undefined
    /** Add item (must have id field) */
    push(item: T): void
    /** Remove item by id */
    delete(id: string): void
    /** Immer-style mutation of single item */
    update(id: string, recipe: (draft: T) => void): void
    /** Remove all items */
    clear(): void
    /** Subscribe to any change, returns unsubscribe function */
    subscribe(callback: () => void): () => void
    /** Subscribe to single item's changes only, returns unsubscribe function */
    subscribeToItem(id: string, callback: () => void): () => void
}

// ============ objectOfType ============

export function objectOfType<T extends JSONSerializable>(doc: Y.Doc, id: string, initial: () => T): YObjectHandle<T> {
    const yMap = doc.getMap(id)

    // Initialize if empty (don't overwrite existing data on reconnect)
    if (yMap.size === 0) {
        const defaultValue = initial()
        doc.transact(() => {
            for (const [key, value] of Object.entries(defaultValue)) {
                yMap.set(key, asYObject(value))
            }
        })
    }

    // Track subscribers separately from MobX
    const subscribers = new Set<() => void>()

    const handle: YObjectHandle<T> = {
        current: asJavascriptObject<T>(yMap),

        get(): T {
            return this.current
        },

        set(partial: Partial<T>): void {
            doc.transact(() => {
                for (const [key, value] of Object.entries(partial)) {
                    yMap.set(key, asYObject(value))
                }
            })
        },

        update(recipe: (draft: T) => void): void {
            mutate(yMap, recipe)
        },

        subscribe(callback: () => void): () => void {
            subscribers.add(callback)
            return () => {
                subscribers.delete(callback)
            }
        },
    }

    makeObservable(handle, {
        current: observable.ref,
        set: action,
        update: action,
    })

    // Sync MobX state and notify subscribers on Yjs changes
    yMap.observeDeep(() => {
        runInAction(() => {
            handle.current = asJavascriptObject<T>(yMap)
        })
        for (const callback of subscribers) {
            callback()
        }
    })

    return handle
}

// ============ arrayOfType ============

export function arrayOfType<T extends JSONSerializable & { id: string }>(doc: Y.Doc, id: string): YArrayHandle<T> {
    const dataMap = doc.getMap<Y.Map<unknown>>(id + ":data")
    const orderArray = doc.getArray<string>(id + ":order")

    // Track subscribers
    const allSubscribers = new Set<() => void>()
    const itemSubscribers = new Map<string, Set<() => void>>()

    const syncIds = (): string[] => orderArray.toArray()

    const syncItem = (itemId: string): T | undefined => {
        const yMap = dataMap.get(itemId)
        if (yMap) {
            return asJavascriptObject<T>(yMap)
        }
        return undefined
    }

    const syncAllItems = (ids: string[]): Map<string, T> => {
        const map = new Map<string, T>()
        for (const itemId of ids) {
            const item = syncItem(itemId)
            if (item) {
                map.set(itemId, item)
            }
        }
        return map
    }

    const notifyAllSubscribers = () => {
        for (const callback of allSubscribers) {
            callback()
        }
    }

    const notifyItemSubscribers = (itemId: string) => {
        const subs = itemSubscribers.get(itemId)
        if (subs) {
            for (const callback of subs) {
                callback()
            }
        }
    }

    const initialIds = syncIds()
    const initialItems = syncAllItems(initialIds)

    const handle: YArrayHandle<T> = {
        ids: initialIds,
        items: observable.map<string, T>(initialItems),

        all(): T[] {
            return this.ids.map((itemId) => this.items.get(itemId)).filter((item): item is T => item !== undefined)
        },

        get(itemId: string): T | undefined {
            return this.items.get(itemId)
        },

        push(item: T): void {
            const yValue = asYObject(item) as Y.Map<unknown>
            doc.transact(() => {
                dataMap.set(item.id, yValue)
                orderArray.push([item.id])
            })
        },

        delete(itemId: string): void {
            doc.transact(() => {
                if (dataMap.has(itemId)) {
                    dataMap.delete(itemId)
                }
                const idx = orderArray.toArray().indexOf(itemId)
                if (idx !== -1) {
                    orderArray.delete(idx, 1)
                }
            })
        },

        update(itemId: string, recipe: (draft: T) => void): void {
            const yMap = dataMap.get(itemId)
            if (yMap) {
                mutate(yMap, recipe)
            }
        },

        clear(): void {
            doc.transact(() => {
                dataMap.clear()
                if (orderArray.length > 0) {
                    orderArray.delete(0, orderArray.length)
                }
            })
        },

        subscribe(callback: () => void): () => void {
            allSubscribers.add(callback)
            return () => {
                allSubscribers.delete(callback)
            }
        },

        subscribeToItem(itemId: string, callback: () => void): () => void {
            if (!itemSubscribers.has(itemId)) {
                itemSubscribers.set(itemId, new Set())
            }
            itemSubscribers.get(itemId)!.add(callback)

            return () => {
                const subs = itemSubscribers.get(itemId)
                if (subs) {
                    subs.delete(callback)
                    if (subs.size === 0) {
                        itemSubscribers.delete(itemId)
                    }
                }
            }
        },
    }

    makeObservable(handle, {
        ids: observable.ref,
        push: action,
        delete: action,
        update: action,
        clear: action,
    })

    // Observe order changes
    orderArray.observe(() => {
        runInAction(() => {
            const newIds = syncIds()
            handle.ids = newIds

            // Add new items
            for (const itemId of newIds) {
                if (!handle.items.has(itemId)) {
                    const item = syncItem(itemId)
                    if (item) {
                        handle.items.set(itemId, item)
                    }
                }
            }

            // Remove deleted items
            for (const itemId of Array.from(handle.items.keys())) {
                if (!newIds.includes(itemId)) {
                    handle.items.delete(itemId)
                }
            }
        })
        notifyAllSubscribers()
    })

    // Observe data changes (item updates)
    dataMap.observeDeep((events) => {
        // Track which items changed
        const changedItemIds = new Set<string>()

        for (const event of events) {
            // Get the path to determine which item changed
            const path = event.path
            if (path.length >= 1 && typeof path[0] === "string") {
                changedItemIds.add(path[0])
            } else if (event.target === dataMap) {
                // Direct changes to dataMap (add/delete items)
                if (event instanceof Y.YMapEvent) {
                    for (const key of event.keysChanged) {
                        changedItemIds.add(key)
                    }
                }
            }
        }

        // Update MobX state for changed items
        runInAction(() => {
            for (const itemId of changedItemIds) {
                const item = syncItem(itemId)
                if (item) {
                    handle.items.set(itemId, item)
                } else {
                    handle.items.delete(itemId)
                }
            }
        })

        // Notify subscribers
        if (changedItemIds.size > 0) {
            notifyAllSubscribers()
            for (const itemId of changedItemIds) {
                notifyItemSubscribers(itemId)
            }
        }
    })

    return handle
}
