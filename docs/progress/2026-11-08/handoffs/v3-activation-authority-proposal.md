# V3 activation authority and transport — proposed freeze

Architecture review candidate only. Inspected HEAD `d867b434039cdc38aba340e6b7729e010b8db07b`, 2026-11-08. This is not implementation authorization, a deployed trust policy, or V3 acceptance. No SQL, product code, tests, commits or model access are part of this task. Root reserves future migration versions only after independent review.

## 1. Authority and boundary

Read together with prdv2 §§10–12 and local process boundaries, contract freeze F1/F3/F5/F6, activation-shapes addendum, bootstrap-verification freeze, bootstrap proposal §6 and S5 handoff, and historical v3-contract-proposal §§3–5. Frozen rules take precedence over historical illustrative migration names. In particular, historical “control004 review tables” is obsolete: implemented control004 belongs to discovery; control005 remains reserved for S3b bootstrap registry.

Root reports S1/S2/S4a/S4b accepted. At original drafting S3a runner was active work. Round-1 root update: S3a `ada5b2ac` has code-review approval; isolated integration candidate `735e680` is being checked, not accepted here. S3b/control005 remains unimplemented and awaits its prerequisites. This proposal neither reimplements those slices nor treats their missing ports as implemented. At the inspected HEAD, worker server has health and feature-plugin composition only; runtime001 contains ledgers/activity, not financial persistence. Financial jobs persist reports, but resolve fixture pins in memory; CandidateRegistration has snapshot/manifest but no event bytes. Existing public report/job schemas do not attest the evidence fixture bundle digest or captured event membership. Existing ActivationBundle is strict version 1. None of these facts permits activation today.

Scope is first explicit approval of one supported single-source-account customer, using a nonempty valid financial baseline and exact bootstrap proof. Preserve original evidence, reviewed inputs and imported financial records separately. Unsupported mapping families, empty/replay-only bootstrap, multi-account reconciliation, reapproval of paused/revoked authority, sync scheduling and status-transition endpoints remain outside this slice. Product imports existing records; it neither issues invoices nor moves money. Successful first activation grants bounded later authority; it does not claim a sync loop exists.

## 2. Strict safe attestation schemas

All new nested objects are strict, use existing scalar/prototype validators, reject duplicate sets, and normalize declared sets only. No secret, protected expected value, private path, assertion mismatch or raw fixture bytes crosses into these objects. These are proposed new contracts, not current exports.

```ts
type EvidencePinV1 = {fixtureSetId: Id; fixtureSetVersion: '2'; bundleHash: Hash};
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
```

`requiredProfileHashes` is a duplicate-free lexically sorted complete artifact set. `snapshotHash` is SourceSnapshot.contentHash; `snapshotObjectHash` is hashCanonical(the complete parsed registered SourceSnapshot), never an alias. `eventsHash` hashes the complete duplicate-free captured RawSourceEvent array sorted by event.id, with every contentHash validated. Event IDs must equal snapshot.eventIds and the complete manifest stream membership, and event stream/cursor/file/capture-boundary validation remains mandatory. Capture attestation is for the full capture, not a selected-profile event subset. Existing `verifyCaptureBinding` and immutable registry validation define membership; no manifest-only provenance inference.

Reservation/attestation hashes exclude their own top-level hash only and retain nested hashes. `reportHash = hashCanonical(validated persisted safe report)` including report ID, createdAt and normalized fixed diagnostic codes; preserve its arrays as stored. Reader and bundle must use those exact bytes. It is intentionally not hashBundle's report-set normalization. Hashes provide integrity, not issuance authority.

## 3. Trusted financial capture reservation, completion and read

Add a dedicated internal safe capture-attestation adapter under the evaluator owner. Only a protected evaluator process reads/validates the existing evidence-v2 bundle. It returns the above safe capture metadata and actual evidencePin.bundleHash through a fixed bounded private wrapper, never truth. Trusted launcher validates the response against immutable registered subject plus independently read captured visible events. Do not add protected reads to control, worker, source readers or product tools. Do not change VerificationReport, evidence-v2 file format, existing report JSON protocol or financial check vocabulary. An additive wrapper may invoke the unchanged evaluator entrypoint and return the report plus safe completion metadata to its trusted parent.

