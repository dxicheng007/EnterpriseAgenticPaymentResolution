# Guided source coverage implementation handoff

> For Sol / lanes B, A, C: implement task by task using `superpowers:executing-plans`; preserve lane ownership. This brief authorizes no additional subagent dispatch. The user has already approved the product flow and bounded explanatory improvement; no new product approval is required.

**Goal:** Explain which documented source accounts are in the complete capture, which are covered by the selected candidate, and what still needs evidence or construction, without changing preview or granting authority.

**Architecture:** Add one read-only, immutable-snapshot-bound source coverage response. A derives it from captured public evidence and source events; B owns its strict shared schema; C joins it to the selected candidate for presentation. Keep financial planning, raw holds, candidate construction, and verification unchanged.

**Tech stack:** Existing Node 24 / strict TypeScript / Zod / Fastify / PostgreSQL / React / Vitest / Playwright. No dependency or database migration.

**Spec:** `AGENTS.md`; `prdv2.md` §§1, 8, 12, 14, 17, 19; `docs/superpowers/plans/2026-11-08-contract-freeze.md` F1/F3/F4/F6/F7; implementation plan T4.1/T4.2; `docs/progress/2026-11-08/handoffs/guided-discovery-audit.md`.

**Baseline inspected:** `16977e76bda6fb469740547528bfc882db46494d`. This is an implementation handoff, not an implemented feature, contract freeze amendment, machine pass, or acceptance record. No product files, protected truth, or live services were changed/read to prepare it.

## Global constraints

- Preserve complete snapshot, all event memberships, holds, `unsupportedRows`, diagnostics, existing profile/spec hashes, `parentWrites: 0`, and the empty development target.
- Source evidence establishes source identity observations only. `sourceBuyerId` below is explicitly not an approved parent identity. Names never merge entities.
- No runtime imports of canonical fixtures, `accounts-*.json`, generator helpers, truth files, construction pin files, evaluator output, or fixture account-index metadata to derive coverage. Read only completed capture members through source/evidence services. Catalog metadata may establish authorization/routing, not identity facts.
- Every profile stays separate and versioned. This task constructs no additional profile, identity map, lookup, financial rule, or activation.
- Original machine diagnostics remain inspectable. New observations cannot suppress a hold or make a candidate eligible.
- No model calls, fake agent activity, fake progress, fake completed discovery, new dashboard framework, or nonfunctional action controls.
- Do not reinterpret mixed semantic revisions or amendments. A matching amendment citation indicates a related source document, not a supported contract transition.

## Review focus

1. Same name / different buyer or account IDs: preserve separate rows and explicit IDs (A unit + C display tests).
2. Valid source snapshot but absent/unrecognized/conflicting identity evidence: retain events as undocumented; show uncertainty, never invent identity (A unit/integration + C fallback tests).
3. Another company, aggregate, hash, member, or late response mixed into the view: reject or discard the enrichment, preserve raw preview (A integration + C client/browser tests).
4. Multi-event holds, duplicate alias rows, semantic events, and source-wide blockers: reconcile event sets separately from operation/hold counts, preserve diagnostic severity (C unit/browser tests).
5. Source read success confused with construction/verification/activation: show only facts backed by the corresponding existing API; no readiness promotion (C browser tests).

## 1. Before and after wire contract — B owns

Today:

```ts
GET /api/sources/:companyId/dossier?manifestId=...
// SourceDossier: companyId, manifestId, snapshotIds, evidenceIds,
// complete, missingMembers, diagnostics; no account interpretation.

GET /api/demo/candidates
// development-fixture / empty-fixture; one constructed profile per source.

POST /api/connectors/preview
// PreviewResponse: artifact, outcome, diffs, unsupportedRows,
// diagnostics, parentWrites: 0. UNKNOWN_ACCOUNT is not identity proof.
```

Keep those shapes and behaviors unchanged. Add:

