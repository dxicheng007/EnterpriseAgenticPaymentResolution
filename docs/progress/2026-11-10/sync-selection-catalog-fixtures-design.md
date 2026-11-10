# Bounded catalog admission fixtures — proposed design

Read-only architecture inspection, 2026-11-10, of `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`. This document is the only written artifact. No source, Git, database, test, service or saved-pin operation was performed, and no subagent was spawned. The fixed peer fixture source is the supplied `cc78b73` reference; the current source was read without asserting an independently verified Git HEAD. Root remains the sole Task 4 selector writer. Names below are proposed reservations, not implementation releases.

## Decision

Use two separately qualified, zero-argument factories: one with exactly nine genuine Company A selecting imports sharing one source/manifest; one with exactly one genuine Company B selecting import carrying the unchanged CSV transport. No capture lanes or ongoing pages are required for either catalog admission case. Neither fixture manufactures an import by SQL, clones a committed bundle, changes source transport on an A artifact, or presents an unselected bundled profile as an enrollment.

The nine-A factory can consume the accepted, not-yet-executed `createSelectionEnrollment()` extraction unchanged. B already has an exported genuine proof author (`issueActivationProofs`) and all required public composition exports, but no exported completed-B factory. It is not a drop-in consumer of the accepted enrollment `openReviewer`: that operation publishes its own policy and writes `selection.json` with `wx`, whereas `issueActivationProofs` has already created those files. The accepted extraction also retains fixed A source/reviewer constants. Do not paper over these conflicts with a mode, overwrite, new root indirection, a second proof run, or a copied approval chain.

Recommend a **separate catalog-fixture plan**, dependent on acceptance of the original variants-plan Task 1. Within the new plan, make a narrow, separately reviewed extraction of the concrete installed-policy reviewer executor before B. This moves the existing authenticated prepare/activate/A5 orchestration; it does not add a second implementation. The nine-A task does not require that additional extraction and can be released independently after the original Task 1. Preserve the accepted variants plan's three tasks and its two literal scenarios verbatim. If root chooses to incorporate the executor extraction before original Task 1 is implemented, that requires an explicit reviewed supplement changing Task 1's reserved files and dependency inventory; it is not already authorized by the variants design.

## Evidence and exact seams

All paths in this document are relative to the inspected worktree unless absolute.

| Inspected source | Consequence |
| --- | --- |
| `.superpowers/sdd/2026-11-10-sync-selection/task-5-preflight.md`, query admission and fixture gaps | Task 5 observes the source-rooted `LIMIT 9` before blob admission. B's CSV artifact or `event_csv` manifest invalidates the entire source cut. Neither case needs a capture lane. |
| `tests/fixtures/sync-selection.ts:87–217` | A scenario-specific author can write independent raw originals, truth and producer facts once, before `captureEvidenceFixture`. No private generator export is needed. |
| `tests/fixtures/sync-selection.ts:274–361` | Each captured page-one agreement can be compiled/registered independently and obtain its own real full financial proof and selected bootstrap descriptor against a shared manifest. |
| `scripts/prepare-activation-policy.ts:24–34`, `packages/contracts/src/activation-authority.ts`, `apps/control/src/local-session.ts` | Inspected policy-selection arrays are minimum-one with no nine-entry maximum; registered scopes and local reviewer arrays do not impose a two-account cap. Nine is feasible by shape, not empirically qualified. |
| `packages/evaluator/src/case-recipes.ts:101–137` | Every selected A profile needs a supported USD 300000 monthly invoice on anchor day 1 and the fixed source contracts. Nine literal invoices satisfy the recipe's source shape; real mandatory coverage still must execute. |
| `tests/fixtures/activation-proof.ts:46–164` | `issueActivationProofs(root, controlPool)` generates A/B originals, captures/registers/pins both, issues both financial proofs, prepares both bootstrap sidecars, publishes scopes, installs an A/B policy and writes the selection file. It returns B's selection/account/source plus candidates, dependencies, registryRoot, scopeReader, bootstrapRoots, policyPath/bytes and selectionPath. It does **not** approve either customer or return a B stored import. |
| `tests/integration/current-authority.test.ts:62` and `tests/fixtures/sync-apply.ts:45–136` | Genuine reviewer-to-worker composition exists, but both `activateBoth` and `activate` are private. `createSyncApplyFixture` commits only A. Import neither private function, and do not extend the accepted A helper with a company flag. |
| `packages/evaluator/src/financial-attestation-registry.ts:299–320` | The existing public `readRegisteredFinancialAttestation(reportId, {artifactHash,requiredProfileHashes,capture,policy})` returns the validated real report and attestation. B does not need a new proof-return export or direct SQL decoding. |
| `packages/sources/src/company-b.ts:27–34`, `scripts/generate-fixtures.ts:279–365` | B has genuine `b-files` CSV plus `b-receipts` API and `b-semantics`; the fixed generator emits three actual `event_csv` files and complete manifest membership. A standalone B subject establishes whole-cut unsupported transport. |

