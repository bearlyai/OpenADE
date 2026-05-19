import { WorkerPoolContextProvider, useWorkerPool } from "@pierre/diffs/react"
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"

interface DiffsWorkerProviderProps {
    children: ReactNode
}

const createWorker = () => new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" })
const FALLBACK_EDITOR_THEME = "pierre-dark"

function DiffsWorkerThemeSync({ children }: DiffsWorkerProviderProps) {
    const workerPool = useWorkerPool()
    const themeProbeRef = useRef<HTMLDivElement>(null)
    const appliedThemeRef = useRef<string | null>(null)
    const [editorTheme, setEditorTheme] = useState<string | null>(null)

    useLayoutEffect(() => {
        const el = themeProbeRef.current
        if (!el) return

        const updateTheme = () => {
            const computed = getComputedStyle(el).getPropertyValue("--editor-theme").trim()
            setEditorTheme(computed || FALLBACK_EDITOR_THEME)
        }

        updateTheme()

        const themeAncestor = el.closest(".code-theme")
        if (!themeAncestor) return

        const observer = new MutationObserver(updateTheme)
        observer.observe(themeAncestor, {
            attributes: true,
            attributeFilter: ["class"],
        })

        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        if (!workerPool || !editorTheme || appliedThemeRef.current === editorTheme) return

        let cancelled = false
        appliedThemeRef.current = editorTheme

        workerPool.setRenderOptions({ theme: editorTheme }).catch((error) => {
            if (cancelled) return
            appliedThemeRef.current = null
            console.error("[DiffsWorkerProvider] Failed to sync editor theme:", error)
        })

        return () => {
            cancelled = true
        }
    }, [editorTheme, workerPool])

    return (
        <div ref={themeProbeRef} className="contents">
            {children}
        </div>
    )
}

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
            <DiffsWorkerThemeSync>{children}</DiffsWorkerThemeSync>
        </WorkerPoolContextProvider>
    )
}
