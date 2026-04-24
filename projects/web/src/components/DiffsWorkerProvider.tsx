import { WorkerPoolContextProvider } from "@pierre/diffs/react"
import type { ReactNode } from "react"

interface DiffsWorkerProviderProps {
    children: ReactNode
}

const createWorker = () => new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" })

export function DiffsWorkerProvider({ children }: DiffsWorkerProviderProps) {
    return (
        <WorkerPoolContextProvider
            poolOptions={{
                workerFactory: createWorker,
                poolSize: Math.max(1, Math.min(4, navigator.hardwareConcurrency ?? 4)),
            }}
            highlighterOptions={{
                tokenizeMaxLineLength: 1000,
            }}
        >
            {children}
        </WorkerPoolContextProvider>
    )
}
