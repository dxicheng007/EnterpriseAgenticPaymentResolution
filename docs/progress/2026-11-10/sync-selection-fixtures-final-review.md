# Combined independent final review: selection fixture variants and catalog fixtures

Reviewed 2026-11-10 for the Platform coordinator. This is the combined **six-task, two-plan fixture prerequisite gate**. It is not a whole-PR, selector, slice, live, or joint-acceptance review.

## Candidate, scope, and method

Worktree: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

Bound range: BASE `a5e834f385aed00f8a606d0953ba0ff4a422db5a`, HEAD `88e530100ae8a9128d6edb9a3f5aa4c35e3693c8`; last source change `15b003b4a4bd57eedd7f0090c85868d2368d19b0`. Root subsequently reported a documentation-only handoff at `4a553c0`; this review remains bound to the supplied HEAD and source package. Commit ancestry and historical source/SQL releases are coordinator-supplied, not independently reconstructed from Git.

Independently verified the pinned requirements:

| Requirement | SHA-256 |
| --- | --- |
| Variants plan, `docs/superpowers/plans/2026-11-10-sync-selection-variants.md` | `1a429ce30a791ce1bd48f1027e9bb6a3881044b3b6e7dc703e37d0ebdb9546e9` |
| Variants design, `docs/progress/2026-11-10/sync-selection-variants-design.md` | `11c6193cd23d9f371fe2ad5a689a17abfa0053941809264944fffd313ede6ab3` |
| Catalog plan, `docs/superpowers/plans/2026-11-10-sync-selection-catalog-fixtures.md` | `51bdb43293e0d7a0745d0874798ac09ba10bb72cd7469d715d6f118b7d024260` |
| Catalog design, `docs/progress/2026-11-10/sync-selection-catalog-fixtures-design.md` | `17ce1b1d1c5d9e0c155a70e3da6a916132f0ac22ecda1a1b8e55f9efeab6e49c` |

Read the complete dispatch preparation, both normative plans/designs, all six reports and independent task reviews, task-brief amendments and both ruling ledgers. Inspected the twelve changed source files, the fixed-fixture extraction diff, retained qualification evidence, and concrete external registry/transport boundaries. The full package is 654,521 bytes, SHA-256 `65bb040ba3156e1514fd48abc3307e52b4fd44cf883cb5543eee6146e73e7fb3`. The complete source-focused diff is 337,518 bytes, SHA-256 `7f9caa2ec42c9f7703f4357fa0112abed42b45dd996a6304256659949c587250`.

Every new-side source hunk matches current file bytes. The source package contains exactly twelve test paths, 4,878 additions and 253 deletions, net 4,625 lines. The full package's interleaved selector/journal architecture documents are outside this fixture assessment. No source, Git, database, service, or test mutation/execution occurred; no agents were dispatched. Only this temporary report was written.

## Six task dispositions and latest affected evidence

| Plan/task | Exact released base | Exact accepted source candidate | Integrated disposition and latest affected qualification |
| --- | --- | --- | --- |
| Variants 1: enrollment extraction | `a5e834f385aed00f8a606d0953ba0ff4a422db5a` | `13c301a5a72121d1c5a248cac570d67251ed1dff` | Satisfied. Its fixed four cases passed at Task 1 and were requalified after C0. |
| Catalog C0: installed reviewer extraction | `122b217f2048d66439b9e102734409871324685d` | `620bf2de35fa42f014c9b23364c18962a7794af3` | Satisfied. Fixed four cases and typecheck passed; three authority cases explicitly excluded by the fixture filter. |
| Variants 2: distinct baselines | `6d7b5b800022fd12508e9acd537afed84df274df` | `6721f37860cd1f60ea9442ebc68dd4e192ed28d2` | Satisfied. All four baseline cases requalified at Variants 3 after evidence-helper extraction. |
| Variants 3: bundled profile and authorized evidence extraction | `9322fc3930a0a55d84136c257d43c65b5b07bb5c` | `48ef6319d74d03ea220146a5ef21d0a34fde5c0d` | Satisfied. Four bundled plus four baseline cases and typecheck passed. |
| Catalog C1: nine genuine A subjects | `2748064d8080add5bb95bf010aedf56ffcc2cf5a` | `0deb7ab38c896618bd402d8185369bb3eeb04df6` | Satisfied for final source. Four nine-subject cases and typecheck passed; historical intermediate-source limitation retained below. |
| Catalog C2: genuine CSV B subject | `213d4f8a2389cffc24ef77562e3b5085569c8a0b` | `15b003b4a4bd57eedd7f0090c85868d2368d19b0` | Satisfied. Four CSV cases and typecheck passed; exact earlier failing source retained. |

