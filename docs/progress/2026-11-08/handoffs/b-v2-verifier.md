# B executable V2 verification gate implementation brief

> For the assigned Sol worker: execute this bounded brief inline using `superpowers:executing-plans`; do not delegate. The workflow is already selected. This is a gate/evidence implementation, not a product feature or financial-semantics task.

**Goal:** Make `npm run verify:slice -- V2` execute real named compiler/finance/evaluator/integration/browser assertions and fail closed on any missing, skipped, failed or unsafe evidence.

**Architecture:** Add a dedicated V2 runner with a static file/fullName registry and a strict allowlisted evidence collector. Reuse existing report normalization and command-result utilities where their current single-file/single-browser-test contracts fit. Leave V0/V1 command sets, behavior, output contracts and privacy guarantees unchanged.

**Stack:** Existing Node 24, PostgreSQL 18, TypeScript, Vitest, Playwright and Zod. No dependencies or test-runtime configuration changes.

**Authority:** Repository/scripts/tests AGENTS; implementation plan T2.1/T2.2; shared ownership; freeze F3/F6/F8; verification playbook G2/evidence packet; private `docs/progress/2026-11-08/handoffs/evidence-v2-contract.md`; companion `c3-v2-browser.md`. Read the actual accepted C3 handoff/candidate before implementation.

## Dependency and owned files

Do this only after independently reviewed B+C2 are integrated and the new C3 actual-v2 browser candidate is independently reviewed and integrated. C3's new test/result schema is a dependency, not something this worker may simulate or silently change. Record actual base/candidate SHA. Observed B+C2 integrated base is `f3e5375`.

Allowed edits:

- `scripts/verify-slice.ts`: replace V2 unavailable dispatch/registry entry with the dedicated V2 path and update usage; leave V0/V1 implementations and their registry cases unchanged.
- Create `scripts/verify-v2.ts`: V2 static registry, command execution, metadata and packet orchestration.
- Create `scripts/verify-v2-evidence.ts`: strict C3 result validation, V2 artifact collection and V2 pass predicate.
- Create `tests/integration/verify-v2-evidence.test.ts`: report/artifact/CLI failure regressions described below; no real DB necessary for these parser/process tests.
- `tests/integration/verify-slice-evidence.test.ts`: replace only obsolete `CLI keeps full V2 verification unavailable` with `CLI routes V2 to its fail-closed preflight`, using a disposable empty Git repo and asserting missing-file failure, not running the whole real gate recursively. Preserve all V1 assertions.
- `scripts/AGENTS.md`, `tests/AGENTS.md`, verification-playbook status and implementation-plan status paragraph: narrowly document executable V2 and its limits after evidence exists. Do not mark joint acceptance or later-slice work complete.
- Create `docs/progress/2026-11-08/handoffs/b-v2-verifier-report.md`.

No product, compiler, finance, evaluator, source/generator, browser, pin-helper, operator-selection, migration, package/lockfile or shared contract edits. `scripts/verify-slice-evidence.ts` can be imported unchanged; do not generalize its V1 collector or relax its normalization. Exact named tests below are read-only dependencies. A real failure is a task-owner defect, not permission to remove a required case.

## Static registry and evidence obligations

Use the exact file/fullName map in the appendix. The `fullName` includes describe prefixes and expanded parameterized titles; literal file plus literal name is the stable assertion ID. Store the list in source. Do not derive expected cases from the actual report, counts, filename existence or regex presence at runtime. Execute every registered file individually using its existing npm script, then typecheck once. All named assertions in a file are mandatory, including old v1 browser and pin-preservation regressions. Exact coverage means every expected name exactly once, no additional/duplicate/omitted names. An intentionally unavailable v1 evaluator check is valid only inside that passing regression test; it cannot satisfy the actual-v2 browser evidence.

Mapping from requirements to real evidence:

- Compiler/finance files prove exact 80000/50000 public F8 balances, unallocated funding, immutable original records, full reversals, money precision/safe bounds, unsupported constants/terms, ambiguous dates, scope and dependency holds, replay and deterministic lineage.
- `v2-preview` integration proves actual HTTP plus unchanged control/runtime storage boundaries. `v2-preview` browser proves mapping/lineage/evidence, visible unsupported/unmapped rows and zero runtime writes for the generated A/B baseline.
- Evaluator reference-model tests independently reject balance-preserving swaps and check oracle independence. `verify`/`cases` tests and `v2-verification` prove actual subject failures, hash-bound reports, forged-report rejection, missing coverage, and the deliberately wrong B mapping with nonzero independent difference; same-cents wrong date also fails. Do not label a compile-time type rejection alone as independent wrong-mapping proof.
- Private fixtures/protocol/import tests, actual v2 store, real B assembly/startup and C3 browser prove bounded processes, protected-input isolation, immutable v1/v2 storage, real captured bytes, unsupported evidence refusal, correct identity/term/lineage checks, actual all-thirteen eligibility and public-summary redaction.
- C3 ownership tests and unchanged v1 checkpoint protect historical pins and existing expected-only behavior. All-three-browser coverage distinguishes preview-only, v1 incomplete coverage and actual-v2 eligible-for-review.

The gate does not need a new economic fixture or model call. Generated A is 80000 cents and generated B is 0; F8's B 80000 probe is separate and already tested on the same artifact. Parent target is explicitly empty fixture. `retry_restart` is planner replay, not persisted runtime retry. Unsupported findings/ensure_* semantics, live discovery, final holdout, activation, real parent import and sync remain outside this gate.

## Runner and pass predicate

- Export `verifyV2(): void` from the new runner and dispatch only explicit V2 requests to it. Capture actual source SHA/cleanliness/content identity, runtime versions, lockfile hash, frozen contract hash and private-evidence-contract hash, migration catalog identities, loopback lease configuration and namespace prefix with the existing evidence conventions. Never emit secrets or raw env. Dirty source gets a distinct content-derived evidence key and clean=false, never a clean-SHA pass claim.
- Before commands, require every registered path is an actual regular nonsymlink file. Missing/malformed metadata or a missing file writes a failed packet and launches no tests. Use bounded paths/read sizes. Preserve the final packet on execution failure; remove only this run's private scratch directory.
- Run `npm run test:unit -- <file> --reporter=json --outputFile=<private-report>` for package test files, `test:integration` for integration files, and `test:e2e -- <file> --reporter=json --trace=off --retries=0` for each browser file. Unique private report/output directories per command. Typecheck is its own required command. Strip model/provider credentials before child launch as existing verifier conventions require; do not pass protected inputs through env/CLI.
- Use spawn argument arrays, bounded stdout/stderr buffers, and finite per-command deadlines (allow 300 seconds for each real browser file, with shorter bounded unit/integration deadlines adequate for current real subprocess tests). Exit nonzero, signals, spawn/timeout errors, malformed/missing/oversized reports, skip/todo/pending/flaky/retry/unexpected status, expected-failure cases, unexpected files/projects, duplicate case names or absent assertions fail the gate. Never convert timeout into an unavailable-but-passing case. Aggregate commands only after each report is validated.
- Reuse `normalizeReport` unchanged for individual files; current browser files each contain one top-level test, exactly the supported shape. Keep requiredNames literal in V2. Probe actual Chromium version independently and require the numeric result; require all Node/npm/Postgres/dependency/migration metadata.
- V2 passes iff the command set matches the entire static registry plus typecheck, every command and every expected assertion passed once, metadata is complete, safe screenshots/results validate, and diagnostics are empty. Return process exit 1 for every other case, including artifact extraction/cleanup failure. A success exit from npm is insufficient.

## Safe browser result and artifact collection