Read repository/tests guides and F5/F6 proof rules. In particular, F6 requires each mandatory financial check exactly once, passed with positive cases, complete requested profile/source/kind coverage, zero unexplained difference and exact immutable provenance. Schema acceptance or `eligible:true` alone is insufficient. Bootstrap mandatory cases/assertions and their exact selected binding must pass independently. Reviewer approval is a separate action; report coverage cannot confer authority.

## Public factories and reservations

Use the existing test-only `SelectionSubject = {identity: CommittedAuthorityIdentityV1; stored: StoredActivation}` type, not the selector's richer detached subject type. The name collision must be handled with an import alias in consumers.

```ts
// tests/fixtures/sync-selection-catalog-nine.ts
export async function createSyncSelectionCatalogNineFixture(): Promise<{
  db: Pool;
  subjects: [SelectionSubject, SelectionSubject, SelectionSubject,
             SelectionSubject, SelectionSubject, SelectionSubject,
             SelectionSubject, SelectionSubject, SelectionSubject];
  close(): Promise<void>;
}>;

// tests/fixtures/sync-selection-catalog-csv.ts
export async function createSyncSelectionCatalogCsvFixture(): Promise<{
  db: Pool;
  subject: SelectionSubject;
  close(): Promise<void>;
}>;
```

No public root, owner pool, control pool, arbitrary SQL callback, author/proof inputs, injected launcher, transport option, source-count option, capture operation or reviewer handle. Subjects are returned only after genuine complete qualification inside the factory. The nine tuple is source-account order 01 through 09. Detached outputs are actual validated stored results; all economic expected values remain independently authored literals.

Proposed source reservations:

| New-plan task | Files |
| --- | --- |
| C1 nine-A author/fixture | new `tests/fixtures/sync-selection-catalog-nine.ts`; new `tests/integration/sync-selection-catalog-nine-fixture.test.ts` |
| C0 installed-review extraction | new `tests/fixtures/sync-selection-reviewer.ts`; modify only the then-accepted `tests/fixtures/sync-selection-enrollment.ts` and generator dependency inventories of its already accepted callers if required to remain truthful |
| C2 CSV-B fixture | new `tests/fixtures/sync-selection-catalog-csv.ts`; new `tests/integration/sync-selection-catalog-csv-fixture.test.ts` |

C0 should precede C1 if root wants to avoid changing C1's dependency inventory immediately after qualification. C1 itself depends only on original variants Task 1; C2 depends on C0. The unavoidable inventory edit list must be explicitly enumerated by root from which callers actually exist at C0 release. If only the original fixed fixture exists, this is `tests/fixtures/sync-selection.ts`; if C1 or either variant already exists, its author inventory must also include the moved dependency. This is a reason to schedule C0 immediately after original Task 1, before the other fixtures, not a blanket reservation to edit arbitrary future files. Existing originals/pins are never rewritten.

The new plan owns no barrel export, production API, compiler, protected producer, DDL, saved demo pin, existing integration assertion, Task 4 source or Task 5 test. Task 5 later imports the released factories and appends its own `catalog_` cases under its existing reservation. Migration 007's source-leading index is a separately owned prerequisite and is not part of these fixtures.

## C0: one shared installed-policy reviewer executor

This is a concrete test-only dependency boundary, not a new configurable fixture framework. Its parameters are existing application dependencies and already installed exact proofs. Infer types from existing exports; do not copy product schemas into test types.

```ts
// Internal; no public fixture returns this object.
export async function openInstalledSelectionReviewer(input: {
  db: Pool;                       // runtime application pool
  dependencies: UploadDependencies; // contains control application pool
  candidates: ReturnType<typeof createCandidateRegistry>;
  service: ReturnType<typeof createSourceService>;
  registryRoot: string;
  bootstrapRoots: BootstrapRoots;
  policyPath: string;
  selectionPath: string;
  proofs: readonly SelectionProof[];
}): Promise<{
  approve(proof: SelectionProof, idempotencyKey: Id): Promise<SelectionSubject>;
  stop(): Promise<void>;
}>;
```

