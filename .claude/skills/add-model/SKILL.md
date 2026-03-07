---
name: add-model
description: Add or update a model in the harness model registry. Use when the user wants to add a new AI model, update model pricing, or change default models for a harness.
argument-hint: [harness] [model-id]
disable-model-invocation: true
---

Add or update a model in the model registry. The user will specify which harness (e.g., `codex`, `claude-code`) and what model to add or change.

## 1. Gather information

Before making changes, confirm with the user:
- **Harness**: Which harness does this model belong to? (Check `HarnessId` in `projects/harness/src/types.ts` for valid values)
- **Model ID**: The wire ID sent to the CLI (e.g., `gpt-5.4`, `claude-opus-4-6`)
- **Alias**: The short picker alias (e.g., `opus`, `gpt-5.4`) — often the same as the model ID for codex models
- **Label**: The human-readable display label (e.g., `GPT-5.4`, `Opus 4.6`)
- **Display class**: The grouping class for stats/UI (e.g., `Codex`, `Opus`)
- **Default?**: Should this become the new default model for the harness?

If the model name is ambiguous or you're unsure about the exact wire ID, **test it locally first** by running the harness CLI. For codex:
```
codex exec -m <model-id> "echo hello" 2>&1 | head -15
```
For claude-code, check Anthropic's model docs or test with `claude`.

## 2. Look up pricing

Search the web for the model's official per-million-token pricing:
- Input price per 1M tokens
- Output price per 1M tokens
- Cached input price per 1M tokens (if available)

Use the provider's official pricing page as the source of truth.

## 3. Update all required files

Every model addition touches these files — **all must stay in sync**:

### a. Model Registry (static catalog)
**File:** `projects/harness/src/models.ts`

Add a `ModelEntry` to the appropriate harness in `MODEL_REGISTRY`. If making it the default, update `defaultModel`.

### b. Harness class `models()` method
The harness class must return identical data to the registry. A sync test enforces this.

- **Codex:** `projects/harness/src/harnesses/codex/index.ts` — the `models()` method
- **Claude Code:** `projects/harness/src/harnesses/claude-code/index.ts` — the `models()` method

### c. Pricing table
Each harness has its own pricing file:

- **Codex:** `projects/harness/src/harnesses/codex/pricing.ts` — add entry to `CODEX_PRICING`
- **Claude Code:** `projects/harness/src/harnesses/claude-code/pricing.ts` — add entry to `CLAUDE_PRICING`

### d. `normalizeModelClass()` fallback
**File:** `projects/harness/src/models.ts`

If the new model ID doesn't match existing string-based fallback patterns (e.g., a codex model that doesn't contain "codex" in its name), add a fallback line. The function first checks the registry, then falls back to substring matching for legacy/effort-suffixed IDs.

### e. Tests
**File:** `projects/harness/src/models.test.ts`

Update:
- Model count for the harness
- Expected model ID list
- Default model assertion (if changed)
- `normalizeModelClass` assertions if new fallback patterns were added

Also check `projects/harness/src/harnesses/<harness>/pricing.test.ts` for any pricing test expectations.

## 4. Verify nothing else needs updating

The web UI reads dynamically from `MODEL_REGISTRY` so typically no frontend changes are needed. But check for hardcoded model IDs in:
- `projects/web/src/constants.ts`
- `projects/web/src/components/ModelPicker.tsx`
- `projects/web/src/store/TaskModel.ts`
- `projects/web/src/hyperplan/` (test fixtures may reference specific models)

These usually don't need changes but verify.

## 5. Run tests

Run the harness unit tests (excluding slow integration tests):

```
cd projects/harness && npm run test
```

All tests must pass before committing.
