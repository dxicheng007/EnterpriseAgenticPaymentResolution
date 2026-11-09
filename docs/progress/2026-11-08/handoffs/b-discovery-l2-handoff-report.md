# B discovery L2 handoff report

Docs-only elaboration completed in the main ignored briefs directory. No product files, contracts, migrations, tests, commits or source candidate were changed. No subagents were used.

- Brief: `.superpowers/sdd/2026-11-08-implementation-plan/briefs/b-discovery-l2.md`
- Brief SHA-256: `0382ffb140d4bea839987b771c8ba794923095f73451340cafb455951266d44a`
- Integrated L1: `42bcfa6`; observed documentation-only main successor: `a905c3228bbbbb71c9c43b0c04503ee501731d0b`.
- Pending source candidate: `413d6e9783e255308cbc2e4001ae2c77a045d7f4`; its report/API was consulted. Candidate discovery-reads.ts was read for the concrete integration questions of fact shape and whether it exported an in-transaction recheck. This was not an independent candidate review or acceptance.

The brief freezes the discovery-local strict delegation input, role allowlist, safe result shape, five HTTP routes, session/CSRF rules, start replay ordering, current-authority binding, default no-client composition, closed atomic tool path and focused PostgreSQL proof. It explicitly preserves source facts versus saved grants versus current policy. It requires the production wrapper's capture recheck, with exact SQL fields, pinned membership/hashes and a locked mutable dossier, while keeping original-byte reads outside transactions. L1's optional internal seam cannot become an optional mounted-production check.

## Gaps resolved and remaining gate

1. **Resolved with root approval:** new L2 files alone cannot advertise or execute delegation through L1's private owner transaction. Root approved narrowly changing supervisor.ts for fixed tool schemas and the closed atomic delegation path. The brief enumerates options/reserve/pending-step hunks and forbids a public transaction or arbitrary callback registry. Existing repository.start already supports the required client callback; no repository change is currently needed. Root allows one only if a concrete integration need is reported.
2. **Resolved from existing source/database contracts:** the proposed source API returns capture facts and does not export a transaction recheck. Root confirmed the composition-owned SQL-only recheck is appropriate. Migration002's immutable source rows plus mutable dossier lock justify the bounded protocol; the brief does not assert atomic protection against privileged corruption or later physical blob loss. No source API/grant expansion is needed.
3. **Still a prerequisite:** exact source candidate independent acceptance and integration. Do not infer it from this handoff, the builder's passing checks, or architecture approval. If acceptance changes the fact shape or immutability assumptions, reconcile that exact delta before Sol dispatch.
4. **No new material product/financial requirement gap identified for this L2 scope.** Parent identity/verification privilege expansion, actual findings/proposals/blocker assessment, beginRepair/finishRun, provider keys/live lifecycle, monitor and worker behavior remain explicit deferred work. None is substituted with synthetic success.

## Evidence limits

Read accepted orchestration §§2–5, lifecycle L2 handoff/protocol, executable discovery freeze/types, L1 report and exact-candidate independent review, source prerequisite report, and focused implementation seams in repository/supervisor/composition/session-route patterns/source SQL grants. The brief includes the L1 review's two narrow additions: cross-task reuse of native call IDs and oversized-byte response rejection at the persistence boundary with usage accounting.

Checked file presence/content and SHA-256 only. No tests or database probes ran for this architecture task; no machine verification, independent implementation review, V4, live construction, financial correctness or joint user acceptance is claimed. Root should provide the approved brief and accepted source integration SHA to Sol, then independently review the resulting exact implementation candidate.

## Fix round 1 of 5 — replacement for scoped review

Read both P2 findings verbatim in `b-discovery-l2-independent-review.md`; changed only those requirements and baseline metadata. Original brief is preserved separately as `b-discovery-l2-r0.md`.

- Replacement brief SHA-256: `4bcb2d01450ef7f91809e7a13b5150591552b08abc5da03a3c267a9a547c33b9`.
- P2 source boundary: separated lifecycle/request errors from accepted SourceError passthrough. Preserves original status/code/safe message/safe diagnostics through the statusCode adapter, correlationId and no-store; removes422-to409 and generic source rewriting. Added explicit422/404/409/503 passthrough proof.
- P2 batch boundary: before first delegation effect, all delegates now undergo schema/role/duplicate checks plus captured-tuple membership and existing same-run dependency preflight through the guarded owner transaction. Added two-call valid-first/invalid-second proofs for cross-run predecessor, nonexistent predecessor and uncaptured tuple, each requiring zero children/count increments/tool effects. Per-effect current authority/capture/capacity/order/fences remain mandatory; no whole-batch capacity reservation or arbitrary callback facility is introduced.
- Updated source metadata: candidate `413d6e9783e255308cbc2e4001ae2c77a045d7f4` is accepted and integrated through `1dae289`; current main `58387c4eb55ec5cd1c185b9c190b372b7141b054`. This supersedes the original report's pending-source gate and earlier main metadata. Replacement handoff acceptance remains pending fresh scoped fix review.

Docs-only: no implementation, code, tests, database probes or commits. Verified replacement bytes/hash and inspected the focused original-to-replacement diff; no claim of implementation verification or review acceptance. The report's own final hash is supplied in the return message to avoid a self-referential hash field.
