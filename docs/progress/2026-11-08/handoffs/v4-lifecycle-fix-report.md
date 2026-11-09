# V4 lifecycle architecture fix report — round 1/5

Architecture text only. Required review: v4-lifecycle-independent-review.md. No implementation, tests, SQL, product edits, commits or live calls.

- Baseline handoff SHA-256: `0773a3c9c6750010adfd138a9435f477a5e3a23cbd77857bd08e96a615a68aa8`.
- Revised handoff SHA-256: `9ec9a626f70ba956be479ba08fbc6c7c568c9edc0f54c39d65a59c86be074ac0`.
- Separate source prerequisite brief SHA-256: `c553fb1234516f079c92879411c777db9aacfe63ab6ac6a3a7541b0a9d3dedee`.

## Required fixes

R1: Replaced ambiguous timeout wording with reserved→interrupted atomic transition, persistent blocker and one durable unknown-accounting marker. Result acceptance requires still-reserved state. Same-owner late callbacks only settle/release the permit; they cannot persist output/known usage/tools or clear blockers. Timeout/result race is resolved by committed dispatch state. Recovery reuses the marker and cannot count/publish interruption again. Added timeout→pause/resume→late success→owner replacement barrier proof plus result-first ordering.

R2: Start ordering now explicitly separates current authentication/authorization and exact actor/key lookup from new creation. Authorized identical replay returns saved response without capture/configuration refresh, scheduling or writes; revoked policy rejects replay. Only new key requires model configuration and exact validated capture. Added configuration-disappears replay, new-key503 and revoked-policy replay cases; updated blanket unconfigured wording accordingly.

Inherited dependencies: activity f2b5545 is accepted/integrated at a356b11, not a pending gate; failed/interrupted predecessors leave dependents waiting with blockers. No expansion of lifecycle scope, migration reservation, public schemas or parent privileges.

## Separate source-owner prerequisite

`b-discovery-capture-read.md` specifies exact readDiscoveryCapture input/result, existing SourceError and later route adapter, narrow source/test paths, reuse of inspectBaseline and canonical capture helpers, source/citation membership validation, zero writes, corruption/barrier tests and explicit no-grant/no-candidate output. It remains a separate approval/dispatch and does not block L1. No validator implementation was produced.

Review readiness: text checked against required R1/R2 and inspected existing source interfaces. Machine/implementation tests not run because no implementation changed. Root sends the revised exact hashes to fresh independent review.
