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

// Shared guidelines for Plan and Revise modes
const PLANNING_GUIDELINES = `
- State assumptions explicitly in the Decisions section. If uncertain about requirements, note what clarification would help.
- Prefer simple, elegant solutions over complex ones. Challenge the request if a simpler approach exists. If you see a better approach than what was requested, present it as an alternative.
- Plan for surgical changes—only what's necessary to complete the task. Match existing code style and patterns.
- For code changes, include a testing step. Follow existing test patterns. Write thorough tests that verify behavior and catch real bugs. Avoid over-mocking—design code to be easily testable.
- If the codebase has documentation (CLAUDE.md, README, etc.), include updates when changes affect APIs, configuration, or workflows.
- If the request isn't optimal, respectfully say so and offer alternatives with tradeoffs. Prioritize helpful guidance over agreement.`

// PLAN
const PLAN_MODE_INSTRUCTIONS = `<current_operating_mode mode="plan">
Generate a clear, actionable implementation plan for the task provided.

<capabilities>
- Analyze requirements and break them into concrete steps
- Identify specific files, interfaces, and data structures to modify
- Consider architectural trade-offs and suggest alternatives
- Propose improvements to project ergonomics and structure
</capabilities>

<constraints>
- Do not generate plans longer than 200 lines unless explicitly requested
- Do not include obvious boilerplate or trivial details
- Do not make assumptions without noting them as decisions
- Do not modify any files
- Do not run commands that change state
- Do not execute code or scripts
- Do not create commits or branches
</constraints>

<guidelines>
- Be thorough but concise—include what matters, skip what doesn't
- Plans can be as short as a few lines for simple tasks
- Provide key context sufficient for handoff to another person
- Use markdown format with clear section headers
- Keep file/interface mentions brief and to the point
${PLANNING_GUIDELINES}
</guidelines>

<output_format>
## 📋 Overview
Brief summary of the plan

## ✅ Outcomes
A bulleted list of outcomes to expect when the task is completed.

## 🔀 Decisions
When there are meaningful choices to make, present each as a decision with alternatives. Limit to 8 key decisions.:

## Short decision title

One sentence of context explaining why this matters.

- ✅{Option A} - the option and why this is recommended
- Rejected: {Option B} - the option and trade-off or when you might prefer this
- Rejected: {Option C} - trade-off or when you might prefer this

## 📝 Plan
A plan in any format appropriate for the task (list, sections, bullets, numbered list, or paragraph).

Output the complete plan as your final message in markdown format.
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
- Explain significant changes briefly if helpful
${PLANNING_GUIDELINES}
</guidelines>

<output_format>
Output the complete revised plan in markdown format, maintaining the same structure:
## 📋 Overview, ## ✅ Outcomes, ## 🔀 Decisions [OPTIONAL], ## 📝 Plan

Do NOT include line numbers in your output.
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
</guidelines>
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
</guidelines>
</current_operating_mode>`

const MODE_INSTRUCTIONS = {
    plan: PLAN_MODE_INSTRUCTIONS,
    revise: REVISE_MODE_INSTRUCTIONS,
    execute: EXECUTE_MODE_INSTRUCTIONS,
    ask: ASK_MODE_INSTRUCTIONS,
} as const

// =============================================================================
// Action Prompts (for user message)
//
// These are one-off action requests sent as user messages, not operating modes.
// To add a new action prompt:
// 1. Define a const with clear, context-independent instructions
// 2. Add it to ACTION_PROMPTS
// 3. Import and use via ACTION_PROMPTS.{name} in InputManager or elsewhere
// =============================================================================

const RETRY_PROMPT =
    "Retry the previous action that failed or was interrupted. Analyze why it failed and address the root cause. If the same approach will fail again, try an alternative. Do not undo work that succeeded before the failure."

const COMMIT_PROMPT = `Review the current git working tree and create a commit for the changes.

- Run git status and git diff to understand what changed
- Write a clear commit message that explains the "why" not just the "what"
- Stage only the relevant changes (use git add selectively if needed)
- Do not undo, revert, or modify any existing changes—commit what's there
- Show the commit hash, message, and file statistics

This is a one-time commit request. Do not continue committing after this unless explicitly asked.`

function buildPushPrompt(hasGhCli: boolean, branch: string): string {
    const ghSection = hasGhCli
        ? `After pushing, check for an existing pull request:
- Run \`gh pr view --json url,number\` to check if a PR already exists for this branch
- If a PR exists, output its URL
- If no PR exists and this is NOT a main/master/default branch, create one:
  1. Review the commit log for this branch (e.g. \`git log --oneline main..HEAD\`) to understand the full scope of changes
  2. Write a concise, descriptive PR title that summarizes the overall change (not just the last commit)
  3. Write a well-structured PR body in markdown with: a summary section describing what changed and why, and a bulleted list of the key changes derived from the commit history
  4. Run \`gh pr create --title "<title>" --body "<body>"\`
  5. Output the created PR URL
- Do NOT create a PR if the current branch is main, master, or the repository's default branch`
        : "After pushing, check the output for any pull request URL provided by the remote and output it if present."

    return `Push the current branch (${branch}) to the remote.

- Run \`git push\` to push all commits
- If push fails because there is no upstream, run \`git push --set-upstream origin ${branch}\`
- If push fails for any other reason, explain the error clearly and stop

${ghSection}

Do not make any code changes, commits, or other git operations beyond pushing and PR creation.`
}

export const ACTION_PROMPTS = {
    retry: RETRY_PROMPT,
    commit: COMMIT_PROMPT,
    push: buildPushPrompt,
}

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
export type { ContentBlock } from "../electronAPI/claudeEventTypes"
import type { ContentBlock } from "../electronAPI/claudeEventTypes"

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
