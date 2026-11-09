# B A0 — additive activation authority contracts

Narrow implementation handoff for root dispatch. Architecture accepted by root after fresh R1/R2 fix review PASS. This brief authorizes only the A0 contract scope when dispatched; it does not authorize consumers, SQL, policy installation or activation. Read repository/packages/tests AGENTS and accepted freezes first. No model/provider setup required.

## Exact inputs and ownership

Accepted architecture inputs, unchanged by this brief:

- `v3-activation-authority-proposal.md` SHA-256 `23e7117c3b1ac8cb5c4c44b044ed2efd53530f55e38294f0165ec9ba9db1f737`.
- `v3-activation-authority-handoffs.md` SHA-256 `063bab1a66159f118f269c97c84a537c1529a64a0c8a7d743039f6b4096be45a`.
- Root archives these accepted files and publishes the freeze document at this checkpoint. Builder does not edit the accepted inputs or create a competing freeze.

Baseline for this handoff: `735e680088f3fb4ad43ed1a72439a1f293351879`. Root reports integrated S3a735e680 with full V2 machine pass; independent/joint acceptance remain separately recorded. S3b is active and owns reserved control005, still not assumed implemented. A0 does not depend on its implementation and cannot claim a registered result exists.

Root reservations for later approved tasks: control006 financial provenance, control007 review/activation intent, runtime002 parent activation storage. Existing control004 discovery and reserved005 bootstrap registry stay unchanged. These reservations grant NO SQL implementation permission in A0.

Exclusive allowed writes:

1. New `packages/contracts/src/activation-authority.ts` — strict safe schemas/types/diagnostic enum.
2. New `packages/contracts/src/activation-authority-hash.ts` — pure hashes and complete-tuple matcher.
3. New `packages/contracts/src/activation-bundle-v2.ts` — strict additive bundle schema/type and hash.
4. `packages/contracts/src/index.ts` — additive exports of the three modules only. A0 is its exclusive writer. Other builders own evaluator exports only and must request coordination for any contracts-index changes.
5. `packages/contracts/package.json` — add only explicit `./activation-authority`, `./activation-authority-hash`, `./activation-bundle-v2` export paths to those files; no dependency or other metadata change.
6. New `packages/contracts/test/activation-authority.test.ts`, `activation-authority-hash.test.ts`, `activation-bundle-v2.test.ts`. Public synthetic helper vectors may be local to these tests; do not edit shared fixtures.

No changes to canonical.ts, review.ts, runtime.ts, existing bootstrap schemas/hash, other tests, compiler/evaluator/control/worker/storage/source code, lockfile, SQL, scripts or docs. Read existing modules and tests freely. If extracting a shared canonical helper appears necessary, ask root for a reviewed ownership expansion; do not silently edit canonical.ts. A local explicit v2 canonical preimage using public canonicalJson/hashCanonical is sufficient. No production fixtures or installed trust hashes are authored.

## Exact schema inventory

Export each named `XSchema` and inferred type `X` below. Use `strict` and existing scalar schemas at every object level. No opaque new JsonObject, optional properties or coercive defaults. Preserve existing guardKeys protections. Reuse BootstrapPinV1Schema, BootstrapVerificationResultV1Schema and all existing member schemas; do not copy a divergent bootstrap result definition.

```ts
type EvidencePinV1 = {
  fixtureSetId: Id; fixtureSetVersion: '2'; bundleHash: Hash;
};
type CaptureAttestationV1 = {
  companyId: Id; sourceRef: Id; manifestId: Id; manifestHash: Hash;
  snapshotId: Id; snapshotHash: Hash; snapshotObjectHash: Hash; eventsHash: Hash;
};
type FinancialReservationV1 = {
  schemaVersion: '1'; jobId: Id; issuerId: 'eapr-control-registry-1';
  runnerId: 'eapr-financial-1'; protocolVersion: '1'; harnessVersion: '1';
  evaluatorBuildHash: Hash; purpose: 'construction'; evidencePin: EvidencePinV1;
  artifactHash: Hash; requiredProfileHashes: Hash[];
  capture: CaptureAttestationV1; hash: Hash;
};
type FinancialAttestationV1 = {
  schemaVersion: '1'; reservation: FinancialReservationV1;
  reportId: Id; reportHash: Hash; hash: Hash;
};
type ActivationTrustPolicyEntryV1 = {
  issuerId: 'eapr-control-registry-1';
  financial: {
    runnerId: 'eapr-financial-1'; protocolVersion: '1'; harnessVersion: '1';
    evaluatorBuildHash: Hash; evidencePin: EvidencePinV1;
  };
  bootstrapPin: BootstrapPinV1;
  capture: CaptureAttestationV1;
  artifactHash: Hash; requiredProfileHashes: Hash[];
  selectedProfileHash: Hash; scope: Scope;
};
type ActivationTrustPolicyV1 = {
  schemaVersion: '1'; policyId: Id; hash: Hash; entries: ActivationTrustPolicyEntryV1[];
};
type RegisteredScopeIndexEntryV1 = {
  accountId: Id; scope: Scope; profileHash: Hash;
  manifestId: Id; manifestHash: Hash; manifestAsOf: IsoInstant;
};
type RegisteredScopeIndexV1 = {
  schemaVersion: '1'; hash: Hash; entries: RegisteredScopeIndexEntryV1[];
};
type ActivationStateV1 = {
  schemaVersion: '1'; scope: Scope;
  activation: CustomerActivation|null; initialReceipt: SyncReceipt|null;
};
type ScopedReceiptQuery = {
  scope: Scope; expectedRequestHash: Hash; expectedBundleHash: Hash;
};
```

