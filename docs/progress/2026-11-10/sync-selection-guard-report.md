# Task 2 implementation report

Base `cb05937b350c0230840e1f06420855ef86d13431`. Candidate `a2a18b8fee655cdac65bcf86e7472c44576f01b5` on `codex/platform-sync-selection`. Commit subject `feat: guard captured payloads before sync routing`.

## Scope and behavior

The commit creates `apps/worker/src/sync/selection.ts` and `apps/worker/test/sync-selection.test.ts`. The guard consumes the frozen one-argument `ContractCheck[]` interface with the exact five Task 2 DTOs. It deduplicates verified source-delivery/binding pairs and unions exact consumers. It orders pairs by inbox order, source, and canonical binding and orders consumers by canonical committed identity with artifact hash as a stable tie breaker. Distinct approved contract hashes remain separate.

The envelope check retains only the declared expected values and their fixed field order. The payload check delegates to `@eapr/compiler/operations` for every reached, unique envelope-valid pair. `SOURCE_SCHEMA` retains the actual compiler path and marks only the affected consumers. The four fail-fast money/date codes preserve their exact diagnostics on an incomplete result. A missing or unexpectedly throwing seam leaves null diagnostics. The result preserves the fitting sorted prefix through the first unexamined observation. The guard does not infer account scope, authority, enrollment, or acknowledgments from a payload.

The byte accounting ruling counts the UTF-8 bytes of each canonical observation once, excluding array punctuation as a separate canonical value. Task 2 enforces 8,000 unique observations, 1 MiB per canonical observation, and 16 MiB in standalone diagnostic bytes. Count overflow stops before emitting observations. Diagnostic-byte overflow retains only the fitting sorted prefix. Task 8 must add these costs to the reader's admitted canonical bytes and return incomplete with zero proposals and the fitting diagnostic prefix on combined overflow.

## Focused machine evidence

Run from the isolated integration worktree with Node 24 on PATH.

| Check | Result | Raw output |
| --- | --- | --- |
| RED `npm run test:unit -- apps/worker/test/sync-selection.test.ts -t 'guard_'` | Exit 1, 26 behavioral assertion failures after compilable scaffolding. The known renamed case expected `SOURCE_SCHEMA` at `/payload` and both consumers but received empty observations and consumers. Unknown renamed/missing cases and bound/incomplete branches also failed assertions. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-2-red.log` |
| GREEN `npm run test:unit -- apps/worker/test/sync-selection.test.ts -t 'guard_'` | Exit 0, 26 passed in one file. Includes real validator drift cases, valid unknown, independent contracts, exact envelope fields, genuine first diagnostics, mocked exceptional seam, deduplication, byte limits and input immutability. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-2-guard.log` |
| `npm run test:unit -- packages/compiler/test` | Exit 0, 53 passed in five files, including the existing frozen 180-case planner comparison. The worker unit additionally compared canonical ordinary planner and classifier results before and after guard calls. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-2-compiler.log` |
| `npm run typecheck` | Exit 0. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-2-typecheck.log` |
| `git diff --cached --check` | Exit 0 before committing the two reserved paths. | Verified during commit |

## Self-review and handoff

The implementation uses the unchanged compiler payload validator and reuses the accepted event-reference and inbox-order helpers. It carries immutable reference fields, expected envelope values and actual allowed diagnostics. It neither copies a raw payload value nor incorporates exception prose. Existing planner and classifier source, fixtures, integration tests, authority and writers are outside the commit. The unrelated untracked `docs/superpowers/plans/2026-11-10-sync-selection-variants.md` remained outside the candidate.

Inactive and acknowledged test rows are deliberately pure inputs. The tests prove that supplied rows are checked. Task 3 owns the real applicability join and Task 9 owns the genuine persisted fixture evidence. No database, provider, demo, full slice gate, independent review or joint acceptance was executed for this task. The two source paths and sole source lease are released to root for exact-candidate review.
