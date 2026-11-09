# Activation bootstrap verification prerequisite — proposed freeze

Architecture only; not implementation authorization or acceptance. Inspected clean HEAD `2c432fb59681ae20b97692f24ee1ae03f6f09912` on 2026-11-08. Root must independently review this proposal and assign the handoffs before consumers change. Authoritative behavior is the accepted activation-shapes freeze, with the historical v3-contract-proposal §§3–5 as rationale. No provider is needed.

## 1. Findings and dependency chain

Existing `planBatch` is financial-only; `parent/state.ts` projects only financial operations. `subject-comparison.ts` deliberately ignores ensures. More significantly, `evidence-support.ts:checkEvidenceSupport` makes evidence_support unavailable whenever a profile contains bootstrap. Thus even financial eligibility for an exact bootstrap-bearing subject needs a narrowly reviewed checker extension. Removing metadata to obtain an old report, substituting the old profile hash, or accepting twelve checks is prohibited.

Minimum chain:

1. Freeze the separate bootstrap contracts and exact coverage below, plus the narrow same-subject financial checker extension. Keep all existing VerificationReport fields/check IDs, private evidence v2 bytes/pins, four-argument planBatch and existing bundle-v1 hashes unchanged.
2. In parallel, implement pure planner/projection; protected expectation sidecar/oracle; and candidate metadata plus narrow financial evidence support. None grants readiness.
3. Add dedicated bootstrap child runner/comparison, then immutable job/result registry and real end-to-end construction execution.
4. Full preview may integrate after planner tests; it still grants nothing. Trusted review readiness and worker import remain blocked until exact registered financial and bootstrap proof exists and its additive bundle transport is frozen/implemented.

The first supported construction subject is the currently supported single-source-account A/B demo mapping family. Unsupported mapping/finding/identity families stay unavailable, rather than being guessed. No expansion of financial policy, empty-customer activation, live discovery, scheduling, or provider construction.

## 2. Pure planner and projection

Public addition in `packages/compiler/src/plan-bootstrap.ts`:

```ts
planBootstrap(artifact: CompiledArtifact, profile: CustomerProfile,
  events: SourceEvent[], target: TargetState): PlanOutcome;
```

All inputs are untrusted values at runtime and validated as in planBatch; no I/O, clock, registry, reviewer, manifest loading or authority. The caller pins `target.asOf = manifest.asOf`; the trusted bootstrap verifier checks that binding. Keep planBatch unchanged.

Add `projectBootstrapTarget(state: TargetState, operations: readonly MutationOperation[]): TargetState` in `packages/parent/src/bootstrap.ts`. It returns copied arrays and unchanged version/asOf, validates state/schema/scopes and duplicate metadata IDs, applies scoped ensures by exact `canonicalJson(record)` equality, and delegates financial array projection to the existing helper. Missing record inserts; exact equivalent preserves original bytes; conflict throws a typed pure projection failure converted to a hold by planBootstrap. No evidence union, rename, term rewriting, global customer search or write. Metadata customer scope is the containing TargetState, not a new wire field. Cross-scope account/config records fail. Persistence must later use this same equivalence rule, with scope enforced by its storage key. Canonical object-key order does not imply sorting arbitrary existing arrays: prepared expected metadata arrays are normalized, and different existing array bytes conflict.

Planner steps:

- Validate selected profile/artifact/hash/requiredProfileHashes and target first; missing/invalid bootstrap blocks with `BOOTSTRAP_METADATA_UNAVAILABLE`. Parent customer ID must equal profile.parentCustomerId. Preserve name bytes. Canonicalize declared evidence/source ID sets and binding order, reject duplicate IDs. Entire approved contract term values are copied, including null validToExclusive; normalize their declared evidence set for prepared canonical records.
- Obtain financial PlanOutcome from unchanged planBatch using the exact events/target. Require exactly one plan with at least one financial operation, correct selected scope/subject/version/asOf, and no blocking hold. Zero balance is permitted when existing financial records genuinely reconcile to zero; zero operations, replay-only, zero plans, multiple plans, invalid financial input or selected blockers cannot produce ensures-only output. They yield zero plans plus a fixed bootstrap hold and original holds.
- Hold classification must not treat every absent scope as unrelated: planBatch emits absent-scope holds both for unrelated events and unresolved failures. A hold blocks if scope equals selected scope, eventIds is empty, any referenced event is missing/ambiguous/invalid, or any referenced event lacks complete source/company/seller/account identity. A hold can be dismissed as unrelated only when every referenced event is validated, uniquely resolved in the supplied capture, and demonstrably outside the selected source/company/seller/sourceAccountIds tuple, and the code denotes an identity-routing exclusion (IDENTITY_SCOPE or UNKNOWN_ACCOUNT). All other absent-scope/source-wide failures block conservatively. Source-wide semantic `*`/missing identity is never dismissed. Preserve unrelated holds for presentation; do not authorize their records.
- Metadata operations: customer; account `{id:scope.accountId,scope,parentCustomerId,sourceRef,sourceAccountIds:sorted}`; configurations `{id:binding.id,scope,contractTerm}` sorted by configuration ID. Then financial operations in their existing order. Exact reused ensures remain explicit. Project/validate the complete plan before returning it.
- Metadata lineage has exactly one row for every recursive primitive/null leaf of operation.record; empty arrays have one row at their array pointer. Escape `~` and `/` per RFC6901. No `/record` prefix. No duplicate/extra pointers. Within each metadata operation lexical targetField order; operations retain preceding order. Each row: empty sourceEventIds/sourcePaths, mapping:null, canonical evidenceRefs and derivationInputs sets.
- Customer rows: approved customer citations; derivationInputs `[profile.id]`. Account rows: union of customer citations and evidenceRefs of parent-account lookup entries whose source is selected and target equals scope.accountId; derivationInputs `[profile.id]`. Configuration rows: corresponding term.evidenceRefs; derivationInputs sorted `[profile.id,term.id]`. These references support the reviewed inputs; generated IDs are not claimed as quoted source literals.
- Shift financial operationIndex by metadata operation count, retaining all financial row order and other bytes. Retain financial eventIds exactly, expected balance exactly, and expectedTargetVersion/asOf. Hash full operations/lineage with hashPlan. Projection does not increment target version; the eventual authorized transaction does.

Pure diagnostics proposed for the freeze: BOOTSTRAP_METADATA_UNAVAILABLE, BOOTSTRAP_BASELINE_REQUIRED, BOOTSTRAP_BASELINE_BLOCKED, BOOTSTRAP_METADATA_CONFLICT. Fixed messages; sourceIds are only visible profile/event/evidence IDs; fieldPaths only public profile/record pointers. Existing underlying holds remain available.

## 3. Independent protected expectations, without changing v2

Use actual producer identity/contract facts and validated originals/citations/resolvedSupport already carried in private evidence v2. `decodeProtectedEvidenceBundle` verifies source files, captured event membership, source-supported literals and producer fact identities. Do not revise existing immutable v1/v2 pins or regenerate a pin under the same `(id,version)`.

Add a separate sidecar namespace `.local/protected-bootstrap/` (not a child of a served root), schemaVersion `1`, immutable by `(fixtureSetId,fixtureSetVersion)`, with atomic new-file publication, same bounded input/permission disciplines as the existing store. The v2 pin remains a referenced immutable input. Only the protected evaluator/operator reads the sidecar; product receives its identity/hash, never facts, expected output, protected paths, or literals. This is construction-only, not a new holdout claim.

Exact private descriptor (all objects strict; Id/Hash/Scope use existing validators):