The latest affected integration logs show fixed 4/4 in 54.69 seconds, baselines 4/4 in 54.83 seconds, bundled 4/4 in 46.25 seconds, nine-subject 4/4 in 245.07 seconds, and CSV 4/4 in 55.24 seconds. These cover 20 distinct fixture cases, with intentional repeated qualification across task gates. The fixed filter excludes `authority_same_client`, `authority_inactive_recognition`, and `authority_missing_head_with_history`; those skips do not become fixture failures or authority passes. Typecheck logs contain no final diagnostics. Explicit exit-status artifacts were inspected where retained; Task 1/Variants 3/C1 typecheck exit-zero attribution also relies on their reports, rather than inventing missing status artifacts.

## Strengths and integrated specification assessment

**One real proof/reviewer lifecycle with bounded authority.** `tests/fixtures/sync-selection-enrollment.ts:101` resolves the exact registered capture, uses its full artifact profile set, probes actual evidence, prepares the independently supplied bootstrap descriptor, and performs reserve/start/launch/complete. `:140` retains scope/policy publication and the private no-replace selection write. `tests/fixtures/sync-selection-reviewer.ts:46` only consumes installed dependencies and proofs; canonical selection membership, unique policy selection, registered scope/profile/manifest, and actual registry proof equality precede account/source grants. `:156` contains the sole authenticated prepare/activate, intent, worker A5, stored target/proof and bootstrap readback chain. The scoped in-memory policy argument validates a selected installed entry; it does not replace the full policy supplied to the worker. The public registry's `requirePolicy` and `readRegisteredFinancialAttestation` enforce the corresponding capture/build/pin/candidate/completion binding.

**Fixed behavior is preserved.** `tests/fixtures/sync-selection.ts:191` retains the zero-argument factory, ordered pair, two distinct one-profile approvals, intervening second-account absence check and shared 2/0 capture vector. The original economic and metadata literals remain local at `:255`; target equality moved into the shared readback before those checks. The authoring delta adds actual enrollment/reviewer bytes to provenance at `:128`. The unchanged existing integration file is absent from the source delta and matches retained source maps. No barrel, production, dependency, DDL, protected-producer or saved-pin change is introduced by this package.

**Distinct baselines remain genuinely immutable.** `tests/fixtures/sync-selection-baselines.ts:64` writes both complete roots before publication, with independently authored decimal originals and integer truth, identical PDF/API prefix bytes and distinct M1/M2 epochs and watermarks. The factory at `:258` captures/registers M1 before M2, pins separately, approves both only after M2 exists, and initializes own lanes at 2/0 and 3/0. Independent `tests/integration/sync-selection-baselines-fixture.test.ts:106` checks complete financial/bootstrap/target/receipt/origin bindings. The capture case at `:559` verifies newer 3→5 and older 2→5 exact intervals, globally deduplicated deliveries, older-only ongoing membership for seq3, exact replay, and unchanged non-capture state. The older unallocated window payment remains evidence outside the newer customer's imported financial state.

**Two-profile proof does not become two-customer authority.** `tests/fixtures/sync-selection-bundled.ts:61` authors the real eleven-line shared PDF and distinct account facts; `:275` checks its actual page extent, original hash/length, snapshot, and currency support for both contract fact IDs. Both profiles are compiled and covered financially; only one reviewed subject, scope and approval is installed. Independent suite `tests/integration/sync-selection-bundled-fixture.test.ts:285` validates the real protected pin/descriptor, complete two-profile report and selected bootstrap binding, while `:205` enumerates the entire small control/runtime selecting catalog. The returned other profile is equal to, but detached from, the registered bundle member. Before and after capture/replay, it has no selecting request/intent/import/target/metadata/receipt/origin. The logical selected initial authority is read as active; physical authority heads/commands correctly remain empty. Optional control receipt observations are not treated as the authoritative runtime receipt.