```ts
GET /api/sources/:companyId/coverage?snapshotId=<aggregate-id>

type SourceAccountCoverage = {
  sellerEntityId: Id;
  sourceAccountId: Id;
  sourceBuyerId: Id;           // source document's buyer, never parentCustomerId
  displayName: string;        // source legal-name text; identity is the ID tuple
  identityEvidenceRefs: Id[]; // nonempty; captured agreement citations
  relatedEvidenceRefs: Id[];  // matching amendment/directory, possibly empty
};
type SourceCoverageEvent = {
  id: Id;
  kind: RawSourceEvent['kind'];
  rawIdentity: RawSourceEvent['rawIdentity'];
};
type SourceCoverageResponse = {
  companyId: Id;
  sourceRef: Id;
  manifestHash: Hash;
  snapshot: SourceSnapshot;   // existing complete aggregate, unmodified
  derivation: 'captured-source-rules-v1';
  accounts: SourceAccountCoverage[];
  events: SourceCoverageEvent[];
  diagnostics: Diagnostic[];  // coverage interpretation issues only
};
```

The existing `snapshot.manifestId`, `snapshot.contentHash`, `snapshot.eventIds`, and `snapshot.evidenceIds` supply the binding; do not add another mutable identity or duplicate counter. Response contains no candidate hash, parent scope, financial amounts, operational status, or model status. The endpoint serves no `latest` mode and never captures on GET. A future discovery producer is not silently substituted for `captured-source-rules-v1`.

**Exact B paths:** create `packages/contracts/src/source-coverage.ts`, create `packages/contracts/test/source-coverage.test.ts`, add export in `packages/contracts/src/index.ts`. Use the existing browser-safe schemas from `common.ts` and `source.ts`, not canonical helpers in browser imports. B makes no changes to `runtime.ts`, `local-demo.ts`, `CustomerProfile`, or hashing preimages.

**Schema requirements:** strict unknown-key/prototype guards; existing Id/Hash/EventKind/RawIdentity/SourceSnapshot schemas; unique account key `(sellerEntityId,sourceAccountId)`; nonempty display name and nonempty distinct identity citations; distinct related citations; distinct event IDs equal to the snapshot event-ID set; each event raw company matches response company; snapshot source matches response source; all cited IDs belong to snapshot evidence IDs. Account array sorted by exact seller/account tuple, events and citation sets lexical. An account may have zero events. No sum-of-array-length proxy for unique event membership.

Schema checks prove shape and internal consistency only. A must enforce authenticity, source bindings, and evidence support below.

## 2. Source read and deterministic evidence facts — A owns

**Exact A paths:** create `packages/sources/src/source-coverage.ts`, create `packages/sources/test/source-coverage.test.ts`, modify exports in `packages/sources/src/index.ts`, modify `apps/control/src/routes/sources.ts`, create `tests/integration/source-coverage.test.ts`. Existing `createSourcePlugin` already receives `db`, `clock`, `store`, catalog, and `authorizeSource`; no server/composition change should be needed. If a shared helper is necessary, coordinate its export with B; do not edit preview/compiler or extract their behavior as part of this slice.

**Interfaces to implement:**

```ts
// A-only service API, no browser/database type in shared schema:
readSourceCoverage(
  dependencies: Pick<UploadDependencies, 'db' | 'store'>,
  source: SourceDefinition,
  snapshotId: Id,
  authorize: EvidenceAuthorization,
): Promise<SourceCoverageResponse>
```

The route validates its required query, resolves the catalog entry, then calls `authorizeSource(request, {companyId,sourceRef,operation:'read'})` before reading capture content. It passes an evidence authorizer that checks the exact same authorized company/source. This is source-wide reviewer inspection, not a task tool and not an account-preview grant. No mutation/CSRF requirement on this GET. Reuse `SourceError`/`ApiError` and `Cache-Control: no-store`.

### Binding validation before deriving any account

