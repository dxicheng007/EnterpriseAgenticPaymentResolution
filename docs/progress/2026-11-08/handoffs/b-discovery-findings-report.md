# C1 discovery findings implementation report

Candidate `84a5b0b6064ebce845a91905d0c8588690c3e9d8` on `codex/discovery-findings`. Exact base `f7e95d4748899b8bca091b7c2a7f41d58019c532`. The assigned `acquisition-verification-startup` worktree was clean after committing `feat: persist evidence-grounded discovery findings`.

Control migration `db/control/007_discovery_construction.sql` SHA-256 `f9c0883a6da0e5ae25c04c8fe566682c72e2acfcc9f22a88e2e0105a83b9f35b`. Migration 007 ran against the isolated disposable test databases. Existing migration bytes were preserved.

## Candidate paths

- `db/control/007_discovery_construction.sql`
- `packages/contracts/src/discovery-construction-tools.ts`
- `packages/contracts/test/discovery-construction-tools.test.ts`
- `packages/discovery/src/construction-evidence.ts`
- `packages/discovery/src/findings.ts`
- `packages/discovery/src/repository.ts`
- `packages/discovery/src/roles.ts`
- `packages/discovery/src/supervisor.ts`
- `packages/discovery/test/findings.test.ts`
- `packages/discovery/test/read-tools.test.ts`
- `tests/integration/v4-discovery-evidence-tools.test.ts`
- `tests/integration/v4-discovery-findings.test.ts`

Root released the two predecessor test paths solely to update their exact tool advertisement expectations. The unconfigured role assertions and D2 evidence behavior remain covered. The existing discovery composition read dependency supplies the port. New construction contracts are imported directly by discovery only. The candidate diff for the contracts root export and evaluator sources is empty. The protected bootstrap recursive import-closure test passed on the committed candidate.

## Behavior and decisions

- The closed dispatcher advertises finding tools only with capture and the source read adapter. Strict publication forces server-owned agent origin and pending disposition. The model's assertion of support stays in the immutable payload. An empty reference set is structurally allowed per root's clarification and carries no factual or financial authority.
- Publication binds the exact investigation subject and validates the direct and alternative references through the pinned source port. The bounded read probe proves citation access. Only validated event/citation associations from the matching seller/account can establish account applicability. Missing association creates a source-wide origin. Accepted uncertainty statuses create an origin at the task investigation. Origins retain their exact revision across positive later revisions.
- Ordered batch validation projects finding CAS, identity capacity and derivation edges against the persisted graph under the run lock. Derivation inputs and historical reads require existing exact revisions and the consuming task's scope over the exposed graph. Citation authorization relies on the publishing task's immutable source-read ceiling. A later exact read rechecks the capture. Exact terminal replay checks current authority before exposing saved content and performs zero evidence I/O.
- Publication, derivations, blocker origins, current pointer, tool result, task/run revisions and safe activity commit together on the lock-owning connection. The existing `finding.revised` activity carries only allowed identifiers, revision and diagnostic codes. Current finding refs are sorted in the same repeatable-read state snapshot.
- 007 also installs immutable proposal revision, exact consumed-finding and investigation edges, versioned assessment, guarded current link and compile-step storage. The immutable compile step binds the exact proposal revision and assessment by foreign key, so the referenced proposal hash and observed run revision are fixed by those rows. Its generation and source payload are immutable, with application-role column updates limited to state, registration and result. C2/C3 consumers and invalidation behavior require their own checkpoint review.

## Machine evidence

Node 24 and PostgreSQL 18 were on PATH. Integration used `EAPR_PG_PORT=55438 EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_DEMO_NAMESPACE=eapr_review_t2 EAPR_CONTROL_PORT=3601 EAPR_WORKER_PORT=3602 EAPR_WEB_PORT=5179`.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Exit 0 |
| `npm run test:unit -- packages/contracts/test/discovery-construction-tools.test.ts packages/discovery/test` | 4 files, 4 tests passed |
| `npm run test:unit` | 55 files, 341 tests passed |
| `npm run test:unit -- packages/evaluator/test/bootstrap-build.test.ts` | 1 file, 3 tests passed, including recursive runtime import closure |
| `npm run test:integration -- tests/integration/v4-discovery-findings.test.ts tests/integration/v4-discovery-evidence-tools.test.ts tests/integration/v4-lifecycle.test.ts tests/integration/v4-lifecycle-http.test.ts tests/integration/v4-activity-read.test.ts` | 5 files, 75 tests passed, including 22 C1 cases |
| `git diff --check` and `git diff --cached --check` | Exit 0 |