**Nine A entries are nine approvals, not merely nine baseline members.** `tests/fixtures/sync-selection-catalog-nine.ts:59` authors nine distinct agreements and literal invoices; `:210` compiles/registers/proves nine one-profile candidates and separately approves each after checking its prior absence. `tests/integration/sync-selection-catalog-nine-fixture.test.ts:328` verifies complete financial/bootstrap matrices, immutable bindings, eight identity dimensions each of cardinality nine, the shared full nine-event baseline, and own-only plan/target/receipt/origin. `:427` compares the actual ordered source-rooted scalar inventory using `LIMIT 9`, independently counts exactly nine imports, requires no capture/ongoing or explicit authority rows, and proves durable readback equality. It does not pretend to execute the selector's sentinel behavior.

**B is genuine CSV and incidental A remains unselected.** `tests/fixtures/sync-selection-catalog-csv.ts:90` uses unchanged `issueActivationProofs` once, adapts B through the public registry and C0, and returns only B after real import. Its local literals at `:36` and the independent suite oracle at `tests/integration/sync-selection-catalog-csv-fixture.test.ts:219` require the three monthly USD300000 invoices, payments and allocations, exact relationships/dates/metadata, nine initial origins and supported 0→0 balance. `:250` verifies actual original CSV hashes/lengths, exact header/batch metadata, parser-decoded membership, full 18/10/0 capture, contracts/remittance and each selected CSV-backed record. `:339` checks real prepared package, intent, published bundle and A5 readback; `:448` checks B-only grants and the complete A selecting-absence boundary. Both actual A and B financial matrices are independently read and checked. `verifyOriginals` remains compatibility evidence, not the oracle.

**Ownership and protected boundaries remain concrete.** Enrollment cleanup at `tests/fixtures/sync-selection-enrollment.ts:34`, reviewer cleanup at `tests/fixtures/sync-selection-reviewer.ts:105`, and B ownership at `tests/fixtures/sync-selection-catalog-csv.ts:90` memoize close, attempt every owned action and preserve the original construction failure. Each suite has one primary success, one fresh success and one genuine post-composition sentinel attempt; observed pools/listeners/namespace/root are cleaned and spies restored. Public returns expose no root, control/owner pool, credentials, proof author inputs or reviewer capability. Financial expectations and safe phase projections stay scenario-owned.

## Evidence, size, and carried rulings

Independently recomputed **233 report-listed artifact hashes and lengths**: Task 1 six, C0 eight, Task 2 56, Task 3 54, C1 50, C2 59; no mismatch. Each task's stable pre-run/post-run source data is equal, and its before-to-candidate delta is exactly its authorized paths, including the four-path Task 3 amendment. All **115 unique latest source-inventory entries** match current disk, including explicit absences. This binds unchanged accepted dependencies to the latest affected checks without rerunning passed suites.

Inspected safe proof/input/cleanup records from the latest baseline, bundled, C1 and C2 runs. Corresponding retained input phases and independent fresh attempts agree: baseline 21 files/29,480 bytes; bundled 9/13,061; nine 24/57,029; CSV both companies 66/122,769. Successful retained matrices contain 13 positive passed financial checks per report, complete source/profile/five-kind coverage where projected, and selected bootstrap results with 10 cases/9 assertions. Bundled coverage includes two profiles. All twelve latest primary/fresh/failure cleanup records report owned root removal, namespace drop, worker close and both pool ends; C2 additionally records successful control-app close and correctly no control creation in its failure attempt. Failure attempts are not credited with selected bootstrap/A5 completion.

`tests/fixtures/sync-selection-evidence.ts:17`, `:69`, `:85`, and `:100` share only inventory, actual outer-run measurement and private no-replace writing. Request measurement matches schema-normalized JSON plus LF; context is actual JSON plus LF; response figures are parsed-object serialization. Raw response wire lengths and individual nested sizes/timings remain unobserved. Direct inspection confirms unchanged transport strict `>` framing/context/combined-output rejection, registry `>= financialMessageLimit` rejection, 10MiB caps, 120000ms outer deadlines and 5000ms nested deadlines. Successful complete reports under this unchanged enforcement are separate compliance evidence, not invented nested telemetry.

Actual current size is 5,156 lines across the twelve paths:

| Component | Lines |
| --- | ---: |
| Fixed factory | 337 |
| Enrollment / installed reviewer / evidence helper | 175 / 216 / 102 |
| Baseline factory / suite | 389 / 695 |
| Bundled factory / suite | 375 / 739 |
| Nine factory / suite | 341 / 728 |
| CSV factory / suite | 193 / 866 |

