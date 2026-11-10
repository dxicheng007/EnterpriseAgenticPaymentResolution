# C2 exact-candidate specification and quality review

Reviewed 2026-11-10, read-only, for the Platform coordinator.

## Verdicts

**Specification: PASS for C2 fixture qualification.** No Critical, Important, or Minor specification finding.

**Code quality: PASS.** No Critical, Important, or Minor quality finding. The change uses the accepted reviewer and evidence helpers without duplicating the approval chain or generalizing the fixture API. No corrective change is required for the C2 gate.

This is only the C2 gate. Combined final review of all six tasks across the two fixture plans remains pending. This does not establish selector/catalog behavior, indexed admission, sync lifecycle behavior, live operation, financial acceptance, or joint user acceptance.

## Exact candidate and review basis

Worktree: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

Coordinator-supplied range: `213d4f8a2389cffc24ef77562e3b5085569c8a0b..15b003b4a4bd57eedd7f0090c85868d2368d19b0`. The supplied diff identifies intervening `b0427c6` as root journal documentation. Those three documentation files are outside C2 source scope and receive no new review approval here. The C2 source delta consists solely of:

| File | Added lines | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `tests/fixtures/sync-selection-catalog-csv.ts` | 193 | 13502 | `5adfb391b2eddc91010dd712f46f62278a741e87199e4e9aca462fdb37c835bf` |
| `tests/integration/sync-selection-catalog-csv-fixture.test.ts` | 866 | 56088 | `6043f9d900f5940c422d6524e1db447585d40e79c90861a86974081951bf600a` |

Both current files are byte-identical to their added content in the supplied diff. No Git command was used; commit topology/identity is coordinator-supplied, while diff/current-byte identity was independently checked.

Read the full task-C2 brief, including its verbatim Global Constraints and final root evidence note; the refreshed preflight including its reuse addendum; and the design's public-factory, full C2, evidence/cleanup/coverage, verification/handoff and size sections. Verified:

- Brief SHA-256: `cdcf37d54b696927238969ee51c4b8988a6a018cf124fca125e4e76917bd171b`.
- Preflight SHA-256: `489df8b498701cc90ee77191f23d679fa42f4e205e2bc2027fa65be2cfa69cf7`.
- Design SHA-256: `17ce1b1d1c5d9e0c155a70e3da6a916132f0ac22ecda1a1b8e55f9efeab6e49c`.
- Plan SHA-256: `51bdb43293e0d7a0745d0874798ac09ba10bb72cd7469d715d6f118b7d024260`.
- Implementer report: 18445 bytes, SHA-256 `89a75063d55e0940769d3b8c657251af55c994d3e0668360a8e180f883f5b539`.
- Supplied diff: 104185 bytes, SHA-256 `1e90cdb3e55be480b1dc7276955353bab620f005346219ddb38d313b4a60e377`.

## Specification assessment

**Genuine proof construction and bounded authority.** Factory anchors: `createSyncSelectionCatalogCsvFixture`, its candidate/policy resolution, `SelectionProof` construction, and `openInstalledSelectionReviewer` call. It invokes the unchanged author once, resolves B's unique account/artifact/profile/manifest policy entry, reads the actual report/attestation using the public registry, checks the complete positive-case financial matrix and five-kind coverage, and passes only that B proof with the returned dependencies and installed files to C0. No private issue closure, substituted proof, SQL financial decoding, second proof run, or rewritten source file appears. The public return is exactly runtime pool, detached subject and owned close.

Suite anchor `readProofs` independently validates both A and B through the public registry, tying candidate/profile/spec/artifact, complete capture hashes, scope, policy, pin, reservation, report and evaluator build together. Both successful runs retain genuine complete A/B reports. A's sidecar preparation and installed policy/scope remain prerequisites, not selecting authority.

