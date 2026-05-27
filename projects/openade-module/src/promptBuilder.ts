import type { OpenADEActionEventSource } from "./types"

export interface OpenADEPromptComment {
    id: string
    content?: unknown
    source?: unknown
    selectedText?: unknown
    author?: unknown
}

export interface OpenADEPromptBuildRequest {
    type: "plan" | "do" | "ask" | "revise" | "run_plan"
    input: string
    comments?: OpenADEPromptComment[]
    label?: string
    includeComments?: boolean
    planEventId?: string
}

export interface OpenADEPromptBuildResult {
    source: OpenADEActionEventSource
    systemPrompt?: string
    userMessage: string
    consumedCommentIds: string[]
    readOnly: boolean
    createSnapshot: boolean
}

const COMPACT_STYLE_RULES = `
- Bullets > paragraphs. One bullet = one fact, choice, risk, or action.
- If it could be bullets, make it bullets. Connected reasoning can use short paragraphs.
- No filler. Never start with "Based on my analysis..." or end with "In summary..." or "Let me know if..."
- Tradeoffs on labeled lines, never buried in prose.
- Omit empty sections. A one-section response is fine.
- Code inline, not narrated.`

const PLANNING_GUIDELINES = `
- State assumptions in Decisions. Note what clarification would help.
- Prefer simple solutions. Challenge the request if simpler exists.
- Surgical changes only. Match existing code style.
- Include a testing step. Follow existing test patterns. No over-mocking.
- Show don't tell—fenced code for key interfaces/signatures. Skip code for trivial changes.
- For code changes, prefer showing additions and deletions over before/after blocks.
- Update docs (CLAUDE.md, README) when changes affect APIs or workflows.
- If the request isn't optimal, say so. Offer alternatives with tradeoffs.
${COMPACT_STYLE_RULES}`

const PLAN_MODE_INSTRUCTIONS = `<current_operating_mode mode="plan">
Generate a clear, actionable implementation plan for the task provided.

<constraints>
- Do not generate plans longer than 400 lines unless explicitly requested
- Do not include obvious boilerplate or trivial details
- Do not make assumptions without noting them as decisions
- Do not modify any files
- Do not run commands that change state
- Do not execute code or scripts
- Do not create commits or branches
</constraints>

<guidelines>
${PLANNING_GUIDELINES}
</guidelines>
</current_operating_mode>`

const ASK_MODE_INSTRUCTIONS = `<current_operating_mode mode="ask">
Answer the user's question by exploring the codebase. This is read-only exploration.

<constraints>
- Do not modify any files
- Do not run commands that change state
- Do not execute code or scripts
- Do not create commits or branches
</constraints>

<guidelines>
${COMPACT_STYLE_RULES}
</guidelines>
</current_operating_mode>`

const REVISE_MODE_INSTRUCTIONS = `<current_operating_mode mode="revise">
Revise the existing plan based on user feedback and inline comments.

<constraints>
- Do not discard parts of the plan that were not mentioned in feedback.
- Do not change the overall structure unless explicitly requested.
- Do not ignore inline comments.
- Do not modify files.
- Do not run commands that change state.
</constraints>

<guidelines>
- Preserve and update explicit user requirements.
- Prefer the new feedback when it conflicts with the existing plan.
- Explore the codebase only when needed to make the revised plan accurate.
${PLANNING_GUIDELINES}
</guidelines>
</current_operating_mode>`

const EXECUTE_MODE_INSTRUCTIONS = `<current_operating_mode mode="execute">
Execute the approved plan to implement the requested changes.

<constraints>
- Do not deviate significantly from the approved plan.
- Do not make major architectural changes not covered in the plan.
- Do not skip steps without good reason.
</constraints>

<guidelines>
- Follow the plan's steps in logical order.
- Verify each step works before proceeding.
- Surface issues that require user decision.
- Make surgical changes and match existing code style.
- Run relevant tests or verification before and after changes.
${COMPACT_STYLE_RULES}
</guidelines>
</current_operating_mode>`

const PLAN_MODE_REMINDER =
    "<system-reminder>This message was sent in plan mode. Your objective is to generate and output an implementation plan.</system-reminder>"

const ASK_MODE_REMINDER =
    "<system-reminder>This message was sent in ask mode. Your objective is to explore and answer the user's question without modifying any files.</system-reminder>"

const REVISE_MODE_REMINDER =
    "<system-reminder>This message was sent in revise mode. Your objective is to revise the existing plan based on the feedback provided.</system-reminder>"

const ACTION_RESPONSE_STYLE_INSTRUCTION = [
    "<action_response_style>",
    "Keep final user-facing completion reports compact.",
    "Always end final user-facing completion reports with ## TL;DR containing 3-6 concise bullets chosen to fit the response; do not use predefined content slots. Do not add anything after this section.",
    "</action_response_style>",
].join("\n")

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback
}

function makeSimpleXmlTag(tagName: string, attrs: Record<string, string | number | boolean | undefined>, content?: string): string {
    const attrText = Object.entries(attrs)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => ` ${key}="${String(value)}"`)
        .join("")
    return content === undefined ? `<${tagName}${attrText}/>` : `<${tagName}${attrText}>${content}</${tagName}>`
}

function lineRange(source: Record<string, unknown>): string {
    const lineStart = typeof source.lineStart === "number" ? source.lineStart : 0
    const lineEnd = typeof source.lineEnd === "number" ? source.lineEnd : lineStart
    return lineStart === lineEnd ? String(lineStart) : `${lineStart},${lineEnd}`
}

