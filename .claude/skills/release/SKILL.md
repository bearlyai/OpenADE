---
name: release
description: End-to-end release workflow — draft notes, run checks, push, watch CI, publish GitHub release, and update download links. Minimal user interaction required.
disable-model-invocation: true
---

End-to-end release workflow. The goal is to minimize back-and-forth with the user: gather info, present a single approval prompt, then execute everything autonomously (push, watch CI, fix failures, publish release, update links).

## 1. Find the latest version

Run `git tag -l 'v*' --sort=-v:refname` to list all version tags sorted by semver descending. The first line is the latest version.

## 2. Read changes since that tag

Run these commands to understand what changed:

```
git log <latest-tag>..HEAD --oneline
git diff <latest-tag>..HEAD --stat
```

Read the actual diffs for key files if the summary isn't clear enough to write good release notes.

## 3. Run checks

Before proceeding, run typechecks and tests in both projects. Run these commands in parallel:

```
cd projects/electron && npm run typecheck && npm run test
cd projects/web && npm run typecheck && npm run test
```

If biome makes any formatting fixes during typecheck, note those files — they must be included in the release commit.

If any check fails, stop and report the failures to the user. Do NOT continue with the release until all checks pass.

## 4. Suggest a version number

The project follows semver. Most releases bump the **minor** version (e.g., `0.51.0` → `0.52.0`). Suggest a patch bump only for pure bugfix releases.

## 5. Draft the release notes entry

Read `projects/web/src/versions.ts` to see the existing format. Draft a new entry to prepend to the `RELEASE_NOTES` array:

- **title**: A short, punchy summary of the release theme (e.g., "MCP Connectors & Improved Terminal")
- **date**: Today's date in `YYYY-MM-DD` format
- **highlights**: 3-5 bullet points covering the most user-visible changes. Write from the user's perspective — what they can now do, not internal implementation details. Keep each bullet to one sentence.

Also draft the GitHub release notes using this format:

```markdown
## Highlights

- **<Feature/change name>** — Short description of what the user can now do.
- ...

## Other improvements

- Bullet list of smaller fixes, improvements, or internal changes worth noting.
```

## 6. Present to the user for approval — single prompt

Show the user everything at once:
- The suggested version number
- The drafted `RELEASE_NOTES` entry (formatted as it would appear in `versions.ts`)
- The drafted GitHub release notes
- A short summary table of commits that informed the highlights

Ask the user:
1. Whether the version number is correct
2. Whether to add, edit, or remove any highlights
3. Whether to proceed

This should be the **only** user interaction. Once approved, execute steps 7–10 autonomously without asking further questions.

## 7. Commit, tag, and push

Once the user approves:

1. Add the new entry to the top of the `RELEASE_NOTES` array in `projects/web/src/versions.ts`
2. Stage the versions.ts change **plus any biome formatting fixes** from step 3
3. Create a commit with the message `Release v<version>: <title>`
4. Create a git tag `v<version>`
5. Push the commit and tag (`git push && git push --tags`)

Do all of this in one step — do NOT ask the user to confirm the push separately.

## 8. Watch the CI build

After pushing, the Release workflow will trigger automatically. Monitor it:

```
gh run list --repo bearlyai/OpenADE --limit 1
gh run watch <run-id> --repo bearlyai/OpenADE
```

Wait for the build to complete. Check the final status of **all three platform jobs** (macOS, Windows, Linux):

```
gh run view <run-id> --repo bearlyai/OpenADE
```

### If the build fails

1. Inspect the failure: `gh run view <run-id> --repo bearlyai/OpenADE --log-failed`
2. Diagnose and fix the issue locally
3. Run the local checks again to verify the fix
4. Commit the fix
5. Move the tag to the new commit: `git tag -f v<version>`
6. Force-push the tag: `git push && git push --tags --force`
7. Go back to watching the new CI run
8. Repeat until all three platforms pass

### Common CI failures

- **`Cannot find module '@openade/harness'`**: The harness `dist/` is gitignored. The CI workflow must build the harness before installing web dependencies. Check that `.github/workflows/release.yml` has "Install harness dependencies" and "Build harness" steps before "Install web dependencies" on all three platforms.
- **Vite/Rollup errors about Node built-ins** (e.g., `"execFileSync" is not exported by "__vite-browser-external"`): The web app must import from `@openade/harness/browser` (not `@openade/harness`) to avoid pulling in Node-only modules. Check that all web imports use the `/browser` subpath.

## 9. Publish the GitHub release

**IMPORTANT**: electron-builder (via `--publish always`) creates a **draft** GitHub release with build artifacts (`.dmg`, `.exe`, `.AppImage`, etc.) attached. Do NOT create a new release with `gh release create` — that would produce a release without artifacts.

Instead, edit the existing draft and publish it:

```
gh release edit v<version> --repo bearlyai/OpenADE \
  --draft=false \
  --title "v<version>: <title>" \
  --notes "<github release notes from step 5>"
```

Verify it was published:
```
gh release view v<version> --repo bearlyai/OpenADE
```

Confirm that `draft: false` and that assets are listed.

## 10. Update download links

After the release is published:

- Update all version-bearing links to the repo across the codebase. Search broadly with:
  ```
  rg -i 'https://github.com/bearlyai/openade' .
  ```
  Review all results and update any that contain the previous version number. This includes but is not limited to:
  - Tag references: `v<previous-version>` → `v<new-version>` in `/releases/download/` paths
  - Filename references: `OpenADE-<previous-version>` → `OpenADE-<new-version>` (covers `.dmg`, `.AppImage`, `.exe` filenames)
  - Any other URLs under the repo that embed a version string

  Verify the replacements look correct before proceeding — only update version strings within repo URLs and their associated filenames, not unrelated content.
- Create a commit with the message `chore: update download links to v<version>`
- Push the commit (`git push`)

Report the final release URL to the user.
