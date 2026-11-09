# D2 consumer path release

**Date:** 2026-11-09  
**Base:** `origin/main` @ `c6526f1` (producer merged via PR #3)  
**Worktree:** `/Users/williamli/Developer/eapr-discovery-consumers`  
**Branch:** `team-discovery-consumers`

## Gate status: RELEASED

### C2 citation matrix identity

Compared accepted `packages/discovery/src/proposal-evidence.ts` on `c6526f1` to the matrix in `b-document-applicability-handoff.md` (table under C1/C2 integration). Identity holds:

| Matrix row | Code on main |
| --- | --- |
| All `proposalCitationIds` + `retainedEvidenceIds` readable under grant, exact capture, identical facts | Lines 98–108 |
| `boundRefs` = profile `contractTerms` / `findings` / `bootstrap.customer` evidenceRefs; associate to **≥1** validated `profileSubjects` tuple (profile-wide) | `accountEvidenceIds` → `boundRefs`; deleted across tuple loop; diagnostic if any remain |
| Per validated tuple: ≥1 `parent-account` lookup entry with `source === sourceAccountId`, `target === scope.accountId`, nonempty refs; **every** ref in that qualifying entry associated to that exact tuple | Lines 111–142 |
| Spec-only / mapping-constant / non-parent-account / retained-only | Readability only; no blanket account applicability |

C2 correction `ced4a6a` was integrated at `d91a1af` (team-expansion D1). No matrix revision required before consumer dispatch.

### Released paths (single Discovery writer)

Exclusive for the D2 consumer implementer on this branch:

- `packages/discovery/src/construction-evidence.ts`
- `packages/discovery/src/proposal-evidence.ts`
- `packages/discovery/src/read-tools.ts`
- Affected unit/integration tests and discovery test mocks for the above

### Consumer contract

- Call installed `prepareDocumentApplicability` only. **No** permissive fallback when the method is absent.
- Shared C1/C2 helper: collect complete required citation set → sort lexically → dedupe → batches of ≤50 (C1 may need ≤550 distinct IDs). Late-batch failure rejects the whole preparation.
- Association may clear only `PROPOSAL_EVIDENCE_APPLICABILITY_UNRESOLVED` / finding applicability gaps when every required condition holds. Sticky historical blockers, fee/name verification, parent identity, and compilation remain unchanged.
- No C3 registry, bootstrap assertion, apps/control composition, `scripts/dev.ts`, db migrations, or contracts edits in this consumer slice.

### Producer dependency

Installed on main: `packages/sources/src/{document-applicability,document-identity}.ts` and `createDiscoveryReadTools(...).prepareDocumentApplicability`. Do not re-implement the producer.
