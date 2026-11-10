# Two narrow sync-selection fixture variants

Proposed design, 2026-11-10. Read-only inspection of `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`, assigned base `578624a43a85c3e9b2dfe20803330b4506f7e786`. This document does not qualify either fixture or release implementation, SQL, selector consumers, or a broader acceptance gate. No repository file, Git state, database, provider, protected producer, or test was changed. The concurrent fixed same-feed fixture remains independently owned and unchanged.

## Scope and approach

Close only the audited Platform fixture dependencies for (1) genuine distinct immutable approval baselines in one runtime and (2) a genuinely unselected profile present in an approved full artifact. Keep the accepted zero-argument `createSyncSelectionFixture`, its two one-profile grants, common vector `{a-finance:2,a-semantics:0}`, and its four qualification cases intact. Neither variant supplies the independently unaffected mapping or cross-financial-stream scenario. Neither supplies selection behavior before the selector's own tests execute.

Recommend two separate zero-argument fixture factories with their own qualification suites, using one narrowly extracted test-only enrollment lifecycle:

- `tests/fixtures/sync-selection-baselines.ts`
- `tests/integration/sync-selection-baselines-fixture.test.ts`
- `tests/fixtures/sync-selection-bundled.ts`
- `tests/integration/sync-selection-bundled-fixture.test.ts`

These are proposed new reservations, not current write authorization. Also propose `tests/fixtures/sync-selection-enrollment.ts` for a separately reviewed extraction after the current fixed-fixture review finishes. That extraction alone may refactor `tests/fixtures/sync-selection.ts`; its zero-argument public factory, exact original facts and four qualification cases remain unchanged. Platform/root owns authoring, orchestration and proof qualification; source/evaluator owners adjudicate an actual producer rejection. One source writer implements the extraction, then one bounded variant at a time after each root release. A fresh reviewer reviews each exact resulting candidate. No changes to existing qualification test assertions, generators, producers, registry, public exports, contracts, runtime code, migrations or demo pins are proposed.

Alternatives considered: three complete lifecycle copies repeat real proof/approval and failure handling; parameterizing the active fixed public helper broadens its accepted contract; a general author/proof configuration framework adds unnecessary concepts. The concrete extraction below reuses the already implemented lifecycle without encoding financial scenarios or selecting profiles from all bundle members. Do not import private functions from integration suites or export generator internals.

### Concrete reuse assessment against `cc78b73`

The committed fixed helper has 531 lines; its public factory is lines 226–531. The following existing blocks are substantively identical across all three constructions:

| Existing fixed-helper lines | Extracted responsibility | Variant-sensitive facts left outside |
| --- | --- | --- |
| 235–272, 276–279, 521–530 | temporary root, namespace, separate pools, migration, evidence/registry/source services, reverse cleanup | original authoring and publication order |
| 305–320, 324–359 | protected launcher setup, exact capture read/probe, bootstrap pin, financial reserve/start/launch/complete and eligibility | evidence pin publication, exact selected bootstrap descriptor, job/fixture IDs |
| 363–412 | selected-scope publication, policy/selection file, worker parent-read listener, local session and activation review/worker service | exact already-proved selected entries and policy ID |
| 415–442, 476–487 | authenticated prepare/activate, intent delivery, stored-target/proof readback, bootstrap result checks | literal full target, receipt money/membership and origin expectations |

Approximately **190–210 existing executable lines** can move rather than be copied into both variants; about 60–90 additional shared lines cover imports, concrete types and argument binding. Candidate construction at 281–303, selected fact assembly at 321–334, literal financial/metadata assertions at 443–473, and variant lane assertions at 490–513 are not generic lifecycle. Their economic expectations stay visible in each fixed author/factory and its independent qualification test. Author inputs at 1–217 also stay scenario-specific; there is no template that synthesizes expected amounts from actual source or results.

Use one new internal module `tests/fixtures/sync-selection-enrollment.ts`, with this small concrete boundary (types imported/inferred from existing APIs, not a new product contract):

```ts
// Test-only trusted orchestration; no public fixture caller receives this object.
createSelectionEnrollment(): Promise<{
  db: Pool;
  root: string;
  roots: { visibleRoot: string; truthRoot: string };
  dependencies: UploadDependencies;
  service: ReturnType<typeof createSourceService>;
  candidates: ReturnType<typeof createCandidateRegistry>;
  bootstrapRoots: BootstrapRoots;
  prove(input: {
    selection: RegisteredScopeSelection;
    jobId: Id;
    review: Omit<BootstrapExpectationReview, 'evidencePin'>;
  }): Promise<SelectionProof>;
  openReviewer(input: {
    policyId: Id;
    proofs: readonly SelectionProof[];
  }): Promise<{
    approve(proof: SelectionProof, idempotencyKey: Id): Promise<SelectionSubject>;
    stop(): Promise<void>;
  }>;
  close(): Promise<void>;
}>;
```

