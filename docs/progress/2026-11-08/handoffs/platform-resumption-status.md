# Existing team integration resumption — 2026-11-09

Latest checkpoint: A4 and A5 are implemented and independently accepted for their bounded scope on the local integration branch; see the final checkpoint below. The following initial assessment is retained chronologically, not as the current status.

This is a fetched Git/API status assessment and bounded dispatch record, not slice acceptance. The clean local main checkout remains at `cdcb26d`; the isolated integration branch `codex/platform-activation-integration` starts at fetched main `dbb3fa48e4702e6e8867dfb3906db603b38c07ce`. Preserved A4 `78f355e49925b30cffa6b380b0a28f153d40376b` applied cleanly as `8cfbdb179dcdd38e31cb97c9652040b9bd668fcc`. Original worktrees, running demo, policies and source pins are unchanged by this setup.

## Other developers

| Lane | Current pushed state | Evidence limits / next dependency |
| --- | --- | --- |
| Discovery | William Li's association producer, consumers, compilation, replay/compare and offline model stub merged through PRs 3–7. Current main `dbb3fa4`; latest feature head `19ef57d61361f5c72ea331328e98f4922e331815`. | Implemented prerequisites, not live generation. GitHub reports no CI checks or review verdicts for these PRs. Earlier tracked producer reviews do not cover every later exact candidate. Scoped integration-boundary review is in progress. |
| Experience | Yash's [PR 8](https://github.com/dxicheng007/EnterpriseAgenticPaymentResolution/pull/8), `ad2a1d17806179c7f32d2806c066e7eb8198d656`, is open. Read-only parent/activation client and inactive inspection screen. | Author reports typecheck and parent unit tests passed, browser spec not run. No GitHub reviews or CI checks. Actual inactive browser proof and exact-candidate review remain required; imported-state proof waits for A5. |
| Platform | A4 checkpoint retained; new bounded completion agent dispatched on current integration base. A5 unimplemented. | Complete missing adversarial matrix, independent Astra review and combined checks before releasing A5/API consumers. |

Git establishes pushed/merged states, not whether a developer is presently editing. The local chat inventory did not expose separate active Discovery or Experience chats; no messages were sent to their owners.

## Dispatched work and isolation

GPT-6.1 Sol owns A4 completion: its existing implementation paths and three integration suites, actual transaction barriers, composed proof rejection, source-wide blockers, nonempty target and mirror fault coverage. A second GPT-6.1 Sol agent completed a read-only assessment of A5 ports and downstream handoffs. Astra independently reviews the merged Discovery integration boundary and will separately review the exact completed A4 candidate. Builders do not self-accept.

A4 has the exclusive fresh PostgreSQL port `55441` with `eapr_test_review_t2` / `eapr_review_t2`; the helper permits only t1/t2 names. This is a separate worktree-local cluster, not another lane's database. Preserve control008's existing bytes. No live provider, model credentials, source repinning or runtime import is part of A4.

The A5 assessment confirms committed-intent and mirror APIs match the accepted handoff. A5 must replace the pending-only delivery tail with authorized receipt-first recovery, preserve original intent bytes, and recover through current registry/policy/source outages after a successful worker commit. Runtime002 remains sufficient; no runtime DDL is reserved by this record.

## Discovery unblocks

The [D4 unblock handoff](d4-discovery-unblock-handoff.md) supersedes the old roadmap's implementation-status snapshot. The next independently specifiable Platform unblock is the durable verification adapter keyed by the server tool-step ID, with one atomic budget reservation and unchanged reviewer enqueue wire. It needs a separately reserved additive control migration after 008 and exact-candidate review before Discovery consumes it. This record reserves no new SQL and makes no applied-migration claim.

For generated account IDs, retain the already-specified interim rule: verify only already-trusted allowed scopes. A proposal must not grant its own capability. Broader audited capability policy remains a separate design/user decision if not specified. Repair/completion permissions and transitions require a separate accepted handoff. Provider configuration remains deferred; an offline stub labeled live in a test is not live-model competence.

