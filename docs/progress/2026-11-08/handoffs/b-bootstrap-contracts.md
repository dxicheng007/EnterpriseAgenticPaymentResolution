# S0 Sol handoff — separate bootstrap verification contracts

Status: exact bounded contract implementation brief, subject to root dispatch and normal independent review. Root accepted the prerequisite architecture at proposal SHA-256 `dbd085abf914a0433e0f15423895a5082988acc4a05a7ce064fb825a319f1fa7` and handoffs SHA-256 `ffb0508ce928274beeb04e5dd04e385da2a0635f0dcf2b3a2eb88f4aea88ab44`; R1/R2 independently addressed. Read those ignored briefs plus the accepted activation-shapes freeze and applicable AGENTS. This brief specifies routine schema/helper/export details; it does not authorize readiness or activation.

## Scope and owned files

Create only:

- `packages/contracts/src/bootstrap-verification.ts` — browser-safe schemas, types and fixed coverage metadata. Runtime imports only `zod` and browser-safe `./common.js`; no canonical.ts, node:crypto, Buffer, filesystem, evaluator or runtime implementation imports.
- `packages/contracts/src/bootstrap-verification-hash.ts` — server-only result hash helper. May import existing canonical.ts and the new public schema; do not change canonical.ts.
- `packages/contracts/test/bootstrap-verification.test.ts` — contract and hash vectors, no mocked eligibility authority.
- `docs/superpowers/plans/2026-11-08-contract-freeze-v3-bootstrap-verification.md` — narrow S0 freeze, linking accepted architecture and explicitly listing later consumer obligations/dependencies.

Edit only:

- `packages/contracts/src/index.ts` — serialized additive exports for the two new modules; preserve every existing export. Root must serialize this shared file with other owners.
- `packages/contracts/package.json` — replace current string exports with an equivalent root plus two explicit additive subpaths, preserving all other fields:

```json
"exports": {
  ".": "./src/index.ts",
  "./bootstrap-verification": "./src/bootstrap-verification.ts",
  "./bootstrap-verification-hash": "./src/bootstrap-verification-hash.ts"
}
```

The existing root barrel already exports node-dependent canonical.ts and remains server-oriented; do not claim to make that barrel browser-safe. Browser consumers must use the new `@eapr/contracts/bootstrap-verification` subpath. The server helper remains available from its explicit subpath and the existing server barrel. Serialize this package export edit with root as well. No lockfile/dependency change is needed.

Forbidden in S0: edits to existing schemas, enum vocabulary, canonical.ts, v1 hashes, financial checks, fixture formats/pins, planner, evaluator protocol/runner/registry, sidecar, scripts, migration, UI, ActivationBundleV2 or live/provider configuration. Private completion envelope belongs to S3a, not this public module. No allocation or application of migration 005; S3b has its separate dependency on reviewed merged 004.

## Exact public exports

Export these values, and no generic framework:

- `BootstrapPinV1Schema`
- `BootstrapBindingV1Schema`
- `BootstrapAssertionIdSchema`
- `BootstrapCaseIdSchema`
- `BootstrapVerificationResultV1Schema`
- `bootstrapRequiredAssertions` (readonly frozen tuple in enum order below)
- `bootstrapRequiredCases` (readonly frozen tuple in enum order below)
- `bootstrapAssertionCases` (readonly frozen record, including frozen arrays, exact matrix below)

Export inferred types `BootstrapPinV1`, `BootstrapBindingV1`, `BootstrapAssertionId`, `BootstrapCaseId`, `BootstrapVerificationResultV1`. Use existing scalar validators/types, `strict`/prototype-key safeguards and current UTC normalization. All nested objects strict. The public schema must not import hashing merely to check shape.

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

Do not add public cases counts, diagnostic text, expected facts, filenames, paths, capture records or the private observed plan envelope. Existing result ID rule applies: `id === 'bootstrap-result:' + jobId`; both IDs must independently satisfy IdSchema (a job ID too long for the result prefix is invalid, not truncated).

## Exact normalization and structural checks

Reject duplicates before any sort; never silently deduplicate. The parser accepts valid permutations and emits normalized output:

- requiredProfileHashes lexically sorted; selected binding.profileHash must be a member. An empty set therefore cannot represent a valid selected binding.
- assertions contain all nine enum IDs exactly once, and cases all ten IDs exactly once, even for failed/unavailable results. Emit each array in its enum declaration order.
- assertion.caseIds are duplicate-free and emitted in BootstrapCaseId enum order. They reference only cases listed for that assertion in the fixed matrix. This is the canonical case-set order for this new result; no existing protocol ordering changes.
- Existing IsoInstantSchema normalizes asOf and createdAt to the repository's canonical UTC milliseconds. Do not add clocks/defaults or strip name/ID strings.

Fixed matrix (each exported array emitted in case enum order):

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

For status consistency:

1. Passed assertion requires exactly its complete matrix case set and every referenced case status passed.
2. Unavailable assertion requires empty caseIds. Cases may independently be available to other assertions; do not infer global unavailability from a single assertion.
3. Failed assertion requires a nonempty subset of its matrix case set, with all listed cases having passed or failed status (not unavailable). These IDs claim contributing executions; they need not be the full matrix. Do not manufacture case IDs for preflight/transport failure. The schema does not prove execution.
4. A passed captured_baseline case requires non-null planHash. Null planHash cannot accompany result.passed=true.
5. Internally claimed overall `passed` must equal `(planHash !== null && every assertion status is passed && every case status is passed)`. Reject mismatch rather than rewrite caller's boolean. This is only internal consistency of claims: exact nonempty financial plan, actual execution, independence and source support are still verified by S3, never inferred from this parser.
6. Missing/duplicate/unknown assertion or case IDs, duplicate required profile hashes, wrong result ID/job relationship, unknown properties, prototype-key input, invalid scalar or status combination fail parsing. Do not invent transitions or new assertion statuses.

A failed/unavailable result still contains the complete assertion/case vocabulary, so reviewers can distinguish a missing obligation from an explicit unavailable obligation. No schema acceptance is an eligibility or authenticity claim.

## Server helper export and hash semantics

In `bootstrap-verification-hash.ts` export exactly:

```ts
export function hashBootstrapVerificationResult(
  input: Omit<BootstrapVerificationResultV1, 'hash'> & {hash?: Hash}
): Hash;
```

Reuse existing hashCanonical; never copy the SHA/canonical encoder. Validate and normalize the complete proposed result using BootstrapVerificationResultV1Schema, supplying a fixed valid placeholder own hash only when input.hash is absent. If an own hash is supplied it must satisfy HashSchema, but its value is excluded from the preimage and is not compared by this helper. Remove only the parsed result's top-level hash and call hashCanonical on every remaining parsed field. Thus all profile/case set normalization and UTC normalization match parser output; unknown fields/duplicates/inconsistent claims throw. No nested hash is removed. Do not validate expected proof hash or source binding inside this generation helper; callers compare its return to a supplied result.hash separately. Repeated call with no own hash or any valid own hash gives the same digest for otherwise identical input.

The helper must not manufacture IDs, timestamps, counts, cases, booleans or missing assertions, or consult clock/files/environment. Do not export a result-issuing/eligibility function or trusted reader in S0.

## Hash meanings and the limit of shape validation

Document the accepted meanings beside the binding schema and in the freeze:

- snapshotHash means the source SourceSnapshot.contentHash, identical to the protected v2 convention, not hashCanonical(snapshot) used for immutable whole-object registry storage.
- eventsHash means hashCanonical of the complete duplicate-free captured event array sorted by event.id, after later envelope/capture validation.
- targetSnapshotHash means hashTargetSnapshot of the exact target passed to the planner, including its cutover asOf; keep any original recorded target hash separate in consumers.
- asOf must later equal the bound manifest.asOf, and profile/manifest/event/target/build/fixture/plan pins must later be verified against trusted immutable inputs.

S0 has no SourceSnapshot, manifest, event list or target object in the result wire. Therefore its parser cannot authenticate snapshotHash/contentHash or any of these external equalities. Both a content hash and a different well-formed registry whole-object hash can pass HashSchema. S0 tests must demonstrate that limit rather than invent a source lookup/check. Actual rejection of a whole-object hash substituted into a sidecar or bound result remains required by S2/S3 completion/registry tests, where the exact snapshot exists. Self-consistent passed=true and a valid hash remain untrusted claims until those consumers bind execution and authority.