`SelectionProof` contains exactly the real `report`, `attestation` and existing review-selection `entry` produced by the current prove function; `SelectionSubject` is the existing `{identity, stored}` pair. Do not include `peer`, citation, monetary expectations or capture configuration in these shared DTOs. Distinct-baseline author roots are explicit `visible/old`, `visible/new`, `truth/old` and `truth/new` children; the context's served-root exclusion already covers the complete visible parent directory. The context exposes only application dependencies already needed by trusted test authoring; control pool/credentials are never added to the public fixture return. Use the existing fixed clock, source catalog, namespace/root prefixes, directory layout and web/reviewer constants in the shared module. In particular, this extraction does not accept injected launchers, arbitrary sources, callbacks/hooks, fake proofs, SQL, source vectors, selected-count modes or strategy objects. It has no extension registry. More flexibility requires a new reviewed use case.

`prove` obtains the full registered candidate/capture from the exact existing selection, never accepts a caller-supplied subset of profiles, and derives requiredProfileHashes from the real artifact. It supplies the probe's actual `evidencePin` to the separately authored reviewed subject descriptor. The descriptor and fixture/job IDs are necessary existing protocol inputs, not options for manufacturing truth. The calling fixture still pins each captured evidence input explicitly: once for fixed peers/bundled, twice for distinct baselines. Keep the current real reservation/start/launch/complete order and positive mandatory coverage assertions. Preserve the actual returned report and attestation for later equality checks.

`openReviewer` is called once, only after all its proofs exist. It publishes/install-selects exactly their entries, resolves each entry's one selected profile from the real registry to derive allowedAccountIds, and never turns all artifact profiles into reviewer grants or scope selections. `approve` must assert its proof's exact canonical entry is one installed by that reviewer session; it then runs the same authenticated prepare/activate/A5 path and compares stored report/attestation to that proof. Return the validated committed pair after `readStoredTarget` equals its approved target and actual bootstrap binding/pin/plan checks pass. The caller immediately performs its independent full literal target, receipt and strict origin checks; do not replace these with hashes or a shared “expected target” builder. The factory retains between-approval absence checks and its capture initialization, lane cardinality and vector assertions. Thus separate manifest inputs and full-artifact versus selected-profile distinctions are explicit caller facts; the shared lifecycle does not interpret them.

The context registers each owned resource immediately. Initialization failures self-clean before rejection. Later factory failures await `close` while preserving the original error; `openReviewer.stop` closes only its constructed listeners and is also registered in context cleanup. Normal factories stop review before capture initialization and return only the existing public fields plus `close`. A small identical outer try/catch in each factory is preferable to a callback-based fixture framework. Do not abstract the four qualification test bodies into shared success assertions: the independent suites must still inspect their own literal records and absence/membership conditions. Common tests call the existing source/DB/service exports through unchanged call sites so the current call-through cleanup spies remain meaningful.

Extraction is a separate first task, after current fixed-fixture acceptance, with only the new enrollment module and existing fixed fixture reserved. Its verification reruns typecheck and **all four existing `same-feed fixture qualification` tests unchanged**; source/inventory and exact-candidate review are required before any variant consumes it. Preserve author original fields, public shape, two one-profile approvals, shared manifest/vector 2/0, literal assertions, genuine proof chain and cleanup behavior. Its generator build inventory should include the new helper dependency truthfully; source-build/proof hashes may therefore change in newly created roots, but no existing original or pin is rewritten. The current suite does not hardcode those build hashes. New module bytes are covered by its existing recursive `tests/fixtures` inventory; do not weaken that inventory or the cleanup observer assertions to make extraction pass. If an observer or qualification breaks, correct the extraction or report the exact seam rather than rewriting a passing prerequisite.

Primary risks are losing cleanup on an intermediate constructor failure, accidentally granting all bundled profiles, substituting the current/latest capture for the selected manifest, and moving literal expected-state assertions into actual-result-derived helpers. The preserved fixed qualification plus variant-specific negative membership/absence assertions address those risks. The extraction itself is not an authorization to change shared producer semantics. If the extraction cannot stay within these concrete steps without new scenario switches, stop and give root the actual incompatibility; do not silently recreate whole duplicate lifecycles.

Revised rough sizes: shared enrollment module **250–300 lines**; existing fixed helper shrinks by roughly **170–200 net lines**; each new variant factory/author module **300–400 lines**, plus **200–300 lines per independent qualification suite**. Compared with adding two complete 500–700-line copies, this removes roughly 300–400 net repeated orchestration lines across all three helpers after allowing for the new boundary. Exact diff/line counts must be measured at extraction review; these are estimates grounded in the blocks above, not code-size acceptance quotas. The exact fixture cardinalities below remain unchanged. Directly measure accessible outer evaluator request/response/context serialization and framing, evidence-pin/sidecar file lengths, and outer invocation elapsed times through unchanged parent-process boundaries; label returned-response object serialization separately from unexposed raw wire byte counts. Record individual nested subject-runner sizes/timings as unobserved. Separately retain unchanged nested transport cap/deadline enforcement plus complete successful mandatory reports from the same genuine runs as compliance evidence. Preserve every existing limit/comparison and full financial/bootstrap requirement; no protected telemetry, new hooks, substitute runs, invented digests or byte counts.

