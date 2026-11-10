# Same-feed independent enrollment fixture: source-inspection design

Date: 2026-11-10. Assigned source base: `6d174ae4d7983044d7b2a8ee7dd78fe42f1cde3e`; concurrent P1 work remains owned by its existing writer. This document changes no implementation and dispatches no source work.

**Conclusion: a same-feed fixture is feasible by inspected interfaces, with no new producer export or protected-file change identified. Execution remains unproved.** The smallest identified input is two independently specified Company A invoices and two agreements, one invoice/agreement per customer. Both approvals consume the same captured manifest. This is an isolated construction fixture, not a replacement for canonical F8/demo fixtures or a claim of live generation.

The governing plan SHA-256 was checked as `89b4004bfb6e453f1bbd3069c43e2e89c11debda8f134e77aa8d5e81f97d26c0`; accepted design SHA-256 was checked as `0f01668bffbfe799ba38f940781d6e1a2e37e6b6a6a4585ede7095c8db1b3b6d`. Their independent reviews remain separate from review of this prerequisite. Root must review this document, reserve the conditional helper path, and release the SQL lease before implementation/execution, queued after P1/C/D/P3.

## Why the unchanged pipeline can admit this input

- `packages/sources/src/company-a.ts:20–42` fixes `company-a`, `legacy-a`, `seller-a`, six exact contracts, `a-finance` and `a-semantics`. Use that definition unchanged. `eventA` at line 49 creates version-1 source events and actual hashes; `prepareApiRecord` validates envelope/payload agreement and original JSON bytes (`packages/sources/src/records.ts:63–80`).
- `captureEvidenceFixture` is exported at `tests/fixtures/evidence-v2-capture.ts:46`. It captures arbitrary conforming A files through the real upload, publication, extraction and source-read APIs. It does not require the canonical generator's account names or account count. Its only filename constraint relevant here is a designated `contract-1.pdf` (lines 125–129). Call it once for the shared manifest, then select each agreement's captured page-one citation separately.
- `packages/evaluator/src/fixtures.ts:54–149` accepts independently authored canonical construction truth, verifies every event/member/version binding and binds selected accounts. `evidence-fixtures.ts:107–163,199–299` validates fact IDs, exact support fields, source originals, citations and metadata. The fixed Company A admission at lines 203–209 accepts this exact lane. No validator requires the third canonical account, an amendment, directory email, three historical months or a canonical-generator-specific build hash.
- The actual financial prerequisite is `case-recipes.ts:86–115`: each selected profile needs a 300000-cent invoice on its monthly anchor, matching USD 300000-cent terms and exact fixed contracts. September 1 with an October 1 cutover also permits the unchanged reversal probes at +1/+2 days (`cases.ts:166–201`). Other mandatory financial kinds are exercised by unchanged independent probes, not required as baseline originals. Snapshot-boundary coverage needs the two declared streams and nonempty events/files (`cases.ts:275–306`, `capture-boundary.ts:13–17`); an empty semantic stream is permitted.
- Bootstrap has an additional easily missed prerequisite: each selected customer needs a foreign account financial event backed by another producer identity (`bootstrap-cases.ts:40–45`). The two invoices supply this reciprocally. Each candidate contains only its own profile; the other original is correctly held as `UNKNOWN_ACCOUNT` in that candidate's bootstrap cases, never imported into its target.
- `buildDemoCandidate` accepts either captured agreement by its actual file/citation binding (`apps/control/src/demo-candidates.ts:72–107`). `prepareBootstrapVerification`, `pinProtectedEvidenceFixture`, financial probe/reservation/launch/completion, scope publication and policy publication already have callable exports. The private `writeTruth`, `identityFact`, `contractFact` and `writeEvidenceFacts` in `scripts/generate-fixtures.ts` are conveniences, not missing validation ports: author the exported `ProtectedFixtureSet`/`ProducerV1` input shapes locally and submit them to the unchanged exported decoders and pin producer. Do not export, copy or modify those private generator functions.

`generateSecondQualifyingAccount` (`tests/integration/sync-capture.test.ts:940–1033`) must not be copied: it generates truth and then rewrites amounts, evidence and hashes. `preparePeerSubject` at line 686 and `activateSubjects` at line 89 are private orchestration examples only. The new helper composes their public dependencies without importing the test suite or changing those functions. `tests/fixtures/activation-proof.ts`, all existing fixtures/generators/producers and saved demo pins stay byte-identical.

## Literal original and expectation specification

All values below are new test-only constants, authored before first publication. No account, amount, expected balance or expected billing term may be discovered from a compiler/preview/worker result. Do not call `generateFixtures` or `fixtureA` and transform their output.

