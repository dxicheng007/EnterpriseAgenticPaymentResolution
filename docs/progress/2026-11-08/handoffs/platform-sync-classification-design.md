# Additive batch classification and typed prerequisite design

Status: preparation only. No code, tracked file, DDL/path reservation, database operation, test run, commit or subagent. Fresh independent review required before an implementation plan. In-flight current-authority work is untouched.

## Recommendation and existing behavior

Add a pure companion `classifyBatch` to the compiler's existing batch-planning surface. It returns the exact existing PlanOutcome plus an exhaustive bounded-input classification produced by the **same evaluation**, not reconstructed from absent plan/hold IDs. Preserve `planBatch(artifact, profile, events, target):PlanOutcome` and its exact output behavior. Receipt lookup, authority/status, inbox scheduling, retries, application progress and writes stay in runtime and are not implemented here.

Sources: frozen F1 (delivery/economic identity and scope), F2/F3 (mapping, prerequisites, checked financial groups, explicit asOf), F5 (original receipts and no empty monetary receipt); PRD §§11–13; broader `platform-sync-design.md` §2. Actual producer: `packages/compiler/src/plan-batch.ts`, `operations.ts`, finance validation/allocation/reversal helpers and `packages/parent/src/state.ts`.

Observed code:

- `materialize` validates the resource/stream/schema/payload and maps only approved financial kinds. Semantic event returns null only **after** those checks. `existing_invoice_lookup` in operations.ts carries the exact source ID; dependency validation later resolves it. It does not search an external service.
- `prerequisites` currently returns only `{targetId,sourceId}`: allocation funding/invoice, or reversal original payment/credit. It is private and loses relationship/kind context when flattened into Hold.dependencies.
- `dependencyGroups` unions candidate edges **and existing allocation edges**, joining proposals sharing capacity/funding/reversals. Merely sorting by kind or mapping event IDs cannot reconstruct its actual validation groups.
- `economics` removes only sourceEventId/sourceRecordVersion from a mapped FinancialRecord before canonical comparison. Scope, identity, currency, effective time, amounts and relationships remain compared. Do not widen this exclusion.
- `validateGroup` may accept a group with no inserts because all economics already exist. It also coalesces multiple identical new economics within the same batch into a single insertion. These are two distinct cases: only the former has an existing target record and possible original receipt.
- `planBatch` sorts accepted events, emits operations/lineage only for inserted candidates, and returns no plan for all-replay input. Valid semantic input also yields no plan. Invalid envelopes can yield holds without event IDs. Exact repeated delivery occurrences are deduplicated by parseEvents. A global guard may stop classification before every event is mapped. Therefore “not mentioned in plan/holds” is not a safe replay test.

## Compatibility and authoritative limits

Recommended implementation architecture for a later plan: instrument/refactor the existing private evaluator to produce `{outcome,details}` internally; existing planBatch returns outcome, companion returns both. Do not implement a parallel materializer, second economic comparator or new financial interpreter. Compiler owner reviews any extraction; this document reserves no path/export.

Compatibility means equal plans, hashes, operations, lineage, balances, hold codes/event sets/order and early-return behavior for all existing supported inputs. New detail ordering may be defined separately, but it must not reorder the inputs or candidates used to generate existing PlanOutcome. Existing four-argument signatures, fixture expectations and preview/verification behavior remain unchanged. No new current-time dependency, database, model, receipt or authority input.

All evaluation uses target.asOf, as today. Limits remain 1,000 input records and5,000,000 cents per transaction from approved artifact. A repeated delivery occurrence still counts toward the existing input-array bound, even though it deduplicates economically. No relaxation for a dependency closure or replay-heavy batch.

