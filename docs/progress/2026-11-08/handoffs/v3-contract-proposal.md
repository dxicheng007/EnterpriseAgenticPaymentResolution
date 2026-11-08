# Pre-T3 contract proposal — not yet accepted

Inspected baseline: main 5d890c3. Architecture-only additive brief; no implementation, commits, model/provider configuration, or modification of original plan. B must publish and independently review a versioned contract change before consumers implement these additions. Actual activation remains gated on complete V2 eligibility for the exact final subject.

Authoritative references (repository-relative):
- docs/superpowers/plans/2026-11-08-contract-freeze.md: F1 identity/hashing, F3 target/preview, F4 semantic keys, F5 activation/receipts, F6 protected verification, F8 fixtures, and final explicit CustomerActivation-schema deferral.
- docs/superpowers/plans/2026-11-08-shared-contracts.md:99–155: authority vocabulary, ParentView, service signatures, routes, SQL and locking.
- docs/superpowers/plans/2026-11-08-implementation-plan.md:216–254: original T3.1/T3.2.
All new types/rules below are proposals awaiting the contract review unless explicitly identified as existing requirements or direct user decision.

## 1. User-resolved repeat approval

Direct user decision relayed by integrator: “Reject the new approval and show the existing connection (recommended).”

Proposed precise mapping to the existing ApiError contract:
- Same idempotency key and exact canonical ActivationRequest: return the original immutable ReceiptResponse with replayed:true, regardless of changed current target version. A retry recovers the prior result; it does not request fresh authority.
- Same key and different canonical request:409 IDEMPOTENCY_CONFLICT (existing F5).
- Different key for an already-active requested scope:409 ALREADY_ACTIVE, message “This customer already has an active connection. Open the existing connection.” No new authority, bootstrap, receipt, target version, or monetary effect. This diagnostic name/message is proposed; the behavior is user-decided.
- Keep ApiError exactly {code,message,diagnostics,correlationId}. C obtains the existing connection through the already specified GET /api/connections/:accountId, not an invented redirect URL in the error. Do not automatically retry with another key.
- Under the unique-scope lock, check exact prior key first, then current authority. Two competing distinct-key first approvals: one commits, the other receives ALREADY_ACTIVE and can read that committed connection. Two identical same-key first approvals: one commits and the other receives the same receipt.
- A rejected new key does not create another successful idempotency/receipt association. Reviewer audit may record the rejection separately.
- Paused/revoked and reenrollment behavior is not broadened by this decision. F5 still requires fresh review for revoked state; T3's first vertical slice does not implement pause/resume/revoke.

## 2. Concrete CustomerActivation proposal

Complete the existing shared-contract vocabulary with strict executable schemas; all scalar aliases use the existing contract validators, all objects reject unknown keys.

    type BaselineCursor = { streamId: Id; resumeAfter: Cursor };
    type CustomerActivation = {
      id: Id;
      scope: Scope;
      artifactHash: Hash;
      profileHash: Hash;
      manifestHash: Hash;
      baselineCursors: BaselineCursor[]; // unique/sorted streamId
      allowedKinds: FinancialKind[];    // existing set rules
      limits: { maxTransactionCents: 5000000; maxRecordsPerCycle: 1000 };
      reviewerId: Id;
      epoch: Version;
      status: 'active' | 'paused' | 'revoked';
      approvedAt: IsoInstant;
    };

First successful authority has epoch1/status active. Copy allowedKinds/limits exactly from approved artifact.normalizedPlan, and copy the entire manifest vector (including semantic streams at cursor0). Do not grant authority to other profiles carried by the artifact. SourceRef/semanticVersion come from immutable hash-bound artifact/profile rather than independently mutable duplicate policy fields. Persist their trusted content/references for worker restart without control-DB access.

Choose approvedAt from injected runtime clock once for this transaction; it is separate from manifest.asOf, the cutover effective time. Persist one current authority per Scope with account_id globally unique as required by F1; keep immutable approval bundle/receipt records. Internal insert-or-lock may create an uncommitted row, never an externally visible “approval” before commit. T3 does not add status transition endpoints; later T5/T6 consumers must freeze epoch transitions before implementing them.