`SelectionProof` remains exactly `{report,attestation,entry}` from the accepted design. Shared type-only definitions may live in this reviewer module and be re-exported by enrollment to avoid a runtime import cycle. Preserve the accepted enrollment interface unchanged.

Move the current concrete listener/session/control/repository/worker-activation and approve/readback blocks to this module. Use fixed existing clock `2026-11-09T08:00:00.000Z`, loopback web origin, reviewer identity and random service credential. Derive allowed account IDs and source refs only from the exact request-selected registered profiles of `proofs`, checking each proof entry is present in the installed selection and its exact policy/candidate/proof binding is valid. No caller-supplied grant array. Approval checks exact installed canonical entry membership; proof object similarity must not enlarge scope. The existing real registered policy and worker checks remain authoritative.

The function does not publish scopes/policies or write a selection file. It loads the installed policy through `loadActivationPolicy` and the exact selection through exported `loadReviewSelection` in `apps/control/src/review-proof-selection.ts`; no private parser export or duplicate schema is needed. It creates `launchWorker` with `composeWorkerParentReads`, `createLocalSessionService`, `composeActivationReview`, `buildControl`, `createReviewRepository` and `createWorkerActivation`, and obtains the real local cookie/CSRF. `approve` performs authenticated prepare and activate with exact returned hashes/version; reads the committed intent; invokes worker first import with its exact key/bundle hash; then uses `readStoredActivation`/`readStoredTarget` to check receipt, approved target, report/attestation equality and all existing mandatory bootstrap cases/assertions/pin/plan bindings. Literal money/metadata/origin checks stay in scenario callers.

This extraction changes fixed-A hardcoding only to derive source and selected account from actual proven registered selections, so it is an explicit new-use-case supplement. It adds neither source dispatch nor transport interpretation. The executor has no hook, alternate launcher, SQL insertion, arbitrary operation callback, clock option, auto-approve-all-artifact mode or policy-write mode.

Own each listener immediately on creation. If initialization fails after worker startup, stop every created listener before rejecting, preserving the original error. `stop` is awaited and idempotent. The caller owns pools, namespace and temporary root, and registers `stop` in its cleanup immediately after successful return. The accepted enrollment `openReviewer` still performs exact publication/policy install/no-replace selection write, then delegates to this executor and registers its `stop`; its external behavior and call-through export observation points stay intact.

Qualification for C0: typecheck plus the four unchanged `same-feed fixture qualification` cases. Run additional previously qualified caller suites only if C0 changes a dependency they use (which it does if they already exist). No new mirror tests or manufactured financial red. Inspect the diff for a moved single approval implementation, original literal assertions untouched, truthful inventories and unchanged fixed public API. Fresh exact-candidate review is required before C2 uses the executor. If C0 cannot preserve those boundaries, report the specific mismatch; do not fall back to copying the full approval chain.

## C1: nine genuine A selections

### Fixed authored facts

Use unchanged Company A: company `company-a`, source `legacy-a`, seller `seller-a`, six contracts, `schema-a-1`, per-account `sem-a-1`, exact API `a-finance` and semantic `a-semantics` streams. Cutover and event observedAt: `2026-10-01T00:00:00.000Z`. Service/reviewer clock remains November 9 above. One manifest, epoch 1, vector `{a-finance:"9",a-semantics:"0"}`. Every source document and record version is 1.

Fixed identifiers: manifest `manifest-sync-catalog-nine-v1`, fixture `truth-sync-catalog-nine-v1`, generator seed `sync-catalog-nine-v1`, policy `sync-catalog-nine-policy-v1`. Use the following fixed tuple; no function parameter selects a subset or changes its cardinality.

| Seq | Source account | Buyer | Legal name | Contract | Document | Upload |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | sync-catalog-01 | sync-catalog-buyer-01 | Catalog One | sync-catalog-contract-01 | doc-sync-catalog-01 | contract-1.pdf |
| 2 | sync-catalog-02 | sync-catalog-buyer-02 | Catalog Two | sync-catalog-contract-02 | doc-sync-catalog-02 | contract-2.pdf |
| 3 | sync-catalog-03 | sync-catalog-buyer-03 | Catalog Three | sync-catalog-contract-03 | doc-sync-catalog-03 | contract-3.pdf |
| 4 | sync-catalog-04 | sync-catalog-buyer-04 | Catalog Four | sync-catalog-contract-04 | doc-sync-catalog-04 | contract-4.pdf |
| 5 | sync-catalog-05 | sync-catalog-buyer-05 | Catalog Five | sync-catalog-contract-05 | doc-sync-catalog-05 | contract-5.pdf |
| 6 | sync-catalog-06 | sync-catalog-buyer-06 | Catalog Six | sync-catalog-contract-06 | doc-sync-catalog-06 | contract-6.pdf |
| 7 | sync-catalog-07 | sync-catalog-buyer-07 | Catalog Seven | sync-catalog-contract-07 | doc-sync-catalog-07 | contract-7.pdf |
| 8 | sync-catalog-08 | sync-catalog-buyer-08 | Catalog Eight | sync-catalog-contract-08 | doc-sync-catalog-08 | contract-8.pdf |
| 9 | sync-catalog-09 | sync-catalog-buyer-09 | Catalog Nine | sync-catalog-contract-09 | doc-sync-catalog-09 | contract-9.pdf |

