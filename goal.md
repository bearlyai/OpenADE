# OpenADE Core Goal

## Goal

Build and ship OpenADE Core: a standalone Go product kernel that becomes the single backend for desktop, web, mobile, and future headless clients, while preserving the classic desktop UI as the canonical OpenADE product experience.

OpenADE Core replaces the current Electron-main and Yjs hybrid as the owner of durable product state, runtime routing, task execution, git/files/search/process/PTY operations, permissions, subscriptions, and observability. All clients attach to it through one typed OpenADE runtime API.

## Target Shape

```text
Desktop Shell / Browser Shell / Mobile Shell / CLI
        |
        | typed OpenADE runtime API over IPC or WebSocket
        v
OpenADE Core
  - product state
  - task execution
  - git/files/search/procs/PTY
  - permissions/sessions
  - subscriptions/events
  - storage/indexes
        |
        v
SQLite + blob store + repo worktrees + agent CLIs
```

## Done Means

Desktop, web, and mobile use one shared product shell/store backed by OpenADE Core.

Electron main is only native chrome and lifecycle:

- launch, update, and connect to core
- windows, tray, dialogs, and open-url/open-path integrations
- local trust and bootstrap
- no product storage projection
- no git/process/file-search ownership
- no task execution ownership

OpenADE Core owns:

- project, task, comment, and metadata state
- task previews and task detail reads
- turn start/stop/retry/review/queue execution
- agent harness orchestration and stream persistence
- git summaries, diffs, logs, branches, and commits
- scoped files, content search, fuzzy indexes, and file writes
- project processes and task terminals
- auth, device sessions, permissions, and notification filtering
- slow-operation telemetry with queue wait and handler time separated

The UI remains TypeScript and React:

- classic desktop UI is preserved as the design source
- mobile and web adapt desktop-derived components
- compact companion product UI is removed or replaced instead of preserved as a second product
- renderer Yjs reads are not used for normal product behavior
- paired clients do not receive raw host APIs by default

## Storage Goal

Do not port the current hot Yjs read pattern into Go.

Use:

- SQLite for indexed product state and queryable metadata
- append-only task/event tables for durable task history
- materialized preview and stats tables for task lists, sidebar reads, and dashboards
- blob files for large streams, patches, images, terminal logs, raw transcripts, and other bulky payloads
- explicit import and compatibility paths for existing production Yjs data
- CRDT/Yjs only where collaborative editing genuinely needs it, not as the whole app database

A task switch should be an indexed core read of task metadata, latest bounded events, comments, preview state, and runtime state. It should not decode multi-megabyte Yjs updates or load unrelated repo/settings documents.

## Runtime And Protocol Goal

Keep the runtime/OpenADE method model, but make it contract-first:

- one schema source for request, response, and notification DTOs
- generated TypeScript client types
- runtime validators at the core boundary
- JSON-RPC over WebSocket for browser and mobile compatibility
- trusted local IPC as an optimization, not a separate product API
- permission-filtered capabilities and notifications for every non-local client

Desktop may expose the full trusted capability set. Mobile and browser clients should expose every product feature that is safe and ergonomic for their medium, through scoped product methods rather than raw host powers.

## Performance Goal

Task switching should be predictably fast because task open is an indexed core read, not a full Yjs projection. Git, process, fuzzy-search, and task reads should not randomly stall behind unrelated product projection work.

Every slow operation log must make the bottleneck obvious:

- queue wait time
- handler time
- service name
- method name
- request id
- failure state and sanitized error code

Logs must not include prompts, file contents, tokens, secrets, full paths where avoidable, bearer tokens, or user-sensitive payloads.

## Verification Goal

Migration confidence must come from real paths, not mocks:

- import copied `~/.openade` data into the new store
- compare old Yjs projection DTOs against new core DTOs for snapshots, tasks, previews, comments, stats, and resource inventories
- use temporary real git repos for git, file, search, and process behavior
- run a real core server plus generated TypeScript client in integration tests
- run desktop route smoke through the actual local runtime path
- run mobile and browser attach tests against the same core protocol
- prove restart and recovery behavior for active executions
- enforce performance budgets for task read, snapshot read, git summary, process list, and fuzzy search
- enforce `scripts/check-no-explicit-any.mjs projects` so non-test TypeScript and Go stay on concrete types, `unknown`, `json.RawMessage`, or reviewed boundary aliases instead of loose `any`/`interface{}`

Accepted test doubles are deterministic harness executors, fixed clocks, fixed id generators, temporary storage directories, temporary git repos, and real test WebSocket servers. Mocked OpenADE clients, mocked runtime transports, and mock-only host behavior do not count as primary migration proof.

## Implementation Bias

Write OpenADE Core in Go. Keep UI and shell code in TypeScript and React. Use SQLite plus blob storage for durable state. Generate client types from shared contracts.

Rust remains viable if the team intentionally chooses a higher systems-language ownership cost, but Go is the default path for finishing this daemon and orchestration layer cleanly.

## Relationship To `plan.md`

This document defines the destination. `plan.md` defines the staged migration path from the current shared-shell/runtime work toward that destination.

Future agents must consult this file before changing kernel composition, durable storage architecture, runtime/OpenADE contracts, Electron product-backend ownership, shared-shell direction, or medium-specific product capability decisions.