The fixed factory shrank by 194 lines from the 531-line starting point. Task 3 reduced the baseline suite from 772 to 695 lines and added the concrete 102-line helper; its reported roughly 52-line saving versus two inline copies is a counterfactual estimate, not the package's net line change. The independently observed reductions and actual shared callers satisfy Task 2's nonblocking future-reuse suggestion. Catalog suites also reuse those primitives. Remaining repeated observer/resource orchestration, directory validation and literal assertions are visible and substantial, but are intentionally scenario-local under the amendment. There is no duplicated full approval chain, generic scenario framework or shared economic oracle. Larger suites exceed estimates but do not establish a blocking maintainability defect.

Two provenance limits remain explicit:

- Fixed Task 1/C0 temporary input maps were checked in process and not persisted. Persistent repository/saved-pin maps and aggregate successful logs exist; no missing original maps or proof metrics have been retroactively reconstructed.
- C1's exact initial failing suite body/contemporaneous repair patch was not retained. The safe failure log and source maps establish that only its suite changed, but cannot certify the exact intermediate text or exclusive repair narrative. The tracked report correctly labels the narrative as the implementer's account. Final source, stable inventories and passing run are independently bound. C2's exact diagnostic source copies are retained and its payload-relative lineage repair is reviewable.

## Severity-classified findings

**Critical:** none found.

**Important:** none found.

**Minor:** no new actionable finding. The carried Task 2 reuse suggestion is satisfied by the authorized concrete extraction. No source correction is required for this gate.

The concrete unresolved uncertainty is historical C1 intermediate-source provenance, described above; it does not create a demonstrated defect in the verified final candidate. Arbitrary cleanup-action rejection permutations were assessed statically rather than newly injected. No unresolved integrated correctness doubt justifies another execution of the already-passed required checks.

## Declined to judge

- Selector proposals/routing, uncovered-stream behavior, inactive-authority consumer cases, nine-row sentinel and B `unsupported_transport`: explicitly separate consumer gates; these suites qualify their inputs only.
- Runtime007/index acceptance and wider SQL-query performance: separate ownership; this package changes no migration or selector query.
- Cross-stream and independently unaffected-mapping producer prerequisites: expressly external and unchanged.
- P1 apply, later sync lifecycle, live providers, AI-off transport, browser/rehearsal, whole PR52 and broad slice/financial acceptance: outside both fixture plans and unsupported by these focused checks.
- Interleaved root selector/architecture/journal documents in the full diff: previously owned/reviewed outside the fixture source gate; no renewed semantic approval here.
- Historical exclusive lease timing and Git topology: coordinator release records supply these facts; no independent database/Git reconstruction was performed.
- Missing fixed temporary input maps and C1's exact intermediate repair text: unavailable evidence cannot be reconstructed; final evidence remains separately assessed.
- Direct nested wire/timing measurements and exhaustive cleanup-failure permutations: not observed by the authorized seams/runs; enforcement/static inspection is distinguished from execution evidence.
- Joint user acceptance: requires its own user-facing acceptance procedure and cannot follow from this independent code review.

## Independent verdicts and separate acceptance recommendations

**Specification verdict: PASS for the integrated six-task fixture scope.** Both pinned plans, with the recorded narrow Task 3 amendment and measurement/authority rulings, are satisfied by the reviewed final source and latest affected qualification evidence.

**Quality verdict: PASS.** The shared dependencies preserve genuine proof and selected authority boundaries, scenario oracles remain independent, resource ownership is explicit, and evidence claims respect their observed limits. No Critical, Important or actionable Minor issue remains.

**Variants plan recommendation: ACCEPT** Tasks 1, 2 and 3 together, including the accepted C0 dependency and the requalified baseline evidence-helper delegation. Preserve its historical fixed-input retention limit and all later consumer/producer gates.

**Catalog fixtures plan recommendation: ACCEPT** C0, C1 and C2 together. Carry the C1 historical provenance limitation without certifying its unavailable patch; the verified final nine-A and genuine B prerequisites are qualified.

**Ready for the next fixture-dependent consumer gate: YES**, subject to root's normal release and the consumer's own remaining prerequisites. This clears the combined fixture final-review prerequisite only; it does not pass the selector, approve a whole PR or claim live/financial/slice/joint acceptance.
