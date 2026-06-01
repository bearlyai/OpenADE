import { type ReactNode, createContext, useContext } from "react"
import type { CodeStore } from "./store"

const CodeStoreContext = createContext<CodeStore | null>(null)

export const CodeStoreProvider = ({ store, children }: { store: CodeStore; children?: ReactNode }) => (
    <CodeStoreContext.Provider value={store}>{children}</CodeStoreContext.Provider>
)

export const useOptionalCodeStore = (): CodeStore | null => {
    return useContext(CodeStoreContext)
}

export const useCodeStore = (): CodeStore => {
    const store = useOptionalCodeStore()
    if (!store) {
        console.error("[useCodeStore] No store in context! Component is not wrapped in CodeStoreProvider")
        throw new Error("useCodeStore must be used within a CodeStoreProvider")
    }
    return store
}