**Real selected review/bootstrap/import.** Suite anchors `qualifyImport`, `qualifyInventory`, session observer and composition observer. Only B has reviewer source/account grants. The suite checks the real prepared package, activation request, committed intent, published bundle, selected bootstrap result and authoritative A5 readback. It checks all ten bootstrap cases and nine assertions with exact case coverage and capture/target/plan/build bindings. The accepted C0 implementation contains the authenticated prepare/activate chain and real worker activation; C2 delegates to it. The preflight's explicit direct-worker qualification applies: an HTTP worker activation or mirrored control receipt is not falsely required or claimed.

**Independent financial literals and provenance.** Factory anchor `assertLiteralImport`; suite anchors `expectedTarget`, `qualifyImport`, and the financial-lineage assertion around integration line 396. Expectations are scenario-authored literals, separate from the generator and compatibility helper: three USD300000 invoices/payments/allocations, exact July/August/September instants and due dates, same-month allocation relationships, versions/identities/scopes, one own customer/account, and the literal monthly/day-one term/configuration. The suite validates own first-contract evidence through original evidence reads and metadata lineage. Full target comparison excludes peers, credits, reversals and the unknown USD30000 source receipt. The exact nine-event/nine-target initial receipt has balances 0→0, and each actual financial origin binds the own approval key and full receipt. `verifyOriginals` is additional compatibility evidence, not the independent expected-result source.

**Actual CSV source and complete baseline.** Suite anchor `qualifyCsv`, including integration line 293's original file identity. It checks the real compiled csv/api/semantic transports, 18/10/0 baselines and complete source stream hashes/memberships. All three original CSV files are compared with their pre-publication hash/length, manifest identity/batch metadata, source-scoped stored evidence, and actual byte readback. Unchanged extraction/parser output is compared to all captured rows and literal six-member monthly identities. The literal header, sequences, source versions, three contracts and remittance member are covered. Each selected invoice/allocation belongs to an actual decoded CSV batch. This does not claim ongoing CSV capture or selector unsupported_transport behavior.

**Complete A selecting absence and read-only readback.** Suite anchor `qualifyInventory`. Whole sorted scalar runtime import inventory equals exactly one B row, with a separate count; total financial origins equal nine. Scoped checks reject A state in parent scope/target/snapshot/metadata/financial, import/origin, explicit authority head and command tables. Entire control prepared-review, intent and review-head inventories contain B only. Two financial reports and exactly one selected bootstrap result are required. All capture/sync tables in the stated no-capture set are empty. Before/after durable digests use ordered SQL JSON text, preserving timestamp values rather than hashing pg Date objects. Source/evidence and parent readback leave those durable projections unchanged.

**Ownership and error behavior.** Factory anchors owned cleanup stack and memoized `close`; suite anchors `closeSuccess`, `cleanupEvidence`, `fallback`, resource observers, and the last named test. Root, namespace, app pools and returned reviewer stop are registered immediately. Reverse cleanup attempts every action; construction preserves the original error. Successful construction stops listeners before return. The sentinel is injected only after real composition, live worker startup, both genuine financial reports and both sidecars. It precedes selected bootstrap/prepare/intent/import, and strict error identity is checked. Cleanup observations require awaited worker/control and pool shutdown before dropping the exact owned namespace; primary ownership survives failure. Fresh cleanup runs in finally, primary close is checked twice for shared-promise idempotence, and observers/fallback cleanup are restored/drained in finally.

## Evidence verification and quality assessment

Independently hashed all **59 artifacts listed in the implementer report**: every reported hash and byte length matches. Verified all **115 current source-inventory entries**, including explicit absences: no mismatch. Stable pre-run and post-run inventories are identical; source-before differs only by the two authorized C2 additions. The producer/source/evaluator/migration/saved-pin inventories show no unexplained changes. The code introduces no production API, dependency, DDL, barrel export, protected-producer edit or existing-suite assertion edit.

Final run directory: `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD`. Recorded Node is v24.22.2 and PostgreSQL is 18.6. Final typecheck status is 0. The exact scoped integration command records one passed file and **4/4 cases passed**, duration 55.24 seconds; log filtering and writing also exited 0. The source defines exactly the four required named tests. These are retained machine results, not tests rerun during review.

