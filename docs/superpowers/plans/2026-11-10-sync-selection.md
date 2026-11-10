# Bounded Read-only Sync Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inspect one bounded persisted source cut and propose each genuinely enrolled customer's earliest complete financial group, retaining every unresolved routing, mapping, semantic and dependency blocker without changing runtime state.

**Architecture:** A SELECT-only adapter detaches validated catalog, capture, target and original-history facts from one PostgreSQL repeatable-read snapshot. Pure selection first validates source contracts before routing, then uses the accepted compiler for source guards, complete financial grouping, typed prerequisites and selected-group reclassification. Proposals carry deterministic explanatory witnesses and are never accepted as P1 application authority.

**Tech Stack:** Node 24, strict TypeScript, PostgreSQL 18, `pg`, existing Zod/canonical helpers, Vitest; no new dependency.

**Spec:** [accepted Phase A design](../../progress/2026-11-10/sync-selection-design.md), SHA-256 `0f01668bffbfe799ba38f940781d6e1a2e37e6b6a6a4585ede7095c8db1b3b6d`; [initial review](../../progress/2026-11-10/sync-selection-design-review.md), [accepted fix review](../../progress/2026-11-10/sync-selection-design-fix1-review.md), [coordination scope audit](../../progress/2026-11-10/sync-coordination-scope-audit.md).

## Global Constraints