## Acceptance boundary

No new V3–V7 gate is claimed. A4 pending202 is not an import or activation. Machine results, independent exact-candidate review and joint user acceptance remain separate. Publication to shared main and restarting the preserved integrated demo are not part of this setup record.

## Initial integration evidence

- Root ran `npm run test:unit` with Node 24 against `8cfbdb1` plus integration-test/document WIP: **65 files, 413 tests passed**. The first sandboxed attempt failed before loading tests because Vitest could not write its temporary config; the permitted rerun exited 0. This is a baseline unit check, not full A4 or a slice gate.
- [Independent Discovery boundary review](../reviews/platform-discovery-boundary-review.md) at exact `dbb3fa4` found no actionable blocker in the assigned composition/registration/sandbox/offline-client boundaries. It records a nonblocking production compile/replay composition-test gap. No tests were rerun by that reviewer and it is not a general Discovery acceptance.
- Adapter design must use the actual accepted financial-verification composition: `composeVerification` delegates to `composeFinancialVerification` and `createFinancialAttestationJobs`. The older V4d text naming legacy `jobs.ts` and bootstrap-bearing evidence-support unavailability predates accepted A1c. Preserve current attested provenance and exact-byte reservation/completion when defining the retry-safe discovery adapter; wrapping the legacy enqueue alone would not connect the current product path. Resolve this engineering seam in the adapter's concrete handoff before assigning implementation.

[Experience exact-candidate review](../reviews/platform-experience-parent-review.md), Astra at `ad2a1d1`, requests one P2 correction: ParentView retains old account grants and a failed activation read after App renews the reviewer session. The fix belongs to Experience; no UI paths were taken by Platform. Add a renewed-session/grant-change regression and execute the actual inactive-parent browser spec before acceptance. The reviewer also recommends asserting the changed as-of balance in that browser flow. PR8 remains unmerged here; no review comments were posted to GitHub.

## Upstream refresh during work

At the user's request for regular pulls, root ran `git pull --ff-only` in the clean original checkout. It was already at the externally updated main `c8ed642` (PR8 merged). This supersedes the earlier open-PR/local-main snapshot above; it does not resolve the exact `ad2a1d1` review finding or supply missing browser evidence. Integration tests remain on the isolated pre-PR8 branch until their current run finishes; root will incorporate the new main at a clean candidate boundary. No shared branch was pushed by this session.

A concrete [Discovery verification adapter design](platform-discovery-verification-adapter-design.md) is drafted against the current attested producer. It awaits independent design review; migration009 and all paths remain provisional, with no SQL or producer implementation authorized by the draft alone.

## A4 accepted for bounded downstream implementation

A4 corrected candidate `393d47ae01b9d56c548c554a37003f6658e3d54a` (code fix `196b8aeaca9019a1d998451fefe1a0edd68bbb1c`) passed [fresh scoped Astra correction review](../reviews/platform-a4-authorization-fix-review.md) after the [initial P2 finding](../reviews/platform-a4-independent-review.md). Source-forbidden exact/changed retries now deny before key-derived conflict results. Authorized original retries still avoid current setup/head dependencies. The reviewer independently reproduced authorization, missing-head consistency and zero rejected publication. Supported repository head monotonicity meets the accepted contract; no claim of direct-SQL anti-rewind protection is made.

Root combined `bd3907959be6c3f0be191ba185ff60bde63cc30c` (A4 plus pulled main `c8ed642`) passed typecheck, 421 unit tests across 66 files and 43 PostgreSQL checks across nine A4/parent/shared-composition/Discovery suites. The correction subsequently passed typecheck and its real composed PostgreSQL regression, with the original authorization failure reproduced before the fix. Root also ran the newly merged `v3-parent-read.spec.ts`: one actual inactive-read browser case passed, with zero runtime changes. That fills the previously unexecuted baseline browser case but not Experience's session-renewal finding.

