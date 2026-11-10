# Discovery Completion Producer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Root selects and releases the execution method; this document-only task authorizes neither implementation nor subagent dispatch.

**Goal:** Publish the strict shared repair/completion/request contract and additive control010 storage with real application-role proof, ready for a separately released Discovery consumer.

**Architecture:** Extend the existing construction-tool contract leaf and control migration catalog. Keep request content, exact finding references and delegation associations append-only; use the existing bounded repair columns and run status. Root exports make the existing leaf part of both protected evaluator source closures, so update those inventories and their boundary tests in the same contract checkpoint.

**Tech Stack:** Existing Node 24, strict TypeScript, Zod 4, Vitest, `pg` and PostgreSQL 18; no new dependency, SDK, service or framework.

**Spec:** [Discovery completion contract](../../progress/2026-11-10/discovery-completion-contract.md), exact SHA-256 `b8e32ebad1c0a53aefa18ebda1e4fb6bc385c24d9d1e517f3960553d0c3acf98`. Initial review plus `/private/tmp/eapr-discovery-completion-design-fix1-review.md` close P1/P2 with scoped specification/quality PASS. The full design remains the consumer contract, including diagnostic applicability and supersession; this plan implements only its Platform producer boundary. Fresh plan review and root implementation release remain pending.

## Global Constraints

- “Control001–009 remain immutable.” Root reserved `db/control/010_discovery_completion.sql` after inspecting 76 fetched refs; reconfirm ownership and catalog immediately before actual implementation. Runtime006 belongs to the active apply writer.
- “Only the two column UPDATE grants and SELECT/INSERT on the three tables are new.” No table-wide UPDATE, DELETE, TRUNCATE, DDL, sequences, runtime grants or blocker-resolution authority.
- “Use strict objects, prototype-key rejection, existing Id/Version parsers, canonical safe integers and the full 65,536 canonical UTF-8 byte envelope.” Questions remain bounded at 8,192 UTF-8 bytes.
- “No source, SQL migration, tests, database, provider or Git operation is part of this design task.” All source changes, commands and commits below are future execution steps after root release; source work is queued behind active apply work.
- No Discovery supervisor/repository/tasks/tools/service/role implementation. Developer1 owns consumers; no concurrent edits to its Gate J candidate. No handler advertisement, default composition mount, model call, worker change or operational-tool claim.
- Protect existing expected truth, fixture contents and installed demo pins. A source-closure change changes genuine build identity; do not rewrite persisted pins to conceal it. Explicit test-generated proof setup may derive the current build hash.
- Machine proof, exact-candidate independent review and joint user acceptance remain separate. Producer acceptance does not prove repair, finish, request consumption, live construction, eligibility, approval, activation or sync.

## Review Focus

1. Root exports introduce a real evaluator dependency even when exports are named; both protected inventories must include the leaf and detect changed/missing bytes. Task 1 covers this.
2. UTF-8 bytes differ from character counts; exact-limit multibyte questions and complete result envelopes must reject overflow without truncation. Task 1 covers this.
3. A diagnostic code with both provenance variants, or a finish revision at the safe-integer ceiling, can look individually well typed but form an invalid result. Task 1 covers this.
4. Fresh migration success can hide upgrade or existing-row damage; prove009→010, checksum immutability, idempotent repeat and unchanged existing rows. Task 2 covers this.
5. Correct FK syntax and catalog privileges can hide wrong-role execution; run actual app-role allowed/denied statements and cross-run associations, with negative statements isolated by savepoints. Task 2 covers this.

---

## Exact path map and current seams