| Field | First customer | Second customer |
| --- | --- | --- |
| sourceAccountId | `sync-selection-one` | `sync-selection-two` |
| parent accountId | `company-a.seller-a.sync-selection-one` | `company-a.seller-a.sync-selection-two` |
| buyer/customer ID | `sync-selection-buyer-one` | `sync-selection-buyer-two` |
| legal name | `Selection One` | `Selection Two` |
| contract ID | `sync-selection-contract-one` | `sync-selection-contract-two` |
| document ID | `doc-sync-selection-one` | `doc-sync-selection-two` |
| original filename | `contract-1.pdf` | `contract-2.pdf` |
| invoice recordId | `sync-selection-invoice-one` | `sync-selection-invoice-two` |
| event ID | `evt:sync-selection-invoice-one` | `evt:sync-selection-invoice-two` |
| a-finance sequence | 1 | 2 |
| connector/profile IDs before compilation | `sync-selection-spec-one` / `sync-selection-profile-one` | `sync-selection-spec-two` / `sync-selection-profile-two` |
| reviewer idempotency key | `sync-selection-approve-one` | `sync-selection-approve-two` |

Common fixed facts: company/source/seller are `company-a` / `legacy-a` / `seller-a`; source record and document versions are **1**; epoch is **1**; schema is `schema-a-1`; both accounts' semantic revision is `sem-a-1`. Cutover and source observedAt are `2026-10-01T00:00:00.000Z`. Fixture service/reviewer clock is `2026-11-09T08:00:00.000Z`. Invoice effective date is `2026-09-01`, effectiveAt `2026-09-01T00:00:00.000Z`, due date `2026-09-30`, raw decimal amount **`3000.00`**. Each independent expected invoice has **300000** integer cents, currency **USD**, the exact original event ID and sourceRecordVersion **1**. Each protected balance anchor is the literal **300000**. There are no baseline payments, credits, allocations or reversals.

The first API original is UTF-8 `canonicalJson` of precisely this object; the second substitutes only `account` and `id` with its table values:

```json
{"account":"sync-selection-one","amount":"3000.00","due_date":"2026-09-30","effective_date":"2026-09-01","id":"sync-selection-invoice-one","version":1}
```

Use `eventA` with these separately authored raw fields and sequence. Preserve the original bytes as `api-a/<hashCanonical(event.id)>.json`; `api-originals-a.json` maps exact IDs to those paths. Expected monetary records contain the separately written integer literal `300000`; never parse the generated JSON or call production mapping/finance to obtain that expectation. The helper may join the fixed record/event IDs and computed hashes for provenance, but not derive monetary truth from actual results.

Each PDF contains exactly five lines, with the second customer's table values substituted:

```text
Fixed monthly agreement sync-selection-contract-one
Seller seller-a; buyer sync-selection-buyer-one; account sync-selection-one
Legal name Selection One
Monthly fee USD 3000.00
Effective 2026-09-01; monthly invoice anchor day 1.
```

Call unchanged `textPdf(lines, cutover, lines[0])` once per file. Pin the actual bytes with `hashBytes`, not a guessed digest. Original expected extracted text is `lines.join(' ')`, independently checked by the unchanged PDF extractor and evidence decoder. Upload kind is `contract_pdf`; documentVersion is 1; use `sourceFileId(metadata)` for actual file IDs. Do not rewrite PDFs after deriving hashes.

Each independently authored contract fact is monthly, anchor day **1**, fixedMonthlyFeeCents **300000**, USD, validFrom **2026-09-01**, validToExclusive **null**. Terminal null is derived from the one-term chain, per `bootstrap-fixtures.ts:181–192`. Identity support has exactly sourceAccountId/sellerEntityId/buyerId from the party line and legalName from its line. Contract support has exactly sourceAccountId/sellerEntityId from the party line; contractId from the title; fixedMonthlyFeeCents/currency from the fee line; validFrom/cadence/anchorDay from the effective line. No validToExclusive support is invented. Fact IDs use the checked formulas at `evidence-fixtures.ts:116,123` with these literal values.

Manifest ID: `manifest-sync-selection-peers-v1`. Include all six fixed schemaVersions, both account semantic-map entries, both PDFs and exactly these stream members:

| stream | snapshotId | resumeAfter | eventIds in numeric sequence order |
| --- | --- | --- | --- |
| a-finance | `member:manifest-sync-selection-peers-v1:a-finance` | `2` | both invoice event IDs above |
| a-semantics | `member:manifest-sync-selection-peers-v1:a-semantics` | `0` | empty |

