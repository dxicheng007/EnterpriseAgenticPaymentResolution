# Private evidence companion v2 — frozen bounded interface

Architecture-only freeze, 2026-11-08. Read actual local-build files at observed HEAD `3483d6b284901bfb56153c510b97196371d5b386` (handoff started from `2185144586d3fdc40c9e221bbd8a98e0df7cf1be`). This replaces representation ambiguity in evidence-support-input.md, not F1–F8, financial semantics, source bytes, public protocol, or activation. No implementation is included.

## Exact private objects

All objects below are strict recursively guarded Zod objects; discriminated unions are guarded before parsing. Reuse IdSchema, HashSchema, IsoDateSchema, MoneyCentsSchema, SourceSnapshotSchema, RawSourceEventSchema, EvidenceResponseSchema and canonical helpers. Integers are safe, finite, nonnegative, never -0. Nonempty text is a string with length >=1, no normalization. Unknown keys, prototype keys at any depth, duplicate set members, malformed IDs/hashes, invalid dates, invalid or overlapping intervals fail validation. Entire serialized producer/bundle each <=10*1024*1024 UTF-8 bytes; bound before JSON parsing and before registration, including base64 overhead. No truncation or compression. No filesystem path fields; the only URL is EvidenceResponse's exact relative content route.

```ts
type SupportField = 'sourceAccountId'|'sellerEntityId'|'buyerId'|'legalName'|
  'contractId'|'validFrom'|'validToExclusive'|'fixedMonthlyFeeCents'|'currency'|'cadence'|'anchorDay';
type Support = {field:SupportField; fileId:Id; expectedLiteral:string};
type IdentityFact = {id:Id; sourceAccountId:Id; sellerEntityId:Id;
  buyerId:Id; legalName:string; support:Support[]};
type ContractFact = {id:Id; sourceAccountId:Id; sellerEntityId:Id; contractId:Id;
  validFrom:IsoDate; validToExclusive:IsoDate|null; fixedMonthlyFeeCents:number;
  currency:'USD'; cadence:'monthly'; anchorDay:number; support:Support[]};
type ProducerV1 = {schemaVersion:1; kind:'evidence-facts';
  fixtureSetId:Id; producerFixtureSetVersion:'1'; producerTruthHash:Hash;
  generator:{seed:Id;buildHash:Hash}; companyId:Id; sourceRef:Id; sellerEntityId:Id;
  manifestId:Id;manifestHash:Hash;
  identities:IdentityFact[];contracts:ContractFact[];hash:Hash};
type DemoBinding = {identityFactId:Id; policy:'generated-demo-buyer-account-v1';
  parentCustomerId:Id; accountId:Id};
type Original = {sourceId:Id; companyId:Id;sourceRef:Id;sha256:Hash;
  bytesBase64:string; binding:
    {kind:'document';fileId:Id} | {kind:'api-json';eventId:Id}};
type ResolvedSupport = {factId:Id;field:SupportField;fileId:Id;expectedLiteral:string;evidenceId:Id};
type EvidenceInputV1 = {schemaVersion:1; fixtureSetId:Id;fixtureSetVersion:'2';
  producer:ProducerV1;producerTruthJson:string;financialTruthHash:Hash;
  manifestId:Id;manifestHash:Hash;snapshotId:Id;snapshotHash:Hash;
  demoBindings:DemoBinding[]; originals:Original[];
  citations:EvidenceResponse[];resolvedSupport:ResolvedSupport[];hash:Hash};
type BundleV2 = {schemaVersion:2;
  pin:{fixtureSetId:Id;fixtureSetVersion:'2';hash:Hash};truthJson:string;
  snapshot:SourceSnapshot;events:RawSourceEvent[];evidence:EvidenceInputV1;bundleHash:Hash};
```

Fact IDs do not depend on profile, citation IDs or extraction: identity ID is `identity:` + hashCanonical({companyId,sourceRef,sellerEntityId,sourceAccountId}); contract ID is `term:` + hashCanonical({companyId,sourceRef,sellerEntityId,sourceAccountId,contractId,validFrom}). Verify these formulas. Contract anchorDay is integer 1..31; fee uses MoneyCentsSchema (do not add a new financial limit). Identity support permits only sourceAccountId/sellerEntityId/buyerId/legalName, each required. Contract support permits only sourceAccountId/sellerEntityId/contractId/validFrom/validToExclusive/fixedMonthlyFeeCents/currency/cadence/anchorDay. Each is required except null validToExclusive, whose support must be absent. Every support file is an original truth evidence file and captured manifest document; CSV/API cannot establish business terms here. Non-null validToExclusive has support in the executed amendment's effective-date statement; it must equal the next term's validFrom for that account/contract. Open-ended last interval is the frozen generated agreement rule, not a fabricated literal “null”. Inherited cadence/anchor/identity may cite the initial agreement alongside the amendment. At most one identity per source account; every contract references such an identity, same seller, no unknown-B identity/contract.