```ts
type BootstrapExpectationV1 = {
  schemaVersion: '1'; fixtureSetId: Id; fixtureSetVersion: Id;
  purpose: 'construction';
  evidencePin: {fixtureSetId: Id; fixtureSetVersion: '2'; bundleHash: Hash};
  manifestHash: Hash; snapshotHash: Hash;
  recipeVersion: 'demo-bootstrap-1';
  subjects: {
    profileHash: Hash; profileId: Id; scope: Scope;
    identityFactId: Id;
    customerId: Id; customerEvidenceRefs: Id[];
    terms: {factId: Id; termId: Id; configurationId: Id; evidenceRefs: Id[]}[];
  }[];
  hash: Hash;
};
```

In this descriptor and BootstrapBindingV1 below, `snapshotHash` is exactly `snapshot.contentHash`, using the existing protected evidence v2 convention and its manifest/streams/files/eventIds/evidenceIds preimage. It is never `hashCanonical(snapshot)`, the distinct whole-object hash used by the immutable candidate object registry. Validate the exact snapshot object against that registered object hash and artifact/capture association as well as validating its contentHash against the manifest; neither check replaces the other.

Subjects unique by profileHash; terms unique by factId, termId and configurationId; canonical ordering by profileHash/termId; citation arrays are canonical unique sets. Hash is hashCanonical(all fields except own hash). Decode and verify referenced v2 bundle before sidecar publication and every protected run. The descriptor pins reviewer metadata, not observed values. Operator input may name profile/term/config IDs but cannot supply an alternative legal name, money, term values, source facts or identity. Cross-check customerId against producer buyerId and existing demoBindings; scope/source account against producer and generated-demo-buyer-account-v1 policy. Each named term fact must belong to that identity's source account/seller; descriptor terms must cover the selected approved terms exactly. Applicable terms and exact evidence support remain at least as strong as current checkContractTerms. Unknown or missing fact/support blocks publication/run.

Expected customer name comes solely from `producer.identities[identityFactId].legalName` and citations whose resolvedSupport covers legalName and party identity. Other customer citations must be applicable, not merely present in the snapshot. Expected term values come solely from matched producer contract facts. Term/config/profile IDs and canonical citation identifiers are reviewed metadata; account ID follows the pinned demo mapping policy, sourceRef/company/seller follow manifest/producer; `validToExclusive:null` is the validated terminal interval from the complete scoped producer term chain, not a fictitious literal 'null' in the PDF. Non-null end dates use the supported amendment facts. The oracle asserts these provenance distinctions explicitly.

`bootstrap-reference.ts` builds independent expected metadata and leaf lineage from the descriptor plus validated producer facts; it never calls compiler, financial runtime, planBootstrap, planBatch, projectBootstrapTarget, candidate builder, or subject output to obtain expectations. Existing independent reference-model/recipe code may supply financial fact records and checked balance. For supported A/B mappings, independently declare the mapping/source-path lineage table (the current evidence-support module already contains such a table); build expected financial operation order from rank plus sourceRef/streamId/sequence/id, not actual output order. Extend/export a pure independent helper only in the separately reviewed evidence-checker task if useful. Do not share subject metadata construction/leaf walkers with the oracle. Sharing schemas, canonical hash encoding and targetRecordId is permitted by existing evaluator guidance.

The oracle checks subject consistency against reviewed metadata and source-supported observed facts separately. A wrong but self-consistent candidate name or term must fail even if all hashes have been recomputed. An unknown profile or mapping makes assertions unavailable, never passed. Sidecar versions change for any expectation/recipe/profile revision; old pins remain readable and cannot authorize a different subject.

## 4. Separate exact-subject result and protocol

Put public safe types in new `packages/contracts/src/bootstrap-verification.ts`; preserve review.ts existing schemas and check enum. Everything strict, unknown/prototype keys rejected. Arrays described as sets reject duplicates and are emitted lexically; assertion/case arrays follow literal enum order. ISO/scalar rules unchanged.

