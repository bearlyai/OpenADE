# OpenADE Module

Target package for OpenADE product semantics loaded into a runtime server.

- Own projects, tasks, turns, comments, snapshots, and Yjs compatibility.
- Own OpenADE product types in src/types.ts; companion shared types should only re-export them for compatibility.
- Register OpenADE methods under `openade/*` on the single runtime server.
- Treat `openade/action/*` as trusted-local mutation methods unless remote permissions are intentionally narrowed and reviewed.
- Do not start a second server.
- Do not put OpenADE concepts into the low-level runtime protocol.
- `src/yjsProjection.ts` reads existing Yjs repo/task documents through a storage adapter.
- `src/yjsMutation.ts` owns task creation, task environment setup, and action-event transaction shapes for existing Yjs repo previews and task documents.
- `src/promptBuilder.ts` owns portable prompt construction for server-owned plan/do/ask turns; host adapters may enrich the result with persisted image content blocks before harness execution.
- `src/hyperplan.ts` owns portable OpenADE-layer HyperPlan strategy validation, step ordering, prompt construction, and output extraction. Keep it out of the low-level runtime packages.
- `src/node.ts` owns the optional Node host adapter for loading OpenADE task/turn semantics into a RuntimeServer. It may use runtime-node adapters, but runtime-node must not import OpenADE product semantics.
- `src/nodeYjsStorage.ts` owns file-backed Yjs document storage compatible with existing OpenADE document ids for headless Node OpenADE hosts. Keep its legacy nested-path recovery and mismatched task-document read tolerance aligned with desktop storage so old user data remains recoverable.
- Keep server-side writes idempotent where clients provide stable request ids or task ids.
- New head/worktree `openade/turn/start` calls should create the task document, task environment, setup event when needed, and action event before starting runtime-owned execution.
- Desktop new-task creation and programmatic OpenADE turn/Cron starts should call `openade/turn/start` through the local runtime client instead of creating task docs directly in the renderer.
- Desktop task-thread Do/Plan/Ask/Revise Plan/Run Plan actions should call the runtime-backed OpenADE turn existing-task path. Review should call `openade/review/start` so the runtime host creates the review event and follow-up Ask.
- Action event creation, stream append, execution metadata updates, complete, error, and stopped writes have server-side primitives and should be preferred over renderer-only task mutation when wiring new runtime execution paths.
- Snapshot event persistence has a server-side primitive, but patch generation and external patch-file storage are still host adapter responsibilities.
- Comment create/edit/delete has server-side primitives.
- Common task metadata updates have a server-side primitive.
- Head-mode and worktree plan/do/ask turns should persist harness session, stream, terminal status, and git ref updates through the Yjs writer.
- Headless Node plan/do/ask, HyperPlan, and review/follow-up turns should use the host-provided runtime agent executor and the same Yjs writer path; do not create alternate task/action persistence just for CLI serve mode.
- OpenADE-owned `runtime/stop` must interrupt the active host execution and persist the current action event as `stopped` through the Yjs writer before the generic runtime supervisor is allowed to mark the runtime stopped. Do not rely on a later harness abort settlement for durable task state.
- Server-owned OpenADE runtime records should include `scope.labels.eventId` and `scope.labels.executionId` for the action event they own. The generic runtime only owns lifecycle; OpenADE uses those labels to reconcile durable task history.
- Terminal runtime reconciliation belongs in this package. `openade/action/reconcileRuntime` should settle only a matching in-progress action event; missing events are not guessed, and already-terminal events are not rewritten.
- HyperPlan turns should persist the main action event plus child sub-execution lifecycle through `openade/hyperplan/*` mutation primitives.
- HyperPlan sub-execution status includes `stopped`; do not coerce an aborted child into `error` because that loses the lifecycle reason.
- Electron main now provides the host adapter path for snapshot patch generation and external patch-file storage after completed server-owned plan/do/ask turns.
- Electron main now provides host adapter paths for image prompt assembly and enabled MCP server config assembly before runtime-owned harness starts.
- Repo create/update/delete and task delete have server-side primitives. Task document deletion should remove the repo preview first and delete the task document only after host cleanup has been attempted by the embedding host.
