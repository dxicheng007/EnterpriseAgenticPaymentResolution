# Independent review — document applicability producer

Reviewed worktree `/Users/williamli/Developer/eapr-discovery`, branch `team-discovery`, tip `a98a9900469b09d120b147ec1ee14a22b7300417`, base `cdcb26d`. Producer commits: `dfbead4`, `5bfe28f`, `1053180`, `a98a990`. Scope is the source-owned producer only. No consumer, composition, or activation acceptance is claimed.

**Specification verdict: PASS.**

**Quality verdict: PASS.** No fix is required before producer acceptance. Integration gaps below are partial evidence, not blocking defects.

## Required reading

Opened before judging code:

1. `docs/progress/2026-11-08/handoffs/b-document-applicability-handoff.md` — one-page full locator; conflict scan includes unsupported page-one claims; ≤50 distinct IDs; unsupported grammar is unresolved success.
2. `docs/progress/2026-11-08/reviews/b-document-applicability-handoff-fix-review.md` — producer dispatchable alone; consumers wait for reviewed producer plus path release.
3. `docs/progress/2026-11-08/handoffs/b-discovery-applicability-gap.md` — coverage UI is not applicability authority.
4. `docs/superpowers/plans/2026-11-08-team-expansion-handoff.md` D2 card — reserved producer paths; no public tool, table, composition edit, or authenticity token.
5. `packages/sources/AGENTS.md` — account-only grants stay denied for unknown file coverage; facts-only reader output unchanged.

## Conformant behavior (summary)

- `sourceWide` and request validation run before blob I/O.
- Capture load reuses `readDiscoveryCaptureContents` via shared `loadPinnedCapture`.
- Positive association requires `contract_pdf`, one page, exact page-one locator, catalog seller match, and exact `facts.sourceAccounts` tuple.
- Conflict scan covers all pinned page-one agreements and directories; no latest-contract or amount resolution.
- Foreign IDs throw; unsupported captured IDs are unresolved; partition is complete and sorted.
- Grammar extraction left coverage wire outputs unchanged.
- Diff stays inside reserved producer paths. No discovery consumer, apps, db, or contracts edits.

## Quality notes (non-blocking)

- ID/date/amount regex atoms are duplicated next to amendment parsing in coverage.
- Conflict aggregation is reimplemented beside coverage rather than shared.
- Empty `evidenceIds` still loads a capture (harmless).
- Factory returns `DiscoveryReadTools & DiscoveryDocumentApplicabilityTools`; mandatory method transition remains a later consumer/root task.

## Verification gaps (partial evidence)

Missing from `discovery-document-applicability.test.ts` but already covered for the shared load path by `discovery-capture-read` / `discovery-source-tools`:

- Tampered bytes, extraction, metadata, locator, dossier inconsistency
- Blob-read barrier with selected-row mutation
- DB or blob outage typed failures

Recommended follow-up (not required for acceptance): one tampered-blob case and one barrier case through `prepareDocumentApplicability` itself.

## Checks run on `a98a990`

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| Unit: document-applicability, source-coverage | 18 / 18 |
| Integration: discovery-document-applicability, capture-read, source-tools | 25 / 25 |
| Integration: v1-manifests, v1-evidence | 3 / 3 |
| Integration: source-coverage | 6 / 6 |

Focused machine results only. Not a slice gate or joint acceptance.

## Next ownership

- Producer candidate `a98a990` is ready for root/source-owner acceptance with the partial gaps above recorded.
- C1/C2 consumers remain gated on accepted C2 matrix confirmation, mandatory interface transition, and serialized path release.
