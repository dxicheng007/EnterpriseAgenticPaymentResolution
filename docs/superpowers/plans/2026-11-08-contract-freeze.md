# Contract freeze v1 — local acquisition connector build

Status: architecture baseline, 2026-11-08. No executable schema, test, product, or user-acceptance claim. B's rulings below resolve the eight orchestration preflight items. This document takes precedence over abbreviated shapes in shared-contracts and illustrative PRD JSON. Root queues independent Astra review before Sol T0.1 consumes it. Future changes require a versioned schema diff, examples, and affected-consumer list.

## F1 — Representation, identity, canonical hashes

All object schemas are strict except explicitly declared `JsonObject` raw payloads; raw payloads are subsequently checked against the pinned resource contract. Reject `__proto__`, `prototype`, and `constructor` as keys at any depth in input JSON, lookup tables, paths, and mappings. Reject nonfinite numbers and unsafe integers. Types below are Zod-ready specifications, not product code.

```ts
type Id = string; // 1..160 ASCII [A-Za-z0-9][A-Za-z0-9._:-]*
type Hash = string; // exactly 64 lowercase hex SHA-256 characters
type IsoInstant = string; // input valid UTC YYYY-MM-DDTHH:mm:ssZ or .SSSZ; schema normalizes to .SSSZ
type IsoDate = string; // valid YYYY-MM-DD, not permissive Date rollover
type Cursor = string; // source v1 decimal sequence, canonical /^(0|[1-9][0-9]*)$/
type Version = number; // positive safe integer; target state version may also be 0
type MoneyCents = number; // nonnegative safe integer; transaction fields 1..5_000_000
// Balances and sums use signed safe integers and checked integer addition/subtraction.
type JsonValue = null | boolean | string | number | JsonValue[] | {[key:string]:JsonValue};
type JsonObject = {[key:string]:JsonValue};
type Scope = {companyId:Id; sellerEntityId:Id; accountId:Id};
type RawIdentity = {companyId:Id; sellerEntityId?:Id; sourceAccountId?:Id};
type FinancialKind = 'invoice'|'payment'|'credit'|'allocation'|'reversal';
type EventKind = FinancialKind|'semantic_change';
type RawSourceEvent = {
  id:Id; sourceRef:Id; resource:Id; streamId:Id; sequence:Version;
  recordId:Id; recordVersion:Version; rawIdentity:RawIdentity; kind:EventKind;
  effectiveAt:IsoInstant; observedAt:IsoInstant; schemaVersion:Id;
  semanticVersion:Id; contentHash:Hash; payload:JsonObject;
};
type SourceEvent = RawSourceEvent; // public capture/planBatch input; never requires approved scope
// Produced only by resolveApprovedIdentity, never accepted from source HTTP payloads.
type ResolvedSourceEvent = RawSourceEvent & {scope:Scope; profileHash:Hash};
type EconomicIdentity = {sourceRef:Id; sellerEntityId:Id; kind:FinancialKind; recordId:Id};
type Diagnostic = {code:string; severity:'blocker'|'warning'; message:string; sourceIds:Id[]; fieldPaths:string[]};
type Hold = {eventIds:Id[]; scope?:Scope; code:string; dependencies:Id[]; diagnostics:Diagnostic[]};
type Result<T> = {ok:true; value:T}|{ok:false; diagnostics:Diagnostic[]};
```

Source identity resolves only when `sourceRef`, company, seller and `sourceAccountId` match the profile's approved identity map. Unknown account with known company/seller is captured and held without assigning an approved `Scope`; it does not pause independent mapped accounts. Missing/ambiguous seller or an unscoped governing semantic change pauses that source's financial application. Unknown-account holds carry raw identity via their event, not a fabricated scope. Canonical account IDs are globally unique and seller-qualified (`a.seller1.customer1`), making existing accountId routes unambiguous. Names never determine identity.

Event delivery uniqueness is `(sourceRef,id)`; identical canonical event content is a replay. Changing only `observedAt` on retransmission is forbidden: retransmit the original event. Economic uniqueness is the full `EconomicIdentity`, excluding recordVersion, connector/profile version, event ID, and account alias. A later identical monetary record may resolve as replay; changed amount/currency/relationships under the same identity is held, never inserted as new money. Profile identity changes require renewed review.

Canonical encoding: recursively lexicographically sort object keys; retain array order unless a schema below declares a set; UTF-8 JSON without whitespace; reject undefined and negative zero; numbers must be safe integers. Hash helpers explicitly construct a hash preimage; never strip arbitrary fields recursively. Sort set arrays by stable ID (hash sets by hash); reject duplicates. Raw source bytes hash directly. Event hash excludes only its own `contentHash`. Manifest/profile/plan/bundle hashes exclude only their own `hash`. Profile evidence/findings/lookups/terms and source-account sets use stable-ID ordering. `specHash` covers the entire ConnectorSpec. Artifact hash covers `{specHash,compilerVersion,runtimeVersion,targetSchemaVersion,normalizedPlan,sourceContractHashes,requiredProfileHashes}`; excludes only artifact ID and its own hash. It contains no build timestamp. Target record IDs derive from SHA-256 canonical economic identity prefixed `tr:`; an account snapshot hash covers `{scope,records}` including target version. No hash is treated as authentication.

## F2 — Concrete source contracts and executable DSL

Version 1 deliberately supports flat source-record objects. Field paths are one JSON Pointer segment, e.g. `/amount`; decode RFC6901 escaping, reject empty/multiple segments and prototype keys. Nested source records require a future reviewed contract revision. Raw envelopes/payloads remain immutable.

