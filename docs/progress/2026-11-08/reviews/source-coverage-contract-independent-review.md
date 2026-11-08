# Independent review — source coverage shared contract

- Reviewed candidate: `9a627f6b4a9fd62f069b9b383dab719b65bd80a5`.
- Base: `f3e5375808da004bc27092c3c159dac5dcad821c`.
- Review checkout: `/Users/devincheng/.codex/worktrees/acquisition-review/EnterpriseAgenticPaymentResolution`, detached at the candidate; clean before and after checks.
- Reviewer: fresh independent agent `/root/astra_source_coverage_contract_verify`, separate from builder and supervising lead.
- Scope: guided-discovery implementation brief, Global constraints, §1, and §4-B; exactly the three changed contract files. Read repository/package/test instructions, applicable F1 representation rules and source definitions, PRD boundaries, shared ownership, and verification conventions.
- Builder handoff read from the main worktree's `briefs/b-source-coverage-contract-report.md`; the specified startup-worktree copy was absent.

## Verdicts

**Specification compliance: PASS for the assigned shared-contract slice.**

**Code quality: PASS. No actionable findings.**

The candidate is suitable for dependent source-service and client work. This exact-candidate review is not a full slice machine pass or joint user acceptance. Joint acceptance remains pending.

## Reviewed behavior and line evidence

- `packages/contracts/src/source-coverage.ts:7–22,29–37`: strict schemas reuse the existing browser-safe Id, Hash, EventKind, RawIdentity, SourceSnapshot, and Diagnostic definitions. Unknown fields and forbidden prototype keys are rejected at nested object boundaries. The response contains no parent identity, candidate hash, eligibility, approval, amount, or operational-status fields.
- `source-coverage.ts:11–15`: display names must contain non-whitespace text while their original source text is preserved. Identity support is nonempty; identity and related citation sets reject duplicates and normalize lexically.
- `source-coverage.ts:35–36`: uniqueness uses exact seller/account tuple and event ID. The slash delimiter cannot collide because both tuple components use the existing slash-forbidding Id schema. Names and buyer IDs do not merge separate tuples; accounts with no matching events remain valid.
- `source-coverage.ts:40–61`: snapshot source and event companies must match the response; duplicate snapshot inventories are rejected; distinct event membership must equal the snapshot event set, including same-length replacement and duplicate-for-missing cases. Both account citation arrays must be members of the snapshot evidence inventory.
- `source-coverage.ts:63–68`: accounts sort by exact seller ID followed by account ID, events by ID, with deterministic code-unit lexical ordering rather than locale collation. Input arrays are not mutated. Snapshot inventories, raw identity content, diagnostics, and source display-name text remain unchanged; the existing SourceSnapshot schema retains its established instant normalization behavior.
- `packages/contracts/src/index.ts:11` and `source-coverage.ts:70–72`: required types and response schema are exported. The directly imported schema has no canonical helper, Node built-in, protected-fixture, runtime, or model dependency.
- `packages/contracts/test/source-coverage.test.ts:1–102`: meaningful acceptance/rejection coverage includes same-name different-buyer accounts, zero-event accounts, undocumented and unscoped events, exact sets, scope mismatch, foreign evidence, unknown extensions, and prototype keys.

Authenticity, aggregate identity (`snapshot:<manifestId>`), original evidence support, and captured-byte/hash validation remain explicitly assigned to A. Their absence from this shape/internal-consistency schema is not a defect. Diagnostics retain the existing shape: their source IDs may identify events as well as evidence, so the account-citation membership rule is appropriately confined to the two account citation arrays. No existing snapshot schema, hash preimage, profile, preview, hold, or eligibility behavior changes.

## Independent checks

All commands used Node 24 from `/opt/homebrew/opt/node@24/bin` against the exact review checkout.

| Check | Result |
| --- | --- |
| `git rev-parse HEAD` and `git status --porcelain` before/after | Exact candidate; clean |
| `git diff --check <base> <candidate>` | Exit 0 |
| `npm run test:unit -- packages/contracts/test/source-coverage.test.ts` | Exit 0, 31/31 tests passed |
| `npm run typecheck` | Exit 0 |
| `node --import tsx <main>/.superpowers/sdd/2026-11-08-implementation-plan/briefs/source-coverage-contract-independent-probe.ts` | Exit 0, 90 independent assertions passed |

The first focused test attempt stopped during configuration loading because the sandbox disallowed Vite's temporary cache write in the detached worktree. A scoped escalation for normal Vite/Vitest cache writes succeeded; the rerun above executed the tests. This was an environment restriction, not an assertion failure.

The retained ignored probe imports the candidate schema directly. It checks unknown/prototype keys at all six relevant object levels; malformed account IDs, hash scalars and timestamps; exact event membership and duplicate substitutions; cross-company/source input; foreign citation IDs; blank/nonscalar names; attempted parent/eligibility/profile fields; same-name distinct buyers and zero-event accounts; seller/account tuple ordering including prefix and case distinctions; citation ordering; nonmutation; raw identity and snapshot preservation; diagnostic preservation; normalization idempotence; and an empty event inventory.

The supplied review package was inspected along with the actual Git diff. It contains a metadata header and expanded context, so a raw byte comparison with default `git diff` is not an identity check; the reviewed source and candidate SHA are the authority.

## Limits

Focused shared-contract machine checks only. No database, evidence-store, source-route, client/browser, full-suite, full-slice, live model, financial calculation, activation, or synchronization checks were run. No protected truth was read. No product files or candidate code were edited; only the requested report and independent probe were added under the main worktree's ignored plan workspace.
