import type { ThinkingLevel } from "../store/TaskModel"
import { Select } from "./ui/Select"

const THINKING_ENTRIES: Array<{ id: ThinkingLevel; content: string }> = [
    { id: "low", content: "Low" },
    { id: "med", content: "Med" },
    { id: "high", content: "High" },
    { id: "max", content: "Max" },
]

export function ThinkingPicker({ value, onChange }: { value: ThinkingLevel; onChange: (level: ThinkingLevel) => void }) {
    return (
        <Select
            selectedId={value}
            entries={THINKING_ENTRIES}
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
