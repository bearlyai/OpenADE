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

## 3. Suggest a version number

The project follows semver. Most releases bump the **minor** version (e.g., `0.51.0` → `0.52.0`). Suggest a patch bump only for pure bugfix releases.

## 4. Draft the release notes entry

Read `projects/web/src/versions.ts` to see the existing format. Draft a new entry to prepend to the `RELEASE_NOTES` array:

- **title**: A short, punchy summary of the release theme (e.g., "MCP Connectors & Improved Terminal")
- **date**: Today's date in `YYYY-MM-DD` format
- **highlights**: 3-5 bullet points covering the most user-visible changes. Write from the user's perspective — what they can now do, not internal implementation details. Keep each bullet to one sentence.

## 5. Present to the user for approval

Show the user:
- The suggested version number
- The drafted `RELEASE_NOTES` entry (formatted as it would appear in `versions.ts`)
- A short summary of the commits that informed the highlights
- The GitHub release notes (see below)

Ask the user:
1. Whether the version number is correct
2. Whether to add, edit, or remove any highlights
3. Whether to proceed

### GitHub Release Notes

Provide a ready-to-copy markdown block the user can paste directly into the GitHub release. Use this format:

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

## 6. Apply changes

Only after the user approves:
- Add the new entry to the top of the `RELEASE_NOTES` array in `projects/web/src/versions.ts`
- Create a commit with the message `release: v<version>`
- Create a git tag `v<version>`
- Do NOT push. Ask the user if they'd like to push the commit and tag.
