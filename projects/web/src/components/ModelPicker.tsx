import { type ModelEntry, MODEL_REGISTRY, DEFAULT_HARNESS_ID } from "../constants"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { Select } from "./ui/Select"

interface ModelPickerProps {
    value: string
    onChange: (modelId: string) => void
    harnessId?: HarnessId
}

function getModelEntries(harnessId: HarnessId): Array<{ id: string; content: string }> {
    const config = MODEL_REGISTRY[harnessId]
    if (!config) return []
    return config.models.map((m: ModelEntry) => ({
        id: m.id,
        content: m.label,
    }))
}

export function ModelPicker({ value, onChange, harnessId = DEFAULT_HARNESS_ID }: ModelPickerProps) {
    const entries = getModelEntries(harnessId)

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