The pre-implementation contract test failed on absent publication schema. The preliminary PostgreSQL test failed on a pending step before wiring. That harness initially stopped at model acceptance and did not yet drive the persisted step, so its red result alone does not isolate the missing handler. The completed harness explicitly invokes the owner step executor. Intermediate predecessor suites failed only their exact five-tool integration and four-reader unit advertisement expectations, which root released for the two-name update. An intermediate account fixture had included the subject discriminator in a strict query tuple. The corrected fixture and final suite passed.

The PostgreSQL cases exercise historical revisions and exact replay, derivation authorization and projected cycle/CAS rejection, real API evidence, unknown-coverage documents, sibling accounts, identical raw account IDs under two sellers, and identical document bytes in different pinned manifests. Mixed fresh and recovered invalid batches have no child, finding or success activity. Cases exercise the 100/101 concurrent identity boundary, 10/11 revision batch boundary, pause before and after publication, commit rollback, owner loss and current-authority revocation, native payload conflicts, immutable grants and exact future-storage links. Runtime database fingerprints bracket the C1 suite.

## Limits

This is partial deterministic checkpoint evidence. Independent exact-candidate review and joint acceptance remain separate. C1 changes discovery interpretation and storage only. Proposal construction, candidate registry publication, live provider behavior, holdout, activation and sync have separate gates.

## Fix round 1 — delegation capacity

Exact replacement candidate `aff21214ded3a59c1295bb1dc130079410106440` on `codex/discovery-findings`, parent `84a5b0b6064ebce845a91905d0c8588690c3e9d8`, original base unchanged. The worktree was clean after the fix commit.

The independent P1 review identified successful earlier effects in a batch whose later delegation exceeded capacity. Under the same owner/run lock, preflight now reads the current investigation rows and projects ordered delegations by exact seller/account tuple and specialist count. Repeated requests share a new investigation slot and consume separate specialist slots. Each distinct new account consumes one investigation slot. No reservations are written during projection. The existing per-step insertion guards remain in place. Delegation failures preserve `SPECIALIST_LIMIT` or `INVESTIGATION_LIMIT` in their results and durable diagnostic. Other implemented tools in that failed batch receive their schema-compatible `DISCOVERY_CONFLICT` result.

Round 1 changed `packages/discovery/src/{tasks,supervisor}.ts` and `tests/integration/{v4-discovery-findings,v4-lifecycle-http}.test.ts`. Root released the existing lifecycle HTTP capacity case to replace its former partial-success assertion with zero effects. Its seeded dependent tasks now also report `DEPENDENCY_BLOCKED`, because whole-batch failure fails the coordinator. Both the exact capacity diagnostic and pause/resume checks remain. Migration 007 is byte-identical, SHA-256 `f9c0883a6da0e5ae25c04c8fe566682c72e2acfcc9f22a88e2e0105a83b9f35b`.

Red before implementation, using the same PostgreSQL lease and candidate parent with new tests only. `npm run test:integration -- tests/integration/v4-discovery-findings.test.ts -t 'mixed batch rejects'` failed all four matched tests. Each observed a persisted finding where the batch should leave none. The cases cover fresh and recovered batches, an exhausted specialist or investigation ceiling, and pairs that fit individually but overflow collectively.

Final checks used the same Node 24 and PostgreSQL 18 lease and all five focused integration paths listed above. `npm run typecheck` exited 0, the same focused unit command passed 4 tests in 4 files, and the focused PostgreSQL command passed 80 tests in 5 files. This includes 27 C1 cases and the last-slot positive case where two requests share an investigation. `git diff --check` and `git diff --cached --check` exited 0. The previous candidate's full-unit and protected build results remain historical. This round is partial machine evidence pending exact-candidate review.
