# D0 discovery read contracts independent review

Reviewed candidate `0f0fca3a9d0a429aa792b0da5ce854e6f8d17542`, parent `633651778cfd4f5176831c8286f01132fd142a9f`, in `/Users/devincheng/.codex/worktrees/acquisition-verification-startup/EnterpriseAgenticPaymentResolution`. Reviewer task: `astra_discovery_read_contracts_verify`, separate from builder and supervising root. HEAD matched the assigned candidate and its working tree was clean during review.

Spec verdict: reviewed, no actionable findings. Quality verdict: reviewed, no actionable findings. This recommendation applies only to the D0 checkpoint and the exact candidate above. Joint user acceptance remains pending.

## Scope and authority

Reviewed all five changed files against the accepted evidence-tools brief (including E1/E2), the implementation handoff's D0 requirements, the builder report, applicable repository/package guidance, representation/evidence freeze, and verification conventions. D1 source authorization and D2 lifecycle execution are outside this review.

Root explicitly authorized adding `discovery-tools` to the bootstrap runner's shared closure and its existing source-byte mutation test. These two narrow changes preserve the root contracts export's complete runtime closure. They introduce no evaluator behavior or source-access privilege. The index change is additive and preserves the existing exports.

## Findings and reasoning

No blocking or nonblocking actionable defects were found in the assigned scope.

- The four input parsers and discriminated internal call schema are closed and recursively strict. Model inputs cannot choose capture bindings, grants, run context, or arbitrary tools. Range endpoints use existing safe integer validation and require a positive half-open span.
- Descriptors match the accepted fields and bounds. The search runtime bound is 256 UTF-16 units, consistent with the root ruling and existing helper; its description states that unit. Standard JSON Schema string-length counting is not asserted to be identical. The range relation is documented and enforced by the runtime parser.
- Results reuse the source contract/event/locator domains, with no financial coercion. The strict citation projection excludes the original excerpt and URL. Returned read text has a positive coordinate span equal to its UTF-16 length and a maximum of 8,192 units. Original-relative range validation, surrogate boundaries against original text, and hash verification correctly remain D1 responsibilities.
- Query results reject duplicate event IDs, duplicate stream/sequence positions, unordered rows/citations, and malformed continuation IDs. Describe results require resource/stream ordering and uniqueness; search results preserve lexical citation order and helper fields. Source membership and current filtered cursor authority are not claimed by these structural checks.
- The shared result wrapper checks the complete parsed envelope against 65,536 UTF-8 bytes. For accepted canonical JSON values, object-key sorting cannot change byte size. Noncanonical numbers and undefined result values are rejected without coercion, consistent with the existing discovery/canonical boundary. Imports from the new module remain browser-safe; it imports neither canonical hashing nor Node crypto.
- Focused tests cover all tool names, mismatch and extra-field/prototype rejection, numeric and UTF-16 limits, ordering and duplicates, safe failures, strict citation projection, coordinate consistency, and the exact 65,536-byte boundary including locator metadata. The authorized bootstrap test mutation extends the existing fingerprint proof to the added module.

## Verification evidence and limits

Reviewer executed read-only candidate inspection (`git rev-parse HEAD`, `git status --short`, complete candidate diff and relevant source/test reads) and `git diff --check 6336517..0f0fca3`; the diff check passed and status was clean. No code, branch, commit, database, provider, or runtime changes were made.

Builder-reported machine evidence: Node 24.22.2, passing `npm run typecheck`, and passing `npm run test:unit -- packages/contracts/test packages/evaluator/test/bootstrap-build.test.ts` (13 files, 138 tests). These suites were not duplicated in this review, per root instruction; review found no concrete concern requiring an additional execution probe. The builder report also records passing working/index diff checks.

This is partial contract proof only. It does not establish source membership, account coverage, exact text selection/hashing, real tool advertisement, batch atomicity, supervisor recovery, live model construction, financial verification, activation, sync, or full V4 acceptance. D1 and D2 require their own exact-candidate review and behavioral evidence.