## Common authoring and proof rules

Use unchanged fixed `companyA`: company `company-a`, source `legacy-a`, seller `seller-a`, schema `schema-a-1`, per-account semantics `sem-a-1`, six contracts and the exact `a-finance` API / `a-semantics` semantic streams. All document and record versions are 1. Service/reviewer clock is `2026-11-09T08:00:00.000Z`; source observation and financial effective instants are the separately specified values below. No model/provider path exists.

Author all visible original bytes, v1 `ProtectedFixtureSet` truth, and `ProducerV1` evidence facts before the first publication. Independent monetary expectations are integer literals, never parsed from raw amounts or copied from compiler, preview, planner, evaluator subject, receipt, or target output. Using canonical hash/identity formulas and fixed source constructors to bind provenance is allowed. The independent evaluator may calculate from those independently authored inputs through its existing reference implementation.

Create a private temporary root with disjoint visible/truth, source-evidence, artifact-registry, evidence-pin, bootstrap-sidecar, and policy directories. Write author inputs once with `wx`, private modes, and record their digests before publication. Use `decodeTruth` and `decodeEvidenceProducer` before submitting them. Let `pinProtectedEvidenceFixture` alone promote v1 author inputs to v2 protected evidence. Do not patch a pin, expected result, original, report, bootstrap sidecar, approval bundle or persisted financial row in response to failure; report the exact failure and rebuild only a separately corrected author source in a fresh root.

For each helper, `generator.seed` is its fixed variant seed below. Its `generator.buildHash` is a path-sorted canonical inventory of that helper's actual source bytes plus `tests/fixtures/sync-selection-enrollment.ts`, `packages/sources/src/canonical-fixtures.ts`, `packages/sources/src/company-a.ts`, and `package-lock.json`; add any actual new authoring dependency if one is introduced. Truth and producer carry the same inventory hash. Do not attribute these facts to the canonical demo generator. Sort each truth/support collection by its existing decoder key before hashing. Compare every authored input digest again after both construction and qualification capture. For each variant task, take the pre-existing fixture/generator/protected-producer/migration and saved-demo-pin inventory after the accepted extraction, and prove it unchanged at handoff. During the earlier extraction, only its two explicitly reserved paths may change; all other pre-existing paths and every saved pin remain unchanged. Runtime qualification inventories still compare all existing files before and after execution.

The extracted lifecycle composes existing exports only. Scenario factories retain explicit authorship, publication/pinning, descriptor assembly, literal assertions and capture initialization. Shared proof sequence:

1. Under the root-granted exclusive PostgreSQL lease, allocate one generated namespace, one disposable control/runtime pair and separate application pools; migrate with existing scripts. No direct SQL fabrication of successful reports, approvals, targets, origins or capture rows.
2. `captureEvidenceFixture` uploads/publishes/captures each fixed original set into the same control database and evidence store. Build and register exact immutable spec/profile/artifact/capture objects with `compile` and `createCandidateRegistry`.
3. Pin evidence; read the exact capture with `createFinancialCaptureReader`; use `createProtectedFinancialLauncher.probe`, genuine financial reservation/start/launch/complete through `createFinancialAttestationRegistry`, and `prepareBootstrapVerification` for independently reviewed selected-subject sidecars. Each actual financial report must be eligible, have zero unexplained difference, and exactly all mandatory checks executed/passed with positive case counts; check complete profile/source/kind and capture/build/provenance binding.
4. Publish exact selected scopes together using `createRegisteredScopePublication`. `prepareAndPublishActivationPolicy` installs the exact entries with real report and bootstrap pins. Persist the one private selection file with `wx`. This setup grants no approval. The baselines helper publishes two selected entries; the bundled helper publishes exactly one.
5. Compose a real worker parent-read listener, authenticated local reviewer session and `composeActivationReview`. Every enrolled customer separately receives POST prepare then POST activate with exact returned hashes/version and its literal idempotency key. Preparation runs real protected bootstrap reservation/launch/completion. Read the committed intent and use `createWorkerActivation.activate` with its exact bundle hash/key. Validate `readStoredActivation`, target and authoritative initial origins. This is the established fixture's genuine review-to-A5 path; there is no fake HTTP success or inserted approval.
6. Close the construction control/worker listeners after imports, then initialize only enrolled capture lanes using `createRuntimeCapture.openCommitted`. Return the runtime application pool and capture delegate. No control pool, owner URL, protected root, truth, policy token, arbitrary author configuration, or reviewer/approval capability escapes the fixture.