Before launching financial verification, allocate the server job ID, resolve the fixed trusted runner/build and construction evidence-v2 pin, validate capture, and atomically persist the immutable reservation alongside the queued job/budget transaction. Resolve I/O outside that transaction. Transition to running only after reservation exists. The actual evaluator invocation must use those same pinned fixture bytes: wrapper validates the same bundle/capture before and after run, compares the reserved digest and code closure digest before and after, and supplies jobId/reservationHash with completion. A pre-run inspection alone is insufficient. Mutation, failed validation, unavailable wrapper or mismatched completion fails the job; it cannot create an attested eligible report. No browser supplies a fixture ID, build or attestation.

Within one control transaction validate original job/reservation association, existing validateReport semantics (all 13 checks, complete exact subject/kinds, eligible recomputed), completion job/reservation hash, and safe capture/pin equality; insert immutable sanitized report and FinancialAttestationV1 and transition running→completed. A second byte-identical completion may return the original; any differing completion rejects without overwrite. The completion API is trusted-launcher-only. Existing completed jobs without attestations remain viewable but cannot satisfy activation; rerun them, never retroactively invent a pin association.

Proposed internal port:

```ts
readRegisteredFinancialAttestation(reportId: Id, expected: {
  artifactHash: Hash; requiredProfileHashes: Hash[];
  capture: CaptureAttestationV1; policy: ActivationTrustPolicyV1;
}): Promise<{report: VerificationReport; attestation: FinancialAttestationV1}>;
```

Reader joins completed job, reservation, report, attestation and immutable candidate/capture registration, verifies hashes and exact expected bindings, reruns report validation and current trust-policy tuple checks. No query of public summary substitutes. It validates the original immutable event capture by stored content address, including bytes hashes; raw events may be pinned in the new capture object store if current source retention cannot supply immutable reads. Unavailable member returns unavailable, mismatch returns conflict; neither returns a partial eligible result. It does not reread protected truth. Store safe immutable capture bytes or durable immutable references at reservation, not a mutable “latest source” pointer.

## 4. Exact current worker trust policy

There is no accepted current deployment allowlist at inspected HEAD. The following freezes how to obtain one, not fictitious literal hashes. An activation-capable composition must receive an operator-installed, read-only `ActivationTrustPolicyV1`; missing/empty/malformed policy disables new activation. It is independent of bundles and cannot be fetched or amended by a request, agent, browser or control grant writer.

```ts
type ActivationTrustPolicyV1 = {
  schemaVersion: '1'; policyId: Id; hash: Hash;
  entries: {
    issuerId: 'eapr-control-registry-1';
    financial: {runnerId: 'eapr-financial-1'; protocolVersion: '1';
      harnessVersion: '1'; evaluatorBuildHash: Hash; evidencePin: EvidencePinV1};
    bootstrapPin: BootstrapPinV1;
    capture: CaptureAttestationV1;
    artifactHash: Hash; requiredProfileHashes: Hash[];
    selectedProfileHash: Hash; scope: Scope;
  }[];
};
```

Entries are unique, sorted by their canonical hash; hash excludes only policy.hash. Each entry is an indivisible tuple: do not independently union builds/fixtures/captures and permit cross-pair combinations. Bootstrap pin fixes runner `eapr-bootstrap-1`, protocol `1`, exact evaluator/subject build, fixture ID/version/hash. Financial fixture version is exactly `2`, construction only. `bootstrapPin.fixtureHash` is descriptor hash, not evidence bundle hash. Trusted operator preparation must validate the protected descriptor and its `evidencePin` exactly equal the entry's financial.evidencePin, and validate descriptor capture/selected subject; export only the safe tuple. Worker never opens that descriptor. The policy and financial attestation together bridge the otherwise absent sidecar evidencePin association. Unsupported subjects have no entry.

