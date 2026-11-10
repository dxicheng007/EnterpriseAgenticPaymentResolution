# A5 implementation and verification

The worker now applies the first explicitly approved import for one customer and returns the runtime receipt. It authenticates private activation and receipt requests, resolves an exact stored receipt before reading current policy or source state, independently checks a new bundle and current source semantics, and recomputes the approved plan under fresh PostgreSQL locks. Control delivers the committed intent and mirrors the exact worker receipt. If mirroring fails after worker success, control returns the same 202 pending intent and the next retry reads the authoritative worker receipt first. `ALREADY_ACTIVE` remains a safe 409 and the authorized consumer can inspect the existing scoped activation GET.

The production checkpoint is `49fed3bc32fe5241fb19451c67e586bca561b84c` on accepted P1 `17d6714e6fb9264750a7575f28a41b951a94a90d`. The follow-up adds focused tests, the [worker activation setup guide](../../../demo/worker-activation-setup.md) and current setup guidance. No migration bytes or evaluator, compiler, source or financial contracts changed.

## Verification

- Typecheck passed. The full unit run passed 421 tests across 66 files.
- The three A5 integration files passed five named tests. The real HTTP and PostgreSQL test creates both synthetic captures, issues real financial attestations and target-bound bootstrap results, and explicitly approves A while B remains inactive. It verifies A's original financial records, 80,000-cent cutover balance, metadata, lineage, epoch, complete cursor vector, version increment and one activity. A separate explicit B approval imports original records with a zero balance and leaves its unidentified remittance without an applied outcome.
- The same test covers same-key replay and conflicting hashes, competing keys for B, an alternate-account writer holding a global economic identity against real A, PostgreSQL rollback after thirteen writes including an existing pointer update, 40001 and 40P01 retry and exhaustion with pooled client reuse, source and policy failures racing an exact success, lost response and mirror failure, historical target reads and receipt recovery across restart, current registration change and unavailable policy or source. Selected and source-wide blocker tests deliberately reseal altered bytes under a test-only policy to reach the locked replanner. Only the real issued A and B subjects successfully apply.
- Seven adjacent serial integration files passed 46 cases covering storage and role separation, parent reads, source semantics, operator policy, publication, intents and the A4 composition.
- The ordinary supervisor started and restarted on leased control 3241, worker 3242 and web 5182, with PostgreSQL 55441. Health and private activation, receipt and source paths responded as expected. Worker environment key inspection and a 296-module transitive import check confirmed the runtime role's dependency and credential boundaries.

The supervisor smoke used the ordinary demo startup with no installed policy. The issued-proof import and restart tests used disposable databases and real composed services. Independent review of the exact candidate, the browser workflow, the full V3 slice and joint acceptance are separate.

## Exact review correction

Independent review of `b67b1cd7fee15ff629b49e36907fa20c7b05b62d` found that mirror persistence failure escaped after worker success. The recovered path returned 503 and the new application path propagated the exception. Both expectations failed before the correction. The delivery adapter now returns the unchanged pending intent on either mirror failure. The composed PostgreSQL test verifies the exact 202 body and unchanged intent, then recovers and mirrors the original B receipt after restart. The adapter test covers new application, the same pending identity and receipt-first retry without republication or reapplication.

Typecheck and both covering integration files passed after the correction, totaling five tests in 22.57 seconds on the same PostgreSQL lease. Earlier broad results above refer to the original reviewed candidate.
