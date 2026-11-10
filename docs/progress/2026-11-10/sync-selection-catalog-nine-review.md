# C1 fresh exact-candidate review

Specification verdict: **PASS for C1**. Quality verdict: **PASS for C1**. No Critical, Important, or Minor findings requiring changes were found. This accepts the bounded nine-A fixture prerequisite only; C2 and the combined six-task/two-plan final fixture gate remain pending.

## Candidate and review basis

Worktree: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

Supplied base: `2748064d8080add5bb95bf010aedf56ffcc2cf5a`; candidate: `0deb7ab38c896618bd402d8185369bb3eeb04df6`.

The review package contains exactly two new files and 1,069 additions. I read its diff once in six bounded chunks; I did not separately reread either changed file for review. Reconstructed added bytes match the current files exactly:

| File | Lines | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `tests/fixtures/sync-selection-catalog-nine.ts` | 341 | 21,909 | `375fc3052e4cfdd099783d1e2af6c7d6c10bae67b0183e64c056ec4311eb8144` |
| `tests/integration/sync-selection-catalog-nine-fixture.test.ts` | 728 | 44,873 | `3aac41dc71db0734cb18f195bcf527f7b49b323b05446c03e980d7044b8f7bef` |

Verified reference hashes:

- Brief: `eb2e98b5c67cc173f4f2d857d088feb8e7655a46998b0f0b31ea561bb7010b21`.
- Preflight, including concrete evidence-helper reuse addendum: `fcb443d52440901cfc08174e922e7a0bce7055130d78c3c7880243b7388c14a7`.
- Normative design: `17ce1b1d1c5d9e0c155a70e3da6a916132f0ac22ecda1a1b8e55f9efeab6e49c`.
- Accepted plan: `51bdb43293e0d7a0745d0874798ac09ba10bb72cd7469d715d6f118b7d024260`.
- Handoff report: `1953e37b44d60ea4f11741eacb6406705ed8f398fc58635aadc2dc54d2c2b33c`.
- Review diff: `7d04c029c54574122dcdb08ef0e31077fb6096223ca1e8d4cd6a720c5e84fb9a`.

Read the brief's Global Constraints, complete C1 preflight, relevant normative design sections (including C0/public interface, evidence/cleanup, handoff and size constraints), historical architecture review and accepted measurement clarification, and tests guide. Concrete outside-diff reads were limited to enrollment/reviewer proof and cleanup delegation, the shared evidence helper's safety/measurement behavior, and runtime migration table declarations to check durable-snapshot completeness.

## Specification assessment and anchors

**Fixed independent authorship:** `sync-selection-catalog-nine.ts` — `accounts`, `authorOriginals`. The fixed 01–09 table gives nine genuine buyers, accounts, documents and contracts. Each PDF has the five prescribed lines and its own supported identity/term. Raw `3000.00` and expected 300000 cents are independently authored. Version-1 records/documents, exact September dates, cutover, manifest/seed/policy IDs, six schemas, per-account semantic versions and 9/0 stream membership match the design. Truth and producer inputs are sorted and decoded before publication. Private no-replace writes produce exactly 24 originals. Generator provenance includes actual author, enrollment, reviewer, capture helper, canonical fixture, company-A and lockfile bytes. No cardinality option, shared economic oracle or producer modification was introduced.

**Nine genuine proofs and approvals:** same file — `createSyncSelectionCatalogNineFixture`, financial proof loop, approval loop, `assertLiteralImport`. The factory captures and pins once, resolves each actual agreement/citation, compiles/registers nine distinct one-profile candidates and proves them serially. Its full financial checks run before the single nine-entry reviewer installation. Each separate fixed approval first checks the next scope's import, target and origins absent. The factory immediately checks full literal target, receipt and initial origin, stops listeners, checks nine imports and no capture enrollment, and checks original hashes before returning only the ordered tuple, runtime application pool and close.

Concrete reuse is real: `sync-selection-enrollment.ts` delegates to `openInstalledSelectionReviewer`; `sync-selection-reviewer.ts` retains the authenticated session, prepare/activate, committed intent, worker A5 and stored readback chain. Neither new file contains a second approval implementation. The reviewer validates installed exact proofs and scope grants and checks selected bootstrap results. No fake approvals, fabricated import SQL, cloned bundles, source modes or production edits appear.

**Independent qualification:** `sync-selection-catalog-nine-fixture.test.ts` — `inspectCapture`, `financialMatrix`, `inspectInstalledProofs`, `targetLiteral`, `qualifyProofs`, `readDurable`. Independent literal expectations check the entire own target and metadata, 0→300000 receipt and own origin. Every financial check occurs exactly once, passed with positive case counts, with complete profile/source/five-kind coverage and exact report/reservation/attestation/build/capture bindings. The installed policy and real registry are read at the actual composition seam. All ten bootstrap cases and nine assertions, canonical assertion membership, current builds, selected sidecar, binding, result and plan hashes are checked. Bundle membership remains all nine events while the selected plan admits only its own invoice and metadata. All eight required selecting-identity columns have nine distinct values.

