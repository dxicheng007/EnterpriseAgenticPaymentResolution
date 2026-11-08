# Owner A independent evidence-producer review

Base: `3483d6b284901bfb56153c510b97196371d5b386`
Candidate: `bb59309388cab3e8ef6e8043c0d24a21ec33eb3c`
Review checkout: `/Users/devincheng/.codex/worktrees/acquisition-review/EnterpriseAgenticPaymentResolution`

**Specification verdict: PASS for owner A's bounded producer scope.**
**Quality verdict: PASS.** No actionable findings in the three-file change. No product edits or commits were made. Final `git status --short` was empty.

Reviewed root, scripts, packages and sources AGENTS instructions; frozen evidence-v2-contract.md; A handoff in evidence-v2-handoffs.md; owner A report. Read the supplied exact diff once. Unchanged code inspection was limited to named risks: fee/identity declaration provenance, byte rendering, ordering/build hashing, extractor output and v1 decoder/test interfaces.

## Evidence and reasoning

- Pre-render independence: `scripts/generate-fixtures.ts:194` and `:201` declare A's effective dates and complete literal lines from canonical account declarations and explicit cent schedules. `packages/sources/src/canonical-fixtures.ts:72` defines the initial schedule before constructing financial records; `:97` exposes it without recovering an invoice amount. B uses its declared schedule at `scripts/generate-fixtures.ts:316`. Facts are assembled after emit supplies the file ID, but their business values and literal lines are declared before rendering; no extraction, profile or invoice result is read to obtain them.
- Interface/metadata: `scripts/generate-fixtures.ts:119` and `:130` use the frozen identity/term ID preimages. `:144` binds the exact newly written v1 truth metadata/hash. `:145` uses the existing duplicate-rejecting lexical ordering for facts/support; `:154` hashes all producer fields except its own hash. `:155` bounds serialization and `:156` uses exclusive creation with 0600 mode. No v2 rebind or candidate binding enters A.
- Intervals/literals: `scripts/generate-fixtures.ts:219` closes only A's second account initial term. `:228` supports that boundary with the executed amendment's complete effective-date line and `:229` opens the contiguous replacement term; inherited identity/cadence/anchor support remains tied to the initial agreement. Null ends have no fabricated literal. B's known contracts remain open-ended from the initial month (`:323`).
- Identity scope: `scripts/generate-fixtures.ts:121` uses account entity IDs, never legal-name joins. B iterates only known account declarations (`:312`); unresolved remittance generation at `:328` adds no identity or contract fact.

## Executed focused verification

Node `v24.22.2`.

1. Independent probe: `/Users/devincheng/Documents/Codex/2026-11-07/we-re/work/evidence-producer-probe.mts`, executed with Node 24 and the existing checkout's tsx loader. PASS for `baseline-v1` / `2026-11-08T12:00:00.000Z` and independent seed `independent-year-boundary` / `2027-01-01T00:00:00.000Z`.
   - 124 visible files byte-equal (62 per seed), and complete returned summaries equal, against base generator logic.
   - 18 PDF/email originals exactly equal v1 truth text after real extraction; original hashes equal manifest and truth hashes.
   - All 162 full support literals contained in corresponding original extracted text. Support field sets, no null-end support, canonical order/uniqueness, ID/hash formulas, 0600 modes and v1 truth metadata binding checked.
   - Independently calculated fees/date intervals checked, including the amended second A account and calendar-year boundary. Same-name buyer IDs remain distinct; unknown B remains in financial truth and absent from both companion fact sets. Existing `decodeTruth` accepted all generated v1 truth files.
   - Byte comparison harness extracted the base generator using `git show`, changed only import/root paths for execution, and used candidate dependencies. The sole changed dependency is canonical-fixtures.ts adding returned schedule properties; the supplied diff establishes all prior dependency behavior is unchanged. Thus this is a controlled base-generator comparison, not a separately installed historical checkout. Historical build-hash identity is not claimed: this harness intentionally reads candidate build files. Financial truth values matched in this controlled setup.
2. `PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run test:unit -- packages/sources/test/generator-truth.test.ts`: **10/10 passed**, including overwrite protection, repeatability and original v1 checks. Initial sandbox attempt stopped before tests on Vite cache EPERM; scoped escalation in the same existing checkout succeeded. No cache relocation or checkout modification.

The probe's initial harness invocation failed before running due to the scratch baseline `.ts` file being treated as CommonJS; changing that scratch extension to `.mts` resolved the harness issue. Final probe exited 0.

## Limits

This is producer-only independent review, not builder self-acceptance or joint user acceptance. C's strict incoming decoder (including arbitrary unknown/prototype/duplicate field rejection), B's scoped capture/citation resolution, v2 pin/read, evaluator eligibility, lineage and product execution were not tested or accepted here. Producer tuple shape and frozen interface compatibility were assessed; C's malformed-input behavior remains its own required gate. No DB, browser, broad regression rerun, money movement, invoice issuance, parent persistence, runtime/model/key changes or public truth exposure was introduced or claimed.
