# Joint verification playbook

**Status:** Proposed checks, none executed. Companion to the [implementation plan](2026-11-08-implementation-plan.md) and [PRD v2](../../../prdv2.md).

## What verification means

Each slice has three separate statuses:

1. **Machine:** not run / failed / passed, tied to a specific commit, configuration, and source/artifact versions.
2. **Independent review:** pending / changes requested / reviewed, performed for each candidate SHA by a fresh `gpt-6-astra` reviewer separate from the builder and supervising lead. Follow the [orchestration policy](2026-11-08-agent-orchestration.md).
3. **Joint acceptance:** pending / needs changes / accepted, recorded only after the user and coordinating assistant inspect the outcome together.

Passing tests does not imply the user accepted the workflow. A screenshot does not prove transactions are correct. A model's own explanation or generated tests do not establish independent financial verification.

No automated command may set joint acceptance to accepted. No checkbox in these documents starts completed. Gate reviews can be combined into a single live session when convenient; they are meaningful verification points, not requests for approval on every routine commit. Independent work may continue while we schedule review.

## Evidence packet

`npm run verify:slice -- Vn` will produce `.evidence/<commit>/<slice>/<runId>/` containing:

- `manifest.json`: commit SHA, worktree cleanliness, UTC run time, slice ID, schema/migration versions, dependency/runtime versions, database namespace, source manifest hashes, artifact/profile hashes, mode (`fixture|live|ai-off`), test results, and limitations.
- `commands.json`: exact commands, exit codes, and redacted stdout/stderr paths. Missing checks or skipped mandatory checks prevent a pass.
- `assertions.json`: stable test IDs, expected/actual counts and cents, transaction receipts, and relevant cursor/epoch values.
- `trace.json`: persisted observable task/tool/runtime events. No credentials, hidden model reasoning, or copied sensitive documents.
- `screenshots/` and/or a Playwright trace for visible behaviors. These supplement SQL/API checks.
- `review.md`: reviewer model/session ID, builder and supervising lead IDs, exact reviewed and base SHAs, contract version/hash, and separate spec, quality, and verification judgments. Include the reviewer's own commands, results, evidence paths, and reproducible defects or coverage gaps. Joint acceptance starts `pending`.

An independent verdict applies to its exact reviewed commit. Send every new Sol repair commit through a fresh Astra review. Record the integrated commit and the results of the combined slice checks separately from the candidate review. Only the user can grant joint acceptance at the walkthrough.

Model names/configuration and call/token counts are included only when relevant. Never put API keys, database passwords, service tokens, raw environment dumps, or provider authorization headers in evidence.

The source generator's truth is available only to protected verification; the packet may show expected comparison results after execution, but product agents cannot retrieve the expected answers or hidden future source inputs during construction. Final holdout evidence is not automatically fed back into the agent repair loop.

## Review scripts we will use together

### G0 — Does the application persist state and respect its boundaries?

**Start:** Fresh isolated demo DB pair; `npm run db:up`, `npm run db:migrate`, `npm run db:seed`, then `npm run dev`. Setup scripts will exist after T0.1.

**Inspect:** Open the health page. Both services show ready with migrations. Commit a status event, restart the service, and confirm it remains. Open the role-isolation test output showing attempted cross-database connections denied.

**Pass evidence:** `v0-foundation` and `v0-health`; migration hashes; persisted event before/after restart; no model requirement.

**Decision we make:** Is the local run/restart process straightforward enough to build on? If setup remains fragile, fix it before multiplying integrations.

### G1 — Can we trust where each record came from?

**Start:** Load Company A and Company B sources, including PDFs/CSVs and API snapshots.

**Inspect:** Pick one contract term, invoice, and payment. Open the exact source page/row/field. Check a repeated upload, a missing source member, and two similarly named legal entities. Look at Company B's baseline manifest and its separate file/receipt/semantic cursors.

**Pass evidence:** Cited bytes/text match; duplicates do not inflate counts; a missing manifest member blocks completeness; seller identities remain separate; no hidden fixture truth in product routes/tools.

**Decision we make:** Can a finance reviewer understand the evidence and identify uncertainty without reading logs?

### G2 — Is the mapping executable and financially correct before approval?

**Start:** Use the clearly labeled development connector fixture, not a claim of live AI construction.

**Inspect:** Source field → transformation → parent field; one source-schema mismatch; an amount with three decimal places; the $3,000/$2,000/$200 example. Review independent checks and a deliberately wrong mapping.

**Pass evidence:** 80000 cents outstanding; zero parent writes during preview; invalid amounts/over-allocation/wrong entities held; independent evaluator rejects the bad mapping; artifact hash pinned to report/profile/manifest.

**Decision we make:** Is the future operating rule understandable, and can we see why the amount is correct?

### G3 — Does explicit approval grant exactly the intended authority?

**Start:** Two unapproved customer accounts. Show one review package with its hashes and future-sync scope.

**Inspect:** Attempt unauthenticated/agent activation in the test report; explicitly click “Approve and enable this customer”; examine parent records and receipt. Double-click/replay, then inspect the second account. Change the candidate after preview and attempt the stale approval in the automated case.

**Pass evidence:** One approved account, one atomic bootstrap, $800 balance, no second account activated, replay returns the same authoritative receipt, stale/unauthorized requests rejected.

**Decision we make:** Is it obvious that approval authorizes bounded future sync and how that authority can be revoked?