| Future owned path | Responsibility |
| --- | --- |
| Modify `packages/contracts/src/discovery-construction-tools.ts` | New repair/finish and additive delegate schemas/types/descriptors; existing request failure enum extension. Existing `fitsProposalBytes`, strict helpers and request shapes are reused. |
| Modify `packages/contracts/src/index.ts` | Explicit named value/type exports for this producer. Do not blanket-export all existing construction tools. |
| Modify `packages/contracts/test/discovery-construction-tools.test.ts` | Structural producer tests and root/leaf export identity; retain existing finding/proposal/replay/verification/request cases. |
| Modify `packages/evaluator/src/bootstrap-runner.ts` | Add `discovery-construction-tools` to the existing `shared` contracts-source list only. |
| Modify `packages/evaluator/src/financial-attestation-build.ts` | Add that same leaf to `financialBuildSources` only. |
| Modify `packages/evaluator/test/{bootstrap-build,financial-attestation-build}.test.ts` | Existing recursive import closure tests plus exact leaf byte-mutation and missing-file cases. |
| Create `db/control/010_discovery_completion.sql` | Accepted design's status CHECK, two column grants and three request tables/index. |
| Create `tests/integration/discovery-completion-storage.test.ts` | Isolated real migration/constraint/grant/upgrade proof with private local fixture helpers. |

No `package.json`, lockfile, shared test harness, migration runner, existing migration, new contracts leaf or package export subpath needs modification. `DiscoveryStateV2Schema` already includes `completed`; do not add a duplicate state schema or alter `discovery.ts`. `repair_count` and `repair_round` already exist with 0..2 checks in004; do not add or reset them.

Inspection confirms `index.ts` currently does **not** export `discovery-construction-tools.ts`. Neither `bootstrap-runner.ts`'s `shared` list nor `financialBuildSources` includes it. Every runtime import of that leaf (`common`, `canonical`, `connector`, `discovery`, `discovery-tools`, `model`, `runtime`, `review`) is already inventoried. Named root exports still evaluate the leaf and require exactly this one inventory addition. Preserve the existing recursive closure algorithms and fail-closed build hash behavior.

## Task 1: Strict shared wire and protected root-export closure

**Files:** The seven contract/evaluator paths in the table above; no Discovery consumer file.

**Consumes:** Existing `strict`, `IdSchema`, `VersionSchema`, `DiscoverySubjectSchema`, `DiscoveryProposalV2Schema.out.shape.findingRefs`, `fitsProposalBytes`, and existing request I/O in the construction leaf. Existing local `packages/discovery/src/tasks.ts` delegate shape is read-only reference: source subject, specialist role, nonempty 8,192-byte question, unique lexically normalized `dependencyIds`.

**Produces:** Named leaf and root exports below, with inferred types bearing the same name minus `Schema`; descriptor arrays have exactly the listed tools. All exports are representation only.

| Export | Exact interface |
| --- | --- |
| `DiscoveryCompletionToolFailureSchema` | Strict `{ok:false,code}`; codes are `DISCOVERY_INVALID`, `DISCOVERY_FORBIDDEN`, `DISCOVERY_CONFLICT`, `DISCOVERY_PAUSED`, `SOURCE_UNAVAILABLE`, `TOOL_RESULT_LIMIT`, `TOOL_FORBIDDEN`, `TOOL_UNAVAILABLE`, `PROPOSAL_REVISION_CONFLICT`, `REPAIR_DIAGNOSTICS_REQUIRED`, `REPAIR_LIMIT`, `INVESTIGATION_REQUEST_LIMIT`. |
| `DiscoveryRepairDiagnosticRefSchema` | Strict union `{code,kind:'compile',toolStepId,assessmentRevision}` or `{code,kind:'verification',requestKey,jobId,assessmentRevision}`. IDs/codes use Id; revisions use Version. No mixed-variant or protected fields. |
| `BeginRepairInputSchema` | `{investigationId,proposalId,expectedProposalRevision,diagnosticCodes}`; positive safe revision, nonempty duplicate-free code set normalized lexically. |
| `BeginRepairResultSchema` | Success `{ok:true,investigationId,proposalId,proposalRevision,repairRound,diagnosticRefs}` or shared failure. Round exactly1 or2; refs nonempty, one per unique code, normalized lexically by code; every revision positive/safe. |
| `FinishRunInputSchema` | Strict `{}`. |
| `FinishRunResultSchema` | Success `{ok:true,runId,status:'completed',observedRunRevision,revision}`, shared failure, or strict incomplete `{ok:false,code:'DISCOVERY_INCOMPLETE',blockerCodes}`. Success requires safe `revision === observedRunRevision + 1`. Incomplete codes are a nonempty unique lexical set from `TASK_GRAPH_INCOMPLETE`, `TASK_DEPENDENCIES_UNRESOLVED`, `NO_CURRENT_COMPILED_PROPOSAL`, `DISCOVERY_ASSESSMENT_UNRESOLVED`, `DISCOVERY_WORK_IN_FLIGHT`. |
| Existing `RequestInvestigationInputSchema`, `RequestInvestigationResultSchema`, `DiscoveryInvestigationToolFailureSchema` | Preserve existing input and `{ok:true,requestId}` success exactly. Extend the existing failure code set to the shared failure vocabulary; preserve all existing exports and inferred types. Do not add a new request status to the wire. |
| `DelegateTaskInputSchema` | Existing delegate fields plus optional `requestId:Id`: `subject`, `role:'identity'|'contract'|'receivables'|'connector'`, `question`, `dependencyIds`, `requestId?`. Old required fields remain required; no coordinator delegation, grants or requester identity. Preserve duplicate rejection/lexical normalization of dependency IDs. |
| `discoveryCompletionToolSchemas` | Exactly `beginRepair` and `finishRun` descriptors, strict required inputs matching schemas. |
| `discoveryDelegationToolSchemas` | Exactly `delegateTask`; descriptor matches additive shared input above. |
| Existing `discoveryInvestigationToolSchemas` | Preserve exactly `requestInvestigation`; descriptor stays contracts-only. |

