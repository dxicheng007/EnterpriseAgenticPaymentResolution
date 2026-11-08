# Independent B verification startup review

Candidate: `aa2f6a1430da2db3ba882b1f4abe5af7dfacaf7a`, detached, clean tracked worktree. Reviewed B net diff against accepted evaluator dependency `43d464d`; evaluator implementation itself remains separately reviewed scope. Read repository/apps/scripts/tests instructions, the exact B dispatch brief, implementation report, all B implementation and tests, and relevant existing session, registry, launcher/store, route, supervisor and static-server boundaries.

**Disposition: no actionable B-owned spec or code-quality findings.** This is a bounded independent code review and focused verification, not full V2 acceptance or eligibility approval.

## Spec and boundary assessment

- Operator registration reads the actual stored manifest, complete dossier, aggregate snapshot and events. Strict UTF-8 private reads are bounded to 10 MiB, require regular files, reject final-component symlinks, and validate physical directory paths. It delegates truth/member/capture validation and immutable pinning to the accepted evaluator store. Errors are replaced with stable redacted setup codes.
- Safe pins have an exact eight-field schema. The selector rejects ambiguous pins and binds both captured companies, source, manifest identity/hash, snapshot identity/hash, artifact source and profile source/company. It returns only the four launcher selection fields. The actual launcher computes the evaluator build identity.
- Ordinary control imports registry/jobs/launcher rather than the operator helper or oracle. The subprocess import-hook regression confirms that boundary. Supervisor environment construction passes pins only to control, using the existing allowlist; worker/web receive no truth paths/configuration. Existing Vite denial includes `.local` and protected fixture paths.
- Composition checks the migration catalog and registry directory, injects the actual registry into preview, then mounts actual jobs with the same local reviewer session. Both companies must bind before availability becomes true. Setup failure leaves source/preview composition intact and omits job routes. Availability is not eligibility; real completed reports remain ineligible with mandatory checks unavailable.
- Verification POST uses the existing Origin/CSRF checks; GET uses read authorization. Task/service/Authorization headers remain excluded from the reviewer path. Preview must register the exact candidate first. Existing route close drains jobs before the supervisor closes its pool.
- Legacy files remain unchanged. Explicit upgrade requires an unused physical directory under `.local` outside reserved roots; regenerated manifests, originals, metadata and API members are compared with existing visible/captured data before pinning original snapshots. Immutable conflicts do not overwrite pins. Selection publishes only after both pins succeed, using a private temporary file and atomic rename, with previous bytes saved separately. Failed regeneration/conflict preserves selection and originals.
- B test isolation is correct: the HTTP test gives generated truth fresh random fixture IDs and cleans only its tracked test pin paths; the upgrade test copies module-relative operator/evaluator code into a disposable checkout with a separate default protected store. It does not reuse production fixture keys in the review checkout's protected store. The separately reported C-owned v2 test collision is not a B defect.

## Independently executed checks

Node 24/PostgreSQL 18; review checkout only; PostgreSQL 55436, control 3401, worker 3402, web environment 5177.

1. `npm run test:integration -- tests/integration/local-verification-startup.test.ts tests/integration/local-composition.test.ts`: **5/5 passed** (two files), with `EAPR_TEST_PREFIX=eapr_test_review_t2`. This executes real PostgreSQL, migrations, real evaluator/planner child jobs, both reviewer flows, auth failures, redacted missing-pin job failure, private file guards, idempotence/conflicts, disposable explicit upgrade/rollback/backup, source-state preservation, import boundary and pending-job drain/recomposition.
2. `npm run typecheck`: **passed**.
3. `npm run db:down` scoped to this checkout and port: **passed**. Subsequent `pg_ctl status -D .local/pgdata`: **no server running**. Harness closed its service listeners. Existing operator pins/data retained; no main-service command was issued.

Execution note: an initial identical 5/5 passing run used the mistaken variable `EAPR_TEST_NAMESPACE_PREFIX`, so the harness used its default disposable `eapr_test_v0` prefix in the same assigned review cluster. The harness cleaned those databases. The run above was repeated with the verified `EAPR_TEST_PREFIX` setting; there was no use of the main cluster.

No product edits, helpers, commits or pushes. No model calls, activation, or persisted parent writes. Did not rerun the known C-owned conflicting v2 test or claim a full integration pass. Builder supervisor/static/environment smoke evidence was inspected in its report and corroborated by source review, but was not independently repeated as a live browser smoke here. Joint user acceptance and missing mandatory evaluator/UI coverage remain pending.
