# PR40 conflict resolution and V5/V6 gate repair review

Reviewer: delegated read-only agent `/root/pr40_conflict_gate_review`, separate from the implementer. Review performed 2026-11-10 UTC. This is a bounded exact-candidate review, not full-slice machine verification or joint acceptance.

## Identity and verdict

- Candidate: `6b8619ca0d0f8488024f22d1b32ba349782d359f`.
- Gate repair base: merge `1d53329e70e41a616f7826a22956c4f5002082e2`.
- Merge parents: `7e65d5d6c4569c7a4d894e76b297af9932be9a97` (reviewed source `97cced3` plus documentation) and incoming main `722aaf70c7f8833e954d33fc273f6a4f48b27f78`.
- Frozen contract v1 SHA-256: `863cdbc91c527b5e6d1f08e0ee7dedfd4483a0548249954ea732e196394d077a`.
- Specification verdict: **approved for this conflict/gate repair**.
- Quality verdict: **approved for this conflict/gate repair**.
- Findings: **none within the assigned repair**. No P0/P1/P2/P3 correction requested.
- Push readiness: **no review blocker to pushing this repair candidate**, subject to the root owner's combined validation. This verdict does not adopt or approve incoming PR39 application authority, resolve its separate findings, or grant financial/live acceptance.

## Review conclusions

At `scripts/verify-slice-evidence.ts:219-236`, both V5 and V6 now always return full `result: failed` and exit 1, with their exact required diagnostics (`ai-off-sync-proof-unavailable`, `application-recovery-proof-unavailable`). Passing prerequisites are recorded independently. Missing commands, unsuccessful command/report results, missing Chromium, and setup/cleanup diagnostics keep the prerequisite result failed. The runners at `scripts/verify-slice.ts:993-1014` and `:1147-1168` use the same outcome for manifest, console diagnostics, and process status, retain independent/joint review pending, and accurately state that the remaining application proofs are unverified. They do not assert implementation absence or convert the incoming invoice assertion into full financial acceptance.

The repaired V5 registry at `scripts/verify-slice.ts:848-882` matches all **19** actual worker-helper report titles, including expanded parameterized cases, and all **3** V5 sync titles. V6 reuses the same arrays. The real worker JSON passed the exact production normalizer; the V5 source-title check and synthetic report-shape probe matched exactly. The latter deliberately did not execute the database assertions and is not evidence of their financial behavior.

Git-based comparisons found the V3 case registry/runner, V4 prerequisite registry/runner, and V7 prerequisite registry/runner byte-for-byte preserved from `97cced3`. The complete report normalizer and V1/V3/V4 helper portion were also byte-for-byte preserved; V7's helper was unchanged. Thus the exact two-case V3 browser requirement and V4/V7 prerequisite/full boundaries survive the merge. Existing two-spec, mixed nested/direct suite, wrong/missing/duplicate/skipped report tests passed.

The incoming V5/V6 runner structures were retained and narrowed only by the reviewed gate repair and corrected allowlists. Incoming `apps/worker/src/sync/apply.ts`, `packages/parent/src/sync-store.ts`, `db/runtime/005_sync_apply.sql`, and `tests/integration/v5-sync.test.ts` are byte-identical to `722aaf7`. Migration005 was not rewritten. The separate PR39 report `/private/tmp/eapr-pr39-722aaf7-review.md` remains applicable to that unmounted application path; its defects are outside this gate-only repair and are not waived here. The unrelated incoming duplicate test files are also outside this repair.

Specification basis: implementation-plan execution conventions prohibit partial work from passing a full slice; T5.1/T5.2, T6.1/T6.2 and verification-playbook G5/G6 require substantive ongoing application/isolation and recovery/containment evidence. The PRD final AI-free operation gate uses postactivation records and actual live-produced artifacts. The repair correctly closes the two false-full-pass findings in `platform-v5-v6-gate-9866847-review.md` without inventing those missing proofs.

## Independent verification

All executable checks used Node `v24.22.2` and a Git archive of exact candidate `6b8619c` at `/private/tmp/eapr-pr40-review-lj20xlxu`. Dependency links reused installed packages; every `@eapr` workspace link was redirected to the archive. No mutable checkout source was used for the tested candidate.

1. `node node_modules/vitest/vitest.mjs run --project integration tests/integration/verify-slice-evidence.test.ts`: **64 passed**, exit 0. This includes V5/V6 all-prerequisites-green yet full-gate-failed regressions, missing/skipped/failed prerequisites, failed-preflight CLI manifests, V3 normalization preservation, and V4/V7 full-gate boundaries.
2. `node node_modules/vitest/vitest.mjs run --project unit apps/worker/test/sync-dependencies.test.ts --reporter=json --outputFile=/private/tmp/eapr-pr40-review-lj20xlxu/worker-report.json`: **19 passed**, exit 0. Direct normalization of this report against the exact candidate's worker allowlist returned 19 passed cases and no diagnostics.
3. Pure title/protocol probe: **passed**. All three exact V5 sync source titles equal the allowlist; synthetic reports with those names normalize successfully, and missing/skipped/failed cases are rejected. No database test claim is made.
4. Initial combined verifier/live-wrapper test invocation: **64 passed, 12 failed**, exit 1. All 12 failures were the unchanged `live-build-gate.test.ts` wrapper's `tsx` CLI attempting its IPC socket and receiving sandbox `listen EPERM` before application logic. This is recorded as an environment limitation, not a passing command or repair defect.
5. Safe alternate direct-entrypoint probe using `node --import tsx scripts/live-build.ts`: **8 passed**, covering V4/V7 paths with and without `--evidence`, each with missing key or inert dummy key; each returned exit 1 and the expected safe unavailable diagnostic. No provider access occurred. This validates the entrypoint logic but does not replace the failed npm-wrapper test result.
6. `git diff --check 97cced3 6b8619c`: **passed**, empty output. Exact merge parent identity, preserved section comparisons, incoming source/migration comparisons, and contract checksum verified.

## Scope limits

No repository source/index/HEAD edit, merge, commit, push, DB, browser, provider, full slice, complete unit suite, or subagent operation was performed. Typecheck and combined application checks remain root-owned. The only authored deliverable is this temporary review report; archive and test artifacts are under `/private/tmp`. The checkout's untracked PR39 review document was observed and left untouched. Any later relevant code commit needs its own exact-candidate review. Joint user acceptance remains pending.
