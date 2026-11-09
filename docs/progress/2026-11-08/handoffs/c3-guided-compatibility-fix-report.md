# C3 guided preview browser compatibility

- Branch `codex/v2-guided-browser-fix`
- Worktree `/Users/devincheng/.codex/worktrees/acquisition-verification-startup/EnterpriseAgenticPaymentResolution`
- Base `a356b11c23af2afaa6e23447b2d78a75237b00bb`
- Candidate `b1b56059ab1de3f0c6ec5562e9deba1f28ebd88e`, clean after commit
- Tracked scope `tests/e2e/v2-evidence-verification.spec.ts` only

## Evidence

The coordinator reproduced the red twice at the exact base. The existing browser test timed out on the obsolete fixture label after reviewer bootstrap and candidate selection, before preview or verification. See the sibling `v2-combined-failure-investigation.md`.

The test now checks the visible fixture and empty-target label. It uses the definition paired with the exact `Projected balance` label, which distinguishes B's projected zero from the empty target's zero. It opens the result's `Artifact details` before checking the exact visible hashes in that disclosure. This keeps the hash assertions on the preview artifact fields when the same profile hash is also reachable through captured coverage.

- `npm run typecheck` exited 0.
- `npm run test:e2e -- tests/e2e/v2-evidence-verification.spec.ts` passed 1/1 in Chromium on the isolated local services and PostgreSQL. Test 18.5 seconds, command 19.9 seconds.
- The focused run produced the same exact title, `verification-v2-company-a.png`, `verification-v2-company-b.png` and `v2-browser-results.json` with schema version 1. The artifact directory contained no trace or video. Selected result fields confirm A 80000 and B 0 projected cents, zero parent writes, both eligible v2 jobs, all thirteen checks per company, and all six assertion flags true.
- `git diff --cached --check` passed. PG 55438, control 3601, worker 3602 and web 5179 used prefix `eapr_test_review_t2`. The isolated PostgreSQL instance stopped afterward.

Local private run directory `/tmp/eapr-v2-guided-fix.0toZa0/browser`. This run supplies focused machine evidence. Independent exact-candidate review, the full combined V2 gate and joint acceptance remain separate.
