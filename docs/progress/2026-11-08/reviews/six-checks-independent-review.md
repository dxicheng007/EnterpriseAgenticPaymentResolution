# Independent review: six evaluator checks

Reviewed exact detached candidate `43d464da48e83674bc752642095e0ea95474131e` against accepted prerequisite `1cbb0916390b47dd3317b8e0ab872f9804eb543d` in `/Users/devincheng/.codex/worktrees/acquisition-evaluator-review/EnterpriseAgenticPaymentResolution`. Read repository, packages, evaluator and tests AGENTS guidance, the exact six-check brief (declared SHA-256 `9149e53ef1bb67eae67c84a8d47044dbb1495d31e2b8f0448432dca43a3b4c71`), changed implementation/tests, and builder report. Root's two explicit brief corrections were applied: compile-valid alternate B money mapping is inexpressible; fractional/unsafe raw numeric B inputs are boundary tests, not valid-hash money cases.

## Decision

No actionable blocking findings in this bounded increment. Spec compliance and code quality review pass for these six checks plus preserved baseline only. This is independent review evidence, not V2 completion or joint acceptance.

The implementation predeclares the complete profile/case matrix and independent expected facts before any subject runs. Recipe selection reads source contracts and protected profile/term/identity facts, not executable mappings. Every scheduled case uses the supplied artifact and unchanged supplied profile through the real fixed planner subprocess. Inapplicable required profiles suppress the entire check with unavailable/zero cases; unexpected execution failures count as failures. Case provenance, hashes and expected facts remain private. Both new executable recipe/plan files are included in evaluatorBuildHash. The oracle itself is unchanged, and the control-import protection test remains passing.

Captured B's baseline remains zero and A's 80,000 cents. Separate declared F8 probes start at 80,000, stay there for an unallocated 30,000 payment, and reach 50,000 only after explicit allocation. No generated-history invoice capacity or cross-candidate pass is borrowed. Real B unknown-account input is retained and held unscoped. Duplicate delivery, new-delivery economic deduplication, conflict holds, fresh-process deterministic replay, source-contract invalid-money rejection, over-allocation/funding and foreign-scope references all have independently expected outcomes. Negative comparisons retain original records and detect unintended financial effects.

## Independent execution

Environment: Node 24.22.2, PostgreSQL 18.6. PATH prepended `/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin`. Integration lease: EAPR_PG_PORT=55436, EAPR_CONTROL_PORT=3401, EAPR_WORKER_PORT=3402, EAPR_WEB_PORT=5177, EAPR_TEST_PREFIX=eapr_test_review_t2.

- `npm run test:unit -- packages/evaluator/test`: 38 passed, six files, exit 0.
- `npm run typecheck`: exit 0.
- `npm run test:integration -- tests/integration/v2-verification.test.ts`: three passed, exit 0; real PostgreSQL, HTTP, candidate registry, protected pinning and actual evaluator/subject processes.
- `npm run test:unit`: 106 passed, 19 files, exit 0.
- `git diff --check 1cbb0916390b47dd3317b8e0ab872f9804eb543d HEAD`: exit 0.

The integration assertions independently rerun against the candidate confirm stored A/B passing counts of baseline 1, new_record 4, duplicate_delivery 3, retry_restart 3, invalid_money A3/B5, allocation_scope 4, unknown_identity 2: A20/B22 actual executions. All six remaining mandatory checks (full_reversal, dependency_order, schema_drift, semantic_drift, snapshot_boundary, evidence_support) remain unavailable/zero. Coverage is allocation/credit/invoice/payment, eligibility false, and unexplained difference zero for the valid candidates. Product summaries exclude case provenance and private hashes. Registry authorization, attempts and redaction regressions pass.

The changed B relationship candidate passes captured baseline but fails the same candidate's F8 new_record check, with 720,000 noncancelling cents difference. A compile-valid B due-date mutation fails baseline with zero cents difference. Separate compile rejection and numeric boundary tests pass without counting boundary-only inputs as money cases.

Additional independent probe (inline `node --import tsx --input-type=module`, no saved helper or product edits): compiled public A, ran actual subject, confirmed original full comparison passes, then separately corrupted the returned financial operations before invoking compareSubjectOutcome. Missing invoice and duplicate extra invoice each fail with 300,000 cents difference; amount +1 fails with one cent difference; wrong allocation invoice relationship, wrong invoice due date, and wrong account scope each fail with zero cents difference. These isolate comparison sensitivity beyond builder assertions and do not contribute to product report counts.

## Limits and cleanup

Did not independently rerun the full 22-test integration suite; builder's full-suite claim remains separate from the focused three-test independent run. No browser/live/provider, persisted parent, durable worker crash/retry or joint acceptance claim. Retry coverage is planner replay only. Evidence support remains explicitly unavailable and default UI verification remains unavailable.

No product edits, helper additions, commits or pushes. Working tree remained clean. Review-owned PostgreSQL was stopped with `EAPR_PG_PORT=55436 npm run db:down` (exit 0); no listeners remained on 55436/3401/3402. Web was not started.
