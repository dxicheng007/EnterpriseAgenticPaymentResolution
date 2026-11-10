# Final Company A fix-wave independent re-review

Verdict: **reviewed; no findings** for the exact one-file fix. The prior P2 authenticated Connections coverage gap is closed. Spec, quality and bounded independent verification pass. No P0/P1/P2 residual finding was established in this wave. Joint acceptance remains pending.

- Reviewer: fresh Astra `/root/demo_final_rereview`, separate from builder and supervising lead `/root`; no subagents.
- Base: `40933883efb7ebec079174903d40191f0aa61350`.
- Exact candidate: `85023c899367f2e93eead74b5bcd9513ef51fac1`.
- Only changed source path: `tests/integration/demo-company-a-transport.test.ts` (34 additions, 9 deletions).
- Read-only source review checkout: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.
- Independent execution checkout: `/Users/devincheng/.codex/worktrees/company-a-demo-review/EnterpriseAgenticPaymentResolution`, clean at exact candidate before and after execution. No source edits or checkout changes made.
- Contract freeze v1 SHA-256: `863cdbc91c527b5e6d1f08e0ee7dedfd4483a0548249954ea732e196394d077a`.
- Demo contract SHA-256: `a88a99811d47320f9e9aa47d034823589f124635c23f3a57649cd7c0734ef035`.

## Source review

Read the prior whole-branch single-P2 review `/tmp/company-a-final-review.md`, accepted independent bounded gate report `/tmp/company-a-task4-review.md`, exact diff package, applicable root/test guidance, verification/ownership and orchestration conventions, relevant PRD/frozen contract requirements, approved mount design and actual schema/proxy/client/worker read composition.

The test now opens a genuine local reviewer session after mounted apply, worker reconstruction and exact replay, then calls `/api/connections/:accountId` through the actual control HTTP origin with its reviewer cookie. It parses `ConnectionStateV1Schema` and checks exact scope, original activation/epoch, incremented parent version, one applied batch and `lastReceiptId`. The two receipts include the actual new receipt selected by kind `sync`, correct identity/activation/epoch, before/after versions and 80000→50000 amounts; the initial receipt retains its original identity and 80000 balance. It checks null pending/quarantined counts and null lag for both exact expected streams. Existing assertions also preserve the stored initial receipt and approved target snapshot.

This entire required readback precedes `if (!collectObservation) return`, so ordinary focused execution covers it. The observation-only candidate read reuses the same session. No production, UI, DTO or financial behavior changed. `git diff --check` passed.

## Independent execution

No test, SQL or service command ran before `/root` explicitly released the lease. Read-only preflight confirmed exact clean candidate, no review `postmaster.pid`, and free ports 55442/3241/3242/5182. Commands ran only in the separate execution checkout with:

```sh
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH
export EAPR_PG_PORT=55442 EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_DEMO_NAMESPACE=eapr_review_t2
unset EAPR_COMPANY_A_OBSERVATION EAPR_COMPANY_A_RUN_TOKEN
```

Exact relevant commands and outcomes:

1. `git status --short` and `git rev-parse HEAD` — empty status, exact `85023c899367f2e93eead74b5bcd9513ef51fac1`, both before and after verification.
2. `git diff --check 40933883efb7ebec079174903d40191f0aa61350 85023c899367f2e93eead74b5bcd9513ef51fac1` — exit 0.
3. `npm run db:up` — exit 0; only owned loopback 55442 started. Log: `/tmp/company-a-final-rereview-db-up.log`.
4. Focused integration command below — exit 0, **3 passed, 3 intentionally unselected/skipped, 0 failures**, one file passed, duration 63.36 seconds. Log: `/tmp/company-a-final-rereview-tests.log`.
5. `npm run db:down` — exit 0; only owned 55442 stopped. Log: `/tmp/company-a-final-rereview-db-down.log`.
6. `test ! -e .local/pgdata/postmaster.pid` succeeded; `lsof -nP -iTCP:55442 -iTCP:3241 -iTCP:3242 -iTCP:5182 -sTCP:LISTEN` returned no listeners after cleanup. Node `v24.22.2`, npm `11.19.1`, PostgreSQL `18.6`.

```sh
npm run test:integration -- tests/integration/demo-company-a-transport.test.ts -t 'mounted Company A CLI applies with bounded worker HTTP isolation and recovers after process restart|disabled and unapproved private commands cannot write parent state|foreign source events remain in the real feed and block the fixed apply'
```

The mounted success executes the repaired authenticated Connections read with observation collection disabled. The independent high-risk negatives demonstrate disabled/unapproved commands cannot write parent state and foreign events remain captured while blocking the fixed apply without parent balance change. This is focused/partial verification, not a full suite run. No additional typecheck or bounded-gate rerun was warranted by this test-only delta; builder full-gate evidence and the prior independent gate report remain separate from this reviewer's commands.

## Limits and lease release

Review applies only to source candidate `85023c8` and this final fix wave. The prior whole-branch review identified no other finding; it is not silently reissued against later commits here. Root reported later documentation-only `20df2d8`; it was not this execution candidate.

The proof remains one Company A development fixture and the bounded mounted HTTP path. Full V5/V6, browser/Experience acceptance, joint user acceptance, live construction, all-egress containment and general steady-state synchronization are not established by this review.

The original checkout and shared 55441 were untouched. Review-owned cluster is stopped, mounted ports are clear, exact source remains clean, and the **SQL/service lease is released to `/root`**.
