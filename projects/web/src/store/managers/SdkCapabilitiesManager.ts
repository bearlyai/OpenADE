/**
 * SdkCapabilitiesManager
 *
 * Manages SDK-discovered capabilities (slash commands, skills, plugins)
 * for the current workspace. Fetches from the Electron-side cache which
 * is populated from system:init messages during normal queries and
 * can run a lightweight probe on first access.
 */

import { makeAutoObservable, runInAction } from "mobx"
import { type SdkCapabilities, getSdkCapabilities } from "../../electronAPI/capabilities"

export interface SlashCommandEntry {
    name: string
    type: "slash_command" | "skill"
}

export class SdkCapabilitiesManager {
    slashCommands: string[] = []
    skills: string[] = []
    plugins: { name: string; path: string }[] = []
    loading = false
    loaded = false

    constructor() {
        makeAutoObservable(this)
    }

    /**
     * Load capabilities for a working directory.
     * Returns cached data instantly if available, or runs a probe (~1.4s).
     */
    async loadCapabilities(cwd: string): Promise<void> {
        if (this.loading) return

        runInAction(() => {
            this.loading = true
        })

        try {
            const result = await getSdkCapabilities(cwd)
            if (result) {
                this.applyCapabilities(result)
            }
        } catch (err) {
            console.error("[SdkCapabilitiesManager] Failed to load capabilities:", err)
        } finally {
            runInAction(() => {
                this.loading = false
                this.loaded = true
            })
        }
    }

    /**
     * Update capabilities directly from a system:init SDK message.
     * Called during streaming to keep the store fresh without an extra IPC call.
     */
    updateFromInitMessage(msg: Record<string, unknown>): void {
        this.applyCapabilities({
            slash_commands: (msg.slash_commands as string[]) ?? [],
            skills: (msg.skills as string[]) ?? [],
            plugins: (msg.plugins as { name: string; path: string }[]) ?? [],
            cachedAt: Date.now(),
        })
    }

    private applyCapabilities(data: SdkCapabilities): void {
        runInAction(() => {
            this.slashCommands = data.slash_commands
            this.skills = data.skills
            this.plugins = data.plugins
        })
    }

    /**
     * Unified list of all available commands for the autocomplete menu.
     * Skills come first, then built-in slash commands.
     */
    get allCommands(): SlashCommandEntry[] {
        const entries: SlashCommandEntry[] = []
        for (const name of this.skills) {
            entries.push({ name, type: "skill" })
        }
        for (const name of this.slashCommands) {
            // Avoid duplicates if a skill and slash_command share the same name
            if (!this.skills.includes(name)) {
                entries.push({ name, type: "slash_command" })
            }
        }
        return entries
    }
}
