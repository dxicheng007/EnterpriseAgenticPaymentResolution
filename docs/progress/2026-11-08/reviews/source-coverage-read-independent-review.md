# Independent review: source coverage read, lane A

- Reviewed candidate: `c5d51b6a188718c851cacb0bb5b8d2912802e32d`
- Base: `33364f0edd20fd82635aa09700b4dd240e212a86`
- Accepted wire-contract dependency: `9a627f6` (in base)
- Review checkout: `/Users/devincheng/.codex/worktrees/acquisition-review/EnterpriseAgenticPaymentResolution`, detached at the reviewed candidate, clean before and after review.
- Reviewer: independently dispatched `/root/astra_source_coverage_read_verify`; separate from builder and supervising lead. No subagents used.
- Review date: November 8, 2026.

## Verdicts

**Specification: PASS for the assigned A source coverage read slice.**

**Quality: PASS. No actionable findings.**

The verdict applies only to this exact candidate and the authorized scope, including the unchanged `aggregateHash` and `documentCitations` internal helper exports. It is not approval of live discovery, construction, financial interpretation, activation, synchronization, or the forthcoming client/UI integration. Joint user acceptance remains pending.

## Review basis and conclusions

Read repository and applicable Apps, Packages, Sources, and Tests guidance; the guided implementation brief's global constraints, section 2, and section 4-A; relevant PRD boundaries/financial integrity/acceptance criteria; shared ownership; frozen F4 capture/evidence rules; and verification conventions. Examined all seven changed files against the base, the accepted response schema, and existing capture, source-event, evidence extraction, locator, storage, and route error paths.

- The required strict query and source-wide reviewer authorization precede coverage capture reads. Per-citation binding remains restricted to that same company/source; no account-preview grant is promoted into source-wide access or authority.
- The reader uses the explicitly selected aggregate and exact manifest. It rejects stream snapshots, inconsistent company/source/epoch/dossier bindings, duplicate or incomplete membership, changed hashes, and missing stream members. Stream rows are checked against exact ordered prefixes, safe watermarks, registered resource schemas, event hashes, and stream content hashes. Late events are excluded by the pinned watermark.
- Identity derivation follows successful validation of all required captured evidence. Original file bytes and API payload bytes are retrieved and hashed, current extraction is compared with stored extraction, full expected citation membership is reconstructed, and actual file/API associations and locators are checked. A citation that merely exists is insufficient.
- Agreement parsing is anchored to the full first-page supported grammar with bounded identifier syntax, real calendar dates, and applicability at the manifest as-of. Other pages cannot become identity evidence. All pinned agreements are considered. Same-name accounts remain distinct; conflicting agreement or recognized directory claims withhold only the affected account observation. Matching amendments are related citations, not interpreted financial transitions.
- Complete raw event membership survives unsupported or conflicting identity interpretation. Company B's undocumented payment remains unresolved. Mixed revisions and unscoped semantics are not silently resolved or filtered. The response exposes source observations, no profile/parent identity/eligibility/approval status, terms, or monetary calculations.
- The coverage execution path contains SELECTs and content reads, with no runtime-pool access, candidate registration, citation publication, activity publication, capture mutation, model/provider dependency, protected-oracle reads, runtime fixture-answer reads, or filesystem path/URL execution from source text. The additional dossier exports retain their implementations and are excluded from the package's public index.
- Infrastructure errors are redacted into a no-store `503 SOURCE_UNAVAILABLE`; pinned missing/damaged content remains a conflict, and invalid locators remain 422. No older-capture or empty-success fallback is present.

## Reviewer-run checks

Node 24 and PostgreSQL 18 binaries were placed on PATH. Database tests used only the dedicated review lease: PostgreSQL 55433, control 3101, worker 3102, web 5174, test prefix `eapr_test_review_t1`, demo namespace `eapr_review_t1`. Tests provisioned and removed their own randomly suffixed database pairs and temporary fixture/original roots. Existing review data/pins were preserved; main PostgreSQL 55432 was untouched.

