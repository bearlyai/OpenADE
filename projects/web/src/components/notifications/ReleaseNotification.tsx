import { Sparkles, X } from "lucide-react"
import { observer } from "mobx-react"
import { useState } from "react"
import { Z_INDEX } from "../../constants"
import { RELEASE_NOTES } from "../../versions"
import { useCodeStore } from "../../store/context"

function getUnreadNotes(lastSeenVersion: string | undefined) {
    if (!lastSeenVersion) return RELEASE_NOTES
    const seenIndex = RELEASE_NOTES.findIndex((n) => n.version === lastSeenVersion)
    if (seenIndex <= 0) return seenIndex === 0 ? [] : RELEASE_NOTES
    return RELEASE_NOTES.slice(0, seenIndex)
}

export const ReleaseNotification = observer(() => {
    const codeStore = useCodeStore()
    const [dismissed, setDismissed] = useState(false)

    const lastSeen = codeStore.personalSettingsStore?.settings.current.lastSeenReleaseVersion
    const unread = getUnreadNotes(lastSeen)

    if (dismissed || unread.length === 0) return null

    const handleDismiss = () => {
        setDismissed(true)
        codeStore.personalSettingsStore?.settings.set({ lastSeenReleaseVersion: RELEASE_NOTES[0].version })
    }

    return (
        <div className="fixed bottom-6 right-6 w-96 shadow-2xl border border-primary/30 overflow-hidden" style={{ zIndex: Z_INDEX.RELEASE_NOTIFICATION }}>
            {/* Header with gradient accent */}
            <div className="bg-primary text-primary-content px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <Sparkles size={18} />
                    <span className="text-base font-bold tracking-tight">What's New</span>
                </div>
                <button type="button" onClick={handleDismiss} className="btn text-primary-content/70 hover:text-primary-content transition-colors">
                    <X size={16} />
                </button>
            </div>

            {/* Release notes list */}
            <div className="bg-base-100 max-h-96 overflow-y-auto">
                {unread.map((note, i) => (
                    <div key={note.version} className={`px-5 py-4 ${i > 0 ? "border-t border-border" : ""}`}>
                        <h3 className="text-base font-semibold text-base-content">{note.title}</h3>
                        <span className="text-xs font-mono text-primary">v{note.version}</span>
                        <div className="mt-2 flex flex-col gap-1">
                            {note.highlights.map((h) => (
                                <p key={h} className="text-sm text-base-content">
                                    <span className="text-primary">&#x2022;</span> {h}
                                </p>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Footer dismiss */}
            <div className="bg-base-200 border-t border-border px-5 py-3 flex justify-end">
                <button
                    type="button"
                    onClick={handleDismiss}
                    className="btn px-4 py-1.5 text-sm font-medium bg-primary text-primary-content hover:bg-primary/80 transition-colors"
                >
                    Got it
                </button>
            </div>
        </div>
    )
})