An exact support literal is the complete relevant existing generator line (not just “3000” or “USD”). Multiple fields can share that line. The generator declares values and lines before rendering and independently emits them; consumers validate exact containment and compare typed values, never parse an expected fee from invoices or infer identity from legalName. Contracts for all known generated accounts may be represented; that does not add product candidates. Profile term IDs need not equal fact IDs; join by source/seller/account, contractId and exact interval/value tuple.

## Canonical ordering, hashes and immutable version transition

Use JS lexical comparison (`a < b`), not localeCompare. Set arrays: identities/contracts by id; demoBindings by identityFactId; originals by sourceId; citations by evidence.id; events by id; support by canonicalJson([field,fileId,expectedLiteral]); resolvedSupport by canonicalJson([factId,field,fileId,expectedLiteral,evidenceId]). Reject duplicate keys before sorting. A fact support tuple resolves to exactly one captured citation; B chooses the lexically first containing citation if multiple exist. No dangling/extra resolved tuples. Snapshot eventIds/evidenceIds lexical; all raw payload arrays retain order. Truth canonicalization remains exactly decodeTruth's existing ordering. No recursively dropped hash fields.

Producer hash is hashCanonical(all ProducerV1 fields except its own hash, after set ordering). `producerTruthJson` is canonicalJson(decodeTruth(original producer v1 file)); its hash must equal producerTruthHash. Producer metadata must equal that decoded truth's fixtureSetId/version=1/generator/company/source/seller/manifest. This is the producer file supplied in this run; it need not share generatorBuildHash with a historical previously pinned v1 file. Never silently swap the historical hash for the new one.

C creates a separate decoded financial truth object by changing only fixtureSetVersion from '1' to '2', then recomputing its hash with existing decodeTruth rules. All financial facts, generator metadata, original text/hash expectations and manifest references are byte-equivalent canonical values. Evidence.financialTruthHash and bundle.pin.hash bind this *rebound* v2 truth hash, not producerTruthHash. Bundle.truthJson is canonicalJson(rebound truth). Evidence hash is hashCanonical(all EvidenceInputV1 fields except its own hash, including full producer and canonical original truth string). Bundle hash is hashCanonical(all BundleV2 fields except bundleHash), including evidence.hash and every nested member. This is deliberately explicit duplication within the existing 10 MiB bound.

FixtureSetId remains original; new fixtureSetVersion is literal '2'; existing fixturePath hashCanonical([id,version]) is retained. Same v2 content is idempotent; changed v2 content conflicts; do not choose a new version automatically or overwrite. A future changed contract needs a separate reviewed version. Old v1 bundle has NO schemaVersion field; retain its exact strict decoder and immutable bytes. Missing evidence in v1 yields evidence_support unavailable/cases=0, not fixture corruption, auto-upgrade or pass. Historical pins/reports remain unchanged. Unknown bundle schema fails closed. A malformed v2 fails registration/read; do not downgrade to v1.

## Capture and byte proof (actual APIs)

B calls readEvidence(db,id,authorize) and readEvidenceBytes(db,store,id,authorize) for every aggregate snapshot.evidenceId. Those return EvidenceResponse and {bytes,mediaType}; neither returns API eventId or file metadata. Keep an operator-only scoped DB association read in the assembly helper: join source_evidence to source_files or source_events as evidence-records.ts does, require exactly one branch and company/source equality, e.snapshot_id equal aggregate, e.evidence equal returned response.evidence, and file_id/api_source_id equal response.sourceId. Record only Original's minimal binding in the bundle. This is trusted assembly provenance, not an assertion from the candidate. No public service extension, DB migration, or guessed parsing of sourceId is needed.

C independently verifies all of the following on pin and on read:

- Existing verifyTruthMembers and verifyCaptureBinding, manifest hash, exact event membership and hashes. EvidenceInput manifest/snapshot IDs/hashes and source scope equal the pinned values.
- Citations set equals snapshot.evidenceIds (not merely a subset); original source IDs equal distinct citation source IDs. Every manifest file is present once among document originals. No extra originals/citations. All response evidence.snapshotId equal actual aggregate snapshot.id. Current dossier.ts captures API citations at aggregate ID too; do not invent a member-snapshot exception.
- Canonical base64: decode then re-encode must equal input (standard alphabet/padding, no whitespace), bytes nonempty; hashBytes(bytes)=Original.sha256=response.original.sha256=response.evidence.sha256; byteLength and media types exact.
- Document sourceId=fileId and manifest file hash/kind match. Re-extract the same original bytes using extractDocument(manifestFile.kind,bytes); resolve locate(extraction.document,evidence.locator). Response text/value/offsets/excerpt/mediaType must exactly match. Recompute text.sha256 over the *whole response text.value*, not just excerpt. Check citation ID `ev:`+hashCanonical({snapshotId,sourceId,locator}). Existing locate enforces UTF-16 and surrogate boundaries. Compare original truth text to extracted page strings joined by one space / email body for those files; no whitespace rewriting.
- API binding eventId must exist in exact pinned events and same source/company/seller (unknown account remains unknown). Require sourceId=`api:`+hashCanonical({companyId,sourceRef,eventId}), extracted JSON canonical-equal event.payload; re-extract with api_json, resolve the actual pointer (currently ''), and compare exact response. The formula is independently checked, never a substitute for B's actual DB association.
- B event_csv proof: extract CSV and validate exact BATCH_HEADER; decodeBatch(file.streamId,extraction.document), require each row's entire reconstructed event canonical-equal the pinned event, including sequence/resource/kind/identity/versions/timestamps/payload/contentHash. Exact row union equals captured b-files events, no duplicate or extra events across files. Manifest batch metadata identifies stream and immutable file, not event.row inferred from array order. Citation row is 1-based excluding header, column payload_json for current generated nonempty rows, excerpt equals that row's canonical payload. API originals cover API events and CSV originals cover CSV events, jointly covering captured events. Semantic API events remain included. Do not treat CSV cell as a bare original JSON blob.
- Each resolved support points to its producer tuple and same file. expectedLiteral must be wholly contained in response.text.value.slice(startInclusive,endExclusive). A match elsewhere on the page/body fails. Independent typed fact equality and applicable account/contract interval are required in addition to literal containment. No fuzzy matches or reviewer confirmation shortcuts.

Re-extraction is an integrity check, not an independent business oracle. Facts originate pre-render; the fixture private root/assembly boundary provides provenance; hashes alone never authenticate. Include the extraction/locator and CSV decoder dependencies in evaluatorBuildHash if imported by the evaluator, as well as each new evaluator module and package-lock, so the report binds the executed checker.

## Supported evidence check and limits

A v2 valid bundle makes checking possible, not passing. Independently validate every requested profile's exact company/source/seller/account membership against facts. DemoBinding.parentCustomerId must equal identity.buyerId; accountId must equal IdSchema.parse(companyId+'.'+sellerEntityId+'.'+sourceAccountId). This is the existing accepted **development-only** mapping from `.superpowers/sdd/2026-11-08-implementation-plan/briefs/b-integrate-a1.md:58`; no production parent identity is inferred. Each profile account has its exact supported binding; all joined accounts must have the same buyer and canonical account consistent with profile.scope or fail. For the existing demo that means one raw account per profile. The approved parent-account lookup entry must map that raw account to that accountId and cite applicable identity support. Same legalName is never a join. Unknown B cannot obtain a binding.

Every supplied contract term must exactly match a fact applicable to the profile account, including initial/amended effective bounds, fee, currency/cadence/anchor; required active configuration cannot be absent. Its evidenceRefs must collectively cover its non-null required support fields, and each reference must be applicable rather than an unrelated valid citation. Constant USD mapping requires a cited currency fact applicable to each profile. Development financial mappings are the frozen F8 templates, source field operations plus explicit allocation/reversal references; invented money constants fail, even if a balancing result or confirmed finding exists. Other constant/lookup/operator reasoning outside this supported grammar is unavailable, not automatically approved by matching text.

Check emitted lineage independently for actual captured subject run: each operation's source event/paths, mapping operation, derivation IDs and citation references must match the declared supported derivation and pinned event. Do not reuse compiler/finance helpers to compute expected lineage. Verify configuration operations if any against independent customer/account/term facts; financial comparator explicitly ignores ensure_* today, so an unhandled ensure_* operation makes evidence_support unavailable. No requirement to implement parent writes or cause planner to emit configuration operations; absence is valid for its current financial-only plan, but must not be reported as tested parent configuration execution. Empty findings in supported demo require no invented confirmation; unresolved/material unsupported findings cannot be accepted as evidence. Unrepresented nonempty finding semantics stay unavailable.

For all selected profiles, unavailable required representation or unexercised assertion makes the whole evidence_support check unavailable. Actual contradictions in a supported representation fail; malformed private input fails closed before launch. A passing report counts real assertions/cases, never a nonempty evidence list. C may run this independent protected check alongside financial CheckPlans; do not force it into fake financial mutations or expose facts in the subject protocol. Eligibility still requires all thirteen actual checks and existing report binding.