Compute stream hashes using `streamContentHash`, then `hashManifest`; actual capture creates `snapshot:manifest-sync-selection-peers-v1` and its citations/content hash. No custom SourceDefinition, resource, financial stream or renamed semantic transport is needed.

Create only the visible files consumed by `captureEvidenceFixture`: the two PDFs, two API originals, `api-a.json`, `api-originals-a.json`, `manifest-a.json`, `uploads-a.json`. Create fresh private `expected-a.json` and `evidence-a.json`, fixtureSetId `truth-sync-selection-peers-v1`, v1 construction truth / producerFixtureSetVersion `1`. Protected evidence promotion to version `2` is performed by the unchanged pin producer. Generator seed is `sync-selection-peers-v1`; generator.buildHash must truthfully hash the new helper's actual source, its reused `canonical-fixtures.ts`/`company-a.ts` and `package-lock.json` bytes in a path-sorted inventory. Do not claim the existing canonical generator produced these records. Both truth and producer carry the same actual inventory hash. Sort arrays by the exact existing decoder keys before hashing. Validate with `decodeTruth` and `decodeEvidenceProducer`, then write once with `wx` and private permissions; retain before-publication file digests and compare after the entire proof/approval run. No output exists to rewrite on failure: dispose the fixture and fix the reviewed authoring source in a fresh root.

## Proposed helper boundary and genuine execution sequence

Conditional new path only: `tests/fixtures/sync-selection.ts`. No existing helper changes or additional exports are required. Proposed external API (not yet implemented):

```ts
export async function createSyncSelectionFixture(): Promise<{
  db: Pool;
  close(): Promise<void>;
  subjects: [
    { identity: CommittedAuthorityIdentityV1; stored: StoredActivation },
    { identity: CommittedAuthorityIdentityV1; stored: StoredActivation },
  ]; // table order: one, two
  capture(identity: CommittedAuthorityIdentityV1, page: ChangePage): Promise<CaptureResultV1>;
}>;
```

Use imported existing types. The factory returns only after both exact approvals, A5 receipts, initial-origin checks and shared-lane initialization succeed. It exposes neither protected roots/truth nor owner DB connections. `capture` simply calls the accepted `openCommitted(identity)` then `capturePage(page)`; it is a setup writer, never called from `selector.inspect`. Do not fabricate capture rows or treat a selection proposal as capture/apply authority.

1. Under the root-granted exclusive SQL lease, allocate a fresh `testNamespace('selpeers')`, provision/migrate one disposable control/runtime pair, create separate application pools, evidence store and disjoint visible/truth/registry/evidence-pin/bootstrap/policy roots. Author all originals and expected inputs once as above.
2. Capture the common manifest once with unchanged `captureEvidenceFixture`. For each agreement, use its real page-one citation with `buildDemoCandidate`; change only the spec/profile identifiers to the table's names before `hashProfile` and `compile`. Keep the candidate's supported mappings, exact fixed contracts/capture, bootstrap term `demo-term-a` and configuration ID `configuration:demo-term-a`. Configuration records are scope-keyed (`activation-store.ts:274–295`), so these repeated local term/configuration IDs do not pool customer records. Register two independently compiled one-profile candidates against the same capture.
3. Pin the common evidence once. For each exact candidate, read genuine registered financial capture, run protected launcher `probe` with fixture version `2`, prepare its separately versioned bootstrap sidecar (`bootstrap-peer-one-v1` / `bootstrap-peer-two-v1`), reserve/start/launch/complete the financial job through `createFinancialAttestationRegistry`. Require real `report.eligible`, complete mandatory coverage and all passed checks. Preserve actual returned attestations and hashes. A schema-valid or merely pinned input is insufficient.
4. Publish both exact scope selections together through `createRegisteredScopePublication`; install one policy containing both derived entries via `prepareAndPublishActivationPolicy`, with actual financial report IDs and bootstrap sidecar pins. Persist one private selection file with `wx`. Publishing scopes/policy does not enroll either customer.
5. Compose the normal worker parent-read service, source semantics observer, `composeActivationReview` and local reviewer session restricted to these two accounts. For each customer separately, authenticated POST `/api/review/<accountId>/prepare` executes real protected bootstrap reserve/launch/completion (`review-proof-selection.ts:78–103`). Require a successful package; POST `/activate` with that package's exact hashes/version and its distinct table key. Read the committed intent, pass its actual bundle hash/key to `createWorkerActivation.activate`, then use `readStoredActivation`. This is the existing fixture's real A5 route, not insertion of approval/completion rows. After customer one, assert customer two still has no stored activation/target before its own reviewer action.
6. Validate both stored bundles/receipts and expected targets below; open committed capture for one and then two. Require identical lane `{sourceRef:'legacy-a', manifestHash:<actual shared hash>}`, exactly one lane whose initial_activation_id remains one's activation, and baseline vectors finance `2`, semantics `0`. Both are real selected committed profiles, not merely bundled profiles. Return the fixture with no post-baseline capture yet.