- “A proposal is neither permission to apply nor evidence that anything was applied.”
- “The compiler owns mapping, economic equality, financial groups, typed prerequisites and validation.”
- “No Phase A result is an input accepted by the P1 writer.”
- “Any structural incompleteness produces zero proposals globally.”
- “A profile merely present in a multi-profile bundle is not enrolled; the exact committed activation/request must select it.”
- “Read paused/revoked subjects too so they cannot become falsely unknown; their own proposals are blocked by observed inactive authority.”
- “Classification runs after the bounded immutable data is detached and the read transaction ends.”
- “No helper may acquire write locks, initialize rows, publish activity, open a second connection or fetch another service.”
- “No local copy of its field traversal, decimal/date parsing, mapping, economic comparison or financial interpreter is permitted.”
- “No client-provided witness can be trusted by a future writer.”
- No outcomes, receipts, heads, durable pending/quarantine, examinations, claims, activity, authority, migration, provider, scheduler, CSV handling, HTTP/composition, model or generated-account authority. Do not change compiler/planner behavior or P1's restrictions.
- Keep expected truth, existing protected fixtures, canonical generators and `tests/fixtures/activation-proof.ts` immutable. New fixture originals and independent expected inputs must be authored once before publication, never rewritten to match a candidate.
- Operational ceilings are fixed here: 8 committed subjects, 8 lanes, 32 total lane-stream definitions, 1,000 distinct post-baseline deliveries, 1,000 rows per evidence family, 10,000 target financial/metadata records per subject, 1,048,576 bytes per canonical value, 16,777,216 total canonical-input/diagnostic bytes, 8,000 contract observations. The stricter committed/compiler maximum applies; a classifier invocation includes semantic events and repeated occurrences within 1,000, and transactions remain at most 5,000,000 cents. Overflow never truncates into a proposal.
- Use `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, a 2,000 ms local statement timeout and a 5,000 ms application transaction deadline. These are admission limits, not financial policy or freshness guarantees.

## Review Focus

1. Unknown-account payload drift must block every consumer of the failed approved binding before routing; a structurally valid unknown account must still allow independent work. Task 2 and Task 9 pin both directions.
2. Inactive or merely bundled profiles must not become either newly enrolled or falsely unknown. Tasks 1, 3, 5 and 9 pin exact committed identity and inactive observations.
3. A later apparent prerequisite may be a wrong-kind, foreign-scope, held or conflicting provider; capacity/reversal coupling must not disappear through singleton planning. Task 4 pins these cases.
4. Old approval baselines, orphan capture membership and transitive receipt history must not vanish behind a convenient lane or a byte/row limit. Tasks 5–7 pin complete reads and fail-closed bounds.
5. Concurrent capture/status/target commits may make a cut stale but must never mix snapshots or mutate any durable state. Tasks 8–9 pin coherent cuts, deterministic witnesses, deadlines and zero writes.

---

## Status, release gates and paths

This is a document-only implementation candidate, not a source release. It was reconciled with accepted P1 storage `7af5d8ace77a087529c05bada4c8da48f7b4a0d2`, coverage `7161d6ebd31c124848d4fbff2642adb61fde51f1`, and writer `a20054ae66a9d7d3fdff6d1bd1a386ef08a9c0c6`. Read their [storage report](../../progress/2026-11-10/sync-apply-storage-report.md), [original storage review](../../progress/2026-11-10/sync-apply-storage-review.md), [storage repair review](../../progress/2026-11-10/sync-apply-storage-round1-review.md), [coverage report](../../progress/2026-11-10/sync-apply-coverage-report.md)/[review](../../progress/2026-11-10/sync-apply-coverage-review.md), and [writer report](../../progress/2026-11-10/sync-apply-writer-report.md)/[review](../../progress/2026-11-10/sync-apply-writer-review.md). The original storage review requested changes; the round-one review closes that finding. P1 Task 4 and whole-candidate acceptance remain pending. Root must reconcile their final interfaces and exact candidate before releasing source work.

Root's planning rulings add only two narrow paths to the design's original four. Both require fresh plan review and explicit source reservation before implementation:

| Path | Responsibility |
| --- | --- |
| `apps/worker/src/sync/selection.ts` (new) | Internal DTOs, pure contract guard, routing, compiler-owned closure, selection and witness construction. |
| `apps/worker/src/sync/selection-read.ts` (new) | Bounded SELECTs, canonical/index validation, one-client snapshot lifetime and internal `createSyncSelector`. |
| `apps/worker/test/sync-selection.test.ts` (new) | Pure behavior and defensive compiler-output checks. |
| `tests/integration/sync-selection.test.ts` (new) | Genuine enrollment/capture, read bounds/history, coherent snapshots and zero writes. |
| `apps/worker/src/sync/current-authority-store.ts` (minimal additive edit) | Export the existing unlocked resolver on a caller-owned client; preserve existing pool reader behavior. |
| `tests/fixtures/sync-selection.ts` (conditional new test-only helper) | Genuine independently authored multi-subject fixtures, only after the feasibility gate below; no protected producer changes. |

All existing source/compiler/finance/contracts/parent/capture/P1 helpers, migrations, composition and other fixtures remain read-only. Do not add a fixture/export/path opportunistically. Root owns source/DB leases, review dispatch and release. Pure tests use real compiler output and public synthetic data; they cannot satisfy genuine enrollment integration requirements.

### Exact fixture dependency, not an implementation recipe

`createSyncApplyFixture(runtimeThrough?, baselineVersion?)` activates one fixed A subject. `captureApplyEvents` fixes `a-finance`. The private `preparePeerSubject` and `activateSubjects` in `tests/integration/sync-capture.test.ts` demonstrate the real producer/reviewer path, but their `generateSecondQualifyingAccount` rewrites `expected-a.json` and `evidence-a.json`; do not copy that setup. `current-authority.test.ts` and `v3-activation.test.ts` activate fixed A and B, which is insufficient for same-source independent enrollment and API-only cross-stream proof.

An unchanged source seam exists: `captureEvidenceFixture(dependencies, roots, company, source?: SourceDefinition)` accepts a custom definition, and `createSourceService(dependencies, catalog)` accepts its catalog. However, `packages/evaluator/src/evidence-fixtures.ts:203–210` selects only fixed `companyA`/`companyB` and rejects manifest streams outside their fixed set. Company A has only `a-finance` and `a-semantics`; Company B contains CSV. Therefore a new API-only financial stream cannot currently receive the required genuine producer-backed approval through unchanged verification. `evidence-support.ts` also derives supported resource mappings from fixed company/kind names; a separate unaffected financial feed/resource requires its own feasibility check.

Discovery/source must first release the reviewed stream/schema contract; Platform coordinates the protected evaluator admission dependency. This plan grants no evaluator, source definition or protected build-inventory changes. Do not relabel a semantic stream financial, ignore B's CSV, modify an approved manifest, or insert completed approvals with an owner role. The cross-stream and separate-feed integration cases remain mandatory and blocked until that dependency is released; they are not skips in a passing gate.

The reserved new helper may establish same-feed peers by authoring literal independent original records, agreement PDFs and producer inputs once, passing unchanged source capture, compiler registration, financial probe/reservation/launch/completion, bootstrap verification, scope/policy publication, authenticated reviewer prepare/activate, and worker first import. Confirm that route works with unchanged expected inputs before releasing the helper as a consumer interface. Its proposed minimum interface is `createSyncSelectionFixture(): Promise<{ db: Pool; close(): Promise<void>; subjects: { identity: CommittedAuthorityIdentityV1; stored: StoredActivation }[]; capture(identity: CommittedAuthorityIdentityV1, page: ChangePage): Promise<CaptureResultV1> }>`; it is not an existing export. Capture calls accepted `openCommitted`/`capturePage` and never fabricates runtime capture rows. No implementer may claim fixture feasibility from this signature alone.

## Interfaces and representation decisions

Use existing `CommittedAuthorityIdentityV1`, `CurrentAuthorityV1`, `CaptureLaneV1`, `RawSourceEvent`, `SourceContract`, `MutationPlan`, `Id`, `Hash`, `IsoInstant`, `Scope`, `EconomicIdentity` from contracts. Use existing compiler `EventRef`, `ClassificationBinding`, `TypedPrerequisite`, `InputClassification`, `BatchClassificationV1`; use parent `ReceiptOrigin`, `SyncUnitAudit`, `SyncEventOutcome`, `CoverageCut`, `StoredActivation`, `StoredTarget`. Reuse `syncEventRef`; do not redefine receipt origin or activation identity. `CoverageCut` may supply existing row types, but its strict single-stream schema is not the new selection-cut schema.

Existing consumed signatures:

- `validateSourcePayload(contract: SourceContract, event: RawSourceEvent): void`; `MappingError` exposes `code: string`, `path: string`. Import from `@eapr/compiler/operations`.
- `classifyBatch(artifact: CompiledArtifact, profile: CustomerProfile, inputs: SourceEvent[], target: TargetState): BatchClassificationV1` and `planBatch(...)` on `@eapr/compiler/plan-batch`. Explicit inspection `asOf` is supplied by copying target with that `asOf`; preserve stored version/hash separately.
- `compareInbox(left: {eventId: string; streamId: string; sequence: number}, right: same): number`; `dependencyOrder(items: InputClassification[]): number[]` from `./dependencies.js`. Do not use retry/examination constants or bare `missingPrerequisites` output as typed proof.
- `readStoredActivation(client: PoolClient, scope: Scope): Promise<StoredActivation | null>` and `readStoredTarget(client: PoolClient, scope: Scope, snapshotHash?: string): Promise<StoredTarget | null>`.
- `readSyncUnit(client: PoolClient, identity: CommittedAuthorityIdentityV1, unitHash: string): Promise<SyncUnitAudit | null>` and `readFinancialOrigins(client: PoolClient, scope: Scope, records: readonly FinancialRecord[]): Promise<ReceiptOrigin[]>` on `@eapr/parent/sync-store`.
- `readCaptureLane(client: PoolClient, lane: CaptureLaneV1): Promise<CaptureBinding | null>` from `./capture-store.js`; its private `CaptureBinding` is `{manifest: BootstrapManifest; capture: CaptureStream[]; manifestDigest: string; captureDigest: string; initialActivationId: string; initializedAt: string}`. Use `NonNullable<Awaited<ReturnType<typeof readCaptureLane>>>` to consume this exact inferred type without a new export. Preflight its canonical byte sizes before calling it; the return value has no `lane` wrapper.

Freeze these new internal function boundaries in their owning tasks:

```ts
type SelectionInput = { sourceRef: Id; asOf: IsoInstant };
type SelectionSubject = {
  identity: CommittedAuthorityIdentityV1; stored: StoredActivation;
  authority: CurrentAuthorityV1; target: StoredTarget; origins: ReceiptOrigin[];
  units: SyncUnitAudit[]; outcomes: SyncEventOutcome[];
  heads: CoverageCut['applicationHeads'];
};
type ContractBinding = {
  sourceRef: Id; companyId: Id; streamId: Id; resource: Id; sourceContractHash: Hash;
};
type ContractConsumer = { identity: CommittedAuthorityIdentityV1; artifactHash: Hash };
type ContractCheck = {
  event: RawSourceEvent; binding: ContractBinding; contract: SourceContract;
  consumers: ContractConsumer[];
};
type ContractObservation = {
  event: EventRef; binding: ContractBinding; consumers: ContractConsumer[];
} & (
  | { result: 'passed' }
  | { result: 'mapping_blocked'; code: 'schema_mapping'; origin: 'envelope';
      failures: { field: '/resource' | '/streamId' | '/kind' | '/schemaVersion'; expected: Id }[] }
  | { result: 'mapping_blocked'; code: 'schema_mapping'; origin: 'compiler_payload';
      compilerCode: 'SOURCE_SCHEMA'; path: string }
  | { result: 'unexamined'; compilerCode: string | null; path: string | null }
);
type ContractGuardResult = {
  sourceContractChecksComplete: boolean; observations: ContractObservation[];
  blockedConsumers: ContractConsumer[];
  incompleteReason: 'source_contract_validation' | 'limit' | null;
};
```

Envelope expected kind/schema values come from `contract`; stream/resource from the binding. Unexpected validator failures record null compiler diagnostic fields, not exception prose. The design's `SourceContractObservation` is named `ContractObservation` internally; serialized meaning is unchanged.

`SelectionInspectionV1`, `ProposedGroup`, `SelectionBlocker`, `RouteObservation`, `DependencyWitness`, `SelectionWitness`, and `CutSummary` implement the design's result/witness fields exactly. `IncompleteReason` is the closed union `limit | timeout | unsupported_transport | uninitialized_capture | uncovered_stream | unknown_source_binding | unsupported_history | source_contract_validation | no_committed_subjects`. Errors are `SELECTION_INPUT_INVALID`, `SELECTION_STORAGE_INVALID`, `SELECTION_UNAVAILABLE`, with only fixed safe text. Classifier failures retain real hold codes/reasons; a selector label `classifier_blocked` may identify a `not_classified` result without changing its meaning.

The detached internal `SelectionCut` consists of `{ input: SelectionInput; subjects: SelectionSubject[]; lanes: SelectionLane[]; deliveries: {event: RawSourceEvent; digest: Hash}[]; globalClaims: GlobalClaim[]; evidence: SelectionEvidence[] }`. A `SelectionLane` has `{lane: CaptureLaneV1; binding: NonNullable<Awaited<ReturnType<typeof readCaptureLane>>>; checkpoints: CoverageCut['checkpoints']; positions: CoverageCut['positions']; inbox: CoverageCut['inbox']; pages: {page: ChangePage; digest: Hash; capturedAt: IsoInstant}[]; incidents: {incidentHash: Hash; streamId: Id; summary: CaptureIncidentSummaryV1}[]}`. A `GlobalClaim` is `{scope: Scope; identity: EconomicIdentity; targetRecordId: Id; record: FinancialRecord; origin: ReceiptOrigin}`. A `SelectionEvidence` is a strict immutable reference `{family: EvidenceFamily; key: string[]; digest: Hash; bytes: number}`; keys use each existing table's full primary/unique key, never bare event IDs. `EvidenceFamily` is a closed union of `import | authority | target | lane | checkpoint | position | delivery | page | inbox | incident | unit | outcome | origin | receipt | financial | metadata | application_head`. This is an internal reference inventory, not an externally accepted proof.

`CutSummary` contains `{ counts: Partial<Record<EvidenceFamily, number>>; canonicalBytes: number; sourceContractChecksComplete: boolean; sourceContractObservations: ContractObservation[]; causes: {reason: IncompleteReason; identity: CommittedAuthorityIdentityV1 | null; lane: CaptureLaneV1 | null; streamId: Id | null; event: EventRef | null; family: EvidenceFamily | null}[] }`. Causes name the exact affected subject/lane/stream for `uncovered_stream`, and the rejected family for bounds; unavailable fields are null, never guessed. Counts describe rows actually bounded/observed, including the overflow sentinel when present, not estimated total source counts. Empty catalog returns the design's explicit incomplete result with empty proposals/blockers/routes. `SelectionReadResult` is `{kind: 'ready'; cut: SelectionCut} | {kind: 'incomplete'; reason: IncompleteReason; boundedFacts: CutSummary}`. Private catalog/capture functions may share local types, but no intermediate partial read may be cast to a ready cut.

The remaining result types are owned by `selection.ts` and introduced alongside the first task that returns them. All arrays below have deterministic declared ordering and are strict decoded internal DTOs. `RawIdentity`, `Hold`, `Cursor` come from contracts; `BatchStopReason` comes from the compiler.

```ts
type BlockerCode = 'source_identity' | 'source_semantics' | 'schema_mapping' |
  'unknown_account' | 'ambiguous_mapping' | 'inactive_authority' | 'dependency_missing' |
  'dependency_invalid' | 'dependency_cycle' | 'group_limit' | 'earlier_hold' |
  'global_economic_conflict' | 'capture_incident_unresolved' | 'classifier_blocked';
