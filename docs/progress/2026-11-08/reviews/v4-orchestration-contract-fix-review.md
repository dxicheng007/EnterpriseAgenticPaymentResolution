# Independent V4 orchestration contract fix review

Verdict: **R1 ADDRESSED; R2 ADDRESSED; R3 ADDRESSED.** No newly introduced critical or important breakage was identified in the scoped fix. The complete V4a contract is ready for the assigned B contract/schema and durable activity read-primitive implementation, subject to root acceptance of this exact proposal. No remaining architecture blocker from this review restricts V4a to the earlier independent subset.

This is a fresh, scoped architecture re-review of the prior findings and their fix, not a new broad review or an implementation acceptance. Acceptance enables the assigned implementation only. A/C consumers must wait for B's exact published exports and examples; this report does not approve consumer implementation, a passing V4 slice, live construction, bootstrap, activation, or user acceptance.

## Exact reviewed artifacts

- Revised `v4-orchestration-contract-proposal.md` SHA-256: `b1837d309cf42af960838b61fc7a4c9aee64cb3a74150ca0f0c8b81cc715f3cf`.
- Preserved `v4-orchestration-contract-review-baseline.md` SHA-256: `b67326a3de4302365406cca776e2d691275a6a020648965f94d3307f311ccd13`.
- Scoped `v4-orchestration-contract-fix-r1.diff` SHA-256: `81899897a07437a3d354e9f83bba00b4d27655435c73da2b63e9aeb01ab5c9e3`.

All three hashes were recomputed from saved bytes. The supplied diff was independently regenerated from the preserved baseline and revised proposal and matched exactly. The initial review and author fix report were read; verdicts below are based on the revised normative text, not the report's claims.

## R1 — ADDRESSED

Proposal §2 lines 75–79 defines a server-owned `toolStepId` from globally unique dispatch identity plus the provider-native tool-call ID, backed by primary/unique keys. Provider response identity remains distinct. Identical dispatch replay resolves the existing step; altered output/name/arguments conflicts before execution. §5 also requires an exact dispatch-result hash match and unique dispatch ordinal. Another turn or task reusing native `call-1` therefore cannot borrow the prior result.

The v2 transcript explicitly excludes the v1 callId-only result and binds calls/results by exact toolStepId and name. The HTTP detail route binds that same ID to the requested run/task/dispatch, while activity and V4d verification use the same identity. Required examples cover repeated native IDs across turns/tasks, exact replay, changed arguments, and cross-run reads. The computed ID fits the current Id schema. Runtime identity/authorization checks remain assigned to the dispatcher and persistence layer; shape validation is not presented as their substitute.

## R2 — ADDRESSED

Proposal §2 lines 128–136 removes model-selected `findingRefs` as the authority for blocker inclusion. Server-derived capture/source/raw-account keys resolve unique investigations; source-wide findings apply to every proposal. Same-account redelegation or a fresh proposal cannot create a clean investigation. Existing proposal revisions retain prior bindings, and ambiguous applicability creates a source-wide unresolved blocker.

The durable assessment retains exact blocker origin revisions independently of consumed references and current finding revisions. An agent revision to supported, omitted references/profile findings, changed alias/scope, or positive financial verification cannot clear a known contradiction. The bounded conservative policy treats all listed unsupported statuses as potentially material and provides no invented resolution authority. This can leave work blocked until a separately specified resolution workflow exists; that is an explicit scope limit, not a hidden success path.

Finding/blocker publication atomically updates assessment/run revisions and stales current links. Compile publication and finish recompute the server-owned set under the run lock. Completion checks every opened investigation and source-wide blocker, so switching to another account cannot erase an unresolved earlier investigation. Required examples cover the omission attack, fresh investigation, supported revision, ambiguous scope, and concurrent compile. Historical compiled artifacts remain distinct from current assessment.

## R3 — ADDRESSED

Proposal §6 lines 275–281 specifies one SQL statement/MVCC snapshot for barrier H, floor F, and matching rows in `(after,H]`, using limit+1 lookahead. With more matching rows, nextAfter is the final returned sequence; only proven exhaustion permits nextAfter=H. This retains every interleaved same-run event and allows safe empty-projection progress. Publication after the snapshot is excluded until a later read. `after=F` is valid; `after<F` requires resync.

SSE IDs use each emitted event's exact sequence. Internal continuation advances only after the page's events are sent, and the standalone cursor cannot skip unfinished replay. The specified limit1/interleaved, empty, 101-event, publication-barrier, retention-boundary, and disconnect cases are sufficient contract examples for implementing the primitive. They are requirements, not passing test evidence.

## Requested clarifications — satisfied

- **Supervisor ownership:** §5 confines scheduler claims/completions to the advisory-lock-owning connection, forbids pool fallback, invalidates the local token on connection loss, and combines durable generation with exact dispatch/step fences. Replacement interrupts old unfinished claims and rejects late callbacks. Original verification request keys survive reconciliation. The required connection-loss test includes a healthy ordinary pool; remote cancellation/global live-provider concurrency remains unclaimed.
- **Bootstrap:** §§1/8 preserve the current profile schema/refinements and hash semantics, including absent-bootstrap compatibility and present-bootstrap hashing. The existing evaluator's bootstrap-unavailable branch is explicitly retained. Thirteen financial checks do not become bootstrap proof; stripping bootstrap, fabricated eligibility, and activation-readiness claims are forbidden.
- **Schema versus authorization:** §7 V4a explicitly allows that a syntactically valid forged grant may parse. Runtime persisted capability/session/capture checks belong to V4b/V4c; the v2-to-v1 projection confers no authority.
- **Session lifetime:** §6 matches the actual process-local session service without expiry metadata, requires current source authorization for cursor/state/history/tool reads and each SSE poll, and handles actual rejection/restart. The 60-second transport renewal is explicitly a transport policy, not a session TTL.

## Evidence limits

Read-only spot checks confirmed current Id/model schemas, profile/bootstrap hash behavior, evaluator unavailable behavior, and session authorization. No product code was changed, no tests or live calls were run, and no subagents were used. This review file is the sole output. Provider/API-key configuration remains deferred. Independent implementation verification, consumer review, T4.2 source-driven A/B construction, protected bootstrap assertions, explicit per-customer activation, AI-free runtime proof, and joint user acceptance retain their separate gates.
