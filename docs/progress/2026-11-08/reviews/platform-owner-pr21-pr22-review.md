# Exact candidate review

## PR21 — Contracts for `requestInvestigation`

Base `c1f36052ac6a180b794be1e89140007a367aa9f2` · Head `8a6b1d3ee6dc8fa38a01456f1528bc5e81e21ae7`

**Verdict: reviewed for contracts-only integration.** Zero blocking findings and one P3.

- **[P3] Expose the runtime input constraints in the dormant tool descriptor.** `packages/contracts/src/discovery-construction-tools.ts:298` generates a strict schema with the required input fields, both subject variants and typed exact references. The generated `question` has only `minLength: 1` and the array omits `uniqueItems`. The Zod parser enforces the 8,192 UTF-8-byte question limit, unique exact references and the 65,536-byte canonical envelope. Before advertisement, describe the two byte limits in the descriptor and expose exact-ref uniqueness with `uniqueItems: true`. The current test checks the descriptor's name and size. It would pass if the descriptor dropped those constraints or the required field metadata.
- The proposal's tool table specifies `{subject, question, dependencyFindingRefs}` for a bounded coordinator request. The runtime schema rejects additional and prototype keys through the common strict helpers, uses the frozen source or raw seller/account subject, and reuses the exact positive-revision finding-ref set. Success exposes an opaque `requestId` only. Failures expose a closed code, without proof or authority fields. The existing dispatcher recognizes the name and returns `TOOL_UNAVAILABLE`, and no role imports the new descriptor (`packages/discovery/src/roles.ts:9–33`). The guide's availability statement matches this path.
- **Protected source closure.** The modified contract leaf is reached by Discovery's relative imports. It is outside the root contracts exports, the fixed financial build list and the shared list for both bootstrap build pins (`packages/contracts/src/index.ts`, `packages/evaluator/src/financial-attestation-build.ts:5–29`, `packages/evaluator/src/bootstrap-runner.ts:57–94`). No pinned file changes in this PR, so this delta alone does not require regenerating protected build or proof pins. Reassess if the leaf is later imported into a pinned path.
- **Before mounting.** Resolve the accepted post-Blocker C storage and result semantics, including the opaque acknowledgement and limit failure contract. Enforce the same-run current capture and grant, exact visible dependency revisions, the 20-outstanding-requests-per-task limit, transactional ownership/pause checks and idempotent request persistence. Keep task creation and grant decisions in separately authorized delegation. The contracts-only test does not demonstrate any of those effects.
- **Checks performed.** Matched the supplied diff to `git diff -U10` at the exact range and passed `git diff --check`. A focused Node 24 probe loaded 12 exact candidate modules from Git blobs using installed Zod. It passed a multibyte boundary check, canonical envelope rejection, strict nested ref rejection and deterministic ref sorting, and inspected the emitted descriptor. The checked-in Vitest test was read and was not run in this review.

## PR22 — Malformed argument JSON normalization

Base `6c7d4b47c18d11d1d4a466c73b944877d5d576b1` · Head `17709bf6ad8fc44c6694bffa00554fa952d4c2c2`

**Verdict: reviewed as a narrow offline correction.** Zero new findings. Changes are still required before mounting the transport for live use. The base contains PR17's `8f14539` candidate. The following statuses refer to the five existing findings in [the tracked PR17 review](/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution/docs/progress/2026-11-08/reviews/platform-live-transport-8f14539-review.md).

| Prior finding | Status at PR22 head |
| --- | --- |
| 1 · P1 transcript preservation | Open. Lines 32–35 still transmit text messages only and omit tool-call/result turns and the authorized evidence they carry. |
| 2 · P1 truthful usage | Open. Lines 93–96 still default missing counters to zero. A malformed-argument rejection at line 81 also discards valid usage and follows the supervisor's unknown-accounting path. |
| 3 · P1 strict completion state | Open. Lines 64–98 still permit synthesized IDs or arguments, missing choices normalized to completion, and executable tool calls with inconsistent finish reasons. The new catch covers exceptions while mapping calls and supplies no envelope/state validation. |
| 4 · P1 preflight budget | Open. Lines 12 and 28–30 still make estimation optional and permit invalid estimates through the existing comparison helper. |
| 5 · P2 bounded, sanitized response parsing | Partially addressed. Lines 73–82 replace malformed argument JSON and call-map exceptions with `MODEL_PROVIDER_ERROR`. Body read/JSON errors and normalized-result Zod errors still escape, and the body remains unbounded before parsing. Oversized message text still gets truncated at line 83. |

- **Before mounting.** Close the four open P1s and the remaining P2 under the approved Blocker D configuration and tokenizer policy. Supply actual supervisor transcript, accounting and error-path evidence using the final exact integration candidate. The correction changes only the Discovery transport and its test. It leaves protected build manifests, default composition and Gate J unchanged.
- **Checks performed.** Matched the supplied diff to `git diff -U10`, passed `git diff --check` and confirmed PR17 ancestry. An offline Node 24 probe against exact candidate blobs and mock responses confirmed malformed argument JSON produces the fixed error code, while a JSON array argument and malformed response body still produce raw Zod and syntax errors, respectively. The checked-in test at `packages/discovery/test/live-model-transport.test.ts:81` covers the malformed argument syntax case. Neither PR's full suite, database checks, browser workflow, Gate J or live-provider acceptance were run or established.
