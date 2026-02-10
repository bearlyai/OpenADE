---
name: release
description: Prepare release notes for a new version by analyzing changes since the last git tag.
disable-model-invocation: true
---

Prepare release notes for a new version. Follow these steps carefully:

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

If any check fails, stop and report the failures to the user. Do NOT continue with the release until all checks pass.

## 4. Suggest a version number

The project follows semver. Most releases bump the **minor** version (e.g., `0.51.0` → `0.52.0`). Suggest a patch bump only for pure bugfix releases.

## 5. Draft the release notes entry

Read `projects/web/src/versions.ts` to see the existing format. Draft a new entry to prepend to the `RELEASE_NOTES` array:

- **title**: A short, punchy summary of the release theme (e.g., "MCP Connectors & Improved Terminal")
- **date**: Today's date in `YYYY-MM-DD` format
- **highlights**: 3-5 bullet points covering the most user-visible changes. Write from the user's perspective — what they can now do, not internal implementation details. Keep each bullet to one sentence.

## 6. Present to the user for approval and apply

Show the user:
- The suggested version number
- The drafted `RELEASE_NOTES` entry (formatted as it would appear in `versions.ts`)
- A short summary of the commits that informed the highlights

Ask the user:
1. Whether the version number is correct
2. Whether to add, edit, or remove any highlights
3. Whether to proceed

Once the user approves:
- Add the new entry to the top of the `RELEASE_NOTES` array in `projects/web/src/versions.ts`
- Update the `version` field in `projects/electron/package.json` to the new version number (e.g., `"version": "0.53.0"`). This is what Electron's "About" dialog displays.
- Update all version-bearing links to the repo across the codebase. Search broadly with:
  ```
  rg -i 'https://github.com/bearlyai/openade' .
  ```
  Review all results and update any that contain the previous version number. This includes but is not limited to:
  - Tag references: `v<previous-version>` → `v<new-version>` in `/releases/download/` paths
  - Filename references: `OpenADE-<previous-version>` → `OpenADE-<new-version>` (covers `.dmg`, `.AppImage`, `.exe` filenames)
  - Any other URLs under the repo that embed a version string

  Verify the replacements look correct before proceeding — only update version strings within repo URLs and their associated filenames, not unrelated content.
- Create a commit with the message `release: v<version>`
- Create a git tag `v<version>`
- Push the commit and tag (`git push && git push --tags`)

Do all of this in one step — do NOT ask the user to confirm the push separately.

## 7. Provide GitHub release notes

After the push succeeds, provide a ready-to-copy markdown block the user can paste directly into the GitHub release. Use this format:

```markdown
## <Title> — v<version>

<One-sentence summary of what this release brings.>

### Highlights

- **<Feature/change name>** — Short description of what the user can now do.
- **<Feature/change name>** — Short description of what the user can now do.
- ...

### Other Changes

- Bullet list of smaller fixes, improvements, or internal changes worth noting.

---

**Full Changelog**: `v<previous-version>...v<version>`
```

Keep the tone concise and user-facing. Use bold for feature names and keep descriptions to one sentence each.

Remind the user to create the GitHub release and paste in the notes.
