# Independent scoped pin-isolation review

Verdict: **ADDRESSED**. No blocking correctness or quality findings in the scoped repair.

Reviewed detached candidate `873a18f81e68f6ff572d674fe9a0c4d23f7f0b3b` against `43d464da48e83674bc752642095e0ea95474131e` in `/Users/devincheng/.codex/worktrees/acquisition-review/EnterpriseAgenticPaymentResolution`. Only `tests/integration/v2-verification.test.ts` changed. Read the exact repair brief and builder report appendix, inspected the complete diff and relevant store, harness, verification plugin and job-drain implementation. No product changes, review helpers, commits or pushes made.

## Fix and ownership assessment

The generated scenario creates one random UUID per invocation, and A/B copy only fixtureSetId plus the recomputed canonical hash. Copy construction retains fixtureSetVersion and all remaining facts; decodeTruth revalidates it, and canonical comparisons check the complete remaining facts. Original decoded metadata and copied metadata remain separately available in memory; the adjacent comment explicitly attributes the original tuple to the generator and the change to test-run isolation. Original expected-a/b files are only read, and their bytes are hash-checked afterward. Capture manifest, snapshot, capturedAt and events are passed through unchanged. Both captureFacts/case planning and the actual protected evaluator launcher consistently use the copied fixture/pin. Existing generated B-zero, F8 and changed-candidate report assertions remain intact.

The new pin helper derives the exact path using the same ID/version hash as the production store. lstat refuses an existing prospective path (including a dangling symlink); non-ENOENT failures propagate. It adds that path to the ownership Set only after successful pinning. Cleanup unlinks only those Set entries, without globs, root removal or original producer IDs. system.close precedes cleanup; the verification plugin's onClose drains pending evaluator jobs, and startup failures are closed by the harness before propagating. The other default-root pin in this file already uses an independent public-http UUID rather than a deterministic/shared producer identity.

The isolated-root regression executes the actual immutable store: changed capturedAt conflicts at the original tuple, two namespaced copies coexist, the prior prospective-ID pin is rejected without ownership, and both preexisting sentinel hashes remain unchanged after exact owned-path cleanup. This provides a meaningful regression rather than weakening the store or accepting an idempotent preexisting fixture as test-owned. The helper is scoped to fresh private UUIDs; it is not a general atomic reservation API for independently coordinated writers sharing an ID.

## Fresh verification

Used Node 24 and PostgreSQL 18 binaries from `/opt/homebrew/opt`, exclusive PG 55433/control 3101/worker 3102, reserved web 5174, and supported prefix `eapr_test_review_t2`.

- `npm run test:integration -- tests/integration/v2-verification.test.ts`: passed 3/3, 11.00 seconds.
- Repeated the same command in the same checkout without clearing pins or PostgreSQL data: passed 3/3, 10.54 seconds.
- `npm run typecheck`: exit 0.
- `git diff 43d464d 873a18f --check`: exit 0.
- Protected-file path/SHA-256 inventories before and after both runs were equal (zero initial and zero final files). Therefore no claim is made that this checkout contained real application pins; nonempty sentinel preservation is independently exercised by the passing isolated-root regression.
- Git working tree remained clean. The review PostgreSQL instance was initially stopped, was started by these tests, and was stopped afterward with `npm run db:down` (exit 0). Data and protected directory were preserved; control/worker instances close through the harness.

Builder's pre-fix red is recorded in the appendix and is corroborated by the fresh regression's required original-ID conflict. I did not rerun the parent revision. Next-five verification checks, product functionality and normal supervisor startup are outside this scoped verdict.