```ts
type BootstrapPinV1 = {
  runnerId: 'eapr-bootstrap-1'; protocolVersion: '1';
  evaluatorBuildHash: Hash; subjectBuildHash: Hash;
  fixtureSetId: Id; fixtureSetVersion: Id; fixtureHash: Hash;
};
type BootstrapBindingV1 = {
  artifactHash: Hash; profileHash: Hash; requiredProfileHashes: Hash[];
  scope: Scope; manifestId: Id; manifestHash: Hash;
  snapshotId: Id; snapshotHash: Hash; eventsHash: Hash;
  targetSnapshotHash: Hash; expectedTargetVersion: NonnegativeInteger;
  asOf: IsoInstant;
};
type BootstrapAssertionId =
  | 'capture_binding' | 'identity_name_support' | 'term_configuration_support'
  | 'scoped_metadata_records' | 'ensure_equivalence_conflict'
  | 'metadata_lineage' | 'financial_suffix' | 'operation_order_hash'
  | 'baseline_blockers';
type BootstrapCaseId =
  | 'captured_baseline' | 'exact_metadata_reuse'
  | 'customer_conflict' | 'account_conflict' | 'configuration_conflict'
  | 'empty_events' | 'financial_replay' | 'selected_blocker'
  | 'source_wide_blocker' | 'unrelated_account_hold';
type BootstrapVerificationResultV1 = {
  schemaVersion: '1'; id: Id; jobId: Id;
  pin: BootstrapPinV1; binding: BootstrapBindingV1;
  planHash: Hash | null;
  assertions: {id: BootstrapAssertionId;
    status: 'passed'|'failed'|'unavailable'; caseIds: BootstrapCaseId[]}[];
  cases: {id: BootstrapCaseId; status: 'passed'|'failed'|'unavailable'}[];
  passed: boolean; createdAt: IsoInstant; hash: Hash;
};
```

`eventsHash = hashCanonical(capturedEvents sorted by event.id)` after duplicate rejection, envelope/hash and complete manifest membership validation. Includes whole capture, not only selected events. Binding `snapshotHash` is exactly `snapshot.contentHash`, as in the sidecar; the separate registry whole-object hash is never substituted. `targetSnapshotHash = hashTargetSnapshot(exact target passed to planner)`; the registered job also stores the exact immutable target bytes. Its asOf must equal manifest.asOf. If caller obtained a recorded target at another asOf, it makes an explicit cutover-evaluated copy first and retains the separate recorded snapshot identity in its preparation context; never confuse the two hashes. Result selected profile belongs to the complete exact artifact.requiredProfileHashes set, whose bytes are resolved from immutable candidate registry and independently checked. Plan binding additionally requires hashPlan and exact canonical plan comparison. `planHash` is actual captured-baseline full plan hash only if exactly one exists; it is null for baseline no-plan. Result hash includes every field except its own hash; id is `bootstrap-result:` + jobId. A digest detects corruption, not authorship.

Pin build manifest: evaluator hash covers new runner/launcher/protocol/oracle/case/fixture/validation files, imported protected evidence/reference modules, contracts/canonical code and package-lock. Subject hash covers fixed subject entrypoint, compiler (including planBatch/operations/compile), parent projection, finance, contracts and lockfile. Enumerate paths deterministically; no mutable runtime URL, git HEAD alone, or caller build string counts. Hash actual executing source closure, compare before launch and before accepting result; discard result if closure changed during run. Immutable deployment builds later can supply equivalent trusted digests. A test must alter each owned code family and observe a changed digest.

Dedicated private wire in `packages/evaluator/src/bootstrap-protocol.ts`:

```ts
type BootstrapEvaluatorInputV1 = {
  protocolVersion: 'bootstrap-1'; jobId: Id; pin: BootstrapPinV1;
  artifact: CompiledArtifact; profiles: CustomerProfile[];
  selectedProfileHash: Hash; manifest: BootstrapManifest;
  snapshot: SourceSnapshot; events: RawSourceEvent[]; target: TargetState;
};
type BootstrapSubjectInputV1 = {
  protocolVersion: 'bootstrap-subject-1'; requestId: Id;
  artifact: CompiledArtifact; profile: CustomerProfile;
  events: RawSourceEvent[]; target: TargetState;
};
type BootstrapSubjectOutputV1 = {
  protocolVersion: 'bootstrap-subject-1'; requestId: Id; outcome: PlanOutcome;
};
// Private evaluator stdout and successful launcher return; not a public result API.
type BootstrapEvaluatorCompletionV1 = {
  protocolVersion: 'bootstrap-completion-1'; jobId: Id;
  requestHash: Hash;
  result: BootstrapVerificationResultV1;
  observedBaselinePlan: MutationPlan | null;
  observedBaselinePlanBytesHash: Hash | null;
};
type BootstrapLauncher = {
  launch(input: BootstrapEvaluatorInputV1): Promise<BootstrapEvaluatorCompletionV1>;
};
```

