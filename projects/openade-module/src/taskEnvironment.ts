export interface OpenADETaskEnvironmentSetupOutputParams {
    worktreeDir: string
    workingDir: string
    sourceBranch: string
    mergeBaseCommit?: string
}

export function buildOpenADETaskEnvironmentSetupOutput(params: OpenADETaskEnvironmentSetupOutputParams): string {
    return [
        `Worktree: ${params.worktreeDir}`,
        `Working directory: ${params.workingDir}`,
        `Branch: ${params.sourceBranch}`,
        params.mergeBaseCommit ? `Merge base: ${params.mergeBaseCommit.slice(0, 8)}` : "",
    ]
        .filter(Boolean)
        .join("\n")
}
