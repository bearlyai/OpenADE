# Data Models

All data lives in `api.ts` with localStorage persistence. No backend yet.

## Key Concepts

**Repos** contain **Tasks**. Tasks have **Events** (the execution history) and **Comments** (user feedback).

**Isolation Strategy** is set at task creation and never changes:
- `worktree` - Creates isolated git worktree, runs setup script
- `head` - Works directly in repo, no isolation

**Device Environments** - Tasks track per-device setup state. If a user opens a task on a new device, they'll need to run setup again.

## Event Types

Events form the task's execution history. Three types:

| Type | Purpose | Has Execution? |
|------|---------|----------------|
| `action` | LLM execution (plan, revise, do, ask, run_plan) | Yes |
| `setup_environment` | Worktree setup completed | No |
| `snapshot` | Frozen code state after action | No |

**ActionEventSource** tells you what triggered an action:
- `plan` / `revise` - Planning mode
- `run_plan` - Executing an approved plan
- `do` / `ask` - Direct execution or read-only exploration

## Comment Consumption

Comments are inline feedback users leave on code/plans. They get "consumed" when sent to Claude:

1. User creates comment → pending (editable)
2. User runs action → prompt includes pending comments
3. `ActionEvent.includesCommentIds` records what was sent
4. UI shows consumed comments as read-only

Use `CommentManager.getUnsubmittedComments(taskId)` to get pending comments.

## Mutations

All task mutations go through `mutateTask()` which uses Immer:

```typescript
await mutateTask(taskId, (draft) => {
    draft.comments.push(newComment)
})
```

For full type definitions, read `api.ts` directly.

## Keeping This Document Updated

This document should evolve with the codebase. When making significant changes, consider whether this doc needs updates.

The code is ground truth. If you find any inconsistencies update this document.
