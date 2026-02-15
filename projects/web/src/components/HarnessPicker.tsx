import { MODEL_REGISTRY, HARNESS_META } from "../constants"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { Select } from "./ui/Select"

interface HarnessPickerProps {
    value: HarnessId
    onChange: (harnessId: HarnessId) => void
}

function getHarnessEntries(): Array<{ id: HarnessId; content: string }> {
    return (Object.keys(MODEL_REGISTRY) as HarnessId[]).map((id) => ({
        id,
        content: HARNESS_META[id]?.name ?? id,
    }))
}

export function HarnessPicker({ value, onChange }: HarnessPickerProps) {
    const entries = getHarnessEntries()

    // Don't render if there's only one harness
    if (entries.length <= 1) return null

    return (
        <Select
            selectedId={value}
            entries={entries}
            onSelect={(entry) => onChange(entry.id)}
            noArrow
            side="top"
            align="end"
            className={{
                trigger: "h-7 px-2 text-xs font-mono text-muted border-0 bg-transparent hover:bg-base-200",
                value: "text-xs",
            }}
        />
    )
}
