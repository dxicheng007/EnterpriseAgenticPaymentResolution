# Independent exact-candidate A4/P1 review

Candidate: `bd3907959be6c3f0be191ba185ff60bde63cc30c`
Base: `c8ed64265755963ec94164b5ddd1440e9245c0c7`
Worktree: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`
Reviewer role: fresh independent reviewer, separate from implementer and coordinating root. No source edits, commits, subagents, or database suites performed. Candidate was clean when inspected.

Verdict: **changes requested**, one P2 authorization-order finding. The remaining inspected A4 control/publication design is consistent with its bounded assignment. This does not accept A5, joint V3, or the separately reviewed adapter design documents. The known upstream UI P2 is not attributed to this diff.

## Finding

### [P2] Authorize the saved source before returning key conflicts

Location: `apps/control/src/activation-review.ts:23–26` (the key is read at line 20).

An authenticated reviewer who has the requested account grant but lacks its source grant receives a key-dependent conflict before source authorization. For an existing intent of that same account, an exact request reaches `requireSource` and returns `403 REVIEW_FORBIDDEN`; changing only `expectedTargetVersion` returns `409 IDEMPOTENCY_CONFLICT` at line 24. The caller can therefore distinguish request/key associations for a source they are forbidden to inspect. It also violates the accepted A4 handoff requirement that both account and source authorization precede every result and the authority proposal §6 ordering. The current integration test uses the demo reviewer with all source grants and does not cover this asymmetry.

Repair: establish the trusted source authorization before exposing key-dependent conflict results, preserving original immutable scope/source authorization for pending retries when current setup is absent. At minimum the existing same-account intent's source check must precede canonical request comparison; the surrounding lookup path should retain the handoff's requested-account/source authorization boundary rather than introduce current-policy dependencies into exact retry. Add regression coverage with an account-authorized but source-forbidden reviewer for exact and changed requests; both must return 403 and never publish. Retain the authorized new-session exact-retry behavior.

Reproduced without a database or source mutation using Node 24 with `--import tsx --input-type=module`, importing the actual `createActivationReview` function. Injected repository returned an existing immutable-intent-shaped record; grants contained `allowedAccountIds: ['account']`, `allowedSourceRefs: []`; the second request changed only expectedTargetVersion. Output:

```
exact 403 REVIEW_FORBIDDEN
changed 409 IDEMPOTENCY_CONFLICT
```

This is a source authorization/disclosure defect, not evidence of a financial import or an unauthorized successful grant.

## Specification and quality judgments

Inspected the full preserved implementation and P1 tests, not just the newest test commit: preparation, proof selection, review repository, activation service/routes/composition, control008, supervisor mounting, fixture extension, and all three A4 integration files. Read the P1 brief/report, tracked completion report, accepted A4 handoff and mirror addendum, root/app/database/test instructions, authority freeze and normative proposal, and verification separation rules. Also followed the consumed parent-reader, trusted publication, bootstrap registry and strict receipt contracts where relevant.

The positive architecture is sound: complete registered capture and financial attestation are read through accepted validators; the selected financial tuple is compared as one installed policy entry; protected bootstrap selection binds the full capture, recorded and planner target hashes, actual version and complete proposed plan bytes. Its registry read is followed by canonical full-plan comparison. Preparation rejects unsupported/empty baselines and selected or unresolved source-wide holds through the compiler. Selected semantic keys, missing keys and governing wildcard fail closed. Recorded parent bytes are preserved while planner time is copied separately. The fingerprint retains authority content and semantic map while excluding observation time.

Preparation captures a null-aware token before dependent I/O. Repository head locking compares that token before fingerprint reuse, allocates the next revision atomically, and uses the same head lock for intent commitment. Same-key intent insertion preserves the winner. Filesystem publication follows commit and rereads committed canonical bytes. Pending retry retains original request/reviewer/time/bundle despite head correction or missing policy. Private receipt observations have immutable canonical rows, exact available bundle bindings, identity uniqueness, and conflict-safe insertion; the A4 route does not call that writer or imply worker success.

### Head monotonicity decision

The supported repository path meets the normative proposal §6 monotonic-head requirement. That section defines the short transaction, account sentinel lock, null-aware comparison and next-revision allocation, all present in `savePreparation`; `commitIntent` shares the lock. The handoff also explicitly calls out SQL immutability rights for historical rows, which control008 implements. Neither text explicitly defines the application role as an adversarial arbitrary-SQL writer against its mutable head pointer or requires a trigger restricting every pointer transition. Consequently I do not elevate the acknowledged ability to execute a direct app-role rewind to a blocking defect for this assignment.

This is a bounded conclusion, not a claim that control008 enforces anti-rewind at the database level. It does not: the FK permits an earlier existing package of the same account/revision, and the role has UPDATE on the pointer/revision. If that stronger defense is required, it needs explicit owner assignment and additive DDL, never an edit to applied control008. No supported path inspected rewinds or clears the head.

## Verification judgment and acceptance boundaries

P1's added test source exercises deterministic held parent-read races for absent/present heads, both real PostgreSQL grant/correction lock orders, genuine protected proof substitution/noncompletion/tamper rejection, changed financial references and policy tuple, semantic wildcard/missing/incomplete publication, source-wide hold at the preparation seam, nonempty actual target binding, and mirror insertion rollback. The composition uses real proofs and actual HTTP readers and snapshots runtime state. Synthetic mirror receipts are explicitly labeled storage-only. The source-wide test intentionally uses a test-local source definition; this is not evidence that the stock demo envelope supports unresolved semantic identity. The nonempty target test proves exact binding and rejection by the installed proof, not a successful nonempty-target import.

The reported three-file focused run (3 tests) and earlier 18-file/82-test adjacent run are implementer evidence; I did not duplicate them or use the reserved PostgreSQL port. Root is independently running exact-candidate combined checks, whose outcome must be recorded separately. The reviewer-owned execution in this review is the targeted authorization reproduction above and clean-SHA/status inspection. Static review confirms substantial required P1 coverage, but the uncovered authorization case prevents acceptance even if the current suites pass.

The old supervisor smoke belongs to the preserved checkpoint. P1 reran real listeners/control restart but did not repeat the normal supervisor smoke on this exact candidate. Retain that explicit limitation rather than relabel it exact-candidate end-to-end evidence. A4's achievable boundary remains durable pending202 plus trusted canonical publication, with zero runtime financial writes. A5 authenticated worker delivery/receipt recovery and A6/joint V3 acceptance remain pending and are not supplied by machine checks, this review, or private mirror tests.

Root subsequently reported exact-candidate `bd39079` combined checks passing: typecheck, 421 unit tests across 66 files, and 43 PostgreSQL tests across nine files including A4, parent/shared composition and Discovery compile/replay. Parent browser verification was still running at report time. These are root-owned machine results and do not remove the independently reproduced authorization finding.
