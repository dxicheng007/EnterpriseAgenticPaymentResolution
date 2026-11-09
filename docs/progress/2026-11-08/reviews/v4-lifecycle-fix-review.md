# V4 lifecycle architecture fix review — round 1

## Exact candidates and scope

Primary candidate: `v4-lifecycle-handoffs.md`, independently computed SHA-256 `9ec9a626f70ba956be479ba08fbc6c7c568c9edc0f54c39d65a59c86be074ac0`.

Separate source prerequisite: `b-discovery-capture-read.md`, independently computed SHA-256 `c553fb1234516f079c92879411c777db9aacfe63ab6ac6a3a7541b0a9d3dedee`.

Reviewed the original lifecycle task, independent review R1/R2, fix report, round-1 diff and revised handoff. Cross-checked the relevant accepted orchestration/frozen discovery boundaries and current source inspector, source-event validation and application database grants. This is a fresh scoped architecture fix review: R1/R2 and concrete new breakage introduced by their changes; the separate source brief is assessed only for boundary compatibility. No implementation, SQL, tests, commits or live calls were performed.

## Verdict

**APPROVE the exact lifecycle handoff for the reviewed R1/R2 fixes.** Both findings are resolved; no newly introduced blocking issue was found in this scope. L1 can proceed through its stated independent implementation/review process. L2 retains its existing source-validator, strict delegate-schema and current-authority composition prerequisites. This verdict is not implementation acceptance, full source-validator design acceptance, V4 completion or live construction evidence.

### R1 — resolved

Handoff lines 66–69 now require the timeout transaction on the lock-owning connection to change a still-reserved dispatch to interrupted, persist its per-dispatch unknown-accounting marker, interrupt its task and retain a blocker, revisions and interruption publication atomically. Acceptance is restricted to a reserved dispatch under the current fence. The committed state decides the timeout/result race.

If timeout commits first, even a same-owner late success cannot persist output, known usage or tools, clear the blocker or start a replacement call; it only settles/releases the process-wide permit. Pause/resume explicitly preserves this distinction. Recovery checks the same marker and cannot count or publish the interruption again. If result acceptance commits first, timeout is a no-op. Line 79 specifies the requested same-owner timeout → pause/resume → late success → owner replacement test, repeated recovery and reverse race ordering. These are test requirements, not executed proof.

### R2 — resolved

Line 64 now specifies strict request validation and current authentication/source authorization, actor/key lookup and canonical request comparison before the new-start model/capture requirements. An authorized exact existing request returns its saved response without writes, scheduling, capture refresh or model configuration; saved binding authority is checked and revoked policy rejects disclosure. Only new creation requires a configured model and exact capture validation. Concurrent creation must use the unique winner without replacing its binding or creating a second run.

Lines 7 and 85 consistently scope unavailable-model rejection to new creation. Line 76 adds configuration-disappears replay, absent-configuration new-key rejection and revoked-policy replay cases. No latest-binding refresh or inferred parent privilege was introduced.

## New issues and inherited gates

No new blocking issues found in the reviewed changes. Activity-reader acceptance wording is corrected at lines 3, 18 and 91: `f2b5545` is accepted/integrated at `a356b11` and is consumed unchanged. The failed/interrupted-predecessor waiting/blocker requirement remains explicit. Provider access, full source tools, repair publication, findings/proposal assessment and completion remain deferred; no empty-state pass was added.

## Separate source brief: boundary compatibility

**Compatible with the lifecycle boundary, within this limited assessment.** The proposed `readDiscoveryCapture` returns only exact immutable binding, observed source-account tuples and complete citation membership. It explicitly excludes grants, reviewer data, parent mappings, candidates, proposed financial values and eligibility answers. Lifecycle retains current authorization and policy checks; membership is expressly not authority or semantic financial proof.

The API exposes a database read dependency and `Pick<EvidenceStore, 'get'>`; its normative algorithm forbids writes, recapture, uploads, activity publication, locks and candidate fixtures. It reuses capture inspection and canonical hash helpers while requiring aggregate/citation/original-byte checks beyond a mutable dossier completion flag. That matches the current SELECT/INSERT-only source-member grants and mutable dossier exception. External reads occur outside database transactions, followed by exact identity/membership rechecks, with the later lifecycle insert recheck retained.

The source-owned `SourceError` and later route status adapter preserve the package/HTTP boundary. The brief explicitly excludes validator execution for authorized exact start replay, matching R2. Its zero-write/corruption/barrier assertions are appropriate required implementation evidence, not results already obtained. Independent review of the actual prerequisite implementation remains necessary before L2 consumes it; this report does not authorize the lifecycle implementer to edit source-owned paths.