### G4 — Did agents genuinely build the connector?

**Start:** A new live discovery run against visible sources, with developer fixture artifacts excluded from the construction path.

**Inspect:** A coordinator task, specialist evidence queries, one disagreement/uncertainty, and the connector engineer's generated rules. Open the produced artifact and its protected verification results. Repeat for the different Company B schema.

**Pass evidence:** Real provider call IDs/configuration, bounded structured tasks, correct generated source-specific artifact, no fixture-answer read, no invented material term, independent holdout result.

**Decision we make:** Is AI doing meaningful discovery and construction rather than narrating a hardcoded migration? Correctly stopping on insufficient evidence is a valid result for an ambiguous account; at least one supported customer per company must succeed.

### G5 — Does the connection keep working when AI is unavailable?

**Start:** Activate supported customers using G4's actual generated artifacts. Disable design-time model access; start/check worker without model credentials.

**Inspect:** After activation and disabling AI, inject a new $300 payment for the $800 account and a fresh Company B file batch. Trigger/poll one cycle. Open parent balances and receipts, capture/application progress, and actual isolation evidence.

**Pass evidence:** Current balance becomes 50000 cents, original cutover remains 80000; the new file is applied under its approved rules; no additional customer approval; no provider call; events were absent from discovery/cache. Unknown customers remain held.

**Decision we make:** Has the central product thesis been demonstrated? A replay/video or zero counter hardcoded in UI does not pass.

### G6 — Does a failure stop the right work without losing money or records?

**Start:** Active A/B connections and known balances. Use operator/test failpoints only.

**Inspect:** Replay a payment, restart after capture, lose an import response, revoke during application, and rename an A amount field. Confirm B can continue and A's rejected input leaves target money unchanged. Show a payment waiting for an invoice, then arrival of the invoice releasing it.

**Pass evidence:** Unique monetary effects and receipts; real PG transaction race tests; pending inbox survives; application gaps remain visible; revoke blocks stale epoch after its commit; drift pauses before writes; dependencies can resolve without deadlock.

**Decision we make:** Are error messages and the next safe reviewer action clear? We acknowledge that undetectable same-shape semantic changes remain outside the demonstrated guarantee.

### G7 — Can we repeat the complete demo and defend its claims?

**Start:** Explicit disposable demo reset, both sources and model access verified. Follow `docs/demo/runbook.md` once it is implemented.

**Inspect:** Three identified rehearsal runs, including any failures and their corrections. Compare final source/artifact hashes to the accepted version. Review an unseen source variant, timing/cost, and any unsupported cases left on hold.

**Pass evidence:** G0–G6 machine checks passing on the final integrated commit, no missing mandatory live evidence, three complete recorded live rehearsals, redacted packet, labeled fallback replay, and clearly stated remaining limitations.

**Decision we make:** Is the prototype ready for the hackathon presentation? This does not imply production deployment approval.

## Traceability to PRD acceptance criteria

| PRD requirement | Implementing tasks | Main proof |
|---|---|---|
| Artifact sufficient without discovery conversations | T2.1, T5.2 | Worker-only artifact restart with AI disabled |
| Genuine agent generation and independent evaluation | T2.2, T4.1–T4.2, T7.1 | Real tool trace + protected holdout |
| Customer approval and bounded standing authority | T3.1–T3.2, T5.1 | Direct unauthorized request blocked; normal future event auto-applied |
| Scope expansion/artifact tampering blocked | T2.1, T3.1, T6.2 | Unknown identity/hash/semantic revision tests |
| Exact money, allocations, full reversals, as-of views | T2.1, T5.1, T7.1 | Independent expected cents and preserved snapshots |
| Duplicate events/economic IDs, retries, versions | T5.1, T6.1 | SQL uniqueness + race/replay tests |
| PostgreSQL isolation, migrations, persistence | T0.1, T6.1 | Real DB roles, restart, and transaction assertions |
| Snapshot-to-stream and multi-stream baseline | T1.2, T5.1 | Event injected during review; manifest cursor vector |
| Semantic-feed ordering/drift | T1.2, T5.1, T6.2 | Finance before new metadata is held |
| Quarantine/gaps/dependencies | T5.1, T6.2 | Captured-but-not-applied counters; invoice releases payment |
| CSV duplicate/conflicting batches | T1.2, T5.1, T6.2 | Batch ID/hash/sequence tests |
| Revocation and target version conflict | T3.1, T6.1–T6.2 | Lock/epoch barriers, target unchanged |
| Prompt injection/evidence/source permissions | T1.1, T2.2, T4.1 | Malicious tool requests, source paths, and citations |
| Monitoring, pause/resume, source corrections | T3.2, T4.1, T5.2, T6.2 | Browser plus persisted API state |
| Optional reviewed version repair | T8.1 | New artifact approval + once-only held-event replay |

## Acceptance record template

```text
Slice/gate:
Commit and dependency baseline:
Artifact/profile/source-manifest hashes:
Machine status: not_run | failed | passed
Commands and evidence path:
Independent Astra reviewer, exact reviewed SHA, and result:
Joint acceptance: pending | needs_changes | accepted
What we inspected together:
What was fixture/stub/live/AI-off:
Known limitations and unresolved exceptions:
Follow-up owner/task:
```

Use this as a shared working record. We can adjust presentation and reviewer usability based on what we see, while preserving financial, authority, and provenance invariants.
