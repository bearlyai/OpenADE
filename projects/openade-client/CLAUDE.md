# OpenADE Client

Target package for typed OpenADE project/task/turn client APIs.

- Should call OpenADE runtime methods through runtime-client.
- Dashboard and mobile should converge on this package.
- Do not duplicate companion-only domain request types here.
- Runtime transport clients own `initialize`; OpenADEClient assumes it is given a runtime-client-compatible transport and only owns typed snapshot/task reads, product mutations, scoped project file tree/read/write/search/process helpers, scoped project git info/branches/summary reads, scoped task terminal helpers, scoped task git scope/read/commit helpers, scoped task environment prepare, scoped task title generation, scoped task image/resource-inventory/snapshot patch read helpers, and OpenADE-scoped notification filtering.
- Every typed OpenADE mutation should preserve a caller-provided `clientRequestId` or attach one by default before calling the server. Product-level retry/double-submit idempotency belongs in OpenADE, not in the low-level runtime protocol.