Operator setup records and review must list actual build/fixture/capture/subject/policy digests after S3a/S3b and the financial attestation implementation stabilize. Build hashes change when source closures change; never substitute HEAD hash or automatically trust the bundle's build. Current policy is injected once per process lifetime; rotation requires atomic operator publication and restart. Both control and worker use an identical independently installed policy hash; bundle identifies the policy used. New applications must match current policy exactly. Exact already-successful retries remain recoverable under original immutable authority without re-running current build/fixture/semantic checks. Pending intents do not bypass current policy. This is a local filesystem/service-token trust boundary, not signing infrastructure or protection against a hostile laptop owner.

## 5. Additive bundle v2 and proof binding

The earlier S5 sketch carried bootstrapVerification only. That sketch was explicitly deferred; this proposal adds the safe financial attestation and policy association needed for independent worker checking. Do not silently call the smaller sketch sufficient.

```ts
type ActivationBundleV2 = Omit<ActivationBundle, 'schemaVersion'|'hash'> & {
  schemaVersion: '2'; hash: Hash;
  bootstrapVerification: BootstrapVerificationResultV1;
  financialAttestation: FinancialAttestationV1;
  authorityPolicy: {issuerId: 'eapr-control-registry-1'; policyId: Id; policyHash: Hash};
};
```

New strict parser/hash/export only; preserve v1 parser/hash/preimages and existing ReviewPackage/ActivationRequest. `hashBundleV2` uses the exact v1 canonicalization for inherited members with schemaVersion2, adds the complete normalized bootstrap result, attestation and authorityPolicy, and excludes only its own hash. Nested hashes remain. Full previewPlan operation/lineage/event order is preserved. Bootstrap result normalizes only its frozen assertion/case sets. First activation accepts v2 only; v1 is non-authorizing legacy data. Provide compatibility vectors and a mutation vector per new binding field before freeze publication.

Bundle is published only after durable authenticated reviewer grant by trusted control writer to `registry/activation-bundles/<hash>.json`, atomic publish, read-only to worker. Exact existing file must match canonical bytes; no overwrite, arbitrary path, symlink traversal or public upload. Worker validates service caller and hash-only lookup, then all schema/hash/version bindings and trusted issuer policy. `issuerId` alone proves nothing: the publisher directory and authenticated service capability are the authority boundary. Worker cannot access control DB, protected truth, model SDK or model credentials.

## 6. Combined preparation and null-aware head CAS

Internal immutable prepared record contains ReviewPackage, full canonical plan bytes/hash, canonical observed-plan byte hash from S3b, selected target baseline bytes/hash, capture attestation and immutable source/event references, financial report bytes/hash and attestation hash, bootstrap result ID/hash, current policy ID/hash, and all subject bindings. The target is authoritative worker state viewed for planning at manifest.asOf; distinguish recorded target snapshot hash/time from the copied planner target hash/time. BootstrapBinding.targetSnapshotHash is hashTargetSnapshot of that copied target at cutover. Store both if they differ. Preserve original recorded state on read.

Readiness requires: valid complete capture, exact full artifact profile set and selected profile/scope; required bootstrap metadata; eligible fully covered attested financial result; passed completed S3b result with exact current tuple pins; equal manifest/snapshot/events bindings across both proofs; exact bootstrap target/version/cutover and full observed plan bytes/hash equal proposed preview; exactly one nonempty valid financial baseline with no selected or unresolved source-wide blocker; current trusted parent version/state; and source semantic compatibility. A passing financial report alone never suffices. Ordinary preview at arbitrary asOf cannot imply readiness. No direct actor/result/plan/readiness input from browser.

Preparation captures `HeadToken = null | {packageId,revision,packageHash}` before any target/report/source I/O. Fingerprint canonical prepared content excluding generated package ID/revision/hash includes every field above, full plan and lineage bytes hash, recorded and planner target hashes/version, both proof identities/hashes, policy hash, capture and diagnostics/readiness. Diagnostic array order is deterministic and significant. No omitted companion association may leave a fingerprint unchanged. Semantic observed checkedAt is retained for audit, but is not authority/TTL or a reason by itself to churn a review; fingerprint includes sourceRef and exact normalized semantic versions, not observation time. Revalidate semantics for a new grant.

