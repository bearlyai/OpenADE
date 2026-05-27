# Runtime Protocol

Low-level wire contract for generic runtime transports.

- No Electron imports.
- No React imports.
- No Node-only implementation imports.
- No OpenADE project/task/comment/HyperPlan concepts.
- No product-specific execution modes; product modules own those payload values.
- Do not add `do`, `ask`, `plan`, `run`, `run_plan`, `review`, `revise`, or `hyperplan` to protocol method segments, request types, statuses, provider modes, or low-level options.
- `agent/execution/*` is the universal low-level agent execution shape.
- Provider-native agent turns are allowed only for server-protocol adapters like Codex; OpenADE turns are not.
- Keep message envelopes, error codes, capabilities, runtime status, and provider capability types here.
- Runtime record wire payloads must validate through `validateRuntimeRecord`; legacy flat owner/path checkpoint normalization belongs in `projects/runtime`, not in protocol consumers.
