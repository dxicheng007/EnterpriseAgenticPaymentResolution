# A3b independent exact-candidate review

Reviewed candidate `0c7a0955a0ca9faeed3febf2218e07c93d647ae1` against base `fcbc0cf969bd965c115d07eb76ed250ea1f70d17` in `/Users/devincheng/.codex/worktrees/acquisition-evaluator/EnterpriseAgenticPaymentResolution`. HEAD matched and the worktree was clean. Review used the frozen A3b handoff in the main worktree, the implementation report, changed production and test code, the A2 reader/publication implementation, parent storage readers, and strict transport schemas. The authorized fixture extraction, test composition changes, and narrow PreviewPage copy correction are included in scope.

## Finding

**[P2] Clear stale registration failure after recovery** — `apps/control/src/composition.ts:183` (startup cache at lines 166–168).

`registrationFailures` is populated once during startup and never updated. Every later catalog refresh returns `PARENT_READ_UNAVAILABLE` for those accounts even after its real authenticated parent probe succeeds. This occurs when candidate registration has a transient storage failure at startup, the operator repairs the storage and registers/publishes the exact subject (or an already registered subject is available), and a later preview successfully completes the same registry registration. The catalog continues claiming parent records are unavailable until process restart, despite successful parent reads and preview. This violates the handoff's current-availability/recovery behavior and makes the documented “Complete registered-scope setup and retry” / Refresh candidates recovery inaccurate. Revalidate/clear the failed registration condition after repair (without silently publishing scopes), and add a regression covering failed startup registration, preserved source inspection, successful repair/publication/preview, and refreshed diagnostics clearing. The new composition test covers missing publication and worker outage recovery, but does not inject registration failure or exercise this stale failure set.

This is a static code-path finding: membership in the captured Set is unconditional after a successful live probe, with no delete, replacement, or retry path. No speculative financial or authority changes are requested.

## Verified code properties

- Normal startup mounts both worker read routes and reviewer proxies, with fixed loopback authenticated HTTP and the separate runtime/control pools. No activation mutation is mounted by these changes.
- Worker read services use a single real A2 `readSnapshot()` result per request. The reader validates all immutable members, and the service uses its captured entry; the held-read integration test performs a real atomic publication replacement.
- Worker auth precedes route parsing and registry access. Control requires account grants before registry access and source grants from trusted registered metadata before forwarding. Parent response schema, complete scope, version/records association and recorded snapshot hash are validated; activation schema validates paired scope/identity facts.
- Inactive latest reads synthesize only registered version-zero metadata at manifestAsOf; selected missing snapshots return 404. Actual reads use the existing SELECT-only store seams and release clients. Query evaluation time is separate from recorded snapshot time/hash; the preview adapter copies only planning asOf.
- Activation reads preserve stored activation/initial receipt rather than substituting current profile bindings. Tests retain historical snapshots after latest advances and after registry replacement.
- Production has no empty-fixture fallback. Registration is source-derived and independent of verification pins; publication stays explicit. Registration exceptions are caught so source routes/catalog remain mountable, subject to the stale diagnostic issue above.
- Test edits preserve original financial, evidence, CSRF and verification assertions while replacing whole-flow target fixtures with actual publication/HTTP reads. The isolated source/verification tests explicitly retain their previous empty fixtures. Browser copy assertions now match persisted-parent mode.

## Evidence and limits

Independently ran exact HEAD/status checks and `git diff --check fcbc0cf969bd965c115d07eb76ed250ea1f70d17..HEAD` successfully. No production/test code was edited and no commits were made. This review did not repeat the builder's 42 integration tests, two browser tests, typecheck, or normal-startup operator publication smoke; those remain reported builder evidence, not independently rerun evidence. No live discovery, approval, activation mutation, synchronization, slice gate, or joint user acceptance is established here. Protected source-closure hashes and final exact-candidate machine proof remain root-owned.

Disposition: request the narrow P2 recovery correction and focused regression before accepting this candidate. No additional blocking finding identified in the reviewed A3b read-only behavior.
