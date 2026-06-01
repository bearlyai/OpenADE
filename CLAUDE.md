# OpenADE Agent Guidance

## Start Here

- Read this file before making changes in the repo.
- Before changing a nested area, read the nearest `CLAUDE.md`, `AGENT.md`, or `AGENTS.md` files for that path. More specific guidance wins for that scope.
- When adding or changing durable documentation, link it from the relevant `CLAUDE.md` or agent guidance file and explain when future agents must consult it.
- When behavior changes, update the docs in the same change. Code is still the source of truth; docs are navigation and rationale.

## Project Outline

| Path | What it is | Local guidance |
| --- | --- | --- |
| `projects/web` | Desktop renderer/code module for task planning, execution, settings, remote UI sources, and shared web components. | [projects/web/src/CLAUDE.md](projects/web/src/CLAUDE.md), [projects/web/src/remote/CLAUDE.md](projects/web/src/remote/CLAUDE.md) |
| `projects/electron` | Electron desktop shell and main-process host integrations. The companion module exposes the authenticated private-network remote-control API. | [projects/electron/CLAUDE.md](projects/electron/CLAUDE.md), [projects/electron/src/modules/companion/CLAUDE.md](projects/electron/src/modules/companion/CLAUDE.md) |
| `projects/mobile` | iOS-first Capacitor shell for the OpenADE remote-control surface, pairing, secure token storage, and OTA web bundle updates. | [projects/mobile/CLAUDE.md](projects/mobile/CLAUDE.md) |
| `projects/landing` | Static marketing site for openade.ai, built with Vite and deployed to Cloudflare Pages. | [projects/landing/CLAUDE.md](projects/landing/CLAUDE.md) |
| `projects/harness` | Unified TypeScript harness for driving AI coding CLIs such as Claude Code and Codex. | [projects/harness/CLAUDE.md](projects/harness/CLAUDE.md) |
| `projects/runtime-protocol` | Low-level runtime wire contract: envelopes, capabilities, error codes, provider concepts, and validation. | [projects/runtime-protocol/CLAUDE.md](projects/runtime-protocol/CLAUDE.md) |
| `projects/runtime` | Reusable runtime server surface for routing, capabilities, subscriptions, permissions, and lifecycle state. | [projects/runtime/CLAUDE.md](projects/runtime/CLAUDE.md) |
| `projects/runtime-node` | Generic Node host adapters for filesystem, git, process, PTY, agent harnesses, checkpoints, liveness, and headless serving. | [projects/runtime-node/CLAUDE.md](projects/runtime-node/CLAUDE.md) |
| `projects/runtime-client` | Typed client helpers for runtime WebSocket and local transports, reconnect, notifications, and runtime record caches. | [projects/runtime-client/CLAUDE.md](projects/runtime-client/CLAUDE.md) |
| `projects/openade-module` | OpenADE product semantics loaded into a runtime server: projects, tasks, turns, comments, snapshots, HyperPlan, and Yjs compatibility. | [projects/openade-module/CLAUDE.md](projects/openade-module/CLAUDE.md) |
| `projects/openade-client` | Typed OpenADE project/task/turn client APIs layered on top of runtime-client transports. | [projects/openade-client/CLAUDE.md](projects/openade-client/CLAUDE.md) |
| `projects/shared/companion` | Browser-safe shared DTOs for desktop companion service, web remote UI, and mobile host adapter. | [projects/shared/companion/CLAUDE.md](projects/shared/companion/CLAUDE.md) |

## Durable Migration Plans

- [plan.md](plan.md) covers the shared shell and remote-kernel migration for bringing companion, web, and desktop onto one runtime-attached product shell. Future agents must consult it before changing runtime composition, OpenADE client/store boundaries, companion permissions, mobile companion behavior, or desktop renderer paths that move away from direct Yjs/local Electron assumptions.

## Engineering Commandments

1. Type strictly. Do not use loose typing, `any`, forced casts, or type-system escape hatches unless a boundary contract makes them unavoidable and the reason is documented in code.
2. Keep solutions simple, surgical, and production-aware. Prefer the smallest robust change, but step back when a better abstraction or limited redo prevents long-term complexity.
3. Treat production data as real. Preserve backward compatibility with tolerant readers, optional fields, migrations, and regression fixtures for old shapes.
4. Prefer strong contracts. Use types, schemas, parsers, validators, and discriminated unions at boundaries instead of implicit object shapes or stringly typed logic.
5. Test behavior that matters. Write high-signal unit and integration tests that exercise production paths without mocking; avoid mirror tests and brittle implementation assertions.
6. Verify frequently. Run focused type checks, tests, linters, formatters, builds, and real requests or screenshots when they prove the changed behavior.
7. Observe failure modes. Add useful logs, metrics, analytics, and operational context for important flows, and document how future maintainers can query or inspect them.
8. Keep infrastructure boring. Prefer one clear command to run checks, centralize configuration, and avoid hidden manual steps.
9. Handle errors precisely. Do not hide blanket failures; preserve meaningful status codes, filters, context, retries, and permission handling.
10. Be careful with databases and destructive operations. Use read-only sessions by default, make writes explicit, prefer reversible transactions, and never risk irrecoverable data loss.
11. Document navigational knowledge. Link durable docs from the relevant `CLAUDE.md` or `AGENT.md`, explain when future agents must consult them, and update those docs when behavior changes.
12. See the real shape before coding. Read the files, inspect data, make test requests, and verify assumptions before designing around them.