```ts
type FieldContract =
 | {type:'string'; required:boolean; nullable:boolean; format:'text'|'decimal2'|'iso-date'|'iso-instant'; enum?:string[]}
 | {type:'integer'; required:boolean; nullable:boolean; unit:'minor'|'count'; minimum:number; maximum:number}
 | {type:'boolean'; required:boolean; nullable:boolean};
type SourceContract = {
 resource:Id; kind:EventKind; schemaVersion:Id; fields:Record<string,FieldContract>;
 additionalProperties:false; currency:'USD'; timezone:'UTC';
 recordIdField:string; recordVersionField:string; accountIdField:string|null;
 semantics:'append-only-events'; moneyUpdates:'full-reversal-only';
};
type CaptureStream = {streamId:Id; transport:'api'|'csv'|'semantic'; resources:Id[];
 cursorStrategy:'positive-safe-integer'; pageSize:number}; // pageSize 1..1000
// Capture references are operator-registered logical IDs, never URLs or SQL.
type MappingOp =
 | {op:'field'; path:string}
 | {op:'constant'; value:JsonValue; evidenceRef:Id}
 | {op:'decimal_to_minor'; path:string; scale:2}
 | {op:'date_parse'; path:string; format:'YYYY-MM-DD'|'ISO_INSTANT'; timezone:'UTC'}
 | {op:'enum_lookup'; path:string; values:Record<string,string>}
 | {op:'approved_lookup'; path:string; tableId:Id}
 | {op:'existing_invoice_lookup'; path:string}
 | {op:'normalize_text'; path:string; mode:'trim'|'lower'}
 | {op:'effective_term'; contractId:Id; datePath:string};
type EntityMapping =
 | {resource:Id; kind:'invoice'; fields:{amountCents:MappingOp; currency:MappingOp; effectiveAt:MappingOp; dueDate:MappingOp}}
 | {resource:Id; kind:'payment'|'credit'; fields:{amountCents:MappingOp; currency:MappingOp; effectiveAt:MappingOp}}
 | {resource:Id; kind:'allocation'; fields:{amountCents:MappingOp; currency:MappingOp; effectiveAt:MappingOp;
     fundingKind:MappingOp; fundingRecordId:MappingOp; invoiceRecordId:MappingOp}}
 | {resource:Id; kind:'reversal'; fields:{currency:MappingOp; effectiveAt:MappingOp; reversedKind:MappingOp; reversedRecordId:MappingOp}};
type ValidatorId = 'identity_scope'|'source_contract'|'semantic_version'|'safe_money'|'usd_only'|
 'economic_uniqueness'|'explicit_allocation'|'allocation_limits'|'full_reversal'|'effective_terms'|
 'target_version'|'cycle_limits'|'evidence_support';
type ConnectorSpec = {
 id:Id; version:Version; sourceRef:Id; targetSchemaVersion:'1';
 sourceContracts:SourceContract[]; capture:CaptureStream[]; mappings:EntityMapping[];
 requiredValidators:ValidatorId[]; allowedKinds:FinancialKind[];
 maxTransactionCents:5000000; maxRecordsPerCycle:1000;
 evidenceRefs:Id[]; runtimeModelCalls:'forbidden';
};
type ApprovedLookup = {id:Id; valueType:'parent-account'|'text'; entries:{source:string; target:string; evidenceRefs:Id[]}[]};
type ContractTerm = {id:Id; contractId:Id; validFrom:IsoDate; validToExclusive:IsoDate|null;
 fixedMonthlyFeeCents:MoneyCents; currency:'USD'; cadence:'monthly'; anchorDay:number; evidenceRefs:Id[]};
type CustomerProfile = {id:Id; version:Version; hash:Hash; sourceRef:Id; scope:Scope;
 parentCustomerId:Id; sourceAccountIds:Id[]; approvedLookups:ApprovedLookup[];
 contractTerms:ContractTerm[]; semanticVersion:Id; findings:Finding[]};
type NormalizedPlan = {sourceRef:Id; sourceContracts:SourceContract[]; capture:CaptureStream[];
 mappings:EntityMapping[]; validators:ValidatorId[]; allowedKinds:FinancialKind[];
 limits:{maxTransactionCents:5000000; maxRecordsPerCycle:1000}; runtimeModelCalls:'forbidden'};
type CompiledArtifact = {id:Id; sourceRef:Id; hash:Hash; specHash:Hash; compilerVersion:'1';
 runtimeVersion:'1'; targetSchemaVersion:'1'; normalizedPlan:NormalizedPlan;
 sourceContractHashes:{resource:Id; hash:Hash}[]; requiredProfileHashes:Hash[]};
```

All listed ValidatorIds are mandatory and injected by compiler even when spec supplies `[]`. Sort resources/mappings by resource, streams by streamId, validators/allowedKinds/evidenceRefs/profile hashes lexically. Reject duplicate resource/stream/mapping keys. Each financial resource has exactly one compatible mapping, appears in exactly one capture stream, and its kind is allowed. Semantic resources have no financial mapping. Validate each referenced input field exists, lookup table exists, and output type matches the named target field. No mapped-output references exist in v1, so mapping cycles are unrepresentable; reject attempted expression/dependency extensions as unknown keys.

Envelope effectiveAt must equal the mapped record effectiveAt; mismatch is a blocker. `date_parse` parses exact valid ISO formats; a date becomes midnight UTC. `decimal_to_minor` accepts unsigned canonical decimal strings with zero, one or two fractional digits, converts by string arithmetic, and rejects extra precision/rounding, exponent, signs, separators, or whitespace. `field` can carry an integer-minor amount only when its source contract declares that unit. `constant` needs a supported applicable citation; approval cannot make an invented amount valid. Runtime financial records derive identity/scope from the resolved envelope, never arbitrary mapped IDs. `approved_lookup` returns an exact match or holds; `existing_invoice_lookup` returns the source invoice recordId only after finding that invoice in the same source/seller/account target or dependency group. `effective_term` returns the unique active ContractTerm object and is reserved for bootstrap configuration selection, not a financial scalar field. `normalize_text` cannot establish identity without an approved lookup. Unsupported placement/type is a compile blocker.

## F3 — Target records, mutations, finance, and preview

