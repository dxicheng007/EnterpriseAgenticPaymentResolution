# Company A Task 2 independent review

Base: `2fb67eab6b62c1bdde4e1d98ffeaec153ba5e6b3`
Reviewed candidate: `0c3bcafe27a38d43c54c9e209c33b9d3a3d971c4`
Reviewer: fresh independent agent `/root/demo_task2_review`; separate from builder and supervising root. No subagents or candidate edits.
Checkout: `/Users/devincheng/.codex/worktrees/company-a-demo-review/EnterpriseAgenticPaymentResolution`, detached exact candidate, clean tracked worktree before and after checks.

Spec: PASS. Quality/security: PASS. Focused verification: PASS. Status: verified for Task 2 only. Joint acceptance: pending.

No actionable findings; no severity/location defect entries.

## Scope and evidence

Read canonical Task 2 brief/report and supplied diff, verified actual eight-path Git delta, root/apps/tests instructions, tracked demo design and interfaces, implementation plan Global Constraints, PR56 amendment, relevant PRD process/acceptance constraints, ownership, freeze and independent verification policy. Task 1 is an accepted dependency; this review does not reopen its full financial/recovery implementation.

- `apps/control/src/demo-source-composition.ts:28`: source/service/operator token separation, constant-time bearer validation through accepted helper, rejection of reviewer cookie/CSRF headers, disabled mutation route, fixed scenario-only injection using real existing scenario admin. Strict empty object, canonical path/no query, JSON media type and 4096-byte parser cap protect mutation input. Feed paths are the two fixed streams; raw URL validation requires exactly one canonical cursor and no GET body. Pages come directly from existing fetchChanges without filtering.
- `apps/worker/src/demo-source-client.ts:12`: fixed canonical loopback HTTP origin, scoped source/stream/cursor, no redirects, two-second timeout, 1 MiB decoded-byte bound including streaming bodies, 100-event maximum, strict page and accepted content-hash validation. Errors collapse to stable source-unavailable code.
- `apps/worker/src/demo-sync-composition.ts:14`: operator-only empty command calls accepted Task 1 service directly; enabled composition checks distinct credentials. No caller monetary plans, source events, hashes, or approval inputs. Stable redacted responses and no-store behavior reuse accepted error helper. Generic PR56 route remains untouched. Admission-token separation in supervisor remains Task 3 scope.
- `tests/fixtures/sync-apply.ts:179`: exposes existing source dependencies only; preserves existing fixture generation, genuine activation and teardown.
- `tests/integration/demo-company-a-transport.test.ts:84`: actual separate control/worker HTTP listeners over isolated migrated databases prove operator injection, source feed and semantic HTTP reads, durable runtime capture and actual P1 application. Receipt changes 80000 to 50000, parent version advances once, cutover remains 80000. Dropped post-commit response and reconstructed worker recover the original receipt with replay true and no new source read or receipt. Disabled/unapproved commands produce no parent writes; foreign event remains durably captured and blocks application.

## Independently executed checks

Environment: Homebrew Node 24/PostgreSQL 18 on PATH; owned port 55442, `EAPR_TEST_PREFIX=eapr_test_review_t2`, `EAPR_DEMO_NAMESPACE=eapr_review_t2`; fallback ports control3241/worker3242/web5182. HTTP tests use ephemeral loopback ports. No original or integration cluster touched.

1. `npm run test:integration -- tests/integration/demo-company-a-transport.test.ts` — exit 0; 3/3 tests passed, 57.10 seconds. Includes required success and highest-risk foreign-source negative, plus disabled/preapproval case. Log: `/tmp/company-a-task2-review-integration.log`.
2. `npm run test:unit -- apps/control/test/demo-source-composition.test.ts apps/worker/test/demo-sync-composition.test.ts apps/worker/test/demo-source-client.test.ts` — exit 0; 3 files/3 tests passed, 2.42 seconds. Cases include canonical query/body rejection, authorization before malformed body parsing, secret redaction, malformed/wrong/incomplete pages, redirect rejection, declared and streamed oversize, and timeout. Log: `/tmp/company-a-task2-review-unit.log`.
3. `git diff --check 2fb67eab6b62c1bdde4e1d98ffeaec153ba5e6b3 HEAD` — exit 0. `git status --short` empty; HEAD matches candidate. Existing implementation report records typecheck and full unit pass; reviewer did not repeat those broader checks.
4. Verified owned PostgreSQL pid file data directory and port 55442 before stopping with `pg_ctl stop -D .local/pgdata -m fast -w -t 20`. Shutdown succeeded; subsequent `pg_ctl status` returned expected exit 3, no server running. Integration fixtures completed teardown before shutdown.

## Proof limits and lease release

Focused machine evidence and independent review do not constitute full V5/V6, live construction, both-source operation, process-supervisor restart, browser/read-model proof, or joint acceptance. No supervisor/CLI/production mount exists in this candidate. Worker reconstruction proof is a fresh HTTP composition against persisted databases, not a child-process restart. No instrumented model-call claim is made.

Source/test review lease released; owned review cluster55442 stopped. No candidate files changed, no commit created. Task 3 may proceed under coordinator authorization based on this Task 2 pass.