For each literal suffix NN, parent account is `company-a.seller-a.sync-catalog-NN`; invoice ID `sync-catalog-invoice-NN`; event ID `evt:sync-catalog-invoice-NN`; spec `sync-catalog-spec-NN`; profile `sync-catalog-profile-NN`; approval key `sync-catalog-approve-NN`; financial job `sync-catalog-financial:NN`; bootstrap version `bootstrap-catalog-NN-v1`. These are fixed identity formulas, not financial inference.

Each PDF has the same five supported lines with only its tuple identity substituted:

```
Fixed monthly agreement <Contract>
Seller seller-a; buyer <Buyer>; account <Source account>
Legal name <Legal name>
Monthly fee USD 3000.00
Effective 2026-09-01; monthly invoice anchor day 1.
```

Generate each PDF once with unchanged `textPdf`, cutover and its exact title. Independently author raw invoice `{account:<source account>,amount:"3000.00",due_date:"2026-09-30",effective_date:"2026-09-01",id:<invoice id>,version:1}`. Use unchanged `eventA` at its literal sequence and observedAt. Expected truth is independently authored as one invoice per account, `amountCents:300000`, `balanceAnchorCents:300000`, USD, sourceEventId from the fixed identity, version 1, effectiveAt `2026-09-01T00:00:00.000Z`, dueDate `2026-09-30`. Do not parse the raw decimal or inspect the compiled plan to create those monetary expectations.

Each account has its own independently supported identity and contract fact. Follow the fixed peer author support fields exactly: party line supports source account/seller/buyer, legal-name line supports legal name; title supports contract ID; fee line supports the literal 300000 fee and USD; effective line supports validFrom/monthly/anchorDay. `validToExclusive:null`. Fact IDs use the existing canonical identity/term formulas. Nine actual agreements, not nine references to one customer's facts. The nine invoices also supply genuine foreign-account input for each selected bootstrap suite.

One complete truth v1 file and one complete producer v1 file contain all nine independently authored records/identities/terms, sorted by the existing decoder keys, with all manifest event membership. Validate via `decodeTruth` and `decodeEvidenceProducer` before publication. Author all PDFs, raw API files, event array, originals index, uploads index, manifest, truth and producer inputs first using `wx`, private directory/file modes and disjoint roots. The required `contract-1.pdf` exists for the unchanged capture helper; registration chooses every actual matching document/citation rather than reusing the returned first-contract ID.

The generator build inventory includes actual bytes of the new author, accepted enrollment module, reviewer module if extracted, canonical-fixtures, company-a and package lock, plus any actual additional author dependency. It may hash IDs/provenance using existing canonical formulas, but never derive expected financial answers from outputs. Hashes and byte lengths are measured, never invented.

### Concrete construction

1. Create one accepted enrollment context and register its owned cleanup immediately. Author the complete fixed dataset and retain its input inventory before the first publication.
2. Call `captureEvidenceFixture(context.dependencies, context.roots, 'a')` once. Pin its actual input once with unchanged `pinProtectedEvidenceFixture`. Resolve nine real captured page-one agreement citations and validate actual file/snapshot/hash bindings.
3. Build nine one-profile candidates with unchanged `buildDemoCandidate`; substitute only fixed distinct spec/profile IDs then rehash/compile/register. Require nine exact scopes and one required profile hash per artifact. Each immutable bundle will legitimately contain the shared nine-event baseline, but each selected plan imports only its own invoice.
4. Call the unchanged `context.prove` nine times sequentially with exact registered selections, distinct job IDs and separately authored selected bootstrap descriptors. Use that account's own identity/term/citation; no result-derived monetary expectations. All nine real financial reports/attestations must pass the full mandatory matrix before reviewer installation.
5. Call `context.openReviewer` once with exactly the nine proof entries and fixed policy ID. Approve 01 through 09 with distinct literal keys using the real authenticated route and worker. Before each next approval, assert that next account has no runtime first import/target/origin. A common authenticated reviewer session is fine; require nine distinct request keys/packages/artifact/profile/bundle/activation/receipt bindings, not nine invented reviewer identities.
6. Immediately after each import, compare the entire target and receipt to the literal facts below and verify exact initial origins. After all nine, stop construction listeners. Do **not** initialize a lane or publish an ongoing page. Assert exactly nine source-rooted first imports and zero capture lanes/ongoing records, then compare all authored input bytes to the original inventory.
7. Return the fixed tuple/runtime application pool/owned close. On failure, await context cleanup while preserving the genuine original error; no proof fallback or row surgery.

