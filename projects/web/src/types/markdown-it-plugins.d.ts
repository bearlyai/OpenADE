declare module "markdown-it-task-lists" {
    interface TaskListOptions {
        enabled?: boolean
        label?: boolean
        labelAfter?: boolean
    }

    const taskLists: MarkdownIt.PluginWithOptions<TaskListOptions>
    export default taskLists
}

declare module "markdown-it-texmath" {
    interface TexmathOptions {
        engine: unknown
        delimiters?: "dollars" | "brackets" | "gitlab" | "julia" | "kramdown"
        katexOptions?: Record<string, unknown>
    }

    const texmath: MarkdownIt.PluginWithOptions<TexmathOptions>
    export default texmath
}
