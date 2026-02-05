import { exhaustive } from "exhaustive"
import type { DisplayContext, MergedGroup, RenderMode } from "../events/messageGroups"

export function getRenderMode(group: MergedGroup, ctx: DisplayContext): RenderMode {
    const isPlanMode = ctx.sourceType === "plan" || ctx.sourceType === "revise"

    return exhaustive.tag(group, "type", {
        text: () => (isPlanMode && !ctx.isLastTextGroup ? "pill" : "inline"),
        tool: () => "pill",
        edit: () => (isPlanMode ? "pill" : "row"),
        write: () => (isPlanMode ? "pill" : "row"),
        bash: () => (isPlanMode ? "pill" : "row"),
        system: () => "pill",
        result: () => (isPlanMode ? "row" : "row"),
        stderr: () => (isPlanMode ? "pill" : "row"),
        todoWrite: () => (isPlanMode ? "pill" : "row"),
    })
}