Each expected target is version 1/asOf cutover, one own USD300000 invoice with exact source/event/version/effective/due fields, zero payment/credit/allocation/reversal records, one own customer, one scoped source-account association and one `configuration:demo-term-a` billing configuration. Its term is `demo-term-a`, its own literal contract, validFrom September 1, no end, USD300000/monthly/day1 with own captured evidence. Scoped metadata IDs may repeat across accounts exactly as in the fixed peer fixture. Receipt balance is `0 → 300000`, exact own event and financial record ID only. Target record IDs may use the documented `targetRecordId` identity formula. `readFinancialOrigins` equals a single initial origin with own approval key and actual own authoritative receipt. No other account's invoice or metadata enters that target. Full immutable approved/recorded/planner/request/proof and receipt bindings must be validated, not merely counted.

### Independent C1 qualification

Suite `nine-subject catalog fixture qualification`, exactly four named cases, sequential with one primary construction, one fresh success and one deliberate failure attempt:

1. `nine real proofs and selecting first imports`: independent literal target/receipt/origin assertions for all nine; full exact financial mandatory checks/cases/source/kinds/profile/capture/build/pin/report/attestation matrix per subject; all mandatory selected bootstrap cases/assertions and plan bindings; nine distinct reviewer requests and A5 identities; one identical captured manifest/vector across all nine bundles; full nine bootstrap event membership and only own selected plan event. Verify actual producer/runner message sizes and preserve elapsed setup measurements.
2. `complete source inventory without capture enrollment`: use the runtime application pool to query the actual source-rooted scalar imports ordered by account with `LIMIT 9`; assert exactly the literal nine accounts and exact returned identities. Also independently count the tiny owned namespace to establish exactly nine and no fabricated tenth subject. Require no capture lanes/positions/ongoing pages and no authority commands/explicit heads. Implicit initial authority is still valid. Read all targets/receipts/origins again and compare a stable durable-state snapshot before/after these reads. This is fixture readiness, **not** Task 5's selector sentinel proof or indexed-query qualification.
3. `fresh construction preserves original inputs`: one new namespace/root, repeat full genuine nine qualification, compare each run's before/after input inventories and deterministic authored bytes across roots, excluding generated job/review/receipt identities from cross-run equality. Persist proof/input inventories before close, close in finally, and record root absence.
4. `partial construction releases owned resources`: call through real `composeActivationReview`, then inject a sentinel after it returns, so nine financial proofs and live parent-read worker exist. Require exact error identity and awaited worker close, both application-pool ends, only own namespace drop/root removal. Persist pre-publication inventories and safe cleanup records. Restore observers and fallback cleanup in finally. Close primary twice and require idempotent success.

Use a 300000 ms suite hook/test ceiling initially because nine serial real proofs can exceed the fixed two-peer suite's 180000 ms construction allowance; this does not change any protected subprocess deadline. Record real elapsed times and actual existing message bounds. Nine entries are structurally supported, but timing/size/coverage feasibility remains an execution gate. If any producer rejects, preserve that rejection and return it to its owner; do not reduce mandatory coverage or change truth to match output.

## C2: one real CSV-bearing B selection

### Construction through existing proof export

Own a fresh temporary root and one generated disposable control/runtime namespace, separate application pools and migrations with the same immediate-registration/reverse-cleanup behavior as enrollment. No owner pool is needed. Run unchanged `issueActivationProofs(root, controlPool)` once; do not call its private issue closure, change its fixed seed/cutover, omit A by monkeypatching, or rewrite its returned files. Its incidental A construction/proof/policy entry is permitted existing setup; **A must remain unapproved and unimported**. The B session grants only returned B account/source.

