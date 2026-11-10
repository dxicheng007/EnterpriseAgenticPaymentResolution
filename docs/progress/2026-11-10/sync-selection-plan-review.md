# Independent review: bounded read-only sync selection plan

Candidate: `docs/superpowers/plans/2026-11-10-sync-selection.md` in `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

Verified candidate SHA-256: `89b4004bfb6e453f1bbd3069c43e2e89c11debda8f134e77aa8d5e81f97d26c0`.

Verified accepted design SHA-256: `0f01668bffbfe799ba38f940781d6e1a2e37e6b6a6a4585ede7095c8db1b3b6d`.

Specification verdict: **PASS for this document-only implementation plan**.

Implementation-plan quality verdict: **PASS; no actionable findings**.

This verdict is not source release, implementation acceptance, a test result, or approval of any new producer/evaluator scope. The plan's final P1 reconciliation, root path/lease release and fixture dependencies remain operative.

## Findings

None.

## Review basis

- **Pre-routing drift and valid-unknown independence:** Plan lines 90–117 and 198–223 preserve the accepted design repair. The guard validates each distinct applicable approved binding before account filtering, retains successful checks and actual diagnostics, propagates `SOURCE_SCHEMA` to all consumers of that binding, and returns global incompleteness for unexamined validation. Known/unknown renamed/missing cases, actual paths, separate-contract and unaffected-binding controls, inactive and acknowledged inputs, and the non-schema fail-fast limitation are explicit. This matches design lines 88–105 and the initial/fix1 review disposition. The existing seam is real: `packages/compiler/src/operations.ts:29–66` exposes the described behavior through the package's `./operations` export. It does not depend on ordinary `UNKNOWN_ACCOUNT` classification reaching payload validation.

- **Exact enrollment and earliest whole-group selection:** Plan lines 216–238 retain exact selected profiles, inactive observations, full-source guards and the separate full unfinished-corpus classification. The complete mapped typed index, every provider representative and compiler group, existing-allocation/capacity/reversal coupling, original receipts, all-replay handling, strict invocation limits and selected-closure reclassification are represented. The test steps distinguish defensive synthetic compiler-output cases from realizable DSL behavior. They do not authorize an alternative mapping/equality interpreter or plan slicing. The consumed compiler types and signatures are present in `packages/compiler/src/plan-batch.ts:19–50`; ordering helpers match `apps/worker/src/sync/dependencies.ts:18–27,55–90`.

- **One snapshot and helper feasibility:** The narrow authority export at plan lines 185–196 is feasible without changing authority behavior. `current-authority-store.ts:163–194` already accepts a caller-owned client and takes the unlocked branch when `lock` is false; the undefined command key avoids command-specific association lookup. The existing pool-owned reader at `:197–214` would open a second connection, so the proposed delegation addresses a concrete seam. Plan lines 240–292 require catalog/capture/history admission on the same read-only repeatable-read client, no transaction ownership in subreaders, clean termination before classification, 2-second statement and 5-second transaction limits, and cleanup rather than an abandoned race-return.

- **Finite reads and transitive history:** Plan lines 248–278 require key/row/byte preflight before invoking existing blob-loading helpers, both-direction capture membership checks, all retained incidents, complete subject-specific cuts and global zero-proposal failure on structural incompleteness. The transitive closure requirement is necessary and correctly explicit: `activation-store.ts:171–199` loads the approved snapshot through the committed import; `sync-store.ts:123–173,238–264,404–496` reaches receipts, historical snapshots, origins, deliveries and prior units. Task 7 expressly budgets those helper-reachable objects before strict decoding, rather than treating an exact unit key as a bounded leaf read. Its conservative complete source-global economic/origin catalog is declared as an additional admission restriction, not a filtered absence claim. Query/index performance remains implementation proof and may fail closed; no new index or migration is silently authorized.

- **Result and witness completeness:** Plan lines 119–183 freeze distinct internal cut/result types and explicit canonical preimages, including contract observations, exact origins, full-source guard classifications separately from unfinished/selected classifications, group/closure metadata, evidence references, and proposal hashes bound to the cut. Reusing `CoverageCut['checkpoints']` includes both baseline and capture cursors (`packages/parent/src/sync-types.ts:39–42`), without adopting P1's whole single-stream coverage schema. Incomplete results have a closed reason vocabulary, bounded observations with incomplete status, and no proposals. Tests at lines 289–304 require reconstruction, deterministic repeated/recreated-service results, coherent concurrent snapshots, and durable-row equality across success, incomplete and error paths.

- **Honest fixture gates and executable bounded work:** Plan lines 57–65 identify a real dependency rather than assuming a custom catalog proves approval feasibility. The protected producer explicitly selects fixed Company A/B definitions and rejects other manifest streams (`packages/evaluator/src/evidence-fixtures.ts:203–209`). Same-feed independent fixture feasibility is also not claimed. Lines 296–305 leave cross-stream/separate-feed and other genuine multi-subject cases mandatory behind a separately reviewed fixture construction/release; pure tests and fixed A/B cannot satisfy them. The untouched source/evaluator/protected-truth boundary is maintained. Independent pure work, the caller-client seam, and existing single-subject read/concurrency proofs have useful outputs while those dependencies remain closed. Tasks 1–9 specify consumed and produced interfaces, owned paths, concrete assertions, focused commands and logical commits; behavioral-red instructions reject import-only failure, and Task 9 correctly does not require intentionally breaking an already-correct implementation.

## Evidence and remaining gates

Reviewed the exact plan and accepted design, both design reviews, applicable root/app/package/compiler/parent/evaluator/test/database instructions, relevant frozen identity/DSL/financial rules, shared ownership and verification conventions, accepted P1 coverage/writer review records, and current source only for the concrete interface/feasibility checks described above. Accepted P1 storage `7af5d8a`, coverage `7161d6e` and writer `a20054ae66a9d7d3fdff6d1bd1a386ef08a9c0c6` remain the supplied dependency baseline. This does not review moving Task 4 tests or infer whole-P1 acceptance.

Before source execution, root still must reconcile final P1 acceptance/interfaces and release the exact paths/leases. Same-feed helper feasibility and the separately owned source-contract/protected-evaluator admissions remain unresolved dependencies. Before Phase A completion, all mandatory genuine integration cases must actually execute, followed by fresh exact-candidate implementation review and separate joint acceptance. None is waived by this plan verdict.

Verification performed here: read-only document/source inspection and SHA-256 checks only. No database operation, test execution, source/repository edit, Git operation, provider/model request, or subagent delegation. Only this temporary review report was written.