1. Load the explicitly selected snapshot; require it to be the aggregate `snapshot:<manifestId>` for this company/source, represented by a complete dossier with no missing members. Reject stream-only snapshots. Load the exact manifest, never the latest manifest.
2. Verify the manifest hash, aggregate hash using frozen F4 preimage/order, source/schema membership, exact event-ID membership, each `hashEvent`, per-stream ordered membership/contiguous sequence/watermark and stream content hashes. Do not assume `getSnapshotRecords` alone performs these checks: it currently only checks row count and schemas. Follow existing F4/source routines and preview's `verifyCapture` as the specification reference without changing preview.
3. Load the complete snapshot's evidence refs through `readEvidence` with scoped authorization. Require exact snapshot/dossier evidence membership with no duplicate or missing ID. For documents, require aggregate snapshot identity, file membership, original hash, document association company/source, and the existing locator/excerpt/text validation. For API associations, require their captured source-event association and original hash. Check originals remain available and hash-valid through the content-addressed store; an unavailable original is not a valid account citation.
4. All evidence and source bytes are data. Do not execute instructions, paths, URLs, code, or tools found in a document. New coverage GET performs SELECTs/content reads only; it does not create citations, snapshots, activity events, candidates, or registry entries.

### Minimal supported observation rules

- Recognize the existing captured A/B **agreement document formats** in `scripts/generate-fixtures.ts` and `apps/control/src/demo-candidates.ts` by an anchored full-page parser over captured `contract_pdf` evidence, page one. Parse contract ID, seller, buyer, source account, and legal name from that page. Validate identifier syntax and agreement applicability at the captured manifest as-of. The parser may validate the surrounding known grammar/date/amount syntax to avoid accidental partial matches, but must not publish terms or change candidate behavior. It is an explicitly limited deterministic source-format reader, not AI construction.
- Examine all pinned contract members, not `capture.contractFileId`, a filename suffix, first account, source fixture arrays, or catalog buyer data. Publish a documented account only when all recognized claims for its exact seller/account tuple agree on buyer/name. If recognized claims conflict, omit that account from `accounts`, retain every raw event, and emit `SOURCE_IDENTITY_CONFLICT` with the conflicting citation IDs. Do not choose the newest/name-majority claim.
- Unknown document grammar produces `SOURCE_IDENTITY_UNSUPPORTED` with the citation ID and no identity claim from that document. It is HTTP 200 with incomplete interpretation, not a missing-capture failure. A raw seller/account ID without applicable identity evidence is still only a raw ID.
- The exact A account-directory email format can corroborate seller/account/buyer triples already parsed from agreements. Contradictory recognized directory claims block the affected account's documented identity; unrecognized text cannot override an agreement. Store matching directory refs in `relatedEvidenceRefs`. The contract citation alone supports the legal name.
- A captured `amendment_pdf` may appear in `relatedEvidenceRefs` only when its recognized title's contract ID and its seller/buyer statement match an account's agreement. Show it as a related amendment requiring terms review, not a selected effective rule. Do not reject an otherwise supported source identity merely because its captured events span semantic revisions. That issue remains with existing preview/compiler behavior and the later contract investigation owner.
- `events` is the complete validated capture projected to ID/kind/raw identity, including undocumented IDs and unscoped semantic events. Do not enrich raw identity with sourceBuyerId or parent scope, and do not filter it to the selected profile. No event amount is needed for this read.
- Set `SOURCE_IDENTITY_UNDOCUMENTED` diagnostics for raw event identities with no supported documented account, using affected event IDs. Wording must say the source account identity is not established by this supported evidence read, not that the account does not exist. Keep source-wide raw identity gaps visible. These diagnostics do not replace planner diagnostics.

### Error behavior

| Condition | Result |
| --- | --- |
| Missing/invalid/unknown query parameters | 400 `SOURCE_COVERAGE_INVALID` |
| Missing session / forbidden source | Existing 401 / 403 authorization behavior |
| Missing source, snapshot, or aggregate not captured | 404 existing source/reference code |
| Wrong requested company/source, stream-only snapshot, inconsistent complete capture/epoch | 409 `SOURCE_EPOCH_CONFLICT` |
| Hash/member inconsistency or missing previously pinned member | 409 `SOURCE_HASH_CONFLICT` / `MANIFEST_MEMBER_MISSING` |
| Invalid citation locator | 422 `CITATION_INVALID` |
| DB/store/read dependency unavailable | 503 `SOURCE_UNAVAILABLE` |
| Complete valid capture, unsupported/conflicting identity interpretation | 200 with retained event inventory, conservative accounts, diagnostic |

