# Contract freeze v3 addendum · bootstrap verification claims

S0 adds a separate wire contract for bootstrap verification. This addendum resolves the result and binding deferral in the [activation shapes freeze](2026-11-08-contract-freeze-v2-activation-shapes.md) under the [original F1 representation rules](2026-11-08-contract-freeze.md#f1--representation-identity-canonical-hashes). The accepted architecture input is the [bootstrap verification proposal](../../../.superpowers/sdd/2026-11-08-implementation-plan/briefs/v3-bootstrap-verification-proposal.md) at SHA-256 `dbd085abf914a0433e0f15423895a5082988acc4a05a7ce064fb825a319f1fa7` and [handoffs](../../../.superpowers/sdd/2026-11-08-implementation-plan/briefs/v3-bootstrap-handoffs.md) at SHA-256 `ffb0508ce928274beeb04e5dd04e385da2a0635f0dcf2b3a2eb88f4aea88ab44`. The [R1/R2 architecture review](../../../.superpowers/sdd/2026-11-08-implementation-plan/briefs/v3-bootstrap-architecture-fix-review.md) covers those exact local review artifacts.

## Public wire

Browser consumers import `@eapr/contracts/bootstrap-verification`. This subpath exports the five inferred types below and their corresponding `Schema` values. It also exports the frozen tuples `bootstrapRequiredAssertions` and `bootstrapRequiredCases` in the enum declaration orders below, and the frozen `bootstrapAssertionCases` record with frozen case arrays. Its import closure is the common scalar contracts and Zod. The package root is the server-oriented barrel and re-exports the new public and server modules.

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

All objects are strict, including nested objects. The existing common scalar validators and prototype-key restrictions apply. Both IDs satisfy `IdSchema` independently and the result ID equals `'bootstrap-result:' + jobId`.

Profile hashes are unique and normalize to lexical order. The selected profile hash is a member of the required set. Each assertion and case appears exactly once, even in a negative or unavailable result. Both arrays normalize to their enum order. Each assertion's `caseIds` is a unique subset of its row below and normalizes to case enum order. The parser rejects duplicates before normalization. `asOf` and `createdAt` normalize to UTC with milliseconds.

| Assertion | Required cases |
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

- A passed assertion lists its complete row and every referenced case is passed.
- An unavailable assertion lists no cases. Cases may contribute to other assertions independently.
- A failed assertion lists a nonempty subset of its row. Each listed case is passed or failed. These IDs are claims about contributing executions.
- A passed captured baseline requires a non-null plan hash. Overall `passed` is exactly the conjunction of a non-null plan hash, all assertions passed and all cases passed. The parser rejects a contradictory flag.

## Server hash

The server-only `@eapr/contracts/bootstrap-verification-hash` subpath and server barrel export `hashBootstrapVerificationResult(input: Omit<BootstrapVerificationResultV1, 'hash'> & {hash?: Hash}): Hash`. The helper supplies a valid fixed placeholder when the input has no own hash and validates any supplied own hash with the result schema. The preimage is every parsed and normalized result field except the top-level `hash`, encoded with the existing `hashCanonical`. Nested hashes are included. Callers compare the digest to the supplied result hash separately.

## Binding and consumer obligations

- `snapshotHash` means `SourceSnapshot.contentHash` and follows the protected v2 convention. The immutable object registry separately pins `hashCanonical(snapshot)`. S2 and S3 must check the actual captured snapshot association and reject substitution of the whole-object hash, including with recomputed enclosing hashes.
- `eventsHash` is `hashCanonical` of the complete, duplicate-free captured event array sorted by event ID after envelope and capture validation.
- `targetSnapshotHash` is `hashTargetSnapshot` of the exact planner target including its cutover `asOf`. Consumers retain any original recorded target hash separately.
- `asOf` equals the bound manifest's `asOf`. Consumers verify the exact scope, selected profile and complete artifact profile set, manifest, capture, target version, runner builds, fixture, and plan against trusted immutable inputs.

The parser receives scalar digests and status claims. It can validate either well-formed snapshot digest as a scalar. Exact binding, execution, provenance, independent source support, and a nonempty financial plan require later consumer evidence. A self-consistent passing result and valid digest alone grant no eligibility or authority.

S1 owns the pure bootstrap planner and projection. S2 owns the protected sidecar and independent oracle. S3a requires the private completion envelope, trusted build pins, exact request and capture binding, and the actual observed baseline plan with its canonical byte hash. S3b requires atomic immutable completion and a trusted reader with restart validation. Its migration 005 depends on the reviewed and merged control 004 catalog. S4 covers evidence-backed candidate metadata and the separately reissued same-subject financial report with full existing mandatory coverage.

S5 separately freezes the financial capture/evidencePin attestation and the trusted issuer, build and fixture policy. That attestation remains deferred and non-dispatchable. Review readiness requires trusted registered financial and bootstrap evidence for the exact subject plus immutable preparation associations. The later bundle transport dependency is a separately reviewed `ActivationBundleV2`, defined in proposal §6 as the v1 bundle fields with `schemaVersion: '2'`, its own hash, and a required `bootstrapVerification: BootstrapVerificationResultV1`. Worker trust and locked recomputation require their own implementation and verification.

S0 preserves the `VerificationReport` and check enum, private v2 verification protocol and evidence fixture pins, `planBatch`, and existing profile, artifact and activation bundle v1 hashing behavior.
