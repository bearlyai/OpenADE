# OpenADE Client

Target package for typed OpenADE project/task/turn client APIs.

- Should call OpenADE runtime methods through runtime-client.
- Dashboard and mobile should converge on this package.
- Do not duplicate companion-only domain request types here.
- Runtime transport clients own `initialize`; OpenADEClient assumes it is given a runtime-client-compatible transport and only owns typed snapshot/task reads, turn start/interrupt, and OpenADE-scoped notification filtering.
- Every typed OpenADE mutation should preserve a caller-provided `clientRequestId` or attach one by default before calling the server. Product-level retry/double-submit idempotency belongs in OpenADE, not in the low-level runtime protocol.