Do not silently substitute an older capture or return empty successful coverage on infrastructure/binding errors. Existing preview and dossier views remain usable independently.

## 3. Customer-first guidance — C owns

**Exact C paths:** modify `packages/client/src/sources.ts`; create `packages/client/test/source-coverage-client.test.ts`; create `apps/web/src/features/preview/SourceCoverage.tsx`; create `apps/web/src/features/preview/source-coverage-values.ts`; modify `PreviewPage.tsx`, `PreviewResult.tsx`, and `preview-values.ts` in that same feature directory; modify `apps/web/src/features/sources/review.css`; create `packages/client/test/source-coverage-display.test.ts`; modify `tests/e2e/v2-preview.spec.ts`. Reuse `EvidencePanel`, existing selector/layout, `VerificationPanel`, and diagnostics components. No new App routing/framework or agents page.

**Client API:** `getSourceCoverage(companyId: Id, snapshotId: Id, signal?: AbortSignal): Promise<SourceCoverageResponse>`. Parse the strict response and require response company and snapshot ID to match the request; candidate caller additionally requires sourceRef equality. Read for the selected candidate only, abort/discard on change, and bind mounted state to candidate ID plus snapshot ID. Do not carry an old response across refresh or new selection. The ID refers to an immutable aggregate; its response hash is displayed provenance, not a newly granted approval. Existing candidates do not carry an expected snapshot hash, so do not invent one from local fixture metadata.

**Pure join API:** `summarizeSourceCoverage(coverage: SourceCoverageResponse, profiles: readonly CustomerProfile[])`. Match candidate source/company/seller/sourceAccountIds exactly. Return documented account rows with matching profile IDs/hashes and unique financial/semantic event-ID sets, undocumented event-ID sets, and totals for selected-profile versus outside-profile raw memberships. This join says “profile supplied in this candidate,” never “approved.” If a candidate profile matches raw events whose source identity remains undocumented, show both facts: profile supplied, evidence identity unresolved. These two axes are not mutually exclusive. Multiple profiles with the same raw key are a conflict, not a license to count events twice or infer approval.

**Display order within the existing selected-candidate view:**

1. Lead with selected customer/source-account label and exact IDs, “Development fixture · empty target,” captured as-of, and “This preview covers one customer from the company snapshot” for the current one-profile request. Describe multiple profiles accurately if encountered; never auto-enroll other accounts.
2. After preview, show its existing projected balance first (A: `$800.00`), before raw operation JSON/hash detail. Name the existing 11 operations “proposed imports of existing records.” Explain that only allocations of payments/credits reduce invoice balances. Keep each invoice/payment/credit/allocation amount and its existing lineage reachable; do not introduce a second financial calculator or hardcode `$800`, `$3,000`, `$2,000`, or `$200` into components. If a compact per-invoice explanation is added, derive only from returned operation records/lineage with checked cents and explicit as-of; fall back to detailed operations when a complete explanation cannot be proven. This optional formatting cannot block the core coverage slice.
3. “Captured source coverage”: total captured event count, selected-profile event membership, and outside-profile membership. Then documented source-account rows, with display name + source buyer/seller/account IDs, event-kind counts, identity citations, related amendment citation, and whether this exact candidate contains a profile. Same-name Northstar rows stay separate. Accounts without profiles say “No profile in this candidate; separate construction and verification needed,” not “ready to import.”
4. “Held or unresolved records”: preserve selected-customer and source-wide blockers prominently. For raw unscoped `UNKNOWN_ACCOUNT` holds only, enrich explanation with documented account groups by exact event-ID membership. Keep the original hold object and diagnostics once, expandable. A hold spanning groups is shown once with references to all affected groups; do not clone/split it into new authoritative holds. Count source events distinctly; count hold entries separately. `unsupportedRows` remains an alias when equal, using existing deduplication.
5. “Next available step”: inspect evidence → run the existing preview → request existing independent verification if mounted. Existing report coverage/eligibility remains authoritative. Static text may explain “Live agent construction is pending. It will investigate source identities, contracts, and receivables and propose separate profiles.” There is no Start discovery button until T4.1's real route/state exists. Explain that later enablement requires explicit per-customer review; do not imply an enable action exists in this build.

