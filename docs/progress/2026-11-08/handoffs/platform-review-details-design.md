# Platform immutable review details — design handoff

Status: proposed additive design for fresh independent review; no executable contract, implementation, test result or E1 acceptance. Root assigns implementation after design acceptance. Resolves the missing Platform read needed by Experience's E1 approval context. Existing E1 review report is unchanged.

Authority: [A4 handoff](b-activation-review-handoff.md), [A4 checkpoint](platform-a4-completion-report.md), [PRD §14](../../../../prdv2.md#14-user-interface-and-observable-proof), [F3/F5](../../../superpowers/plans/2026-11-08-contract-freeze.md), and accepted A4/A5 implementation. Inspection found `review-preparation.ts` persists exact capture, parentView, plannerTarget and plan inside an immutable companion alongside protected proof/authority material. `review-repository.ts` already verifies canonical review/companion bytes and hashes on head reads. Worker activation copies `artifact.normalizedPlan.allowedKinds` and `.limits` into activation. This design exposes an explicit safe projection, never the companion.

## Read contract and semantics

Add authenticated `GET /api/review/:accountId/packages/:packageHash/details`. Both path values use existing Id/Hash schemas; reject any query string or body. No optional selectors, latest fallback, caller-provided source, reviewer, policy, proof, effective time or target version. Success is 200 and Cache-Control:no-store. Existing `/api/review/:accountId` remains the current-head package read; the browser takes its displayed package hash into this details request.

Authorize with the existing local reviewer read authorizer (`mutation:false`), require current account grant before lookup, then require the saved row's source grant before returning or projecting content. Service/task bearer tokens cannot replace reviewer authentication. Lookup immutable `prepared_reviews` by **account_id AND package_hash**, not just hash; return 404 REVIEW_NOT_FOUND for absent/foreign-account rows, 403 REVIEW_FORBIDDEN for missing grants, 400 REVIEW_REQUEST_INVALID for malformed input, and redacted 503 REVIEW_DETAILS_UNAVAILABLE for invalid stored bindings. Preserve the common correlation-ID/error envelope. No detailed parse paths, protected hashes or stored bytes in responses/logs.

Historical packages remain readable under current grants. Reading does not mean current, eligible now, approved or imported. Do not compare to current head or revalidate against current source/policy/parent to decide this read. The unchanged activation route remains responsible for fresh approval checks and stale rejection. Client must compare returned review ID/hash/scope and all displayed bindings against the package it requested; an out-of-order response cannot replace another selection. Approval remains explicit and sends the existing ActivationRequest exactly.

## Exact proposed browser-safe schema

Create `packages/contracts/src/review-details.ts`, importing only browser-safe schema modules directly. All objects below are strict, all IDs/hashes/times/integers use existing canonical schemas, all sets reject duplicates and serialize in stable ID order. `ReviewPackage`, `MutationPlan`, `ParentView`, `ContractTerm`, `ApprovedLookup` and `ProfileBootstrap` mean their existing strict schemas. Reuse leaf schemas; do not import contracts index/canonical/evaluator/storage into the browser graph.

```ts
type ReviewDetailsV1 = {
  schemaVersion: '1';
  reviewPackage: ReviewPackage;
  sourceRef: Id;
  capture: { manifestId: Id; manifestHash: Hash; snapshotId: Id; snapshotHash: Hash };
  artifact: {
    id: Id; hash: Hash; specHash: Hash;
    compilerVersion: '1'; runtimeVersion: '1'; targetSchemaVersion: '1';
  };
  profile: {
    id: Id; version: Version; hash: Hash; sourceRef: Id; scope: Scope;
    parentCustomerId: Id; sourceAccountIds: Id[];
    approvedLookups: ApprovedLookup[]; contractTerms: ContractTerm[];
    semanticVersion: Id; bootstrap: ProfileBootstrap;
  };
  baseline: ParentView;
  proposedImport: MutationPlan;
  futureScope: {
    allowedKinds: FinancialKind[];
    limits: { maxTransactionCents: 5000000; maxRecordsPerCycle: 1000 };
    validators: ValidatorId[];
    runtimeModelCalls: 'forbidden';
    safetyRulesVersion: 'frozen-v1';
    safetyRules: [
      'identity-bound-scope', 'source-contract-bound', 'reviewed-semantic-version',
      'explicit-supported-finance', 'target-version-bound', 'bounded-cycle'
    ];
  };
  evidence: { snapshotId: Id; referencedEvidenceIds: Id[] };
  parentWrites: 0;
};
```

`futureScope.safetyRules` is an exact literal tuple, not arbitrary text or an operator-selectable policy. `allowedKinds`, validators, limits and runtimeModelCalls are copied from the saved artifact's normalizedPlan. Preserve the existing limits' literal schemas. This route does not create a new configuration or enforcement mechanism. `parentWrites:0` describes this read only.

`profile` is an explicit pick, excluding findings/freeform model narratives. Requiring bootstrap matches current A4's supported first-import scope; an older/incompatible companion fails unavailable instead of filling defaults. `baseline` is already a public parent schema and includes original financial records, recorded snapshot time/hash and legacy references. `proposedImport` is the saved public plan schema including operations, derivation lineage and expected balance. No raw capture events, other profiles, full artifact, report or manifest is returned.

## Projection and binding checks

Add a repository read method for the account/hash pair that reuses the current stored-row decoder, including canonical-byte and review/companion digest checks. Refactor the private decoder only as needed; do not weaken existing head/intent reads. Use one immutable row SELECT, no head lock, transaction write, migration or new persisted projection. Parse consumed companion substructures on the server; they are not public contracts. Parse and validate the final strict response after constructing it field by field. Never spread `authorityContent`, `capture`, `entry`, `attestation` or `policy` into a response.

Before projecting, establish these saved-content equalities with existing canonical hash helpers on the server:

- Returned review ID/hash/revision/scope match the selected row and its canonical review hash; saved authority fields equal the review fields excluding ID/revision/hash. Verify authorityDigest against saved authorityContent in addition to the repository companion digest.
- Saved artifact, selected profile, manifest and plan recompute to the review's artifactHash/profileHash/manifestHash/previewPlanHash. Exactly one selected profile has that hash and matching full scope. Artifact requiredProfileHashes includes it. All sourceRefs and company identities agree with the saved row and capture. Do not select a profile by account alone.
- Capture snapshot's ID is `snapshot:` + manifest ID, its manifestId/sourceRef match, and its content hash is validated against saved manifest/event/evidence membership by the existing complete capture validation semantics. Do not call a registry or evaluator to acquire fresh material.
- Plan scope/artifact/profile/version equal the review; plan.asOf equals manifest.asOf. Baseline scope/version equal the review; baseline.asOf equals plan.asOf. Recompute baseline snapshotHash from baseline.records and compare saved recordedTargetHash. Saved plannerTarget must equal those exact records with only asOf replaced by manifest.asOf; validate its saved hash. Keep baseline.records.asOf distinct from evaluation time.
- Profile bootstrap and term/lookup associations retain their existing strict validation. Plan lineage operation indices must be in range. Referenced source events must exist in the saved capture; every evidence ID projected below must belong to its snapshot evidenceIds. Reject missing/conflicting references; never silently drop them or resolve them against a newer capture.

The evidence set is the sorted union of selected profile bootstrap customer evidence, contract-term evidence, approved-lookup-entry evidence, and plan lineage evidence (including constant mapping evidenceRef). The plan itself supplies field/event/derivation associations. Return only this referenced set, not all captured citations for other customers. Existing authenticated evidence reads remain responsible for opening a selected citation/original; require the returned citation snapshotId and ID to match this envelope. These links prove which immutable captured citation supports a displayed term or field; they do not prove evaluator success, current source state or activation. The evidence response must retain the existing original SHA-256/citation SHA-256 checks as well as exact snapshot/ID binding. No arbitrary original URL or local path is introduced. The saved capture contains citation IDs, not citation bodies: this read cannot independently provide excerpts. Evidence availability errors must remain visible in Experience and must not trigger latest-evidence fallback.

For financial display use `baseline.balanceCents` as before and `proposedImport.expectedBalanceCents` as amount still owed after the proposed import, both at `proposedImport.asOf`, currency USD. They are a saved prepared preview, never a worker receipt/current balance. No sum of payments/credits or new compute-on-read planner run. Existing plan hashing binds operations/expected balance/asOf; baseline's existing calculation was recorded by A4. Tests verify these values against independently expected fixture balances, including allocation/reversal/effective-time cases. GET does not establish new financial proof.

## Readable authority and stop-condition wording

Experience owns presentation of the following fixed vocabulary, explicitly labeled as reviewed rules rather than evidence of a running sync loop:

| Rule | Frozen meaning to display |
| --- | --- |
| identity-bound-scope | Only the displayed source/company/seller/source-account mapping is authorized. Unknown accounts are held; missing/ambiguous seller or unscoped governing semantic change pauses source financial application. |
| source-contract-bound | Records must match the pinned source contracts; unsupported source/schema inputs cannot be applied under this approval. |
| reviewed-semantic-version | Changed/unseen financial semantic revision holds before mapping; a governing unscoped revision pauses the source until scoped/reviewed. |
| explicit-supported-finance | Only allowed financial kinds and supported mappings apply; invalid money, unsupported reversals, missing dependencies or unsupported evidence hold affected work. Unallocated funds do not reduce invoices. Bootstrap ensure operations do not authorize invoice issuance or money movement. |
| target-version-bound | The proposed import requires the displayed expected parent version; a changed target requires revalidation through the existing approval path. |
| bounded-cycle | Enforce the displayed transaction and record limits with checked integer arithmetic; a violation cannot be applied under this authority. |

These meanings come from F1–F3/F5 and the normalized validator set; they introduce no new retry duration, auto-resume, dependency timeout, pause scope, or repair permission. Do not describe every hold as pausing an entire account/source. Mandatory validator completeness and correspondence to this vocabulary must be verified; unknown runtime/schema versions fail closed for this v1 projection until the catalog is revised.

## Known unavailable requirements and explicit boundaries

- CompiledArtifact has a content hash, compiler/runtime/target versions and specHash, but no numeric artifact version; the saved capture omits ConnectorSpec. Display “artifact hash” and the actual compiler/runtime versions, plus profile ID/version/hash. These are the exact available version identities for this task. Do not invent a numeric artifact/spec version, call a registry for one, or change existing preparation bytes to add one.
- Citation text/originals are existing pinned evidence reads, not saved companion fields. Experience must compose those reads and show missing evidence honestly. No protected proof material may substitute for public evidence.
- Current A4 returns a prepared package only after successful readiness gates; it does not persist a full blocked candidate with all reasons. This endpoint cannot invent a blocked-package model or make unsupported terms eligible. Existing prepare errors remain; any richer blocked review contract is a separate owner decision.
- No configurable stop-condition contract or operations-status proof exists here. The fixed frozen-rule explanation is not a new standing-authority grant, successful-sync claim or pause/revoke UI. Reviewer identity comes from the current authenticated session, not from an unsigned request or a fabricated historical approver.

## Ownership, implementation boundary and required checks

Platform: new `apps/control/src/review-details.ts`, repository immutable read/decoder reuse, additive route in `apps/control/src/routes/review.ts`, narrow activation-composition wiring if needed. Contracts owner/root reserves the new browser-safe schema file and focused contract tests. Experience subsequently owns typed client/details composition and approval display. Root reserves shared paths before implementation. No worker/compiler/finance/evaluator/discovery/source writes, database changes, old contract/hash changes, fixture repinning, receipt recovery redesign or generalized correction service.

Required exact-candidate checks:

1. Contract units reject unknown nested fields, unsafe cents, duplicate IDs/kinds/validators, invalid tuple/version, scope/hash/time mismatches and missing bootstrap. Preserve old ReviewPackage/ActivationRequest canonical fixtures byte for byte; check browser imports do not pull crypto/server/protected modules.
2. Real PostgreSQL/reviewer HTTP test prepares via accepted A4 with valid operator setup, then reads exact details and compares saved package/artifact/profile/plan hashes, baseline records and independent expected before/after cents/effective time, operations/lineage, authority kinds/limits and evidence membership. Do not seed arbitrary eligible flags as end-to-end proof.
3. Prepare a new head after the first package; read both exact hashes and prove original details unchanged. Unknown/foreign hash never falls back. Parent/source changes and missing current policy after preparation must not alter historical detail bytes or launch work; current authorization still applies.
4. Authenticate/authorize matrix: missing/expired session, service/task bearer, unauthorized account, revoked source grant, malformed IDs/hashes, query/body injection. No source-grant bypass through old packages. Success/error responses no-store and redacted.
5. Corrupt copied test rows/companions under isolated test-owner access: bad digest, recomputed outer digest with wrong profile/plan/baseline binding, missing evidence membership, different scope/version/time. Every case fails unavailable without leaking data. Assert exact allowlisted response keys recursively and sentinel exclusion for proof IDs/pins/policy IDs/hashes/paths/holdout payloads placed in protected companion members.
6. Snapshot relevant control/runtime rows and activity before/after repeated successful and failing GETs: identical. Spy/fail if details invokes prepare/revalidate, source observation, parent HTTP, candidate registry, protected launcher, publication or activation. This proves zero writes and no hidden latest-data reconstruction.
7. Run typecheck and focused new schema/service/real integration tests plus affected existing review preparation/activation-composition regressions. Record commands/candidate/results; no broad suite claims from focused checks. Later Experience browser proof must show exact-bound evidence, before/after amount, authority summary and explicit decision against this real endpoint. E1/V3 and joint clarity acceptance remain separate.