Existing feasibility anchors: `packages/sources/src/dossier.ts:publishBaseline` enforces increasing epochs and publication high-water; `tests/fixtures/evidence-v2-capture.ts:captureEvidenceFixture` accepts these conforming inputs and resolves literal supports to real citations; `packages/evaluator/src/fixtures.ts:verifyTruthMembers/bindTruth` validates contiguous per-manifest membership and non-overlapping profiles; `packages/evaluator/src/case-recipes.ts:chooseRecipe` requires the fixed 300000-cent monthly invoice used here; `packages/evaluator/src/bootstrap-cases.ts:buildBootstrapCases` needs selected financial input plus foreign-account input backed by a producer identity. Both variants supply that foreign input through the other original invoice. Full financial artifact membership and selected bootstrap authority are distinct, as enforced by `apps/worker/src/activation-validation.ts`.

## Variant 1: distinct baselines

Factory:

```ts
export async function createSyncSelectionBaselinesFixture(): Promise<{
  db: Pool;
  close(): Promise<void>;
  subjects: [
    { identity: CommittedAuthorityIdentityV1; stored: StoredActivation }, // older
    { identity: CommittedAuthorityIdentityV1; stored: StoredActivation }, // newer
  ];
  capture(identity: CommittedAuthorityIdentityV1, page: ChangePage): Promise<CaptureResultV1>;
}>;
```

Return only after two real imports and two initialized lanes, with no post-baseline captured pages. Reuse existing DTO types. The capture method delegates `openCommitted(identity).capturePage(page)` and introduces no event override. The consumer can obtain the exact window event from the newer stored bundle's immutable bootstrap events; no extra fixture factory mode or event-generation API is necessary.

### Exact independent originals

| Fact | Older customer | Newer customer |
| --- | --- | --- |
| source account | `sync-base-old` | `sync-base-new` |
| parent account | `company-a.seller-a.sync-base-old` | `company-a.seller-a.sync-base-new` |
| buyer | `sync-base-buyer-old` | `sync-base-buyer-new` |
| legal name | `Baseline Old` | `Baseline New` |
| contract | `sync-base-contract-old` | `sync-base-contract-new` |
| document ID | `doc-sync-base-old` | `doc-sync-base-new` |
| file | `contract-1.pdf` | `contract-2.pdf` |
| invoice record ID | `sync-base-invoice-old` | `sync-base-invoice-new` |
| invoice event ID | `evt:sync-base-invoice-old` | `evt:sync-base-invoice-new` |
| finance position | 1 | 2 |
| spec/profile ID | `sync-base-spec-old` / `sync-base-profile-old` | `sync-base-spec-new` / `sync-base-profile-new` |
| approval key | `sync-base-approve-old` | `sync-base-approve-new` |

Both invoice raw originals are canonical JSON of the following object, substituting only their literal `account` and `id`:

```json
{"account":"sync-base-old","amount":"3000.00","due_date":"2026-09-30","effective_date":"2026-09-01","id":"sync-base-invoice-old","version":1}
```

`eventA` creates invoice envelopes at positions 1 and 2 with observedAt `2026-10-01T00:00:00.000Z`, effectiveAt `2026-09-01T00:00:00.000Z`, version 1 and `sem-a-1`. The independently written expected invoice for each account is USD **300000** cents, due `2026-09-30`, with its own exact event/record/version/effectiveAt. Both balance anchors are **300000**.

Each PDF is the following five literal lines, substituting its table values:

```text
Fixed monthly agreement sync-base-contract-old
Seller seller-a; buyer sync-base-buyer-old; account sync-base-old
Legal name Baseline Old
Monthly fee USD 3000.00
Effective 2026-09-01; monthly invoice anchor day 1.
```

Generate each PDF only once with unchanged `textPdf(lines, '2026-10-01T00:00:00.000Z', lines[0])`. Both capture input roots contain those identical original PDF bytes, metadata/file IDs and hashes; do not regenerate them with the newer as-of. Expected extracted text is independently authored `lines.join(' ')`. Identity supports are party-line sourceAccountId/sellerEntityId/buyerId and legal-name line. Contract supports are party-line sourceAccountId/sellerEntityId, title contractId, fee-line **fixedMonthlyFeeCents/currency**, effective-line validFrom/cadence/anchorDay. Each contract fact is USD **300000**, monthly, anchor **1**, validFrom `2026-09-01`, terminal null. Fact IDs use the existing canonical formulas; no null-end citation is invented.

The single window event is an unallocated payment for the **older account** at finance position **3**, record ID `sync-base-window-pay`, event ID `evt:sync-base-window-pay`. Its independent raw original is:

```json
{"account":"sync-base-old","amount":"100.00","effective_date":"2026-10-01","id":"sync-base-window-pay","version":1}
```

Its envelope is constructed once with `eventA`, observedAt `2026-10-02T00:00:00.000Z`, effectiveAt `2026-10-01T00:00:00.000Z`, schema/semantics unchanged. The separately authored expected record in the newer truth is payment, USD **10000** cents, exact event/record/version/effectiveAt, no allocation or invoice reference. Its independent expected effect on invoice balance is **zero**: older account anchor stays **300000**. The older truth has no position-3 member or payment expectation because that input is outside its manifest, not because it is erased. The newer selected customer's actual financial proof/import remains its own 300000-cent invoice; this design does not falsely claim that proof selected the older payment. That payment's older-customer ongoing mapping is a later literal selector assertion.