```ts
type RecordBase = {id:Id; identity:EconomicIdentity; sourceRecordVersion:Version;
 scope:Scope; effectiveAt:IsoInstant; sourceEventId:Id; currency:'USD'};
type Invoice = RecordBase & {kind:'invoice'; amountCents:MoneyCents; dueDate:IsoDate};
type Funding = RecordBase & {kind:'payment'|'credit'; amountCents:MoneyCents};
type Allocation = RecordBase & {kind:'allocation'; amountCents:MoneyCents;
 fundingKind:'payment'|'credit'; fundingRecordId:Id; invoiceRecordId:Id};
type FullReversal = RecordBase & {kind:'reversal'; reversedKind:'payment'|'credit'; reversedRecordId:Id};
type ParentCustomer = {id:Id; displayName:string; evidenceRefs:Id[]};
type ParentAccount = {id:Id; scope:Scope; parentCustomerId:Id; sourceRef:Id; sourceAccountIds:Id[]};
type BillingConfiguration = {id:Id; scope:Scope; contractTerm:ContractTerm};
type TargetState = {scope:Scope; version:number; asOf:IsoInstant; // version is nonnegative safe integer
 invoices:Invoice[]; payments:Funding[]; credits:Funding[]; allocations:Allocation[];
 reversals:FullReversal[]; customers:ParentCustomer[]; accounts:ParentAccount[];
 billingConfigurations:BillingConfiguration[]};
type MutationOperation =
 | {op:'insert_invoice'; record:Invoice}
 | {op:'insert_payment'; record:Funding & {kind:'payment'}}
 | {op:'insert_credit'; record:Funding & {kind:'credit'}}
 | {op:'add_allocation'; record:Allocation}
 | {op:'full_reverse'; record:FullReversal}
 | {op:'ensure_customer'; record:ParentCustomer}
 | {op:'ensure_account'; record:ParentAccount}
 | {op:'ensure_billing_configuration'; record:BillingConfiguration};
type FieldLineage = {operationIndex:number; targetField:string; sourceEventIds:Id[];
 sourcePaths:string[]; evidenceRefs:Id[]; mapping:MappingOp|null; derivationInputs:Id[]};
type MutationPlan = {hash:Hash; scope:Scope; artifactHash:Hash; profileHash:Hash;
 expectedTargetVersion:number; eventIds:Id[]; operations:MutationOperation[];
 expectedBalanceCents:number; asOf:IsoInstant; lineage:FieldLineage[]};
type PlanOutcome = {plans:MutationPlan[]; holds:Hold[]};
type PreviewRequest = {spec:ConnectorSpec; profiles:CustomerProfile[]; snapshotId:Id; asOf:IsoInstant};
type PreviewResponse = {artifact:CompiledArtifact|null; outcome:PlanOutcome;
 diffs:{scope:Scope; beforeVersion:number; beforeBalanceCents:number; afterBalanceCents:number;
 operations:MutationOperation[]; lineage:FieldLineage[]}[];
 unsupportedRows:Hold[]; diagnostics:Diagnostic[]; parentWrites:0};
```

All target records share the state's scope; funds references identify same-source/seller records. Array kind constraints are enforced (`payments` only payment, `credits` only credit). Exact replay reuses the existing original record and receipt. `ensure_*` is bootstrap-only and reuses byte-equivalent canonical records; conflicting existing configuration is held. No generic update/delete or invoice-issuance operation exists. A full reversal references one original payment/credit, preserves it, and voids every allocation from that funding at the reversal's effective time. No partial, invoice, or reversal-of-reversal operation exists. Funding and allocation limits are checked across the entire dependency group, with safe-integer arithmetic. Unallocated funding never directly reduces an invoice balance.

`computeBalance` sums effective invoice amounts minus effective allocations whose funding and allocation exist by asOf and have no effective full reversal. It does not subtract both funding and allocation. Backdated events affect latest-known reconstruction; historical snapshotHash reads load the preserved recorded snapshot first. Preview reads worker target snapshots, returns deterministic plans/diffs, and has no worker write capability. Its asOf is explicit; planner uses caller-supplied event/target facts, never wall-clock time. `planBatch` remains the four-argument pure function and takes its evaluation instant from target.asOf. Preview supplies a copy of the fetched target with asOf=PreviewRequest.asOf; the source target snapshot/version is otherwise unchanged. Runtime chooses an explicit cycle asOf before planning, includes it in the plan hash, and checks expectedBalanceCents at that same instant. No implicit wall clock enters pure calculation.

Preview resolves only a complete aggregate snapshot belonging to the profiles/source. Malformed400, absent reference404, stale member/hash409, dependency unavailable503. Valid unsupported semantics returns200 with diagnostics/holds; compile failure has artifact:null and empty plans/diffs. targetField is a JSON Pointer within operation.record; derived identity/scope fields have mapping:null and explicit derivationInputs.

## F4 — Evidence, uploads, and coordinated snapshots