The result parser cannot compare a response with a separate request or authenticate stored references. It enforces one reference per code **within the result**; the later consumer checks exact input-code coverage, proposal CAS, diagnostic provenance and all authorization. Do not add a fake storage helper to claim those checks here. Request finding-ref sorting/duplicate behavior remains exactly the current schema's behavior. Do not globally refactor `common.ts` or other tool failure schemas.

- [ ] **1. Write the failing contract cases** in `packages/contracts/test/discovery-construction-tools.test.ts`: assert the exact valid input/result examples above; strict rejection of unknown, model-supplied run/grant/assessment/authority fields; nested JSON prototype keys; empty or duplicate diagnostic codes; duplicate code across compile/verification refs; variant field mixing; round0/3; zero/fractional/unsafe revisions; finish revision mismatch/overflow; incomplete empty/unknown/duplicate blocker codes; arbitrary failure strings/prose. Assert existing request success shape unchanged and new failures accepted.
- [ ] **2. Add boundary and descriptor cases** in the same test file: ASCII and multibyte question byte lengths8192 accepted/8193 rejected for both request and delegate; full canonical input/result65536 accepted and65537 rejected using valid bounded IDs/ref arrays and a fixture helper that measures the complete envelope, not an individual field. If a particular fixed result shape cannot reach the byte boundary, assert its structural maximum and exercise the actual variable-size repair result. Validate old delegate input, optional requestId, all four specialist roles, duplicate dependencies and noncoordinator exclusion. Assert descriptor names/required fields/`additionalProperties:false` and schema-visible bounds; document cross-field/byte refinements that JSON Schema cannot express. Assert named root exports equal their leaf objects/types. No handler or authorization assertion belongs in these schema tests.
- [ ] **3. Run the focused red command**: `npm run test:unit -- packages/contracts/test/discovery-construction-tools.test.ts`. Expected failure is missing new exports/schema behavior, not a fixture or unrelated environment error; capture that distinction.
- [ ] **4. Implement the minimal contract exports** in the existing leaf and explicit named exports in `index.ts`. Use existing strict/prototype and canonical-byte helpers; normalize sets without mutating caller arrays. Apply byte bounds to parsed complete success/failure objects and inputs. Preserve current request input and existing construction schemas. Keep diagnostic provenance IDs safe and messages absent. Export inferred types and the descriptor arrays listed above; no package subpath or Discovery import.
- [ ] **5. Add protected closure cases** in both existing build test files. In bootstrap `families`, add `['packages/contracts/src/discovery-construction-tools.ts', true]`; prove a byte change alters both subject and evaluator build hashes. In financial mutation cases, add that exact leaf and prove hash changes. Add dedicated copied-tree deletion cases: missing leaf rejects bootstrap with `BUILD_MISMATCH` and financial with `FINANCIAL_ATTESTATION_UNAVAILABLE`. Keep recursive import-graph tests intact; do not mock away the root export or test only list membership.
- [ ] **6. Run the closure red command** before inventory correction: `npm run test:unit -- packages/evaluator/test/bootstrap-build.test.ts packages/evaluator/test/financial-attestation-build.test.ts`. The new root edge must expose the missing leaf/hash coverage. This isolates why the inventory change is necessary rather than expanding it speculatively.
- [ ] **7. Add only the existing leaf** to bootstrap `shared` and financial `financialBuildSources`. Do not change evaluator protocols, algorithms, expected truth, fixtures, launched entrypoints or saved operator pins. All transitively imported contract leaves already occur in both inventories; if execution discovers a new dependency, stop that expansion and request exact shared-path review rather than weakening closure tests.
- [ ] **8. Verify the cohesive checkpoint**: `npm run test:unit -- packages/contracts/test packages/evaluator/test/bootstrap-build.test.ts packages/evaluator/test/financial-attestation-build.test.ts`, then `npm run typecheck`. Expected: focused suites/typecheck pass without DB/provider access; protected hash identities change honestly. Use fresh fixture-generated expected build hashes only where those existing tests already construct pins.
- [ ] **9. Commit only Task1 paths** with subject `feat: publish discovery completion producer contracts`. Obtain fresh exact-candidate producer review; retain no operational-tool claim. Do not silently include active-apply or Developer1 changes.

