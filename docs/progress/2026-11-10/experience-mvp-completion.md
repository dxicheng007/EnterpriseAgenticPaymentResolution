# Experience MVP implementation completion

Date: November 10, 2026  
Branch: `codex/experience-company-a-mvp`  
Base: `b926a412c2df441dec23afeab38ccbcc0b01fb73` (`origin/codex/platform-company-a-demo-mount`)  
Candidate: `bac37fa15cb8c085f56a27a5d928c23f413e8c58`

## Ownership

Experience-owned paths only (T3 / T4 / T8). Platform / gates / shared board / integration remain Developer 0. No edits outside the handoff owned-path list.

Requested implementer/reviewer models `gpt-6.1-sol` / `gpt-6-astra` were unavailable in this session. Implementation used available Sol-class delegation; independent exact-candidate review used a fresh Opus-class reviewer.

## Implemented scope (T3 / T4)

- Operations reads current authority independently from the connection overview. Only the dedicated authority read enables pause, resume, or revoke.
- Authority commands persist their exact schema version, account, action, epoch, and idempotency key in account-scoped session storage until resolved. Uncertain network and 503 outcomes retain an explicit original-command retry.
- A 409 retires the rejected command, hides stale controls, refreshes both reads, and requires a new deliberate command with a new key.
- Same-identity authority display has a nondecreasing epoch floor. Historical replay responses are reported as recovery results but never installed as current authority.
- The browser exposes committed activation, artifact, profile, and manifest identities. Runtime model calls are described as an AI-off/forbidden posture with a literal unmeasured value on this base (`runtimeModelCalls: 0` schema), and the single-customer fixture copy disclaims shared-lane isolation.
- The browser activation harness mounts authority admission and worker authority with distinct capabilities and uses the `local-demo-v1` fixture seed.
- V3 browser coverage rejects missing-CSRF and wrong-account approval attempts, verifies exact deterministic receipt replay, and attaches run-specific sanitized receipt/activation/epoch/cents evidence.

Changed owned files:

- `apps/web/src/features/connections/OperationsPage.tsx`
- `packages/client/src/parent.ts`
- `tests/e2e/support/review-activation.ts`
- `tests/e2e/v3-review.spec.ts`
- `tests/e2e/v5-operations.spec.ts`
- `tests/e2e/v5-ai-off.spec.ts`
- `docs/progress/2026-11-10/experience-mvp-completion.md`

## Focused machine checks

Run with Node `v24.22.2`, PostgreSQL 18 binaries, and the isolated lease `55444/3251/3252/5184` / namespace `eapr_review_t2`.

- `npm run typecheck` — passed.
- `npm run test:e2e -- tests/e2e/v3-review.spec.ts` — 5 passed.
- `npm run test:e2e -- tests/e2e/v5-operations.spec.ts` — 5 passed.
- `npm run test:e2e -- tests/e2e/v5-ai-off.spec.ts` — 1 passed.

These are focused machine checks, not full V3/V5 acceptance or joint user acceptance.

## Independent exact-candidate review

Fresh independent review of candidate `bac37fa` against the handoff and the four PR59 authority findings: **PASS** (no P1/P2). Non-blocking P3 notes only (no dismiss path for non-409 retained commands; simulated 409 path). Reviewer did not re-run e2e; author focused checks above remain separate from review.

## T8 timed Company A rehearsals

Three fresh isolated first-apply rehearsals on lease `55444/3251/3252/5184`, candidate `bac37fa`, fixture `local-demo-v1` / account `company-a.seller-a.cust-a-d22feb38e846-1`. Each run reset the leased demo databases and rebuilt operator policy on this checkout only. Original demo checkout/cluster untouched. Sanitized evidence retained under ignored `.evidence/experience-mvp-rehearsals/run-{1,2,3}/` (screenshots + redacted activation/inject summaries). Operator token never written into evidence.

| Run | Started (UTC) | Duration | Result | Activation receipt | Sync receipt (first → replay) |
| --- | --- | --- | --- | --- | --- |
| 1 | 2026-11-10T21:22:17Z | 165904 ms | pass | `receipt:a386b356-e129-4766-b89e-c38cecbbaf8e` after 80000 | `receipt:e4b25ae1-f5c3-414d-ad76-835aecd0574e` 80000→50000, then `replayed:true` same id |
| 2 | 2026-11-10T21:41:12Z | 165648 ms | pass | `receipt:161ec62b-028b-4f16-8482-0b5c455d5eae` after 80000 | `receipt:b3c2e2db-02e7-4db0-826b-82202b2cc3b9` 80000→50000, then `replayed:true` same id |
| 3 | 2026-11-10T21:44:55Z | 165809 ms | pass | `receipt:83629eb8-09f6-45aa-9679-684f3331877c` after 80000 | `receipt:9804e7d7-fac1-4f6f-8c14-99ce3731a107` 80000→50000, then `replayed:true` same id |

Observed demo-contract beats on each pass: Health ready; Sources `legacy-a`; Discovery model unavailable; Preview development-fixture / parent writes 0 / 80000; one-customer approve; Parent cutover 80000; operator `npm run demo:inject -- freshPaymentA`; Operations/Parent current 50000 with cutover still 80000; replay returns original receipt with one economic effect; runtime model calls labeled unmeasured/AI-off posture.

## Lease / cleanup

- Claimed lease announced on PR57: checkout `/Users/williamli/Developer/eapr-experience-company-a-mvp`, ports `55444/3251/3252/5184`, namespace `eapr_review_t2`.
- After this report/PR: stop supervisor and `npm run db:down` on this lease only; do not touch shared or original demo clusters.

## Integration notes for Developer 0

- Draft PR targets `codex/platform-company-a-demo-mount` for exact Experience diff review. Do not merge to main from this branch without Platform integration.
- Main after PR61 changed Connections `runtimeModelCalls` to `null` and shared-lane resolution. This candidate still consumes the base literal-`0` schema and labels it unmeasured. Integrating onto post-PR61 main will need a small Experience follow-up to render `null` as not measured without inventing a measured zero.
- Shared board updates remain Developer 0 only.

## Status boundary

Experience-owned T3/T4 authority findings, focused browser proofs, independent source review PASS, and three timed Company A rehearsals are recorded for candidate `bac37fa`. Full V3/V5/V6 gates, live construction, Company B, joint user acceptance, and Platform integration onto current main remain separate and are **not** claimed here.