The existing proof export is sufficient for proof inputs without any new proof helper. Obtain B's full registered candidate from `proofs.candidates.getCandidate(b.selection.artifactHash,b.selection.manifestId)`. Load the already installed policy with `loadActivationPolicy`. Resolve the unique exact B policy entry matching its account/artifact/selected profile/manifest; validate it against that candidate. Call `createFinancialAttestationRegistry(controlPool,proofs.candidates).readRegisteredFinancialAttestation(b.selection.financialReportId,{artifactHash,requiredProfileHashes: candidate.artifact.requiredProfileHashes,capture: matchingPolicyEntry.capture,policy})`. That method validates the stored request/completion/candidate/policy; no SQL decoding or invented report is needed. Form `SelectionProof` only from these actual `{report,attestation}` and `entry:proofs.b.selection`.

Create source service from `proofs.dependencies` and the unchanged local catalog. Open C0's executor with the returned registry/bootstrap/policy/selection/dependencies/candidates and **only B's validated proof**. Its reviewer grants resolve only to B even though the installed file/policy includes A. Approve B with literal key `sync-catalog-csv-approve-b`, using exact prepare/activate hashes and the real committed intent/A5 path. Stop listeners before return. Run unchanged `verifyOriginals(stored.approvedTarget.records,'b')` as a compatibility assertion, plus the independent literal assertions below; `verifyOriginals` alone is not independent of the generator and is insufficient qualification. No B capture lane or ongoing CSV page is opened.

### Literal B qualification facts

The unchanged generator uses seed `activation-policy`, cutover `2026-10-01T00:00:00.000Z`, and tag `hashCanonical('activation-policy').slice(0,12)`. That documented pure identity formula is allowed; amounts and dates below are independent literals. Selected source account `cust-b-<tag>-1`, parent account `company-b.seller-b.cust-b-<tag>-1`, buyer `buyer-shared-<tag>`, legal name `Shared Buyer <tag>`, contract `contract-b-<tag>-1`, source `legacy-b`, seller `seller-b`, schema `schema-b-1`, semantic `sem-b-1`.

The selected target has exactly three invoices, three payments and three allocations; no credit or reversal. For dates `2026-07-01`, `2026-08-01`, `2026-09-01`, independently expect invoice ID `inv-b:<source-account>-<date>`, payment `pay-b:<source-account>-<date>`, allocation `alloc-b:<source-account>-<date>`. Each amount is literal `300000` USD, record version 1, event `evt:<record-id>`, effectiveAt date plus midnight UTC. Invoice due dates are respectively July 31, August 31, September 30. Each allocation is fundingKind payment, same-month payment and invoice identities. Source identity and target ID formulas are checked for all nine financial records. Target version 1/asOf cutover; receipt balance `0 → 0`, exact nine source event IDs and financial target IDs. This zero balance is supported by three explicit full allocations, not by subtracting unattached receipts.

One selected customer/account/configuration; term/configuration IDs `demo-term-b`/`configuration:demo-term-b`, contract above, validFrom `2026-07-01`, validToExclusive null, literal fee `300000`, USD/monthly/day1, own actual first-contract citation. Verify full records, relationships, scope, evidence references and initial origin per financial record with the own approval key/receipt. No unresolved `pay-b:unresolved-<tag>` or another account's records enter the target/receipt/origins. The source's unknown-account USD30000 receipt remains only captured source evidence; do not assert a null account was enrolled.

The committed manifest's full baseline is `b-files:18`, `b-receipts:10`, `b-semantics:0`: three months × three known accounts × invoice+allocation = 18 CSV events; nine known payments plus one unknown payment = 10 API events. It contains three `event_csv` members, batches 1/2/3, each six rows, plus three contracts and one remittance document. Verify actual original CSV hashes/lengths, batch metadata, exact header and actual decoded captured membership with the unchanged source parser. All three batch memberships are complete, and each selected invoice/allocation comes from an actual CSV member. Do not substitute the older minimal F8 illustrative 4/1 baseline for this existing generator's 18/10 baseline.

Artifact `normalizedPlan.capture` contains literal `b-files` with `transport:'csv'`, plus `b-receipts:'api'` and `b-semantics:'semantic'`; genuine committed manifest files retain `kind:'event_csv'`. B's artifact covers all five financial mapping kinds even though the selected baseline has only three kinds. Financial coverage must still include all five kinds and every mandatory check with positive case count. Full proof/capture/build and all selected bootstrap bindings are checked exactly as for A.

### Independent C2 qualification

Suite `csv catalog fixture qualification`, four named cases, one primary/fresh/failure construction, sequential:

1. `real B proof review and CSV-bearing first import`: genuine financial matrix and all bootstrap cases/assertions; literal full B target/receipt/origins above; real selected package/request/intent/A5 identity; exact actual artifact CSV and manifest member binding; compatibility `verifyOriginals`. Independently validate the A financial report that the unchanged author necessarily issued as well, so its hidden mandatory failures cannot be ignored merely because B is selected. No A bootstrap result/approval is required or fabricated.
2. `only B is enrolled and original CSV remains immutable`: exact scalar runtime selecting inventory contains one B import and no A; no A target/receipt/origin/explicit head/command and no A control selecting request/intent; distinguish the legitimate published A scope/policy/report from authority. Verify B's complete 18/10/0 baseline/file membership, all original input hashes unchanged after proof/import, no capture lanes or ongoing pages, and durable state unchanged by readback. The factory does not itself assert selector `unsupported_transport`.
3. `fresh B construction preserves all inputs`: one independent fresh namespace/root with the same unchanged generator; repeat full B proof/literals/CSV/enrollment-absence checks and compare deterministic original bytes from each before-publication inventory. Persist safe records before cleanup; close fresh fixture in finally and observe root absence.
4. `partial B construction releases owned resources`: same call-through post-real-`composeActivationReview` fault as C1, after A/B financial work and worker startup. Exact sentinel, awaited stop/pool cleanup, only owned namespace/root removal, observer restoration and idempotent primary close twice. No fabricated proof success.

The unchanged helper does not persist safe input inventories itself. The new suite observes real `generateFixtures` completion or the first real `captureEvidenceFixture` entry: by then both A and B originals/truth exist, and publication has not begun. Persist **both** original-root inventories there. Observe the actual exports without replacing their results; do not add new callbacks to the proof producer. Use control dependencies observed from these same real calls for the A selecting-request absence check; the public B fixture need not expose control access.

## Persisted evidence, cleanup and proof coverage

Create a new ignored SDD workspace using the installed workspace tool only after root accepts the separate plan. Suggested plan filename `docs/superpowers/plans/2026-11-10-sync-selection-catalog-fixtures.md`; suggested resolved workspace `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures`. Confirm the actual workspace rather than reusing the variants or selector workspace silently. Safe evidence remains there after fixture roots are removed.

Use per-task `evidence/task-C0|C1|C2/run-<unique>/` directories. `EAPR_SELECTION_FIXTURE_EVIDENCE_DIR`, when set by root, must resolve to the designated run child; otherwise each new qualification suite creates its own unique child under that plan's repository-relative workspace for ordinary integration/CI. This is only an observer destination, not a fixture option or product setting. Private no-replace output writes; safe root labels/relative paths; reject symlink/path escapes. Inventory entries are sorted `{path,sha256,bytes}` or explicit `{path,absent:true}`. Safe generated resource IDs may be recorded, but never connection URLs/passwords, tokens/cookies, private JSON contents, expected records, producer/runner payloads or bootstrap sidecar bytes.

For every released source task preserve `source-before`, stable `source-pre-run`, `source-after`, comparison, candidate/reference IDs, exact commands/statuses, executed-case names and measured line/diff counts. Inventory the existing variants-plan roots (all fixtures, relevant integration suites, canonical source/generator/evaluator trees, both migration trees, package lock and saved demo evaluator/bootstrap/policy/artifact roots) plus all new reserved files. No unexplained source change may be silently allowlisted; reconcile concurrent authorized changes and establish a new stable pre-run candidate. State explicitly that a root was absent if so. Record each persisted inventory file's own path/SHA-256/byte length in the handoff.

Persist primary/fresh/failure input inventories before first publication, after successful proof/import, and before cleanup. These catalog fixtures have no capture phase; do not mislabel readback as ongoing capture verification. The original-input inventories include every generated visible/truth file and per-file lengths/hashes, not only aggregate hashes. B inventories cover incidental generated A inputs too. Save safe actual source/capture/artifact/profile/report/attestation/bootstrap/request/receipt identities and binding hashes; assertions may inspect protected input in trusted test code but reports retain only allowlisted pass/status/ID/hash/length data. Suppress unredacted Vitest object dumps or HTTP body dumps on private-input/proof failures.

Observe actual existing financial/runner/evidence message lengths through call-through boundaries. Honor each producer's real comparison: for example financial registry rejects `bytes >= financialMessageLimit`; do not claim a generic inclusive 10MiB rule from estimated PDF totals. Keep existing per-process timeouts and report each actual successful invocation. Record elapsed total construction separately from process limits. Missing/skipped/unavailable mandatory coverage, incomplete fixture inventories or failed cleanup means the prerequisite is not qualified.