Initial nonempty bootstrap increments target version0->1 once, matching F8; subsequent nonempty applied group increments once (F8 late payment1->2), never once per inserted row. Exact replay/read does not increment. Target version and epoch stay distinct; both checked under their appropriate locks.

## 3. Evidence-backed bootstrap metadata proposal

Observed legal name exists in visible source evidence:
- apps/control/src/demo-candidates.ts parseAgreement reads “Legal name ...” from the captured PDF and returns label, buyerId, sellerEntityId, sourceAccountId. buildDemoCandidate verifies the captured member/hash/citation and parties, but currently discards legal name from the approved profile and uses it only in decorated candidate.label.
- scripts/generate-fixtures.ts:119–130,200–215 emits that visible legal-name/party line and separate protected facts. Product must read the visible immutable PDF citation, never protected facts.
- packages/contracts/src/connector.ts:89–94 contains parentCustomerId/terms but no displayName. Do not extract a legal name from IDs or decorated “Company A · ...” UI labels.

Propose a strict optional profile extension through the reviewed contract patch:

    type ProfileBootstrap = {
      customer: { id: Id; displayName: string; evidenceRefs: Id[] };
      billingConfigurationIds: { termId: Id; id: Id }[];
    };
    // CustomerProfile gains bootstrap?: ProfileBootstrap

Require bootstrap for activation-ready profiles, while old profiles retain their existing financial preview behavior; neither metadata presence nor financial eligibility proves bootstrap verification. Missing metadata blocks activation preparation; it does not prove any configuration has executed, and merely including it does not grant authority.

customer.id equals parentCustomerId; displayName is nonempty and exactly evidence-supported observed legal name. evidenceRefs is a nonempty unique set applicable to the selected account/capture and buyer/name assertion. billingConfigurationIds is unique by termId and by configuration id, covers exactly all approved contractTerms, and pins stable reviewed IDs. The worker copies the whole corresponding ContractTerm unchanged; it never derives invoices from configuration.

Local builder uses the already parsed PDF agreement and its applicable immutable citation. Its deterministic config IDs are construction identifiers pinned in the profile, not financial policy. F8's isolated fixture explicitly uses buyer-shared-1 / Shared Buyer / ev-a-identity, config-a-1 / term-a-1; these literals are fixture-specific, not general name derivations.

The shared canonicalProfile preimage used by both hashProfile and hashBundle must explicitly canonicalize the new evidence set and configuration bindings, preserve old profile hashes when bootstrap is absent, and omit undefined. Adding metadata changes profile version/hash, artifact.requiredProfileHashes and artifact hash; register, recompile and independently reverify the exact new subject. Old reports are unusable. C1 evidence-store work is compatible and remains untouched; Any future V3 bootstrap verifier work must coordinate with the C2 owner; current C1/C2 scope and private evidence contracts remain unchanged. No unilateral change to frozen CustomerProfile is authorized; the separate V3 bootstrap verification prerequisite below must also be fulfilled.

Proposal for parent customer storage: preserve account-scoped TargetState projections, keyed internally by scope+customer.id. The same parentCustomerId across sellers identifies the same buyer without pooling accounts or forcing one source's citation set into another scope. Ensure equivalence checks operate on records within the requested scope. This is not a global editable customer-master or evidence-union feature. B's contract review must explicitly confirm this scoped representation before implementing it. Wire ParentCustomer remains exactly {id,displayName,evidenceRefs}; scope is an internal relational association, not a new wire field. Preserve strict ParentAccount/BillingConfiguration schemas and TargetState scope refinements. Every reference/write validates requested scope; names never establish identity. Both planning and persistence compare the same canonical bytes, with evidence sets and configuration bindings normalized during preparation. Conflict holds; do not union evidence, rename buyers, or overwrite terms.

## 4. Full bootstrap plan and equality

Keep planBatch(artifact,profile,events,target) unchanged as the frozen financial planner. Propose an additional pure B API:

    planBootstrap(artifact, profile, events, target): PlanOutcome

It takes target.asOf, performs no I/O/clock/model calls, and uses the exact selected profile. The activation preview/recompute instant is manifest.asOf.