Consume C3's strict `v2-browser-results.json` schema exactly as defined in `c3-v2-browser.md`. Validate every literal/boolean; exact ordered A/B companies; distinct job/report/artifact identities; well-formed hashes and nonempty sorted unique profile hashes; each company has the exact unique thirteen IDs, passed statuses, positive safe case counts, evidence_support cases 4, complete coverage/eligibility and zero writes; balances A=80000/B=0. Reject unknown nested keys rather than serializing them. Do not invent missing observed fields from a spec constant. Cross-check its `test` with the successful actual-v2 Playwright report and require exactly one file in that command's output root. The expected-v1 result file must never stand in for it.

Require and retain precisely these ten safe PNG names, grouped under their originating browser command output root (a same-name file under another command cannot satisfy the requirement):

- Preview-only: `preview-company-a-balance.png`, `preview-company-a-scope.png`, `preview-company-a-lineage.png`, `preview-company-a-citation.png`, `preview-company-b-balance.png`, `preview-company-b-hold.png`.
- Existing v1 verification: `verification-company-a.png`, `verification-company-b.png`.
- Actual v2: `verification-v2-company-a.png`, `verification-v2-company-b.png`.

Each must be unique, regular, bounded and a valid PNG, no symlink path or escape, with hash recorded. Use V1 collector's NOFOLLOW/fstat/realpath discipline without changing its fixed two-name contract. Ignore and delete nonallowlisted text/report attachments after validation; never copy a directory wholesale. The presence of any authenticated trace.zip or video in any browser output fails privacy validation even though it is not copied. Missing, duplicate, malformed or substituted screenshots fail. Do not retain failure screenshots/error-context documents automatically. Private test results stay in mode-0700 scratch and are deleted after normalization on success and failure. Retained files mode 0600; no raw stdout/stderr, cookies, CSRF, full HTTP bodies, credentials, producer/truth JSON, fixture IDs/paths, private case labels, or hidden expected records. Store only safe command/diagnostic codes and literal allowlisted assertion names; sanitize errors by construction, not substring redaction alone.

Write `.evidence/<source-key>/V2/<runId>/`:

- `manifest.json`: source identity/cleanliness, UTC/runId, slice/mode, runtime/configuration/migration/contract hashes, required file/name registry, safe command results, observed A/B artifact/profile/manifest/evaluatorBuild hashes, screenshots/hashes, diagnostics and explicit limitations. `jointAcceptance:'pending'`, `independentReview:'pending'` until a separate exact-candidate reviewer creates its own review.
- `commands.json`: exact commands with private output paths represented by stable placeholders, exit/signal/result, allowlisted diagnostics and normalized assertion results. Explain raw stdout/stderr intentionally not retained for authenticated/protected tests.
- `assertions.json`: literal file/name/status records plus the strict safe C3 observed result. Financial values here are only the already public A/B preview values and zero parent writes; hidden evaluator expectation values are excluded.
- `trace.json`: only observed safe terminal job records derived from the successfully validated C3 result, explicitly labeled `verification-job-observation` (job/report IDs, completed state and public binding hashes). Declare this is not a complete event lifecycle or model/tool trace. Do not invent events or receipts.
- `screenshots/`: the ten validated files above.
- `review.md`: candidate/base/source identity, builder and supervising lead identities if actually known, and pending independent review/joint G2 fields. A runner must not fabricate a reviewer/session or approved verdict. Independent exact-candidate review is attached separately.

Failed packets remain failed even if some screenshots exist. Output only the safe packet location/result and diagnostic codes. Never print caught exception messages or raw child streams to the console.

## Exact new runner regression IDs

Create top-level Vitest tests in `tests/integration/verify-v2-evidence.test.ts` with these full names. Table-driven subcases inside each test avoid implicit registry changes:

- `v2_gate_requires_every_named_assertion_and_command`: valid normalized fixture accepted, then each omitted/duplicate/wrong-file/extra/skipped/todo/failing/flaky/retried assertion, expected failure and missing/typecheck failure rejected; command exit/signal/timeout/spawn/invalid report independently fail. Use actual reporter-shaped fixtures, never a fake successful real gate.
- `v2_browser_result_requires_both_actual_eligible_subjects`: validate strict C3 shape; wrong company/version/balance, duplicate job/report/artifact, malformed binding hashes, zero cases, missing/duplicate ID, unavailable/failed check, false safety booleans/coverage/eligibility and unknown nested keys rejected. A parser cannot detect a well-formed substituted hash in isolation; exact preview/job/persisted-report binding is asserted by the real C3 test, whose successful process result is required. Do not claim cross-process authenticity from a matching hash.
- `v2_artifacts_require_exact_safe_screenshots_and_result`: actual temporary files prove missing/duplicate/bad PNG, oversize, symlink/root escape, substituted command roots, duplicate results, malformed/oversized result, trace/video and read failures block success; unrelated text attachments never survive collection.
- `v2_packet_never_serializes_private_child_data`: inject secret sentinels in stdout/stderr/error/report extra fields/attachments and ensure neither persisted packet nor terminal output contains them; unknown fields must not be copied even on failure. Include successful and failed collector paths.
- `v2_cli_missing_preflight_writes_failed_packet_without_commands`: invoke actual CLI in a disposable Git repo missing required files; exit 1, safe failed packet and zero spawned test commands.
- `v2_cli_execution_failure_retains_failed_packet_and_cleans_scratch`: run the runner through a test-only injected process/filesystem boundary or controlled child executable in a disposable checkout; a nonzero/timeout/malformed reporter path preserves failure evidence, cleans only owned scratch and preserves unrelated sentinel files. Do not add a production env flag that bypasses real tests or marks a gate passed.

These tests validate the gate and are run separately in the worker validation sequence. Do not make the V2 runner invoke itself recursively through its own CLI tests. Preserve V0/V1 normalizers and regression expectations; only the obsolete V2-unavailable case changes.

## Work, validation and handoff

- [ ] Add new gate failure tests and replace the obsolete unavailable assertion. Observe meaningful failures against the current unavailable implementation/absent collector.
- [ ] Implement only dedicated V2 dispatch/runner/collector, literal registry and strict safe packet. Run `npm run typecheck` and `npm run test:integration -- tests/integration/verify-slice-evidence.test.ts tests/integration/verify-v2-evidence.test.ts`.
- [ ] Run the real `npm run verify:slice -- V2` with Node 24/PostgreSQL 18, an exclusive lease, actual Chromium and no model credentials. All appendix cases plus typecheck, ten safe screenshots and strict A/B result must validate; inspect the packet for privacy and accurate limits. Missing C3 or a real failing test is a failure, not a waived gate.
- [ ] Run `npm run verify:slice -- V0` and `npm run verify:slice -- V1` on the candidate to establish unchanged dispatch/behavior; preserve their packets and existing V1 authenticated-trace prohibition.
- [ ] Inspect allowed diff, run `git diff --check`, commit with a descriptive subject under 20 words (for example `test: add fail-closed V2 verification evidence gate`), and rerun real V2 on the exact clean candidate. Record the earlier dirty run separately; never present its packet as exact clean-head evidence. Run source-identical parser tests on the exact candidate as needed.
- [ ] Hand off actual commands/counts/packets, base/candidate SHA, screenshot inspection, known failures and precise limitations for a fresh Astra review. Joint G2 remains pending. Do not make live/activation/persisted-sync/production-readiness claims.

## Appendix: exact mandatory file and assertion IDs

This is the static starting registry on integrated B+C2 plus the specified C3 dependency. Do not shorten names into aliases or dynamically replace this list with whatever tests happen to run. If accepted C3 reports a changed output/name, reconcile that concrete dependency with the coordinating owner before implementation; it is not a new financial/product decision.

