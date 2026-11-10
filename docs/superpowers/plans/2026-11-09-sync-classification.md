# Sync Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded, exhaustive batch classifications and typed prerequisites from the existing pure financial evaluation while preserving every existing `planBatch` result.

**Architecture:** Keep one private evaluator in `packages/compiler/src/plan-batch.ts`; `planBatch` projects its unchanged `PlanOutcome`, and the additive `classifyBatch` returns that outcome plus metadata. Trace original occurrences, materialization, group validation and finalization as they happen. Keep the existing module and subpath, with no second financial interpreter, extracted source leaf or transport schema.

**Tech Stack:** Node 24, strict TypeScript, existing Zod contracts, Vitest; no new dependency.

**Spec:** [Accepted classification design](../../progress/2026-11-08/handoffs/platform-sync-classification-design.md), SHA-256 `c51dbd0813a6f55f316dc1a2ac3ead19ccfe9bec37f270cadb814d90dd5aee38`; read it together with the [original review](../../progress/2026-11-08/reviews/platform-sync-classification-design-review.md) and [correction review](../../progress/2026-11-08/reviews/platform-sync-classification-design-fix-review.md). The corrected design settles normalized repeats and whole-request final-plan failure. Governing sources are [F1–F3/F5](2026-11-08-contract-freeze.md), [PRD §§11–13](../../../prdv2.md#11-steady-state-synchronization), [ownership](2026-11-08-shared-contracts.md#file-ownership), and [verification conventions](2026-11-08-implementation-plan.md#execution-and-verification-conventions).

## Global Constraints

- Preserve `planBatch(artifact, profile, events, target):PlanOutcome` and its exact output behavior.
- All evaluation uses `target.asOf`, as today. Limits remain 1,000 input records and 5,000,000 cents per transaction from approved artifact.
- Repeat metadata uses exactly the representation produced by current `parseEvents`, not pre-parse input JSON bytes; no raw-input equality guard is added.
- Economic identity is full `(sourceRef,sellerEntityId,kind,recordId)`, independent of versions/event IDs/account aliases.
- Existing `Hold.dependencies` stays unchanged for compatibility.
- No new current-time dependency, database, model, receipt or authority input.
- No receipt ID is supplied or inferred. Classification is not application or authorization.
- No source writes, parent writes, scheduler, SQL/migration, current-authority change, capture change, consumer wiring, HTTP contract, UI, model execution or integration/e2e work belongs to this task.
- Do not change independent financial expectations, transaction/reversal rules, financial helpers, or existing fixture assertions to accommodate this implementation. Raise any discovered product/financial specification gap to the owner; continue only independent specified work.

## Review Focus

1. Parsed duplicates with normalized timestamps must retain legacy deduplication while each original occurrence receives one disposition; covered by Step 4.
2. Replay-equivalent or coalesced candidates inside an invalid connected group must all remain held; covered by Step 5.
3. Same source IDs across kinds/customers must not produce false prerequisite providers or source-wide enrollment conclusions; covered by Steps 5–6.
4. Fatal guards and a late caught `FinanceError` must discard provisional metadata without changing legacy hold production/order; covered by Step 6.
5. Two wrappers sharing a regression can agree with each other; independent pre-change compatibility bytes and protected recursive source pins must expose that failure; covered by Steps 1–2 and 8–9.

---

## Candidate and ownership

Planning inspected clean base `9680b052765400ade5032b077893e7d4e472e147` on `codex/platform-sync-classification`, in `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`. The pre-change planner Git blob is `70350f44c2d03ad9bda4b114e61c3eb36495a86a`. Recheck these before capturing compatibility evidence. This document is preparation, not implementation approval or a machine pass.

### Task 1: Add same-evaluation classification with exact legacy compatibility

This is one reviewable deliverable: the companion and its compatibility/build evidence cannot usefully ship separately. Developer 0 owns only the following implementation paths after assignment:

- Modify: `packages/compiler/src/plan-batch.ts` — public in-process types, private shared evaluation and trace, unchanged legacy wrapper, new companion.
- Create: `packages/compiler/test/fixtures/classification-cases.ts` — named public-development inputs for compatibility and classification tests; no protected truth or production import.
- Create: `packages/compiler/test/fixtures/plan-batch-before-classification.json` — immutable pre-change outcomes and source provenance.
- Create: `packages/compiler/test/classify-batch.test.ts` — compatibility, dispositions, prerequisites, binding and cross-reference invariants.
- Create: `packages/compiler/test/classify-batch-final-failure.test.ts` — isolated test-only finalization failure injection.
- Modify: `packages/evaluator/test/bootstrap-build.test.ts` — direct planner-byte mutation coverage for both bootstrap pins.
- Modify: `packages/evaluator/test/financial-attestation-build.test.ts` — explicit planner inventory assertion alongside existing mutation and recursive closure checks.

Read-only dependencies include existing compiler tests, `operations.ts`, `canonicalize.ts`, finance helpers, `parent/src/state.ts`, contracts, `tests/fixtures/index.ts`, `packages/evaluator/src/bootstrap-runner.ts`, and `packages/evaluator/src/financial-attestation-build.ts`. Read the root, packages, compiler and evaluator `AGENTS.md` files before implementation. No package export or shared-contract barrel edit is needed: `@eapr/compiler/plan-batch` already exports this source module. No new compiler leaf is planned; therefore both build inventories remain unchanged. If an extraction becomes necessary, stop and revise the owned paths and both build inventories before implementing it.

**Interfaces:**

Consumes the existing four arguments and helpers without changed semantics:

```ts
planBatch(artifact: CompiledArtifact, profile: CustomerProfile,
  events: SourceEvent[], target: TargetState): PlanOutcome;
classifyBatch(artifact: CompiledArtifact, profile: CustomerProfile,
  events: SourceEvent[], target: TargetState): BatchClassificationV1;
```

Export the compiler-owned `BatchClassificationV1`, `BatchStopReason`, `ClassificationBinding`, `EventRef`, `InputClassification`, `MappedIdentity`, `TypedPrerequisite`, `ExistingRecordRef`, `DependencyGroupClassification`, and `SourceBlocker` types from that module. Use the exact fields/unions in the accepted design, including `schemaVersion:'1'`. `EventRef` is `{sourceRef:Id,eventId:Id,streamId:Id,sequence:number,contentHash:Hash}`; `ExistingRecordRef` is `{identity:EconomicIdentity,targetRecordId:Id,sourceEventId:Id,sourceRecordVersion:number}`. Other names refer to existing contracts, not new aliases with relaxed validation.

The private evaluator signature is `evaluateBatch(artifactInput:CompiledArtifact, profileInput:CustomerProfile, inputs:SourceEvent[], targetInput:TargetState):BatchClassificationV1`. Both public functions call it once per invocation. `planBatch` returns only `.outcome`; it must never expose `schemaVersion` or `details`. No production caller changes in this task.

Closed `BatchStopReason` values are `artifact_binding`, `input_limit`, `target_invalid`, `target_scope`, `delivery_conflict`, `source_guard`, and `plan_invalid`. `not_classified` carries only reason, actual hold indexes and source blockers; no binding/items/groups. `classified` carries binding, exactly one item per original input index, groups and source blockers. The six item dispositions and their exact reference fields are those in the accepted design: `held`, `semantic_observed`, `financial_new`, `financial_replay`, `financial_coalesced`, `delivery_repeat`.

- [ ] **Step 1: Establish a reproducible pre-change compatibility corpus before editing production code.**

Create `classification-cases.ts` exporting `compatibilityCases`, an array of `{id,artifact,profile,inputs,target}` using public development fixtures. Include both A/B baseline inputs; empty input; late payment alone and with allocation; missing/released dependencies; over-allocation plus independent funds; replay under changed delivery/version; mixed replay/new/coalesced groups; full reversal/replay and unsupported reversal variants; exact/normalized repeats; malformed envelopes, bad hashes and conflicting deliveries; scoped/unscoped semantics; foreign source/seller/company and unknown account; mapping failures; artifact/profile/target/scope failures; exactly 1,000 repeated occurrences and 1,001/nonarray rejection. Include separate input rows for bad-hash/valid duplicate orderings and the existing-target delivery conflict after an earlier held input. Preserve invalid values in cases as `unknown` cast only at the caller boundary.

Use the setup patterns already in `plan-batch.test.ts`; do not edit its expectations. Extend A/B baseline, mixed new/replay/coalesced, and mixed held/accepted cases with 32 deterministic Fisher–Yates permutations each, using a local seeded generator with initial seed `0x51c1a55`. Give every permutation a stable case ID. Store expected outcomes for each ordering independently; do not assert arbitrary malformed/hold order is permutation-invariant.

While the planner blob still equals the base blob above, capture every case's complete `PlanOutcome` using the actual old planner into the JSON fixture. A temporary authoring script may write only that owned fixture, with this body:

```js
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { planBatch } from '@eapr/compiler/plan-batch';
import { compatibilityCases } from './packages/compiler/test/fixtures/classification-cases.ts';
const plannerBlob = execFileSync('git', ['hash-object', 'packages/compiler/src/plan-batch.ts'], {encoding:'utf8'}).trim();
if (plannerBlob !== '70350f44c2d03ad9bda4b114e61c3eb36495a86a') throw new Error('Pre-change planner required');
writeFileSync('packages/compiler/test/fixtures/plan-batch-before-classification.json', JSON.stringify({
  baselineCommit:'9680b052765400ade5032b077893e7d4e472e147', plannerBlob,
  cases:compatibilityCases.map(({id,artifact,profile,inputs,target}) => ({id,outcome:planBatch(artifact,profile,inputs,target)})),
}, null, 2) + '\n');
```

Execute with Node 24 and `--import tsx --input-type=module` from the worktree root. Preserve the script body/command and fixture SHA-256 in the implementation evidence. Delete any temporary script afterward; it is not another owned tracked path. Never regenerate the expected fixture from the refactored evaluator. If baseline differs, resolve the base with the owner first.

- [ ] **Step 2: Prove the corpus captures legacy behavior and pin the final failure before refactoring.**

In `classify-batch.test.ts`, add `matches every pre-change planner outcome byte-for-byte canonically`. Read the JSON with `readFileSync(new URL(..., import.meta.url))` (no compiler-configuration change), assert provenance and exact ID set, then compare `canonicalJson(planBatch(...))` with the stored complete outcome. This compares operations, plan hashes, balance, lineage, event IDs, diagnostics, hold content and array order—not only counts. Run `npm run test:unit -- packages/compiler/test/plan-batch.test.ts packages/compiler/test/classify-batch.test.ts`; both must pass against the untouched planner.

In the isolated final-failure file, use Vitest's module mock for `@eapr/finance/balance` only: retain other exports, replace `computeBalance` with a function throwing the real `FinanceError('MONEY_RANGE', 'Monetary total exceeds the exact integer range')`. Feed a malformed envelope followed by one existing-record replay and one independent new invoice so group validation succeeds, earlier parse holds exist, and `resultPlan` is reached. Assert the old planner returns no plans, the original `SOURCE_SCHEMA` hold first and the appended `MONEY_RANGE` hold covering accepted events in legacy sorted order. Run `npm run test:unit -- packages/compiler/test/classify-batch-final-failure.test.ts`; PASS establishes the unchanged catch contract. This is a fault-injection test of the catch branch, not a claim that this small fixture naturally overflows. Do not weaken transaction bounds or add a production injection seam to reach it.

- [ ] **Step 3: Add the exact additive types and observe a behavioral red test.**

Add the exported types and a temporary compiling `classifyBatch` stub with a valid `not_classified` result. Add `classifies A and B baselines with exact operation references`: assert `schemaVersion==='1'`, `details.kind==='classified'`, one `financial_new` item per baseline occurrence, no blockers/holds, and each `(planIndex,operationIndex)` identifies its exact expected existing operation. Assert binding equals artifact/profile hash, selected scope, validated target version/asOf and `hashTargetSnapshot(validatedTarget.state)`. Run `npm run test:unit -- packages/compiler/test/classify-batch.test.ts`; it must fail on the classification assertion, not import/setup. Remove the stub in Step 7.

- [ ] **Step 4: Add occurrence, replay, coalescence and binding assertions.**

Add these named tests to `classify-batch.test.ts`; each must fail meaningfully against the stub:

| Test | Required assertions |
| --- | --- |
| `classifies all-target replay without a plan` | Existing target records, including original `sourceEventId` and `sourceRecordVersion`, populate `existing` exactly; groups are accepted, plans empty, no new/coalesced items or receipt property. Cover all five financial kinds with a valid target containing a full reversal. |
| `separates new economics coalescence and replay` | Distinct delivery/version IDs with identical new economics produce one new and the remainder coalesced to that new item's index; an independent persisted replay remains replay. Legacy accepted plan event IDs include all accepted deliveries, but only the insertion has operation/lineage. Reverse input order to prove producer follows actual planner insertion order, not lowest input index. |
| `tracks parsed repeat occurrences including normalized instants` | Two/three identical deliveries produce one non-repeat at the earliest input index and backward repeat links. `...00Z` and `...00.000Z` envelopes carrying the normalized parsed-event hash behave identically. Test repeats of held, semantic, replay and coalesced representatives. Changed `observedAt` with recomputed hash instead yields fatal delivery conflict. |
| `binds the exact parsed target without mutation or clock reads` | Freeze cloned inputs; assert unchanged inputs after both functions. Change target version and asOf separately and assert changed binding/hash matching `hashTargetSnapshot`; retain the old financial outcomes. Stub `Date.now` to throw during evaluation and restore it. Empty bounded input is classified with empty items/groups, not a financial success claim. |
| `covers each bounded occurrence with valid internal references` | For every classified corpus case assert indexes equal `0..inputs.length-1`; all hold/plan/op/group/provider/primary/producer indexes resolve. Groups contain exactly materialized representative items once, members sorted by input index; held groups have only held members and accepted groups only financial new/replay/coalesced. A repeat points backward to a non-repeat with the same parsed event; a coalesced item points to new with matching identity/group; replay refs match immutable target records. |

- [ ] **Step 5: Add typed prerequisite and financial-group assertions.**

Use the existing `invoiceBeforePaymentVariant`, late-payment, reversal and over-allocation public examples plus bounded explicit variants. Expected money remains the frozen existing examples (`80_000` baseline, `50_000` after allocated late payment, `90_000` released dependency, `280_000` after the existing full-payment reversal).

| Test | Required assertions |
| --- | --- |
| `reports exact allocation and reversal prerequisite identities` | Allocation has `allocation_funding` keyed by its payment/credit kind and funding ID, and `allocation_invoice` keyed by invoice kind/ID; reversal has `reversal_original` keyed by payment/credit. Every scope/source/seller and `targetRecordId(identity)` is exact. Invoice/payment/credit prerequisites are empty. Test payment and credit variants. |
| `distinguishes target candidate and missing presence` | Target wins over matching candidates; otherwise candidate provider indexes are sorted unique representative indexes, excluding repeats; otherwise missing. Missing invoice holds the whole group with unchanged diagnostic dependencies, then adding its exact provider releases it through the old validated behavior. |
| `does not confuse same raw IDs or held providers` | Same raw ID for invoice and payment yields distinct typed keys. Foreign account/source/seller candidates and mapping failures never provide a selected-scope prerequisite. Successfully materialized conflicting providers remain listed as candidates but every member of their held group, including a replay-equivalent member, is held. No candidate presence implies validity. |
| `preserves existing allocation edges and capacity coupling` | Existing allocations connect new candidates/reversals sharing funding or invoice capacity exactly as legacy `dependencyGroups`. Over-allocation holds that connected group while independent unallocated funding remains accepted and does not reduce balance. Replay/coalesced members in the failing group have no success references. |
| `preserves supported reversal and economic conflict boundaries` | Full payment/credit reversal preserves originals. Partial/invoice/reversal-of-reversal payloads remain mapping holds with `mapped:null`; funding at/after reversal remains held. Same identity with changed amount, relationship or effective time stays held; unsupported currency stays rejected at the existing source/mapping boundary. Do not introduce another accepted currency just to exercise economic comparison. |

For every materialized held/new/replay/coalesced item, prerequisite order is relation then `canonicalJson(identity)` using existing lexical comparison; duplicate relation/identity pairs are forbidden. `Hold.dependencies`, its order and messages stay byte-equivalent to the corpus.

- [ ] **Step 6: Add every rejection branch and source-boundary assertions.**

Use a table-driven `preserves fatal legacy outcomes with bounded not_classified detail` covering each stop reason: malformed/noncanonical artifact/profile and inconsistent executable binding; nonarray and 1,001 inputs; invalid target and target financial validation failure; target/profile scope mismatch; parse-time conflict (valid/invalid hash both orderings and changed canonical content); mapped delivery colliding with another existing target economic record; current unscoped-source guard; and the final failure test. Check exact existing outcome and actual explanatory hold indexes. Except source guard, blockers must be empty. Confirm rejected overlimit/nonarray inputs have no per-input items/groups or input-sized response allocation; 1,000 exact repeats remain within limit and classified.

Add `keeps malformed holds and profile-local identity separate`: independently repeated malformed envelopes produce separate held items with `event:null`, `mapped:null`, no group and their own actual hold index. A parsed bad-hash envelope may preserve its checked-envelope reference but cannot map or repeat. Ordinary mapping failure is held with no guessed prerequisite. Two source refs sharing an event ID must not have hold references matched by bare ID. Include cyclic/noncanonical runtime input assertions outside the JSON corpus where necessary.

Add `observes only validated unchanged selected-profile semantics`: build a valid pinned semantic resource/stream/payload from the public source contracts; unchanged selected-profile semantic event is observed with scope. Changed scoped semantics holds that account's otherwise-valid events. Invalid semantic payload, wrong stream/resource/schema, unknown account and foreign identity are never observed. Unknown/foreign identity has no invented mapped scope or source blocker. Known independent account is merely outside this selected profile, not asserted globally unknown.

Add `reports only actual source guard causes`: mix same-source/company missing-seller input, unscoped semantic input, an ordinary same-source event and an unrelated-source event. Result is `not_classified/source_guard`; preserve the legacy broad hold event set, but return only triggering original input indexes (including validated repeated occurrences) in the blocker. Use the same source and aggregate guard code selected by the actual guard: `SEMANTIC_VERSION` if any triggering event is semantic, else `IDENTITY_SCOPE`. Do not promote an unrelated-source or ordinary foreign-account event to a source blocker.

Extend the isolated final-failure test to assert `classifyBatch(...).outcome` equals the already-pinned legacy failure; details equal `{kind:'not_classified',reason:'plan_invalid',holdIndexes:[lastHoldIndex],sourceBlockers:[]}` with no items/groups. Also make the mocked final computation throw an ordinary `Error` in a separate test and assert both public functions propagate it; do not broaden the existing catch. Restore mocks between cases.

- [ ] **Step 7: Implement tracing inside the single existing evaluator.**

Rename the existing body to private `evaluateBatch` and return the additive result at its current exit points; keep legacy expressions/messages/branch precedence intact. Keep `materialize`, `economics`, group construction, validation, inserted sorting and `resultPlan` in this module. Extend private candidate/parse/group bookkeeping only as needed:

- During the existing parse loop, retain occurrence indexes and the schema-parsed/hash-validation result. Keep the existing `seen`, conflict rules, last-value map behavior and sorted event list unchanged. Map successfully validated identical parsed delivery occurrences to their earliest original index as metadata only. Track raw-invalid and hash-invalid hold producers directly; never reconstruct associations from `Hold.eventIds`.
- Thread the representative index through the existing materialization path. Record validated semantic observations only after `materialize` returns null. Attach held item explanations when the legacy hold is appended. Preserve early exits that replace previous holds.
- Enrich the existing private prerequisite helper with relation and economic identity alongside its current `targetId/sourceId`; both group validation and output use that helper. Preserve the helper's original funding-before-invoice ordering for legacy validation/hold behavior; sort a separate metadata array only. Resolve presence from validated target records first, otherwise successfully materialized selected-scope candidates across this invocation, never arbitrary raw payloads.
- Retain group order from `dependencyGroups`; record actual validator holds by index. Extend successful group bookkeeping at its existing persisted/pending comparison to distinguish target replay from pending coalescence and insertion. Keep `economics` excluding **only** `sourceEventId/sourceRecordVersion`. Do not run a second economic classifier or call `planBatch` from `classifyBatch`.
- Only after final `resultPlan` succeeds, resolve inserted candidates to their final sorted operation indexes, publish accepted metadata, and add repeat items. The zero-insert branch still emits accepted replay groups and semantic/held items with empty plans. Final caught `FinanceError` emits only `not_classified/plan_invalid` and points at the appended hold while preserving earlier holds. Other exceptions propagate as before.
- Build the binding from the validated artifact/profile/target, using existing `hashTargetSnapshot(target.state)` and explicit normalized `target.state.asOf`. Metadata is proposed/scoped information, never a global uniqueness, enrollment, receipt or authorization conclusion.

Run `npm run test:unit -- packages/compiler/test`; expected PASS, no skipped cases. Resolve any mismatch by restoring legacy behavior or raising a precise pre-existing contract conflict; never rewrite frozen compatibility outcomes to conceal drift.

- [ ] **Step 8: Verify protected source-build coverage without refreshing protected expectations.**

`bootstrap-runner.ts` already includes `plan-batch.ts` in `subjectSources` and therefore `evaluatorSources`; `financial-attestation-build.ts` already includes it in `financialBuildSources`. These hashes digest current source bytes dynamically, so there is no literal build hash to patch. This task adds no source import leaf and requires no inventory edit.

Add `['packages/compiler/src/plan-batch.ts', true]` to `bootstrap-build.test.ts`'s mutation families. Assert membership in both bootstrap inventories; an isolated temporary copy with planner bytes changed must change both bootstrap hashes. In `financial-attestation-build.test.ts`, assert direct inventory membership and retain its existing planner-byte mutation check. Run both recursive closure tests unchanged; each must still cover all reachable package exports/imports. Do not regenerate protected truth, approvals, policies, fixtures or stored attestations to keep old pins valid. Existing proofs for old build bytes require later normal re-verification; this task does not issue them.

Run `npm run test:unit -- packages/evaluator/test/bootstrap-build.test.ts packages/evaluator/test/financial-attestation-build.test.ts`; expected PASS including mutation and recursive coverage assertions.

- [ ] **Step 9: Complete the bounded machine and review handoff.**

Run `npm run typecheck` and `npm run test:unit -- packages/compiler/test packages/finance/test packages/evaluator/test`. Expected exit 0 with no skipped required cases. The compiler suite includes existing bootstrap-wrapper regressions, while the evaluator suite checks the preserved protected consumers and source pin logic. Do not broaden into DB, integration, browser, model or slice commands in this assignment. Record exact commands, runtime version, base/candidate hashes, frozen compatibility fixture hash, observed red assertions and green results as **partial** machine evidence; a unit pass is not V5/V6, protected financial certification, independent review or joint acceptance.

Review the diff against the owned file list. Verify that the legacy-only output shape, frozen corpus and existing monetary expected values are unchanged; no fixture-generation tool remains; no forbidden consumer/authority/configuration path changed. Request independent exact-candidate review through the coordinating owner. Report machine, independent review and joint acceptance separately.

- [ ] **Step 10: Commit the cohesive candidate when implementation is authorized.**

Stage only the listed implementation files and commit with `feat: classify batches without changing financial plans`. The planning task itself does not commit or implement. Any repair after the exact-candidate review requires fresh review of the repaired candidate under repository conventions.

## Self-review and unresolved scope

All accepted design sections map to this single task: same evaluation/compatibility (Steps 1–3, 7), six dispositions and binding (Step 4), exact prerequisites/groups (Step 5), early exits/source blockers/final failure (Step 6), protected pins (Step 8), and bounded evidence/review (Steps 9–10). No absent financial rule was found. The correction review's two findings are explicitly tested. Runtime receipt association, scheduler progress, captured closure selection, epoch fencing, authority, durable holds and application remain later gates; none can be claimed from this companion's unit evidence.