```ts
type PdfLocator = {kind:'pdf'; page:number; start:number; end:number};
type CsvLocator = {kind:'csv'; row:number; column:string};
type JsonLocator = {kind:'json'; pointer:string};
type EmailLocator = {kind:'email'; messageId:Id; start:number; end:number};
type EvidenceRef = {id:Id; snapshotId:Id; sourceId:Id;
 locator:PdfLocator|CsvLocator|JsonLocator|EmailLocator; excerpt:string; sha256:Hash};
type UploadMetadata = {companyId:Id; sourceRef:Id; documentId:Id; documentVersion:Version;
 kind:'contract_pdf'|'amendment_pdf'|'event_csv'|'email_json'; originalName:string;
 batch?:{batchId:Id; sequence:Version; streamId:Id}};
type UploadResponse = {fileId:Id; documentId:Id; documentVersion:Version; contentHash:Hash;
 duplicate:boolean; evidenceIds:Id[]; diagnostics:Diagnostic[]};
type EvidenceResponse = {evidence:EvidenceRef; mediaType:'application/pdf'|'text/csv'|'application/json';
 original:{url:string; sha256:Hash; byteLength:number};
 text:{value:string; sha256:Hash; unit:'utf16'; startInclusive:number; endExclusive:number}};
type ManifestStream = {streamId:Id; snapshotId:Id; resumeAfter:Cursor; eventIds:Id[]; snapshotHash:Hash};
type ManifestFile = {fileId:Id; documentId:Id; documentVersion:Version; sha256:Hash;
 kind:UploadMetadata['kind']; batchId?:Id; sequence?:Version; streamId?:Id};
type BootstrapManifest = {id:Id; companyId:Id; sourceRef:Id; epoch:Version; asOf:IsoInstant;
 schemaVersions:Record<Id,Id>; semanticVersions:Record<Id,Id>;
 streams:ManifestStream[]; files:ManifestFile[]; hash:Hash};
type SourceSnapshot = {id:Id; manifestId:Id; sourceRef:Id; capturedAt:IsoInstant;
 contentHash:Hash; evidenceIds:Id[]; eventIds:Id[]};
type SourceDossier = {companyId:Id; manifestId:Id; snapshotIds:Id[]; evidenceIds:Id[];
 complete:boolean; missingMembers:Id[]; diagnostics:Diagnostic[]};
type CaptureSnapshotResult = {ok:true; snapshot:SourceSnapshot; dossier:SourceDossier}|
 {ok:false; dossier:SourceDossier; diagnostics:Diagnostic[]};
type ChangePage = {sourceRef:Id; streamId:Id; after:Cursor; next:Cursor; complete:boolean; events:RawSourceEvent[]};
```

`POST /api/sources/uploads` is multipart with exactly one UTF-8 JSON `metadata` field and one binary `file` part, 10 MiB file maximum and 16 KiB metadata maximum. Reject traversal/path separators/NUL in originalName; it is a display name, never a filesystem path. `event_csv` requires batch metadata; other kinds forbid it. Success is 201, identical document version/hash is 200 with duplicate:true, same document version or batch ID/different bytes is 409. Globally content-addressed blob deduplication does not merge source/company-scoped file associations or expose another source's evidence. Malformed/unsupported content is 422; limit is 413; malformed metadata is 400.

EvidenceRef.sha256 hashes original source bytes; `text.sha256` hashes exact stored extracted text as UTF-8. PDF offsets are zero-based, end-exclusive UTF-16 code units within the named 1-based page's stored text. PDF extraction joins item strings with one space and has no later whitespace normalization; extractor name/version is persisted. Email offsets are within the stored message body. Reject offsets splitting a surrogate pair. CSV row is 1-based data row excluding header; column is exact unique header name; excerpt is decoded cell text. JSON Pointer resolves a value, with string excerpt equal to that string and other values canonical-JSON encoded. For CSV/JSON the text response is the canonical cited cell/value and offsets span its full length. PDF/email text response is the full cited page/body and offsets select excerpt. Never return empty text for invalid locators. `GET /api/evidence/:id/content` returns original bytes through scoped authorization and fixed media type; no filesystem paths or arbitrary URL. EvidenceRef.sourceId identifies the scoped file/JSON-blob association, never a global blob or economic ID. original.url is exactly the relative /api/evidence/<id>/content route. Public reviewer requests have local-session read access; tool requests enforce TaskContext source/account capability through the same service method. Multi-account pages/bodies/originals require capability over every exposed account; otherwise tools receive authorized bounded excerpts only. Unknown/unscoped documents require explicit source-wide capability. Association uniqueness is (companyId,sourceRef,documentId,documentVersion); batch uniqueness is (sourceRef,streamId,batchId) and (sourceRef,streamId,sequence). Conflicting immutable metadata also produces409. Repeated complete capture returns the identical snapshot including capturedAt. Missing members use MANIFEST_MEMBER_MISSING; changed hash SOURCE_HASH_CONFLICT; epoch inconsistency SOURCE_EPOCH_CONFLICT; invalid content SOURCE_CONTENT_INVALID; storage unavailability503 SOURCE_UNAVAILABLE. missingMembers contains absent IDs only, conflicts live in diagnostics. Locator failure422 CITATION_INVALID; absent evidence404 EVIDENCE_NOT_FOUND; forbidden scope403 SOURCE_FORBIDDEN. All use ApiError.

Dossier GET accepts optional `?manifestId=<Id>`; explicit selector returns exactly that immutable manifest or 404, omitted selector chooses latest published epoch for the company even when incomplete and includes the selected manifestId. No manifest yields 404 MANIFEST_NOT_FOUND. GET only reads capture status; it does not capture or fall back to an older complete dossier.

`captureSnapshot(manifestId):Promise<CaptureSnapshotResult>` is a deliberate correction to the abbreviated interface. It captures one aggregate immutable dossier snapshot, ID `snapshot:<manifestId>`, over all pinned stream snapshots and document members. The simulator publishes stream snapshot IDs/content before the manifest under one epoch publication lock. `getSnapshot(snapshotId)` serves either a named immutable member snapshot or the captured aggregate; they share SourceSnapshot shape. Aggregate contentHash is the hash of `{manifestHash,streams:[{streamId,snapshotId,snapshotHash}],files:[{fileId,sha256}],eventIds,evidenceIds}`, streams/files sorted by streamId/fileId and ID sets lexical. All required PDFs/amendments/emails are file members; files are not limited to CSV batches. Missing or changed members return ok:false and incomplete dossier; no ready aggregate snapshot or review package is published. Existing captured partial blobs may remain.