1. Derive ensure_customer from approved bootstrap.customer.
2. Derive ensure_account with id=scope.accountId, scope, parentCustomerId, sourceRef, and canonical sourceAccountIds.
3. Derive ensure_billing_configuration for every explicit term-id binding, with exact approved term content.
4. Validate byte-equivalent existing records for reuse; conflicting configuration holds per F3.
5. Run financial planBatch on pinned raw events and authoritative target. Retain its deterministic financial operations and holds.
6. Build one complete bootstrap MutationPlan: customer ensure, account ensure, configuration ensures sorted by id, then existing financial operation order. Ensures remain explicit in the plan even for exact reuse; persistence is an idempotent ensure. Shift financial lineage.operationIndex and add metadata lineage using profile/term/evidence identifiers; mapping:null for derived fields with explicit derivationInputs.
7. Use financial eventIds unchanged; do not invent event IDs for configuration. expectedBalanceCents uses projected financial records at the same asOf. hashPlan covers the complete operations and lineage.

The current compiler resultPlan only emits financial operations (packages/compiler/src/plan-batch.ts:103–115); projectTarget expressly excludes ensures (packages/parent/src/state.ts). B adds the bootstrap projection/validation path instead of appending unreviewed ensure operations after comparing an old financial-only hash.

Activation-capable preview must use planBootstrap and display this exact full plan; old profiles retain financial-only preview and cannot activate. Selected-scope blockers prevent readiness/import. Whole-company source events for unselected accounts are not permission to authorize them; unrelated-account hold presentation is outside this proposal.

Worker locks/reloads authoritative state, recomputes the complete plan and compares canonical bytes/hash against bundle.previewPlan and ReviewPackage.previewPlanHash, plus scope/profile/artifact/asOf/version bindings. Initial A expects five F8 financial records, one customer/account/config, balance80000. The invoice300000 comes from the source invoice, not a monthly-fee calculation. Financial replay-only cases may not create zero-effect money receipts (F5).


### Activation-ready bootstrap verification is a separate prerequisite

Current evaluator cannot establish ensure correctness: packages/evaluator/src/subject-runner.ts invokes financial planBatch; subject-comparison.ts:35–36 ignores ensure operations; cases.ts financial baseline does not test configuration. Rehashing and rerunning current13 checks alone cannot authorize bootstrap, even if the new subject obtains a financial eligible:true report.

Required separate V3 verifier extension (not an edit to C1, current C2 or private evidence contracts): execute shared planBootstrap as a subject in a protected runner and independently assert exact customer/account/config records, legal-name/citation support, term bindings and unchanged term content, requested scope, byte-equivalent reuse versus conflict holds, full field lineage/index shifts, operation order and full hash. Reference expectations must come from independently prepared protected fixtures/oracle, never planBootstrap or copied subject output. Retain all existing financial probes and four-argument planBatch.

Affected future consumers: contracts/canonicalProfile+hashBundle; demo candidate metadata builder; compiler/bootstrap planner and preview composition; protected subject protocol/runner; independent bootstrap reference comparison/case recipes; trusted verifier completion/registry binding and control review ready gate; worker bundle validator/full-plan recomputation; display/integration fixtures. B and evaluator owner must publish a separately reviewed versioned bootstrap assertion result/binding contract, exact required assertions and runner/build/subject/manifest pins before consuming it. Its storage/wire form is NOT silently added to current VerificationReport/private evidence protocol in this proposal. Until that prerequisite is frozen and actual assertions execute and pass for the exact subject, bootstrap verification is unavailable and review.ready=false/activation blocked. A financial report's eligible flag alone never satisfies this gate. Coordinate future legal-name support with the C2 owner without modifying or delaying current C1/C2 scope.

For this first vertical slice, require exactly one nonempty valid financial baseline plan for the selected profile, with no selected-scope financial/semantic/evidence hold or unresolved source-wide blocker. If financial planner returns no plan (including replay/no insert) or a blocking selected/source issue, emit blocked/no ready bootstrap; do not prepend ensures to manufacture an eligible metadata-only approval. Empty-customer activation is not defined by this patch.