F1 delivery identity remains `(sourceRef,id)` with canonical schema-parsed, hash-validated event content including observedAt and the existing IsoInstant normalization. Repeat metadata uses exactly the representation produced by current parseEvents, not pre-parse input JSON bytes; no raw-input equality guard is added. This does not change runtime capture's separate immutable-content contract. Economic identity is full `(sourceRef,sellerEntityId,kind,recordId)`, independent of versions/event IDs/account aliases. New detail does not replace runtime's global delivery/position checks or economic uniqueness across other accounts. The classifier sees only its selected target/profile and supplied bounded events; it cannot certify the whole source catalog or authority registry. In particular, financial_new means absent from this supplied scoped target, not globally novel economics; financial_replay means equivalent to this validated target record, not a verified global receipt. Global cross-account economic collisions, delivery history and original receipt authority remain runtime checks. In-batch coalescence proves neither a prior receipt nor global replay.

## Proposed additive contract

Place the function and compiler-owned in-process TypeScript result types on the existing `@eapr/compiler/plan-batch` subpath. No transport schema, shared contracts barrel leaf or package export change is needed. Types/names remain subject to independent design review, with no path reservation. The companion uses the same artifact/profile/target arguments and accepts `SourceEvent[]` statically; malformed runtime values are handled exactly as planBatch currently handles them. No caller-supplied expected classification or receipt appears.

```ts
classifyBatch(artifact:CompiledArtifact, profile:CustomerProfile,
  events:SourceEvent[], target:TargetState):BatchClassificationV1;

type BatchClassificationV1 = {
  schemaVersion:'1';
  outcome:PlanOutcome;
  details:
    | {kind:'not_classified'; reason:BatchStopReason; holdIndexes:number[]; sourceBlockers:SourceBlocker[]}
    | {
        kind:'classified'; binding:ClassificationBinding;
        items:InputClassification[];
        groups:DependencyGroupClassification[];
        sourceBlockers:SourceBlocker[];
      };
};
type ClassificationBinding = {
  artifactHash:Hash; profileHash:Hash; scope:Scope;
  expectedTargetVersion:number; targetSnapshotHash:Hash; asOf:IsoInstant;
};
```

Binding hashes the exact validated supplied target with existing hashTargetSnapshot, including version/asOf. It is a recomputation subject, not a receipt or signed authorization. Runtime still reclassifies against locked current target/epoch and exact immutable inbox. Existing PlanOutcome does not change.

`not_classified` is explicit whole-request rejection, with no financial-new/replay claim for any input. Use it for invalid artifact/binding, nonarray/overlimit input, invalid target/target scope, fatal batch conflict/source guard that aborts the legacy evaluator, or a caught FinanceError in final resultPlan (`plan_invalid`, with the exact existing outcome and its appended final hold). `reason` is a closed tag: `artifact_binding`, `input_limit`, `target_invalid`, `target_scope`, `delivery_conflict`, `source_guard`, `plan_invalid`. `holdIndexes` references the actual existing outcome.holds; codes/diagnostics remain unchanged. For an overlimit array do not allocate a second unbounded per-input response. No consumer may mark any input terminal merely because this branch has no items. This branch explicitly accounts for the whole request as unevaluated/blocked rather than pretending to have an exhaustive per-event result after an early abort.

For an ordinary bounded evaluation reaching per-event/group processing, `classified.items` has **exactly one entry for each original input index**, in ascending index order, including malformed envelopes and duplicate occurrences. Each original occurrence has exactly one final disposition. Valid unique-delivery representative is the earliest occurrence index with identical canonical **parsed, hash-validated** event content as used by parseEvents, including accepted IsoInstant normalization. Maintain a separate original-index map when private parseEvents sorts/deduplicates; do not change the planner's representative/operation choice for compatibility. Identical content makes its earliest-input representative observational metadata only.

A valid event reference is `{sourceRef,eventId,streamId,sequence,contentHash}` from its checked envelope; never invented for malformed input. Union:

- `held`: `{inputIndex, disposition:'held', event:EventRef|null, holdIndexes:number[], mapped:MappedIdentity|null, groupIndex:number|null}`. Nonempty indexes refer to existing outcome.holds that actually explain this item. Mapping-invalid or raw-invalid items have no guessed mapped identity/prerequisites. Group-invalid candidates remain held, including any otherwise equivalent-to-target member of that failed group.
- `semantic_observed`: `{inputIndex,disposition:'semantic_observed',event:EventRef,scope:Scope}`. Only selected-profile semantic events that pass source/stream/payload and unchanged-semantic checks. It means validated nonfinancial observation, **not** approval of a new revision, resolution of source drift or monetary application. Changed/unscoped revisions do not get this disposition.
- `financial_new`: `{inputIndex,disposition:'financial_new',event:EventRef,mapped:MappedIdentity,groupIndex:number,planIndex:number,operationIndex:number}`. The existing output contains this exact inserted operation. This is a proposed operation, not a committed record or successful application.
- `financial_replay`: `{inputIndex,disposition:'financial_replay',event:EventRef,mapped:MappedIdentity,groupIndex:number,existing:ExistingRecordRef}`. A validated group and exact existing target economics establish no new operation. ExistingRecordRef is `{identity:EconomicIdentity,targetRecordId:Id,sourceEventId:Id,sourceRecordVersion:number}` from the immutable original target record. **No receipt ID is supplied or inferred.**
- `financial_coalesced`: `{inputIndex,disposition:'financial_coalesced',event:EventRef,mapped:MappedIdentity,groupIndex:number,producerInputIndex:number}`. A different delivery in this same accepted group has identical economics and supplies the single new operation; producer points to its financial_new item. No prior persisted receipt exists for this candidate merely because it duplicates in-batch economics.
- `delivery_repeat`: `{inputIndex,disposition:'delivery_repeat',event:EventRef,primaryInputIndex:number}`. Only a repeated delivery occurrence with identical canonical parsed, hash-validated event content (including existing timestamp normalization); points backward to its representative non-repeat item. Consumer follows representative disposition. This is input deduplication, not proof of a committed financial replay or a second ledger event. Conflicting repeated IDs produce the existing fatal conflict path, never this disposition.

Every input index is0..length-1, unique/exhaustive. References must resolve in the same output with matching event/identity/group. `financial_new` refs match exact outcome plan/op; replay cannot point to a new operation; coalesced cannot point to replay/held/semantic; a held group cannot contain financial_new/replay/coalesced. If final resultPlan throws a caught FinanceError, return not_classified with reason plan_invalid, reference the appended final hold in holdIndexes, retain the exact existing outcome including earlier holds, and emit no items or group acceptance claims. Never emit provisional acceptance as final detail.

Existing malformed-envelope holds may have empty eventIds; track their producing input index directly during parsing. Do not match holds by ID alone: sourceRef matters, duplicate occurrences exist, and global failure holds may intentionally omit inputs. If a legacy early return prevents a reliable complete trace, return not_classified for the whole evaluation; never fill omissions with replay. Repeated malformed inputs are independent held occurrences, not delivery_repeat without a validated envelope/hash.

## Typed exact prerequisites

```ts
type MappedIdentity = {
  scope:Scope; identity:EconomicIdentity; targetRecordId:Id;
  prerequisites:TypedPrerequisite[];
};
type TypedPrerequisite = {
  relation:'allocation_funding'|'allocation_invoice'|'reversal_original';
  scope:Scope; identity:EconomicIdentity; targetRecordId:Id;
  presence:
    | {kind:'target'}
    | {kind:'candidate'; providerInputIndexes:number[]}
    | {kind:'missing'};
};
```

Construct only from a successfully materialized FinancialRecord using the same prerequisite helper as group validation. Identity sourceRef/seller match the mapped record, scope is exact selected profile, and targetRecordId equals existing targetRecordId(identity):

- Allocation funding uses `fundingKind` payment/credit and `fundingRecordId` with relation allocation_funding.
- Allocation invoice uses kind invoice and `invoiceRecordId` with relation allocation_invoice.
- Reversal original uses `reversedKind` payment/credit and `reversedRecordId` with relation reversal_original.
- Invoice/payment/credit have no prerequisites. No fabricated invoice edge for an unallocated payment. No unsupported invoice/partial/reversal-of-reversal operation is made representable by this DTO.

