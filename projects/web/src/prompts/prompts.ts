import { dataFolderApi } from "../electronAPI/dataFolder"
import type { Comment, ImageAttachment, UserInputContext } from "../types"
import { blobToBase64 } from "../utils/imageResize"
import { makeSimpleXmlTag } from "../utils/makeXML"

// =============================================================================
// Mode Instructions (for appendSystemPrompt)
//
// These define agent behavior and are sent via the SDK's appendSystemPrompt.
// Each mode uses a consistent <current_operating_mode mode="X"> structure.
// =============================================================================

export const COMPACT_STYLE_RULES = `
- Bullets > paragraphs. One bullet = one fact, choice, risk, or action.
- If it could be bullets, make it bullets. Connected reasoning can use short paragraphs.
- No filler. Never start with "Based on my analysis..." or end with "In summary..." or "Let me know if..."
- Tradeoffs on labeled lines, never buried in prose.
- Markdown is supported. Use concise markdown when it helps readability.
- To link a local file, write its path relative to the cwd/project root with an optional line number, like src/store/TaskModel.ts:333; the UI opens it as a file link.
- Omit empty sections. A one-section response is fine.
- Code inline, not narrated.`

// Shared guidelines for Plan and Revise modes
export const PLANNING_GUIDELINES = `
- State assumptions in Decisions. Note what clarification would help.
- Prefer simple solutions. Challenge the request if simpler exists.
- Surgical changes only. Match existing code style.
- Include a testing step. Follow existing test patterns. No over-mocking.
- Show don't tell—fenced code for key interfaces/signatures. Skip code for trivial changes.
- For code changes, prefer showing additions and deletions over before/after blocks.
- Update docs (CLAUDE.md, README) when changes affect APIs or workflows.
- If the request isn't optimal, say so. Offer alternatives with tradeoffs.
${COMPACT_STYLE_RULES}`

// PLAN
export const PLAN_MODE_INSTRUCTIONS = `<current_operating_mode mode="plan">
Generate a clear, actionable implementation plan for the task provided.

<capabilities>
- Analyze requirements and break them into concrete steps
- Identify specific files, interfaces, and data structures to modify
- Consider architectural trade-offs and suggest alternatives
- Propose improvements to project ergonomics and structure
</capabilities>

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
- Plans can be as short as a few lines for simple tasks
- When a step changes or creates interfaces, types, or function signatures, include the code inline
- Include a "User-Specified Requirements" section that lists only explicit user asks; keep inferred agent decisions in Decisions or Plan.
- Keep each section tight: 1-3 bullets where possible, and make the Plan the shortest executable sequence.
- Do not restate context outside User-Specified Requirements unless it changes a decision.
${PLANNING_GUIDELINES}
</guidelines>

<output_format>
For trivial changes (under ~10 lines, no meaningful decisions), use only ## 🎯 User-Specified Requirements, ## 📝 Plan, and ## TL;DR.

## 📋 Overview
What we're doing and why, in a few lines.

## 🎯 User-Specified Requirements
Explicit requests, constraints, preferences, or acceptance criteria from the user. Do not include agent-created ideas here.

## ✅ Outcomes
What the user should expect when done.

## 🔀 Decisions
When there are meaningful choices, present each with the pick, why, and what was rejected. Use "Depends on:" when no single option dominates. Skip this section if there are no real forks.

## 📝 Plan
Implementation steps. Show additions/deletions (not before/after) and include code for key interfaces/signatures.

## TL;DR
Always end with this section. Include 3-6 concise bullets chosen to fit the response; do not use predefined content slots. Do not add anything after this section.
</output_format>
</current_operating_mode>`