Metadata lineage proposed exact normalization:
- Operation order: ensure_customer, ensure_account, ensure_billing_configuration sorted lexically by configuration id, then existing financial operations unchanged.
- One lineage entry for each leaf produced record field; empty arrays have an entry at their array pointer. JSON Pointer escapes follow RFC6901; field roots are inside operation.record, never /record.
- Customer pointers: /id, /displayName, /evidenceRefs/0... (canonical sorted nonempty evidence set).
- Account pointers: /id, /scope/accountId, /scope/companyId, /scope/sellerEntityId, /parentCustomerId, /sourceRef, /sourceAccountIds/0... (canonical sorted source IDs).
- Configuration pointers: /id, the three /scope/... pointers, /contractTerm/id, /contractTerm/contractId, /contractTerm/validFrom, /contractTerm/validToExclusive (including null), /contractTerm/fixedMonthlyFeeCents, /contractTerm/currency, /contractTerm/cadence, /contractTerm/anchorDay, /contractTerm/evidenceRefs/0... or /contractTerm/evidenceRefs for an empty set.
- All metadata lineage has sourceEventIds:[] and sourcePaths:[] (no fabricated event or raw JSON path), mapping:null. Customer entries use derivationInputs:[profile.id], applicable profile.bootstrap.customer.evidenceRefs; account entries use derivationInputs:[profile.id] and canonical union of applicable approved identity-map citation refs for the source accounts plus customer identity citation refs. These references must actually support the identity assertion; union is a lineage list, not a mutation of ParentCustomer evidence. Configuration entries use derivationInputs:[profile.id,term.id] sorted/deduplicated and the term's canonical evidenceRefs.
- For structurally derived IDs/scope/citation identifiers, those applicable refs identify reviewed inputs, not an assertion that the generated storage ID is literally printed in a source. For /displayName and term value pointers, cited evidence must support the observed value. No invented literal support.
- Sort metadata lineage within each operation lexically by targetField; canonicalize evidenceRefs/derivationInputs sets. Shift every existing financial lineage.operationIndex by ensure count and retain its existing order. Concatenate metadata lineage in operation order, then shifted financial lineage. hashPlan retains this exact array order.
- Verifier checks all required pointers, values, refs, empty-event rule, indices and ordering, not just existence of a lineage array.

## 5. Review package hash, persistence and trusted reads

Keep existing ReviewPackage and ActivationRequest wire shapes. Proposed helper:

    hashReviewPackage({hash: _ownHash, ...review}) = hashCanonical(review)

Hash every remaining field, including id/revision; preserve deterministically constructed diagnostic array order. Do not recursively strip nested hashes.

Proposed control004 tables:
- review_packages: immutable id PK, scope columns, positive revision, unique package_hash, package JSONB, artifact/profile/manifest hashes, verification_report_id FK, preview_plan_hash, expected_target_version, ready; UNIQUE(account_id,revision). Store exact prepared full plan and capture identity with the immutable package.
- review_heads: account_id PK -> current package_id FK.
- reviewer_actions: server reviewer/session, exact canonical request/request hash/key, package/hash, bundle_hash and returned outcome/receipt reference. Pending/timeout is not evidence of failed runtime commit.
- Receipt mirror: exact returned authority with observation metadata; never source of authorization.

Preparation first reads a HeadToken = null | {packageId:Id, revision:Version, packageHash:Hash}, including explicit absence, before performing worker/source/report I/O. Compute a deterministic prepared-content fingerprint excluding generated package id/revision/hash; include scope, all subject/report/plan/capture hashes, expected target version, readiness and diagnostics. In one short control transaction serialize even absent heads using a unique account head/sentinel lock, compare the captured HeadToken to the current row, and conditionally install only if equal. If changed, discard/recompute from current inputs or return stale; never install an old I/O result over a newer head. If token matches and fingerprint equals current content, return that unchanged package. Otherwise allocate next revision (first1), assign id, calculate final hash over all package fields except own hash, insert immutable row and CAS head. Comparison is null-aware; a newly created row must defeat another preparation that captured absence. Transaction increment alone is not freshness.

Proposed control-only ports:

    readRegisteredReport(reportId: Id): Promise<VerificationReport>;
    readCurrentReview(accountId: Id): Promise<{
      reviewPackage: ReviewPackage;
      previewPlan: MutationPlan;
      manifestId: Id;
      snapshotId: Id;
    }>;

