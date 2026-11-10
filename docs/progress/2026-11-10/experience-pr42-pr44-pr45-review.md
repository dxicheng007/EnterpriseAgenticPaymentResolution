# Experience PR42 / PR44 / PR45 — exact integration review

Reviewed candidate: `15bb421945bcfd1366e63ef497929737a2995bab`, branch `codex/platform-sync-apply-repair`, worktree `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`. Requested changes: PR42 `edd965e4983b55537802b4710103711254f4377a`; PR44 `209dde6253deb731fd1e02652ed9f8ccdf6377d9`; PR45 `0060214e151e581e0f655739a3c4c6ed637d2ed5`. Reviewer: `/root/experience_latest_review`, separate from builders and coordinating root. Line references are relative to this exact candidate.

**Specification verdict: partially conforming prerequisites; V3/V5/V7 and joint acceptance remain unaccepted. Engineering verdict: changes requested.** PR42 corrects the prior parent-version explanation and supplies meaningful real lost-response/original-receipt recovery test code. PR44 adds a properly authenticated, read-only operations route but misattributes shared capture lanes and presents an unmeasured model-call count as zero. The contracts export also breaks both protected source inventories. PR45 is candid about unexecuted rehearsals, but its reset instructions are incorrect.

No repository source, Git, DDL, database, browser, provider, or external-message action was performed by this reviewer. This temporary report is the only written artifact. Root owns the combined machine checks.

## Actionable findings

### P1 — Include the new contracts leaf in both protected build inventories (Platform integration)

Location: `packages/contracts/src/index.ts:23`; affected inventories: `packages/evaluator/src/bootstrap-runner.ts:60–65` and `packages/evaluator/src/financial-attestation-build.ts:9–13`.

PR44 exports `connection-state.ts` from the contracts root, which is imported by protected bootstrap and financial verification entrypoints. Neither build inventory includes the new executable dependency. Consequently the recorded build hash no longer covers the complete runtime import graph. This violates the existing recursive source-pin requirement and `packages/AGENTS.md`'s explicit obligation when adding an index export.

This is reproduced by root's exact-candidate unit run, inspected in `/private/tmp/eapr-15bb421-unit.log`: 560 tests, 558 passed, two failed. Both failures identify only `packages/contracts/src/connection-state.ts`, in the bootstrap recursive-inventory and financial local-import closure tests. Typecheck passed, as recorded in `/private/tmp/eapr-15bb421-typecheck.log`. These are coordinator-executed results, not reviewer executions. Root has retained ownership of the narrow protected-inventory repair; Experience must not independently edit protected files. Preserve closure/source-mutation tests and obtain exact repaired-candidate checks before acceptance.

### P2 — Resolve capture progress through the selected activation's lane, not the lane's first creator

Location: `apps/worker/src/connections.ts:26–31`.

The shared SQL fragment joins checkpoints/incidents to `runtime_activation_imports` using `l.initial_activation_id`, then filters that original import by the requested account. That column records the activation that first initialized a shared `(source_ref, manifest_hash)` lane. It is not an account-membership relation.

This is an existing supported case, not hypothetical future functionality: `initializeCommittedCapture` in `apps/worker/src/sync/bootstrap.ts:88–120` returns an already initialized matching lane for a second committed customer without replacing its creator. The existing integration case `tests/integration/sync-capture.test.ts:922–934` explicitly asserts two different approved scopes/activation IDs share the same lane and progress while `initial_activation_id` remains the first customer's ID. Under PR44's query, Operations for the second customer returns empty streams and incidents even after actual capture or a lane gap. The UI then states “No captured streams are recorded for this account” and “No capture gaps or conflicts are recorded” (`OperationsPage.tsx:37,46`).

Resolve the requested customer's exact committed source/manifest/capture binding and use that lane identity for the read. Do not solve this by including every lane for a source, which would mix different approved baselines. Preserve the repeatable-read, read-only snapshot and current reviewer source/account checks. Add a read integration case using the existing two-account shared-lane fixture, including an incident visible to both approved customers and a different-manifest lane that remains excluded. This is a Platform-owned worker/API correction with an Experience consumer regression, not a request to rewrite runtime003 or add invented membership authority.

### P2 — Do not present a literal zero as the runtime model-call measurement

Location: `apps/worker/src/connections.ts:66`, `packages/contracts/src/connection-state.ts:39`, displayed by `apps/web/src/features/connections/OperationsPage.tsx:32`.

The endpoint always emits `runtimeModelCalls: 0`, and the schema admits only literal zero. No counter or executed isolation evidence contributes to that value. The new browser test merely checks that same constant (`tests/e2e/v5-operations.spec.ts:39`). In contrast, pending/quarantine/lag correctly remain null when unmeasured.

PRD §14 explicitly requires the zero-call label to be backed by architecture **and** a worker test that traps attempted model invocation while successfully synchronizing genuinely fresh postactivation records. The verification playbook G5 explicitly rejects a hardcoded zero counter as proof. The recorded PR32 trap deficiency and unavailable full V5 gate remain open. This review found no runtime model invocation; the defect is representing a policy/architecture assertion as an observed count before its required proof exists.