Sort prerequisite array by relation then canonical identity; duplicates of same relation/identity forbidden. providerInputIndexes is sorted unique and includes representatives only. Target presence takes precedence if exact target record already exists. Candidate presence means successfully materialized same-target-identity input exists in this batch—not that provider passed financial validation. A provider can belong to a held/conflicting group; consumers must inspect its final group result. Missing means not present in target or materialized candidates in **this invocation**, not absent from source or durable inbox. Unknown/foreign-account events do not become providers for the selected scope.

Typed prerequisites may appear on held materialized candidates, including DEPENDENCY_MISSING and economic/financial group failures, so runtime can find later exact prerequisite events. Mapping failure produces mapped:null; never derive a monetary relationship from an unvalidated arbitrary payload. This design does not return a new FinancialMutation for a held candidate.

Current Hold.dependencies stays unchanged for compatibility; it remains a human/diagnostic source-ID list and is not sufficient as the scheduler's typed key. The additive metadata supplies scope/kind/identity needed to avoid invoice and payment IDs colliding or crossing customers. Existing source IDs do not imply globally unique event IDs.

## Dependency groups and scope holds

Proposed group shape:

```ts
type DependencyGroupClassification = {
  inputIndexes:number[];
  disposition:'accepted'|'held';
  holdIndexes:number[];
};
type SourceBlocker = {
  sourceRef:Id;
  code:'IDENTITY_SCOPE'|'SEMANTIC_VERSION';
  causingInputIndexes:number[];
};
```

Group indexes correspond to existing dependencyGroups result order; members are representative materialized candidates, sorted by input index for trace readability. Accepted all-replay groups exist even with outcome.plans empty. Held groups identify existing validator holds. Existing allocation edges must continue to merge candidates competing for funding or invoice capacity; do not split groups into independent event-by-event approvals. Group partition contains financial materialized representatives only; other disposition entries have no group.

When the current unscoped-source guard aborts the entire call, `details.kind` is not_classified/source_guard. The source guard's triggering sourceRef and exact causing inputs are returned in the bounded `sourceBlockers` field already defined on that branch, empty for all other stop reasons. This is narrow metadata about the current existing guard, not an invented new stopping rule. Causes are same-source/company missing seller, or unscoped governing semantic change as the actual planner tests. Ordinary out-of-source input is not promoted to a blocker for an unrelated source.

Existing Hold.scope is authoritative where present. Per-item event reference preserves access to immutable raw identity. UNKNOWN_ACCOUNT means no approved identity **in this selected profile**; it does not establish that no other activated profile exists. Foreign seller/source/company IDENTITY_SCOPE likewise means not usable by this profile unless it is an explicit sourceBlocker. Runtime must route/check all enrolled profiles using trusted identity before declaring a globally unknown account. A known independent customer must not be stopped merely because it appears in another profile's classification call.

Do not attach an invented approved scope to unknown raw identity. Runtime can distinguish selected-scope held inputs, raw-identity unresolved inputs and the explicit source-wide blockers; existing event stream/resource identifies a schema-mapping diagnostic. This companion does not choose persistence status names, retry/quarantine state, stream-wide pause commands or active authority status.

## Consumer rules for later runtime gate

1. Classify exact immutable bounded inbox selection and exact approved artifact/profile against one explicit target/asOf. A not_classified response is a whole-request block, never a successful empty cycle. Runtime still verifies current grant/epoch and global identities transactionally.
2. Financial replay points to an original target record; runtime must look up its authoritative initial-or-ongoing economic receipt association. Missing/corrupt receipt association is a runtime consistency failure, not permission to invent a zero-effect receipt. The classifier is not given database receipts.
3. All-replay input can now be recognized from accepted replay items plus delivery_repeat references and no new/coalesced operations. Return original receipt associations in later cycle output, as F5 requires; do not call applyBatch on an empty group.
4. Mixed new/replay input uses existing plan.eventIds and operations unchanged. Coalesced deliveries acknowledge the new group's future receipt; replayed economics preserve originals. Runtime—not compiler—implements F5 association rules and crash recovery.
5. For a selected held dependency group, inspect typed missing keys, look up already captured exact prerequisite candidates across streams and reclassify the bounded closure. Candidate presence is not validity. Do not let unrelated later same-customer monetary work jump the hold; independent known accounts may continue. These scheduler rules are specified in PRD, but this document implements no scheduler or cursor update.
6. Enforce the existing1,000-record bound for the entire proposed invocation including prerequisites/replay occurrences; never split a financially coupled group just to fit. A larger closure remains explicit held/unavailable work for the later runtime design. No retry-count or cycle policy is frozen here.
7. Semantic observed and receipt-less malformed/unknown holds cannot advance financial application as if imported. Application frontier and source/scope exclusion rules remain a later persistence contract. Captured source-level evidence is not customer enrollment.

