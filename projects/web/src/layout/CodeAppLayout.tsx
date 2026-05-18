import NiceModal from "@ebay/nice-modal-react"
import { observer } from "mobx-react"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import { twMerge } from "tailwind-merge"
import { DiffsWorkerProvider } from "../components/DiffsWorkerProvider"
import { UpdateBanner, UpdateErrorBanner } from "../components/UpdateBanner"
import { ReleaseNotification } from "../components/notifications/ReleaseNotification"
import { CodeSidebar } from "../components/sidebar/Sidebar"
import { codeSidebarManager } from "../components/sidebar/sidebarManager"
import SidebarIcon from "../components/sidebar/static/sidebar.svg?react"
import { onUpdateAvailable, onUpdateError } from "../electronAPI/app"
import { hasElectronIpc } from "../electronAPI/capabilities"
import { type FrameColors, windowFrameEnabled, windowFrameSetColors } from "../electronAPI/windowFrame"
import { PortalContainerProvider } from "../hooks/usePortalContainer"
import { useResolvedTheme } from "../hooks/useResolvedTheme"
import { useCodeStore } from "../store/context"
import "../tw.css"

const ELECTRON_DRAG_REGION_CLASS = "electron-drag-region"
const ELECTRON_NO_DRAG_REGION_CLASS = "electron-no-drag-region"

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
    const insetForTrafficLights = hasElectronIpc() && !sidebarManager.showSidebar

    return (
        <div className="flex flex-col h-full w-full bg-base-100">
            <div
                className={twMerge(
                    ELECTRON_DRAG_REGION_CLASS,
                    "h-11 px-3 bg-base-100 w-full min-w-0 overflow-hidden flex items-center flex-shrink-0",
                    insetForTrafficLights ? "pl-[90px]" : ""
                )}
            >
                <div
                    className={`grid items-center transition-all duration-[500ms] ease-in-out w-full ${
                        sidebarManager.showSidebar ? "grid-cols-[0px_1fr_auto]" : "grid-cols-[32px_1fr_auto]"
                    }`}
                >
                    <div className="overflow-hidden">
                        {!sidebarManager.showSidebar && (
                            <button
                                type="button"
                                className={`${ELECTRON_NO_DRAG_REGION_CLASS} btn flex items-center justify-center w-7 h-7 rounded-md hover:bg-base-200 text-muted hover:text-base-content flex-shrink-0`}
                                onClick={sidebarManager.toggleSidebar}
                                title="Open sidebar"
                                aria-label="Open sidebar"
                            >
                                <SidebarIcon className="w-4 h-4" />
                            </button>
                        )}
                    </div>

                    <div className={`${ELECTRON_NO_DRAG_REGION_CLASS} min-w-0 overflow-hidden flex items-center text-base`}>
                        {navbar.title && (
                            <div className="flex-1 min-w-0">
                                {typeof navbar.title === "string" ? (
                                    <div className="font-medium leading-none text-base-content truncate min-w-0">{navbar.title}</div>
                                ) : (
                                    navbar.title
                                )}
                            </div>
                        )}
                    </div>

                    {navbar.right && <div className={`${ELECTRON_NO_DRAG_REGION_CLASS} flex items-center gap-2 ml-2`}>{navbar.right}</div>}
                </div>
            </div>
            <div className="flex flex-col flex-1 w-full bg-base-100 relative min-h-0">{children}</div>
        </div>
    )
})

const ElectronFrame = observer((props: { children: ReactNode; resolvedTheme: "light" | "dark"; center?: ReactNode }) => {
    const { children, resolvedTheme, center } = props
    const [frameEnabled, setFrameEnabled] = useState(true)
    const [updateReady, setUpdateReady] = useState(false)
    const [updateError, setUpdateError] = useState(false)

    const updateElectronFrameColorsFromTheme = useCallback(async () => {
        const isDark = resolvedTheme === "dark"
        const color: FrameColors = {
            color: isDark ? "#303030" : "#F2F3F5",
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
            setUpdateError(false)
        })
        return unsubscribe
    }, [])

    // Subscribe to update error events from Electron
    useEffect(() => {
        const unsubscribe = onUpdateError(() => {
            setUpdateError(true)
        })
        return unsubscribe
    }, [])

    if (!frameEnabled) {
        return <div className="w-full h-full">{children}</div>
    }

    return (
        <div className="w-full h-full relative overflow-hidden bg-base-200">
            {(updateReady || updateError || center) && (
                <div className={`${ELECTRON_NO_DRAG_REGION_CLASS} absolute top-2 left-1/2 -translate-x-1/2 z-[80]`}>
                    {updateReady ? <UpdateBanner /> : updateError ? <UpdateErrorBanner /> : center}
                </div>
            )}
            <div className="flex flex-col w-full h-full overflow-hidden">{children}</div>
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
    const sidebarManager = codeSidebarManager
    const themeSetting = codeStore.personalSettingsStore?.settings.current.theme ?? "system"
    const themeClass = useResolvedTheme(themeSetting)
    const isDark = themeClass.includes("dark") || themeClass.includes("black") || themeClass.includes("synthwave") || themeClass.includes("dracula")

    return (
        <div className={`code-theme ${themeClass} w-full h-full overflow-hidden relative flex flex-col`}>
            <FramedApp resolvedTheme={isDark ? "dark" : "light"} center={frameCenter}>
                <DiffsWorkerProvider>
                    <NiceModal.Provider>
                        <PortalContainerProvider>
                            <div className="w-full h-full relative overflow-hidden bg-base-200">
                                <CodeSidebar />
                                <div
                                    className={twMerge(
                                        "flex flex-col relative z-10 h-full min-w-0 overflow-hidden bg-base-100 transition-[margin-left,border-radius] duration-300 ease-in-out",
                                        sidebarManager.showSidebar
                                            ? "min-[901px]:ml-[300px] min-[901px]:rounded-l-xl min-[901px]:border-l min-[901px]:border-border"
                                            : "ml-0 rounded-l-none"
                                    )}
                                >
                                    <div className="h-full w-full relative flex flex-col">
                                        <WithNavbar navbar={navbar}>{children}</WithNavbar>
                                    </div>
                                </div>
                            </div>
                            <ReleaseNotification />
                        </PortalContainerProvider>
                    </NiceModal.Provider>
                </DiffsWorkerProvider>
            </FramedApp>
        </div>
    )
})
