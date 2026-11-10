# Experience MVP implementation completion

Date: November 10, 2026  
Branch: `codex/experience-company-a-mvp`  
Starting commit: `b926a41`

## Implemented scope

- Operations reads current authority independently from the connection overview. Only the dedicated authority read enables pause, resume, or revoke.
- Authority commands persist their exact schema version, account, action, epoch, and idempotency key in account-scoped session storage until resolved. Uncertain network and 503 outcomes retain an explicit original-command retry.
- A 409 retires the rejected command, hides stale controls, refreshes both reads, and requires a new deliberate command with a new key.
- Same-identity authority display has a nondecreasing epoch floor. Historical replay responses are reported as recovery results but never installed as current authority.
- The browser exposes committed activation, artifact, profile, and manifest identities. Runtime model calls are described as an AI-off/forbidden posture with a literal unmeasured value, and the single-customer fixture copy disclaims shared-lane isolation.
- The browser activation harness mounts authority admission and worker authority with distinct capabilities and uses the `local-demo-v1` fixture seed.
- V3 browser coverage rejects missing-CSRF and wrong-account approval attempts, verifies exact deterministic receipt replay, and attaches run-specific sanitized receipt/activation/epoch/cents evidence.

## Verification

Run with Node `v24.22.2`, PostgreSQL 18 binaries, and the isolated namespace `55444/3251/3252/5184`.

- `npm run typecheck` — passed.
- `npm run test:e2e -- tests/e2e/v3-review.spec.ts` — 5 passed.
- `npm run test:e2e -- tests/e2e/v5-operations.spec.ts` — 5 passed.
- `npm run test:e2e -- tests/e2e/v5-ai-off.spec.ts` — 1 passed.

These are focused machine checks, not full V3/V5 acceptance, independent exact-candidate review, or joint user acceptance.

## Remaining T8 rehearsal work

- Three timed single-Company-A rehearsals have not been run.
- Each rehearsal still needs fresh isolated first-apply state, exact source/run IDs, timings, pass/fail observations, and retained sanitized evidence.
- The operator injection/replay beats and the observed `80000` cutover to current `50000` with one economic effect remain rehearsal evidence, not claims established by these browser checks.
- Shared-lane multi-customer visibility remains explicitly outside this single-customer fixture proof.
