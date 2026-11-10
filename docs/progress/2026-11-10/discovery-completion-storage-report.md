# Task 2 Discovery completion storage

Status **DONE**, ready for fresh independent exact-candidate review. Both the sole source-writing permit and the exclusive serial PostgreSQL lease are released with this report. Existing local cluster left running on its assigned port. The tests provisioned and dropped their own isolated pairs.

- Base and parent `82cbf099e46ed8a42505c933e7a9fe2a5547f705`.
- Candidate `7ee4114b2754f3b624cd3e85079fb41811268f2c` on `codex/platform-discovery-producers`, subject `feat: add discovery completion control storage`.
- Commit adds only `db/control/010_discovery_completion.sql` and `tests/integration/discovery-completion-storage.test.ts`. Tracked worktree clean after commit. `git diff --cached --check` passed for both files before commit, and the diff of control001–009 and runtime against the base was empty.
- Control010 is a byte-for-byte copy of the 53 SQL lines in the accepted design, whose document SHA-256 is `b8e32ebad1c0a53aefa18ebda1e4fb6bc385c24d9d1e517f3960553d0c3acf98`. Control010 SHA-256 is `105774fbb6904ed34d116151a2f93edc3157034b581baca441093e25cace91f3`. Root reconfirmed the reservation across 124 refs before release. I also scanned the local ref tips immediately before writing and found no control010. The local directory ended at control009 and runtime006.

## Machine verification

Node v24.22.2, PostgreSQL 18.6, assigned port 55441 and prefix `eapr_test_review_t2`. Both service roles and all product fixtures used the standard isolated-pair provisioner. The tests validated `current_user` against the assigned control app role. The migrator applied the migration and performed isolated read-only runtime catalog/ledger inspection. The existing migration-prerequisites test also ran on this lease.

1. **Meaningful red.** With the new test present and 010 absent, `npm run test:integration -- tests/integration/discovery-completion-storage.test.ts` exited 1 with two intended failures. The populated 009 control accepted its seed and pre010 denial assertions, then the expected post-migration completion update hit `discovery_runs_status_check` (23514). The role proof reached its first app INSERT and hit the missing `discovery_investigation_requests` relation (42P01). Both tests executed against real PostgreSQL.
2. **Green on committed contents.** `npm run test:integration -- tests/integration/discovery-completion-storage.test.ts tests/integration/migration-prerequisites.test.ts` exited 0 with 2 files and 5 tests passed. `npm run typecheck` exited 0. These are focused checks. The first post-SQL run exposed an assertion error in the test's catalog count. PostgreSQL 18 reports the 13 NOT NULL constraints in addition to the 14 CHECK, key and FK constraints. The test now checks those kinds explicitly. The migration itself was unchanged. I tightened the final grant proof to compare all effective column-only SELECT/INSERT/UPDATE/REFERENCES grants across the two schemas, then reran both prescribed checks.
3. **Fresh, upgrade and repeat.** Fresh 001–010 and populated 009→010 have equal schema and effective app grants. The migration adds exactly the three request tables, the named lookup index and six implicit key indexes. The original run CHECK is replaced. Existing control columns, other constraints and indexes, routines and noninternal triggers remain unchanged. The populated upgrade preserves seeded Discovery rows, blocker origin, control activity row/counter and prior ledger entries including applied_at. Reapplying 010 with app-written request data leaves the sampled rows, counter, ledger, schema and grants identical. The ledger contains 010 exactly once with its raw-file SHA-256. Provisioned runtime public schema stays empty and the runtime migration ledger stays absent.
4. **Allowed app SQL.** Pre010 completed update fails 23514 and the two repair updates fail 42501 against existing rows. Post010 the same updates succeed. The app can use all six run statuses and both repair counters at 0, 1 and 2. App SELECT and INSERT succeed for each new table. Source-wide and raw tuple requests work, including two requests for the same tuple and an 8,192-byte multibyte question. The app stores a reference to non-head finding revision 1, and links one same-run delegation step and child. A SELECT derives pending versus delegated through the association. The committed rows survive closing the original pool and opening a new pool.
5. **Denied app SQL and exact effective grants.** The two new column-only grants are UPDATE on investigation repair_count and task repair_round. The three new tables have SELECT and INSERT only. Table-wide UPDATE stays false. Every new content/key column is individually tested via an UPDATE on populated tables, and DELETE/TRUNCATE are denied on all three. Existing investigation identity/subject and task identity/role/grants updates, plus finding-blocker UPDATE/DELETE, fail 42501. The fixture inserts an existing blocker as the app role, demonstrating retained INSERT. App CREATE/ALTER/DROP and both actual cross-database connection attempts fail 42501. Savepoint-isolated probes distinguish invalid status, counter bounds, question limits and partial tuples (23514), missing/wrong-run/wrong-task/exact-revision references (23503), and duplicate request/link/consumption/step/child keys (23505). Reports include no credentials or URLs.

## Immutable control pins

Each literal is independently checked against repository bytes, the loaded catalog and the database ledger through009 before/after upgrade.

| File | SHA-256 |
| --- | --- |
| `001_base.sql` | `b2f5e5ce3a689ecb1ccef3c51dd90db6485fffe33bcdffec6d94d2984f11284f` |
| `002_sources.sql` | `3b8df852acf97a5fde560eb53329e974bd6f7914e531da2081117fd44a033fed` |
| `003_artifacts.sql` | `2c996c8f7b87581f303762bdbef80abb6137d293c0d686268776b5d57b98a22c` |
| `004_discovery.sql` | `5cbfbc573a337414d3e544aa3e70ceac4313db5dc08ff163d6012f6d433546fb` |
| `005_bootstrap_verification.sql` | `ce373f832bd5cce6f77386411de423876a043807fee4a3763a9c8396e6188b31` |
| `006_financial_provenance.sql` | `a01d43772e40e3c1a8d29425707fe5109d2a0db06c2adbfa5e04bebeee692e45` |
| `007_discovery_construction.sql` | `f9c0883a6da0e5ae25c04c8fe566682c72e2acfcc9f22a88e2e0105a83b9f35b` |
| `008_review_activation_intents.sql` | `956127c4414c86ab5ffe4bd630cabd333662fb61688af540a8b19184b97b0a54` |
| `009_discovery_verification_requests.sql` | `5080b0c7cec1c0a6eb366aa650f01e87d50183d5de3fa490691bf0f8085c1ab0` |

Storage capabilities are ready for review. Discovery consumer ownership remains separate, including capture/current authority, role and tool enforcement, fencing and locking, request limits and consumption, repair execution and diagnostic selection, atomic completion and consumer race/replay proof. No mounts, runtime migration, model/provider calls, financial scope changes, protected truth, saved pins or joint acceptance were part of this checkpoint.
