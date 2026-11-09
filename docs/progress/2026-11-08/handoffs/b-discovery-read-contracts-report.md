# D0 discovery read tool contracts

Base `633651778cfd4f5176831c8286f01132fd142a9f`. Candidate `0f0fca3a9d0a429aa792b0da5ce854e6f8d17542` on `codex/discovery-read-tools` in the acquisition-verification-startup worktree. Candidate status clean at handoff.

Authority documents match SHA-256 `c9cd2d998bcf2c1f2eef0af02e2163f2953f1a1e9ab21fcdf567d1c6d69ad4c0` for the accepted evidence tools brief and `525cef67a236ef4cb0c42d313e6fd62077a468c5027e72a39ae35f8fd146acce` for the implementation handoffs.

## Paths and exports

- `packages/contracts/src/discovery-tools.ts` adds `DiscoveryReadToolNameSchema`, the four `DescribeSourceInputSchema`, `QuerySnapshotInputSchema`, `SearchEvidenceInputSchema`, `ReadEvidenceInputSchema` parsers, `DiscoveryReadToolCallSchema`, `DiscoveryCitationIdentitySchema`, `DiscoveryReadToolFailureSchema`, and the four corresponding per-tool result parsers. Each parser has its inferred type without the Schema suffix. `DiscoveryReadToolResult` is the union and `discoveryReadToolSchemas` is the readonly four-descriptor tuple. Consumers correlate tool name and result using the named parser. The module uses browser-safe imports.
- `packages/contracts/src/index.ts` adds one root export line, preserving A0 exports. `packages/contracts/test/discovery-tools.test.ts` adds ten focused contract tests.
- `packages/evaluator/src/bootstrap-runner.ts` adds the new module to the shared recursive closure. `packages/evaluator/test/bootstrap-build.test.ts` exercises the new module through the shared source-byte mutation test. This changes subject/evaluator build fingerprints by design.

Search query validation follows the existing helper's 256 UTF-16-unit limit. The descriptor uses JSON Schema minLength/maxLength and documents the authoritative UTF-16 rule, since standard JSON Schema length counts code points. The read range descriptor documents the strict half-open relation, enforced by the runtime parser. Result validation rejects noncanonical JSON numbers without coercion and measures canonical UTF-8 size over the complete parsed envelope. Runtime parser boundaries are necessary even when provider input checks run.

## Checks

- Node `v24.22.2`.
- `npm run typecheck` passed.
- `npm run test:unit -- packages/contracts/test packages/evaluator/test/bootstrap-build.test.ts` passed, 13 files and 138 tests. The new suite was first run against the missing module and later caught a Unicode length mismatch, corrected with explicit UTF-16 measurements.
- `git diff --check` and `git diff --cached --check` passed.

This is a partial D0 contract checkpoint. D1 source membership, authorization, preparation, ranges against original text, and result hashing await its separate authorization and DB lease. D2 owns descriptor advertisement, supervisor integration, and recovery. No integration/DB, live provider, construction, financial verification, activation, or sync proof is claimed. Fresh independent candidate review is pending.
