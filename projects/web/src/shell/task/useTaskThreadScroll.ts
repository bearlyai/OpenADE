import { useCallback, useEffect, useRef, useState } from "react"

export const TASK_THREAD_BOTTOM_THRESHOLD_PX = 80

export type TaskThreadScrollMode = "always" | "preserve"

export function shouldFollowTaskThread(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
    return scrollHeight - scrollTop - clientHeight < TASK_THREAD_BOTTOM_THRESHOLD_PX
}

export function useTaskThreadScroll({
    changeKey,
    resetKey,
    mode = "preserve",
}: {
    changeKey: string | number
    resetKey?: string | number
    mode?: TaskThreadScrollMode
}) {
    const viewportRef = useRef<HTMLDivElement>(null)
    const shouldFollowRef = useRef(true)
    const resetScrollScheduledRef = useRef(false)
    const [showJump, setShowJump] = useState(false)

    const scrollToBottom = useCallback(() => {
        window.requestAnimationFrame(() => {
            const viewport = viewportRef.current
            if (!viewport) return
            viewport.scrollTop = viewport.scrollHeight
            shouldFollowRef.current = true
            setShowJump(false)
        })
    }, [])

    useEffect(() => {
        shouldFollowRef.current = true
        resetScrollScheduledRef.current = true
        setShowJump(false)
        scrollToBottom()
    }, [resetKey, scrollToBottom])

    useEffect(() => {
        if (resetScrollScheduledRef.current) {
            resetScrollScheduledRef.current = false
            return
        }
        if (mode === "always" || shouldFollowRef.current) {
            scrollToBottom()
            return
        }
        setShowJump(true)
    }, [changeKey, mode, scrollToBottom])

    const handleScroll = useCallback(() => {
        const viewport = viewportRef.current
        if (!viewport) return
        shouldFollowRef.current = shouldFollowTaskThread(viewport.scrollHeight, viewport.scrollTop, viewport.clientHeight)
        if (shouldFollowRef.current) setShowJump(false)
    }, [])

    return { viewportRef, showJump, handleScroll, scrollToBottom }
}