Structural normalization/refinements:

- requiredProfileHashes uses duplicate-free HashSet and lexical order. Reservation must have at least one required profile; policy entry has selectedProfileHash in its complete requiredProfileHashes set (hence nonempty). Exact correspondence to a real artifact is a consumer obligation.
- Capture snapshotId equals `snapshot:` + manifestId, following current immutable registration. snapshotHash and snapshotObjectHash remain distinct REQUIRED fields; neither equality nor inequality between their values is a structural rule. Consumers recompute each from its own preimage. No code substitutes one for another.
- FinancialAttestation.reportId equals `report:` + reservation.jobId. Structure does not verify actual registry issuance or completion.
- Policy entry scope.companyId equals capture.companyId. Entries reject duplicate complete normalized tuples; sort by hashCanonical(normalized entry). Different entries for different allowed build/pin tuples may share subject/scope. Do not reject them merely for that sharing. Empty policy entries array is valid data but permits no new application; composition must disable activation for it.
- Registered scope entries require accountId===scope.accountId, unique accountId, lexical accountId order; empty index is valid. Profile/manifest existence is not a schema claim. UTC timestamps normalize with existing IsoInstantSchema.
- ActivationState pairs null/null or nonnull/nonnull. Nonnull activation and receipt scopes equal envelope scope; receipt.activationId equals activation.id, receipt.epoch equals activation.epoch and receipt.artifactHash equals activation.artifactHash. This is the minimal first-activation view, not a full sync ConnectionState. Do not add status restrictions beyond existing CustomerActivationSchema or invent transitions.
- None of these parsers authenticate an issuer, assert policy is installed, read files, check current builds, compare a current target, run evaluators or infer monetary correctness. Hash string shape is validated; digest correctness is checked by consumers using the helpers, not implicitly by schema parsing.

## Exact additive bundle

Export `ActivationBundleV2Schema`, `ActivationBundleV2`, `hashBundleV2` from activation-bundle-v2.ts.

```ts
type ActivationBundleV2 = Omit<ActivationBundle,'schemaVersion'|'hash'> & {
  schemaVersion:'2'; hash:Hash;
  bootstrapVerification:BootstrapVerificationResultV1;
  financialAttestation:FinancialAttestationV1;
  authorityPolicy:{issuerId:'eapr-control-registry-1';policyId:Id;policyHash:Hash};
};
```

All inherited fields are required exactly as v1: request, reviewer, reviewPackage, artifact, profiles, manifest, verificationReport, snapshot, bootstrapEvents, previewPlan, semanticPreflight. Reuse each existing schema and v1 profiles uniqueness rule. New fields are required. V2 does not accept v1, and existing v1 parser still rejects v2/extra fields. No generic permissive union parser or default upgrade. Expose no private evaluator protocol.

Bundle parser's job is shape validation and the refinements already supplied by member schemas. Cross-member report/capture/target/plan/policy authorization remains later worker/control work. Do not add a fake `eligible`/`ready` helper or turn structural acceptance into issuance. Tests may construct mismatching but schema-valid bundles to prove hash sensitivity; those are not valid activation evidence.

## Exact hash and matching exports

`activation-authority-hash.ts` exports:

```ts
hashFinancialReservation(input: Omit<FinancialReservationV1,'hash'> & {hash?:Hash}): Hash;
hashFinancialAttestation(input: Omit<FinancialAttestationV1,'hash'> & {hash?:Hash}): Hash;
hashActivationTrustPolicy(input: Omit<ActivationTrustPolicyV1,'hash'> & {hash?:Hash}): Hash;
hashRegisteredScopeIndex(input: Omit<RegisteredScopeIndexV1,'hash'> & {hash?:Hash}): Hash;
hashFinancialReport(input: VerificationReport): Hash;
matchesActivationTrustPolicyEntry(
  entry: ActivationTrustPolicyEntryV1,
  expected: ActivationTrustPolicyEntryV1,
): boolean;
```

Own-hash helpers follow existing hashBootstrapVerificationResult convention: supply zero placeholder only when own hash is absent, parse/normalize full schema, omit only top-level own hash, hashCanonical remaining fields. Explicit undefined hash need not be accepted (existing helper semantics). Nested hashes remain present and hash-sensitive. No global recursive stripping. hashFinancialReport parses existing VerificationReportSchema then hashes the entire result including ID, createdAt and fixed diagnostic strings/arrays exactly as supplied; it does not sanitize, sort report arrays, drop fields or recompute eligibility. Trusted launcher supplies sanitized persisted report; later readers compare its exact bytes. Reordering report checks therefore changes reportHash even where v1 bundle canonicalization sorts those checks.

Tuple matcher parses both complete entry objects (invalid input throws Zod validation error), compares canonicalJson of normalized entries, returns true only for complete equality. No partial expected type, unioned allowlists, wildcard issuer/build, automatic trust upgrade or policy lookup. Caller selects actual installed policy entries, e.g. entries.some(entry => matcher(entry, expected)). Empty policy matches nothing. A0 proves tuple equality, not that policy provenance is trusted.

`hashBundleV2` signature mirrors existing own-hash helpers. Parse v2 with placeholder own hash; build canonical preimage as follows:

1. Remove only bundle.hash; schemaVersion remains '2'.
2. For inherited members reproduce **exactly** current hashBundle v1 normalization: profiles sorted by profile.id with canonical profile sets and bootstrap metadata; manifest streams by streamId/files by fileId; artifact normalizedPlan sourceContracts/resource, capture/streamId with resource sets, mappings/resource, allowedKinds and validators; sourceContractHashes/resource and requiredProfileHashes lexical; report profileHashes, checks/id, coverage profileHashes/required/executed/sourceRefs/eventKinds sorted. Preserve all other member fields and hashes.
3. Profile canonicalization is exactly current canonicalProfile: omit undefined bootstrap, sort bootstrap customer evidenceRefs and configuration bindings/termId; sourceAccountIds lexical; approvedLookups/id and entries/source with evidenceRefs lexical; contractTerms/id and evidenceRefs lexical; findings/id and evidenceRefs lexical. Keep profile.hash in bundle. Names and nonset contents remain exact.
4. New bootstrapVerification uses existing result schema's fixed assertion/case normalization and preserves full result/binding/pin/hash; financialAttestation uses normalized new schema including nested reservation hash, reportHash, evidencePin and all capture fields; authorityPolicy stays complete. Never replace an attestation with its hash alone.
5. Preserve bootstrapEvents input order and previewPlan operations/eventIds/lineage order, as v1 does. Hash complete canonical preimage with hashCanonical. Changing only own hash does not change output; changing any nested hash does.

No production array sorting beyond these explicitly declared sets. No hash helper reads a file, environment, clock, database or protected fixture.

## Fixed diagnostic vocabulary

Add `ActivationAuthorityDiagnosticCodeSchema` enum and inferred `ActivationAuthorityDiagnosticCode` in activation-authority.ts. These are future safe fixed codes, not route implementation or a change to generic DiagnosticSchema/ApiError. Do not expose child text, expected amounts, fixture internals or filesystem paths.

