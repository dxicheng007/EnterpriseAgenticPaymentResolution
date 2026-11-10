# Independent D0 configuration plan review

Date: 2026-11-10

Candidate: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution/docs/superpowers/plans/2026-11-10-discovery-model-configuration.md`

Verified candidate SHA-256: `9ab2c18d4032018eeb1ac2f6ce5609c2ec0bceda12824c8bba1be58037165564`

Accepted design SHA-256: `8dd506cb483242069c8b140c83c2598de11110452225e352f2c5548271fa76d9`

**Behavioral spec: PASS. Quality/execution: CHANGES REQUESTED. Overall: revise the one verification step before execution.**

## Actionable finding

**[P2] Require behavioral red evidence after the import failure — plan lines 87–93.** Step 2 explicitly records a missing module/export as its expected red result, and Step 3 then proceeds to complete implementation. The applicable `docs/superpowers/plans/2026-11-08-implementation-plan.md:82` explicitly says a failing import/setup step is not behavioral evidence and requires observing the intended assertion fail once the minimal module exists. Following this plan literally would produce red/green handoff evidence without that mandatory assertion failure. Amend Step 2 or the beginning of Step 3 to create the smallest compilable exports, rerun the focused suite, and record an intended parser/hash/resolver assertion failure before completing the implementation. Keep the missing-import result only as setup evidence. This requires no additional file ownership or test category.

## Checks supporting the behavioral verdict

- The configuration branches, complete policy fields, fixed four ceilings and bounded identifiers/hashes match accepted design section 3. The existing contracts package exports `strict`, `guardKeys`, `IdSchema`, `HashSchema`, their types and `hashCanonical`. Guarding the union and reusing one strict policy schema supports the required special-key rejection without a second validator.
- The hash helper validates the runtime value through that same schema, uses the exact domain-separated preimage, rejects a supplied self-hash, and exposes only the specified safe error. Identity-change and key-order assertions cover the relevant accepted variation; changed fixed ceilings are rejected rather than assigned another identity in this version.
- Parser `undefined` is invalid; only resolver omission defaults to disabled. Explicit malformed inputs remain invalid. Every valid configured input remains unavailable with `MODEL_LIVE_RELEASE_PENDING`; exact-object assertions prevent client/policy/hash/detail leakage.
- Existing `composeDiscovery` accepts optional injected `modelClient`; the actual local composition omits it. Leaving both unchanged is consistent with the accepted review's no-unused-scaffold note and avoids a dummy factory, unused option or second model stack.
- The release names only the new control module and its unit test. Existing Vitest unit inclusion covers the proposed test path, and the package scripts support the specified focused unit and typecheck commands. No database/provider/source integration proof is claimed; default composition and saved history are explicitly preserved by unchanged code rather than represented as newly tested.
- The later dependency direction is explicit: trusted control supplies policy/hash and dependencies to Discovery. Discovery cannot import the app module or copy its schema; a coordinated shared server-only extraction or injected validation port precedes lower-layer validation. Strict turn-limit projection and ordinary pause settlement guardrails are retained.
- D0 grants no live mounting, provider/access selection, credential handling, runtime/browser changes, financial authority, Blocker D closure, Gate J/V4 acceptance or joint acceptance.

## Basis and limitations

Read the complete plan, accepted design and its repository design review; repository/apps/packages/Discovery AGENTS; PRD thesis/process boundaries/acceptance; execution and verification conventions; shared ownership; F1/foundation freeze; joint verification rules. Inspected actual contracts common/canonical/index APIs, control composition and Discovery composition, Vitest inclusion and workspace script definitions. Verified both document hashes with `shasum -a 256`.

Read-only review: no repository edits, Git operations, tests, database operations, provider calls, credential/environment inspection or subagents. The sole output mutation is this requested report. This is plan review, not source implementation approval or machine evidence.