Primary, fresh and failure each retain **66 originals totaling 122769 bytes**, including all four truth files and both companies' visible input sets. Available pre-publication, successful post-proof/readback and pre-cleanup inventories are identical, including across attempts. No successful post-import phase is claimed for the failure attempt. All three cleanup records report the owned namespace dropped, root absent, worker stopped/closed and both application pools ended; success also reports control created/closed, while failure correctly records no control app creation.

The retained primary/fresh reports each show 13 mandatory positive-case checks for both A and B, exact required/executed coverage and all five event kinds, plus B's 10/9 bootstrap cases/assertions. Failure retains genuine A/B financial coverage but no selecting bootstrap. Each successful CSV proof records three six-member batches with original lengths 2940, 2943 and 2946 bytes and nine receipt event/target IDs.

Outer measurements are honest and sufficiently scoped. Shared helper anchors `measureFinancialOuter`, `measureBootstrapOuter` and `writePrivateEvidence`; suite anchors `qualifyMeasurements`, `saveMeasurements`, sidecar observer and `evidenceDirectory`. Observers call through and return real results. Successful attempts contain the actual A probe/launch, B probe/launch and one B bootstrap; failure contains only both financial pairs. Both prepared sidecars are measured independently, including failure. Evidence pins are A 156660 bytes and B 142877 bytes; sidecars are 1296 bytes each. Framed requests range 40697–42287 bytes, context frames are 548/980 bytes and parsed response JSON sizes 938/3242/56563 bytes. Construction times are approximately 18.731/19.032/16.278 seconds for primary/fresh/failure. Private no-replace outputs, canonical task-specific directories, symlink rejection and allowlisted projections avoid retaining private payloads or credentials.

Raw response wire bytes and individual nested sizes/timings are explicitly unobserved. The unchanged transport's strict greater-than 10MiB framing/output checks, registry's greater-than-or-equal canonical-byte rejection, 120000ms outer and 5000ms nested limits are retained separately from these measurements. Complete real reports under unchanged enforcement support compliance; no direct nested-measurement claim is made.

Retained failure provenance is reviewable. The exact fixture and integration source copies for both `run-jysXgF3V` (initial typecheck failure) and `run-Vo0pe8oi` (2/4 integration failure) match their contemporaneous pre-run hash/length entries. The last failing integration source differs from final source solely in `/payload/amount_minor` becoming `/amount_minor`. The unchanged B mapping in `apps/control/src/demo-candidates.ts:37` establishes the payload-relative path. This is a corrected qualification assertion, not weakened financial coverage or changed producer truth. Initial compile-related repairs and safe diagnostic wrapping are also visible in retained source comparison. No unchanged-producer rejection was found or credited as a pass.

The 1059-line addition exceeds rough design estimates, but those were expressly not quotas. The factory is limited to resource ownership, public-proof adaptation, scenario literals and qualification. The larger independent suite supplies distinct source/proof/CSV/isolation/lifecycle/evidence assertions and reuses accepted evidence/measurement helpers. There is no second prepare/activate chain, shared economic expected-result generator, count/transport mode or generic fixture framework warranting a size finding.

## Findings and limits

- **Critical:** none.
- **Important:** none.
- **Minor:** none.

Outside-source reads were restricted to concrete risks: unchanged author sequencing and true financial issuance (`activation-proof.ts`); B-only grants, authenticated approval and listener-failure ownership (`sync-selection-reviewer.ts`); honest measurement/private inventory behavior (`sync-selection-evidence.ts`); original CSV parsing (`company-b.ts`); exact namespace drop behavior (`native-db.ts`); the repaired lineage path (`demo-candidates.ts`); and actual cap/deadline comparisons (evaluator transport/runner/registry seams). Applicable test guidance and the named design/brief/preflight were also read.

No source, Git, database, service or test mutation/run occurred during this review. Only this temporary report was written. Original generated roots were already removed; original-byte assertions and runtime cleanup are assessed from the inspected code and hash-verified contemporaneous artifacts, not an independent post-cleanup database reconstruction. Existing helper acceptance and root release facts remain coordinator-supplied. Final combined fixture review and joint acceptance remain distinct, pending gates.
