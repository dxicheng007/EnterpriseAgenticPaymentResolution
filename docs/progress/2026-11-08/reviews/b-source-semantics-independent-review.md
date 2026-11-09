# AS exact-candidate independent review

Verdict: **reviewed — no actionable defects found within the assigned AS scope.** Specification and code-quality review pass. Verification is partial; joint acceptance remains pending.

Reviewer: `/root/astra_source_semantics_verify`, independent of the implementer and supervising root. Candidate worktree: `/Users/devincheng/.codex/worktrees/acquisition-sources/EnterpriseAgenticPaymentResolution`. Exact HEAD: `b3af86b00057e3236d478c6cb038c992be4e9236`; base: `5ce860b4a74d8db13c96c27a2af8bd5164527625`. The candidate was clean before inspection and after focused execution. No candidate source edits or commits were made.

## Authority and scope

Reviewed repository, apps, packages, and tests AGENTS guidance; PRD product thesis, process boundaries and acceptance criteria; implementation verification conventions and shared ownership; freeze F1/F4/F5, additive activation authority freeze and proposal §7; joint verification playbook; accepted `briefs/b-source-semantics-handoff.md`; and builder `briefs/b-source-semantics-report.md`. Root explicitly expanded the reservation to the minimal `server.ts` router correction. The diff contains the seven originally reserved paths plus that shared server path; no default composition, worker, SQL, contract or protected evaluator edits.

## Findings and reasoning

No requested changes.

- `packages/sources/src/current-semantics.ts` resolves a unique source registration, detaches its trusted definition for the call, and performs manifest, bound/high-water, and post-watermark reads through one transaction client after the existing `lockSource`. Numeric PostgreSQL epoch ordering selects the latest published manifest regardless of capture completeness. Shared schemas, manifest hash, row identity, source/company, stream membership and resource/schema contracts are checked. Missing/corrupt observations fail closed rather than selecting an older capture.
- Watermarks are safe numeric cursors and bind the publication boundary to an existing member event ID. Subsequent rows must span the entire contiguous numeric range and match the validated envelope, identity and content hash. The baseline map is copied rather than reconstructed from historical events. Only semantic changes update it; scoped seller/account keys stay distinct, governing `*` persists across scoped updates, opaque revisions follow stream sequence, and conflicting final revisions across independent streams fail with `SOURCE_SEMANTICS_UNSUPPORTED_ORDER`. Matching independent results and disjoint keys need no invented total ordering.
- `source-semantics-composition.ts` validates a nonempty bounded bearer and duplicate-free fixed source list, copies the allowlist and credential bytes, compares bounded bearer bytes with `timingSafeEqual`, and checks source authorization before catalog/database lookup. The direct control port independently performs fresh observations with the same allowlist. No credential is returned by the composition.
- `routes/source-semantics.ts` exposes only GET, disables implicit HEAD, rejects query/body options, authenticates before lookup, and returns strict sanitized no-store errors. `server.ts` aligns router parameter length with the existing 160-character ID contract and handles malformed private route paths before feature hooks. The private error mapping requires the plugin to be mounted. Generic framework errors retain existing status/code/shape with a sanitized message. Inspection of installed Fastify handlers supports this compatibility assessment.
- The producer has no persistent write calls, evidence accesses, model calls, activity publication, or runtime database dependency. The transaction finishes before the HTTP result is sent. Existing service methods and exports are preserved. Default startup remains deliberately unmounted.

## Verification evidence

Inspected all changed implementation and test files plus the existing source validation, publication, insertion, transaction, schema and framework dependencies. Builder reports 337 unit cases, typecheck, and 24 PostgreSQL cases across four files passing on this candidate; those broader results were reviewed, not independently rerun.

Independently ran:

```sh
npm run test:integration -- tests/integration/source-semantics.test.ts -t 'observes wholly|serializes before|routes the full|sanitizes malformed'
```

Result: exit 0; **4 passed, 8 intentionally filtered/skipped**. These four exercise real publication in both lock orders, real A/B scenario appends in both lock orders with publication watermarks, actual HTTP authentication and observations for 101/160-character references, and malformed/overlong private-route responses plus the unrelated malformed-route regression. Blocking is witnessed through PostgreSQL lock state, not elapsed sleeps. Tests invoke the actual composition and producer against application-role PostgreSQL connections.

The first sandboxed attempt failed before running tests because Vite could not write its temporary configuration in the separate candidate worktree. The same scoped command succeeded with approved execution access. Environment: Node 24 and PostgreSQL 18 on PATH; isolated PostgreSQL 55434, control 3201, worker 3202, web-origin 5175; test prefixes `eapr_test_review_t1`, demo namespace `eapr_review_t1`. `npm run db:down` subsequently passed and released the reviewer cluster. Final `git diff --check BASE HEAD` passed; `git status --porcelain` was empty and HEAD remained exact.

## Limits and integration obligations

This is acceptance of the standalone source producer/private plugin prerequisite, not a full slice machine gate or joint user acceptance. Eight AS cases were intentionally outside the independent focused rerun; their implementation and assertions were inspected, and their execution evidence is the builder report. No browser, live-model, financial correctness, activation or synchronization claim follows.

A4/A5 still own explicit default mounting and secret installation, independent consumer reads, strict response/source binding, equality against selected profile and baseline revisions, governing/missing-key failure behavior, and exact successful-receipt recovery during outages. No source observation grants approval authority or cross-database atomicity. Review applies only to the exact candidate above; any repair or integration change requires its own appropriate review/checks.