## Task 2: Additive control010 and actual app-role proof

**Files:** Create `db/control/010_discovery_completion.sql` and `tests/integration/discovery-completion-storage.test.ts` only. Read `scripts/migrate.ts`, `scripts/native-db.ts`, `tests/integration/migration-prerequisites.test.ts` and existing004/007/009 to construct local test fixtures; no edits to those files.

**Consumes:** `startNativeDb()`, `provisionTest(testNamespace(label))`, `dropTest(namespace)`, `createControlDb({connectionString: pair.control.appUrl})`, `readMigrationCatalog({throughVersion})`, `migrationIdentities(catalog.control)`, and `migrate(pair,['control'],catalog)`. Use an allocated isolated database lease; `testNamespace` labels are at most12 lowercase alphanumeric characters. Direct provisioning avoids launching HTTP services or mounting Discovery consumers. Privileged credentials perform provisioning/migration only, except isolated catalog inspection needed by the proof; product-row writes and grants checks run as the actual app role.

**Produces:** Accepted design's exact SQL:

- Replace `discovery_runs_status_check` with existing queued/running/paused/blocked/failed plus `completed`; preserve every existing status and row.
- Add `UPDATE(repair_count)` on `discovery_investigations` and `UPDATE(repair_round)` on `discovery_tasks`. Existing004 counter checks, columns and data are retained.
- `discovery_investigation_requests`: `request_id` PK equals originating step ID through `(run_id,requester_task_id,request_id)` FK to007's `(run_id,task_id,id)` tool-step key; same-run unique `(run_id,request_id)`; nullable seller/account pair with paired-null CHECK; question1..8192 octets.
- `discovery_investigation_request_findings`: PK `(run_id,request_id,finding_id,finding_revision)`; same-run request FK and exact immutable finding revision FK to007.
- `discovery_investigation_request_delegations`: PK `(run_id,request_id)`; unique `delegation_step_id` and `delegated_task_id`; FKs to same-run request, `(run_id,coordinator_task_id,delegation_step_id)` step and `(run_id,delegated_task_id)` child. No new role/name/subject authority implied by these FKs.
- `discovery_investigation_requests_task` index `(run_id,requester_task_id,request_id)`; SELECT/INSERT only on the three new tables. No cascades, mutable status, additional sequence/table/trigger/function or runtime change.

Copy the reviewed SQL definitions from the design's “Exact control010 storage and grants” section; do not replace its checks/FKs with JSON blobs or add invented constraints such as twenty requests enforced without owner locks. The count20 pending cap, task creation, request consumption semantics, repair increment rules and completion authority are consumer behavior, not guarantees of these grants.

