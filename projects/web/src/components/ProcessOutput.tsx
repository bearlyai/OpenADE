import cx from "classnames"
import { observer } from "mobx-react"
import { useEffect, useRef } from "react"
import type { ProcessStatus } from "../store/managers/RepoProcessesManager"

interface ProcessOutputProps {
    output: string
    status: ProcessStatus
    processName: string
}

export const ProcessOutput = observer(function ProcessOutput({ output, status, processName }: ProcessOutputProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const shouldAutoScroll = useRef(true)

    // Auto-scroll to bottom when output changes (if user hasn't scrolled up)
    useEffect(() => {
        if (shouldAutoScroll.current && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight
        }
    }, [output])

    // Track if user has scrolled up
    const handleScroll = () => {
        if (!containerRef.current) return
        const { scrollTop, scrollHeight, clientHeight } = containerRef.current
        // Consider "at bottom" if within 50px of the bottom
        shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 50
    }

    const statusColor = {
        running: "text-success",
        stopped: "text-muted",
        error: "text-error",
        starting: "text-warning",
    }[status]

    return (
        <div className="flex flex-col h-full bg-base-100">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-base-200">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted font-medium">Output:</span>
                    <span className="text-xs font-medium text-base-content">{processName}</span>
                </div>
                <span className={cx("text-xs font-medium", statusColor)}>{status}</span>
            </div>

            {/* Output content */}
            <div ref={containerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-auto p-3 bg-black">
                {output ? (
                    <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-all">{output}</pre>
                ) : (
                    <div className="text-xs text-muted italic">No output yet...</div>
                )}
            </div>
        </div>
    )
})
