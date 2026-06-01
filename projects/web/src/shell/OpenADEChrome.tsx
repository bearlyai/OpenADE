import { ArrowLeft, CircleDot, Loader2, RefreshCw, WifiOff } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

export type OpenADEChromeStatusTone = "ok" | "warn" | "bad" | "muted"

export interface OpenADEChromeStatus {
    label: string
    tone: OpenADEChromeStatusTone
}

export interface OpenADEChromeNavItem<TScreen extends string> {
    screen: TScreen
    label: string
    icon: LucideIcon
}

export function openADEStatusToneClass(tone: OpenADEChromeStatusTone): string {
    if (tone === "ok") return "text-success"
    if (tone === "warn") return "text-warning"
    if (tone === "bad") return "text-error"
    return "text-muted"
}

export function OpenADEChrome<TScreen extends string>({
    className,
    title,
    host,
    status,
    showBack,
    isLoading,
    error,
    notice,
    connectionWarning,
    activeNav,
    navItems,
    children,
    onBack,
    onRefresh,
    onNavigate,
}: {
    className: string
    title: string
    host: string
    status: OpenADEChromeStatus
    showBack: boolean
    isLoading: boolean
    error: string | null
    notice: string | null
    connectionWarning: string | null
    activeNav: TScreen
    navItems: Array<OpenADEChromeNavItem<TScreen>>
    children?: ReactNode
    onBack: () => void
    onRefresh: () => void
    onNavigate: (screen: TScreen) => void
}) {
    return (
        <main
            className={className}
            style={{
                width: "100vw",
                maxWidth: "100vw",
                height: "100dvh",
                minHeight: 0,
                paddingTop: "env(safe-area-inset-top)",
                paddingBottom: "env(safe-area-inset-bottom)",
            }}
        >
            <div className="flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden md:flex-row">
                <OpenADESideNav active={activeNav} items={navItems} onNavigate={onNavigate} />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <OpenADEHeader title={title} host={host} status={status} showBack={showBack} isLoading={isLoading} onBack={onBack} onRefresh={onRefresh} />

                    {error && (
                        <div className="mx-3 mt-3 max-w-full shrink-0 break-words border border-error/30 bg-error/10 p-2 text-xs text-error">{error}</div>
                    )}
                    {notice && <div className="mx-3 mt-3 max-w-full shrink-0 break-words border border-info/30 bg-info/10 p-2 text-xs text-info">{notice}</div>}
                    {connectionWarning && (
                        <div className="mx-3 mt-3 flex max-w-full shrink-0 items-center gap-2 overflow-hidden border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
                            <WifiOff size={13} />
                            <span className="truncate">{connectionWarning}</span>
                        </div>
                    )}

                    <section className="min-h-0 w-full max-w-full flex-1 overflow-hidden">{children}</section>

                    <OpenADEBottomNav active={activeNav} items={navItems} onNavigate={onNavigate} />
                </div>
            </div>
        </main>
    )
}

function OpenADEHeader({
    title,
    host,
    status,
    showBack,
    isLoading,
    onBack,
    onRefresh,
}: {
    title: string
    host: string
    status: OpenADEChromeStatus
    showBack: boolean
    isLoading: boolean
    onBack: () => void
    onRefresh: () => void
}) {
    return (
        <header className="h-14 w-full max-w-full shrink-0 overflow-hidden border-b border-border px-3">
            <div className="flex h-full min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    {showBack && (
                        <button
                            type="button"
                            onClick={onBack}
                            className="btn flex h-9 w-9 shrink-0 items-center justify-center bg-transparent"
                            aria-label="Back"
                        >
                            <ArrowLeft size={17} />
                        </button>
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{title}</div>
                        <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted">
                            <span className="min-w-0 truncate">{host}</span>
                            <CircleDot size={9} className={openADEStatusToneClass(status.tone)} />
                            <span className={`shrink-0 ${openADEStatusToneClass(status.tone)}`}>{status.label}</span>
                        </div>
                    </div>
                </div>
                <button type="button" onClick={onRefresh} className="btn flex h-9 w-9 shrink-0 items-center justify-center bg-transparent" aria-label="Refresh">
                    {isLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                </button>
            </div>
        </header>
    )
}

function OpenADESideNav<TScreen extends string>({
    active,
    items,
    onNavigate,
}: {
    active: TScreen
    items: Array<OpenADEChromeNavItem<TScreen>>
    onNavigate: (screen: TScreen) => void
}) {
    return (
        <nav className="hidden w-16 shrink-0 flex-col border-r border-border bg-base-100 py-2 md:flex">
            {items.map((item) => {
                const Icon = item.icon
                const activeItem = active === item.screen
                return (
                    <button
                        key={item.screen}
                        type="button"
                        onClick={() => {
                            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                            onNavigate(item.screen)
                        }}
                        className={`btn flex h-14 min-w-0 flex-col items-center justify-center gap-1 overflow-hidden bg-transparent px-1 text-[10px] ${
                            activeItem ? "text-primary" : "text-muted"
                        }`}
                    >
                        <Icon size={17} />
                        <span className="max-w-full truncate">{item.label}</span>
                    </button>
                )
            })}
        </nav>
    )
}

function OpenADEBottomNav<TScreen extends string>({
    active,
    items,
    onNavigate,
}: {
    active: TScreen
    items: Array<OpenADEChromeNavItem<TScreen>>
    onNavigate: (screen: TScreen) => void
}) {
    return (
        <nav
            className="grid h-14 w-full max-w-full shrink-0 overflow-hidden border-t border-border bg-base-100 md:hidden"
            style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
            {items.map((item) => {
                const Icon = item.icon
                const activeItem = active === item.screen
                return (
                    <button
                        key={item.screen}
                        type="button"
                        onClick={() => {
                            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                            onNavigate(item.screen)
                        }}
                        className={`btn flex min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden bg-transparent px-1 text-[11px] ${
                            activeItem ? "text-primary" : "text-muted"
                        }`}
                    >
                        <Icon size={16} />
                        <span className="max-w-full truncate">{item.label}</span>
                    </button>
                )
            })}
        </nav>
    )
}