```json
{
  "packages/compiler/test/compile.test.ts": [
    "canonical_hash_ignores_object_key_order",
    "rejects_unknown_operation",
    "checks mapping source fields, input types and capture coverage",
    "blocks unsupported constants, lookup tables and overlapping contract terms",
    "parses canonical decimal money without rounding or unsafe inputs",
    "a cited fixed amount cannot overwrite observed source money"
  ],
  "packages/compiler/test/plan-batch.test.ts": [
    "maps both source schemas into exact scoped records and deterministic lineage",
    "rejects_ambiguous_date",
    "late payment only changes balance when an explicit allocation is supplied",
    "missing dependency holds the related group and releases it in dependency order",
    "holds an overallocated group without consuming unrelated unallocated funds",
    "economic replay ignores delivery and connector version, but conflicting content holds",
    "rejects conflicting delivery hashes before planning any group",
    "holds schema, identity and semantic drift before mapping",
    "checks artifact and reviewed profile hashes and target scope",
    "plans one full reversal, preserves originals and rejects reallocation of reversed funding",
    "cannot link an allocation to another seller or account using a shared buyer",
    "a later target version changes the expected version and plan hash"
  ],
  "packages/finance/test/finance.test.ts": [
    "preserves_source_money",
    "reverses_full_payment_once",
    "rejects funding and invoice over-allocation",
    "rejects wrong-source funding and invalid effective prerequisites",
    "a backdated reversal voids an existing future-effective allocation and preserves older recorded state",
    "full credit reversal restores its allocations at its effective instant"
  ],
  "packages/evaluator/test/reference-model.test.ts": [
    "independent public development oracle reference_baseline_80000",
    "independent public development oracle reference_late_payment_50000",
    "independent public development oracle reference_unallocated_funding_no_reduction",
    "independent public development oracle reference_full_reversal_as_of",
    "independent public development oracle reference_reversal_cannot_conceal_excessive_funding_allocation",
    "independent public development oracle reference_reversal_restores_invoice_capacity_for_other_funding",
    "independent public development oracle reference_scope_and_limits",
    "independent public development oracle balance_preserving_swap_rejected",
    "independent public development oracle reference_model_independent"
  ],
  "packages/evaluator/test/verify.test.ts": [
    "real_subject_wrong_mapping_rejected despite identical cents",
    "report_binding rejects any different job, immutable fixture version, or build hash",
    "mandatory_checks_required prevents forged eligibility and strips raw diagnostics"
  ],
  "packages/evaluator/test/cases.test.ts": [
    "inapplicable_matrix_launches_nothing for the entire requested profile matrix",
    "unsupported source contract has no synthetic cases and a case plan rejects another artifact",
    "B fractional and unsafe numbers fail their respective pre-money validation boundaries",
    "negative_mapping_rejected for an alternate B amount field or unsupported amount constant",
    "changed_case_code_changes_build_hash",
    "full_reversal and reversal_preserves_prior_asof with original records and allocations",
    "snapshot_boundary uses each stream cursor and boundary_validation_not_counted_as_planner",
    "missing_required_case_prevents_pass before any subject launches",
    "reversal is unavailable if the reviewed term supplies no supported later dates",
    "dependency_order exercises the exact supplied artifact in the real planner",
    "schema_drift exercises the exact supplied artifact in the real planner",
    "semantic_drift exercises the exact supplied artifact in the real planner"
  ],
  "packages/evaluator/test/fixtures.test.ts": [
    "truth_member_integrity rejects substituted or missing members and unknown truth fields",
    "truth_profile_binding requires one exact approved scope and computes the public fixture anchor",
    "truth_isolation pins immutable fixture versions and uses the real bounded evaluator without exposing expected values"
  ],
  "packages/evaluator/test/evidence-fixtures.test.ts": [
    "the private store accepts a separate evidence v2 pin without replacing the v1 API",
    "strict producer decoding normalizes order and checks fact IDs and amendment adjacency",
    "producer and v2 bundle reject oversized, unknown and prototype-bearing input"
  ],
  "packages/evaluator/test/protocol.test.ts": [
    "bounded evaluator process protocol subject_protocol_fail_closed (malformed)",
    "bounded evaluator process protocol subject_protocol_fail_closed (truncated)",
    "bounded evaluator process protocol subject_protocol_fail_closed (multiple)",
    "bounded evaluator process protocol subject_protocol_fail_closed (extra-field)",
    "bounded evaluator process protocol subject_protocol_fail_closed (invalid-outcome)",
    "bounded evaluator process protocol subject_protocol_fail_closed (wrong-request-id)",
    "bounded evaluator process protocol subject_protocol_fail_closed (invalid-utf8)",
    "bounded evaluator process protocol subject_protocol_fail_closed (stdout-limit)",
    "bounded evaluator process protocol subject_protocol_fail_closed (stderr-limit)",
    "bounded evaluator process protocol subject_protocol_fail_closed (combined-limit)",
    "bounded evaluator process protocol subject_protocol_fail_closed (abnormal-exit)",
    "bounded evaluator process protocol subject_protocol_fail_closed (timeout)",
    "bounded evaluator process protocol subject_protocol_fail_closed (oversized and malformed stdin)",
    "bounded evaluator process protocol subject_protocol_fail_closed (limits cannot be raised)",
    "bounded evaluator process protocol subject_input_excludes_truth",
    "bounded evaluator process protocol evaluator transport accepts one strictly framed report",
    "bounded evaluator process protocol evaluator transport rejects extra fields and extra or truncated lines"
  ],
  "packages/evaluator/test/control-imports.test.ts": [
    "control evaluator entrypoints do not load the subject or protected oracle"
  ],
  "tests/integration/v2-preview.test.ts": [
    "preview_preserves_parent",
    "preview rejects malformed, unauthorized, missing, stale and unavailable dependencies",
    "preview holds unknown accounts, partitions reviewed sellers, and pauses an unknown seller"
  ],
  "tests/integration/v2-verification.test.ts": [
    "registry_immutable_republish, registry_hash_binding, registry_same_id_conflict, registry_parallel_republish",
    "verification_route_scope, verification_job_scope, forged_report_rejected, verification_async_failure_redacted, attempt_budget_reserved_atomically",
    "generated_b_zero_is_not_f8_balance, same_candidate_f8_transposition, different_artifact_pass_not_reused"
  ],
  "tests/integration/evidence-v2-store.test.ts": [
    "real generated A/B capture provenance survives immutable v2 roundtrips beside v1"
  ],
  "tests/integration/evidence-verification-setup.test.ts": [
    "paired operator inputs pin the exact stored captures and reject incomplete or conflicting evidence"
  ],
  "tests/integration/local-verification-startup.test.ts": [
    "real reviewer jobs use operator pins for the registered source captures",
    "the operator upgrade selects only exact regeneration in an isolated demo root",
    "the control composition import graph stays outside the operator and evaluator oracle"
  ],
  "tests/integration/c3-pin-isolation.test.ts": [
    "isolates browser pins on success",
    "isolates browser pins on collision",
    "isolates browser pins on partial"
  ],
  "tests/integration/c3-v2-pin-isolation.test.ts": [
    "v2_browser_copy_preserves_facts_and_rebinds_producer",
    "v2_browser_pin_collision_preserves_existing_files",
    "v2_browser_partial_publication_is_not_owned",
    "v2_browser_cleanup_preserves_replaced_and_changed_pins",
    "v2_browser_repeated_runs_preserve_prior_pins_and_inputs"
  ],
  "tests/e2e/v2-preview.spec.ts": [
    "previews both captured schemas and leaves real runtime state unchanged"
  ],
  "tests/e2e/v2-verification.spec.ts": [
    "verifies both captured companies through the real protected evaluator and renders bound summaries"
  ],
  "tests/e2e/v2-evidence-verification.spec.ts": [
    "verifies both captured companies with v2 evidence and all thirteen checks without parent writes"
  ]
}
```

This registry has 20 files and 94 named assertions, plus one required typecheck command. Counts are a cross-check, never a substitute for exact name/status matching.
