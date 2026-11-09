# S3a runner handoff independent architecture review

Verdict: **Approved for dispatch of the specified S3a implementation, including the private evaluator-only fd 3 adapter and root-assigned `tests/integration/bootstrap-runner.test.ts`.** No blocking omission or contradiction found. This is handoff approval, not implementation or execution approval.

## Exact reviewed identities

- Main inspected: `f027faefcd97301561188f9aaf4b8218184157a3`.
- `b-bootstrap-runner.md` SHA-256: `eb6b4775e60e044a41aaae9f35c7791ab20ce9edde335d457e74ced34755c2fd` (matches the assigned candidate).
- Handoff report SHA-256: `c52b5beada397ff4c671baf6e7acb767fdd1a4c7b8a09b4decff2a2b05553087`.
- Accepted proposal SHA-256: `dbd085abf914a0433e0f15423895a5082988acc4a05a7ce064fb825a319f1fa7`.
- Accepted S2 candidate: `e212cbd1e2a3b32bef65e3c44e3aa626272ab04c`; its report and independent review were read alongside current APIs.

## Findings and boundary decisions

1. **Registration provenance is concrete and sufficient for this trusted composition.** Existing `registry.ts:getCandidate` first resolves `artifact_captures`, verifies immutable stored byte hashes and object identities/hashes, and revalidates candidate registration. The brief requires that actual implementation (or a trusted adapter retaining those semantics), canonical equality of all returned artifact/profile/manifest/snapshot objects with the parsed launch request, and only then derivation of `snapshotObjectHash`. This agrees with `prepare-bootstrap-verification.ts` and S2's `validateCapture`. Request-local hashing cannot replace the registry read. Full snapshot equality additionally rejects changes to array order that protected capture-content normalization alone might tolerate.

2. **fd 3 is dispatchable without changing the frozen stdin or completion wire.** The explicitly separate strict context contains only registration metadata, request digest, and fixed operator roots; it is created after the trusted registry read. The evaluator and subject retain their exact proposal §4 stdin types. Request binding, missing-context rejection, strict framing, 10 MiB bound, lifetime bound, concurrent draining, and stream teardown are specified. Subject spawning receives only the three standard streams and an empty environment. No generic entrypoint/config transport is exported, and neither model nor browser selects the registry port, executable, pin, or roots. A structural callback is explicitly not treated as an attestation. The adapter is trusted local deployment plumbing, not authentication against a hostile same-user process or permission for a public submission path.

3. **The named transport risks have an implementable seam.** Current `runner.ts` fixes Node execution, disables the shell, clears environment, bounds output/time, discards raw stderr, and tears down evaluator process groups. Its existing exported exchanges hardcode the old schemas and cannot be reused by casts. The assigned minimal internal extraction can support the new fixed wrappers and extra pipe while preserving those existing semantics. The handoff expressly requires fd 3 closure on every outcome and prevents inheritance into subject processes. These requirements must be demonstrated by the implementation tests; this review does not claim that the current three-stream transport already implements them.

4. **Build binding covers execution rather than a label.** Explicit final transitive file lists, sorted byte-derived entries, manifest self-inclusion, missing/duplicate rejection, and pre/post launcher and evaluator checks satisfy the accepted proposal. The evidence barrel and existing runner/protocol edges are specifically included. The brief requires tests against temporary copies and a changed-during-run rejection. Final closure completeness remains a code-review obligation once imports exist; the current enumerated families are a checklist, not a preapproved final digest.

5. **Actual subject output and coverage remain preserved.** The brief incorporates the exact nine-assertion/ten-case table and §4 completion obligations, retains the single captured-baseline schema/hash-valid observed plan before comparison, validates both plan and canonical-byte hashes, and forbids oracle reconstruction or a second planner invocation as its replacement. A valid comparison failure may retain that observed plan; transport/preflight failure cannot produce a successful launcher envelope. Synthetic cases cannot replace primary request bindings or real positive execution.

6. **The new integration assignment closes the pre-S3b proof gap without claiming persistence.** Real A/B construction uses genuine registry/capture/operator preparation, fresh protected roots, fixed evaluator and subject processes, all cases/assertions, unchanged v2 bytes, and B's nonempty financial plan at zero balance. Missing/foreign associations and exact snapshot changes exercise the real registry boundary. Rehashed support mutants must be registered and distinguished from executed comparison failures. Unit scripted children remain transport/comparator evidence only. The separately named S3a test avoids S3b's reserved integration file and does not require production API widening.

## Limits and later gates

No code, tests, databases, subagents, or executable behavior were changed or run. Review used the accepted proposal §§4–6 and S3a/S3b handoffs, accepted S2 report/review, current registry/operator/oracle and transport/launcher seams, and applicable package/evaluator guidance. Only this report was written.

S3b still must allocate/reserve exact requests durably, validate and atomically persist the actual completion bytes, reject conflicting duplicates, and revalidate after restart. S3a's caller-supplied trusted job ID and real registered capture are not proof of those properties. Financial capture/evidence-pin attestation, permitted issuer/build policy, parent authority, readiness, activation, and joint user acceptance remain separate. No financial or product behavior is newly selected by this handoff approval.
