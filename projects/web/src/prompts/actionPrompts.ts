const RETRY_PROMPT =
    "Retry the previous action that failed or was interrupted. Analyze why it failed and address the root cause. If the same approach will fail again, try an alternative. Do not undo work that succeeded before the failure."

const COMMIT_PROMPT_BASE = `Review the current git working tree and create a commit for the changes.

- Run git status and git diff to understand what changed
- Follow repository conventions before committing (run whatever formatting/linting/checks are expected for the touched files)
- Write a clear commit message that explains the "why" not just the "what"
- Stage only the relevant changes (use git add selectively if needed)
- Do not undo, revert, or modify any existing changes — commit the changes you made.
- If there are changes unrelated to your work, do not include them. Do not modify those files either.
- If there are changes you didn't make in the same file you worked on, commit the whole file.
- Show the commit hash, message, and file statistics

This is a one-time commit request. Do not continue committing after this unless explicitly asked.`

function buildCommitPrompt(userInstructions?: string): string {
    const extra = userInstructions?.trim()
    if (!extra) return COMMIT_PROMPT_BASE

    return `${COMMIT_PROMPT_BASE}

Additional instructions from the user (these take precedence over the defaults above when there is any conflict):

<user_commit_instructions>
${extra}
</user_commit_instructions>`
}

function buildPullRequestSection(hasGhCli: boolean): string {
    return hasGhCli
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
}

function buildPushPrompt(hasGhCli: boolean, branch: string): string {
    const ghSection = buildPullRequestSection(hasGhCli)

    return `Push the current branch (${branch}) to the remote.

- Run \`git push\` to push all commits
- If push fails because there is no upstream, run \`git push --set-upstream origin ${branch}\`
- If push fails for any other reason, explain the error clearly and stop

${ghSection}

Do not make any code changes, commits, or other git operations beyond pushing and PR creation.`
}

function buildCommitAndPushPrompt(userInstructions: string | undefined, hasGhCli: boolean, branch: string): string {
    const commitPrompt = buildCommitPrompt(userInstructions)
    const ghSection = buildPullRequestSection(hasGhCli)

    return `Run one unified git workflow: commit first (if needed), then push.

${commitPrompt}

After the commit step:
- If there is nothing to commit, continue directly to push existing commits.
- Push the current branch (${branch}) to the remote.
- Run \`git push\` to push all commits
- If push fails because there is no upstream, run \`git push --set-upstream origin ${branch}\`
- If push fails for any other reason, explain the error clearly and stop

${ghSection}

Do not make any code changes or git operations beyond this commit (if needed), push, and optional PR creation flow.`
}

export const ACTION_PROMPTS = {
    retry: RETRY_PROMPT,
    commit: buildCommitPrompt,
    push: buildPushPrompt,
    commitAndPush: buildCommitAndPushPrompt,
}
