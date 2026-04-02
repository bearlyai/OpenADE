# Prompts System

Prompt templates and builders in `prompts.ts`.

## Modes

Each mode has distinct instructions sent via `appendSystemPrompt`.
Execution may also append context-safety instructions (for example, worktree-only constraints).

| Mode | Purpose | Can Modify Files? |
|------|---------|-------------------|
| `plan` | Generate implementation plan | No |
| `revise` | Update existing plan based on feedback | No (but can explore) |
| `execute` | Run approved plan | Yes |
| `ask` | Answer questions about codebase | No (read-only) |
| `do` | Direct execution (no mode prompt) | Yes |

## Prompt Builders

Each returns `PromptResult`:
```typescript
interface PromptResult {
    systemPrompt?: string      // Mode instructions (undefined for 'do')
    userMessage: string        // Formatted user input + comments
    consumedCommentIds: string[]  // Which comments were included
}
```

Builders: `buildPlanGenerationPrompt`, `buildRevisePrompt`, `buildRunPlanPrompt`, `buildAskPrompt`, `buildDoPrompt`

Review-specific helpers live in `reviewPrompts.ts`:
- `buildPlanReviewPrompt(...)` - one-off external review of active plan
- `buildWorkReviewPrompt(...)` - one-off external review of recent work
- `buildReviewHandoffPrompt(...)` - asks main thread to agree/disagree and request user approval

Execution-context helpers:
- `buildWorktreeExecutionInstruction(...)` - Appends a worktree safety instruction when isolation type is `worktree`
- `mergeAppendSystemPrompt(...)` - Combines mode prompts with execution-context prompts
- HyperPlan plan prompts may include `<main_thread_context ...>` containing serialized task thread XML from `taskThreadSerializer.ts`
- Main-thread context is budgeted by UTF-8 bytes (default `240_000`) and keeps the most recent events that fit

## Comment Formatting

Comments are formatted as XML for Claude:

```xml
<user_inline_comments>
<comment author="user@email.com" lines="10-15" source="file:src/utils.ts">
   <context_before>// Previous lines...</context_before>
   <selected_text>function helper() {</selected_text>
   <context_after>// Following lines...</context_after>
   <user_comment>This needs error handling</user_comment>
</comment>
</user_inline_comments>
```

Source types: plan, file, diff, patch, llm_output, edit_diff, write_diff, bash_output, assistant_text

## Plan Output Format

Plans follow this structure:
```markdown
## 📋 Overview
## ✅ Outcomes (expected results)
## 🔀 Decisions (key choices with alternatives)
## 📝 Plan (implementation steps)
```

## Action Prompts

One-off prompts for specific actions:
- `RETRY_PROMPT` - Retry failed action, analyze root cause
- `buildCommitPrompt(userInstructions?)` - Create git commit; optional user instructions are appended with explicit precedence over defaults
- `buildPushPrompt(hasGhCli, branch)` - Push and optionally create PR
- `buildCommitAndPushPrompt(userInstructions, hasGhCli, branch)` - Commit (if needed) then push in one flow, with optional PR handling

## Keeping This Document Updated

This document should evolve with the codebase. When making significant changes, consider whether this doc needs updates.

The code is ground truth. If you find any inconsistencies update this document.
