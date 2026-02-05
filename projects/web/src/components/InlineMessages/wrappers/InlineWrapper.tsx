import type { ReactNode } from "react"

interface InlineWrapperProps {
    children: ReactNode
}

export function InlineWrapper({ children }: InlineWrapperProps) {
    return <div className="border-t border-border">{children}</div>
}