The completion envelope is strict, including its nested result/plan. `requestHash = hashCanonical(the strictly parsed complete BootstrapEvaluatorInputV1)`; reservation stores those exact canonical request bytes/hash before launch, including server-allocated jobId, resolved pins and immutable inputs. Completion.jobId and result.jobId must both equal the reserved request jobId; result.id must equal `bootstrap-result:` + jobId. The transport compares completion.requestHash to the exact sent request hash and returns no successful launcher value for framing/schema/protocol/request mismatch, preflight failure or child failure. The launcher rejects with a fixed safe category on failure; it returns the validated envelope unchanged on success, not a result-only object or a newly obtained plan. A structurally valid completion may contain failed/unavailable assertions and be stored as a completed negative verification; that does not make it passed.

`observedBaselinePlan` is the single schema-valid, hash-valid plan actually returned by the captured_baseline subject invocation and retained by the evaluator while performing independent comparison. Capture those canonical subject plan bytes before comparison; never replace them with oracle-generated expected output, a probe plan, a financial-only plan, or output from another planner invocation. A differing independent comparison makes assertions fail while retaining the observed valid plan for diagnosis inside trusted storage. If the baseline did not produce exactly one valid plan, observedBaselinePlan, observedBaselinePlanBytesHash and result.planHash are all null, and result.passed must be false. Otherwise all three are non-null, `result.planHash === observedBaselinePlan.hash === hashPlan(observedBaselinePlan)`, and `observedBaselinePlanBytesHash === hashBytes(UTF8(canonicalJson(observedBaselinePlan)))`. This byte hash covers the complete canonical observed object including its own plan.hash, whereas hashPlan uses its existing plan preimage. A passed result additionally requires the nonempty financial/full baseline and all existing comparison/coverage rules. A null/non-null disagreement is an invalid completion, not unavailable coverage.

Both launcher validation and registry completion rederive result.binding from the reserved request and require exact canonical equality, including artifact/profile/full profile set, scope, manifest/snapshot/events, target version/hash and asOf; result.pin must exactly equal the reserved pin. The observed plan's artifactHash/profileHash/scope/expectedTargetVersion/asOf must match that binding. Verify result.hash and the plan hashes above. Persist the actual envelope's canonical observed plan bytes atomically with its canonical result and completion request hash; the stored byte hash must match the envelope. A duplicate completion must have byte-identical canonical envelope/result/observed plan and request binding or reject; never overwrite or reconcile conflicting bytes. On read/restart parse and validate the persisted bytes and compare their canonical byte hash, plan hash and result/request bindings before returning the plan. The envelope carries only the primary observed visible plan, safe public result and integrity bindings: no expected records, probe outputs, private paths, producer facts or protected comparison literals.

The evaluator resolves the operator-selected sidecar from fixed trusted root and compares every pin/hash; it is not given a path or expectations over stdin. Subject gets only visible inputs, no fixture selector, oracle, expected values or credentials. It executes planBootstrap once per case. Keep current protocol.ts intact. A small separately exported transport adapter may reuse existing bounded exchange internals after adding strict new schemas; no generic caller-selected schema/entrypoint API. Caps remain 10 MiB, evaluator 120s, child 5s, empty env, fixed Node executable/trusted entrypoint, no shell, subprocess-group timeout cleanup, strict single report line, stderr discarded. Process isolation does not replace filesystem permissions.

