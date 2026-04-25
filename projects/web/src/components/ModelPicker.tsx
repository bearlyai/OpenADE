import { useEffect } from "react"
import { type ModelEntry, MODEL_REGISTRY, DEFAULT_HARNESS_ID } from "../constants"
import type { HarnessId } from "../electronAPI/harnessEventTypes"
import { Select } from "./ui/Select"

interface ModelPickerProps {
    value: string
    onChange: (modelId: string) => void
    harnessId?: HarnessId
}

function shouldHideModelInPicker(model: ModelEntry, harnessId: HarnessId): boolean {
    return harnessId === "claude-code" && model.id === "opus"
}

function getModelEntries(harnessId: HarnessId): Array<{ id: string; content: string }> {
    const config = MODEL_REGISTRY[harnessId]
    if (!config) return []
    return config.models
        .filter((m: ModelEntry) => !shouldHideModelInPicker(m, harnessId))
        .map((m: ModelEntry) => ({
            id: m.id,
            content: m.label,
        }))
}

function getVisibleModelId(value: string, harnessId: HarnessId): string {
    const config = MODEL_REGISTRY[harnessId]
    if (!config) return value

    const current = config.models.find((model) => model.id === value)
    if (!current || !shouldHideModelInPicker(current, harnessId)) {
        return value
    }

    const replacement = [...config.models].reverse().find((model) => model.displayClass === current.displayClass && !shouldHideModelInPicker(model, harnessId))
    return replacement?.id ?? value
}

export function ModelPicker({ value, onChange, harnessId = DEFAULT_HARNESS_ID }: ModelPickerProps) {
    const entries = getModelEntries(harnessId)
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
