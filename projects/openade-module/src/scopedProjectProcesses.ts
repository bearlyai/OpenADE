import path from "node:path"
import type {
    OpenADEProcsConfig,
    OpenADEProcsProcessDef,
    OpenADEProjectProcessConfigError,
    OpenADEProjectProcessDefinition,
} from "./types"

export interface OpenADEProjectProcessDefinitionsResult {
    processes: OpenADEProjectProcessDefinition[]
    errors: OpenADEProjectProcessConfigError[]
}

function ensurePathInsideRoot(root: string, target: string, message: string): void {
    const resolvedRoot = path.resolve(root)
    const resolvedTarget = path.resolve(target)
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(message)
    }
}

export function resolveOpenADEProjectProcessCwd(root: string, configRelativePath: string, workDir?: string): string {
    const resolvedRoot = path.resolve(root)
    const configPath = path.resolve(resolvedRoot, configRelativePath)
    ensurePathInsideRoot(resolvedRoot, configPath, "process config path is outside the repository")
    const cwd = path.resolve(path.dirname(configPath), workDir ?? "")
    ensurePathInsideRoot(resolvedRoot, cwd, "process cwd is outside the repository")
    return cwd
}

export function openADEProjectProcessDefinitionFromConfig(
    root: string,
    config: OpenADEProcsConfig,
    processDef: OpenADEProcsProcessDef
): OpenADEProjectProcessDefinition {
    return {
        id: processDef.id,
        name: processDef.name,
        command: processDef.command,
        workDir: processDef.workDir,
        url: processDef.url,
        type: processDef.type,
        configPath: config.relativePath,
        cwd: resolveOpenADEProjectProcessCwd(root, config.relativePath, processDef.workDir),
    }
}

export function buildOpenADEProjectProcessDefinitions(params: {
    root: string
    configs: OpenADEProcsConfig[]
}): OpenADEProjectProcessDefinitionsResult {
    const processes: OpenADEProjectProcessDefinition[] = []
    const errors: OpenADEProjectProcessConfigError[] = []

    for (const config of params.configs) {
        for (const processDef of config.processes) {
            try {
                processes.push(openADEProjectProcessDefinitionFromConfig(params.root, config, processDef))
            } catch (error) {
                errors.push({
                    relativePath: config.relativePath,
                    error: error instanceof Error ? error.message : "Process cwd is invalid",
                })
            }
        }
    }

    return { processes, errors }
}
