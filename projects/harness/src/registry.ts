import type { Harness } from "./harness.js"
import type { HarnessId, HarnessInstallStatus } from "./types.js"
import { HarnessError } from "./errors.js"

export class HarnessRegistry {
    private harnesses = new Map<HarnessId, Harness>()

    register(harness: Harness): void {
        if (this.harnesses.has(harness.id)) {
            throw new HarnessError(`Harness "${harness.id}" is already registered`, "unknown", harness.id)
        }
        this.harnesses.set(harness.id, harness)
    }

    get(id: HarnessId): Harness | undefined {
        return this.harnesses.get(id)
    }

    getOrThrow(id: HarnessId): Harness {
        const harness = this.harnesses.get(id)
        if (!harness) {
            throw new HarnessError(`Harness "${id}" is not registered`, "unknown", id)
        }
        return harness
    }

    getAll(): Harness[] {
        return Array.from(this.harnesses.values())
    }

    has(id: HarnessId): boolean {
        return this.harnesses.has(id)
    }

    async checkAllInstallStatus(): Promise<Map<HarnessId, HarnessInstallStatus>> {
        const entries = Array.from(this.harnesses.entries())
        const results = await Promise.all(
            entries.map(async ([id, harness]) => {
                const status = await harness.checkInstallStatus()
                return [id, status] as const
            })
        )
        return new Map(results)
    }
}