Control007 SHA-256 `f9c0883a6da0e5ae25c04c8fe566682c72e2acfcc9f22a88e2e0105a83b9f35b`, control008 `956127c4414c86ab5ffe4bd630cabd333662fb61688af540a8b19184b97b0a54`, and runtime002 `a06874e335f6acfd6f62d89760c00c76059c95b9ab05782707999ff70f8ddc56` were verified unchanged. Exact newer supervisor smoke remains unperformed; preserved checkpoint smoke and current real-listener restart evidence are distinguished in the [A4 report](platform-a4-completion-report.md).

The integrator accepts this bounded pending-intent implementation for A5 consumption, not V3/user acceptance. Release A4's `activation-review.ts`, `activation-composition.ts`, `review-repository.ts`, activation route and `scripts/dev.ts` to the single A5 writer for only the accepted delivery/composition integration. A5 uses actual implemented immutable intent and mirror ports, runtime002 and accepted A3b reads; it receives no new financial policy or migration authority. UI paths remain Experience-owned.

The [corrected Discovery adapter design](platform-discovery-verification-adapter-design.md) also passed [independent design correction review](../reviews/platform-discovery-verification-adapter-fix-review.md). Producer SQL acceptance and actual-supervisor integration acceptance are distinct; no verification tool may be advertised before the latter. Its migration number and producer implementation remain separately reserved work.


## Final A4/A5 integration checkpoint

The integrator accepts A5 corrected code candidate `ffb597d032f44fa4af9e9285555136fab9ac2609` for bounded downstream consumption. GPT-6.1 Sol implemented A4/A5 and their review corrections under monitored, exclusive path/database ownership. The [initial A5 Astra review](../reviews/platform-a5-independent-review.md) identified one mirror-failure status mismatch; the [fresh correction review](../reviews/platform-a5-mirror-fix-review.md) passed after the adapter returned the original pending202 identity. The [broader integration review](../reviews/platform-integration-independent-review.md) found no additional blocker in the assigned branch scope. Root corrected the outdated implementation-status paragraph in AGENTS.md. See the [A5 implementation report](platform-a5-implementation-report.md) and [setup guide](../../../demo/worker-activation-setup.md).

Root verified the exact corrected code candidate with Node 24 and the isolated PostgreSQL 55441 lease:

- `npm run typecheck` passed.
- `npm run test:unit`: 421 tests across 66 files passed.
- Thirteen explicitly selected integration files: 76 tests passed in 72.64 seconds. These cover A5 activation/recovery/composition, A4 review preparation/intents/composition, parent storage/reads/composition, local composition, and Discovery HTTP lifecycle/compilation/replay-compare. This is focused integration evidence, not the entire integration suite.
- `npm run test:e2e -- tests/e2e/v3-parent-read.spec.ts`: one inactive-parent browser test passed in 2.9 seconds, verifying no runtime-record writes. It does not cover the approval browser workflow or resolve the upstream session-renewal finding.

Regular pulls included Experience PR8 during implementation. The final `git pull --ff-only` in the clean original main checkout returned already up to date at `c8ed64265755963ec94164b5ddd1440e9245c0c7`; that main is included in the integration branch. Discovery PRs3–7 and Experience PR8 remain the latest observed merged developer work. Git status cannot establish unpushed editing activity. No remote publication or messages to developers were performed by this session.

A4 preparation/approval intents and A5 first import/receipt recovery are implemented; complete V3 and joint user acceptance remain open. Experience owns the session-renewal P2 and approval UI/imported-state browser coverage. Discovery verification adapter design is accepted, but its producer SQL, supervisor owner-fencing acceptance and tool mounting remain unimplemented. Live model construction, ongoing synchronization and later financial/sync slices remain unfinished. No live policy, provider credentials or new customer authority was installed in the preserved demo. The ordinary no-policy supervisor smoke and real issued-proof disposable composed-service imports remain distinct evidence.