A manifest is published atomically with fixed vector watermarks. Stream snapshot eventIds are exactly that stream's baseline events through resumeAfter; document files include every required baseline member. Company B has file, receipt, and semantic streams. Events published later get a sequence strictly greater than that stream's watermark; concurrent injection serializes with manifest publication, so it is wholly before or after. `semanticVersions` keys are `sellerEntityId/sourceAccountId` (each component obeys Id and cannot contain slash), avoiding account collisions across sellers and any requirement for approved parent identity during capture. Unscoped governing revisions use a separate reserved key `*` and pause the source until scoped/reviewed. Financial event.semanticVersion must match the reviewed profile; unseen/changed revision holds before mapping, regardless of metadata delivery order.

Cursor strings parse to safe integers, never lexical comparison. Events in a nonempty page are contiguous, strictly increasing, within `(after,next]`, same source/stream; next is final event sequence. Empty page requires next=after. `complete:false` is not capturable and cannot advance cursor. Gaps yield a typed SOURCE_GAP and no checkpoint change. CSV batch sequence and file-stream event sequence are separate fields: each batch contributes records with contiguous event sequences, and batch sequence gaps prevent ingesting later batches. Duplicate batch/hash is a no-op; changed bytes conflict. capturePage stores the complete page plus checkpoint in one transaction under stream lock; conflicting duplicate identity/hash rolls back the page.

## F5 — Immutable receipts and trusted activation bridge

```ts
type SyncReceipt = {id:Id; scope:Scope; activationId:Id; epoch:Version; artifactHash:Hash;
 planHash:Hash; eventIds:Id[]; targetRecordIds:Id[]; beforeBalanceCents:number;
 afterBalanceCents:number; status:'applied'; committedAt:IsoInstant};
type ReceiptResponse = {receipt:SyncReceipt; replayed:boolean};
type ActivationRequest = {reviewPackageId:Id; expectedPackageHash:Hash; expectedArtifactHash:Hash;
 expectedProfileHash:Hash; expectedTargetVersion:number; idempotencyKey:Id};
type ReviewerContext = {reviewerId:Id; sessionId:Id};
type ActivationBundle = {schemaVersion:'1'; hash:Hash; request:ActivationRequest;
 reviewer:ReviewerContext; reviewPackage:ReviewPackage; artifact:CompiledArtifact;
 profiles:CustomerProfile[]; manifest:BootstrapManifest; verificationReport:VerificationReport;
 snapshot:SourceSnapshot; bootstrapEvents:RawSourceEvent[]; previewPlan:MutationPlan;
 semanticPreflight:{sourceRef:Id; checkedAt:IsoInstant; versions:Record<Id,Id>}};
type InternalActivationRequest = {bundleHash:Hash; idempotencyKey:Id};
```

`activateCustomer` and `applyBatch` now return `Promise<ReceiptResponse>`; stable function names/parameters otherwise remain. First delivery yields replayed:false, exact retry replayed:true with byte-identical stored receipt. A reused idempotency key with a different canonical activation request is 409 IDEMPOTENCY_CONFLICT. Financial replay under a new event ID associates that delivery with the original receipt and creates no additional effect. A batch mixing new and duplicate economics applies only new operations; original record IDs remain stable, and its receipt records all acknowledged event IDs. Empty/all-replayed batches return original receipt(s) through runCycle's event association; applyBatch is called only for a single nonempty mutation group or an exact existing plan replay. No invented zero-effect monetary receipt.

Control's reviewer route alone constructs bundle after authenticated local reviewer action, reading persisted report/review rows and immutable source/artifact files. It checks request hashes, current candidate revision, expected target version, complete manifest, report eligibility, and current source semantic revisions. It writes bundle by atomic rename into a dedicated `registry/activation-bundles/<hash>.json` directory, owned by the trusted registry writer; worker receives that directory read-only. Agent tools cannot write registry files, submit report JSON, call reviewer routes, or create bundles. Immutable artifact/report members are registry-owned and hash-validated. Local filesystem protection and capability-restricted tools are demo trust assumptions, not defense against a hostile laptop owner.

Control calls `POST /internal/activate` with InternalActivationRequest and separate local service bearer token. The worker reads bundle by validated hash-only filename (never arbitrary path), verifies hash/versions/report bindings and caller token, selects exactly the requested profile/scope, and recomputes bootstrap plan against its authoritative target. Worker does not connect to control DB. A bundle may authorize only its embedded exact request/reviewer; reusing it with different key fails. Worker fetches current semantic metadata from the allowlisted source before the transaction and rejects revisions newer than the bundle/profile. Changes arriving subsequently are safely blocked by event semantic dependencies; there is no cross-database atomic semantic-observation claim.

Under unique-scope insert-or-lock, lock activation then target account and stable target record IDs. Recheck epoch/status, target version, receipt key and plan equality; atomically write bootstrap, activation, receipt, inbox outcomes and activity. No fetch/model I/O inside transaction. A lost response is resolved with authenticated GET `/internal/receipts/:key`; control mirrors only the returned authority. Existing financial economic identities survive reenrollment. A revoked connection needs a fresh review bundle; resume cannot restore it.

## F6 — Health and protected verification protocol

```ts
type ServiceHealth = {status:'ready'|'not_ready'; database:'ready'|'unavailable'|'migration_required';
 migrationVersion:number|null};
type HealthResponse = {status:'ready'|'not_ready'; controlDb:'ready'|'unavailable'|'migration_required';
 runtimeDb:'ready'|'unavailable'|'migration_required';
 migrationVersions:{control:number|null; runtime:number|null}; diagnostics:Diagnostic[]};
type VerificationCheckId = 'baseline_reconcile'|'new_record'|'duplicate_delivery'|'retry_restart'|
 'invalid_money'|'allocation_scope'|'full_reversal'|'dependency_order'|'schema_drift'|
 'semantic_drift'|'unknown_identity'|'snapshot_boundary'|'evidence_support';
type VerificationCheck = {id:VerificationCheckId; status:'passed'|'failed'|'unavailable'; cases:number; diagnosticCodes:string[]};
type VerificationReport = {id:Id; artifactHash:Hash; profileHashes:Hash[]; manifestHash:Hash;
 harnessVersion:'1'; evaluatorBuildHash:Hash; fixtureSetId:Id; fixtureSetVersion:Id;
 checks:VerificationCheck[]; coverage:{required:VerificationCheckId[]; executed:VerificationCheckId[];
 sourceRefs:Id[]; profileHashes:Hash[]; eventKinds:FinancialKind[]};
 unexplainedDifferenceCents:number; eligible:boolean; createdAt:IsoInstant};
type VerifyRequest = {artifactHash:Hash; profileHashes:Hash[]; manifestId:Id};
type VerificationSummary = {reportId:Id; artifactHash:Hash; profileHashes:Hash[]; manifestHash:Hash;
 eligible:boolean; checks:{id:VerificationCheckId; status:VerificationCheck['status']; diagnosticCodes:string[]}[];
 coverageComplete:boolean};
type VerificationJob = {jobId:Id; state:'queued'|'running'|'completed'|'failed';
 summary?:VerificationSummary; diagnostics:Diagnostic[]};
```