Short control transaction locks unique account head sentinel even if absent, compares null-aware token, returns unchanged current package for identical fingerprint, otherwise allocates monotonic revision and hashes/inserts immutable package+companion and CAS head. Stale I/O returns409 or recomputes from a fresh token; incrementing revision alone does not solve stale preparation. Known nonready inputs may produce a nonready review with safe diagnostics; unavailable dependencies must not fabricate target or proof.

For a new approval, authenticated reviewer/source/account authorization precedes lookup. Compare exact request bindings with current package and companion. Perform required dependency reads outside transaction. Under same head lock recheck token, requested package/hash/scope and persist immutable intent + canonical request/reviewer/bundle bytes/hash in ONE transaction. This is the reviewer grant linearization point. Publish/call worker after commit. Correction before lock wins and rejects stale approval; correction after accepted grant does not revoke it. Persist original actor/timestamp once; retries never create a replacement bundle.

## 7. Scope, parent, receipt and activation ports

Do not freeze an invented full sync ConnectionState here. Minimal first-activation read is:

```ts
type ActivationStateV1 = {schemaVersion:'1'; scope:Scope;
  activation: CustomerActivation|null; initialReceipt: SyncReceipt|null};
// Both null for registered unapproved scope; both nonnull for committed activation.
type ScopedReceiptQuery = {scope:Scope; expectedRequestHash:Hash; expectedBundleHash:Hash};
interface RuntimeActivationReads {
  readParent(scope:Scope, query:ParentReadQuery): Promise<ParentView>;
  readActivation(scope:Scope): Promise<ActivationStateV1>;
  readReceipt(key:Id, query:ScopedReceiptQuery): Promise<ReceiptResponse>;
}
```

Internal service-authenticated routes: GET `/internal/parent/:accountId`, GET `/internal/activations/:accountId`, existing GET `/internal/receipts/:key`, POST `/internal/activate`. Parent selectors retain frozen shape. Receipt query carries scope IDs plus expected hashes as strict scalar query fields (reject duplicate keys); success is replayed:true. Control supplies trusted values from stored intent. Validate caller and requested scope before key resolution; mismatched existing key/request/scope is409 IDEMPOTENCY_CONFLICT without leaking receipt. Missing receipt404 is not permission to replace intent. Malformed400, unauthorized401/403, dependency unavailable503, stale binding409. Failed reads never manufacture success.

Control proxy exposes scoped GET `/api/accounts/:accountId/activation` and existing/planned parent read; ALREADY_ACTIVE UI uses this authoritative activation read. These paths are proposed additive first-activation paths; independent contract review must check them against any concurrently reserved routes before freeze. No public arbitrary receipt-key capability. Full progress/checkpoint/status transitions remain separately frozen later.

`resolveRegisteredScope(accountId)` must use trusted immutable registered profile/manifest metadata, not browser supplied scope. Control owns canonical registration, exports a safe hash-validated read-only registry view for worker containing exact account/scope/profile/manifest mapping. Worker can resolve registered inactive scopes without a DB write. Ambiguous account mapping or foreign scope fails. Proposed safe index entry is `{accountId, scope, profileHash, manifestId, manifestHash, manifestAsOf}` with an index-level schemaVersion1 and canonical hash; accountId equals scope.accountId. Trusted registry writer publishes immutable profile/manifest members first, then atomically replaces its current index. Worker captures one validated index and member set per read. Entry selects the current registered review subject explicitly; multiple historical profiles do not become ambiguous fallback choices. Conflicting scope for an already registered account rejects; absent member/hash mismatch fails closed. The index is within the trusted registry mount, excluded from public tools, and contains no authority. Replacing its selected capture cannot alter an existing runtime target or successful receipt. No POST registration exposed to product tools, no worker control-DB access. A known inactive account returns deterministic empty version0 at registered manifest.asOf; hash may be unstored and historical lookup404. Snapshot selectors are scoped. GET loads stored requested snapshot or latest state; computes envelope balance/asOf at explicit query or injected clock, preserves records.asOf/version/hash; does zero writes. Preview uses copied records at explicit asOf and zero writes. ActivationState read also performs zero writes.