For this read-only increment, make the count unmeasured or present a clearly labeled architectural policy (“runtime model calls forbidden”) without a measured numeric claim. A later measured value must have an explicit observation window/provenance and actual worker proof. Platform owns the contract/backend seam; Experience owns truthful presentation and the browser expectation. No provider setup is needed to correct the label.

### P2 — Replace the rehearsal reset instruction that preserves prior approvals

Location: `docs/demo/walkthrough-and-rehearsals.md:38`.

`npm run db:down` only runs `pg_ctl stop` (`scripts/native-db.ts:105–108,206–208`). Restart provisions the existing demo pair with reuse enabled, and the seed ledger uses `ON CONFLICT DO NOTHING`; it does not remove approval intents, activation imports, receipts or parent state. Calling this a “Reset between runs” therefore causes the second rehearsal to start with previously approved/imported customers rather than the fresh baseline assumed by the approval steps.

Correct the document to distinguish restart from reset, and point rehearsals to an explicitly isolated disposable reset/setup procedure once root publishes it. Do not add destructive deletion of the user's persistent demo. Until that procedure exists, record the reset prerequisite as unavailable. PR45 already honestly states no rehearsal has run; preserve that status.

## Closure matrix against the prior Experience review

Baseline: `docs/progress/2026-11-08/reviews/platform-v3-v4-9680b05-review.md`, reconciled with the latest Platform handoff `handoffs/platform-classification-dispatch.md` and `docs/progress/2026-11-10/team-handoff.md`.

| Prior gap | Source/test disposition at 15bb421 | Proof/acceptance boundary |
| --- | --- | --- |
| V3 two-case browser normalizer/allowlist failure | Already corrected by prior Platform/PR40 work. PR42 adds both new titles to the four-case allowlist. Do not redispatch the old parser defect. | Earlier exact V3 gate pass remains historical; current four-case run belongs to root. |
| Wrong future parent-version explanation | Corrected at `packages/client/src/review-explain.ts:12`: proposed import requires displayed version; later sync plans against its then-current version. | Source finding closed. No global perpetual baseline restriction remains in this text. |
| Evidence controls missing | Already corrected before these PRs; PR42 adds actual citation GET, rendered citation text, original-link presence and close behavior (`v3-review.spec.ts:254–265`). | First citation only; test does not click/fetch original PDF, separately exercise identity and field evidence, or independently assert $800 and visible future limits. No fresh execution claimed by this reviewer. |
| Original intent/receipt recovery after head movement unproved | PR42's new test actually submits an approval, forwards it to server and drops the reply, checks one runtime import, advances persisted head, explicitly replays the identical request and asserts `replayed:true` with original stored receipt ID (`:297–339`). | Meaningful mounted scenario now implemented. This supersedes the prior fabricated-earlier-request-only limitation for this scenario, subject to root's actual run. It deselects/reselects account; it does not reload page/restart browser. |
| Duplicate click/lost reply | New real replay uses `dblclick`, checks exactly two total posts (one original plus one replay), one import and original receipt. | Tests double-click of retry, not simultaneous competing initial approvals. Do not infer OS-process restart recovery. |
| Unsupported term blocker only unmounted | `UnresolvedDecision` is mounted for server package blockers (`ReviewPage.tsx:356–357`); test persists a not-ready package with diagnostic via repository, reads it over real route and verifies disabled approval and no activation request. | Valid browser rendering/gating proof design for a server-held blocker. Test-owner injected diagnostic does not prove source interpretation or the production unsupported-term detection path. |
| Exact-details gate/retry and per-package saved requests | Existing fixes preserved; old failed-read retry test retained. | Delayed/mismatched details, failed/pending stale refresh, renewed-session behavior and full page-reload recovery remain separate unproved browser variants. Do not relabel them as missing source fixes. |
| V3 public evidence packet under-retention | Still open: `scripts/verify-slice.ts:548,559` retains no screenshots and serializes case statuses, not run-bound public source/artifact/profile/package/receipt/count/cents observations. PR42 adds no public exporter. | A passing four-case suite does not close packet proof. Experience emits safe observations; Platform validates and retains them. |
| Full correction workflow | No change; fail-closed 422 remains. | Cited correction/reverification semantics and UI still require their assigned contract work; no guessed monetary correction. |
| Final rehearsals | PR45 provides an explicitly unrun checklist and empty log. | One-customer walkthrough is a partial script, not the two-company live-build/AI-off/recovery/drift V7 rehearsal. No rehearsal or joint acceptance claimed. |

## PR44 authority, bounds and PR39 separation

The new external route authenticates the reviewer before reading, resolves registered account and source grants, then uses a fixed loopback worker origin with the service credential. Worker ingress checks the service token; both sides reject extraneous query parameters and return no-store responses. Control validates the returned scope, and the browser client rejects a wrong account. The UI uses current session account grants, aborts abandoned reads, exposes explicit refresh/error states, and mounts no pause/resume/revoke mutations. I found no demonstrated authorization bypass in this new route.

