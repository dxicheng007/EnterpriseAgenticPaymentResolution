# Independent V4a contract implementation review

**Spec verdict: PASS. Quality verdict: PASS. Ready for integration of this contract-only candidate: yes.** No critical, important, or minor actionable defect found in the assigned six-file change. This is schema/helper acceptance, not V4 completion, live orchestration, bootstrap, activation, or joint user acceptance.

## Exact candidate and authority

- Base: `fbd6f0fe3ce6bf3fda9a128c7d6aebf4d1549970`.
- Candidate: `40c8c6dc398ff08e3781bd11ded2abc2ad5b0235` (`feat: freeze bounded discovery contracts`).
- Reviewed directly in `/Users/devincheng/.codex/worktrees/acquisition-evaluator/EnterpriseAgenticPaymentResolution`; HEAD matched and tracked/untracked status was clean before and after review. No source, index, branch, or HEAD changes were made. No subagents, merge, or push.
- Read the exact `b-v4-contracts.md` handoff, builder report, accepted architecture, completed architecture fix review, applicable root/packages guidance, current full profile parser, v1 contracts/canonical helpers, activation addendum, and verification conventions. Applied the task's explicit owner rulings for v2 numeric/depth/message semantics and compiled assessments.
- Recomputed architecture SHA-256: `b1837d309cf42af960838b61fc7a4c9aee64cb3a74150ca0f0c8b81cc715f3cf`, matching the accepted input.
- The supplied review package's diff body exactly equals `git diff -U10 BASE HEAD`; its introductory commit/stat metadata is outside the diff body. The six-file scope is exact: two implementation modules, barrel exports only, two unit files, and the new freeze addendum.

## Findings and strengths

No actionable findings.

The implementation preserves the intended boundaries:

- `packages/contracts/src/discovery.ts:28` bounds free-form v2 JSON iteratively before the recursive existing parser and consistently applies safe integers/no negative zero. Its field-specific use covers arguments, tool schemas, transcript results, finding values and alternatives. The 128-container boundary is counted from each free-form root. Existing profile/v1 JSON domains are not rewritten.
- `packages/contracts/src/discovery.ts:76` checks internal grant/binding consistency and explicitly projects the five existing context fields through the v1 parser. No authenticated authority is inferred. The browser entry has no new Node/provider/database dependency; byte checks use `TextEncoder`.
- `packages/contracts/src/discovery.ts:113` correlates open tool calls by server step identity and exact name, rejects step reuse and unresolved batches, and permits native IDs to repeat across different batches. `discovery.ts:132` and `discovery.ts:142` enforce policy limits, per-argument/envelope sizes, call counts, stop reasons and optional-message normalization.
- `packages/contracts/src/discovery.ts:175` retains the complete refined current profile parser. The draft adapter rejects own hash properties, adds the temporary hash only for parsing, and strips it from the output; bootstrap and nested profile refinements remain intact. Pending/agent constraints cover both draft and full discovery profiles.
- `packages/contracts/src/discovery.ts:205` requires exact compiled hashes and an empty assessment blocker/code set while preserving historical draft/blocked representations and warning diagnostics. State set identities and bounded counters remain structural rather than an invented completion engine.
- `packages/contracts/src/discovery-helpers.ts:8` uses the exact two-field step-ID preimage. `discovery-helpers.ts:23` validates server bounds separately, enforces canonical bytes/run/future checks before the retention floor, and distinguishes invalid from resync-required cursors.
- `packages/contracts/src/discovery.ts:245` rejects unordered/duplicate/non-control/out-of-window events, keeps continuing pages at their final event below high-water, and requires exhausted pages to advance to high-water. It does not pretend to prove database lookahead or requested-run filtering.
- `docs/superpowers/plans/2026-11-08-contract-freeze-v3-discovery-shapes.md:71` explicitly leaves authorization, durable blocker provenance, coherent activity reads and bootstrap/evaluator proofs with their consumers. No worker/model or financial behavior was added.

## Independent machine evidence

Executed two independently authored inline probes directly against candidate source with Node `v24.22.2` using `node --import tsx --input-type=module` (Node 24 added to PATH). Both exited 0; **87 independent assertions passed**. These were bounded probes, not a rerun of the builder's unit suite.

1. **69 assertions:** all six v2 free-form entry paths accepted depth 128 and rejected 129 and 4,000 without `RangeError`; rejected fractional/negative-zero/unsafe/nonfinite numbers and nested prototype keys; accepted string decimal amounts and maximum safe integers; normalized undefined result message before canonical serialization; accepted compiled warning diagnostics but rejected assessment diagnostic codes; classified retained/future/wrong-run cursors with run validation preceding retention; accepted repeated native IDs under distinct step IDs and rejected step reuse.
2. **18 assertions:** independently rehashed absent/present-bootstrap drafts, checked synthetic hash omission and hash-injection/bootstrap-ID/coverage rejection; checked all three exact step-ID vectors and both exact cursor vectors; checked interleaved continuation pages, empty exhaustion, and rejection of high-water skipping, impossible continuation at high-water, and reversed sequences.

Also ran `git diff BASE HEAD --check` successfully and checked clean candidate status. Read both added test files and the builder's reported focused compatibility/unit/typecheck results. The builder's 42 focused tests, 186 full-unit tests, typecheck and red-phase history remain attributed to that report; they were not independently repeated or newly claimed here. No database, browser, model, provider, or evaluator execution was needed for this assigned review.

## Declined to judge

- Persisted source/session authorization, dispatch fences and cross-run lookup isolation: explicitly deferred consumer obligations; structurally valid forged grants are intentionally representable.
- Completeness and durable provenance of blocker assessments, invalidation/finish races and reference DAG existence: require the later database/service implementation; an empty serialized assessment is not proof.
- Run/offset/limit filtering, lookahead exhaustion, retention pruning and SSE replay/disconnect behavior: reader/transport scope, not a page-shape guarantee.
- Actual provider budgets, token metering, tool allowlists and equality between separate request/result dispatches: adapter/dispatcher scope.
- Recursive robustness or numeric-domain changes inside the unchanged v1/full-profile/activity schemas: explicitly preserved existing semantics; the new 128-container rule applies to the designated v2 free-form fields.
- Bootstrap evidence support, readiness, financial correctness, activation, deterministic synchronization and user acceptance: outside this contract patch and not established by these probes.

## Assessment

The exact candidate implements the published schema/helper handoff without broadening runtime or financial behavior. Its tests and documentation cover the consequential representation boundaries, and independent adversarial probes confirmed the areas most likely to hide parser or pagination regressions. No repair is requested before integrating this bounded candidate. Consumer implementation and joint acceptance retain their separate gates.