function sourceDescription(source: Record<string, unknown>): string {
    switch (source.type) {
        case "plan":
            return "plan"
        case "file":
            return `file:${stringValue(source.filePath)}`
        case "diff":
            return `diff:${stringValue(source.filePath)}:${stringValue(source.side)}`
        case "patch":
            return `patch:${stringValue(source.filePath)}:${stringValue(source.side)}`
        case "llm_output":
            return "llm_output"
        case "edit_diff":
            return `edit_diff:${stringValue(source.filePath)}:${stringValue(source.side)}`
        case "write_diff":
            return `write_diff:${stringValue(source.filePath)}`
        case "bash_output":
            return "bash_output"
        case "assistant_text":
            return "assistant_text"
        default:
            return stringValue(source.type, "unknown")
    }
}

function formatCommentXml(comment: OpenADEPromptComment): string | null {
    if (!isRecord(comment.source)) return null
    const selectedText = isRecord(comment.selectedText) ? comment.selectedText : {}
    const author = isRecord(comment.author) ? comment.author : {}
    const parts: string[] = []
    const linesBefore = stringValue(selectedText.linesBefore)
    const text = stringValue(selectedText.text)
    const linesAfter = stringValue(selectedText.linesAfter)
    if (linesBefore) parts.push(makeSimpleXmlTag("context_before", {}, linesBefore))
    parts.push(makeSimpleXmlTag("selected_text", {}, text))
    if (linesAfter) parts.push(makeSimpleXmlTag("context_after", {}, linesAfter))
    parts.push(makeSimpleXmlTag("user_comment", {}, stringValue(comment.content)))
    return makeSimpleXmlTag(
        "comment",
        {
            author: stringValue(author.email),
            lines: lineRange(comment.source),
            source: sourceDescription(comment.source),
        },
        `\n${parts.join("\n")}\n`
    )
}

function formatCommentsXml(comments: OpenADEPromptComment[]): string {
    const commentTags = comments.map(formatCommentXml).filter((comment): comment is string => comment !== null)
    return commentTags.length > 0 ? makeSimpleXmlTag("user_inline_comments", {}, `\n${commentTags.join("\n")}\n`) : ""
}

function requirePlanEventId(request: OpenADEPromptBuildRequest): string {
    if (request.planEventId) return request.planEventId
    throw new Error(`${request.type} requires a completed plan event`)
}

export function buildOpenADEPrompt(request: OpenADEPromptBuildRequest): OpenADEPromptBuildResult {
    const comments = request.includeComments === false ? [] : (request.comments ?? [])
    const commentsXml = formatCommentsXml(comments)
    const consumedCommentIds = comments.map((comment) => comment.id)

    if (request.type === "plan") {
        const userParts = [PLAN_MODE_REMINDER, request.input]
        if (commentsXml) userParts.push(commentsXml)
        return {
            source: { type: "plan", userLabel: request.label ?? "Plan" },
            systemPrompt: PLAN_MODE_INSTRUCTIONS,
            userMessage: userParts.join("\n\n"),
            consumedCommentIds,
            readOnly: true,
            createSnapshot: false,
        }
    }

    if (request.type === "ask") {
        const userParts = [ASK_MODE_REMINDER]
        if (commentsXml) userParts.push(commentsXml)
        userParts.push(request.input.trim())
        return {
            source: { type: "ask", userLabel: request.label ?? "Ask" },
            systemPrompt: ASK_MODE_INSTRUCTIONS,
            userMessage: userParts.join("\n\n"),
            consumedCommentIds,
            readOnly: true,
            createSnapshot: true,
        }
    }

    if (request.type === "revise") {
        const planEventId = requirePlanEventId(request)
        const userParts = [REVISE_MODE_REMINDER]
        if (commentsXml) userParts.push(commentsXml)
        userParts.push(makeSimpleXmlTag("update_request", {}, request.input.trim()))
        return {
            source: { type: "revise", userLabel: request.label ?? "Revise Plan", parentEventId: planEventId },
            systemPrompt: REVISE_MODE_INSTRUCTIONS,
            userMessage: userParts.join("\n\n"),
            consumedCommentIds,
            readOnly: true,
            createSnapshot: false,
        }
    }

    if (request.type === "run_plan") {
        const planEventId = requirePlanEventId(request)
        const userParts: string[] = []
        if (commentsXml) userParts.push(commentsXml)
        if (request.input.trim()) userParts.push(makeSimpleXmlTag("final_notes", {}, request.input.trim()))
        userParts.push("The plan has been approved. Please proceed with the implementation.")
        return {
            source: { type: "run_plan", userLabel: request.label ?? "Run Plan", planEventId },
            systemPrompt: EXECUTE_MODE_INSTRUCTIONS,
            userMessage: userParts.join("\n\n"),
            consumedCommentIds,
            readOnly: false,
            createSnapshot: true,
        }
    }

    const userParts: string[] = []
    if (commentsXml) userParts.push(commentsXml)
    userParts.push(request.input.trim())
    return {
        source: { type: "do", userLabel: request.label ?? "Do" },
        systemPrompt: ACTION_RESPONSE_STYLE_INSTRUCTION,
        userMessage: userParts.join("\n\n"),
        consumedCommentIds,
        readOnly: false,
        createSnapshot: true,
    }
}
