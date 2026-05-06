import { exhaustive } from "exhaustive"
import type { GroupRenderer, MergedGroup } from "../../events/messageGroups"
import { bashRenderer } from "./bashRenderer"
import { editRenderer } from "./editRenderer"
import { fileChangeRenderer } from "./fileChangeRenderer"
import { resultRenderer } from "./resultRenderer"
import { stderrRenderer } from "./stderrRenderer"
import { systemRenderer } from "./systemRenderer"
import { textRenderer } from "./textRenderer"
import { thinkingRenderer } from "./thinkingRenderer"
import { todoWriteRenderer } from "./todoWriteRenderer"
import { toolRenderer } from "./toolRenderer"
import { unknownRenderer } from "./unknownRenderer"
import { writeRenderer } from "./writeRenderer"

// biome-ignore lint/suspicious/noExplicitAny: Generic renderer lookup requires any
export function getRenderer(group: MergedGroup): GroupRenderer<any> {
    return exhaustive.tag(group, "type", {
        text: () => textRenderer,
        thinking: () => thinkingRenderer,
        tool: () => toolRenderer,
        edit: () => editRenderer,
        write: () => writeRenderer,
        fileChange: () => fileChangeRenderer,
        bash: () => bashRenderer,
        system: () => systemRenderer,
        result: () => resultRenderer,
        stderr: () => stderrRenderer,
        unknown: () => unknownRenderer,
        todoWrite: () => todoWriteRenderer,
    })
}