## 5. Required coverage and reproducible vectors

Every result contains each assertion ID and each case ID exactly once. Passed case means the real subject was run and matched the independently specified expected outcome, including negative cases. Unavailable cases have no execution claim. Assertion caseIds must exactly equal the table below when passed; unavailable has []; failure lists only actually executed contributing case IDs. Passing never follows from case count alone.

| Assertion | Required case IDs |
| --- | --- |
| capture_binding | captured_baseline |
| identity_name_support | captured_baseline, exact_metadata_reuse |
| term_configuration_support | captured_baseline, exact_metadata_reuse |
| scoped_metadata_records | captured_baseline, exact_metadata_reuse |
| ensure_equivalence_conflict | exact_metadata_reuse, customer_conflict, account_conflict, configuration_conflict |
| metadata_lineage | captured_baseline, exact_metadata_reuse |
| financial_suffix | captured_baseline, exact_metadata_reuse |
| operation_order_hash | captured_baseline, exact_metadata_reuse |
| baseline_blockers | empty_events, financial_replay, selected_blocker, source_wide_blocker, unrelated_account_hold |

`passed` is recomputed: all required cases/assertions passed, positive captured_baseline actually emitted one nonempty financial/full plan with matching bound planHash, positive exact_metadata_reuse passed, complete expected matrix executed for this selected subject. Transport/preflight failure cannot manufacture a result. Unsupported recipe or no actual financial baseline leaves passed=false even if every available rejection probe succeeds. A passed bootstrap result is not combined eligibility.

Reproducible vectors use `generateFixtures` with seed `bootstrap-v1` and asOf `2026-10-01T00:00:00.000Z`, isolated visible/protected temp roots, normal capture/citation preparation and immutable v2 evidence pin. Select the first unamended A account and B designated account using their actual captured agreements. Register metadata-bearing profiles at a new version, compile exact requiredProfileHashes, pin a sidecar with selected fact IDs and explicit configuration IDs. Use existing tests/fixtures A only for public unit vectors: customer buyer-shared-1 / Shared Buyer / ev-a-identity, term-a-1/config-a-1, three metadata ensures + five financial records, balance 80000. These public unit literals never substitute for captured construction proof. Captured B may legitimately reconcile to zero; do not substitute synthetic F8 80000.

Case recipes derive from those independent facts:

- captured_baseline: exact job target and full captured events; supported activation baseline must have nonempty financial plan. For first construction target is empty version0 at manifest.asOf.
- exact_metadata_reuse: copy baseline target and install independent expected metadata only; keep financial input absent from target. All ensures explicit, existing bytes preserved, same financial effects and correctly bound target hash.
- customer/account/configuration_conflict: start reuse case, mutate respectively name, account.parentCustomerId, configuration.contractTerm.anchorDay to a different valid value (1->2, otherwise 1). Each yields no full plan and metadata-conflict hold. Also test cross-scope malformed targets at parser/projection boundary.
- empty_events: no events on empty target => no plan. financial_replay: install independent complete financial baseline plus expected metadata and replay baseline events => no plan. These probes are not substitute capture inputs for the primary binding.
- selected_blocker: append validly hashed selected event with unreviewed semanticVersion and fresh delivery/sequence; source_wide_blocker: valid semantic change with missing account scope; retain otherwise valid selected financial events, require no bootstrap plan. Probe-specific derived capture is private recipe input, not claimed as actual primary manifest membership.
- unrelated_account_hold: add a valid independent event from another known captured account, preserve valid selected baseline; unrelated hold remains but selected full plan is identical. No other scope metadata/financial operations.