- [ ] **1. Reconfirm root release/reservation** and the actual catalog immediately before creating010. If010 is taken or existing001–009 hashes differ, stop the conflicting write and report exact evidence; do not renumber or edit applied files. Verify existing constraint name and007 supporting unique keys from actual catalog during the upcoming SQL proof.
- [ ] **2. Write the failing real-SQL test file** with fresh and upgrade fixtures using the existing lease APIs. Migrate upgrade fixture through009; insert representative004 run/investigation/task/returned-dispatch/tool-step rows and007 exact finding identity/revision rows as the app role. Use valid current table fields and satisfy the deferred finding-head FK in one transaction. Retain snapshots of existing rows, control ledger, activity counter/events and runtime catalog/ledger. Build a second run/task/step/finding set for cross-run negatives. Keep fixture helpers private to this file; use public synthetic values only, no model/evaluator/registry fixture loader.
- [ ] **3. Pin immutable001–009 identities** in that test to the literal table below, compare them to both repository bytes/catalog identities and the actual pre/post-upgrade ledger. The expected pins are not recomputed from potentially modified files. Assert pre010 app mutations `status='completed'` fail23514 and repair-column UPDATE fails42501; after010 these same valid operations succeed. Red command: `npm run test:integration -- tests/integration/discovery-completion-storage.test.ts`; expected fail is missing010/new tables/privileges, never a skipped unavailable DB.
- [ ] **4. Implement only010** from the reviewed SQL. Apply it through `migrate(pair,['control'],readMigrationCatalog({throughVersion:10}))`; no product DDL or edits to existing migrations. Let the runner atomically update its ledger with010's actual bytes/hash.
- [ ] **5. Prove fresh/upgrade/idempotency** in the same test: fresh001–010 and populated009→010 both yield identical new constraints/grants, existing rows and001–009 ledger entries remain unchanged, repeated migrate does not add rows/events/reset counters,010 occurs once with its actual hash. No runtime migration is executed by this control-only test; compare runtime catalog/ledger fingerprint unchanged. Confirm only the three new request tables/index and intended CHECK/grant delta appear.
- [ ] **6. Exercise actual app-role allowed operations**: all existing run statuses and completed; repair_count/repair_round0,1,2; source and captured-tuple request rows; exact finding-reference rows; one same-run delegation association and child reference. Prove pending/delegated can be derived by association absence/presence using SELECT without mutable status. Success proves storage capability only, not authorized coordinator behavior.
- [ ] **7. Exercise constraints with rollback/savepoint isolation**: repair -1/3 and unknown run status23514; question empty/8193 bytes/partial-NULL subject23514;8192-byte multibyte question succeeds; missing/cross-run originating step, request/finding revision, coordinator step and child23503; duplicate request ID, exact finding link, request consumption, delegation step or child23505. Two requests for the same subject are allowed; no unapproved subject uniqueness rule. Close/reopen the app pool and confirm committed immutable request/ref/association rows persist.
- [ ] **8. Exercise privileges rather than only catalog strings**: app-role SELECT/INSERT on new tables succeeds; UPDATE every non-key and key content column, DELETE and TRUNCATE each new table fail42501. Existing investigation run/subject identity and task role/grants/identity updates fail42501, while the two intended repair columns succeed. Existing finding-blocker UPDATE/DELETE remains denied; do not assert INSERT is denied because007 intentionally permits it. App CREATE/ALTER/DROP and connection to the other database remain denied; use actual existing role-isolation pattern and suppress URLs/credentials in errors. Assert table-wide UPDATE remains false and exact column grants with `has_table_privilege`/`has_column_privilege` or catalog equivalents. A denial caused only by a missing row or CHECK is not a privilege proof.
- [ ] **9. Verify the checkpoint**: `npm run test:integration -- tests/integration/discovery-completion-storage.test.ts tests/integration/migration-prerequisites.test.ts`, then `npm run typecheck`. Expected: real PostgreSQL tests and typecheck pass on the assigned lease, existing migration runner regression remains green. Use PostgreSQL18/Node24 PATH from repository guidance. Do not broaden into live or full-slice claims.
- [ ] **10. Commit only Task2 paths** with subject `feat: add discovery completion control storage`. Publish exact010 hash, unchanged001–009 pins, allowed/denied privilege evidence, test commands/results and consumer limitations for fresh review.

