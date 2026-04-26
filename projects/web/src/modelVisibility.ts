import { type ModelEntry, MODEL_REGISTRY } from "./constants"
import type { HarnessId } from "./electronAPI/harnessEventTypes"

export function shouldHideModelInPicker(model: ModelEntry, harnessId: HarnessId): boolean {
    return harnessId === "claude-code" && model.id === "opus"
}

export function getVisibleModelEntries(harnessId: HarnessId): ModelEntry[] {
    const config = MODEL_REGISTRY[harnessId]
    if (!config) return []
    return config.models.filter((model) => !shouldHideModelInPicker(model, harnessId))
}

export function getVisibleModelId(value: string, harnessId: HarnessId): string {
    const config = MODEL_REGISTRY[harnessId]
    if (!config) return value

    const current = config.models.find((model) => model.id === value)
    if (!current || !shouldHideModelInPicker(current, harnessId)) {
        return value
    }

    const replacement = [...config.models].reverse().find((model) => model.displayClass === current.displayClass && !shouldHideModelInPicker(model, harnessId))
    return replacement?.id ?? value
}