Oracle and gate mutation tests (not fake real-case credits): wrong legal name with rebuilt profile/artifact hash; wrong name citation; source-supported term assigned to wrong selected account; swapped term/config IDs; changed fee/interval/null end; missing/extra/duplicate metadata pointer; empty-array pointer; altered mapping/events/derivation refs; unshifted or double-shifted financial index; reordered ensures/configurations/financial suffix; changed plan hash; forged passed:true/result hash; missing/duplicate cases/assertions; stale manifest/snapshot/profile/target/asOf/build/fixture/events bindings. Explicitly substitute `hashCanonical(snapshot)` for `snapshot.contentHash` in both sidecar and result binding, rehash the enclosing malicious object, and require rejection; exact registry object-hash validation must still occur separately. Mutate actual subject outcome for comparator tests and independently rehash malicious candidate subjects for support tests, so checks do not pass merely because a hash is stale. Add a two-term public vector with configuration IDs reversing term order and a terminal null interval; a zero-balance but nonempty B vector; and synthetic empty sourceAccountIds/term evidence arrays at the generic leaf walker boundary where permitted, without pretending unsupported profiles are eligible.

## 6. Registry, combined gate and activation transport

Dedicated `bootstrap-jobs.ts`/`bootstrap-registry.ts`, separate from current financial reports. Root has reserved `005_bootstrap_verification.sql`; control 004 is reserved for the earlier discovery lifecycle. S3b depends on the reviewed, merged control 004 catalog and its own planner/oracle/runner prerequisites. Do not apply 005 before 004 or insert 004 later into an already-applied sequence. Neither migration is implemented by this architecture task. Do not edit applied migrations. Minimal tables:

- bootstrap_verification_jobs: id PK, state queued/running/completed/failed, immutable canonical request bytes/hash, selected scope/account, binding JSON, pin JSON, immutable target bytes/hash, reserved_at. Reserve exact pins before launch, not inferred from returned result. Subject resolves through current candidate registry.
- bootstrap_verification_results: id PK, job_id UNIQUE FK, result_hash UNIQUE, completion request_hash, canonical completion JSON, canonical result JSON, canonical observed baseline plan bytes nullable, observed_plan_bytes_hash nullable. Insert result plus completed transition atomically. Completion must accept BootstrapEvaluatorCompletionV1 from the trusted launcher and enforce the envelope/request/plan/result checks in §4; no result-only completion overload. Plan/result hash/schema/equality validated at completion. No public endpoint accepts a result or changes completion state.

Ports:

```ts
reserveBootstrapVerification(input: BootstrapEvaluatorInputV1): Promise<{jobId: Id}>;
readRegisteredBootstrapResult(id: Id, expected: {
  pin: BootstrapPinV1; binding: BootstrapBindingV1; planHash: Hash;
}): Promise<{result: BootstrapVerificationResultV1; plan: MutationPlan}>;
readRegisteredFinancialReport(id: Id): Promise<VerificationReport>;
```

Reservation input is internal trusted composition, never raw browser pin/target authority. Job ID is server allocated (the input jobId field is assigned by reservation rather than accepted from HTTP). Reader requires completed job, stored request/subject binding, exact current trusted expected pins, valid result hash, exact baseline plan hash and bytes and independently recomputed passed. Missing/failed/unavailable/mismatch returns fixed BOOTSTRAP_VERIFICATION_UNAVAILABLE or BOOTSTRAP_VERIFICATION_MISMATCH. Browser sees only safe status; neither assertion internals nor fixture comparisons expose protected truth.

Narrow financial checker extension: remove only the unconditional bootstrap-presence exclusion after separately validating valid shape. Keep its financial captured run on the exact profile and artifact, all thirteen checks including evidence_support and current financial mapping/term/citation obligations. This code does not assert bootstrap support or call bootstrap planner. Actual report must be reissued under the new evaluator build and exact profile hashes. Keep report harnessVersion and evidence v2 shape; changed implementation means changed evaluatorBuildHash, not a changed fixture pin. Add regression proving wrong monetary mapping and unsupported findings remain failed/unavailable. No broad relaxation of evidence support or configuration-operation rejection.