| Exact code | Future classification/meaning |
| --- | --- |
| FINANCIAL_ATTESTATION_UNAVAILABLE |503 missing/uncompleted/unattested trusted financial dependency |
| FINANCIAL_ATTESTATION_MISMATCH |409 provenance or exact binding conflict |
| BOOTSTRAP_VERIFICATION_UNAVAILABLE |503 missing/uncompleted bootstrap proof; retain frozen existing spelling |
| BOOTSTRAP_VERIFICATION_MISMATCH |409 exact bootstrap binding conflict; retain frozen spelling |
| ACTIVATION_POLICY_UNAVAILABLE |503 no usable installed policy |
| ACTIVATION_POLICY_MISMATCH |409 bundle/new application fails current exact tuple/policy binding |
| ACTIVATION_BUNDLE_MISMATCH |409 invalid digest or cross-member binding after successful structural parse |
| REVIEW_NOT_READY |409 new grant lacks complete combined readiness |
| REVIEW_STALE |409 null-aware head/package/companion conflict |
| TARGET_STALE |409 expected version/state conflict for new application |
| IDEMPOTENCY_CONFLICT |409 same key different exact request/scope association |
| ALREADY_ACTIVE |409 different key with already active scope; show existing scoped connection |
| SOURCE_SEMANTICS_UNAVAILABLE |503 semantic observation unavailable or malformed/mismatched-source response |
| SOURCE_SEMANTICS_MISMATCH |409 selected approved semantic key missing/mismatched or governing '*' |
| SOURCE_SEMANTICS_UNSUPPORTED_ORDER |503 conflicting independent semantic streams lack specified ordering |

These categories do not override successful-exact-retry precedence. Actual routes retain existing malformed400, authentication401/403 and unknown404 handling. AS reuses SOURCE_FORBIDDEN and SOURCE_NOT_FOUND for its existing forbidden/unknown-source categories; these two existing generic source codes need not be added to the activation-specific enum. Do not add enums for speculative financial behavior, paused/revoked transitions, ConnectionState or sync.

## Required regression proof

Write meaningful tests before implementation, confirm the expected missing/incorrect behavior, then implement within scope. Use public synthetic A/B fixtures and existing bootstrap test patterns; do not import protected evaluator fixtures or call a real runner.

- Strict/nested unknown fields and forbidden prototype keys reject, wrong literal versions/issuers/runners/purpose/evidence version reject, invalid scalar values reject. Assert exact exported enum values; unknown code rejects.
- Reservation/profile set uniqueness and sorting; selected policy membership; report/job association; index account/scope and duplicates; UTC normalization; paired ActivationState and receipt association; empty index/policy valid but zero tuples matched.
- Capture vectors deliberately use different content and whole-object snapshot hashes; mutate either independently and get different parent attestation/bundle digest. No schema aliases either field.
- Stable own-hash omission/placeholder and irrelevant object-key ordering; every new non-own scalar/member field affects the correct digest. Nested reservation/result/report/policy hashes are retained. Duplicate sets reject instead of being silently deduplicated.
- Declared set permutations preserve hashes. Nonset array permutations remain significant, especially full plan operations/lineage/events and reportHash's stored check/coverage arrays. Build an explicit vector where inherited bundle report-set normalization gives equal v2 bundle preimages when report order alone changes, but hashFinancialReport changes; updating attestation.reportHash then changes bundle hash. This distinguishes the two hash contracts rather than conflating them.
- Complete tuple match succeeds after permitted set normalization. Two independently permitted entries with distinct build/fixture combinations do not match a recombined expected tuple. Self-hashed data is only parsed/equal, never asserted authorized.
- Old ActivationBundleSchema rejects v2; new parser rejects v1 and missing new fields. Existing v1 profile/artifact/bundle fixtures and hash golden values remain unchanged. Use existing `v3-hash-compatibility.test.ts` as read-only regression oracle.
- V2 hash vectors for both A and B: metadata-bearing profile, all new members, fixed safe synthetic hashes and explicit expected golden digest. Independently inspect/test the canonical preimage; expected values must not be solely hashBundleV2 called on both sides of an assertion. These are public contract examples without registry issuance or protected execution claims.
- Member mutation tests cover bootstrap pin/binding/full result hash; financial evidencePin.bundleHash/capture.eventsHash/snapshotObjectHash/reportHash; policy ID/hash/issuer; full ensure/lineage plan fields. Use valid scalar mutations and rebuild dependent structural fields when needed, so rejection is not an accidental invalid fixture.
- Existing bootstrap contract tests and original financial report schema/check vocabulary remain unchanged and pass.

Required final commands with Node24 on PATH:

```
npm run typecheck
npm run test:unit -- packages/contracts/test
```

No SQL/integration/browser/live-provider/full-slice test claim is required from this contracts-only change. These commands are partial contract proof; neither makes V3 available. If unrelated concurrent work breaks a command, record exact failure and coordinate root rather than edit another owner's files.

## Delivery

Report exact candidate commit/hash, changed paths, export list, focused command results, and concrete limitations. Independently reviewed exact-candidate code is required before consumers use it. Do not edit current architecture hashes/status or claim worker trust configuration exists. Root owns archived architecture/freeze publication and future dispatch. A1/AS/A3a may follow only with their own assigned briefs; S3b continues its evaluator registry work without touching A0's contracts index.