| Capture | Older M1 | Newer M2 |
| --- | --- | --- |
| manifest | `manifest-sync-baselines-old-v1` | `manifest-sync-baselines-new-v1` |
| epoch | 1 | 2 |
| asOf | `2026-10-01T00:00:00.000Z` | `2026-10-02T00:00:00.000Z` |
| finance baseline/member IDs | `2`, invoices 1/2 | `3`, exact prefix 1/2 plus payment 3 |
| semantic baseline/member IDs | `0`, empty | `0`, empty |
| truth fixture ID | `truth-sync-baselines-old-v1` | `truth-sync-baselines-new-v1` |
| bootstrap version | `bootstrap-baselines-old-v1` | `bootstrap-baselines-new-v1` |

Both manifests have all six schema entries, both semantic-map entries and both exact PDF members. Stream snapshot IDs are `member:<manifestId>:<streamId>`; aggregate snapshot ID is the existing `snapshot:<manifestId>`. Compute real stream/manifest hashes. Seed is `sync-baselines-v1`. V1 truth/producer version is `1`, protected evidence version is `2` separately under each truth fixture ID. Each visible root contains the same required fixed filenames; truth roots contain independently authored `expected-a.json`/`evidence-a.json`. API originals are at `api-a/<hashCanonical(event.id)>.json`, with exact index maps.

There are **two distinct PDFs and three distinct API originals globally**; the roots contain two/three API originals respectively and identical PDF/prefix copies. Total unique source deliveries after bootstrap initialization are three, not five. There are two candidate artifacts, each with exactly one selected profile, two financial jobs and two selected-bootstrap proofs, two explicit reviewer actions/imports/origins, two runtime lanes and four lane-stream checkpoints.

### Publication, approval and lane order

Author both complete roots and expectations before publication. Publish/capture/register M1 first while its source high-water is 2. Then publish/capture/register M2 with epoch 2 and high-water 3, preserving prefix canonical events, API bytes and document bytes exactly. Do not publish position 3 before M1; `publishBaseline` rejects an old watermark below current high-water. Do not change prefix observedAt to M2's asOf.

Register older profile/spec only with its M1 citation; register newer profile/spec only with its M2 citation. Existing `buildDemoCandidate` can parse each separate five-line agreement; change only the pre-compilation spec/profile IDs to the fixed table IDs, then compute actual profile/artifact hashes. Use selected profile's own `demo-term-a` / `configuration:demo-term-a` from that builder; repeated IDs remain scope keyed. Two published scopes are distinct accounts and one policy/selection file has the two exact entries, each with its own manifest/report/bootstrap pins. Both real reviewer approvals occur after M2 publication. Thus position 3 exists while M1's review is pending, yet M1's immutable approved source cursor remains 2. Current semantics reads the latest M2 but the same `sem-a-1`, with no semantic override or stub. Approve older, assert newer still absent, then approve newer. Normal parent reads resolve each own registered manifest, not the latest global capture.

Initialize older lane then newer lane. Require two different manifest hashes, lane initial_activation_id equal to each own approval, vectors `(2,0)` and `(3,0)`, zero captured pages and their respective cursors unchanged. Newer initialization sees the two existing global prefix identities and inserts only position 3; accepted global identity comparison must accept exactly identical canonical originals. Window payment is baseline source evidence for M2, not a newer-customer imported record and not a fabricated ongoing inbox row.

### Qualification and later selector use

Named suite `distinct-baseline fixture qualification`, four executed tests:

1. `real distinct proofs and first imports`: exact mandatory full financial report/attestation checks for each separate single-profile artifact and its own manifest, actual successful selected-bootstrap cases/assertions and exact plan; two independent review/request/package/profile/artifact/activation/bundle/receipt bindings. Initial targets each contain exactly their literal invoice plus one customer/account/scoped configuration, version 1, all other financial arrays empty, receipt balances 0→300000 and only own invoice event/ID. `readFinancialOrigins` returns each invoice's own exact initial receipt/import key. The window payment has no parent record/origin/receipt effect. Confirm complete old bootstrap has exactly 1/2; complete new bootstrap exactly 1/2/3; equality of the common original prefix and literal window bytes/content hash. This must remain true after all later captures.
2. `independent complete lane intervals`: author two further literal unallocated payments for qualification, `sync-base-later-old` at seq4 for older account with raw **200.00** / independent **20000** cents, and `sync-base-later-new` at seq5 for newer account with raw **100.00** / independent **10000** cents. Both effective date `2026-10-02`, observedAt `2026-10-03T00:00:00.000Z`, version/schema/semantics unchanged. Capture newer lane page after3→next5 with exactly seq4/5; then older lane after2→next5 with exactly seq3/4/5, using each own manifest hash and the identical events4/5 on both. Assert retained exact canonical pages/members, contiguous progress, global delivery deduplication and distinct lane membership; replay both exact pages with no added rows/effects. Older has 3 ongoing inbox members; newer has 2; seq3 never becomes a newer ongoing member. Capture changes only capture state, never initial imports, targets, origins or snapshots.
3. `fresh construction and immutable inputs`: build a second wholly fresh isolated fixture and prove the same literal vectors/records/report coverage, internally exact bindings and unchanged source/author inventories. Compare fixed source hashes where deterministic; do not demand identical random review/job/receipt identities between independent runs. One real independent construction is enough; no retry-until-green loop.
4. `partial construction cleanup`: call-through fault injection at `composeActivationReview` after real financial work and the live parent-read worker has started. Preserve the sentinel error; await listener close, both pool ends, exact generated namespace drop and owned root removal. Test normal returned `close()` twice after primary tests. Restore spies/fallback cleanup even on failure. No fake financial pass is involved.