type SelectionBlocker = {
  level: 'source' | 'mapping' | 'subject' | 'raw_identity'; code: BlockerCode;
  identities: CommittedAuthorityIdentityV1[]; rawIdentity: RawIdentity | null;
  events: EventRef[]; incidentRefs: SelectionEvidence[]; bindings: ContractBinding[];
  missing: TypedPrerequisite[]; compilerHolds: Hold[];
  classifierStopReason: BatchStopReason | null;
};
type RouteObservation = {
  event: EventRef; rawIdentity: RawIdentity;
  disposition: 'known' | 'unknown_account' | 'source_identity' |
    'ambiguous_mapping' | 'unknown_source_binding';
  identities: CommittedAuthorityIdentityV1[];
  applicability: { identity: CommittedAuthorityIdentityV1; lane: CaptureLaneV1;
    baselineCursor: Cursor | null; captureCursor: Cursor | null; applicable: boolean }[];
};
type DependencyWitness = {
  consumer: EventRef; prerequisite: TypedPrerequisite;
  resolution: { kind: 'target'; record: FinancialRecord; origin: ReceiptOrigin } |
    { kind: 'candidate'; providers: {event: EventRef; group: EventRef[]}[] } |
    { kind: 'missing'; mappedIndexHash: Hash };
};
type ProposedGroup = {
  identity: CommittedAuthorityIdentityV1; observedEpoch: number;
  targetVersion: number; targetSnapshotHash: Hash; seed: EventRef;
  members: EventRef[]; orderedMembers: EventRef[];
  classifierBinding: ClassificationBinding; dependencies: DependencyWitness[];
  plan: MutationPlan | null; replayOrigins: ReceiptOrigin[]; witnessHash: Hash;
};
type SelectionWitnessPreimage = {
  schemaVersion: '1'; sourceRef: Id; asOf: IsoInstant;
  subjects: { identity: CommittedAuthorityIdentityV1; artifactHash: Hash;
    profileHash: Hash; bundleHash: Hash; manifestHash: Hash;
    authority: CurrentAuthorityV1; targetVersion: number; targetSnapshotHash: Hash;
    acknowledgments: SyncEventOutcome[]; origins: ReceiptOrigin[] }[];
  lanes: { lane: CaptureLaneV1; manifestDigest: Hash; captureDigest: Hash;
    checkpoints: CoverageCut['checkpoints']; pages: { sourceRef: Id; streamId: Id;
      after: Cursor; next: Cursor; digest: Hash; members: EventRef[] }[] }[];
  evidence: SelectionEvidence[]; routes: RouteObservation[];
  sourceContractChecksComplete: true; sourceContractObservations: ContractObservation[];
  sourceGuards: {identity: CommittedAuthorityIdentityV1; classification: BatchClassificationV1}[];
  classifications: {identity: CommittedAuthorityIdentityV1;
    full: BatchClassificationV1 | null; selected: BatchClassificationV1 | null}[];
  groups: Omit<ProposedGroup, 'witnessHash'>[];
};
type SelectionWitness = { preimage: SelectionWitnessPreimage; hash: Hash };
type SelectionInspectionV1 = {
  schemaVersion: '1'; sourceRef: Id; asOf: IsoInstant;
  coverage: {kind: 'complete_captured_cut'; witness: SelectionWitness} |
    {kind: 'incomplete'; reason: IncompleteReason; boundedFacts: CutSummary};
  proposals: ProposedGroup[]; blockers: SelectionBlocker[]; routes: RouteObservation[];
};
```

Hash the exact `SelectionWitnessPreimage` with `hashCanonical`; hash each proposal using `{cutWitnessHash: witness.hash, group}` where `group` is its exact `Omit<ProposedGroup, 'witnessHash'>`. Sort subjects/consumers by canonical committed identity; bindings by canonical binding; events/routes by `compareInbox` then source reference; evidence by family/full key; lanes by source/manifest and streams by ID; origins by record ID then receipt ID. Preserve classifier item/group/plan/lineage order, topological `orderedMembers`, and full dependency relation/provider sets. The full-source guard result from Task 3 also belongs in classifier evidence: retain it separately from Task 4's unfinished-corpus result in the preimage's `sourceGuards` field. Do not overwrite one classification with the other. Unknown routes have empty identities and null-approved-scope semantics; raw blockers never carry a fabricated Scope. An incomplete result always has `proposals: []` regardless of any intermediate successful group.

## Task 1: Reuse authority observation inside the selector snapshot

**Files:** minimally modify `apps/worker/src/sync/current-authority-store.ts`; create the authority-read cases in `tests/integration/sync-selection.test.ts`.

**Consumes:** existing private `resolveSnapshot(client, identity, key, lock): Promise<AuthoritySnapshot>` and exported `AuthoritySnapshot`; genuine single-subject fixture/current-authority service, read-only.

**Produces:** `readAuthoritySnapshotInTransaction(client: PoolClient, input: CommittedAuthorityIdentityV1): Promise<AuthoritySnapshot>`. Parse the identity with the existing schema, then invoke `resolveSnapshot(client, identity, undefined, false)`. It owns neither transaction nor connection and must preserve inactive states. The existing `readAuthoritySnapshot(db, input, key?)` remains unchanged.

- [ ] Add `authority_same_client`, `authority_inactive_recognition`, and `authority_missing_head_with_history`. Open one caller-owned repeatable-read transaction, read genuine A5 authority, pause/revoke outside it through the real service, and assert repeated reads retain the first snapshot; a fresh transaction sees the new epoch/status. A missing head with existing commands is storage-invalid, never initial active.
- [ ] Run `npm run test:integration -- tests/integration/sync-selection.test.ts -t 'authority_'`. Once the additive export compiles, retain a behavioral failure (for example the minimal stub returns the initial state after pause); missing-import failure alone does not count.
- [ ] Implement the delegation above only. Assert through a test client wrapper that it neither connects, commits, locks, initializes a head nor emits activity.
- [ ] Repeat the focused command and `npm run typecheck`; require selected tests pass. Commit only owned paths as `refactor: expose caller-owned authority snapshot reads`; send exact candidate for fresh review.

## Task 2: Validate every applicable contract before account filtering

**Files:** create `selection.ts` and `apps/worker/test/sync-selection.test.ts`.

**Consumes:** accepted validator and `ContractCheck[]` built only from verified bindings; pure unit data is not an enrollment claim.

**Produces:** `checkSourceContracts(checks: readonly ContractCheck[]): ContractGuardResult` and the contract types above. No injected production validator or alternative parser.

- [ ] Add `guard_payload_drift` table cases: known A/unknown `raw-new` crossed with renamed `amount -> gross_amount`/missing `amount`, unchanged schema. Assert `SOURCE_SCHEMA`, actual `/payload` or `/amount`, exact event/binding, sorted A+B consumers and no successful check for that pair. Add changed type, material enum, payload/envelope identity mismatch and each envelope field mismatch.
- [ ] Add `guard_positive_controls`: valid unknown passes; two distinct contracts on the same feed are checked independently; a failed A+B binding does not mark an unrelated C binding failed. Add paused/revoked and acknowledged post-baseline rows to the check input and assert they are still checked.
- [ ] Add `guard_unexamined`: accepted money/date early errors preceding a later missing structural field yield actual code/path, incomplete status and no complete structure assertion. An unexpected thrown error or unavailable validator seam yields unexamined/null diagnostics. Use test-only module mocking to exercise unavailable/throwing seam; do not add runtime injection options. Assert 8,001 observations or excess diagnostic bytes produces `limit`, deterministic sorted checks, and no raw messages/payload values in observations.
- [ ] Run `npm run test:unit -- apps/worker/test/sync-selection.test.ts -t 'guard_'`; first observe an assertion failure after minimal compilable scaffolding. Implement envelope predicates then call the imported original validator exactly once per distinct applicable event/binding. Preserve its first actual diagnostic; deduplicate equal bindings and consumers, never distinct contract hashes.
- [ ] Repeat that command plus `npm run test:unit -- packages/compiler/test`; compare ordinary `planBatch`/`classifyBatch` outcomes before/after guard invocation. Commit `feat: guard captured payloads before sync routing` after focused review.

## Task 3: Route exact enrolled identities and preserve source guards

**Files:** `selection.ts`, `apps/worker/test/sync-selection.test.ts`.

**Consumes:** ready `SelectionCut`, accepted contract guard, compiler `classifyBatch` and `selectedProfile(stored.bundle): CustomerProfile`.

**Produces:** `routeSelectionCut(cut: SelectionCut): { routes: RouteObservation[]; guard: ContractGuardResult; blockers: SelectionBlocker[]; classifications: {identity: CommittedAuthorityIdentityV1; full: BatchClassificationV1}[]; incompleteReason: IncompleteReason | null }`. The full result in this stage records the source-guard pass; Task 4 separately classifies unfinished routed financial work. Routes retain full delivery reference, original raw tuple, exact matched identities and per-subject baseline/cut applicability.

- [ ] Add `routing_exact_catalog`: two separately selected subjects, unselected bundled profile, valid unknown raw account, unrecognized company/seller, missing seller, conflicting matches, empty catalog and paused/revoked subject. Assert one route per distinct full delivery, no Scope on unknown input, exact mapped inactive route, source-wide versus mapping/subject/raw levels, and explicit empty-enrollment incompleteness.
- [ ] Add `routing_guards_before_filtering`: unknown drift blocks A+B consumers while valid unknown allows B; an affected subject cannot escape through another resource; genuine source-wide blockers override all proposals. Validate full applicable corpus before selecting account input. Prior-to-baseline semantics are baseline evidence; changed-then-return after baseline remains a hold; unscoped change stops the source and unchanged semantics stays nonfinancial.
- [ ] Run `npm run test:unit -- apps/worker/test/sync-selection.test.ts -t 'routing_'` and observe behavioral red. Implement exact `(sourceRef, companyId, sellerEntityId, sourceAccountId)` routing from committed selected profiles, distinct-binding applicability joins, and accepted full-source classifier guards. Foreign-profile ordinary `UNKNOWN_ACCOUNT` must not overwrite another subject's exact route.
- [ ] Repeat focused tests and typecheck. Commit `feat: route captured work through committed profiles` after review. Synthetic multi-subject unit inputs establish pure routing only; Task 9 still requires genuine enrollment.

## Task 4: Select one complete earliest compiler group

**Files:** `selection.ts`, `apps/worker/test/sync-selection.test.ts`.

**Consumes:** Task 3 route/guard result, subject history/origins/global claims, accepted classifier and dependency helpers.

**Produces:** `selectSubjectGroup(cut: SelectionCut, identity: CommittedAuthorityIdentityV1, routed: ReturnType<typeof routeSelectionCut>): { proposal: Omit<ProposedGroup, 'witnessHash'> | null; blockers: SelectionBlocker[]; full: BatchClassificationV1 | null; selected: BatchClassificationV1 | null }`.

- [ ] Add `closure_earliest`: baseline vector `a-ledger:10,a-invoices:20,a-semantics:2`, existing payment `pay-1=700`, origin `receipt-A0`, allocation `alloc-1=500` at ledger 11 requiring missing `inv-9`, unrelated payment 200 at 12. First result holds A and does not propose its later payment. Adding invoice `inv-9=900` at invoices 21 selects exactly invoice+allocation, orders invoice first, retains payment origin and plans invoice balance 400. This is pure cross-stream behavior until the producer gate is released.
- [ ] Add `closure_typed_providers`: wrong kind sharing `inv-9`, foreign Scope/source/seller, unknown route, `mapped:null`, mapped held provider, conflicting representatives, accepted identical coalescence, and unallocated funding with no fabricated invoice dependency. Retain all representatives and group memberships; never select a winner by ID alone.
- [ ] Add `closure_coupling`: allocations sharing capacity plus reversal, including existing allocation edges, stay whole; a tempting passing subset is not proposed. Add nonclassified output, exhaustive index mismatches, absent/duplicate provider indexes and synthetic cycle metadata. Mark adversarial classifier-output fixtures as defensive seam tests, not realizable DSL cycles.
- [ ] Add `closure_replay_and_limits`: initial+ongoing replay originals, nonempty all-replay null plan, candidate coalescence without an invented receipt, foreign-scope global claim, missing/corrupt origin, approved smaller limit and 1,001 total invocation inputs including semantics/repetitions. Assert zero plan slicing or partial closure and no second proposal for a subject.
- [ ] Run `npm run test:unit -- apps/worker/test/sync-selection.test.ts -t 'closure_'`; observe behavioral red before implementation. Classify the entire unfinished routed financial corpus plus applicable semantic history. Use only compiler mapped keys `(canonical Scope, EconomicIdentity, targetRecordId)` and full groups. Verify every typed target/candidate/missing edge; contradictory missing-vs-index metadata is storage/consistency failure. `dependencyOrder` produces explanatory member order only.
- [ ] Reclassify exactly the complete selected closure plus applicable semantic guards, with the same target/version/asOf. Require one complete accepted financial group, exact references/plan/lineage, or accepted nonempty all-replay. Preserve final classifier metadata, typed dependency witnesses and origin references. Run focused selection/compiler/finance tests and typecheck; commit `feat: select complete earliest sync dependency groups` after review.

## Task 5: Bound catalog and target reads before canonical decoding

**Files:** create `selection-read.ts`; extend `tests/integration/sync-selection.test.ts`.

**Consumes:** Task 1 caller-client authority reader, existing activation/target readers and canonical/hash decoders. Single-subject cases reuse unchanged `createSyncApplyFixture`; multi-subject cases await the fixture gate.

**Produces:** internal catalog reader `readSelectionCatalog(client: PoolClient, input: SelectionInput): Promise<{ subjects: Omit<SelectionSubject, 'origins' | 'units' | 'outcomes' | 'heads'>[]; evidence: SelectionEvidence[]; boundedFacts: CutSummary } | Extract<SelectionReadResult, {kind: 'incomplete'}>>`. No transaction ownership here.

- [ ] Add `catalog_bounded_reads`: empty enrollment; exact selected identity, forged scalar/hash bindings; paused/revoked retained; CSV-bearing subject rejects the entire cut; 9 subjects; 10,001 target records; per-value and aggregate byte overflow. Inspect recorded SQL and prove canonical blob reads/decoders do not run after a key/length sentinel rejects admission.
- [ ] Run `npm run test:integration -- tests/integration/sync-selection.test.ts -t 'catalog_'` for behavioral red. Implement ordered source-rooted key/scalar scans with `LIMIT cap + 1` and `octet_length` before canonical retrieval. Use all committed imports for the source, including inactive, and each import's own approved target/vector. Never select the latest manifest as a shared baseline.
- [ ] Close the import/target byte budget over every canonical column the accepted helpers can read: request, reviewer, bundle including embedded baseline evidence, plan, activation, receipt, recorded/planner/approved/current snapshots and relevant relational metadata/financial rows. Bound rows/keys before calling helpers; no unbounded `SELECT *` precedes admission. Validate full exact import/request/artifact/profile pins and relational target membership. Root-owned gaps in helper closure/indexing must be reported, not bypassed by copying its decoder.
- [ ] Repeat focused tests and typecheck; commit `feat: bound sync selection catalog and target reads` after review. Missing fixture cases remain explicit dependencies, not skipped successes.

## Task 6: Validate complete capture membership and incident history

**Files:** `selection-read.ts`, `tests/integration/sync-selection.test.ts`.

**Consumes:** Task 5 admitted catalog; existing `readCaptureLane`, strict page/event/incident schemas and canonical helpers.

**Produces:** `readSelectionCapture(client: PoolClient, input: SelectionInput, catalog: Awaited<ReturnType<typeof readSelectionCatalog>>): Promise<{lanes: SelectionLane[]; deliveries: SelectionCut['deliveries']; evidence: SelectionEvidence[]; boundedFacts: CutSummary} | Extract<SelectionReadResult, {kind: 'incomplete'}>>`; reject an incomplete catalog without further reads.

- [ ] Add `capture_complete_cut`: accepted complete pages and memberships; no initialized lane; 9 lanes; 33 definitions; 1,001 distinct deliveries; cap+1 pages/inbox/incidents/positions; unknown transport, undeclared stream, wrong manifest, orphan position/delivery/inbox/page, member beyond checkpoint and canonical conflict across lanes. Relevant rows on another lane beyond the subject's own cut yield `uncovered_stream` and zero proposals.
- [ ] Add `capture_incidents_and_baselines`: retained identity/page conflicts survive later success; a historical gap without enough retained range evidence remains `capture_incident_unresolved`; a provably closed contiguous gap is distinguished from a current gap. Separate subject baselines retain approval-window work and do not turn bootstrap identities into ongoing inbox entries.
- [ ] Run `npm run test:integration -- tests/integration/sync-selection.test.ts -t 'capture_'`; observe behavioral red. Implement bounded indexed source/lane/stream scans and both-direction membership anti-joins. Preflight bytes, validate actual full page canonical/digest against independent inbox/delivery positions, and verify every position in each retained interval. Include all incidents, not only latest summaries. Exact canonical deliveries deduplicate globally while lane membership remains distinct.
- [ ] Repeat focused tests plus `npm run test:integration -- tests/integration/sync-capture.test.ts` under the root lease. Commit `feat: validate complete captured selection cuts` after review. Do not add indexes/migrations without a separately reviewed release if existing predicates cannot meet the deadline.

## Task 7: Close immutable history and global original claims

**Files:** `selection-read.ts`, `tests/integration/sync-selection.test.ts`.

**Consumes:** admitted catalog/capture and accepted P1 strict `readSyncUnit`/`readFinancialOrigins`; parent financial reference helpers, not a new comparator.

**Produces:** `readSelectionCut(client: PoolClient, input: SelectionInput): Promise<SelectionReadResult>`, the only adapter function allowed to return a ready `SelectionCut`.

- [ ] Add `history_exact_origins`: genuine initial and P1 nonempty/all-replay history, exact acknowledgment suppression, unchanged semantic/raw history, multiple original receipts, foreign-account economic collision, same bare delivery ID under another source, changed canonical association, missing/ambiguous origin, and unsupported legacy receipt-only history. Rehashed corrupt prior audit/outcome/origin references still fail strict readers.
- [ ] Add `history_graph_bounds`: 1,001 units/outcomes/origin associations/receipts or over-budget referenced snapshot/import; finite transitive references cannot escape the shared budget. A missing application head with history is invalid, not an invented frontier. Corruption uses transaction-local owner changes rolled back, never successful-approval fabrication.
- [ ] Run `npm run test:integration -- tests/integration/sync-selection.test.ts -t 'history_'` for behavioral red. Preflight the complete immutable reference graph by bounded keys/lengths, including every helper-reachable receipt, import, plan, snapshot, record and delivery association; charge each unique canonical object once. Reuse strict readers only after closure. Keep their exact historical semantics and P1 audit decoders unchanged.
- [ ] Read the complete source-global economic/origin claim catalog across accounts/sellers, bounded to 1,000 associations with cap+1 admission, and exact canonical delivery claims for every inspected full delivery identity. This deliberately conservative complete catalog avoids deriving candidate prerequisites from raw payloads before the compiler runs. Resolve both initial and ongoing origins, bound all referenced foreign-scope imports/snapshots/receipts before loading them, and retain exact typed identities/derived target IDs. Only subsequent compiler-mapped keys establish candidate relevance; absence is proven over this complete catalog. This extra admission ceiling may reject a large source even when its selected customer is small; never replace it with an unproved filtered lookup or a later snapshot.
- [ ] Compare exact outcomes/heads against immutable P1 unit histories before excluding acknowledged work. Foreign-scope valid claims block the affected group; absent/corrupt original for existing target economics is `SELECTION_STORAGE_INVALID`. Unsupported legacy coverage is incomplete, not corrupt or acknowledged by guess.
- [ ] Repeat focused history tests plus P1 storage/coverage regressions and typecheck. Commit `feat: bind selection to exact history and global origins` after review.

## Task 8: Compose deterministic bounded inspections

**Files:** `selection.ts`, `selection-read.ts`, both new selection test files.

**Consumes:** Tasks 1–7, released genuine fixture interfaces and final accepted P1. No source/transport/current-semantics capability is injected.

**Produces:** `inspectSelectionCut(cut: SelectionCut): SelectionInspectionV1` in `selection.ts`; `createSyncSelector({db}: {db: Pool}): {inspect(input: SelectionInput): Promise<SelectionInspectionV1>}` in `selection-read.ts`. The public internal caller can choose only source and asOf; reject extra keys rather than accept events, profiles, cursors, limits, targets, authority or proposed members.

- [ ] Add `inspection_witness`: repeat same persisted state/asOf through a recreated service/pool yields identical ordered results/hashes; reconstruct the explicit witness preimage and verify references resolve. Hash only schema/source/asOf, exact committed pins, observed authority/targets, baselines/cursors, sorted immutable references/digests, complete routes/contract checks, history/origins and full/selected classifier/closure metadata. Proposal hash binds this cut plus its exact subject/group; no transaction ID, duration, wall clock or arbitrary object stripping. Include full classifier held/group metadata and exact dependency relations/provider membership or complete-index no-match hash.
- [ ] Add `inspection_timeout_cleanup`: cancel an actual blocked read via the 2-second statement bound, and a deterministic test-wrapper delay exceeding the 5-second transaction deadline. Abort pending reads, rollback, release/discard safely, return incomplete timeout with zero proposals; never race-return while a query/transaction still runs. Other DB errors are redacted `SELECTION_UNAVAILABLE`; invalid input and persisted bindings use their separate codes. No raw payload, SQL or credential text in failures.
- [ ] Run focused inspection tests for behavioral red. Compose one checked-out client, exact read-only transaction and cleanup; detach/freeze successful facts, end the transaction, then execute Tasks 2–4 and witness construction. Every incomplete branch returns zero proposals, including guard `unexamined`; retain completed bounded observations and `sourceContractChecksComplete:false`. Complete witnesses require the full check set and `true`.
- [ ] Run `npm run test:unit -- apps/worker/test/sync-selection.test.ts` and `npm run test:integration -- tests/integration/sync-selection.test.ts -t 'inspection_witness|inspection_timeout_cleanup'`, then typecheck. Commit `feat: expose bounded read-only sync inspections` after focused review. This completes composition, not the remaining genuine integration proof.

## Task 9: Prove coherent snapshots and genuine independent selection

**Files:** `tests/integration/sync-selection.test.ts`. The conditional new `tests/fixtures/sync-selection.ts` helper requires a separate reviewed construction task after the feasibility gate; this task only consumes its released interface. No production source edits belong to this proof task.

**Consumes:** completed `createSyncSelector`, final accepted P1 applier/authority/capture services and genuine fixtures. **Produces:** real PostgreSQL proof for the existing API; no new runtime interface.

- [ ] Add `inspection_snapshot_barriers`: establish the first snapshot with a SELECT, pause subsequent reads using test pool/client wrappers, commit capture/status/target changes via accepted services, and resume. Observe a coherent old cut, then a coherent new cut in a new inspection. Capture/apply/revoke need not block on selector write locks; a returned witness is explicitly staleable. No production failpoint, sleep-based ordering or hidden second connection.
- [ ] Add `inspection_zero_writes`: compare complete durable rows before/after success, incomplete and error paths, including parent records/metadata/targets/snapshots, imports, origins, all receipt/unit/outcome/head tables, capture tables/incidents, authority and activity/counter. Log SQL through the supplied client: permit transaction-control/timeout statements and SELECT only, no lock clauses/advisory calls, initialization or service fetch. Assert no model/provider access and no new pending/lag/frontier claims.
- [ ] Run `npm run test:integration -- tests/integration/sync-selection.test.ts -t 'inspection_snapshot_barriers|inspection_zero_writes'`; observe the exact failure before any repair, and pass both against the completed service. If they pass initially, retain that evidence; do not intentionally break correct behavior to manufacture red. Any defect repair returns to the owning source task/review.
- [ ] After fixture release, add `genuine_shared_mapping` (four known/unknown renamed/missing cases, actual compiler paths and both consumers), `genuine_valid_unknown`, `genuine_unaffected_mapping`, `genuine_inactive_and_unselected`, `genuine_cross_stream_dependency`, and `genuine_distinct_baselines`. Require real protected producer results, explicit separate approvals and accepted capture; the cross-stream example retains 700/500/900 cents and 400-cent projection without changing stored money. Do not declare these passed from pure tests, fixed A/B, fake proof hashes or changed expected truth. If an upstream gate is still closed, finish independent cases and report the exact unexecuted mandatory cases.
- [ ] Run `npm run test:integration -- tests/integration/sync-selection.test.ts -t 'genuine_'` after the producer/fixture release. Assert complete exact identities, vectors, event membership, diagnostic paths, original receipts and canonical durable-row equality. Every required case must execute; no skip can satisfy this gate.
- [ ] Run final focused gates below, commit `test: prove coherent read-only sync selection`, and give root the exact candidate, reviewable diff, immutable migration/helper hashes and observed result inventory. Root commissions fresh exact-candidate review; machine execution, review and joint acceptance remain separate.

## Focused verification and completion boundary

Run only with root's released source lease and exclusive isolated PostgreSQL lease. Historical ports/names are not authorization; root supplies `EAPR_PG_PORT`, `EAPR_TEST_PREFIX` and any service ports. No tests or database commands were run while authoring this document.

```bash
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH
npm run typecheck
npm run test:unit -- apps/worker/test/sync-selection.test.ts apps/worker/test/sync-dependencies.test.ts packages/compiler/test packages/finance/test packages/parent/test
npm run test:integration -- tests/integration/sync-selection.test.ts tests/integration/current-authority.test.ts tests/integration/sync-capture.test.ts tests/integration/sync-apply-storage.test.ts tests/integration/sync-apply-coverage.test.ts tests/integration/sync-apply.test.ts
```

Focused filtered commands intentionally omit unrelated tests during development; record those omissions. Final selected gates require no skipped mandatory case. Preserve behavioral red evidence after compilable minimal scaffolding, then corresponding green assertions. Each task is a reviewable logical commit with a descriptive subject under 20 words; stage only its granted paths. No automatic full V5/V6, live, AI-off transport or user acceptance claim follows from these checks.

## Plan self-review

Checked design coverage against routing, pre-routing schema fix, typed closure, complete-corpus bounds, immutable original history, exact baselines, inactive/empty catalog, all-replay/coalescence, incidents, deterministic witness and zero-write/snapshot obligations. Every Review Focus item has named task assertions. Existing P1 identity/origin/reader signatures are reused; no selected proposal reaches P1. The additive authority read delegates to the accepted decoder, eliminating the second-connection seam without new authority behavior. Source/read DTOs are internal and distinct from persisted P1 `CoverageCut`.

Remaining gates are explicit: final P1 Task 4/whole review reconciliation; fresh review/release of this plan and the two narrow added paths; same-feed independent fixture feasibility; source-owner stream/schema contract and protected evaluator admission for genuine API-only cross-stream/separate-feed proofs. No new financial policy gap was identified. Those producer/interface dependencies must not be hidden by fixture truth edits, synthetic approval rows, plan slicing or partial coverage claims.