**Inventory and durable reads:** same suite — `qualifyInventory`, `stateDigest`, `readDurable`, `emptyTables`, `durableTables`. The literal scalar source query uses `legacy-a`, account ordering and `LIMIT 9`, then independently counts the entire import table and initial origins. Every capture/ongoing-sync/explicit-authority table is required empty. The durability snapshot covers all runtime tables declared by the current migrations, including activity, parent, import, lineage, initial outcomes and origins. PostgreSQL JSON-text rows avoid JavaScript Date canonicalization and preserve complete stable ordered row contents for before/after hashing around the actual nine target/activation/receipt/origin reads. This does not claim selector/index/sentinel acceptance.

**Inputs, observers and owned cleanup:** same suite — `evidenceDirectory`, `sourceInventory`, capture/resource/evaluator/composition spies, `closeSuccess`, `cleanupEvidence`, `fallback`, and four named tests. The suite reuses the accepted evidence primitives and outer measurement adapters (helper hash `6423c8e42ea06fa07511aa711a1b458fe8a992ef04ce3b38f75c30d2e9a18693`). Destination validation stays catalog-local and rejects symlinks/escapes; output is private/no-replace. Expected inventories and resource ownership remain scenario-local. The sentinel is thrown only after real composition, nine registered complete financial proofs and a listening parent-read worker. Cleanup checks awaited worker closure, both application-pool ends, own namespace drop and root absence; fresh and failure remain disjoint and primary remains available. Primary close is tested twice against the same cleanup promise. Fallbacks attempt still-owned actions and observers are restored in finally. No protected values, payloads or connection credentials appear in retained proof/inventory/measurement fields inspected.

## Quality assessment

The 341-line factory falls within the 300–380 estimate. The 728-line suite exceeds the 230–320 estimate substantially; these estimates are explicitly not quotas. Its added size consists of independent full proof/literal assertions, complete input/source/durable inventories, safe call-through measurements and resource-lifecycle qualification. It uses the requested shared observer and reviewer implementations, leaves financial expectations visible and separate, and introduces no generalized fixture framework. I found no actionable maintainability or correctness issue that warrants weakening those checks or extracting a shared oracle.

Critical: none. Important: none. Minor: none.

## Recorded evidence verification

All **50** artifact rows in the handoff match their actual SHA-256 and byte length. Final `source-pre-run.json` and `source-after.json` are identical; all **115** unique current source inventory entries match. Independently enumerating the required source roots found no omitted or unexpected paths. Baseline-to-pre-run changes are exactly the two additions. Explicit absences include both C2 files and the absent saved bootstrap/policy roots; existing protected/source/migration files match their recorded hashes.

`run-fxtQxB/integration.log` and `integration.exit` record one file, four passed tests, exit 0 and 245.07 seconds, with the exact scoped command and 300000-ms test/hook ceilings. The exact suite contains only the four required named tests. The retained typecheck log contains the expected `tsc --noEmit` command and no diagnostics; exit 0 is recorded in the handoff (there is no separate typecheck exit artifact). Tool versions record Node v24.22.2 and PostgreSQL 18.6.

Primary and fresh each retain nine reports with 13 passed positive-count checks and nine selected bootstrap results with 10 cases/9 assertions. Each selecting identity dimension has cardinality nine. Their pre-publication, post-proof/import and pre-cleanup original inventories are identical: 24 files, 57,029 bytes. Failure retains equal pre-publication/pre-cleanup originals, nine financial proof pairs and nine sidecar observations, with zero bootstrap invocations. All three cleanup records report their distinct namespace dropped, root absent, listener stopped, worker close completed and both pools ended.

Actual construction times: primary 88,366.7 ms; fresh 88,352.0 ms; failure 66,956.2 ms. Observed calls total 27 probes, 27 financial launches and 18 selected bootstrap invocations. Request JSON ranges are 21,812–21,814 / 22,727–22,729 / 22,307–22,309 bytes respectively; framing adds one LF. Contexts are 560/560/988 bytes framed. Parsed successful response serialization is 917 / 3,214 / 15,141–15,143 bytes. Measured elapsed ranges agree with the handoff. These are outer serialized-object observations, not raw response-wire or nested-runner measurements. Unchanged enforcement plus complete genuine reports supplies the separately stated compliance evidence.

## Limitations and gate boundary

The initial `run-vYIwBb` is preserved: four tests executed, two passed/two failed, exit 1, with failures in durable inventory and fresh construction; its safe reproduction text is `Invalid canonical JSON object`. Its own pre/post source inventories match. Comparing initial and final inventories proves only the suite changed; the author and all other inventoried inputs stayed identical. No exact initial suite body or contemporaneous repair patch was present in the inspected C1 artifacts, so I do not independently certify the narrative that the only intermediate edit was the SQL JSON representation. The final implementation of that representation was directly reviewed. This narrow historical limitation does not invalidate the verified final exact-candidate run.

No Git commands, tests, database/service operations, source edits or subagents were used. Commit association is supplied by the review package; current content was verified by exact diff reconstruction and hashes, not by independently traversing Git history. The sole written artifact is this report. Passed checks were not rerun.

This review passes C1 specification and quality gates only. C2, the combined six-task/two-plan final fixture gate, catalog consumer/index acceptance, broader integration, live behavior, financial/slice acceptance and joint user acceptance remain separate and pending.