The first joins persisted verification_reports to a completed bound verification_job and immutable registered subject; validates exact report schema/bindings/full mandatory checks using existing protected verification rules. It is not a public report-JSON endpoint. Existing createVerificationJobs.get exposes summary only, so C needs this narrow trusted reader.

Retry resolution precedes new-grant checks. Authenticate reviewer and authorize URL account/source first, strictly parse request, then resolve the globally unique idempotency-key association and compare canonical exact ActivationRequest plus bound scope. Reuse across a different scope or with different request is409 IDEMPOTENCY_CONFLICT; key is never an unauthenticated capability. For a prior accepted intent, use its original immutable request/reviewer/bundle association and authenticated worker receipt lookup before looking at current head/target/semantics. Successful receipt returns byte-identical with replayed:true even after correction/head change, target advance or source semantic outage/mismatch.

reviewer_actions must durably retain original canonical request bytes/hash, scope, original ReviewerContext, exact canonical bundle bytes/hash and immutable package/capture references, with global UNIQUE(idempotency_key). Concurrent same-key registration compares exact request/scope; it cannot replace the original reviewer, timestamp or bundle. A new local session with required grants may recover the original operation; it does not rewrite its reviewer. On restart/lost response, republish original stored bytes to the original bundle hash if publication did not finish, then use receipt lookup. Never construct a new timestamped bundle for a retry. If worker lookup is unavailable, return dependency-unavailable without granting again.

For a genuinely new key, prepare exact bundle bytes outside the short grant transaction after normal checks. In ONE control transaction lock current head, compare requested package id/hash/revision/scope and prepared HeadToken, and persist immutable exact request/reviewer/bundle association. This transaction is the reviewer-grant linearization point. If head changed before it,409; if correction occurs afterward, it does not revoke the accepted exact intent. Bundle file publication by atomic rename follows commit; worker call follows successful publication, both outside the DB transaction. Unique key conflict re-enters exact retry resolution. Persisting reviewer intent in a separate unlocked transaction is forbidden.

An accepted intent with no committed worker receipt reuses its original bundle and does not re-grant against a new control head. Worker performs fresh new-application semantic/target/full-plan checks before first commit; its successful-key recheck under scope lock closes races with a result committed during those checks. If no result and those checks fail, return that failure without modifying the original intent. No cross-DB atomicity is claimed.

ready is computed from complete exact source/candidate/report/bootstrap/target inputs AND executed, passed independently verified V3 bootstrap assertions and selected-scope blockers. Incoming browser request remains ActivationRequest only: no supplied actor, plan, report, readiness or semantic observations.

## 6. Current source semantic port

Reuse SemanticPreflight {sourceRef,checkedAt,versions:SemanticVersionMap}:

    interface SemanticReader {
      readCurrentSemantics(sourceRef: Id): Promise<SemanticPreflight>;
    }

Proposed private source service route GET /internal/sources/:sourceRef/semantics, hosted by the simulator/control service and authenticated by a server-to-server source-read capability. Worker allowlists origin and route; never reads control DB, takes a browser-supplied URL, or receives source operator injection capability. This local credential is not provider/API-key configuration.

A owns the source-authoritative implementation. Under existing source publication lock, read latest published manifest.semanticVersions and fold semantic_change events strictly after its vector watermarks in numeric stream sequence. Current A has one semantic-bearing stream (a-semantics), B one (b-semantics); discover them from the pinned source definition's semantic resources/streams (company-a.ts:33–37), not hardcoded names; no cross-stream total order is claimed. If future source definitions contain conflicting independent semantic streams, reject unsupported ordering until specified. Newly published metadata counts even when its dossier capture is incomplete; do not fall back to an older complete baseline.

Financial events do not themselves rewrite metadata. An event announcing an unseen version remains held by its semantic dependency rule. Scoped changes key sellerEntityId/sourceAccountId; unscoped governing changes use '*'. checkedAt is an observation timestamp, never a lease or arbitrary freshness TTL.

For every selected profile sourceAccountId require an exact key equal to profile.semanticVersion and approved baseline semantic key; missing/unreviewed values block. Any '*' blocks unscoped financial authority. Unrelated scoped-account changes do not block the requested profile. Do not lexically order opaque revision IDs. Ordinary new payments do not stale approval.