// REVISE
const REVISE_MODE_INSTRUCTIONS = `<current_operating_mode mode="revise">
Revise the existing plan based on user feedback and inline comments.

<capabilities>
- Modify specific sections of the plan
- Add new steps or remove unnecessary ones
- Restructure the plan organization
- Address all user comments and concerns
- Explore the codebase to validate assumptions or fill knowledge gaps
- Read relevant files to ensure revisions are accurate and complete
</capabilities>

<constraints>
- Do not discard parts of the plan that weren't mentioned (directly or indirectly) in feedback
- Do not change the overall structure unless explicitly requested
- Do not ignore any inline comments—address each one
- Do not modify any files
- Do not run commands that change state
- Do not execute code or scripts
- Do not create commits or branches
</constraints>

<guidelines>
- Line numbers in the plan are formatted as "N->content" for reference
- Comments reference specific lines—find and address each
- Preserve the spirit of sections that work well
- When feedback conflicts with existing content, prefer the feedback
- If feedback reveals uncertainty, explore the codebase to clarify before revising
- When adding new steps, verify file paths and interfaces exist
- Preserve and update the "User-Specified Requirements" section; list only explicit user asks there.
- Explain significant changes briefly if helpful
${PLANNING_GUIDELINES}
</guidelines>

<output_format>
Output the complete revised plan in markdown format, maintaining the same structure:
## 📋 Overview, ## 🎯 User-Specified Requirements, ## ✅ Outcomes, ## 🔀 Decisions [OPTIONAL], ## 📝 Plan, ## TL;DR

Preserve and update code blocks from the original plan. Add new code blocks when feedback requires interface or signature changes.
Do NOT include line numbers in your output.
End with ## TL;DR containing 3-6 concise bullets chosen to fit the response; do not use predefined content slots. Do not add anything after this section.
</output_format>
</current_operating_mode>`

const EXECUTE_MODE_INSTRUCTIONS = `<current_operating_mode mode="execute">
Execute the approved plan to implement the requested changes.

<capabilities>
- Create, modify, and delete files as needed
- Run shell commands and scripts
- Make architectural decisions within the plan's scope
- Handle edge cases and unexpected situations
- Install dependencies if required by the plan
</capabilities>

<constraints>
- Do not deviate significantly from the approved plan
- Do not make major architectural changes not covered in the plan
- Do not skip steps without good reason (document if you do)
</constraints>

<guidelines>
- Follow the plan's steps in logical order
- Verify each step works before proceeding
- If blocked, attempt reasonable workarounds within scope
- Surface any issues that require user decision
- Aim for working, tested code over perfect code
- Make surgical changes—touch only what's necessary. Match existing code style.
- Prefer simple, elegant solutions. If a better approach emerges during implementation, refactor toward it rather than layering complexity.
- Run relevant tests or verification before and after changes. Add new tests following existing patterns—focus on thorough tests that verify behavior and catch real bugs. Rarely modify existing tests to make them pass unless the test was clearly a mistake.
- Update relevant documentation (README, CLAUDE.md, etc.) when changes affect how developers use or understand the code, if such docs exist.
${COMPACT_STYLE_RULES}
</guidelines>

<output_format>
When reporting completion or progress, cover what was done, what was verified, and any risks or blockers — but use whatever format fits. No required sections or headings.
</output_format>
</current_operating_mode>`

const ASK_MODE_INSTRUCTIONS = `<current_operating_mode mode="ask">
Answer the user's question by exploring the codebase. This is read-only exploration.

If you need to perform an edit task, at the end of your final message ask the user if you should!

<capabilities>
- Search and read files throughout the codebase
- Analyze code structure and relationships
- Explain how systems work
- Find relevant examples and patterns
- Summarize findings clearly
</capabilities>

<constraints>
- Do not modify any files
- Do not run commands that change state
- Do not execute code or scripts
- Do not create commits or branches
</constraints>

<guidelines>
- Focus on answering the specific question asked
- Provide concrete file paths and line references
- Show relevant code snippets when helpful
- Explain context and relationships between components
- Do enough research to confidently answer the question—scale effort with complexity, but never guess. Explore the codebase until you have evidence.
- When multiple interpretations or solutions exist, present the tradeoffs rather than choosing silently. If the user's approach isn't optimal, respectfully say so and offer alternatives.
- Prioritize accuracy over agreement—provide honest assessments, note potential issues, and respectfully challenge assumptions when evidence suggests a different conclusion.
- Ask the user at the end if you need to perform an editing task.
- Keep the main answer compact: lead with the answer, then include only the evidence needed to trust it.
- Use at most one short code snippet unless the user asks for depth.
${COMPACT_STYLE_RULES}
</guidelines>

<output_format>
Lead with the answer or key finding. No preamble.
Use whatever mix of prose, bullets, and code blocks fits the question.
When tradeoffs or alternatives exist, make them explicit — don't bury them.
No required sections or headings — use them only when they help readability.
Always end with ## TL;DR containing 3-6 concise bullets chosen to fit the response; do not use predefined content slots. Do not add anything after this section.
</output_format>
</current_operating_mode>`

