import { CLAUDE_MODELS, type ClaudeModelId } from "../constants"
import { Select } from "./ui/Select"

interface ModelPickerProps {
    value: ClaudeModelId
    onChange: (modelId: ClaudeModelId) => void
}

const MODEL_ENTRIES = CLAUDE_MODELS.map((m) => ({
    id: m.id as ClaudeModelId,
    content: m.label,
}))

export function ModelPicker({ value, onChange }: ModelPickerProps) {
    return (
        <Select
            selectedId={value}
            entries={MODEL_ENTRIES}
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