For a new approval only, control and worker each obtain their own current semantic read before their respective activation steps; worker fetch completes before runtime transaction. Successful exact retries are resolved first and require no new semantic read. A later event still cannot apply with unmatched semantic dependencies. Fail closed on malformed/unavailable response; use existing ApiError status classes (503 unavailable,403 forbidden,404 unknown source). Exact new diagnostic names are published centrally by B. No additional financial policy or cross-database freshness guarantee.

## 7. Parent read: concretize existing envelope

Correction to earlier handoff: shared-contract line105 already defines ParentView and optional asOf/snapshotHash with latest-known/current-effective-time defaults. The missing part is executable strict schemas, legacyReferences shape and transport implementation.

    type ParentReadQuery = {asOf?: IsoInstant; snapshotHash?: Hash};
    type LegacyReference = {
      targetRecordId: Id; identity: EconomicIdentity;
      sourceRecordVersion: Version; sourceEventId: Id;
    };
    type ParentView = {
      scope: Scope; version: NonnegativeInteger; asOf: IsoInstant;
      snapshotHash: Hash; balanceCents: SafeInteger;
      records: TargetState;
      legacyReferences: LegacyReference[]; // unique/sorted targetRecordId
    };
    readParent(scope: Scope, query: ParentReadQuery): Promise<ParentView>;

GET /internal/parent/:accountId and GET /api/parent/:accountId use the same envelope; control authorizes reviewer/account/source and proxies worker authority. legacyReferences is derived from financial records only. Reject malformed/duplicate/unknown query keys. Full scope is resolved through trusted hash-validated registered profile data, never parsed heuristically from the account ID or read from control DB by worker. B must provide that read-only registry resolver as a worker dependency before querying a not-yet-created target account.

Latest read loads the committed known record set/version; historical selector first loads the preserved recorded snapshot (F3). Keep records.asOf as its recorded snapshot time. Envelope asOf is explicit query.asOf or injected worker clock once when omitted, including when snapshotHash is supplied: preserve the shared-contract current-effective-time default. balanceCents = computeBalance(records,envelope.asOf). Envelope scope/version match records; envelope asOf need not equal records.asOf. The UI requests historical cutover balance by passing both its stored snapshotHash and explicit cutover asOf.

snapshotHash = hashTargetSnapshot(records), using the unchanged frozen preimage including recorded records.asOf/version. Evaluating that same known snapshot at another effective time changes envelope asOf/balance, not records/hash. Preview follows existing F3: copy fetched records and set the COPY's asOf to the explicit preview evaluation instant before pure planning; never overwrite the recorded snapshot.

Persist immutable known/approved snapshots only in authorized mutation commits, including cutover. GET and preview have zero worker/database write capability: no read-cache insertion, new snapshot storage, version update, or authority mutation. Do not promise every calculated/empty-state hash is retrievable. Unknown stored historical selector404; inaccessible scoped selector is not exposed. Malformed query400.

Known unapproved scope returns a deterministic empty version0 TargetState derived from trusted registered scope metadata, with recorded asOf pinned to that registered capture's manifest.asOf and no write or activation. Its computed hash may be unstored and historical lookup may404. Unknown scope mapping404. Later/backdated commits preserve earlier known snapshots; querying old hash with explicit cutover asOf still reproduces approved balance. Existing ParentStateReader and preview TargetReader wrap this read-only authority.

## 8. Transaction/import boundary and dispatch

B runtime002 uses relational records/FKs/scoped relationships, checked BIGINT cents, unique scope, request keys, delivery (sourceRef,eventId), and economic identity (sourceRef,sellerEntityId,kind,recordId). Economic uniqueness excludes recordVersion/connector version/event ID/account alias. Preserve original funding/reversals and scope-specific configurations; no generic monetary update/delete/issuance.

Authenticate private route and scoped source/account grant, read validated hash-only trusted bundle path, verify exact bundle/request/reviewer identity and all immutable member bindings. Resolve successful key association BEFORE current-head/target/semantic freshness rejection; exact prior receipt is returned unchanged, different canonical request or scope409. For a new/uncommitted request only, fetch current semantics outside runtime transaction. If freshness fetch/check fails, perform an authenticated successful-key lookup once more before returning failure, so a concurrent commit can still be recovered without a new grant.