Combined readiness checks both completed trusted records: financial report eligible and full mandatory coverage for the exact artifact, complete requiredProfileHashes set and manifest; bootstrap result passed for exact selected profile/scope plus manifest/snapshot/events/target/asOf/full plan/build/fixture. Read the financial job's registered immutable capture association to bind snapshot/events (the old report lacks these fields). Bind financial fixture v2 to the sidecar's evidencePin and actual registered pin/build policy; do not infer common provenance from manifest alone. Preserve the original report, never relabel it for bootstrap or strip profile.bootstrap. Report for another selected profile, subset artifact or target does not stand in for bootstrap proof. S5 must separately freeze the trusted financial capture/evidencePin attestation reader: the current report has no v2 bundle hash or capture membership, and its existing job resolves the fixture pin in memory rather than persisting this complete attestation. The reader type above is only a deferred port, not evidence that these bindings already exist. This association and worker permitted issuer/build/fixture policy remain non-dispatchable dependencies for S5.

Current ActivationBundle v1 is strict and cannot transport this result. Proposed additive wire, required before worker consumption:

```ts
type ActivationBundleV2 = Omit<ActivationBundle,
  'schemaVersion'|'hash'> & {
    schemaVersion: '2'; hash: Hash;
    bootstrapVerification: BootstrapVerificationResultV1;
  };
```

Keep v1 parser/hash behavior intact. Add distinct v2 parser/hash function that includes bootstrapVerification with its complete binding/hash. Keep ReviewPackage/ActivationRequest unchanged: control stores an immutable companion association from reviewPackage.hash to bootstrap result ID/hash and financial report ID/hash plus captured target/plan in its prepared record; include that association in the preparation fingerprint so a proof change changes prepared content/revision. Server supplies v2 bundle from that trusted association. Worker accepts first-activation only through v2; v1 remains legacy non-authorizing data. Because bundle input is retrieved only via trusted immutable hash-addressed control publication/authenticated worker route, a well-formed or self-hashed user result alone is not authoritative. Worker rechecks trusted permitted runner/build/fixture policy and full binding, and compares locked full recomputation against stored plan bytes/hash; it never reads the protected oracle or control database. Missing trust in the bundle publisher must fail, not fall back to trusting passed:true. This proposal does not add public report submission, signing infrastructure or change retry semantics.

## 7. Consumers, ownership and remaining decisions

Contracts owner B owns new strict result/pin schemas and later additive bundle v2; compiler/parent owner B owns pure planner/projection. Protected evaluator owner owns sidecar, oracle, runner, financial checker extension and trusted result registry, coordinating B for its new control migration. Control owner C owns candidate metadata, exact registration, preview selection and later review companion/readiness. Runtime owner B owns later locked recomputation/import. Root freezes file assignments before parallel work.

Candidate builder must retain observed Agreement.label as bootstrap.customer.displayName, cite its captured agreement, pin deterministic config IDs and increment profile/spec identity/version as necessary to avoid current immutable registry conflicts. It may proceed concurrently with planner/oracle after freeze; it cannot import protected facts. Full preview may proceed after planner; ordinary profiles still use financial preview. A bootstrap preview at an arbitrary user asOf can show deterministic operations but is not activation-ready unless cutover binding and verification match. Review gate, bundle v2, worker and UI approval remain blocked on complete verifier and their separately reviewed persistence/transport implementations.

No materially unspecified product or financial choice was found for the first single-account deterministic slice. Technical decisions requiring freeze/assignment are this result/coverage/completion contract, protected sidecar publication, same-subject financial checker extension, and v2 activation transport/trusted proof association. Migration 005 is reserved by root, with reviewed merged 004 as a dependency; this is not SQL implementation authorization. Multi-source-account identity/name reconciliation, new financial mapping families and empty/replay-only activation are intentionally unavailable; do not generalize without authority. Existing retry/new-key ALREADY_ACTIVE, semantic freshness, target transactions and historical snapshots continue under the accepted freeze.

This architecture was checked by reading source and schemas, not by executing nonexistent code. Unit/integration commands in the handoffs are future acceptance requirements. Architecture review, machine results, exact-candidate independent review and joint user acceptance are separate.