Semantic port `readCurrentSemantics(sourceRef): Promise<SemanticPreflight>` has a source-authoritative producer, not merely consumer adapters. Handoff AS assigns source owner A the reader in `packages/sources/src/current-semantics.ts` and source-service exposure; C owns private route `GET /internal/sources/:sourceRef/semantics` and its simulator/control-service composition. The source service alone reads its source tables. Both control readiness and worker new activation depend on accepted AS producer/route/composition; neither can substitute a browser response or bundle observation.

The producer takes the existing source publication transaction lock `lockSource(client, sourceRef)` from uploads.ts, also used by dossier publication and scenario append. On that same transaction client, resolve the pinned source definition, select its latest published manifest by numeric epoch (without requiring dossier completeness), validate manifest/hash/source bindings, copy semanticVersions, and fold validated semantic_change events strictly after each manifest stream resumeAfter watermark in numeric sequence order. Resolve semantic-bearing resources/streams from the pinned definition; do not hardcode A/B names, scan ordinary financial events as metadata, or fall back to the latest complete capture. Existing A/B each has one semantic-bearing stream. Conflicting independent semantic streams have no defined total order and must fail unavailable until separately specified. Capture checkedAt once using the injected clock for this locked observation; no source mutations/activity/snapshot writes occur. The lock serializes this observation with publication and append; it is not held across a worker transaction or network call.

Producer route authenticates a distinct server-to-server source-read capability and allowlisted sourceRef before reading; it grants no source operator injection capability. Worker uses a configured allowlisted origin and fixed route, receives no control DB credentials, and never accepts a browser-supplied URL. Control and worker obtain independent observations for new grants outside their grant/import transactions; successful exact retries need none. Consumers strictly parse SemanticPreflight, require requested sourceRef equality, and compare every selected `sellerEntityId/sourceAccountId` key with both approved profile revision and baseline semantic key. Missing/mismatched selected keys or governing '*' block; unrelated keys do not. Never order opaque revision IDs. Financial events do not rewrite semantic metadata. Unavailable/malformed responses fail closed (503 dependency unavailable;403 forbidden;404 unknown source); B centrally freezes any added diagnostic names. No TTL or cross-database atomic observation guarantee.

AS acceptance includes latest published incomplete manifest overriding an older complete one, post-watermark semantic events at numeric sequences2/10, no double folding at the watermark, selected/unrelated keys and governing '*', ordinary financial events leaving metadata unchanged, publication/append barrier consistency under the shared lock, authentication/allowlist failures, unavailable producer and malformed response. A4/A5 must prove failure blocks new grants while successful exact receipt recovery still works.

A3 has two explicit dependency stages: A3a schema/repositories can begin after A0 and root file/migration assignments; A3b composition and acceptance of registered-inactive parent/activation reads require A3a plus A2's real scope-index publication/loader. Stub registry tests do not complete A3b. A4/A5 require completed A3b, not only A3a. No scope may be inferred from a URL while A2 is pending.

## 8. First import and retry order

Both boundaries authenticate/authorize before resolving keys. Exact successful key association is checked before current head, policy, target or semantic freshness and returns original stored receipt replayed:true. Same key different canonical request/scope conflicts even if its hash is self-consistent. Different key with existing active scope returns409 ALREADY_ACTIVE before stale target; show existing scoped connection, never renew authority. Paused/revoked authority is not eligible for this first-activation path; it requires separately specified transitions/review, with no new writes here.

A pending accepted control intent reuses original bundle, queries worker receipt first, republishes original bytes if needed, and may submit same internal request. Worker new application validates v2 and current policy, observes semantics outside DB, and rechecks successful key association if freshness/policy checks fail. Also recheck active scope before reporting stale-target failure. No successful receipt means original intent remains pending/failed-observed, not an assertion that runtime rolled back after an unavailable response.

One runtime transaction: insert-or-lock unique scope sentinel; lock activation; recheck global key association and active authority; lock target account and affected stable record/economic identities in deterministic order; check expected target/version and current state; recompute full plan with immutable bundle artifacts/profiles/events at manifest.asOf; compare canonical full bytes AND hash to bundle, review and bootstrap result. Validate all limits, exact ensure equivalence, checked balances and financial invariants. Never call source/network/model inside transaction. Persist immutable accepted bundle/request association, activation epoch1/status active/reviewer/approvedAt from injected clock, cursor vector copied in canonical order from entire manifest including zero streams, artifact allowed kinds/literal limits, full target version increment once (the empty initial version0→1 case), original records and scoped customer association, approved target snapshot, receipt, delivery/economic outcomes and activity atomically. Only the selected applied plan event IDs receive applied outcomes; unrelated capture members are not falsely acknowledged as applied for this customer. Target version and activation epoch are distinct.