Then one runtime transaction: unique-scope insert-or-lock; activation lock; recheck idempotency association; for existing success return original receipt; for a different key with active scope return ALREADY_ACTIVE BEFORE stale expected-target rejection; target account lock; affected stable target IDs; check applicable epoch/version/full plan; persist target, authority, receipt, bootstrap delivery/outcomes, approved snapshot and activity atomically. No fetch/model I/O inside transaction. Existing withTransaction retries40001/40P01 at most three whole attempts; publishActivity uses its counter within that transaction. A successful exact retry needs no new freshness check. Receipt lookup recovers response loss with auth/scope enforcement; control mirror is separate.

B publishes strict authority/bootstrap/hash/read schemas and root/runtime workspace composition; C owns control004/review routes and trusted report/bundle assembly; A owns semantic read. Existing allowed T3.1 paths remain those in the original plan/handoff. Any extra source/registry/compiler paths need explicit owner assignment before dispatch. Existing migrations stay immutable.

First vertical proof: one selected customer, registered exact profile/artifact, real complete protected report, current review, explicit existing local reviewer-session action, trusted bundle, atomic runtime import, actual parent/receipt read. Other customers stay inactive. No scheduler, provider key, live model construction or new sign-in flow.

## 9. Contract review assertions and gate

- Strict authority rejects unknown fields/epoch0/duplicate streams; exact vector and bounded artifact authority copied.
- Evidence-backed bootstrap change invalidates old profile/artifact/report; old profiles preserve financial-only preview but cannot activate.
- Full ensure+financial plan equality is checked; altering metadata changes plan hash; preview writes zero parent records.
- Current revision CAS rejects former head; server alone supplies reviewer identity/report.
- Semantic read sees new scoped metadata, ignores normal financial arrivals for staleness, blocks '*' and selected mismatches, isolates other accounts.
- Same-key concurrent approvals return one stored receipt; distinct keys produce one success and ALREADY_ACTIVE.
- Precommit failure rolls back all runtime effects; postcommit reply loss recovers immutable receipt after restart.
- Parent cutover version1/80000 remains queryable after version2/50000; replay does not change version or receipt bytes.

No additional user financial-policy question identified for first one-customer activation. These technical contract additions still require B's independent freeze review. Complete V2 means all existing mandatory checks, including evidence_support, passed for the exact subject; activation additionally requires the separate reviewed V3 bootstrap verifier extension and passing bound assertions; test-only eligible fixtures cannot substitute. No activation implementation is authorized by this draft alone.

## Revision round 1 — response to independent review items 1–6

1. Addressed: removed parent GET/read-cache writes and recorded-time default override. Historical records/hash remain immutable; envelope effective time defaults to current, balance uses that time. Mutation commits alone persist snapshots; add no-write and backdated-history tests.
2. Addressed: authenticated/scoped exact-key recovery precedes freshness/head/version checks at both boundaries. Durable unique original intent/bundle bytes permit restart republication/recovery; concurrent key recheck and new-key ALREADY_ACTIVE precedence specified. Add replay-after-head/semantic-outage/mismatch, cross-scope key conflict and response-loss tests.
3. Addressed as explicit blocking dependency: current financial evaluator does not test ensures. Separate future V3 bootstrap verifier contract/consumer work is required; current C1/C2/private evidence shape unchanged. Added exact metadata lineage, deterministic order and no-plan/blocked financial guard. No metadata-only approval or premature bootstrap-eligibility claim.
4. Addressed: preparation captures null-aware head token, installs by CAS and deterministic content fingerprint; grant compares current head and persists immutable intent in one transaction. Add barriers for slow old preparation after new head and correction versus grant linearization.
5. Addressed: wire ParentCustomer/ParentAccount/BillingConfiguration remain strict/unchanged; scope only internal association. Canonical equivalence/conflict guardrails and shared canonicalProfile/hashBundle update specified.
6. Addressed: A is a-semantics, discovered from actual pinned semantic stream/resource definitions; successful retry exception added. No new TTL/order/credential or financial policy.

These revisions are proposals for fresh independent review, not acceptance or implementation authorization. No code tests run; no product files or original plans changed.
