# Independent exact-candidate review — Platform legacy gate title

Date: 2026-11-10. Reviewer session: `/root/legacy_gate_review`, fresh independent review dispatched by `/root`; builder session ID was not supplied. Base: `12f6595afa7ffe42e669d1a8b72a7e1b0c8692d6`. Reviewed candidate: `3e791e69a39ca5a5ba2ba4145c3194c519028633`.

Review checkout: `/Users/devincheng/.codex/worktrees/company-a-demo-review/EnterpriseAgenticPaymentResolution`. Initial checkout was clean detached `85023c899367f2e93eead74b5bcd9513ef51fac1`; switched with `git switch --detach 3e791e69a39ca5a5ba2ba4145c3194c519028633`, without reset. Final HEAD is the exact candidate and `git status --porcelain=v1` is empty. No source edits were made.

## Verdict

No findings. Spec, quality, and scoped verification pass for this title correction. Status: verified for the exact two-file candidate. Joint acceptance: pending. This is partial parser evidence and independent source review, not full V5/V6, financial, browser, live-isolation, or joint acceptance evidence.

The only production change is `scripts/verify-slice.ts:854`: the required V5 case title now exactly matches `tests/integration/v5-sync.test.ts:253`, `applies a captured invoice once, recovers its receipt and fences stale input`. The added regression at `tests/integration/verify-slice-evidence.test.ts:292` checks the three expected titles against source declarations and excludes the old title. The actual sync suite is unchanged. V6 deliberately reuses the V5 allowlist, so it receives the same correction.

The normalization still requires exact case coverage. Existing missing/unexpected assertion regressions exercise rejection, and the new title regression exercises the corrected source mapping. No title normalization, substring acceptance, test-count relaxation, or gate predicate change was introduced.

`syncGateOutcome` in `scripts/verify-slice-evidence.ts:224` remains unchanged: even all-passing prerequisites return `result: failed`, `exitCode: 1`, and the full V5/V6 unavailable diagnostic. Both all-prerequisites-passing regressions and temporary-fixture failed-preflight CLI cases passed. The bounded Company A selector, evidence module, test file, and documentation are unchanged. PR60's misleading unlock documentation and guide edit are excluded. A byte comparison of the two assigned patch bodies (excluding Git blob IDs and hunk offsets) confirmed reuse of PR60's source/test hunks.

## Independent commands and outcomes

All commands below ran in the review checkout, except reading the supplied `/tmp` reports. Runtime: Node `v24.22.2`, Vitest `5.1.0`.

- `git status --short`, `git rev-parse HEAD`, candidate/base `git diff --stat` and full two-file diff: initial/final clean checkout; exactly two changed paths, 18 insertions and one deletion.
- `export PATH=/opt/homebrew/opt/node@24/bin:$PATH; node --version; npm run test:integration -- tests/integration/verify-slice-evidence.test.ts tests/integration/verify-demo-company-a-evidence.test.ts`: exit 0; two files and 89 tests passed; reported duration 1.72s. This includes missing and unexpected Vitest-title negatives, both full V5/V6 fail-closed cases, failed-preflight CLI fixtures, and the bounded Company A evidence regressions. The temporary preflight fixtures start no registered commands or services.
- `git diff --check 12f6595afa7ffe42e669d1a8b72a7e1b0c8692d6 3e791e69a39ca5a5ba2ba4145c3194c519028633`: exit 0.
- `git diff --quiet 12f6595afa7ffe42e669d1a8b72a7e1b0c8692d6 3e791e69a39ca5a5ba2ba4145c3194c519028633 -- scripts/verify-slice-evidence.ts scripts/verify-demo-company-a-evidence.ts tests/integration/verify-demo-company-a-evidence.test.ts scripts/AGENTS.md docs`: exit 0, confirming unchanged predicates, bounded evidence modules/tests, and docs.
- Python `subprocess.check_output` compared `git diff` for the assigned paths between base/candidate and `c62658248ed63aaf244cd340dd756fb1c184d401^`/`c62658248ed63aaf244cd340dd756fb1c184d401`, stripping only `index` and `@@` lines: assertion passed; both patch bodies match.
- Final `git status --porcelain=v1` and `git rev-parse HEAD`: empty status and exact candidate SHA.

Read root, scripts and tests AGENTS guidance; relevant demo contract, execution/verification conventions and orchestration policy; `/tmp/platform-legacy-gate-report.md`; and `/tmp/platform-merged-review.md`. Frozen contract v1 file SHA-256: `863cdbc91c527b5e6d1f08e0ee7dedfd4483a0548249954ea732e196394d077a`. Demo contract SHA-256: `a88a99811d47320f9e9aa47d034823589f124635c23f3a57649cd7c0734ef035`.

No database, SQL, service start/stop, lease use, browser, model call, full suite, or actual full-slice gate run occurred. No typecheck was rerun by this reviewer; the builder's reported typecheck is separate. Only this `/tmp` report was written in addition to ordinary test temporary/cache output and the authorized detached checkout switch. The Experience successor's service lease was untouched.
