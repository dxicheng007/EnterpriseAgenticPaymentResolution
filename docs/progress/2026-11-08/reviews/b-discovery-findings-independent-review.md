# Independent C1 exact-candidate review

Candidate: `84a5b0b6064ebce845a91905d0c8588690c3e9d8`; base: `f7e95d4748899b8bca091b7c2a7f41d58019c532`. Candidate HEAD was verified in `acquisition-verification-startup/EnterpriseAgenticPaymentResolution`. Reviewed the C1 handoff, implementation report, candidate diff, construction contracts, evidence helper, finding persistence/authorization, dispatcher, schema, and focused tests. No implementation edits or commits were made.

## Verdict

Request changes: one blocking C1 specification/quality finding. The existing passing tests do not cover delegation capacity as a whole-batch failure condition. This is not acceptance of C2/C3 runtime or live construction.

## P1 — Project delegation capacity before any successful batch effect

Location: `packages/discovery/src/supervisor.ts:706-708` (candidate), with `packages/discovery/src/tasks.ts:46-69` and `packages/discovery/src/repository.ts:270-275` explaining the late check.

The new whole-batch preflight projects finding CAS/identity consumption and edges, but each delegation is checked using `validateDelegation`, which checks only shape, captured subject, grant, and existing dependencies. It never checks or projects specialist or account-investigation capacity. Those limits remain in `insertSpecialist`, reached only when that particular step executes. Consequently the preflight declares an infeasible batch valid and commits an earlier publication, child, or successful read before the later delegation fails its budget.

Concrete reproduction: start a run whose source investigation already has ten specialists; accept the coordinator batch `[publishFinding(valid source finding), delegateTask(valid source specialist)]`. Execute the first step: all current preflight validations succeed and the finding, origins, current pointer, success result and activity commit. Execute the second step: `insertSpecialist` returns `SPECIALIST_LIMIT`. The accepted C1 requirement says whole-batch preflight must validate all implemented findings/reads/delegations before the first successful effect, including projected ordered effects and batch capacity. This batch instead retains the first successful effect. A second variant starts at nine specialists and requests two delegations: both independently pass preflight, the first child commits, and the second fails. The same problem applies to the twenty-account-investigation limit and to pending recovered batches.

Correction: include SQL-only delegation capacity validation and ordered projection under the existing owner/run lock before any effect. Account for repeated same-subject requests sharing an investigation and distinct new account investigations consuming distinct slots. Preserve existing budget diagnostics and capacity rules; do not weaken the guards or add authority. Add fresh and recovered mixed-batch tests at specialist and account boundaries asserting zero children/findings/success results/activity when the batch cannot fit. Tests should include two individually feasible delegations whose combined projected use exceeds capacity.

## Other reviewed boundaries

- The evidence helper reads every direct/alternative citation through the pinned source port and uses matching seller/account event associations, rather than capture membership, for account applicability. Unknown applicability remains a source-wide origin. The finding reader recursively authorizes the immutable derivation graph using publisher ceilings and the current task ceiling.
- Finding revisions, derivation edges and blocker origins are immutable at application-role privilege level. Exact revision/task/step and same-run references are bound with composite foreign keys. Current pointers have deferred exact-revision foreign keys. Sticky origins are not removed by positive revisions.
- Finding identities/revisions have persisted and projected limits, revision CAS, historical exact inputs, and identity-cycle validation. The dispatcher does not persist successful findings during preflight. Publication and its activity/result use the owner transaction, with current authority and replay fences.
- The new schema contains concrete C2/C3 storage, exact proposal/revision/assessment/compile links, immutable compile source and generation, and narrowly scoped mutable state/result columns. Runtime enforcement of publication/currentness and invalidation remains a future checkpoint, as assigned. No additional blocking DDL defect was identified in this review.
- Frozen empty evidence/derivation arrays remain structurally valid pending agent assertions. A supported label does not grant verified financial authority. This review requests no new cardinality rule.
- The two predecessor expectation edits add only the actual finding tool names. No test weakening was identified there.

## Evidence and limits

The finding above follows directly from the exact candidate call path; it was not independently reproduced with a new executable test. Per root instructions, broad suites were not repeated. Builder-reported typecheck, 341 unit tests, 75 PostgreSQL cases, and three closure tests are reported evidence, not independent executions by this reviewer. Existing fresh/recovered mixed-batch tests inject invalid finding publication, not exhausted or collectively over-capacity delegations. Their passing results therefore do not close this gap.

This is a static exact-candidate review with focused test inspection, not machine verification, joint user acceptance, genuine provider execution, financial readiness, activation or synchronization proof.
