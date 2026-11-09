# B discovery L2 implementation report

- Candidate clone: `/tmp/eapr-l2` (canonical path `/private/tmp/eapr-l2`), branch `codex/discovery-http`.
- Exact base: `2a2f292fb58f12a3192ca8a0f2ce892631d0a93b`.
- Exact head: `ef06e0264a0ae662635a2eb8112def93a5f17a7b`, `feat: expose authenticated discovery lifecycle`.
- Accepted handoff SHA-256: `4bcb2d01450ef7f91809e7a13b5150591552b08abc5da03a3c267a9a547c33b9`.
- The original assigned worktree rejected writes under workspace sandboxing. The isolated local shared clone used the same branch name and exact base. Existing installed dependencies were linked into the clone, outside the tracked candidate. No merge, push, change to the primary checkout's tracked files, or change to another lease.

## Changed paths

- `apps/control/src/composition.ts` shares the existing demo reviewer policy inputs and mounts discovery with no model.
- `apps/control/src/discovery-composition.ts` supplies the pinned source validator, same-client SQL recheck, catalog lookup and trusted current authority. Recheck recomputes manifest and aggregate hashes, checks exact per-stream event membership/hashes, compares complete raw tuples and citation identities, and locks the selected dossier through the lifecycle transaction.
- `apps/control/src/routes/discovery.ts` authenticates through the local session before body parsing, parses v2 requests, sets no-store, and preserves the accepted SourceError boundary.
- `packages/discovery/src/service.ts` binds per-start capture facts, delegates lifecycle/replay to L1, and polls persisted eligible work when an adapter is injected. The poll's advisory filtering is followed by owner-transaction authorization. The unconfigured mount has no supervisor or dispatch pump.
- `packages/discovery/src/roles.ts` and `packages/discovery/src/tasks.ts` define the closed policy, strict delegate input, same-run dependency and exact pinned tuple validation, and bounded specialist insertion.
- `packages/discovery/src/supervisor.ts` advertises delegateTask only to the mounted coordinator and applies the closed operation inside the existing owner transaction. Validates every pending delegate before the first applicable effect, persists tool result, child and count/activity atomically, and enforces existing pause/generation/attempt/revision fences. The preliminary capture lookup can skip an ineligible observation without failing a later eligible claim. Actual failed validation blocks; it cannot grant membership.
- `tests/integration/v4-lifecycle-http.test.ts` covers the new mounted boundary and the two extra L1 review proofs. No repository, source implementation, shared contract, migration, evaluator, compiler, worker, or web edits.

## Machine checks

The first route test failed before the implementation with expected 401, actual 404, then passed after mounting. The final exact-head run used Node `v24.22.2`, PostgreSQL `18.6`, PG `55438`, control `3601`, worker `3602`, web origin `5179`, and `EAPR_TEST_PREFIX=EAPR_TEST_NAMESPACE_PREFIX=eapr_test_review_t2` (each variable had the stated value). The cluster lived under the isolated clone.

| Command | Exact-head result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run test:unit -- packages/discovery/test` | 1/1 pass |
| `npm run test:integration -- tests/integration/v4-lifecycle.test.ts tests/integration/v4-lifecycle-http.test.ts tests/integration/discovery-capture-read.test.ts tests/integration/local-composition.test.ts tests/integration/v4-activity-read.test.ts` | 47/47 pass, five files |
| `git diff --check` and `git diff 2a2f292fb58f12a3192ca8a0f2ce892631d0a93b HEAD --check` | Pass |
| `git status --short` | Clean |

HTTP tests used real session cookies/CSRF and migrated isolated application roles. One configured composition test used real loopback fetch, actual capture/blob validation with a transaction-state probe, and the persisted coordinator and specialist scheduler. Other HTTP cases used Fastify injection for precise barriers and trusted scripted capture or model seams. Tests included exact replay without model/read/write, changed-key conflict, current revocation, 422/404/409/503 safe source adapter mapping, valid-first invalid-second preflight for cross-run and missing dependencies and uncaptured tuples, strict argument and role cases, exact child revision and replay, reused native IDs with three unique dispatch IDs and transcript linkage, trustworthy usage on oversized output, pause before and after effect, rollback before effect commit and replacement recovery, source dossier lock/recheck, and persisted specialist/account limits. SQL corruption probes used the disposable migration role and demonstrate recheck rejection, not application-role source mutation. The runtime schema and rows were compared before and after, including migration/activity state. The existing L1 suite supplied the four-permit and timeout/interrupted-dependency persistence proofs.

Implementation decisions within routine scope: a 50 ms unref'd configured-only polling cadence, catalog lookup in the service input seam to build the L1 start actor, a lookup of the saved run sourceRef for the L1 read/action actor, and durable failed result rows (without tool.called/tool.result effects) for rejected preflight batches. Replay after a successful delegation was exercised against saved state; rollback recovery exercised generation replacement and did not rerun the model. Model invocations are scripted only in these proofs. No full V4 slice gate, live provider, findings/proposal/verification publisher, financial or activation behavior, sync, independent candidate review, or joint user acceptance is claimed.
