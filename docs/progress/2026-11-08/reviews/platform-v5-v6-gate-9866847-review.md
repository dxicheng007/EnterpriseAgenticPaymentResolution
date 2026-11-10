# Bounded V5/V6 gate review — 9866847

Reviewer: delegated `/root/v5_v6_gate_review`, separate from the builder. This is a read-only exact-candidate static review, not a completed independent slice gate or joint acceptance.

## Identity and scope

- Candidate: `9866847c6f5989cb32e5cf8432cadc5d97939fb2`, resolved from `origin/lane/v5-v6-verify-slice-gates` (the supplied name appended the abbreviated SHA).
- Exact parent/base: `5aac86707f612bad64a6eadff9a34864061145a2`.
- Three-file diff only: `scripts/AGENTS.md`, `scripts/verify-slice-evidence.ts`, `scripts/verify-slice.ts`; 332 insertions, 5 deletions.
- Repository inspected: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`. Candidate and supporting tests/specs were read with `git show <SHA>:<path>`; mutable source changes were not treated as this candidate. No source edits, merges, comments, commits, service starts, DB/browser/provider runs, or subagents.
- Frozen contract v1 SHA-256: `863cdbc91c527b5e6d1f08e0ee7dedfd4483a0548249954ea732e196394d077a`.

## Judgments

| Slice | Specification | Quality | Verification |
| --- | --- | --- | --- |
| V5 | Changes requested: partial authority/capture/readiness observations can be promoted to full V5 machine pass | Named-case report validation is useful, but the required case set omits the behavior the slice exists to prove | Static review; not run; exact candidate is also missing its new worker-unit prerequisite |
| V6 | Changes requested: capture restart and sequential authority commands can be promoted to full V6 machine pass without application/race/drift proofs | Useful partial tests are reused, but the full-slice predicate has no mandatory unavailable-proof guard | Static review; not run; same prerequisite gap |

Joint G5/G6 acceptance remains pending. Fixture-based development is expressly allowed by the freeze; the findings do not require live provider access to perform partial work. Even the fixture-based ongoing-application proofs are absent here, independently of the later required live-produced artifact proof.

## P1 — V5 can report passed without applying any fresh conforming input

Changed locations: `scripts/verify-slice.ts:875–900,1004–1026` and `scripts/verify-slice-evidence.ts:206–210`.

Once the separately supplied dependency test/configuration is present, five successful commands plus a Chromium version and no diagnostics yield exit 0, `slice: V5`, `result: passed`, and `V5 verification passed`. The required titles are only two capture/authority cases, four dependency-helper cases, one health browser case and two source-lint/trap cases. There is no required observation for ongoing application, updated money, preserved cutover, a new receipt or a B file batch. The packet's text saying monetary apply / Connections UI are pending does not prevent the full machine-pass status. Keeping joint acceptance pending is correct but does not repair missing machine coverage.

Reverified exact candidate source:

- `tests/integration/v5-sync.test.ts:186–214` reads current authority and denies a grant that lacks the activated account. It does not apply a conforming future event or classify an unknown input into a hold.
- The second case at `:216–247` injects an invoice for `unknown-v5-sync-account`, captures/replays its API page and requires parent financial fingerprints to remain unchanged. No `applyBatch`/cycle is invoked. Company A alone is activated by this suite; there is no post-activation Company B file apply.
- `tests/e2e/v5-ai-off.spec.ts:20–56` mounts health with `migrationThroughVersion: 1`, checks System ready and asserts fresh-payment injection throws `FEATURE_NOT_IMPLEMENTED`. `tests/fixtures/harness.ts:106–109` unconditionally throws that error. This is not an injection and subsequent sync proof.
- `tests/integration/v5-runtime-isolation.test.ts:168–178` explicitly calls a standalone `createModelCallTrap()` self-test, then opens capture/readProgress; the trap is not passed to runtime or installed on Node egress. `tests/fixtures/v5-ai-off.ts:37–46` contains only a local counter and throwing method. Browser `page.on('request')` observes browser requests, not worker Node requests. The source scan is useful lint; package-name imports are not recursively walked (`v5-ai-off.ts:65–92`). These do not establish attempted worker provider calls are blocked or measured while new records apply.

Specification basis: PRD §§1, 17, 19; implementation plan execution conventions `:98–100` (partial work cannot pass a full slice), T5.1 `:308–317`, T5.2 `:326–337`; verification playbook G5. Required fixture behavior includes new payment/allocation producing 50000 cents while cutover remains 80000, newly imported source invoice, both source modes, deterministic automatic operation without another approval, dependency resolution/replay/gap behavior, and meaningful worker isolation evidence. Freeze F8 permits fixtures while retaining the final live-artifact requirement; it does not redefine capture/readiness as synchronization.

Smallest correction: retain these command/assertion observations as explicitly partial prerequisite evidence, but make full `verify:slice -- V5` nonzero with a precise missing-ongoing-application/AI-off-proof diagnostic until its mandatory behavior exists. Add a focused runner/packet regression showing all these existing commands passing still cannot produce full V5 `passed`. Update the new scripts guide sentence accordingly. Do not implement scheduler/apply or broaden financial behavior in this gate-only correction, and do not claim provider trapping from the disconnected helper. A separate partial command/result may pass its own accurately named scope.

## P1 — V6 can report passed without crash/application races or operating drift containment

Changed locations: `scripts/verify-slice.ts:1029–1055,1159–1181` and `scripts/verify-slice-evidence.ts:213–217`.

The V6 predicate adds five recovery/drift/readiness titles to V5's partial coverage, then returns full V6 success after eight successful commands. It never requires real ongoing-application transaction boundaries, competing appliers, revoke/application lock order, automatic drift pause or continued independent application. The V6 limitations again admit missing monetary apply but do not affect success.

Reverified exact candidate source:

- `tests/integration/v6-recovery.test.ts:191–225` captures/replays an unknown-account invoice, creates a new DB pool, reopens capture and checks unchanged previously committed financial rows. This is meaningful durable-capture regression coverage. It does not crash the application around commit, retry a lost ongoing-sync response or resume pending application.
- `:228–265` issues sequential pause, revoke, earlier pause replay, stale pause and forbidden resume commands. No application transaction participates; there are no barriers forcing an application/revocation race or duplicate consumers. Stale command rejection is not proof a stale application cannot commit after revoke.
- `tests/integration/v6-drift.test.ts:196–231` captures `schema-a-2` for `unknown-v6-drift-account`, checks unchanged money and reads B authority as active. It neither invokes financial classification/application nor asserts automatic pause for A; B processes no new event. Its modified replay uses an invalid zero content hash, proving envelope rejection rather than a valid changed-batch/economic conflict.
- `:234–263` explicitly pauses A first, then proves semantic mismatch blocks resume while B's authority remains active. Useful authority semantics; no financial event arriving before metadata is exercised.
- `tests/e2e/v6-containment.spec.ts` shows health, asserts the same V0 stub rejects fresh-payment and schema-rename injection, and compares untouched financial tables. No visible drift panel, pause outcome, fresh peer sync, receipt or gap is exercised.

Specification basis: implementation plan T6.1 `:350–359` and T6.2 `:368–379`; PRD §19 crash boundaries, concurrent PostgreSQL transactions, missing dependency, quarantine progress and drift; verification playbook G6. Freeze F5 preserves exact receipt recovery and application authority semantics; F6 explicitly says planner replay cannot substitute for real T6.1/V6 restart/retry proof. The missing V5 application coverage also propagates into V6.

Smallest correction: preserve these observations as partial capture/authority/health evidence; keep full V6 nonzero with missing application/recovery/race/containment diagnostics. Add an isolated gate regression for the all-existing-tests-pass-but-mandatory-proofs-unavailable case. Document the partial scope. Do not expand this repair into applying money, designing retry policy, scheduler changes, classification changes, or V7 work.

## Exact-tree prerequisite caveat

The exact candidate cannot currently complete the new gates on a clean checkout: `apps/worker/test/sync-dependencies.test.ts` is absent (`git show 9866847:<path>` fails; `git ls-tree` confirms no worker test), and its `vitest.config.ts:5` includes only `packages/**/test/**/*.test.ts` for the unit project. The file preflight at `verify-slice.ts:938–940` and corresponding V6 block will diagnose the missing required file. Merely copying the test would still need the separately owned unit include update.

This is a dependency/integration prerequisite, not evidence the intended predicates are sound. After the accepted dependency test and its configuration are composed, the new predicates permit the full pass described above. Pin/review the resulting integrated candidate and its exact test titles; do not use uncommitted local helper files as provenance for this branch. No review or edits of the concurrently changing helper/classifier/V7 implementation were performed.

## Verification and review evidence

Read root/scripts/tests guidance, PRD thesis/process boundaries/acceptance, implementation plan and ownership, frozen F4–F6/F8 sequencing, and the verification playbook. Existing reports `platform-owner-pr35-pr36-pr37-review.md` and `platform-pr32-83c5c0a-review.md` were read as supplemental local review context (they are absent from this candidate tree); their relevant harness claims were checked independently against candidate source above.

Commands performed: `git rev-parse`/`for-each-ref` for identity, `git show --stat` and exact three-file diff, immutable source/spec reads with line numbering, `git ls-tree` for prerequisites, frozen-doc `shasum -a 256`, and `git diff --check 5aac86707f612bad64a6eadff9a34864061145a2 9866847c6f5989cb32e5cf8432cadc5d97939fb2` (passed, empty output). No pure helper probe was necessary. No typecheck, unit, DB, browser, provider or slice tests were run, and no test-pass claim is made.

Recommendation: changes requested for both full-slice gates. Retain the useful partial evidence and make unavailable mandatory proofs prevent a full slice pass. The review does not authorize implementing missing ongoing synchronization.