## Required vectors and regression checks

Keep synthetic contract vectors local to the new test file. Do not mutate existing tests/fixtures or protected producer files.

- Complete structurally passing result: one selected profile included in required hashes; all nine assertions with exact matrix; ten passed cases; non-null arbitrary well-formed planHash; valid IDs/pin/scope/timestamps. This is explicitly a shape vector, not real verified output.
- Complete unavailable result: every assertion unavailable with [], every case unavailable, planHash null, passed false. Complete negative result: baseline and unrelated obligations can remain passed, one appropriate case failed, corresponding assertion failed with a nonempty executed subset, passed false. Test failed assertion cannot reference unavailable/out-of-matrix cases.
- Accept permutation and normalize profiles/assertions/cases/caseIds as above. Reject duplicates without deduplication, omitted IDs, extra IDs/status/property, prototype keys at nested result/binding/assertion positions, negative/fractional expectedTargetVersion, malformed hashes, mismatched result ID/job, and all boolean/null/status inconsistencies.
- Preserve strict public vocabulary and enum orders. Freeze coverage arrays against mutation in tests. Validate selected profile membership; do not assert other profiles are actually present in an absent artifact.
- Hash: pin one independently computed golden digest/preimage for the full synthetic vector using standard SHA-256 over the expected canonical JSON. Do not obtain the expected literal by calling the subject helper inside the assertion. Own-hash absent versus valid changed own hash is equal. Permutation/UTC normalization equal. Mutations to each top-level non-own field and representative nested build/fixture/scope/hash/status/case binding must affect the digest or fail parsing; changing a nested hash must not be excluded. Use coherent negative variants when status changes otherwise violate schema consistency. Duplicate/unknown fields must reject, not silently normalize away.
- Snapshot semantics vector: take known public baselineManifestA/SourceSnapshot fixture if one exists, or construct the documented content-hash preimage locally and a valid snapshot object. Independently calculate contentHash and hashCanonical(snapshot), show they differ, and show both well-formed scalar values pass the shape-only binding schema. Comment that S2/S3 must reject the substituted value with actual capture context. Do not write a fake S0 crossbinding validator.
- Browser-safety: inspect the direct public module import closure (only zod/common) and test/import the explicit new public subpath without bringing in the server helper. Do not claim the existing root barrel is browser-safe. Server hash export is present through explicit subpath and barrel; existing root imports still resolve.
- Run untouched existing VerificationReport/check vocabulary and v3-hash-compatibility tests; absent-bootstrap profile/artifact/bundle pins remain byte/hash-identical. No old schema/version changes.

Use Node 24/PostgreSQL 18 PATH convention, though S0 needs no database. Commands:

```sh
npm run typecheck
npm run test:unit -- packages/contracts/test
```

Report exact command outcomes and scope as partial contract proof. Do not run or claim new bootstrap runtime/financial eligibility tests that do not exist. Inspect `git diff --check` and final owned-file diff; root may have concurrent unrelated files. Commit a coherent contracts-only step with a labeled subject under 20 words, following root's dispatched branch instructions; no push/merge or source fixture publication.

## Freeze content and completion handoff

The new addendum must state exact exports/shapes, normalized order/matrix/status rules, hash helper/preimage, browser-safe subpath versus server barrel, source/target hash meanings and shape-only limitations. Explicitly preserve VerificationReport/check enum/private v2/planBatch/v1 hashes. Link the accepted architecture revision and record that private completion envelope, protected sidecar, observed plan provenance, source snapshot binding, runner builds, immutable registry, exact-subject financial bridge, review readiness and bundle-v2/worker trust are separate later slices. S5 financial capture/evidencePin attestation remains deferred and non-dispatchable.

Return owned-file list, commit hash if dispatched to commit, test results and exact addendum hash for independent review. Do not describe accepted schemas as activation proof. Stop after this scope; root dispatches the next prerequisite separately.