The worker reads under one `REPEATABLE READ READ ONLY` transaction. It projects a bounded 50 receipts/50 incidents/50 streams with fixed schema fields; raw canonical artifacts, protected proof material, DB credentials and service tokens are not exposed. Initial import fallback to active/epoch1 reflects the accepted lazy current-authority model, not invented new approval. Status wording describes authorized synchronization, not successful ongoing execution. Applied batch count is the stored sync receipt count, separate from the initial receipt; pending/quarantine/lag remain honestly unmeasured. Future history pagination/completeness metadata should be specified with the final operations contract, not inferred as full history from this bounded projection.

PR44 reads runtime005; it does not mount `createSyncApplier`, mutate parent state, or cure PR39. Exact byte comparison against `722aaf7` confirmed `apps/worker/src/sync/apply.ts`, `packages/parent/src/sync-store.ts` and `db/runtime/005_sync_apply.sql` unchanged. PR39's full-delivery identity, original-receipt replay, captured/governing provenance and atomic application progress findings therefore remain open. Rendering a stored receipt accurately is not independent proof that the rejected writer produced a correct outcome. No claim is made that ordinary mounted production has already created bad sync rows; that writer remains unmounted.

Runtime001–005 remain immutable. Runtime004 SHA-256 is `f232c9e552362618e785cc0bb23e847e4d7f319e0c0fae9084fb9aebc98deab7`; runtime005 is `7c35563ed3504766153aa6b7706c4a448dd4c50f3f1d0203345525c215f3ef96`. This read correction does not authorize new DDL or changing catalog history.

## Concrete owner next tasks and apply-repair consumer seam

1. **Platform root:** repair the two protected import inventories, preserve graph/mutation verification, and record exact integrated machine results. Own the worker lane query correction and narrow API truthfulness contract review before returning an Experience-only task. Do not treat the merged `ConnectionStateV1` as a frozen complete V5 progress contract.
2. **Experience, existing browser scope:** retain the new real lost-reply scenario; finish original PDF/field/identity inspection, delayed/mismatched details and remaining session/reload cases against actual mounted APIs. Emit allowlisted run-bound public observations and safe selected screenshots for Platform's packet integration; include actual package/artifact/profile/manifest bindings, expected/actual cents/counts and original receipt identity. Do not redispatch already fixed controls/storage/retry wording.
3. **Platform apply repair + Experience operations seam:** publish the exact account/source/manifest lane identity; distinguish source capture cursor from per-account application frontier; expose pending/quarantined gaps separately from parent version. Return original initial-or-sync receipt references for replay rather than allowing UI to infer origin from latest receipt or increment an applied count on a duplicate. Preserve initial cutover and current balances/versions as separate observations. The UI can consume a small reviewed read DTO; it should not query new runtime tables or infer financial outcomes.
4. **Focused joint regression matrix after repair:** second account on shared lane sees the same capture gap; different-manifest lane excluded; literal and new-delivery economic replay preserve original receipt identity and do not add monetary effects/applied batches; mixed replay/new shows only actual new operations; captured but held records show a visible application gap; paused/revoked authority changes remain readable with original receipts. These tests consume the accepted apply/progress behavior. They must not force broader scheduling/resolution policy into the first bounded writer repair.
5. **Experience documentation:** correct restart/reset wording now. Keep rehearsals unrun and the checklist explicitly partial until the accepted two-company fresh-input, replay/restart and drift path exists. Later operations controls wait for Platform's existing authority service ingress; do not reimplement completed internal pause/resume/revoke.

## Verification provenance and limits

Performed: read-only exact Git identity/diffs/status; root/apps/packages/tests instructions; PRD thesis/process/operations/finance/acceptance; implementation verification conventions and V3/V5 tasks; frozen F1/F3/F4/F5 and activation-shape obligations; shared ownership/playbook; prior Experience and PR39 reviews and latest Platform handoff; production/test/storage source inspection; immutable apply/store/005 byte comparison and migration digest reads. No separate pure probe or test suite was necessary: the existing shared-lane integration fixture and query establish the attribution defect directly. Broader diff whitespace checking noted one unrelated trailing-space line in the Discovery handoff, not an Experience defect.

Root baseline evidence inspected: typecheck passed; units 558/560 passed with exactly the two protected inventory failures above. Browser/DB combined results were pending at report preparation. All recorded mounted coverage here describes what the actual test code exercises, not an invented successful execution. Existing Fastify browser harness uses real worker/control plugins and isolated application-role PostgreSQL with protected activation proofs, but is hosted in the test process; it does not prove normal supervisor process separation or live model construction.

No full V3/V4/V5/V6/V7, financial correctness beyond actual checked assertions, provider readiness, or joint user acceptance is granted by this review. A repaired candidate needs its own exact review and combined machine evidence.