`GET /internal/health` returns ServiceHealth using the service credential. Public GET `/api/health` returns HealthResponse with 200 only when both application-role probes and all expected migrations are ready. Otherwise 503, including runtime unreachable; migration versions remain null where unobserved, never fabricated. Health checks use a 2-second worker request timeout and redacted diagnostics without URLs/passwords. Worker health checks only runtime DB; control never receives runtime DB credentials. Root script starts migrations using migration credentials before accepting service traffic. Browser shows per-service readiness and a retry action.

`POST /api/connectors/:id/verify` takes VerifyRequest, resolves immutable registered artifact/profile/manifest objects, ensures connector ID binding, then returns 202 VerificationJob. GET `/api/verification-jobs/:jobId` returns job status/summary. Agents may request verification but cannot choose fixtureSetId, runner path, tests, or expected results. The protected resolver chooses a versioned fixture set by source contract and harness policy. The internal `verifyArtifact({artifact,profiles,manifest,fixtureSetId})` function remains evaluator-only.

A dedicated evaluator subprocess receives one bounded JSON stdin message `{protocolVersion:1,jobId,artifact,profiles,manifest,fixtureSetId,fixtureSetVersion,evaluatorBuildHash}` and writes one report JSON line to stdout; stderr is redacted diagnostics. Parent limits input/output to 10 MiB and runtime to 120 seconds; timeout/abnormal exit/invalid JSON creates failed job and no eligible report. No shell interpolation. Evaluator executes the subject through a separate deterministic runner using `{protocolVersion:1,requestId,artifact,profile,events,target}` -> `{requestId,outcome:PlanOutcome}` JSON messages, 5-second case timeout and 10 MiB limit. Subject runner imports compiler planner only; independent reference-model code cannot import finance/compiler/runtime for expected calculations. Subject gets only visible case inputs, never protected expected answers. No network/provider credentials in either runner.

The evaluator process is the only fixture-truth reader; product tools/HTTP/file roots exclude truth and evaluator roots. Process separation alone is not asserted as an access boundary. Trusted control launcher validates report identity, exact hash sets, fixture version, evaluator build hash and all mandatory check IDs before inserting an immutable registry-issued report row. Runtime trusts only registry-attested report members copied into a valid bundle, not arbitrary JSON bearing eligible:true. Every listed check is mandatory, appears exactly once, has cases>0, and must pass; unavailable/skipped/missing coverage, nonzero reconciliation difference, unmatched artifact/profile/manifest, or unsupported requested kinds yields eligible:false. Report profile/source/kind coverage must include the complete requested verification subject. Agent-facing summaries omit holdout amounts, records, expected outputs and detailed mismatch values; reviewer diagnostics may show public-baseline comparisons only. Final holdout results are kept out of repair tool responses.

`retry_restart` artifact coverage means planner_replay: run a fresh subject subprocess against supplied prior target state. It does not prove persisted PostgreSQL restart/retry; T6.1/V6 and V7 still require real runtime proofs. Compare full normalized records, identities, scope, relationship and effective times against the independent oracle, not only aggregate balance. unexplainedDifferenceCents is the checked sum of absolute per-record monetary differences including missing/extra records; balanced swaps and nonmonetary mismatches fail even with zero net difference. V2 platform tests additionally require wrong_mapping_rejected, report_binding, forged_report_rejected, truth_isolation, preview_no_writes.

FixtureSetVersion is immutable: protected registry pins case input/expected hashes and rejects in-place changes. evaluatorBuildHash covers evaluator code, oracle version and dependency lock. Initial verification plus at most two repair attempts per discovery run/account are durably counted before enqueue. Operator final unseen holdout follows candidate freeze separately and is never exposed to repair tools. Apply summary redaction equally to job diagnostics/stderr/activity; no encoded expected amounts or protected case IDs.

## F7 — Durable UI activity and cursor protocol

```ts
type ActivityEvent = {stream:'control'|'runtime'; sequence:Version; phase:'build'|'run';
 scope?:Scope; runId?:Id; taskId?:Id; role?:'coordinator'|'identity'|'contract'|'receivables'|'connector';
 type:string; at:IsoInstant; payload:JsonObject};
type UiCursor = {v:1; controlCursor:number; runtimeCursor:number}; // nonnegative safe integers
// wire: unpadded base64url UTF-8 canonical JSON; reject >1024 bytes or unknown keys
type ApiError = {code:string; message:string; diagnostics:Diagnostic[]; correlationId:Id};
type EventCursorResponse = {cursor:string};
```

