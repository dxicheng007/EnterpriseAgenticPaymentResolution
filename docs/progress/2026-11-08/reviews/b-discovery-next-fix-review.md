# Scoped independent architecture re-review: discovery next fix

Reviewed 2026-11-08 against repository HEAD `ec88d8efff721f14a1482d3e0fbe436de4192c54`. Architecture/document review only. Scope: original E1/E2, current-query cursor semantics, adopted monitor transport/session decisions, and new breakage introduced by this fix. No implementation, tests, commits, provider calls, migrations, or subagents.

## Exact inputs

SHA-256 computed from the files reviewed:

| Input | SHA-256 |
| --- | --- |
| `b-discovery-next-independent-review.md` | `935515886a12a660a1084eddc4494dbcfc539799cd50f4098fc602647a0e9675` |
| `b-discovery-next-fix.diff` | `08114ab3fb8aa9c1f211e093ef045c4c9e7526f5a22e37f19bfd7d692908eeb0` |
| `b-discovery-evidence-tools.md` | `c9cd2d998bcf2c1f2eef0af02e2163f2953f1a1e9ab21fcdf567d1c6d69ad4c0` |
| `b-discovery-monitor-handoff.md` | `1c240df6ff66ca73356a49ea3a9986a860b1cca3ee08ad33f465cf1401726777` |
| `b-discovery-next-handoff-report.md` | `a04cc87bc975b66e8556f2c4332d744aaa5e886e5cfe58822bf0ebc158ddb3ef` |

All supplied candidate/report hashes match. Read AGENTS.md, both revised briefs, original review, fix diff and author report. Checked relevant accepted orchestration text and discovery-shapes freeze, concrete evidence schemas/locator behavior, repository runnable/blocker/resume/state-count behavior, and client HTTP/session cache functions.

## Findings disposition

**E1 — ADDRESSED.** The exact read envelope now projects immutable citation identity without `excerpt`. Only the selected text travels in `text.value`; the dedicated schema must reject a full EvidenceRef or extra fields. Citation-relative input is explicitly translated using the existing response's nonzero citation base, while output retains absolute page/body coordinates. Omitted range selects the cited span. Strict safe-integer, nonempty, surrogate-boundary, 8,192-unit and complete 65,536-byte checks remove the prior duplicate-text loophole without mutating the original citation. This agrees with `EvidenceResponseSchema`/`locate` semantics; the dedicated result validator is correctly distinguished from the full-body response schema. Required regressions directly exercise the original failure and nonzero-base selection.

**E2 — ADDRESSED.** The table separates owner-loss interruption without a new sticky diagnostic from pause and semantic blockers. Replacement ownership may refence only authorized immutable work, preserves existing diagnostics and pause, and cannot settle an old callback or retry an unknown model call. Authority loss remains unresolved/interrupted without content and persistently blocked; capture/oversize failures remain terminal failures with sticky diagnostics. Restored policy and resume do not clear them. This is compatible with the existing repository's paused-only resume and diagnostic-dependent blocked status. Accurate reconciliation and terminal-step revision accounting are explicitly assigned implementation work, rather than claimed existing behavior. No new blocker-clearing authority or endpoint is implied.

**Current-query cursor semantics — ADDRESSED.** Each request validates membership/position in its current pinned, authorized filtered set. An event shared by two filters is valid in either invocation; no unsupported historical-filter authentication is claimed. Byte-reduced pages retain continuation and cannot skip an oversized record. This implements the accepted input without inventing token state or broadening source/account authority.

**Monitor transport/session caveats — ADDRESSED.** Bounded fetch-stream plus manual reconnect removes native EventSource's stale-query and inaccessible-status traps. Resume uses the last completely validated/delivered event cursor, not internal scan high-water. Actual current-generation 401 explicitly clears CSRF before using the shared session cache; the existing expiration listener invalidates its cached promise. One automatic recovery attempt per episode, stale-generation rejection and 403 stop are explicit. Generic post-header resync obtains real status through cursor/state requests. Reauthorization after backpressure drain closes the buffered-page gap, and abort/cancellation and bounded parser/queue regressions are required.

No NOT ADDRESSED findings and no new blocking breakage identified within the scoped fix.

## Separate verdicts

**Specification quality: PASS for this bounded increment.** The adopted representation, recovery and transport decisions resolve the original ambiguities without changing financial authority, persisted citation identity, current resume authority, or monitor scope. Executable output-schema publication remains implementation work, not a claim that the older discovery-shapes freeze already contains these schemas.

**Handoff quality: PASS.** Both briefs identify owned seams, limits, composition coordination and focused regression evidence. The author report accurately describes the revised documents and distinguishes document review from implementation verification.

**Evidence brief: READY FOR IMPLEMENTATION**, beginning with the narrowly owned strict output contracts and continuing with the assigned source/lifecycle seams and recovery tests. **Monitor brief: READY FOR IMPLEMENTATION independently**, with M1/M2 using the now-explicit fetch-stream interface and root serializing composition overlap. Routine parser bounds/backoff choices and executable state-machine details remain implementation responsibilities under the stated limits.

This verdict is exact-document dispatch readiness only. No implementation checks ran; no implementation correctness, V4 completion, live model competence, later financial safety, or joint user acceptance is asserted. Exact-candidate implementation review and required checks remain necessary.