## Required evidence before the helper is released

Add prerequisite assertions to the reserved new `tests/integration/sync-selection.test.ts`, not existing suites. The factory must fail if these prerequisites fail; no skip or synthetic fallback is allowed.

- **Real financial/bootstrap eligibility for both subjects.** Check each stored bundle's actual verificationReport has eligible true, every mandatory check executed/passed and only its exact required profile; financialAttestation binds that report/capture/artifact; bootstrapVerification.passed is true with all required cases/assertions passed and its selected profile/plan. Inspect both separately. The single-invoice minimum is a source-inspection hypothesis until these assertions execute successfully.
- **Two exact first imports and independent truth.** Each target version is 1 and contains exactly its one invoice: literal identity/scope/event/version/effectiveAt/dueDate/currency/300000 cents from this document; all four other financial collections empty. Exactly one customer, one account and one scoped billing configuration match its literal agreement. Receipt beforeBalanceCents is 0, afterBalanceCents 300000, and its targetRecordIds/eventIds bind only its own invoice. Use public `targetRecordId` solely for the canonical ID formula. Distinct request keys, review package IDs, selected profile hashes, artifact hashes, activation IDs, bundle hashes and receipt IDs must be observed. Each bundle retains the complete shared two-event capture, while its plan/import contains only its selected event.
- **Authoritative origins.** Read each current target and call existing `readFinancialOrigins` on its invoice. Require exactly `{kind:'initial', recordId:<derived ID>, importKey:<own approval key>, receipt:<own exact stored receipt>}`. The two records never point to each other's receipt. Unchanged migration 006's trigger supplies runtime_financial_origins for new A5 inserts (`db/runtime/006_sync_apply_repair.sql:113–126`); the fixture performs no origin backfill. `sync-store.ts:245–252,289–295` validates the original associations.
- **Shared capture, separate routing.** After return, capture a literal next page through subject one containing one schema-valid new payment per account at sequences 3 and 4 (distinct record/event IDs; USD 100.00 raw / 10000 expected cents; effective 2026-10-01, sem-a-1). Use the actual shared baseline hash, stream `a-finance`, after `2`, next `4`. The same page through subject two must replay without new capture/economic effects. Both bound progress reads agree; semantic cursor remains `0`. Selection must recognize two known subjects and produce their independent earliest payment groups, not label the other's known account unknown. Since the new payments are unallocated, proposed invoice balances remain 300000. Snapshot the durable runtime state after capture and compare after inspection: no target, origin, approval, outcome, receipt, application-head, activity or capture mutation. This test is conditional on the later accepted selector implementation; fixture qualification itself can precede it.
- **Immutable inputs and history.** Re-hash every newly authored visible/truth file after both proofs and imports; compare byte-for-byte with the pre-publication inventory. Compare source-tree hashes for every pre-existing fixture/generator/protected-producer file and saved demo pins against the pre-work reservation baseline. Capture/selection cannot rewrite either approved snapshot or any original. Repeat fixture creation in a fresh isolated root, not by changing an existing pin/version.

Factory failure and `close()` must close control/worker listeners, release checked-out clients, end both application pools, drop only its generated test namespace, and remove only its own fresh temporary root. Cleanup is idempotent and covers partial construction without masking the original assertion failure. Use the existing root-provided `EAPR_TEST_PREFIX` lease (`native-db.ts:111–120`); do not select another lease, start a competing cluster, stop the shared cluster, run migrations concurrently with P1, or touch demo DBs. No DB access was performed for this design.

## Limits and remaining gates

This supplies only genuine **same-feed** peers on the fixed A lane. Cross-financial-stream/separate-resource cases remain blocked by the already published owner dependency (`evidence-fixtures.ts:203–209`, fixed resource expectations in `evidence-support.ts:87–134` and `case-recipes.ts:86–101`). This document neither broadens their admission nor waives their mandatory tests.

Verification performed here: read-only source/specification inspection and governing-document SHA-256 checks. No source/test edit, generated fixture, protected producer execution, PostgreSQL operation, test run, provider call, Git mutation or subagent. Only this report was written. Independent review of this report, actual qualification execution against the frozen source candidate, whole-selector integration coverage and user acceptance remain separate. If the unchanged pipeline rejects the minimal literal fixture, preserve that failure and raise its exact owner interface/contract gap; do not repair truth from observed candidate output or borrow completed approvals.
