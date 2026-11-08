# Independent B captured-evidence assembly review

- Reviewer: fresh independent Astra agent `/root/astra_b_assembly_verify`, separate from builder and supervising lead.
- Reviewed SHA: `3dd6173dacc7d8d80d796a32ea946029f3adc2c8`.
- Base SHA: `09104d49481d285e71d9162e674824045ae27427` (accepted C1).
- Checkout: detached `acquisition-review/EnterpriseAgenticPaymentResolution`. Exact SHA confirmed before and after checks; tracked tree remained clean. No product or HEAD edits.
- Scope: all five changed files, relevant C1/source/store readers and schemas, B brief, evidence-v2 contract and sequencing addendum, repository/area guidance, and builder handoff.
- Spec compliance: **PASS / reviewed for the assigned B scope**.
- Code quality: **PASS / reviewed**.
- Findings: **none requiring changes**.
- Joint user acceptance: **pending**. This review does not grant acceptance of a later slice or composed B+C2 behavior.

## Basis for verdict

The helper obtains every aggregate citation and its original bytes through both scoped source-service APIs. Its separate SQL association query is constrained by evidence ID and aggregate snapshot ID, requires exactly one returned association, compares canonical persisted evidence, and checks file/API hashes and byte length. Document bindings check source/company, manifest membership, metadata, document version, and batch identity. API bindings use the actual `source_events.event_id`, compare the stored event to the captured event, and verify source/company/seller. The code does not infer event IDs by parsing source IDs or match payloads alone. CSV remains a document original. Authorization preserves unknown raw accounts while restricting source/company/seller.

Inputs are read from the selected physical private directory with bounded, no-follow, regular-file reads and strict UTF-8. Both companions are decoded as a pair. Only both-absent mode follows the unchanged schema-v1 path; a partial pair or malformed companion cannot downgrade. The latest taxonomy is implemented: read/UTF-8/JSON/producer-decoder failures are setup-required; successfully decoded cross-file bindings, capture/content discrepancies and immutable publication failures are conflicts. A valid self-hashed companion with a mismatched producer truth hash reaches the conflict path. Existing expected-only namespaced startup/browser usage remains legacy v1; schema-less reserved version 2 is rejected.

Both complete assembled bundles pass C1 validation before either v2 pin is published. The helper preserves returned texts, ranges, excerpts and bytes, requires dossier evidence membership to equal the aggregate, deduplicates identical originals, and resolves every producer support tuple inside its returned range using lexical citation order. It passes original producer truth and companion JSON through the frozen API and derives only the specified demo bindings. C1 owns version rebind, complete provenance/re-extraction/CSV validation, canonical hashes and immutable publication. There is no test-helper import in production scripts or new public contract/export surface.

Fresh-root upgrade requires companions, retains the existing visible fingerprint and captured-original checks, and writes the selection only after both pins succeed. The existing atomic selection/backup operation is preserved. A failed second publication leaves the successful immutable A pin unselected and preserves the old selection; immutable pins are not deleted by production recovery. Historical v1 pins and old private inputs stay unchanged. The focused suite verifies these transitions in a disposable module-relative checkout, including restart reuse and the selection backup.

The implementation is small and scoped: a private assembly helper and narrowly changed operator setup flow. It delegates the complete verifier to accepted C1 instead of implementing a competing schema or oracle. Safe script return metadata remains unchanged; no financial/runtime, source/generator, browser, evaluator assertion or public API behavior is added. Documentation accurately distinguishes v2 evidence availability from actual check coverage and explains immutable recovery limits.

## Independent checks

All runtime checks used Node 24/PostgreSQL 18 on PATH and the dedicated review lease, set before imports:

```sh
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH
export EAPR_PG_PORT=55433 EAPR_CONTROL_PORT=3101 EAPR_WORKER_PORT=3102 EAPR_WEB_PORT=5174 EAPR_TEST_PREFIX=eapr_test_review_t1
```

Commands ran from the detached review checkout:

1. `npm ci --offline` — exit 0, restored the known missing evaluator workspace symlink; no tracked dependency changes.
2. `npm run typecheck` — exit 0.
3. `npm run test:integration -- tests/integration/local-verification-startup.test.ts tests/integration/evidence-verification-setup.test.ts` — exit 0; **2 files, 4 tests passed**, 28.67 seconds. Includes actual A/B DB/service/store roundtrips, malformed/partial/oversized/symlink input rejection, wrong association and source-byte failures, v1 preservation, reserved version rejection, v2 idempotence/conflict, explicit upgrade/restart/backup, second-publication failure, safe metadata and control import-graph checks. The actual reviewer-job test deliberately uses expected-only v1 and reports `evidence_support` unavailable with zero cases.
4. Separate reviewer-authored probe, now preserved at main `.superpowers/sdd/2026-11-08-implementation-plan/briefs/b-assembly-independent-probe.mts` (original execution path below), executed using `node --import tsx /Users/devincheng/.codex/worktrees/acquisition-local-build/EnterpriseAgenticPaymentResolution/work/b-assembly-independent-probe.mts` — exit 0: `B_ASSEMBLY_INDEPENDENT_PROBE_PASSED rejection_cases=8 capture_roundtrips=2 repeat_idempotent=true`. It generated a unique-seed A/B dataset, ingested it through the accepted test-only real capture helper, then invoked the actual production B preparation. Invalid UTF-8, JSON null, JSON array and a directory at the companion path each returned setup-required. A valid self-hashed truth-hash mismatch, stale persisted PDF excerpt, missing dossier evidence membership, and wrong persisted API seller each returned conflict. Every rejection left both prospective v2 pins absent. Restoring the exact inputs produced two v2 protected-reader roundtrips preserving snapshots/events/citation membership; repetition preserved immutable bytes. Only this probe's unique DB namespace, temporary source roots and previously absent unique pin keys were cleaned.
5. `git diff --check 09104d49481d285e71d9162e674824045ae27427 3dd6173dacc7d8d80d796a32ea946029f3adc2c8` — exit 0. Final `git status --short` empty and HEAD unchanged.

No main PG55432 operation, live upgrade, credential output, private-truth output, historical pin cleanup, or source recapture was performed. The reviewer probe emits only safe assertion counts.

## Evidence limits

These are independent focused checks, not a full slice machine gate. The builder's full integration retry (12 files / 64 tests) and earlier 7000 ms reviewer-job timeout are recorded in the builder handoff; that retry is **builder evidence**, not an independently repeated full-suite result. The independent focused suite passed without a retry or deadline change.

C1 makes v2 input trustworthy and available; this candidate does not implement C2 assertions. No integrated B+C2 pass or thirteen-check eligibility claim follows from this review. Existing C3 expected-only browser evidence remains v1. After accepted B and C2 integration, the separate UI-owned actual-v2 A/B checkpoint remains required, as do joint user acceptance and all live/activation/synchronization/later-slice proof.