GET `/api/events?after=<cursor>` is reviewer-session SSE. Omitted after means both cursors 0. Each SSE message is `event: activity`, `id: <composite cursor after this event>`, `data: <ActivityEvent JSON>`. Explicit query takes precedence over Last-Event-ID; reconnect otherwise uses Last-Event-ID. Each stream replays increasing committed sequence; inter-stream total order is not claimed. Client deduplicates `(stream,sequence)`. Unknown/malformed/future cursor returns HTTP 400 CURSOR_INVALID; a valid cursor older than retained history returns 409 RESYNC_REQUIRED with diagnostics instructing refetch of current views and a fresh cursor from GET `/api/events/cursor`. GET /api/events/cursor returns200 EventCursorResponse and Cache-Control:no-store. On resync, obtain the committed high-water cursor FIRST, refetch current views SECOND, and reconnect after that cursor THIRD; events during refetch are replayed. Apply replay as invalidation/refetch triggers or version-checked projections to avoid double-counting newer views. Reconnection never silently drops history. Live failure after headers emits `event: resync_required` with ApiError then closes.

Each DB maintains one activity stream counter row. Publishing locks that row, increments and inserts the event in the same transaction; publish only after commit. Rollback also rolls back the increment. Test with barriers: T1 starts and waits before publication; T2 starts, obtains counter lock, inserts/commits sequence 1; reader records cursor 1; T1 then obtains lock and commits sequence 2; reconnect returns sequence 2. A second test holds T1's publication lock and proves T2 cannot commit publication until release. No sleeps as correctness barriers and no claim that two exclusive row-lock holders reverse commit order.

Persist allowlisted structured summaries only: source IDs/hashes, task state, tool name/status, counts, diagnostic codes, receipt/plan/artifact IDs. Strip credentials, raw env, filesystem paths, hidden expected answers, full source documents, and hidden reasoning before persistence. Tool result details visible to product agents still use scoped service authorization and bounded excerpts. Required event types remain those in shared-contracts; T0.1 additionally supports `system.seeded` and `system.status` for durable readiness demonstrations.

## F8 — Initial development fixtures and acceptance examples

T0.1 implements schema-validated public fixtures only, clearly `development-only` in an exported metadata constant; no generated/live claim. Export existing required fixture names from tests/fixtures/index.ts. The following is exact seed data; all IDs and versions are literal. Hashes are computed by the frozen canonical helpers, never placeholder zeros. Byte fixtures have UTF-8 encoding.

- scopeA = `{companyId:'company-a',sellerEntityId:'seller-a',accountId:'a.seller-a.customer-1'}`; scopeB substitutes company-b/seller-b/b.seller-b.customer-1.
- profileA uses id profile-a, version 1, sourceRef legacy-a, scopeA, parentCustomerId buyer-shared-1, sourceAccountIds ['cust-a-1'], semanticVersion sem-a-1. profileB uses profile-b/legacy-b/scopeB/['cust-b-1']/sem-b-1 and the same parentCustomerId; this never pools accounts.
- Profiles have one approved lookup id account-map with valueType parent-account, mapping the corresponding source account to scope.accountId with evidenceRefs ['ev-a-identity'] or ['ev-b-identity']; one contract term id term-a-1/term-b-1, contractId contract-a/contract-b, validFrom 2026-07-01, validToExclusive null, fixedMonthlyFeeCents 300000, USD, monthly, anchorDay 1, applicable ev-a-contract/ev-b-contract. Findings are empty initially; required evidence is supplied by explicitly labeled public fixture references, not an assertion that live evidence has been ingested.
- Profile hash is derived after complete profile construction. Terms/evidence are fixture data, never accepted as live verification attestation.

First connector `validSpecA`: id connector-a, version 1, sourceRef legacy-a; targetSchemaVersion 1, all fixed limits, runtimeModelCalls forbidden. allowedKinds invoice/payment/credit/allocation/reversal. evidenceRefs ['ev-a-currency']; requiredValidators empty to test compiler injection. Resources are `a-invoices`, `a-payments`, `a-credits`, `a-allocations`, `a-reversals`, `a-semantics`. Streams: `a-finance` transport api resources first five and `a-semantics` transport semantic its namesake, each pageSize 100. Every contract has schemaVersion schema-a-1, strict additionalProperties false, USD/UTC, append-only-events/full-reversal-only, recordIdField id, recordVersionField version, accountIdField account. Exact common fields: id/account strings required nonnullable format text; version integer required nonnullable unit count min1 max9007199254740991; effective_date string required nonnullable format iso-date. Invoice adds amount string decimal2 and due_date string iso-date; payment/credit add amount string decimal2; allocation adds amount decimal2, funding_kind text enum payment/credit, funding_id text and invoice_id text; reversal adds reversed_kind text enum payment/credit and reversed_id text. Semantic resource adds revision text. All fields required/nonnullable, no unlisted fields.

Mappings: for every financial resource effectiveAt is date_parse(/effective_date,YYYY-MM-DD,UTC), currency constant USD with ev-a-currency; each amountCents uses decimal_to_minor(/amount,2). Invoice dueDate is field(/due_date). Allocation fundingKind uses enum_lookup(/funding_kind,{payment:'payment',credit:'credit'}), fundingRecordId field(/funding_id), invoiceRecordId existing_invoice_lookup(/invoice_id). Reversal uses enum_lookup on reversed_kind and field on reversed_id. There is no semantic mapping. These rules fully specify each EntityMapping without implicit company-specific runtime logic.

`validSpecB` is the explicit schema-distortion variant: connector-b/legacy-b, prefix resources b-; finance stream b-files transport csv includes invoices/credits/allocations/reversals, b-receipts transport api includes payments, b-semantics transport semantic. All pageSize100. Replace field names id->transaction_key, version->revision_no, account->client_code, effective_date->posted_on, amount->amount_minor, due_date->due_on, funding_kind->receipt_type, funding_id->receipt_key, invoice_id->bill_key, reversed_kind->void_type, reversed_id->void_key. Update metadata/path references accordingly; amount_minor is integer minor min1 max5000000 and mappings use field(/amount_minor). currency evidence ev-b-currency, schema schema-b-1. Identity and semantic profiles remain separate. No other substitution is allowed.

Baseline A raw events (observedAt 2026-10-01T00:00:00.000Z; effectiveAt 2026-09-01T00:00:00.000Z; rawIdentity company-a/seller-a/cust-a-1; schema-a-1/sem-a-1; recordVersion1; finance stream):

