# Task 4 independent review — repaired exact candidate

Verdict: **reviewed; no blocking findings** for the seven-path Task 4 candidate. Independent machine validation passed. This is a fresh review of the entire candidate, not carried-over approval from the failed initial review.

- Reviewer: assigned independent Astra `/root/demo_task4_fixed_review`, separate from the Task 4 implementer and supervising lead `/root`.
- Exact candidate: `8468b7e0b4de8c0034de633d897c110844065642`.
- Base: `ce67b657cebc1db1ebdc94da04e89f0609c35d46`.
- Independent checkout: `/Users/devincheng/.codex/worktrees/company-a-demo-review/EnterpriseAgenticPaymentResolution`.
- Initial checkout was clean detached `3951388245e78f9b38cf6574b4d072f3c048a68e`; selected repaired SHA with `git switch --detach`, without reset. Final checkout remains clean and at the exact reviewed SHA. No source edits made.
- Contract freeze v1 SHA-256: `863cdbc91c527b5e6d1f08e0ee7dedfd4483a0548249954ea732e196394d077a`.
- Demo contract SHA-256: `a88a99811d47320f9e9aa47d034823589f124635c23f3a57649cd7c0734ef035`.
- Joint acceptance: **pending**. This review does not establish full V5/V6, live construction, browser acceptance, all-egress containment, or completeness of other tasks in the whole branch.

## Scope and findings

Reviewed all seven changed owned paths against the Task 4 brief, implementation plan and gate design, particularly its final Release refinement. Read repository/scripts/tests guidance, financial identity/receipt/version contracts, evidence conventions, existing report normalization and bounded file readers, and accepted mounted-process proof helpers. Diff is 516 additions and 10 deletions; `git diff --check` passed.

**No P0/P1/P2 finding established in this candidate.**

The prior P1 is resolved: `allocation.fundingRecordId` is compared with `payment.identity.recordId`, while receipt `targetRecordIds` still bind to actual derived `payment.id` and `allocation.id`. The independent actual gate exercised this repaired observer successfully.

The runner pins exactly six transport cases, twelve CLI cases, three app unit cases and typecheck. The parser rejects unknown keys, stale run tokens, invalid scope/scenario/financial/receipt/version facts, replay-only or initial-receipt substitution, and missing runtime proof. It reuses bounded regular-file reading and normalized report checking. Raw reports and observations are private temporary files; cleanup precedes packet emission, and cleanup failure fails the result. The retained public observation omits the run token, full receipts, bundles, environment and private paths.

The producer binds real registered/approved manifest, artifact, profile, spec and candidate identities; actual worker-authored initial/sync receipts; persisted fresh source event pair; one payment/allocation economic effect; same approved snapshot and authority; current 50000 versus cutover 80000; version 1 to 2; and recovery of the original sync receipt. Observation emission follows successful process assertions, child shutdown and fixture cleanup. Runtime proof remains accurately limited to the mounted worker global-fetch HTTP path, credential absence, positive controls and candidate source/dependency inspection.

`verify-slice.ts` changes are the new selector dispatch/usage branch only. Existing full V5/V6 registries and predicates are unchanged. Regression coverage preserves full V5 failure even alongside valid bounded evidence.

## Independent commands and results

SQL/service lease was explicitly released by `/root` before any test or cluster startup. All commands ran in the independent checkout with:

```sh
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH
export EAPR_PG_PORT=55442 EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_DEMO_NAMESPACE=eapr_review_t2
```

1. `npm run test:integration -- tests/integration/verify-demo-company-a-evidence.test.ts` — exit 0, **24/24 passed**. Covers positive bounded outcome, wrong identities/hash/epoch, replay/receipt substitution, wrong cents/time/version, changed approval, runtime proof negatives, unknown secret-bearing fields, stale/absent/oversized/symlink/malformed observation, malformed/missing/duplicate/skipped/todo/flaky/failed/wrong-file reports, unsuccessful commands, metadata/cleanup failure and full-V5 non-promotion. Log: `/tmp/company-a-task4-review-parser.log`.
2. `npm run verify:slice -- demo-company-a-ai-off unexpected` — correctly **exit 1**, usage only. Log: `/tmp/company-a-task4-review-extra-arg.log` (observed exit separately checked).
3. `npm run db:up` — exit 0; reviewer-owned cluster started on **55442**. Log: `/tmp/company-a-task4-review-db-up.log`.
4. `npm run verify:slice -- demo-company-a-ai-off` — **exit 0**, all exact six commands passed: transport 6/6, CLI 12/12, app units 1/1 + 1/1 + 1/1, typecheck. Diagnostics empty. Log: `/tmp/company-a-task4-review-gate.log`.
5. Independent packet inspection — assertions passed for clean exact SHA provenance, namespace/port, counts, command exits, empty diagnostics, bounded scope/status separation, distinct initial/new receipt with original receipt on replay, current/cutover balances, version transition, absence of run token/known private markers and only `manifest.json` retained in the packet directory.
6. `npm run db:down` — exit 0. Log: `/tmp/company-a-task4-review-db-down.log`. Verified reviewer `postmaster.pid` absent and ports **55442, 3241, 3242, 5182** clear; final `git status --short` empty and HEAD unchanged.

The exact gate internally ran:

```text
npm run test:integration -- tests/integration/demo-company-a-transport.test.ts --reporter=json --outputFile=<private-report>
npm run test:integration -- tests/integration/demo-inject-cli.test.ts --reporter=json --outputFile=<private-report>
npm run test:unit -- apps/control/test/demo-source-composition.test.ts --reporter=json --outputFile=<private-report>
npm run test:unit -- apps/worker/test/demo-sync-composition.test.ts --reporter=json --outputFile=<private-report>
npm run test:unit -- apps/worker/test/demo-source-client.test.ts --reporter=json --outputFile=<private-report>
npm run typecheck
```

## Independent retained packet

`/Users/devincheng/.codex/worktrees/company-a-demo-review/EnterpriseAgenticPaymentResolution/.evidence/8468b7e0b4de8c0034de633d897c110844065642/demo-company-a-ai-off/2026-11-10T20-30-44-530Z-45079/manifest.json`

- `result: passed`, `fullV5: not-established`, `independentReview: pending`, `jointAcceptance: pending` in machine output, as required.
- Node `v24.22.2`; npm `11.19.1`; PostgreSQL `18.6`.
- Lockfile SHA-256: `33876ee4d2e88cc96bc319c74d088630800795d47b6fc6fa95db683dff0d70aa`.
- Public sync receipt: `receipt:90dcc8d7-2bba-471f-9b1b-5bc5e8e3acea`; replay references that identical receipt.
- Actual artifact hash: `e551758c31eeaa02b389c9eecd592bb739d55bbdf4d534fe089905f95bf73386`.
- Actual approved snapshot hash: `f2d322e9ad0bd3b129cb21250e03b23314e6b75aa9981388cce7cc0c6d9d0ae6`.
- Fresh sync: `replayed: false`, 80000 → 50000, current as-of October 3; cutover remains 80000 at October 1; parent version 1 → 2.

Only reviewer-owned 55442 was started/stopped. The original checkout `/Users/devincheng/Documents/EnterpriseAgenticPaymentResolution` and shared 55441 were untouched. Integration checkout was read-only. SQL/service lease is released back to `/root`.
