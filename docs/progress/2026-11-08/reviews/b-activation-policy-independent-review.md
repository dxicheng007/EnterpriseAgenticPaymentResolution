# A2 activation policy/publication — independent review

Transcribed by root from `/root/astra_activation_policy_verify`'s final review; root did not author the verdict.

**PASS for the bounded A2 implementation. No actionable findings.**

Reviewed clean candidate `bc272a5127af0e288cc46ae7617f00de5ffee244` against `dbda6725eb21328871089b28c3da0e7d6af8b0a0` in the acquisition-sources worktree. Verdict applies only to that candidate. Joint acceptance remains pending.

## Specification judgment

The implementation follows the accepted A2 handoff, its independent clarification, and v4 authority architecture.

- Operator preparation validates registered capture, selected profile/scope, protected descriptor, distinct financial evidence and bootstrap descriptor pins, fixed builds, and actual persisted financial provenance. Correctly hashed singleton validation policies prevent a report for another same-capture pin from satisfying the selected entry. The integration test exercises that exact substitution.
- Protected descriptor access stays in the operator script. Only explicitly selected safe fields enter policy artifacts. The public storage policy export exposes only loading; installation remains a private source helper. No new SQL, activation route, runtime credential, model dependency, or approval authority is introduced.
- Policy publication separates immutable candidates from explicit atomic installation. Preparation rechecks captures, descriptors and builds before publication. Independent loaders validate canonical representation, semantic hash, nonempty entries and filesystem trust, then recursively freeze separate snapshots.
- Registered scope publication derives members from registered candidates, validates source/scope/profile/manifest bindings, rejects duplicate accounts and scope changes, retains unrelated accounts, and locks read/merge/publication. Readers capture one index and validate its complete immutable member set before exposing resolution. Missing state does not become an empty valid snapshot.
- Bundle publication requires the injected committed-intent association and compares exact intent identity, strict request/reviewer values, canonical bytes and hash. Immutable publication uses no-replace linking and byte equality on retries. Bundle reading does not depend on current policy, preserving the transport prerequisite for later old-authority receipt recovery.

## Quality judgment

The implementation is suitably bounded and cohesive. File handling checks same-user private directories/files, physical normalized directory identity, no-follow regular-file reads, explicit size bounds and canonical bytes. Current pointers use atomic replacement; historical members and bundles reject conflicting existing bytes. Diagnostics avoid exposing paths or protected content.

The configured root remains supervisor trust input under the documented trusted-laptop/same-OS-user assumption. Hashes and issuer identifiers are not treated as independent authentication.

## Verification judgment

Builder evidence reports typecheck, 20 focused unit tests, five integration tests, CLI missing-argument failure and diff checks passing. Reviewed test code uses genuine fixed-child A/B financial completions and protected descriptors for policy preparation; bundle transport tests deliberately use an injected intent seam.

Independent commands:

- Confirmed candidate SHA and clean tracked/untracked status.
- `git diff --check dbda6725eb21328871089b28c3da0e7d6af8b0a0 HEAD` passed.
- Recomputed fixed build digests through public build readers:
  - Financial: `c5140fb37a4deffc8f8183b64cc8fbfd2fcc6d9bdf14b892eb6b622619684c6e`
  - Bootstrap evaluator: `e81ebd3f7d03baa2c0adcf5509be98432816abb89cd5f0c187a413a56c24c586`
  - Bootstrap subject: `ee7eecf0c88218b8c74198a0abd02b6401a355fe0d03f57b725dbcce7bd1aa34`

These match the builder report. Broad suites were not repeated. No edits, commits, installation, or subagents were used.

## Remaining boundaries

The storage package export changes the financial build closure. Fresh final financial proof and explicit operator policy preparation/install remain required after merge and source stabilization. This review establishes neither a deployed current policy nor customer approval.

Independent startup loading, authenticated composed parent reads, target-bound combined readiness, actual control008 durable intent transactions, runtime grants and successful receipt replay remain downstream work. The old-bundle test proves policy-independent transport reading, not end-to-end receipt recovery.

The previously rejected optional negative CLI invocation was not repeated. No production installation was attempted.
