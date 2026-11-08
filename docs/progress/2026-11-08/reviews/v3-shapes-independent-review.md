# Independent pre-T3 contracts review

Verdict: **PASS for this contract patch only.** No actionable correctness or specification findings. This accepts the executable shapes/hash changes at exact candidate `b172632e176c2da56e922f6aa8acdde3442b227d` against base `12b1b2b3b1924c2bbef7be64998e8c4178c3c1a1`. It does not accept T3 implementation, V3 activation, runtime consumers, or joint user acceptance.

Reviewed the detached, tracked-clean checkout `/Users/devincheng/.codex/worktrees/acquisition-review/EnterpriseAgenticPaymentResolution`. Read root/package guidance, the assigned patch brief, accepted architecture proposal and fix review, original F1/F3/F5/F8 and authority deferral, shared ParentView definition, implementation report, all seven changed files, and evaluator subject-runner/comparison. Recomputed proposal SHA-256: `2d47fa05c82c5a8f04096fa22dd4e4025620a5f2d7e35ccb35bd9a568879380a`, matching the approval.

## Evidence and assessment

- `packages/contracts/src/connector.ts:88–118`: optional strict bootstrap preserves old profiles; customer identity and exact term coverage are enforced, with unique term/configuration IDs, nonempty exact name and unique nonempty evidence. Uses common validators, with no runtime import cycle.
- `packages/contracts/src/canonical.ts:55–74`: both profile and bundle hashing use the same canonical profile helper. Omitted/undefined bootstrap adds no serialized property. Bootstrap evidence and bindings are canonical sets with duplicate rejection; names remain exact. Existing artifact and target hash preimages are untouched. `hashReviewPackage` at line 112 strips only its own hash and preserves diagnostic order.
- `packages/contracts/src/runtime.ts:9–20`: authority uses literal limits, existing strict safe scalar/set rules and no invented nonempty vector/kind policy. Manifest/artifact/scope equality remains explicitly a consumer obligation rather than a shape-validation claim.
- `packages/contracts/src/runtime.ts:58–94`: query supplies no clock/default; parent envelope scope/version bind to records while effective evaluation time remains distinct from recorded snapshot time. Legacy references form an exact financial-record bijection across invoices, payments, credits, allocations and reversals; duplicate target IDs reject. Existing parent wire constraints remain unchanged.
- `docs/superpowers/plans/2026-11-08-contract-freeze-v2-activation-shapes.md`: accurately carries forward read-only GET/preview and immutable recorded snapshots; authenticated exact successful retry before freshness; original durable bundle/receipt recovery; different-key active rejection and existing-connection read; null-aware preparation CAS and atomic reviewer grant; full-plan and metadata-lineage equality; semantic stream discovery without guessed ordering/TTL; and the unresolved independently executed bootstrap assertions. It expressly keeps readiness false/activation blocked until that separate prerequisite is satisfied. No V3-enabled claim or permissive missing-port export was introduced.

## Independently executed checks

Node 24 used from `/opt/homebrew/opt/node@24/bin`.

1. `npm run test:unit -- packages/contracts/test --cache=false`: **exit 0**, four files, **23 tests passed**. Initial sandbox attempt could not write Vite's temporary config under review `node_modules`; authorized cache-write escalation completed successfully.
2. Independent inline Node/tsx probe: **exit 0**. Added a structurally valid reversal to the development snapshot; complete references parsed, omission and event mismatch rejected. All three forbidden JSON keys rejected in parent query. Metadata changed the profile hash and preserved leading/trailing name spaces.
3. `git diff --check 12b1b2b b172632`: **exit 0**. Review checkout tracked status remained clean after checks.
4. `npm run typecheck` in review checkout: **exit 1**, missing `@eapr/evaluator/registry` and `/verify` resolution plus resulting implicit-any diagnostic in unchanged integration code. Confirmed review `node_modules/@eapr/evaluator` is absent while tracked evaluator package declares those exports. This is a review environment limitation; the implementation report separately records its successful workspace typecheck. I did not repair dependencies or claim an independent full typecheck pass.
5. Additional existing-profile/artifact hash probe in root checkout `09104d49481d285e71d9162e674824045ae27427` reproduced the four pinned A/B profile/artifact literals. This is supplementary compatibility evidence, not execution at original base. Exact candidate tests also passed the five pinned old literals including the representative bundle. The absent-bootstrap preimage identity was independently audited against the base diff.

## Limits

No DB, browser, live, financial slice, activation/import, SQL race, endpoint no-write, or user acceptance tests were run. No source edits, commits, or subagents. Focused schema/hash verification cannot prove citation truth, authority, runtime balance correctness, externally bound hashes, or concurrency. Separate bootstrap result/binding freeze, independent protected assertions, assigned consumer implementation and exact-candidate verification remain required before activation; ConnectionState remains deferred.
