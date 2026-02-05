/**
 * Portal Container Context
 *
 * Provides a container element for portals (dropdowns, popups, modals) to render into.
 * This ensures portal content inherits the code module's theme (code-theme-light/dark).
 */

import { type ReactNode, type RefObject, createContext, useContext, useRef } from "react"
import { Z_INDEX } from "../constants"

const PortalContainerContext = createContext<RefObject<HTMLDivElement | null> | null>(null)

/**
 * Hook to get the portal container ref.
 * Portal components should render into this container to inherit theme styles.
 */
export function usePortalContainer(): HTMLElement | null {
    const ref = useContext(PortalContainerContext)
    return ref?.current ?? null
}

/**
 * Provider component that creates a portal container inside the themed element.
 * The container is positioned relative with a high z-index to establish a stacking
 * context that allows portals to appear above other positioned elements like InputBar.
 */
export function PortalContainerProvider({ children }: { children: ReactNode }) {
    const portalContainerRef = useRef<HTMLDivElement | null>(null)

    return (
        <PortalContainerContext.Provider value={portalContainerRef}>
            {children}
            <div ref={portalContainerRef} id="code-portal-root" className="relative" style={{ zIndex: Z_INDEX.PORTAL_CONTAINER }} />
        </PortalContainerContext.Provider>
    )
}