**Coverage failure/fallback:** show “Source-account explanation unavailable” with retry for this GET; preserve preview result, raw holds, evidence, and verification. Bare `UNKNOWN_ACCOUNT` stays “Records not mapped by these profiles.” A malformed/stale coverage response must not classify accounts. A valid coverage response cannot reclassify `IDENTITY_SCOPE`, `SEMANTIC_VERSION`, scoped selected blockers, or other diagnostic codes as benign outside-profile rows. Source-wide preview blockers remain blockers even if every raw event has a documented account.

**Expected baseline examples, assertions not constants:**

- A: 30 captured events = 11 selected + 19 outside; outside = 18 financial + 1 semantic. Other documented accounts have 10 and 9 events and remain distinct despite the shared name. Account 2's amendment is visible and not interpreted as cleared. Preview remains 11 operations, projected 80000 cents, 19 holds.
- B: 28 captured events = 9 selected + 19 outside; 18 outside events belong to two documented other accounts; one payment remains undocumented/unresolved. Do not call all 19 “other customers.” No guessed owner/allocation; selected preview balance unchanged.
- General: events, operations, and holds are separate dimensions; compile failure/source-wide blocks/replay need not partition into “operations + holds.” Coverage classification is raw membership, not proof that each selected input produces an operation.

## 4. Ordered testable slices and lane handoffs

### B — strict wire contract, then publish exact names

- [ ] Add schema tests rejecting duplicate keys/IDs, foreign evidence refs, mismatched event sets/company/source, unsupported keys, invented status fields, and empty identity support; accept same-name distinct accounts, zero-event account, and undocumented events.
- [ ] Observe assertion-level failures, implement schemas/export, run `npm run test:unit -- packages/contracts/test/source-coverage.test.ts` and `npm run typecheck`.
- [ ] Commit `feat: define cited source coverage read contract`; send A/C commit and exported `SourceAccountCoverage`, `SourceCoverageEvent`, `SourceCoverageResponse`, `SourceCoverageResponseSchema`.

### A — immutable source coverage read after B

- [ ] Unit tests use supplied public captured text/events (no protected oracle): changed account names/IDs/seed, duplicate names with different buyers, unsupported format, contradictory agreement/directory, matching and nonmatching amendment, mixed revisions without financial interpretation, event with no account, unscoped semantics. Assert exact cited support and deterministic output ordering.
- [ ] Integration generates/uploads/captures visible originals in disposable DB/store, then calls authenticated GET. Assert A/B baseline counts above; source-wide reviewer permission remains separate from preview account grants; foreign source/evidence, incomplete/stream-only capture, damaged/missing original, hash mutation, and late published events cannot produce mixed successful coverage.
- [ ] Prove repeated GET does not change control or runtime tables/activity/registry counts or snapshot contents. Deny all truth/fixture-answer reads in the source coverage path. No discovery/provider dependency.
- [ ] Implement/read route, run `npm run test:unit -- packages/sources/test/source-coverage.test.ts`, `npm run test:integration -- tests/integration/source-coverage.test.ts`, and `npm run typecheck`.
- [ ] Commit `feat: explain captured source accounts from evidence`; send C exact route examples for A/B plus 200 unsupported, 409 binding failure, and 503 unavailable. B reviews shared schema adherence; A does not change C's UI.

### C — guidance after B; integrate after A