The later Task 9 `genuine_distinct_baselines` consumes a fresh qualified helper and repeats explicit page setup. After only newer seq4/5 capture, older's relevant uncovered interval must yield `uncovered_stream` and zero proposals globally; after older seq3/4/5 capture, both lanes form a complete cut. At asOf `2026-10-03T00:00:00.000Z`, require older's earliest proposal to contain **only seq3**, mapping payment **10000** cents; seq4 remains later/unselected. Newer's earliest proposal contains **only seq5**, payment **10000** cents; seq3 is at its baseline and cannot be proposed for it. Retain baseline applicability and memberships for every event, canonical deduplication of 4/5, exact original invoice receipt provenance and unchanged 300000-cent invoice balances. Repeated inspection must preserve all durable state and approved snapshots. These selector assertions are deferred consumer proof, not part of the standalone fixture's qualification pass.

## Variant 2: genuinely unselected bundled profile

Factory:

```ts
export async function createSyncSelectionBundledFixture(): Promise<{
  db: Pool;
  close(): Promise<void>;
  selected: { identity: CommittedAuthorityIdentityV1; stored: StoredActivation };
  unselected: CustomerProfile;
  capture(page: ChangePage): Promise<CaptureResultV1>;
}>;
```

`unselected` is the detached exact registered profile also found in `selected.stored.bundle.profiles`, not a committed-authority identity. Capture is bound internally to the sole selected committed identity. Returning that profile is safe public candidate data, not protected truth. No enroll/review callback exists. Return only after one real selected A5 receipt and one initialized lane, with no ongoing captured pages.

### Independent original agreements and inputs

| Fact | Selected | Never selected |
| --- | --- | --- |
| source account | `sync-bundle-selected` | `sync-bundle-other` |
| parent account | `company-a.seller-a.sync-bundle-selected` | `company-a.seller-a.sync-bundle-other` |
| buyer | `sync-bundle-buyer-selected` | `sync-bundle-buyer-other` |
| legal name | `Bundle Selected` | `Bundle Other` |
| contract | `sync-bundle-contract-selected` | `sync-bundle-contract-other` |
| invoice record ID | `sync-bundle-invoice-selected` | `sync-bundle-invoice-other` |
| event ID | `evt:sync-bundle-invoice-selected` | `evt:sync-bundle-invoice-other` |
| finance sequence | 1 | 2 |
| profile ID | `sync-bundle-profile-selected` | `sync-bundle-profile-other` |
| term/configuration | `sync-bundle-term-selected` / `configuration:sync-bundle-term-selected` | `sync-bundle-term-other` / `configuration:sync-bundle-term-other` |

Raw invoice JSON uses exactly the same six-field shape as Variant 1, substituting only its account/record IDs, with amount **3000.00**, effective `2026-09-01`, due `2026-09-30`, version 1. Envelopes use the table sequences, observedAt/cutover `2026-10-01T00:00:00.000Z`. Independent invoice expectations are **300000** cents each, USD, exact source event/version/effectiveAt/dueDate; each balance anchor **300000**. No baseline funds/allocations/reversals.

One authentic shared original, `contract-1.pdf`, document ID `doc-sync-bundle-agreements`, upload kind `contract_pdf`, version 1, contains exactly these eleven lines on one page:

```text
Currency USD applies to both agreements below.
Fixed monthly agreement sync-bundle-contract-selected
Seller seller-a; buyer sync-bundle-buyer-selected; account sync-bundle-selected
Legal name Bundle Selected
Monthly fee USD 3000.00 for sync-bundle-selected
Effective 2026-09-01; monthly invoice anchor day 1.
Fixed monthly agreement sync-bundle-contract-other
Seller seller-a; buyer sync-bundle-buyer-other; account sync-bundle-other
Legal name Bundle Other
Monthly fee USD 3000.00 for sync-bundle-other
Effective 2026-09-01; monthly invoice anchor day 1.
```