| Check | Result |
| --- | --- |
| `npm run test:unit -- packages/sources/test/source-coverage.test.ts` | PASS, 3/3 |
| `npm run test:integration -- tests/integration/source-coverage.test.ts` | PASS, 6/6 |
| Independent probe config below | PASS, 6/6 |
| `npm run typecheck` | PASS |
| `git diff --check 33364f0edd20fd82635aa09700b4dd240e212a86..HEAD` | PASS |
| Final `git status --porcelain=v1` and `git rev-parse HEAD` | Clean; exact reviewed candidate |

The focused candidate integration suite exercised both real generated/uploaded/captured sources, 30/28 event inventories, separate same-name accounts, the B unknown payment, source-versus-preview permission separation, malformed queries, foreign/stream snapshots, unsupported originals, incomplete newer epochs, late events, missing/damaged originals, store outage, event/manifest/aggregate mutations, forged extraction, wrong file/API associations, invalid locators, and rehashed incomplete citation membership. It compared every row in every public control and runtime table and original-store listings before/after repeated reads. Its visible and protected generator roots are removed before HTTP coverage reads, and no fixture-answer read is needed.

Independent probe artifacts are retained only in the ignored main-plan workspace:

- `source-coverage-independent.probe.test.ts`
- `source-coverage-independent.vitest.config.ts`

Reproduction from the exact review checkout, with the PATH and lease environment above:

```sh
npm exec vitest run -- --config /Users/devincheng/.codex/worktrees/acquisition-local-build/EnterpriseAgenticPaymentResolution/.superpowers/sdd/2026-11-08-implementation-plan/briefs/source-coverage-independent.vitest.config.ts
```

The six independently authored probes establish:

1. Authorization denial returns no-store 403 before any database or original-store read.
2. A database dependency exception returns redacted no-store 503, leaks no exception sentinel, and performs no store read.
3. A false complete flag or missing pinned stream returns the appropriate 409; restoring the disposable rows restores the identical historical aggregate response.
4. Removing a captured Company B API original returns `MANIFEST_MEMBER_MISSING`, not partial successful coverage; restoration recovers the identical response.
5. A newly authored and uploaded agreement PDF, absent from any fixture account list, produces its cited zero-event source account. A newly authored contradictory directory blocks the affected existing account with citations to the new snapshot's actual originals, retains all raw events as appropriate, and leaves the previous snapshot response identical.

6. A valid complete capture containing newly published financial and semantic events with omitted seller IDs returns 200, preserves both exact raw identities, and flags both event IDs as undocumented without adding or modifying any account observation. Omitting the required raw account while keeping the registered payload account is rejected upstream by the existing source contract; that invalid envelope is distinct from the retained valid raw seller gaps.

The first probe run had two harness defects, both corrected without product changes: a `SourceError` imported from the main checkout had different class identity from the reviewed route, and an assertion incorrectly reused old-snapshot citation IDs in a new snapshot. The corrected harness imports the candidate's modules and asserts new-snapshot citation contents. The corrected five-probe run passed; the final bounded extension passed all six probes. The initial sandboxed unit attempt was blocked from writing Vite cache; scoped escalation permitted the test/cache and dedicated local database operations.

## Limits

These are focused machine checks plus independent source review. The builder's reported full 166-unit/70-integration/4-browser regression runs were not duplicated or relabeled as reviewer-run evidence. No new browser behavior is in this candidate; C's client/UI integration requires its own review and browser checks. No live model run, protected financial evaluator pass, persisted parent behavior, activation, synchronization, or joint user acceptance is claimed.

The parser intentionally supports the two documented agreement forms, exact directory grammar, and amendment form; unsupported text remains unresolved. Re-reading/re-extracting the complete capture per GET and relying on the pinned local extraction implementation are acceptable stated prototype limits, not scale or cross-extractor compatibility claims. Database-owner rewriting of an entire internally consistent capture is outside the trusted-local-process boundary; hashes detect conflicting content, not independent source authorship.