- [ ] Client tests reject wrong company/source/aggregate and malformed memberships; display tests pin conservative fallback, exact profile matching, same-name distinction, 30/28 reconciliation, semantic versus financial counts, multi-group holds, unmatched alias rows, selected/source-wide blocker preservation, and no readiness inference.
- [ ] Browser tests exercise both real source coverage reads with the existing local-review harness: select A, inspect `$800.00`, 11 operations and 19 holds, open both separate Northstar identity citations and amendment; select B and inspect the 18 + 1 distinction. Capture no authenticated trace/secrets. Test slow old response after selection change and coverage failure while preview remains usable.
- [ ] Implement within existing components. Assert fixture/empty-target labels persist, parent writes remain zero, live discovery remains pending, and no new approval/activation/model action appears. Verification availability alone must not be rendered as an eligible candidate.
- [ ] Run `npm run test:unit -- packages/client/test`, `npm run test:e2e -- tests/e2e/v2-preview.spec.ts`, and `npm run typecheck`.
- [ ] Commit `feat: guide customer preview with cited source coverage`; hand the exact candidate commit to independent review, then root schedules the guided user checkpoint. Focused checks are partial, not a V4 or joint acceptance pass.

Root integrates B → A → C. B and A completion messages are dependencies, not user approvals. If concurrent work owns one of these files, coordinate the smallest patch through that owner before mutation. Do not rewrite broader source or preview modules to avoid coordination.

## 5. Separate next work: real V4 construction and its monitor

There is no V4 monitor implementation or frozen discovery state on this baseline (confirmed by root). The “existing V4 monitor” dependency is the T4.1 planned lane, not a working surface to reuse today.

1. B + A/C must first freeze `ModelTurn`, `ModelResult`, `DiscoveryState`, `TaskContext`, source/account task capabilities, finding revisions, and start/get/pause/resume state semantics against PRD §8 and T4.1. This brief deliberately defines none of those types and does not put speculative lifecycle fields into source coverage.
2. A then owns planned `packages/discovery/src/{model,coordinator,roles,tools,tasks,budgets}.ts`, `apps/control/src/routes/{discovery,events}.ts`, and the reserved discovery migration after B confirms the migration number. C owns `apps/web/src/features/agents/{AgentPage,TaskTimeline,ToolInspector}.tsx`. Follow F7 durable publication/cursor/resync; do not create a parallel progress channel.
3. Real coordinator/specialist tasks read authorized captured evidence, publish versioned findings and unresolved questions, and let the connector engineer generate a spec with separately versioned customer profiles. A source coverage row can be a cited navigation aid, never the final identity answer, automatic profile generator, or sole mandatory discovery path. Raw evidence reads remain available so agents are not constrained to the fixture-format parser.
4. Scripted model tests prove tool permissions, bounds, pause/resume/replay, and zero writes only. Show scripted/fixture provenance if exposed. Actual agent status comes from persisted run/task state; a page load, elapsed timer, or source coverage fetch is not an agent run.
5. T4.2 adds the real provider adapter and genuine evidence/tool trace, source-specific generated artifacts for both companies, exact-candidate protected independent verification, and a changed-name/amount holdout. Missing provider access is explicit failure/pending, not a fixture pass. Successful verification and separately approved activation remain distinct; runtime remains model-free.
6. Account 2's historical/amended revision span is a real later construction/compiler contract issue. Ask A/B to locate the authoritative supported representation before implementing it; if materially unspecified, root raises that exact semantic gap. Do not clear it with coverage labels, a new profile alias, or a speculative amendment rule.

## Readiness and limits

The deterministic explanation and guided presentation are actionable now once B publishes this small schema. They require no product/financial decision beyond the authorized flow. They will make the current demo understandable and preserve exact scope, evidence, and zero writes. They will not satisfy V4 live construction, create additional customer connections, clear the 19 holds, or advance V3/V5 acceptance. Machine checks, independent review for the exact commit, and joint user acceptance must remain separately reported.