Economic uniqueness is global full EconomicIdentity `(sourceRef,sellerEntityId,kind,recordId)`, excluding account alias/event/version; delivery uniqueness is `(sourceRef,eventId)` with immutable original bytes. Persist lineage and original economic associations; conflicting content or version never creates duplicate money. Account IDs globally unique, all target reads/writes scoped; customer storage includes scope even though ParentCustomer wire does not. Stable target-ID locks plus DB unique constraints close cross-scope economic races. WithTransaction retries40001/40P01 up to three complete attempts; recompute/recheck inside each, no partial externally visible receipt/activity. Receipt fields follow existing SyncReceipt, one actual applied nonempty plan; no zero-effect receipt invented.

## 9. Persistence ownership/order and gaps

B database owner authors all future SQL after root reserves versions; no applied migration edits. Logical control migration A (financial reservations/attestations/capture references) follows existing004 and reserved005; logical control migration B (review heads/packages/companions/intents/receipt mirrors) follows A and005. Runtime migration R follows runtime001 independently, but activation consumers require both control prerequisites. Labels A/B/R are NOT numeric reservations.

A: immutable financial reservations job FK/unique, immutable attestation report/job FK/unique, canonical bytes/hashes and capture object references. B: scope/head sentinels with globally unique account, immutable package+companion unique package hash and account/revision, immutable intent global unique idempotency key and exact request/reviewer/bundle bytes, observation-only receipt mirror. Never reuse discovery reviewer_actions table for activation intent. R: unique scope/activation and account mapping, current target plus immutable scoped snapshots, scoped metadata records, global economic identity index, delivery inbox/outcomes, immutable bundle/request/key/receipt association, lineage and approved-snapshot association. Store canonical bytes plus digest where byte identity matters; JSONB alone does not prove original canonical bytes. Progress is only committed bootstrap cursor/outcomes; future sync schema requires its own freeze. Use existing transactional activity counter. Grant minimum app-role rights; neither service gets cross-DB connection or privileged DDL.

No new material financial/product decision is needed for the bounded first single-account path under existing specifications. Unsupported cases stay blocked. Outstanding delivery decisions are technical and explicit: independent acceptance of this attestation/v2 expansion/policy schema; exact deployed trust tuples after final evaluator builds; independent compatibility review of the proposed scope-registry index and read paths; root migration reservations and one-writer paths; S3a/S3b completion and real exact-subject financial+bootstrap proof. No literal production allowlist, implemented attestation reader, live activation, complete ConnectionState or reapproval behavior is claimed. If broader behavior is requested, return that exact gap to product owner rather than guessing.

Validation of this proposal was source/spec inspection only. Future machine checks, fresh independent exact-candidate review and joint user acceptance remain distinct.

## Round 1 architecture corrections

Addresses exact R1/R2 from `v3-activation-authority-independent-review.md` reviewing original proposal SHA-256 `5db6e910f7e1f359462dce82c8ae1e8879c97a8ef3983fc8c15b2c15f3f46363` and handoffs SHA-256 `501a2acae8abde46a00a7cfec887951c8c2d952ef0ef4f9f063aeb3242fcb95f`; originals are preserved as `-r0.md` by root. R1 adds the source-owned locked observation/private producer route/composition, exact consumer dependencies and producer/failure tests. R2 splits A3a early persistence from A3b composed registered-inactive reads and corrects the handoff graph. Narrow source inspection at `ec88d8efff721f14a1482d3e0fbe436de4192c54` confirms existing uploads.lockSource, dossier numeric-epoch publication and scenario append locking; this is not review of other intervening implementation. No financial-policy change, SQL, migration number assignment, implementation, tests, commit or subagent. Fresh scoped architecture review remains required.
