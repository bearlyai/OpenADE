import { useEffect } from "react"
import { DEFAULT_HARNESS_ID } from "../constants"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { getVisibleModelEntries, getVisibleModelId } from "../modelVisibility"
import { Select } from "./ui/Select"

interface ModelPickerProps {
    value: string
    onChange: (modelId: string) => void
    harnessId?: HarnessId
}

export function ModelPicker({ value, onChange, harnessId = DEFAULT_HARNESS_ID }: ModelPickerProps) {
    const entries = getVisibleModelEntries(harnessId).map((model) => ({
        id: model.id,
        content: model.label,
    }))
    const visibleValue = getVisibleModelId(value, harnessId)

    useEffect(() => {
        if (visibleValue !== value) {
            onChange(visibleValue)
        }
    }, [visibleValue, value, onChange])

    return (
        <Select
            selectedId={visibleValue}
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
