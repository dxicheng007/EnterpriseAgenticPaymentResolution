# Contract freeze v2 addendum · activation and parent-read shapes

Base commit `12b1b2b3b1924c2bbef7be64998e8c4178c3c1a1`. The independently reviewed architecture input is `v3-contract-proposal.md` with SHA-256 `2d47fa05c82c5a8f04096fa22dd4e4025620a5f2d7e35ccb35bd9a568879380a`. The approval in `v3-contract-fix-review.md` covers this contract patch. This addendum resolves the corresponding schema deferrals in the [original freeze](2026-11-08-contract-freeze.md#foundation-scope-and-sequencing). The original plan and F1/F3/F5 rules continue to apply. T3 implementation and acceptance remain separate.

## Executable schemas

All objects are strict, including nested objects. F1 scalar validators and prototype-key restrictions apply. The schemas and inferred types are exported through the contracts package.

```ts
type ProfileBootstrap = {
  customer: {id: Id; displayName: string; evidenceRefs: Id[]};
  billingConfigurationIds: {termId: Id; id: Id}[];
};
// CustomerProfile gains bootstrap?: ProfileBootstrap

type BaselineCursor = {streamId: Id; resumeAfter: Cursor};
type CustomerActivation = {
  id: Id;
  scope: Scope;
  artifactHash: Hash;
  profileHash: Hash;
  manifestHash: Hash;
  baselineCursors: BaselineCursor[];
  allowedKinds: FinancialKind[];
  limits: {maxTransactionCents: 5000000; maxRecordsPerCycle: 1000};
  reviewerId: Id;
  epoch: Version;
  status: 'active' | 'paused' | 'revoked';
  approvedAt: IsoInstant;
};
type ParentReadQuery = {asOf?: IsoInstant; snapshotHash?: Hash};
type LegacyReference = {
  targetRecordId: Id;
  identity: EconomicIdentity;
  sourceRecordVersion: Version;
  sourceEventId: Id;
};
type ParentView = {
  scope: Scope;
  version: NonnegativeInteger;
  asOf: IsoInstant;
  snapshotHash: Hash;
  balanceCents: SafeInteger;
  records: TargetState;
  legacyReferences: LegacyReference[];
};
```

- **Bootstrap.** The customer ID equals the profile's `parentCustomerId`. The name is nonempty and preserved exactly. Evidence references form a nonempty ID set. Configuration bindings cover exactly the profile's term IDs and are unique by both term and configuration ID. The candidate builder must source the observed legal name and applicable citation from captured evidence. Configuration IDs are pinned reviewed metadata. Schema parsing verifies structure and cross-references inside the profile. Citation support, authority and eligibility require separate evidence and verification.
- **Activation.** The cursor vector is unique by stream ID and emitted in canonical stream ID order. Allowed kinds follow the existing set rules. Both arrays are structurally allowed to be empty. A new grant copies the entire cursor vector from the bound manifest, including streams at cursor zero, and copies the allowed kinds and limits from the bound artifact. The consumer compares those sets and the exact scope/profile/artifact/manifest bindings. The authority selects one profile even when the artifact carries several. Resolve source and semantic policy from the immutable bound subject. First authority is epoch 1 and active, with `approvedAt` taken once from the injected runtime clock. The manifest's `asOf` is the cutover time. An initial nonempty bootstrap advances target version 0 to 1 once, separately from the activation epoch.
- **Parent query.** Both selectors are optional and independent. The object parser performs scalar validation and standard UTC normalization. The route rejects duplicate URL keys and sets the default evaluation time. The parser supplies no defaults.
- **Parent view.** Envelope scope and version equal recorded state scope and version. Envelope `asOf` is the evaluation time and may differ from the recorded `records.asOf`. Legacy references match all financial records one-to-one by ID, full economic identity, source record version and event ID. Ambiguous duplicate target IDs fail. Producers emit references in canonical target record ID order. Snapshot hash and balance correctness are consumer obligations. Existing `TargetState` scope checks and strict `ParentCustomer`, `ParentAccount` and `BillingConfiguration` wire shapes remain in force.

## Canonical hashes and development examples

`hashProfile` and `hashBundle` share the same profile preimage. Absent or explicitly undefined bootstrap is omitted, preserving existing absent-bootstrap profile, compiled artifact and bundle hashes. Present bootstrap sorts evidence references by ID and configuration bindings by term ID, with duplicate evidence, term or configuration IDs rejected. The name is serialized exactly. Existing profile sets and the `hashArtifact` and `hashTargetSnapshot` preimages are unchanged. `hashReviewPackage` excludes only its own `hash` and includes all remaining fields, including ID, revision, referenced hashes and diagnostics in array order. Object keys remain canonical. No compiler, runtime or target schema version is bumped by this addendum.

The [development fixtures](../../../tests/fixtures/index.ts) and [contract examples](../../../packages/contracts/test/v3-contracts.test.ts) describe synthetic A and B. For A, a bootstrap extension to the profile pins customer `{id:'buyer-shared-1',displayName:'Shared Buyer',evidenceRefs:['ev-a-identity']}` and the sole binding `{termId:'term-a-1',id:'config-a-1'}`. A first A activation example selects `scopeA`, the exact compiled A artifact, profile and `baselineManifestA`, with `baselineCursors:[{streamId:'a-finance',resumeAfter:'5'},{streamId:'a-semantics',resumeAfter:'0'}]`, all five financial kinds, the literal limits, epoch 1 and status active. The shape example uses the older compiled fixture to illustrate field bindings. It carries no authority. For an actual bootstrap subject the new metadata requires a revised profile hash, recompilation with the revised `requiredProfileHashes`, and independent verification of the exact new subject. Existing profiles remain valid for financial-only preview.

A recorded `baselineA` view is version 1 with `records.asOf` at `2026-10-01T00:00:00.000Z` and a snapshot hash over `{scope,records}`. At evaluation time `2026-10-03T00:00:00.000Z` this same record set has balance 80000 and five legacy references. Evaluating the same snapshot at `2026-08-01T00:00:00.000Z` yields balance 0 and the same recorded time and hash. These are development examples. The [compatibility tests](../../../packages/contracts/test/v3-hash-compatibility.test.ts) pin A/B profile and artifact hashes and the representative bundle hash from the untouched base.

## Future consumer obligations

### Read-only parent and preview

Resolve account scope from trusted registered profile data. GET loads the latest known state or the stored snapshot selected by `snapshotHash`. Preserve recorded `records.asOf`, version and hash. Choose envelope `asOf` from the explicit query or the injected current clock even for a historical selector, and compute balance at that instant. Historical cutover balance requires an explicit cutover `asOf`. Preview supplies its explicit instant on a copy of the records. Persist known snapshots only in authorized mutation commits. GET and preview perform zero writes. A known unapproved scope has a deterministic version-zero empty state at its registered manifest instant. Its unstored hash need not resolve historically. Unknown scoped snapshots or scope mappings return 404, and malformed selectors return 400.

Store parent customer association internally by scope and customer ID. All reads, equivalence checks, references and writes are scoped. Compare the same canonical record bytes in planning and persistence. Exact reuse preserves existing records. Conflicts hold without merging evidence, renaming the customer or rewriting terms.

### Bootstrap and readiness

`planBootstrap` is a future pure port alongside the unchanged four-argument financial `planBatch`. Use the selected profile and manifest cutover. Require exactly one nonempty valid financial baseline plan with no selected-scope or unresolved source-wide blocker. A no-plan, replay-only or blocked result cannot become an ensures-only ready review.

The full plan is customer ensure, account ensure, configuration ensures in lexical configuration ID order, then existing financial operation order. Configurations copy entire approved terms. Exact reuse retains explicit ensures. Metadata lineage has one entry per record leaf, including the array pointer for empty arrays, with RFC 6901 pointers inside `operation.record`. This covers customer ID/name/evidence, account ID/scope/customer/source/account IDs, and configuration ID/scope/all term fields including null `validToExclusive`. Sort lineage lexically by target pointer within each metadata operation. Each entry has empty source event IDs and source paths, null mapping and canonical evidence and derivation input sets. Customer lineage uses profile ID and the approved customer citations. Account lineage uses profile ID and applicable identity-map/customer citations. Configuration lineage uses profile and term IDs and applicable term citations. Support observed values with applicable evidence and identify reviewed inputs for derived fields. Shift existing financial operation indices by the ensure count, retaining financial lineage order and event IDs. Hash the complete plan and lineage. The worker recomputes it under the authoritative target lock and compares canonical bytes and hash against the bundle and review, including scope, subject, effective instant and version bindings.

The current evaluator runs the financial plan and omits ensures from comparison. An eligible financial report alone cannot make a review ready. The independent protected bootstrap runner must execute and check exact customer, account and configuration records, name and citation support, scope, term content and bindings, equivalence/conflict cases, metadata pointers, lineage and ordering, shifted indices and full hash. Expected results come from an independent protected oracle. Freeze the separate bootstrap assertion result/binding contract with exact runner, build, subject and manifest pins before consumption. Until the assertions execute and pass for the exact subject, review readiness stays false and activation stays blocked. The current VerificationReport, check vocabulary, C1, current C2 and private evidence contracts remain governed by their existing definitions.

### Reviewer intent and retries

Capture a null-aware head token before I/O. Serialize absent and present heads when comparing the token under lock. Reject or recompute stale preparations. Reuse identical prepared content via its fingerprint before allocating a new revision. In one short control transaction lock and verify the current head and persist the immutable reviewer grant, exact canonical request, authenticated reviewer, scope and original bundle association under a unique key. Publish bundle bytes atomically and call the worker after commit. A later correction does not revoke an already accepted exact intent.

Both boundaries authenticate and authorize scope before resolving prior successful requests. An exact successful retry returns the original receipt with `replayed:true` before current head, target or semantic freshness checks. The durable original bundle can be republished after restart. Same key with different request bytes or scope returns 409 `IDEMPOTENCY_CONFLICT`. For a different key with existing active scope return 409 `ALREADY_ACTIVE` before stale target rejection, with no additional authority. The client reads the existing connection through its scoped read endpoint. For a new application the worker checks current semantics before the transaction, rechecks successful key association if freshness fails, and rechecks key and authority under scope lock. Target, activation, receipt, delivery outcomes, approved snapshot and activity commit atomically. The worker's receipt is authoritative.

### Source semantic observations

Discover semantic-bearing streams from the pinned source definition (A `a-semantics`, B `b-semantics`). The source reader starts from the latest published manifest even when its capture is incomplete, and folds subsequent semantic events in numeric stream sequence. Ordinary financial events do not rewrite metadata. Require exact matching selected source-account keys and approved semantic revision, block governing `*` or missing/mismatched selected values, and isolate unrelated scoped changes. Opaque revision IDs have no inferred ordering. `checkedAt` records an observation, without TTL. Control and worker obtain independent authoritative observations for new grants, outside worker transactions. Successful exact retries reuse the original result.

## Remaining ports and verification

Future consumers include the candidate metadata builder, preview/bootstrap planner, protected runner/oracle/results, report registry and review readiness, worker bundle validator/import, source semantic reader, parent repository/read transport, UI and integration fixtures. Assign these paths before implementation.

Deferred ports include `planBootstrap`, `readRegisteredReport`, `readCurrentReview`, semantic read transport, trusted scope registry resolution, review/head/intent persistence and private parent/receipt APIs. `ConnectionState` and its checkpoint/progress contract also remain deferred. The executable additions are the schemas and hashing behavior above.

Later verification must prove zero writes on GET and preview, immutable historical reconstruction after version advances and backdated events, exact retries after head or semantic change and response loss, cross-scope/key conflicts and competing grant races, null-aware stale-preparation and correction/grant barriers, scoped parent conflicts, full plan and lineage binding, bootstrap unavailable/no-plan blocking, atomic rollback and receipt recovery. These are consumer proof obligations. The contract tests exercise shapes, cross-references and canonical hashing.
