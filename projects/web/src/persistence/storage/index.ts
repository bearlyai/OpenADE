export * from "./types"
export { arrayOfType, objectOfType, type YArrayHandle, type YObjectHandle } from "./yjs-mobx"

import { hasElectronIpc } from "../../electronAPI/capabilities"
import { ElectronStorage } from "./ElectronStorage"
import { SimpleLocalStorage } from "./SimpleLocalStorage"
import type { StorageDriver } from "./types"

let instance: StorageDriver | null = null

export function getStorageDriver(): StorageDriver {
    if (!instance) {
        if (hasElectronIpc()) {
            instance = new ElectronStorage()
        } else {
            instance = new SimpleLocalStorage()
        }
    }
    return instance
}
