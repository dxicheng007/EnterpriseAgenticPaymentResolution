# Adversarial product-spec review — document applicability producer

Reviewed code tip `a98a990` (base `cdcb26d`). Prior PASS reviews are not authority. Association logic largely matches the handoff. Candidate readiness: **fix-before-accept**.

## Should-fix before accept

1. **Foreign ID classification.** Producer throws `400 SOURCE_CONTENT_INVALID` for IDs absent from `facts.evidenceIds`. D1 `readEvidence` returns `DISCOVERY_FORBIDDEN` for unknown/forbidden evidence. Align with existing safe classifications consumers already map. Separately: ID in `facts.evidenceIds` but missing from citation maps must fail closed (`409` conflict family), not unresolved.
2. **Handoff integration matrix on this entry point.** Add table-driven tamper / wrong binding / corrupt locator / barrier / DB-or-blob outage cases against `prepareDocumentApplicability`, not only shared `prepare` suites.
3. **One-page rule is unproven.** Current multipage unit cases are confounded (page-2 locator or buyer/name conflict). Add a conflict-free two-page agreement whose **page-1** citation is requested and must be unresolved. Mirror in integration with a real PDF.
4. **Conflict scan uses raw `pages[0]` and metadata kind gates.** Bind conflict parsing to full page-1 / directory citations via `locate`. Owner must rule whether kind labels are authoritative for conflict grammar, or whether agreement/directory text should be scanned regardless of kind (adversarial finding: contradictory agreement labeled `amendment_pdf` never blocks).

## Watch / owner rulings

5. Future-dated contradictory agreements are ignored by `parseAgreement` (same as coverage). Confirm whether §6 “all recognized claims” should include future-dated text for conflict only.
6. Amendments never conflict; fee-differing agreements both associate. Consumers must not treat association as term/fee support.
7. Unsorted and empty `evidenceIds` are accepted; empty still loads a capture. Do not rely on either.
8. Cross-capture equal-bytes case is confounded by seller mismatch. Add a same-seller copy under a different capture.
9. Evidence IDs do not bind content (`citeEvidence` hashes snapshot/source/locator). Persist `originalHash` with full binding.
10. Unit tests only prove `partitionDocumentApplicability` on synthetic captures. Integrity rests on item 2.

## What held up

Source-wide before I/O; six-field binding + schema versions via `loadPinnedCapture`; catalog seller + `facts.sourceAccounts`; directories/amendments/API unresolved for positive proof; no fee/name leakage; duplicate and >50 rejection before I/O; SELECT-only happy-path hash check present.

## Next

Fix items 1–3 (and citation-bound conflict scan) on `team-discovery`, then re-run focused suites and a fresh exact-candidate review before consumer dispatch. Items 4–5 need root/source-owner rulings if conflict semantics change.
