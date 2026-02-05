/**
 * SettingsModal
 *
 * Main settings modal with sidebar navigation for the Code module.
 * Flat, square design following Theme V2.
 */

import NiceModal, { useModal } from "@ebay/nice-modal-react"
import { BarChart3, Bug, Palette, Plug, Settings, Terminal, X } from "lucide-react"
import { observer } from "mobx-react"
import { useMemo, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import type { CodeStore } from "../../store/store"
import { ScrollArea } from "../ui/ScrollArea"
import { AppearanceTab } from "./AppearanceTab"
import { ConnectorsTab } from "./ConnectorsTab"
import { DevTab, isLocalDev } from "./DevTab"
import { StatsTab } from "./StatsTab"
import { SystemConfigTab } from "./SystemConfigTab"

const Z_INDEX_MODAL = "z-50"

export type SettingsTab = "appearance" | "connectors" | "system" | "stats" | "dev"

interface TabConfig {
    id: SettingsTab
    label: string
    icon: typeof Settings
    devOnly?: boolean
}

const ALL_TABS: TabConfig[] = [
    { id: "appearance", label: "Vibes", icon: Palette },
    { id: "connectors", label: "Connectors", icon: Plug },
    { id: "system", label: "System", icon: Terminal },
    { id: "stats", label: "Stats", icon: BarChart3 },
    { id: "dev", label: "Dev", icon: Bug, devOnly: true },
]

interface SettingsModalProps {
    store: CodeStore
    /** Optional tab to open. If not provided, opens to the last-used tab (or "connectors" as fallback). */
    initialTab?: SettingsTab
}

export const SettingsModal = NiceModal.create(
    observer(({ store, initialTab }: SettingsModalProps) => {
        const modal = useModal()
        const showDevTab = useMemo(() => isLocalDev(), [])
        const tabs = useMemo(() => ALL_TABS.filter((t) => !t.devOnly || showDevTab), [showDevTab])
        const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? store.personalSettingsStore?.settings.current.lastSettingsTab ?? "connectors")

        const handleTabChange = (tab: SettingsTab) => {
            setActiveTab(tab)
            // Don't persist dev tab as last tab
            if (tab !== "dev") {
                store.personalSettingsStore?.settings.set({ lastSettingsTab: tab })
            }
        }

        useHotkeys(
            "esc",
            (e) => {
                e.preventDefault()
                e.stopPropagation()
                modal.remove()
            },
            { enableOnFormTags: ["INPUT", "TEXTAREA", "SELECT"] },
            [modal]
        )

        const handleBackdropClick = (e: React.MouseEvent) => {
            if (e.target === e.currentTarget) {
                modal.remove()
            }
        }

        const tabButtonClass = (isActive: boolean) =>
            `btn w-full flex items-center gap-2 p-2.5 px-3 text-left text-sm transition-colors ${
                isActive
                    ? "bg-primary/10 text-primary border-l-2 border-primary"
                    : "bg-transparent text-muted hover:text-base-content hover:bg-base-200 border-l-2 border-transparent"
            }`

        const renderTabContent = () => {
            switch (activeTab) {
                case "appearance":
                    return <AppearanceTab store={store} />
                case "connectors":
                    return <ConnectorsTab store={store} />
                case "system":
                    return <SystemConfigTab store={store} />
                case "stats":
                    return <StatsTab store={store} />
                case "dev":
                    return <DevTab store={store} />
                default:
                    return null
            }
        }

        return (
            <div
                className={`absolute inset-0 bg-black/50 flex items-start justify-center ${Z_INDEX_MODAL} p-4 pb-24`}
                style={{
                    backdropFilter: "blur(5px)",
                    WebkitBackdropFilter: "blur(5px)",
                    paddingTop: "max(min(80px, 15%), 1rem)",
                }}
                onClick={handleBackdropClick}
            >
                <div
                    className="bg-base-100 shadow-2xl w-full max-w-3xl flex flex-col border border-border"
                    style={{
                        maxHeight: "min(600px, 70vh)",
                        minHeight: "300px",
                    }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
                        <div className="flex items-center gap-2">
                            <Settings size={18} className="text-muted" />
                            <h2 className="text-lg font-semibold text-base-content">Settings</h2>
                        </div>
                        <button
                            type="button"
                            className="btn w-8 h-8 flex items-center justify-center bg-transparent hover:bg-base-200 text-muted hover:text-base-content transition-colors"
                            onClick={() => modal.remove()}
                            title="Close"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Content with Sidebar */}
                    <div className="flex flex-1 min-h-0 overflow-hidden">
                        {/* Sidebar */}
                        <div className="w-48 flex-shrink-0 border-r border-border bg-base-200/30">
                            <nav className="flex flex-col p-2 gap-1">
                                {tabs.map((tab) => (
                                    <button key={tab.id} type="button" onClick={() => handleTabChange(tab.id)} className={tabButtonClass(activeTab === tab.id)}>
                                        <tab.icon size={16} />
                                        <span>{tab.label}</span>
                                    </button>
                                ))}
                            </nav>
                        </div>

                        {/* Main Content */}
                        <div className="flex-1 min-w-0 min-h-0 overflow-hidden relative">
                            <ScrollArea className="absolute inset-0" viewportClassName="p-6">
                                {renderTabContent()}
                            </ScrollArea>
                        </div>
                    </div>
                </div>
            </div>
        )
    })
)
