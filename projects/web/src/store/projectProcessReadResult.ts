import type { OpenADECronDefinitionsReadResult, OpenADEProjectProcessListResult } from "../../../openade-module/src"
import type { ProcsConfig, ReadProcsResult } from "../electronAPI/procs"

export function readProcsResultFromProductProcesses(result: OpenADEProjectProcessListResult): ReadProcsResult {
    const configs = result.configs ?? configsFromFlattenedProcesses(result)
    return {
        repoRoot: result.repoRoot,
        searchRoot: result.searchRoot,
        isWorktree: result.isWorktree,
        worktreeRoot: result.worktreeRoot,
        configs,
        errors: result.errors,
    }
}

export function readProcsResultFromProductCronDefinitions(result: OpenADECronDefinitionsReadResult): ReadProcsResult {
    return {
        repoRoot: result.repoRoot,
        searchRoot: result.searchRoot,
        isWorktree: result.isWorktree,
        worktreeRoot: result.worktreeRoot,
        configs: result.configs.map((config) => ({
            relativePath: config.relativePath,
            processes: [],
            crons: config.crons,
        })),
        errors: result.errors,
    }
}

function configsFromFlattenedProcesses(result: OpenADEProjectProcessListResult): ProcsConfig[] {
    const configsByPath = new Map<string, ProcsConfig>()
    for (const process of result.processes) {
        const config = configsByPath.get(process.configPath) ?? {
            relativePath: process.configPath,
            processes: [],
            crons: [],
        }
        config.processes.push({
            id: process.id,
            name: process.name,
            command: process.command,
            workDir: process.workDir,
            url: process.url,
            type: process.type,
        })
        configsByPath.set(process.configPath, config)
    }
    return [...configsByPath.values()]
}
