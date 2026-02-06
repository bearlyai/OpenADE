import NiceModal from "@ebay/nice-modal-react"
import { observer } from "mobx-react"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import { twMerge } from "tailwind-merge"
import { UpdateBanner } from "../components/UpdateBanner"
import { ReleaseNotification } from "../components/notifications/ReleaseNotification"
import { CodeSidebar } from "../components/sidebar/Sidebar"
import { codeSidebarManager } from "../components/sidebar/sidebarManager"
import SidebarIcon from "../components/sidebar/static/sidebar.svg?react"
import { onUpdateAvailable } from "../electronAPI/app"
import { hasElectronIpc } from "../electronAPI/capabilities"
import { type FrameColors, windowFrameEnabled, windowFrameSetColors } from "../electronAPI/windowFrame"
import { PortalContainerProvider } from "../hooks/usePortalContainer"
import { useResolvedTheme } from "../hooks/useResolvedTheme"
import { useCodeStore } from "../store/context"
import "../tw.css"

const ELECTRON_DRAG_REGION_CLASS = "electron-drag-region"

interface NavbarProps {
    title: string | ReactNode | null
    icon: ReactNode | null
    right: ReactNode | null
    noBorder?: boolean
}

interface CodeAppLayoutProps {
    children: ReactNode
    navbar: NavbarProps
    frameCenter?: ReactNode
}

const WithNavbar = observer((props: { children: ReactNode; navbar: NavbarProps }) => {
    const { children, navbar } = props
    const sidebarManager = codeSidebarManager

    return (
        <div className="flex flex-col h-full w-full">
            <div
                className={twMerge(
                    "h-[50px] px-4 bg-base-100 w-full min-w-0 overflow-hidden flex items-center",
                    navbar.noBorder ? "" : "max-xl:border-b max-xl:border-border"
                )}
            >
                <div
                    className={`grid items-center transition-all duration-[500ms] ease-in-out w-full ${
                        sidebarManager.showSidebar ? "grid-cols-[0px_1fr_auto]" : "grid-cols-[40px_1fr_auto]"
                    }`}
                >
                    <div className="overflow-hidden">
                        {!sidebarManager.showSidebar && (
                            <button
                                type="button"
                                className="btn flex items-center justify-center w-8 h-8 rounded-md hover:bg-secondary text-muted hover:text-base-content flex-shrink-0"
                                onClick={sidebarManager.toggleSidebar}
                                title="Open sidebar"
                                aria-label="Open sidebar"
                            >
                                <SidebarIcon className="w-4 h-4" />
                            </button>
                        )}
                    </div>

                    <div className="min-w-0 overflow-hidden flex items-center gap-2 text-lg">
                        {navbar.icon && <div className="flex-shrink-0">{navbar.icon}</div>}
                        {navbar.title && (
                            <div className="flex-1 min-w-0">
                                {typeof navbar.title === "string" ? (
                                    <div className="font-medium text-base-content truncate min-w-0">{navbar.title}</div>
                                ) : (
                                    navbar.title
                                )}
                            </div>
                        )}
                    </div>

                    {navbar.right && <div className="flex items-center gap-2 ml-2">{navbar.right}</div>}
                </div>
            </div>
            <div className="flex flex-col flex-1 w-full bg-base-100 relative min-h-0">{children}</div>
        </div>
    )
})

const ElectronFrame = observer((props: { children: ReactNode; resolvedTheme: "light" | "dark"; center?: ReactNode }) => {
    const { children, resolvedTheme, center } = props
    const frameHeight = "44px"
    const [frameEnabled, setFrameEnabled] = useState(true)
    const [updateReady, setUpdateReady] = useState(false)

    const updateElectronFrameColorsFromTheme = useCallback(async () => {
        const isDark = resolvedTheme === "dark"
        const color: FrameColors = {
            color: isDark ? "#181818" : "#F7F8FA",
            symbolColor: isDark ? "#DBDDE0" : "#555558",
        }
        await windowFrameSetColors(color)
    }, [resolvedTheme])

    useEffect(() => {
        const update = async () => {
            const res = await windowFrameEnabled()
            setFrameEnabled(res)
            await updateElectronFrameColorsFromTheme()
        }
        update()
    }, [updateElectronFrameColorsFromTheme])

    useEffect(() => {
        updateElectronFrameColorsFromTheme()
    }, [updateElectronFrameColorsFromTheme])

    // Subscribe to update available events from Electron
    useEffect(() => {
        const unsubscribe = onUpdateAvailable(() => {
            setUpdateReady(true)
        })
        return unsubscribe
    }, [])

    if (!frameEnabled) {
        return <div className="w-full h-full">{children}</div>
    }

    return (
        <div className="w-full h-full">
            <div
                className={ELECTRON_DRAG_REGION_CLASS + " flex items-center justify-center bg-base-100 border-b border-border"}
                style={{
                    height: frameHeight,
                    flexShrink: 0,
                }}
            >
                {updateReady ? <UpdateBanner /> : center}
            </div>
            <div className="flex flex-col" style={{ height: `calc(100% - ${frameHeight})`, overflow: "hidden" }}>
                {children}
            </div>
        </div>
    )
})

const FramedApp = observer((props: { children: ReactNode; resolvedTheme: "light" | "dark"; center?: ReactNode }) => {
    const { children, resolvedTheme, center } = props

    if (!hasElectronIpc()) {
        return <div className="w-full h-full">{children}</div>
    }
    return (
        <ElectronFrame resolvedTheme={resolvedTheme} center={center}>
            {children}
        </ElectronFrame>
    )
})

export const CodeAppLayout = observer((props: CodeAppLayoutProps) => {
    const { children, navbar, frameCenter } = props
    const codeStore = useCodeStore()
    const themeSetting = codeStore.personalSettingsStore?.settings.current.theme ?? "system"
    const themeClass = useResolvedTheme(themeSetting)
    const isDark = themeClass.includes("dark") || themeClass.includes("black") || themeClass.includes("synthwave") || themeClass.includes("dracula")

    return (
        <div className={`code-theme ${themeClass} w-full h-full overflow-hidden relative flex flex-col`}>
            <FramedApp resolvedTheme={isDark ? "dark" : "light"} center={frameCenter}>
                <NiceModal.Provider>
                    <PortalContainerProvider>
                        <div className="w-full h-full flex relative">
                            <CodeSidebar />
                            <div className="flex flex-col relative h-full flex-1 min-w-0">
                                <div className="h-full w-full relative flex flex-col">
                                    <WithNavbar navbar={navbar}>{children}</WithNavbar>
                                </div>
                            </div>
                        </div>
                        <ReleaseNotification />
                    </PortalContainerProvider>
                </NiceModal.Provider>
            </FramedApp>
        </div>
    )
})