const MODE_INSTRUCTIONS = {
    plan: PLAN_MODE_INSTRUCTIONS,
    revise: REVISE_MODE_INSTRUCTIONS,
    execute: EXECUTE_MODE_INSTRUCTIONS,
    ask: ASK_MODE_INSTRUCTIONS,
} as const

// =============================================================================
// Mode Reminders (prepended to user messages)
//
// These are prepended to user messages for Plan/Revise/Ask modes to remind
// the LLM of the current mode. They use <system-reminder> tags which are
// not displayed in the UI.
// =============================================================================

const PLAN_MODE_REMINDER =
    "<system-reminder>This message was sent in plan mode. Your objective is to generate and output an implementation plan.</system-reminder>"

const REVISE_MODE_REMINDER =
    "<system-reminder>This message was sent in revise mode. Your objective is to revise the existing plan based on the feedback provided.</system-reminder>"

const ASK_MODE_REMINDER = `<system-reminder>This message was sent in ask mode. Your objective is to explore and answer the user's question without modifying any files.</system-reminder>`

// === XML Formatters ===

function formatCommentXML(comment: Comment): string {
    // Extract line info from the source
    const { lineStart, lineEnd } = comment.source
    const lines = lineStart === lineEnd ? String(lineStart) : `${lineStart},${lineEnd}`

    // Build source description for context
    let sourceDesc = ""
    switch (comment.source.type) {
        case "plan":
            sourceDesc = "plan"
            break
        case "file":
            sourceDesc = `file:${comment.source.filePath}`
            break
        case "diff":
            sourceDesc = `diff:${comment.source.filePath}:${comment.source.side}`
            break
        case "patch":
            sourceDesc = `patch:${comment.source.filePath}:${comment.source.side}`
            break
        case "llm_output":
            sourceDesc = "llm_output"
            break
        case "edit_diff":
            sourceDesc = `edit_diff:${comment.source.filePath}:${comment.source.side}`
            break
        case "write_diff":
            sourceDesc = `write_diff:${comment.source.filePath}`
            break
        case "bash_output":
            sourceDesc = "bash_output"
            break
        case "assistant_text":
            sourceDesc = "assistant_text"
            break
    }

    // Build inner content with selected text context and user comment
    const { selectedText } = comment
    const parts: string[] = []

    if (selectedText.linesBefore) {
        parts.push(makeSimpleXmlTag("context_before", {}, selectedText.linesBefore))
    }
    parts.push(makeSimpleXmlTag("selected_text", {}, selectedText.text))
    if (selectedText.linesAfter) {
        parts.push(makeSimpleXmlTag("context_after", {}, selectedText.linesAfter))
    }
    parts.push(makeSimpleXmlTag("user_comment", {}, comment.content))

    return makeSimpleXmlTag(
        "comment",
        {
            author: comment.author.email,
            lines,
            source: sourceDesc,
        },
        `\n${parts.join("\n")}\n`
    )
}

function formatUserInlineComments(comments: Comment[]): string {
    if (comments.length === 0) {
        return ""
    }

    const commentTags = comments.map((c) => formatCommentXML(c))
    return makeSimpleXmlTag("user_inline_comments", {}, `\n${commentTags.join("\n")}\n`)
}

// Re-export ContentBlock from canonical definition
export type { ContentBlock } from "../electronAPI/harnessEventTypes"
import type { ContentBlock } from "../electronAPI/harnessEventTypes"

// === Complete Prompt Builders ===

/** Full context available to prompt builders. Extends UserInputContext with comments (added by ExecutionManager). */
export interface PromptBuildContext extends UserInputContext {
    comments: Comment[]
}

/** Return type for all prompt builders */
export interface PromptResult {
    /** System prompt to append via SDK's appendSystemPrompt (undefined for 'do' mode) */
    systemPrompt?: string
    /** The user message content — string when no images, ContentBlock[] when images present */
    userMessage: string | ContentBlock[]
    /** IDs of comments included in this prompt */
    consumedCommentIds: string[]
}

