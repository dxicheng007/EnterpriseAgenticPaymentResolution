# Independent whole integration-branch review

Candidate: `b67b1cd7fee15ff629b49e36907fa20c7b05b62d`.
Comparison base: current main `c8ed64265755963ec94164b5ddd1440e9245c0c7`.
Scope: completed A4 + A5 integration, cross-module composition, authentication/session boundaries, operational startup, compatibility, migration order and evidence honesty. This review is separate from the concurrent detailed A5 authority review.

**Specification verdict: pass for this bounded integration lens. Quality verdict: pass with one nonblocking documentation correction. No new blocking defect identified.** This does not supersede the A5 authority review or constitute V3/browser/joint acceptance.

## Findings

No blocking source finding in the reviewed combined candidate.

**Nonblocking stale status documentation:** root `AGENTS.md` still says the prerequisites are “without mounted approval authority” and “activation ... remain[s] planned.” The new default supervisor explicitly mounts review/activation and worker receipt/application routes, with missing setup failing closed. Update this current-state paragraph after bounded A5 acceptance to distinguish implemented authenticated first activation from pending browser workflow, synchronization and full V3 acceptance. The new app/script/setup documents already make that distinction. Historical resumption-status entries are chronological and later explicitly superseded; their earlier open-PR/A5-unimplemented snapshots are not evidence of an unsafe runtime.

The recorded upstream PR8 ParentView session-renewal/grant-change P2 remains unresolved in the supplied evidence. It is not introduced by this branch: no UI file differs from current main. Keep it attached to Experience/browser acceptance rather than attributing it to A4/A5 or claiming full V3 completion.

## Composition and boundary assessment

- `createLocalComposition` mounts activation through existing feature plugins and the same server-managed reviewer authorizer. Review mutations require the established mutation authorization (cookie/origin/CSRF). Account and stored source grants precede intent recovery/conflict results. The prior A4 authorization correction is retained. Exact authorized retry uses immutable intent association and preserves original reviewer/bundle rather than treating the new session as new approval.
- Control delivery asks the worker for the exact scoped receipt before publication/application. A missing receipt permits canonical intent publication; dependency uncertainty stays pending, and recognized policy/source/conflict failures preserve safe diagnostics. A failed mirror cannot substitute for runtime truth. Public activation state remains the existing authenticated worker-backed read.
- Worker activation and receipt routes authenticate the service capability before application lookups. Receipt queries reject duplicates/unknown selectors and require scope plus both hashes. The source adapter uses a separate token, fixed loopback origin, configured source allowlist, bounded timeout/body, redirect rejection and requested-source validation. Neither browser credentials nor request-selected source URLs become private service authority.
- Startup migrates and seeds before listeners, supplies only allowlisted per-role environment values, gives the worker runtime credentials and source-read capability, and leaves protected evaluation paths on control. Missing policy/selection does not remove existing source/preview/parent routes or produce authority. Independent process policy loading and restart requirements match the operator guides.
- Existing source, preview, parent and Discovery composition is retained. No implementation diff in compiler, finance, evaluator, source, Discovery, browser or their contracts was introduced. The new worker uses existing runtime storage/locks and whole-transaction retry facilities, not a new competing parent persistence layer. Control008 follows control007; no runtime migration or historical migration rewrite was introduced.
- The Discovery verification adapter is a design/review artifact only. It explicitly keeps SQL numbering/reservation and producer implementation separate; no adapter tool, migration009 or live-provider behavior is advertised as implemented.

## Evidence and limitations

Read the supplied branch diff first, then root/app/script/database instructions, P1/P2 ownership and acceptance text, A4/A5 reports, prior A4 initial/correction reviews, resumption status, A5 handoff, operator guides, and the implementation seams noted above. Detailed authority arithmetic/proof correctness is additionally covered by the separately assigned A5 reviewer; this review does not replace that assessment.

Independent read-only checks: HEAD equals the candidate; working tree was clean; current main is an ancestor; `git diff --check` passed. Migration SHA-256 values match the recorded retained identities: control007 `f9c0883a6da0e5ae25c04c8fe566682c72e2acfcc9f22a88e2e0105a83b9f35b`, control008 `956127c4414c86ab5ffe4bd630cabd333662fb61688af540a8b19184b97b0a54`, runtime002 `a06874e335f6acfd6f62d89760c00c76059c95b9ab05782707999ff70f8ddc56`.

No source edits, broad test reruns, database use or subagents. Machine results cited in tracked reports remain builder/integrator evidence, not independently rerun results here. Reported supervisor smoke has no installed policy; issued-proof imports use disposable databases and real composed services. Live model execution, ongoing sync, actual browser approval/import acceptance and joint user acceptance remain unclaimed.
