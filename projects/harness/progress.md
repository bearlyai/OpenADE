# Multi-Harness Implementation Progress

## Step 1: Scaffold and core types
- [x] Create package.json, tsconfig.json, vitest.config.ts
- [x] Implement src/types.ts
- [x] Implement src/harness.ts (interface)
- [x] Implement src/errors.ts
- [x] Implement src/registry.ts
- [x] Write src/__tests__/registry.test.ts (9 tests)

## Step 2: Shared utilities
- [x] Implement src/util/spawn.ts (spawnJsonl)
- [x] Implement src/util/env.ts (detectShellEnvironment)
- [x] Implement src/util/which.ts (resolveExecutable)
- [x] Write src/__tests__/spawn.test.ts (9 tests)
- [x] Write src/__tests__/env.test.ts (5 tests)

## Step 3: Client tool server
- [x] Implement src/util/tool-server.ts (HTTP MCP server via @modelcontextprotocol/sdk)
- [x] Write src/__tests__/tool-server.test.ts (8 tests — start, multi-tool, errors, auth, stop)

## Step 4: Claude Code harness
- [x] Implement src/harnesses/claude-code/types.ts (ClaudeEvent union + parseClaudeEvent)
- [x] Implement src/harnesses/claude-code/mcp-config.ts (writeMcpConfigJson + buildMcpConfigObject)
- [x] Implement src/harnesses/claude-code/args.ts (buildClaudeArgs)
- [x] Implement src/harnesses/claude-code/index.ts (ClaudeCodeHarness class)
- [x] Write src/__tests__/claude-code/args.test.ts (24 tests)
- [x] Write src/__tests__/claude-code/mcp-config.test.ts (8 tests)
- [x] Write src/__tests__/claude-code/types.test.ts (20 tests)

## Step 5: Codex harness
- [x] Implement src/harnesses/codex/types.ts (CodexEvent union + parseCodexEvent)
- [x] Implement src/harnesses/codex/config-overrides.ts (buildCodexMcpConfigOverrides)
- [x] Implement src/harnesses/codex/args.ts (buildCodexArgs)
- [x] Implement src/harnesses/codex/index.ts (CodexHarness class)
- [x] Write src/__tests__/codex/args.test.ts (17 tests)
- [x] Write src/__tests__/codex/config-overrides.test.ts (9 tests)
- [x] Write src/__tests__/codex/types.test.ts (15 tests)

## Step 6: Public API and packaging
- [x] Implement src/index.ts (re-exports all public API)
- [x] Verify typecheck passes (`tsc --noEmit` clean)
- [x] Verify build passes (`tsc` produces dist/)
- [x] Run full test suite: **124 tests passing across 10 test files**

## Summary

| Component | Files | Tests |
|---|---|---|
| Core (types, harness, errors, registry) | 4 | 9 |
| Shared utilities (spawn, env, which) | 3 | 14 |
| Client tool server | 1 | 8 |
| Claude Code harness | 4 | 52 |
| Codex harness | 4 | 41 |
| Public API (index.ts) | 1 | — |
| **Total** | **17 source files** | **124 tests** |

## Not yet implemented (future work)
- [ ] Integration tests (require real CLI binaries + auth)
- [ ] Test fixtures from captured CLI output
- [ ] Image handling (base64 encoding for Claude, temp files for Codex)
- [ ] OpenADE integration (Step 7 from plan)
