# Discovery PR43 / PR46 exact-source review

Reviewed 2026-11-10 for Developer0 integration. **Changes requested: Gate J specification FAIL; engineering-quality FAIL for acceptance. Live transport remains unsuitable for accepted live mounting.** Useful fixes are explicitly credited below; this is not a repetition of the old all-open verdict.

## Exact boundaries and method

- Initial integration checkout / HEAD: `15bb421945bcfd1366e63ef497929737a2995bab`, branch `codex/platform-sync-apply-repair`, `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.
- Merged PR43: `dccb0b60e0dff27f1a981b55aa8ad387abb65142` (`fix: Gate J consumer fences and live transport harden (#43)`). Reviewed its parent delta and final source. Relevant Discovery source, verification composition and tool-contract files are identical at integration HEAD.
- PR46 reviewed source: local `origin/discovery/gate-j-acceptance` resolved to `d717aa90691cb884a3f6de0cca3e5cfc71131416`. Reviewed the separate four-file delta from initial integration HEAD and exact candidate source. During review PR46 merged externally as `cfbf679c865a799f9d7864aee2a55e378a318732`; the Discovery source and fencing-edge test diff between that merge and reviewed `d717aa9` is empty. Root reports current integration checkpoint `98c82efc73be6fafe746d2eb47ec6e6769e9a699`. Accordingly this final review applies to the merged PR46 bytes as well; merger is not Gate J acceptance. Broader new integration changes are outside this review.
- Historical comparisons: `platform-discovery-gate-j-7012a4d-review.md`, `platform-discovery-gate-j-50481ad-review.md`, `platform-live-transport-8f14539-review.md`, and Discovery portions of `platform-owner-pr24-pr25-experience-review.md`, under `docs/progress/2026-11-08/reviews`.
- Authority read directly: repository/package/Discovery/apps/tests instructions; normative interim capability freeze; Discovery shapes freeze; accepted verification consumer handoff, producer surface and relevant producer source. Findings concern assigned correction paths and mandatory Gate J obligations, not new product policy.
- Read-only Git/source inspection. No checkout, HEAD/index/source/DDL changes, database, browser, provider, secret access, external messages or subagents. No tests were run; root owns machine verification. Only this report is authored. Source-derived examples below are not executed reproductions.

Paths and line numbers below refer to PR43/integration HEAD unless explicitly marked PR46. Prefix relative paths with the checkout above.

## Closure matrix: original nine Gate J findings

| Historical finding | Merged PR43 | Merged PR46 additional effect |
| --- | --- | --- |
| J1 final reauthorization / atomic complete admission | **Partial.** All three producer callbacks now repeat current authority after SQL (`verification-tools.ts:194–217,267–270,298–301`). Complete admission revalidation and atomic Discovery claim still missing. | Moves Discovery step claim/activity into producer admission transaction (`supervisor.ts:291–311`, `verification-tools.ts:290–299`); closes the separate-claim portion in source. Missing revalidation and sticky-denial behavior remain. |
| J2 scoped projection / saved responses | **Partial.** Account/source grant filtering and action replay rebuilding fix the concrete revoked-account leak (`repository.ts:143–162,264–267`). Original dispatch/subject/assessment/job-reservation validation remains absent. | Adds job-state join; does not add historical integrity validation. |
| J3 all remaining calls / projected budget | **Partial.** Every remaining request/read now receives SQL semantic checks; projected assessment and cumulative account attempt checks exist (`supervisor.ts:1187–1233`). Full registered candidate validation still occurs only when executing the individual request. No repeat of full preflight in admit. | Unchanged. |
| J4 independent historical recovery | **Partial.** Acquisition and ticks invoke a queued-mapping scan; candidate is reconstructed from saved bytes, bypassing current proposal head/current Discovery registry lookup (`supervisor.ts:344–420`, `service.ts:47–48`). Missing original-history authentication, sticky revoked observation, running uncertainty recovery and scan progress remain. | Unchanged. |
| J5 COMMIT ambiguity | **Closed in source.** `commitAttempted` is set before COMMIT; any rejection thereafter invalidates owner and returns unknown without callback value (`supervisor.ts:240–278`). Ordinary pre-COMMIT errors retain their error path. | Unchanged. Actual lost-ack admission/claim proof still required. |
| J6 pause/capture/current settlement | **Closed in source for the identified defects.** Runnable state, capture recheck and current subject checks now precede success (`supervisor.ts:1539–1572`). | Retains those checks for claimed current success. The old 50481ad `if (!interrupted)` bypass is absent; do not carry that stale regression forward. |
| J7 historical read / exact identity | **Partial.** Input now includes proposal/revision/job and SQL matches them (`verification-tools.ts:318–328`; contracts `:233–235`). Still raw job projection without original-history validation or producer lookup; no read uncertainty observation. | Unchanged. |
| J8 temporary uncertainty / history | **Open on merged source.** Permanent diagnostics still block resume and do not clear on completion (`supervisor.ts:1566`, `repository.ts:179,271`). | Stops appending and excludes old interruption codes from resume blockers; adds diagnostic codes to tool activity. However new projection falsely marks every running job uncertain (finding R5). |
| J9 production release gate | **Closed in source.** `verification-composition.ts:109–111` requires explicit opt-in; normal composition does not set it. Explicit test injection is retained. | Unchanged. No Gate J acceptance inferred. |

## Remaining actionable Gate J findings

### R1 [P1] Revalidate the actual current admission after external preparation

`packages/discovery/src/verification-tools.ts:165–189,221–270` validates only basic step identity/state/generation, runnable run, task status, grants and current proposal/profile/assessment. It does not reload accepted dispatch integrity, first-unresolved position, task attempt/revision, capture, or complete remaining-batch preflight. The preparation gap remains after the earlier rich validation (`supervisor.ts:1076–1087`) and before producer admission (`:1468–1492`). The prepared record does not retain expected task revision/attempt or capture facts. For example, advance the task revision during registry/protected preparation while leaving status running and proposal unchanged: admit still reserves/claims using the new revision, while later settlement rejects the old claim revision. That late refusal cannot undo launched verification.

PR46's atomic claim is a real correction but does not add these missing checks (`verification-tools.ts:197–217,244–299` at PR46). Carry the immutable preflight identity/capture into the SQL-only admission gate and rerun the specified current and whole-batch invariants after preparation. Preserve final reauthorization already added.

### R2 [P1] Complete historical authorization for lookup, recovery, state and read

`verification-tools.ts:165–191,274–301` authorizes a raw step plus run/task; it never validates the original accepted ModelResult, native/step ID and ordinal, dispatch attempt, original proposal assessment or compile association. `bindReadVerificationJob` only joins matching step IDs/proposal keys and checks that hash length is 64 and bytes nonempty (`:318–331`), then reads the job table directly. `repository.ts:143–162` similarly filters grants but omits the specified original-subject trust validation. PR46 leaves these boundaries unchanged.

Producer canonical subject/reservation checks do run for enqueue/lookup and should be credited; they do not authenticate the consumer's missing dispatch/proposal/assessment history, and direct read/state never invoke them. Implement one original-association loader, then use authorized producer `readByRequestKey` for reads. Keep current read-call fencing separate. Preserve the corrected wrong-proposal/job rejection and revoked-account filtering. Publish the accepted bounded proposal/revision/observation success shape with Contracts; current successes still contain only `{ok,job}` (`contracts/src/discovery-construction-tools.ts:249–254`). This does not allege an arbitrary foreign-run job presently succeeds.

### R3 [P1] Persist observed recovery revocation and observe running jobs; ensure scan progress

`supervisor.ts:354–366` scans only queued jobs and silently skips revoked grants; `:385–386` also swallows gate denial without persisting a sticky lifecycle observation. Restore authority and the same abandoned queued request can later execute. Acquisition's paused refencing still only handles source-read names (`:415–418`). Thus the mandatory observed-revocation rule is not met. PR46 additionally returns immediately on preclaim forbidden without durable observation (`supervisor.ts:1554–1556`), despite its “sticky” comment.

Running mappings are never handled by the independent scan, so a paused/stale replacement cannot record the required uncertain-running historical observation. Separately, `ORDER BY request_key LIMIT 32` has no cursor/progress mechanism: 32 permanently denied or invalid queued rows keep every later authorized row unreachable on every tick. The new queued scan is useful, but cannot establish complete recovery. Add original-history authorization, owner-fenced sticky revocation and running observation, and bounded fair traversal; do not relaunch running jobs or change financial state.

### R4 [P1] Validate every remaining registered subject before an earlier batch effect

`supervisor.ts:1187–1223` validates SQL proposal state/profile and cumulative attempts for all requests, but `candidates.getCandidate` and full subject creation occur only for the currently executed request (`:1468–1478`). A valid source-read/finding/verification followed by a SQL-compiled proposal whose registered bytes are unavailable or mismatched passes initial preflight and allows the earlier effect. The later request alone then fails registry validation. This is the still-open full-subject part of original J3, not the now-fixed absent-proposal or budget projection case. Prepare registered candidates for every remaining request outside the transaction; bind them during preflight and repeat applicable checks at admit.

### R5 [P2, PR46 regression] Do not equate a running job with an interrupted execution

PR46 `packages/discovery/src/repository.ts:169–175` emits `VERIFICATION_INTERRUPTED` whenever any authorized mapped job is `running`. A normal job actively executing under the current producer therefore receives “execution outcome is uncertain” before any owner loss or producer uncertainty observation. The consumer handoff expressly requires a recorded interruption observation, not inference from running state or Promise absence. Completion clearing and nonblocking resume are improvements, but are not a correct current uncertainty definition. Persist the producer-derived safe interruption observation/history and project it only while that authorized association remains running. Test healthy running, replacement uncertain running, and later completion distinctly.

## Live transport: historical five-finding matrix and remaining corrections

PR46 does not change transport. These conclusions concern merged PR43.

| Historical transport finding | Current disposition |
| --- | --- |
| T1 transcript loss | **Closed in source.** `live-model-transport.ts:18–47` serializes text, assistant calls and tool results with step-to-native linkage. No longer drops evidence results. New offline transcript test is present. Actual supervisor two-batch proof remains separate. |
| T2 missing usage manufactured as zero | **Core bug closed; error-accounting requirement remains partial.** `:50–56,153` rejects absent/invalid usage. Later parse errors still discard already validated usage. |
| T3 fabricated completion/envelope | **Substantially corrected, partial.** Real IDs/single choice/arguments/known finishes are required; length with calls becomes non-executable limit. Standard message refusal is not checked. |
| T4 optional/invalid meter | **Core optional/invalid-counter bugs closed; accepted live-budget gate remains open.** Meter required and counters checked (`:98–106`); actual-body check added but is unapproved bytes/4 heuristic (`:133–138`). |
| T5 unbounded body / parsing | **Partial, still open.** Safe body/argument error codes and rejection of oversized content added; body is fully buffered before byte check (`:73–81`). Final schema errors still escape. |

### T2 remainder [P2] Preserve validated usage when normalization fails

After `safeUsage` succeeds (`live-model-transport.ts:153`), malformed choices/arguments/finish/content or final result-schema failure throws and loses those known counters (`:155–199`). The supervisor accounts adapter rejection as unknown. This no longer undercounts unknown calls as zero, but fails the specified independently-known usage path. Return a bounded non-executable error result with validated usage for such errors and verify actual supervisor known/unknown counters. Missing usage must remain fail-closed.

### T3 remainder [P1] Recognize message-level refusal before returning done/tool calls

`live-model-transport.ts:158–198` ignores `message.refusal`; only a nonstandard finish value `refusal` is recognized at `:65`. An otherwise valid envelope with `finish_reason:'stop'`, `message:{content:null,refusal:'...'}` becomes `done`, falsely completing the Discovery task. A tool-bearing response with that refusal field can likewise remain executable. Check refusal on the provider message before success normalization and return bounded error without tool calls, retaining valid usage. This is the unresolved refused-output case explicitly requested in the old review, not a new provider feature request.

### T4 remainder [P1 release prerequisite] Obtain the approved actual-input meter before live readiness

The required callback still receives the internal turn (`:99`), not the final provider input; the actual serialized body is checked using bytes/4 (`:133–138`). Neither proves a provider/model-specific token ceiling. This is the same limitation preserved in the PR24 offline-helper review. Keep the helper as an offline approximation; request the narrow Blocker D tokenizer/model policy decision and bind the approved meter to the actual serialized input before claiming usable live readiness. No env/model policy or live provider experiment is authorized by this review.

### T5 remainder [P2] Enforce response bytes while reading, not after allocation

`live-model-transport.ts:74–77` awaits `response.arrayBuffer()` before checking 256 KiB. An arbitrarily large or never-ending successful response is fully accumulated before rejection, retaining the shared-process memory risk from the original finding. Read the stream incrementally, stop/cancel as soon as the bound is crossed, and normalize final schema errors to safe outcomes. The new oversize test uses a completed body; it does not assert early cutoff or bounded bytes read.

## Publication and evidence audit

The PR25 false “Gate J done” claim is corrected: root and Discovery guides and the D4 handoff distinguish merged wiring from acceptance; default verification injection is now disabled. PR24 remains a valid additive offline helper, not live-budget proof. No worker/model configuration, grants, activation semantics or migrations were introduced by these deltas. Do not resurrect the corrected J5/J6/J9, T1 or missing-usage-zero claims in the next handoff. Update old matrix summaries as current findings close, without turning source corrections into acceptance.

New test source includes real-supervisor examples for revoke-after-producer-SQL, narrowed account reads, pause settlement and invalid later verification. These are valuable partial cases. The “recoverAdmittedVerifications claims queued mapping” test (`tests/integration/v4-verification-owner-fencing-edges.test.ts:468–510`) **rewrites an already enqueued financial job back to queued using SQL, then calls the same owner's recovery method**. It does not demonstrate crash-before-claim, actual replacement, service scheduling, or no duplicate launch; this manufactured rewind cannot count as mandatory recovery proof. PR46's uncertainty test does not assert a recorded uncertain observation exists, distinguish healthy running, or confirm completion clearing.

Required exact-candidate evidence remains the actual-owner admission/claim COMMIT-ack-loss barriers; revoke-during-queued-claim and revoked restoration/stale/paused recovery; historical/current-head independence; service-driven queued/running handling; all-batch registered-subject and final-attempt contention; authorized state/action replay; uncertainty lifecycle; and prescribed affected regression suites. Root should report any executed focused checks as partial. Source review, machine results and joint acceptance remain distinct.

`git diff --check 15bb421...d717aa9` passed. `git diff --check dccb0b6^ dccb0b6` reports the Markdown hard-break trailing spaces at D4 handoff line 4. No product finding is assigned for that formatting. No test-pass or Gate J/V4/live/joint acceptance claim is made here.

## Bounded owner requests

1. Discovery: retain PR43 closures; finish R1–R4 and the historical/uncertainty observation path. Preserve PR46's atomic claim and nonblocking resume intent while correcting R5 and sticky denial. Supply a new exact SHA with genuine actual-owner/service barriers, without rewriting financial state to simulate recovery.
2. Contracts + Discovery: finalize/read-test exact proposal/revision/uncertainty output publication while preserving existing VerificationJob wire and strict safe bounds; no generated grants or activation widening.
3. Discovery transport: stream-bound responses, preserve validated usage and reject message refusal; keep unmounted. Platform/Discovery owner: resolve only the existing Blocker D actual-input meter/model policy prerequisite before live mounting.
4. Developer0/root: keep production injection off and merged PR46 Gate J-unaccepted pending corrected source and exact machine evidence. This report requests no DDL, repair/finish policy, live calls, external publication or unrelated feature work.