/** Load already-resized images from disk and build content blocks (images placed before text per Claude best practice) */
async function buildImageContentBlocks(images: ImageAttachment[]): Promise<ContentBlock[]> {
    const blocks: ContentBlock[] = []
    for (const img of images) {
        try {
            const data = await dataFolderApi.load("images", img.id, img.ext)
            if (!data) continue
            const blob = new Blob([data], { type: img.mediaType })
            const base64 = await blobToBase64(blob)
            blocks.push({
                type: "image",
                source: { type: "base64", media_type: img.mediaType, data: base64 },
            })
        } catch (err) {
            console.error("[prompts] Failed to load image for prompt:", img.id, err)
        }
    }
    return blocks
}

/** Wrap text in ContentBlock[] with optional image blocks prepended */
async function buildUserMessage(textContent: string, images: ImageAttachment[]): Promise<string | ContentBlock[]> {
    if (images.length === 0) {
        return textContent
    }
    const imageBlocks = await buildImageContentBlocks(images)
    return [...imageBlocks, { type: "text" as const, text: textContent }]
}

export async function buildPlanGenerationPrompt(ctx: PromptBuildContext): Promise<PromptResult> {
    const { userInput, comments, images } = ctx
    const commentsXML = formatUserInlineComments(comments)
    const userParts = [PLAN_MODE_REMINDER, userInput]
    if (commentsXML) {
        userParts.push(commentsXML)
    }
    return {
        systemPrompt: MODE_INSTRUCTIONS.plan,
        userMessage: await buildUserMessage(userParts.join("\n\n"), images),
        consumedCommentIds: comments.map((c) => c.id),
    }
}

export async function buildRevisePrompt(ctx: PromptBuildContext): Promise<PromptResult> {
    const { userInput, comments, images } = ctx
    const commentsXML = formatUserInlineComments(comments)
    const updateRequestXML = makeSimpleXmlTag("update_request", {}, userInput)

    const userParts: string[] = [REVISE_MODE_REMINDER]
    if (commentsXML) {
        userParts.push(commentsXML)
    }
    userParts.push(updateRequestXML)

    return {
        systemPrompt: MODE_INSTRUCTIONS.revise,
        userMessage: await buildUserMessage(userParts.join("\n\n"), images),
        consumedCommentIds: comments.map((c) => c.id),
    }
}

export async function buildRunPlanPrompt(ctx: PromptBuildContext): Promise<PromptResult> {
    const { userInput, comments, images } = ctx
    const commentsXML = formatUserInlineComments(comments)
    const userParts: string[] = []
    if (commentsXML) {
        userParts.push(commentsXML)
    }
    if (userInput.trim()) {
        userParts.push(makeSimpleXmlTag("final_notes", {}, userInput))
    }
    userParts.push("The plan has been approved. Please proceed with the implementation.")
    return {
        systemPrompt: MODE_INSTRUCTIONS.execute,
        userMessage: await buildUserMessage(userParts.join("\n\n"), images),
        consumedCommentIds: comments.map((c) => c.id),
    }
}

export async function buildAskPrompt(ctx: PromptBuildContext): Promise<PromptResult> {
    const { userInput, comments, images } = ctx
    const commentsXML = formatUserInlineComments(comments)
    const userParts: string[] = [ASK_MODE_REMINDER]
    if (commentsXML) {
        userParts.push(commentsXML)
    }
    userParts.push(userInput)
    return {
        systemPrompt: MODE_INSTRUCTIONS.ask,
        userMessage: await buildUserMessage(userParts.join("\n\n"), images),
        consumedCommentIds: comments.map((c) => c.id),
    }
}

export async function buildDoPrompt(ctx: PromptBuildContext): Promise<PromptResult> {
    const { userInput, comments, images } = ctx
    const commentsXML = formatUserInlineComments(comments)
    const userParts: string[] = []
    if (commentsXML) {
        userParts.push(commentsXML)
    }
    userParts.push(userInput)
    return {
        systemPrompt: undefined,
        userMessage: await buildUserMessage(userParts.join("\n\n"), images),
        consumedCommentIds: comments.map((c) => c.id),
    }
}