### Immutable control migration pins

Read from actual files during this plan's source inspection; these are expected invariants, not authorization to accept a changed baseline.

| File | SHA-256 |
| --- | --- |
| `001_base.sql` | `b2f5e5ce3a689ecb1ccef3c51dd90db6485fffe33bcdffec6d94d2984f11284f` |
| `002_sources.sql` | `3b8df852acf97a5fde560eb53329e974bd6f7914e531da2081117fd44a033fed` |
| `003_artifacts.sql` | `2c996c8f7b87581f303762bdbef80abb6137d293c0d686268776b5d57b98a22c` |
| `004_discovery.sql` | `5cbfbc573a337414d3e544aa3e70ceac4313db5dc08ff163d6012f6d433546fb` |
| `005_bootstrap_verification.sql` | `ce373f832bd5cce6f77386411de423876a043807fee4a3763a9c8396e6188b31` |
| `006_financial_provenance.sql` | `a01d43772e40e3c1a8d29425707fe5109d2a0db06c2adbfa5e04bebeee692e45` |
| `007_discovery_construction.sql` | `f9c0883a6da0e5ae25c04c8fe566682c72e2acfcc9f22a88e2e0105a83b9f35b` |
| `008_review_activation_intents.sql` | `956127c4414c86ab5ffe4bd630cabd333662fb61688af540a8b19184b97b0a54` |
| `009_discovery_verification_requests.sql` | `5080b0c7cec1c0a6eb366aa650f01e87d50183d5de3fa490691bf0f8085c1ab0` |

## Final producer verification and handoff

- [ ] On the final exact candidate, confirm both checkpoint results remain applicable; rerun the focused combined suites only if subsequent changes invalidate their evidence. Run `npm run typecheck` and inspect the exact changed-file scope. No runtime, Discovery consumer, composition, fixture-truth or saved-pin edits may be hidden in the candidate.
- [ ] Obtain independent exact-candidate review of schemas, protected closure changes, migration SQL and real app-role proof. Report code SHA,010 hash, immutable pins, protected source inventories and exact checks. Do not auto-regenerate operator fixtures/pins merely because genuine build hashes changed.
- [ ] Root releases accepted producer SHA/interfaces to Developer1 and separately releases the consumer paths after its active Gate J work is accepted. Until a real consumer exists, tools remain recognized but unavailable/unadvertised in `roles.ts`; exporting descriptors is not mounting them.

Developer1 still owns: current authority/capture checks; exact owner/generation/dispatch/step fences; all locks and atomic effect/result/activity transactions; full-batch request/delegation/repair capacity; twenty pending requests per task; durable request context and linked consumption; repair quiescence/round binding and separate verifier budget; the accepted diagnostic selector with full-scope settled compile outcomes, first-admission chronology, cross-assessment supersession and exact verification subjects; atomic coordinator/step/run finish; protected historical replay and consumer race tests. The producer does not implement or demonstrate any of these.

Full design consumer cases remain mandatory later, especially A compiled/B failed with clear current assessment, later genuine superseding compile success, pending/unknown attempts, hidden sticky blockers, different verification subjects, pause/revocation/owner loss and terminal coordinator self-completion. Missing a consumer is an explicit dependency, not a producer failure to be filled by a parallel implementation.

## Self-review

The two cohesive checkpoints cover every released producer requirement: shared schemas/results/descriptors, narrow root exports, actual protected closure impact, additive status/grants/request keys, real fresh/upgrade/app-role proof and immutable migration pins. All five Review Focus items have explicit owning test steps. Cross-input result matching and operational authority remain clearly assigned to the consumer rather than falsely claimed as schema validation. Schema/export names are consistent throughout; no new leaf or package export is invented. The plan is smaller than the full design and adds no financial behavior or blocker-resolution policy. This authoring pass changed only this plan, inspected source and calculated existing file hashes; no implementation, Git, DB, tests, provider or subagent execution occurred. Fresh plan review is next.