Normal close is idempotent and attempts every cleanup action even if one fails, reporting cleanup failure without masking the original construction error. Register roots, namespace, pools and listeners immediately when created. Do not drop another fixture's namespace, stop the shared native cluster, or rely on local owner credentials in a returned object. Suites restore all observers and run fallback cleanup in finally. A real post-composition injected failure is lifecycle verification only, never evidence of a financial pass.

## Verification and Task 5 handoff

After root's source reservation/exclusive SQL release, record Node 24/PostgreSQL 18 versions, then run typecheck and the exact appropriate group. Proposed commands, not executed here:

```sh
npm run typecheck
npm run test:integration -- tests/integration/sync-selection.test.ts -t 'same-feed fixture qualification' --testTimeout=180000 --hookTimeout=180000
npm run test:integration -- tests/integration/sync-selection-catalog-nine-fixture.test.ts -t 'nine-subject catalog fixture qualification' --testTimeout=300000 --hookTimeout=300000
npm run test:integration -- tests/integration/sync-selection-catalog-csv-fixture.test.ts -t 'csv catalog fixture qualification' --testTimeout=180000 --hookTimeout=180000
```

Run only the groups relevant to the current task/change; C0 requalifies all existing affected callers, C1 and C2 each require their own four cases. Record filtered-out cases as outside this partial fixture run, never as a full selector/slice pass. No intentionally broken production implementation is required for fixture construction or extraction. The selector owner separately follows its behavioral RED/GREEN obligations.

After exact-candidate review accepts each fixture, Task 5 can consume it without additional setup capability:

- Nine: take its runtime app pool, open the owned read-only snapshot through the consumer's transaction boundary, call catalog selection for `legacy-a`, require whole-source `limit` with observed count 9 and no accepted subjects. Trace the actual ordered source query with `LIMIT 9`. Assert zero canonical retrieval/authority-target helper calls after the sentinel, no locks/writes/pool acquisition/release and unchanged durable state. Observe helper use in a successful lower-cardinality control so zero calls cannot pass because a spy is broken. These are Task 5 assertions, not fixture-qualified facts.
- B: call the catalog for `legacy-b` after its genuine import and require whole-source `unsupported_transport`, with no partial successful subjects. Assert the error is reached from valid persisted B artifact/manifest admission, not corrupted data or uninitialized lanes. Prove no writes and no downstream ready result. One real B subject is sufficient; mixing an A subject under B's source is neither necessary nor legitimate.
- Index: root must separately release and qualify runtime007's source-leading `(capture_source_ref, account_id)` index and app-role ordered read before claiming indexed catalog admission. Fixtures neither modify the migration nor substitute a capture-table join. The two original variants remain separate Task 5 inputs for baseline/profile cases and are not superseded.

## Feasibility, size and open gates

No new financial rule or reviewer-grant decision is proposed. All nine A scopes are separately explicitly approved; B alone is granted reviewer access in its fixture. The inspected APIs support the construction shapes. Actual nine-profile producer size/runtime/coverage and B executor adaptation remain unexecuted gates. There is no presently released nine or B fixture to cite as passed.

Rough source-size estimates, to be measured at review: nine author/factory 300–380 lines (roughly 130–170 lines scenario authoring plus registration/prove/literal checks), independent qualification 230–320; moved reviewer executor 160–210 lines with most existing enrollment lines removed, net shared growth roughly 30–70; B factory 100–150 lines (ownership plus proof adaptation/delegation/literal assertions), independent B qualification 200–280. These are not quotas. The resulting single reviewer/A5 implementation is the primary size constraint: reject a second 90–150-line prepare/activate chain, a fixture mode switch, or a shared expectation generator that hides literal assertions. Keep nine-input authoring local rather than generalizing the peer author into a count-driven framework.

Required releases/reviews are: original variants Task 1 exact candidate; explicit C0 supplemental source reservations and unchanged-caller requalification if reuse is chosen; C1/C2 original authoring and independent full coverage/cleanup/inventory runs; fresh exact-candidate review of each; separately accepted runtime007; then actual Task 5 consumer checks. Whole fixture qualification, selector acceptance, live operation, V5/V6, financial acceptance and joint user acceptance remain distinct. Preserve the current peer, variants, producer and saved-pin baselines throughout. Any unchanged producer rejection goes to its responsible owner with the original safe error and exact violated requirement; it does not authorize modifying protected truth or reducing coverage.