| sequence / id | resource / recordId / kind | payload fields in addition to id, version=1, account=cust-a-1, effective_date=2026-09-01 |
|---|---|---|
| 1 / evt-a-inv-1 | a-invoices / inv-a-1 / invoice | amount='3000.00', due_date='2026-09-30' |
| 2 / evt-a-pay-1 | a-payments / pay-a-1 / payment | amount='2000.00' |
| 3 / evt-a-credit-1 | a-credits / credit-a-1 / credit | amount='200.00' |
| 4 / evt-a-alloc-pay-1 | a-allocations / alloc-pay-a-1 / allocation | amount='2000.00', funding_kind=payment, funding_id=pay-a-1, invoice_id=inv-a-1 |
| 5 / evt-a-alloc-credit-1 | a-allocations / alloc-credit-a-1 / allocation | amount='200.00', funding_kind=credit, funding_id=credit-a-1, invoice_id=inv-a-1 |

Export these as baselineEventsA in addition to required names. baselineA is TargetState scopeA, version1, asOf 2026-10-01T00:00:00.000Z, containing exactly those five translated records, no reversals, one customer buyer-shared-1 displayName 'Shared Buyer', evidence ev-a-identity; one account scope.accountId with matching identity; one billingConfiguration config-a-1 with term-a-1. Record IDs derive from their economic identities; sourceEventId/version/effectiveAt match events. Balance is 80000. `emptyTargetA` has scopeA/version0/same asOf and empty record/config arrays.

latePaymentA is an array of two raw events: sequence6 evt-a-pay-2 / pay-a-2 / a-payments amount='300.00'; sequence7 evt-a-alloc-pay-2 / alloc-pay-a-2 / a-allocations amount='300.00', funding_kind=payment, funding_id=pay-a-2, invoice_id=inv-a-1. Both effective/observedAt 2026-10-03T00:00:00.000Z and effective_date 2026-10-03; all other common envelope fields match baseline. afterLatePaymentA has version2, asOf October3, adds those payment/allocation records and balances 50000. The approved October1 snapshot remains 80000.

baselineManifestA id manifest-a-1/epoch1/asOf October1 has finance stream snapshot snap-a-finance-1 with the five baseline IDs/resumeAfter '5', semantic snapshot snap-a-sem-1 empty/resumeAfter '0', schemaVersions each a-resource->schema-a-1, semanticVersions seller-a/cust-a-1->sem-a-1. Files contain two email_json fixture associations, IDs file-a-identity/file-a-contract, document IDs doc-a-identity/doc-a-contract, documentVersion1. Their exact canonical UTF-8 JSON bytes are respectively `{"body":"Account cust-a-1; seller seller-a; currency USD.","messageId":"msg-a-identity"}` and `{"body":"Fixed monthly fee USD 3000.00 effective 2026-07-01.","messageId":"msg-a-contract"}`. ev-a-identity and ev-a-currency cite the full first message body; ev-a-contract cites the full second body, with email locators and exact UTF-16 offsets. T0.1 uses valid exported-email fixtures; T1 adds real generated PDF inputs. Each member stream snapshot contentHash is SHA-256 canonical `{sourceRef,streamId,resumeAfter,events:[{id,contentHash}]}` with events ordered by numeric sequence, excluding manifest ID, snapshot ID, capturedAt and contentHash itself; aggregate snapshot hashing follows F4.

baselineManifestB uses three streams b-files/b-receipts/b-semantics with event membership partitioned according to validSpecB; sequences start at1 independently (files contains invoice,credit,two allocations => watermark4; receipt contains payment => watermark1; semantic empty=>0). B baseline records have B IDs/identities, same amounts, B column names/units; file batch batch-b-1 sequence1 includes these four event rows, with its generated UTF-8 CSV bytes/hash pinned. B document member IDs and account/seller/body references use b instead of a. CSV transport uses the exact header `event_id,sequence,resource,kind,record_id,record_version,effective_at,observed_at,account_id,schema_version,semantic_version,payload_json`; payload_json is canonical JSON containing the resource-specific source fields (including amount_minor), quoted using RFC4180 doubled quotes. Rows are stream sequence ordered, comma-delimited UTF-8 with LF endings including final newline. Transport parsing validates the fixed envelope columns then validates decoded payload against SourceContract; no arbitrary JSON expression is executed. Manifest file hashes cover these actual generated bytes.

Other required exports: renamedSchemaA changes source invoice field amount to gross_amount in one new event without changing approved contract, expected SOURCE_SCHEMA blocker; invoiceBeforePaymentVariant returns late dependency fixture in payment/allocation-then-invoice delivery order and expected hold/release IDs; ambiguousRemittanceB is payment amount_minor30000 with unknown client_code cust-b-unknown and missing allocation, expected UNKNOWN_ACCOUNT without guessed scope or target writes. No acceptance assertion changes to force a mapping pass.

Mandatory freeze checks for Sol: schema parsing for both specs/profiles/manifests/events/target fixtures, canonical object-key permutation equality, decimal2 field-schema precision rejection case 1.005 (no compiler implementation), unknown identity capturable and unresolved, unknown DSL operation rejected, receipt response examples original/retry with same receipt and conflicting key documented. These are schema/fixture tests in V0, not claims the V2 compiler/finance works. T0.1 must not implement financial engine to satisfy them.

## Foundation scope and sequencing

T0.1 materializes these schemas and public examples, health/storage/activity primitives, and real PostgreSQL proof only. It does not implement the evaluator protocol, activation bridge, compiler, financial calculator, source ingestion, or discovery. Those task owners consume the frozen shapes later. User priority is deterministic V0–V3, then fixture-based V5/V6 while provider configuration is deferred. V4 live generation, final V5 proof with live-produced artifacts, and V7 live rehearsals remain pending; no mock result can satisfy them.
