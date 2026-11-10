# Independent V4 gate integrity correction review

- Reviewed candidate: `d15c36c0fa7c42c44d074dbb63ee7a4c6d9b3533`.
- Immutable base: `4392f9e244f17f545a064b4227b894a9367e30ce`; source correction: `0e5bf9b93e3b8a3bbda15b8c7e2ab3091a3b4474`.
- Reviewer session: `/root/v4_fix_review`; supervising lead: `/root`. Builder identity and reviewer model configuration were not independently verified.
- Frozen contract v1 SHA-256: `863cdbc91c527b5e6d1f08e0ee7dedfd4483a0548249954ea732e196394d077a`.
- Reviewed the exact seven-file base-to-candidate diff, task brief, correction handoff, original PR33 review, repository/scripts/tests guidance, PRD thesis/process boundaries/acceptance, plan verification conventions and T4, shared ownership, frozen F6/F8/foundation sequencing, and verification playbook. Later worktree changes are excluded.
- Source snapshot: `/private/tmp/eapr-v4-review-snapshot`, extracted with `git archive` from the candidate. Existing installed dependencies were copied into this temporary snapshot; no dependencies were installed or fetched. No repository source changes, commits, provider configuration, secret inspection, database operations, or subagents.

## Verdicts

**Specification: reviewed, no changes requested for this correction.** Both original P1 false-success paths are closed. The implementation respects the task's explicitly incomplete live-construction boundary.

**Quality: reviewed, no actionable findings in the assigned diff.** The correction simplifies the public live command, retains useful prerequisite evidence, preserves the V3 parser, and keeps partial versus full results distinguishable.

**Verification: partial.** Independent typecheck, all 58 shared verifier regressions, and eight direct entry-point CLI cases passed. The public npm/tsx wrapper regression run was blocked by sandbox IPC restrictions. The complete 72-case focused suite did not pass independently in this environment. Full V4/live machine acceptance is not established. **Joint acceptance: pending.**

## Resolution of original findings

1. **Full V4 false pass — corrected.** `scripts/verify-slice-evidence.ts:206–216` returns `result: failed`, `exitCode: 1`, and `live-construction-unavailable` for every input. Three passing prerequisite commands and a Chromium version can produce only `prerequisiteResult: passed`. Extra passing negative-proof results cannot create full success. The runner uses this outcome unchanged for the manifest, terminal result, and process exit (`scripts/verify-slice.ts:687–709`). Independent review and joint acceptance remain pending. The negative live assertion is no longer a V4 command, while the registry still identifies the missing mandatory live test.

2. **Public live command false pass — corrected.** `scripts/live-build.ts:39–54` sets exit code 1 before argument handling and never resets it. The former test spawning code and imports are gone. Missing configuration receives `LIVE_CONFIGURATION_UNAVAILABLE`; a fabricated nonempty key receives `LIVE_CONSTRUCTION_UNAVAILABLE`, with no claim of validity or provider execution. `--evidence` provides no alternate execution/success path. Invalid/missing arguments also fail. The operator configuration helper remains a presence check, and is no longer sufficient for public success.

The scripts guide and correction handoff describe these boundaries accurately. No provider transport, worker dependency/key, product behavior, financial rule, or live-proof contract is introduced.

## Evidence and regression assessment

The V4 runner retains sanitized command summaries and allowlisted assertion names/statuses, never raw child output. It removes the three named OpenAI variables before spawning prerequisite children, disables authenticated tracing, deletes private temporary reports, and writes retained JSON with mode 0600. The new outcome adds only fixed diagnostic/status values. These are scoped static observations plus shared privacy regression results, not a comprehensive credential-leak or runtime-isolation certification.

The diff does not alter `playwrightCases`, `normalizeReport`, or `v3ExitCode`. The exact candidate's shared suite passed the multi-spec/nested-suite cases and negative file/project/count/skip/retry/duplicate/depth cases. This preserves the accepted V3 parser correction; it does not establish full V3 browser acceptance.

## Independent commands and results

All execution used Node `v24.22.2` in the temporary exact-candidate snapshot. Commands ran with a minimal `env -i` environment containing only tool PATH and TMPDIR; fabricated keys were supplied only to the specific direct CLI cases. No actual model key was inspected.

- `npm run typecheck`: exit 0. Log: `/private/tmp/eapr-v4-gate-independent-typecheck.log`.
- `npm run test:integration -- tests/integration/verify-slice-evidence.test.ts`: exit 0, 58 tests passed. Log: `/private/tmp/eapr-v4-gate-independent-verifier.log`. This includes the all-prerequisites-passed V4 outcome, command failure/cleanup diagnostics, actual isolated V4 failed-preflight packet, V1/V2 preflight, evidence privacy, and V3 parser regressions.
- Direct Node 24 execution of the unchanged `scripts/live-build.ts`: eight cases passed, each with exit 1 and the expected diagnostic: absent key; fabricated key; each with `--evidence`; invalid file with/without `--evidence`; missing file with/without `--evidence`. Assertions also required no signal/spawn error and no fabricated-key text in output. This verifies the actual entry point without tsx's IPC wrapper; it does not claim the npm wrapper passed.
- `git diff --check <base> <candidate>`: exit 0.
- Initial combined command `npm run test:integration -- tests/integration/live-build-gate.test.ts tests/integration/verify-slice-evidence.test.ts tests/integration/verify-v2-evidence.test.ts`: exit 1, 63 passed / 9 failed. Log: `/private/tmp/eapr-v4-gate-independent-tests.log`. Eight failures occur before the live script runs because tsx cannot listen on its temporary IPC socket (`EPERM`). Those failures are setup failures, not evidence against the correction's behavior.
- The remaining existing V2 negative CLI regression failed because no command summaries were produced. Its metadata path contains a Chromium launch, which was missed when inspecting the test's stubbed npm/postgres commands before execution. No successful browser run is established; this test was not repeated or used as browser evidence. The no-browser review boundary was unintentionally reached by that existing helper, and the limitation is recorded explicitly rather than representing the combined suite as provider/database/browser-free success.

## Proof limits

The builder's reported 72-test green run and red run were read, not independently reproduced as passing here. This review establishes the fail-closed correction and focused parser/evidence behavior only. It does not prove completed prerequisite execution against PostgreSQL/browser, genuine A/B generation, real provider calls, eligible generated artifacts, protected holdouts, activation, financial correctness, AI-off synchronization, or any full slice. Full V4 remains failed/unavailable by design, and live construction and joint acceptance remain pending.