## Required future verification (not performed)

- Exact planBatch compatibility over existing compiler fixtures and randomized input permutations where supported: plan/hash/lineage/holds preserved; no mutated inputs or implicit time.
- All-target-replay yields explicit replay refs and no plan; original event/version preserved in existing reference; changed amount/currency/relationships/effectiveAt under same identity holds.
- Different new deliveries with identical economics yield exactly one financial_new plus financial_coalesced, not an existing-target replay. Mixed existing/new/coalesced correctly partitions accepted event IDs; all-replay groups mixed with independent new groups remain identifiable.
- Identical parsed repeated delivery occurrences are exhaustively delivery_repeat-linked. Equivalent accepted timestamp spellings such as `...00Z` and `...00.000Z`, both carrying the hash of the normalized event, remain deduplicated exactly as planBatch and produce delivery_repeat metadata. A genuinely changed observation instant with recomputed hash under the same delivery remains legacy delivery conflict; no raw-input comparison changes that behavior. Invalid envelopes and bad hashes are held or globally blocked according to existing behavior, with no phantom event identity.
- Valid semantic event no-plan is semantic_observed; changed semantic is held/source guard as applicable; schema-invalid semantic is not observed. Unknown selected-profile account not asserted globally unknown; unscoped governing source blocker distinct from foreign mapped customer.
- Allocation funding/invoice and reversal-original typed refs derive exact kind/seller/source/scope/target IDs. Identical recordId across invoice/payment/customer does not merge prerequisites. Missing invoice holds then later exact provider permits existing validated behavior; provider held/conflicting remains unusable.
- Existing allocation edges preserve connected group validation and capacity/reversal coupling. Unsupported reversal/over-allocation/unallocated funding behavior unchanged. No guessed payment-to-invoice edge.
- Fatal artifact/target/scope/source/delivery failures return explicit not_classified, no accepted replay/new entries. Specifically a caught final resultPlan FinanceError returns plan_invalid with exact legacy no-plans outcome, earlier holds plus appended final hold, and no items/groups; holdIndexes references that final hold. Normal bounded classified response covers each input index exactly once with valid references and group/result invariants. Overlimit/nonarray requests produce bounded rejection output.
- Future runtime tests, outside this gate: original receipt lookup failures, mixed receipt association, revoked epoch, scheduler progress, durable holds and no new money across versions. Classifier unit tests cannot certify those behaviors.

## Ownership and remaining questions

Future owner is compiler/platform integrity; companion function/types are additive exports on the existing plan-batch subpath, reviewed before assignment. A small same-evaluation trace extraction is preferable to a second planner; preserve existing consumer signature. Existing compiler source changes continue to affect protected build pins. If shared private evaluation is extracted to a new compiler leaf, update both protected evaluator build-closure inventories and mutation/recursive-coverage tests so it is pinned; no expected monetary answer changes. Current authority implementation files, capture, parent persistence and runtime SQL are outside this preparation.

No genuinely absent financial rule was found. The output placement is settled as compiler-owned in-process types/function on the existing plan-batch subpath; no new transport/shared schema is proposed. Early-abort granularity is settled as bounded whole-request not_classified, including final plan_invalid, rather than pretending every aborted input was financially classified. These corrected technical choices still require independent review before a plan; neither calls for a product-policy default. Source-wide versus selected-profile unknown identity remains a runtime routing fact, not a new compiler enrollment rule. No code path or DDL reservation is made.