Use `textPdf(lines, cutover, lines[0])`, actual byte hash and `sourceFileId(metadata)`; expected text is `lines.join(' ')`. Preserve one real page-one citation covering the whole extracted page. Validate that page and literal ranges from the returned evidence, never manufacture evidence IDs. The account-specific party/title/fee lines are independently bound to each fact. Both contract facts explicitly bind their `currency` support to the common first line in this original; fixedMonthlyFeeCents binds to each own fee line; other contract/identity support fields are as in Variant 1. Both terms are USD **300000**, monthly, anchor **1**, start `2026-09-01`, terminal null. Distinct canonical identity/term fact IDs have distinct account/contract preimages. Shared citation does not merge facts, scopes, identities or customer authority.

Manifest `manifest-sync-bundled-v1`, epoch1, cutover above, six schema entries, both semantic-map entries, one PDF, finance vector2 with exactly invoices1/2, semantics0 empty. Truth fixture `truth-sync-bundled-v1`, seed `sync-bundled-v1`, producer/truth version1 and protected version2. The one visible set has one PDF, two API originals and four index/aggregate JSON files; the private author set has the two JSON inputs. Use the same API-original/index conventions and actual stream/manifest hash formulas.

### Exact multi-profile artifact and evidence binding

Do not call the single-agreement demo parser on this composite document. Author two `CustomerProfileSchema` inputs directly from the fixed literal table, each version2, source/scope/parentCustomerId/sourceAccountIds and sem-a-1 explicit; one `account-map` parent-account lookup for only its own account; one fixed term; findings `[]`; bootstrap customer displayName/evidence and configuration table explicit. Each lookup, term and bootstrap customer references the real shared page citation. Compute each profile hash independently.

Author one `ConnectorSpecSchema`, ID `sync-bundle-spec`, version1, target schema `1`, unchanged `companyA.contracts` and `companyA.streams`, runtimeModelCalls forbidden, requiredValidators `[]`, maxTransactionCents **5000000**, maxRecordsPerCycle **1000**, evidenceRefs exactly the real shared citation. Allowed kinds are all five financial kinds. Use the exact existing A mapping language, locally authored rather than copying private generator functions:

- All mappings: currency `{op:'constant',value:'USD',evidenceRef:<actual shared citation>}`; effectiveAt `{op:'date_parse',path:'/effective_date',format:'YYYY-MM-DD',timezone:'UTC'}`.
- Invoice/payment/credit/allocation: amountCents `{op:'decimal_to_minor',path:'/amount',scale:2}`. Invoice adds dueDate `{op:'field',path:'/due_date'}`.
- Allocation adds payment/credit enum lookup at `/funding_kind`, field fundingRecordId `/funding_id`, existing_invoice_lookup invoiceRecordId `/invoice_id`.
- Reversal has payment/credit enum lookup at `/reversed_kind` and field reversedRecordId `/reversed_id`, no amount.
- Exact resources are `a-invoices`, `a-payments`, `a-credits`, `a-allocations`, `a-reversals`; no semantic mapping.

Compile/register the spec with **both** profiles. Require artifact.requiredProfileHashes to equal the two hashes exactly; no per-profile artifact substitution. The shared original's currency support resolves to the same citation under each own active contract fact at cutover and every mapped event effective instant. `evidence-support.ts:currencySupported` checks this, while its strict expectedMappings requires precisely these constant-USD mappings. A field-based currency workaround or choosing one of two unrelated agreement citations would not qualify.

Run one actual financial proof for the full two-profile artifact. Report, coverage, attestation reservation and candidate must all include both required profile hashes; every mandatory check executes over the real full profile matrix. Both 300000-cent monthly invoices satisfy the existing independent case recipe. Do not accept a one-profile report then append another profile to the bundle.

Create a bootstrap sidecar under `bootstrap-bundled-selected-v1` containing **only the selected reviewed subject** and its real identity/term fact/citation associations. This is supported by `bootstrap-fixtures.ts:checkProfiles`, which validates descriptor subjects against the full capture profiles; it does not require a descriptor subject for every financial profile. The actual selected-bootstrap binding still includes both artifact requiredProfileHashes. `bootstrap-cases.ts` uses the other account's real original and producer identity for the mandatory unrelated-account hold case. The later protected result is for selected profile only, not claimed as a bootstrap pass for the other profile.

Publish only the selected scope, policy entry and review selection; local reviewer allowedAccountIds contains selected account only. Approval key is `sync-bundle-approve-selected`. Exactly one genuine prepare/activate/A5 path runs. Its bundle retains both complete profiles and full two-event capture, while its reviewed plan, import, target, receipt, financial origin and current authority select only `sync-bundle-profile-selected`. The other profile has no selecting approval anywhere in the disposable control/runtime catalog. Its participation in financial coverage or bootstrap negative cases is not enrollment.

Exact initial cardinalities: one artifact, two profiles, one financial report covering two profiles, one selected-bootstrap proof, one selected scope/policy entry, one reviewer approval/import/receipt/current authority, one target with one invoice and metadata, one initial origin, one capture lane with two checkpoints. The two original global source identities are allowed; presence of the unselected source original is not a target/import/origin.

### Qualification and later selector use

Named suite `bundled-profile fixture qualification`, four executed tests:

1. `full artifact proof with selected-only authority`: assert actual report/attestation complete two-profile coverage and all mandatory financial checks; selected bootstrap full mandatory cases/assertions with exact selected binding and full requiredProfileHashes; one real review request/intent/bundle/A5 receipt with selected expectedProfileHash. Assert the independent target literals (version1, invoice300000 USD, exact metadata, all other financial arrays empty, receipt0→300000, own invoice only, own exact initial origin). Assert the registered common page supports currency for **both different** contract fact IDs via actual pin/capture binding, not equality of USD strings alone. Helper-local private assertions may inspect its producer/pin inputs; no protected material is exposed through the factory or logs.
2. `unselected remains absent with captured input`: inspect the complete small committed import/authority catalog and selected stored bundle, not merely read the other account once. Require exactly one committed selected identity and no selecting request/intent/import/current authority/receipt/target/metadata/financial origin for the other profile/scope. Author post-baseline unallocated payments `sync-bundle-pay-selected` seq3 and `sync-bundle-pay-other` seq4, each raw **100.00** and independent **10000** cents, effective date `2026-10-01`, observedAt `2026-10-02T00:00:00.000Z`, version/schema/semantics unchanged. Capture exact finance after2→next4 page through sole selected lane; exact replay adds no rows/effects. Both raw originals are retained, but neither capture nor bundle membership creates other-account enrollment or parent state. Prove absent other state again, unchanged selected import/target/origin and unchanged approved snapshot. This is a capture/authority fixture check, not a routing pass.
3. `fresh construction and immutable inputs`: one fresh independent successful instance proves the same exact profile cardinality and full proof/one-approval boundary, unchanged authored inputs and pre-existing inventory.
4. `partial construction cleanup`: same real-work call-through failure point and awaited complete cleanup as Variant 1. Normal close is idempotent. No skipped mandatory prerequisite.

Task 9 later consumes a fresh helper for the unselected subscenario of `genuine_inactive_and_unselected`: inspect after seq3/4 capture, require only selected known route/proposal for seq3, no invented scope/subject/proposal for seq4, and exact raw unknown/unresolved evidence for the never-selected account despite its profile being present in the full committed bundle. Repeat full durable-row zero-write checks. The inactive-authority subscenario still uses the independently qualified fixed same-feed fixture and accepted pause/revoke service; running both subscenarios is necessary before crediting the combined named case. No third enrollment or activation of the bundled other profile is needed or permitted to make this variant convenient.

## Cleanup, qualification scheduling and unresolved gates

Each public fixture owns one enrollment context with one temporary root and one namespace; the extracted lifecycle registers reverse-order cleanup immediately as each resource is created. Close construction listeners before returning; on partial failure close them, await both application pools, drop only its generated namespace, and remove only its own root. Await cleanup operations; preserve the original failure if cleanup also fails and attach/report cleanup failure safely. Repeated close must share the same completion promise. Test spies are call-through observation/lifecycle fault injection only and restored in finally. Retain test-level fallback cleanup for failed assertions. No shared cluster shutdown or demo DB operation.

Each suite uses one primary successful construction, one fresh successful construction and one deliberate partial-failure construction; keep tests sequential under the exclusive SQL lease. Reuse the root-provided `EAPR_PG_PORT`, `EAPR_TEST_PREFIX` and existing cluster. Select no alternate lease or concurrent migration. Root supplies source/SQL release separately. Proposed focused qualification commands, after Node24/PostgreSQL18 are on PATH:

```sh
npm run typecheck
npm run test:integration -- tests/integration/sync-selection-baselines-fixture.test.ts --testTimeout=180000 --hookTimeout=180000
npm run test:integration -- tests/integration/sync-selection-bundled-fixture.test.ts --testTimeout=180000 --hookTimeout=180000
```

First qualify/review the separately released extraction with typecheck and all four existing `same-feed fixture qualification` tests unchanged. Then only run the suite for the currently released variant until the other source task exists. Verify all four named tests execute and no prerequisite is skipped. Report actual command output and safe proof/result/hash inventories; never log protected truth, secret tokens or private subprocess configuration. These are focused partial machine checks. Exact-candidate independent review, later selector genuine cases, joint user acceptance, full V5/V6, live/AI-off transport and cross-stream/unaffected-mapping gates remain separate.

No materially unspecified product/financial policy was found. Both designs are feasible by inspected existing interfaces, not empirically qualified. Exact remaining gates are: completion of the current fixed-fixture review unchanged; separate root release, qualification and review of the bounded lifecycle extraction; variant root release/reservation and exclusive SQL lease; real execution of both immutable prefix captures and both genuine approvals in Variant1; real shared-page full two-profile evidence/financial pass and selected-only bootstrap/A5 in Variant2; all named qualification/cleanup/immutability assertions; fresh exact-candidate reviews; and later actual selector consumer assertions. If an unchanged producer rejects a specified input, retain the original error and ask its owner to locate the violated existing contract. Do not treat the rejection as authorization to weaken evidence, broaden producers or invent new policy. Cross-stream and unaffected-mapping producer dependencies remain external and unchanged.
