# Scoped review: dependency journal integration clarification

Reviewed 2026-11-10. Read-only architecture/specification review for the Platform coordinator.

Candidate: `/private/tmp/eapr-dependency-journal-integration-clarification.md`, 16,372 bytes, SHA-256 `4cc857d03e88885e7521b620794ee2a1d21b9657c000dcb645888ae826f15f8e` (verified from file bytes). Candidate line anchors below refer to this exact file.

Repository evidence: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

## Verdicts

**Specification: PASS for the three scoped integration decisions.** No Critical, Important, or Minor specification defect found. The candidate closes the preflight's shared-accounting, earlier-helper-admission, and durable-COMMIT wording gaps while retaining the accepted journal-only result table and recovery-first behavior. Its explicit durable-COMMIT qualification is necessary; copying the selector's read-only late-success rejection would be incorrect here.

**Design quality: PASS.** No Critical, Important, or Minor design-quality defect found. The proposed private seams are small and correspond to distinct existing responsibilities: one aggregate with two closed admission views, reuse of the authority resolver with pre-admission, and a journal-owned transaction lifecycle. No second financial validator, generic budget framework, history index, cancellation subsystem, scheduler, or global transaction rewrite is introduced.

This is an exact-candidate design review, not approval of a later plan, source release, schema/migration reservation, executed proof, mounted capability, or joint acceptance. No corrective change is required before considering this clarification for acceptance. The ordinary later-plan obligations below remain mandatory.

## Decision 1: shared physical, diagnostic and journal-write accounting

Candidate lines 11–27 establish one fresh aggregate per operation/attempt, checked exact-fit arithmetic, physical table/full-PK/column identity, unchanged selector count domains, a separate journal summary, and the 999→1,000 versus 1,000→1,001 append boundary. Identical content in distinct physical columns remains separately charged. Historical exact recovery traverses its necessary immutable graph rather than scanning later examinations to prove current fingerprint absence. These are compatible with the accepted dependency design §10 and selector admission clarification §1.

Lines 31–43 resolve the otherwise missing diagnostic handoff without changing `inspectSelectionCut(cut)`, its result, or `EvidenceFamily`. Both pure entry points reuse one computation and charging order. The exact delta includes admitted provisional units even when a later phase discards their outputs; it is installed once, against its unchanged starting total, before journal body admission or write reservation. Deferring journal bodies until this handoff keeps the selector's physical starting total meaningful. This is materially stronger than estimating bytes from witness/evidence DTOs and does not duplicate the composition algorithm.

Lines 47–59 narrowly exempt the versioned examination envelope from the ordinary per-value ceiling while retaining the aggregate bound. Persisted envelope bytes are an additional physical/write cost even when the ephemeral witness was an alias. Separate canonical head/activity images receive separate prospective identities; existing read charges are not erased by writes. The stated budget is admitted corpus plus prospective output, not peak memory or serialized response size. The exact envelope cap and column mapping are explicitly deferred and do not constitute a semantic hole at this design stage.

The accepted complete-subject restoration requirement remains intact for new examination transitions (lines 25, 41, 124). The narrower graph used by exact historical recovery (lines 27, 79–81) does not weaken new-work fingerprint nonmembership checks. Conversely, a growing present-day journal cannot invalidate an old exact result merely because a full current scan would overflow.

## Decision 2: bounded authority, recovery and helper reads

Candidate lines 63–70 give the integration an actual responsibility and ordering: one leased client/context/query observer, a private pre-admission hook before authority canonical loads, shared decoding/validation, and a second admission point before rereading a lazily inserted authority head. The existing public/internal caller signatures are not assumed to have an overload today. This closes the gap that passing a context only to the future selector reader would leave.

Stable-source feasibility supports this seam. `current-authority-store.ts:165–201` resolves the committed grant before loading/decoding the current head, optionally inserting then rereading a missing head. `activation-store.ts:168–200` decodes the eight import canonical fields and follows the scalar `approved_snapshot_hash` to the approved target. The proposed scalar preflight can cover those actual helper-reachable values before the existing decoder runs; there is no demonstrated need for a second grant or financial validator. The hook must be placed inside this shared resolution path, not bolted on after `lockCurrentAuthority` returns.

Lines 72–77 correctly identify `lockParentKeys`' hashed-key SELECT as the first snapshot-taking SELECT, before its advisory wait. This matches `packages/parent/src/persistence.ts:7–12` and the call order in `current-authority-store.ts:233–242`. Earlier pre-admission is explicitly prohibited unless its SELECT is acknowledged as the real boundary. Scope/row locks do not refresh repeatable-read visibility. Capture/enrollment after that boundary stays outside the cut; no source freshness fence is smuggled into the design. Absent-head uniqueness failures remain fail-closed, without synthetic epoch 1 or generic 23505 retry.

Lines 79–87 preserve history independence: an exact bounded recovery operation runs before current authority, preflight, or new-work admission; it reconstructs immutable historical observations without today's catalog or mutable heads. Null requires a successful exact absence lookup, not overflow, corruption, timeout or transport failure. Early refusal/preflight failure performs concurrent-winner recovery, while all later write attempts reacquire their own facts, locks and ledger. The stable `apply.ts:80–99` prepare/recovery pattern corroborates the intended ordering without being misrepresented as an already bounded journal adapter.

## Decision 3: durable outcomes, joined cleanup and retries

Candidate lines 91–100 separate the journal lifecycle from the existing global `withTransaction`. That distinction is necessary: `packages/storage/src/transaction.ts:11–36` commits normal callback returns, lacks COMMIT command/idle verification, and does not join public client end on rollback failure. The candidate retains at most three whole attempts for definitive 40001/40P01 aborts, fresh deadline/ledger/cut/tokens each time, and unchanged expected epoch. It explicitly rolls back every uncommitted result, including lazy authority initialization.

Lines 99–115 distinguish established abort, confirmed durable success and uncertain COMMIT. A confirmed COMMIT plus idle status returns the exact held result even after five seconds. Local timeout/loss/missing confirmation is not converted to committed:false and does not trigger another automatic attempt. A later ROLLBACK cannot prove the earlier COMMIT failed. The qualified consumed-key rule and same-key immutable recovery prevent replacement work from hiding uncertainty. Before COMMIT, unconfirmed termination becomes a safe unavailable failure rather than a false rollback guarantee.

The five-second interval is an admission deadline, not a response or remote-termination promise. Cleanup remains joined; failed/unconfirmed cleanup awaits public end and discards once. Stalled graceful end retains ownership and keeps the operation pending. These choices preserve the accepted driver/cleanup limitations without adding a forced-close mechanism. The successful-COMMIT rule at line 102 governs committed normal release; the rollback/idle requirement at lines 111–113 is the error/uncommitted cleanup rule. Known success is not demoted by release bookkeeping failure.

`runtime-db.ts:5` confirms the ordinary numeric 1,500 ms client query timer. The candidate requires the already accepted effective-driver checks and 2,000 ms server statement bound rather than treating that constructor option alone as sufficient. This review does not independently requalify the driver protocol or timeout implementation; the plan's direct protocol proofs remain necessary.

## Findings and ordinary later-plan obligations

- **Critical:** none.
- **Important:** none.
- **Minor:** none.

The following are ordinary implementation-plan obligations, not missing decisions requiring expansion of this clarification:

1. Reconcile exact accepted Tasks 5–8 exports and ownership after those tasks land; specify the shared aggregate/companion and authority-hook extraction without changing public selector contracts.
2. Freeze exact journal columns/count mappings, envelope cap E and encoded fixtures, write-image mappings/order, and strict full-key/digest reference closure. Demonstrate physical-plus-diagnostic-plus-output exact-fit/overflow behavior and the examination append boundary.
3. Freeze versioned examination/witness preimages and DTO/hash projections; preserve the accepted held classification/dependency and incident references. Prove recovery remains independent of current catalog, authority and later unrelated journal growth.
4. Specify all helper scalar passes and guarded query boundaries, including lazy-head reread admission, target/history closure and rollback of every lazy mutation. Place the snapshot proof at the actual first SELECT, and preserve immutable-reference and complete-subject restoration requirements.
5. Freeze safe error schemas and protocol evidence for confirmed late COMMIT, uncertain COMMIT, definitive abort retry, failed rollback, stalled graceful end, and release bookkeeping after known success. Retain all six obligations from the accepted dependency clarification review, including real PostgreSQL result-table/restoration/competing-caller proofs and zero financial changes.

No new product or financial-policy question was identified. No selected writer/bridge, scheduler, source fence, provider, financial/episode-policy, or migration-reservation work is requested by this review.

## Evidence and limits

Read the exact candidate and `/private/tmp/eapr-dependency-journal-contract-preflight.md` (SHA-256 `03627d17102c3e20eaba9e258427b4e4f2cd6386e36c38b3607fc382a66d6b4b`), accepted dependency design §§4–6, 8, 10, its architecture and scoped clarification reviews, and accepted selector admission/deadline clarification §§1–3. Verified the basis hashes:

- Dependency design: `f8dfae74e41ca2ccd809171bd37ff1af132bf3ecac24048cb6d7e103a45c11eb`.
- Selector admission/deadline clarification: `fcdbcb8146a1bcbfeff99826775c7a38af3cc2cd0eff30fc62e60d4a985b4a3e`.

Stable-source reads were restricted to the named concrete authority/import, lock, transaction/runtime-pool and prepare/recovery feasibility seams. Tasks 5–8 implementation is not assumed to exist and was not demanded as review evidence. Prior acceptance and current C2 ownership are coordinator-supplied facts, not independently requalified here.

Only this temporary report was written. No repository/source edits, Git operations, tests, database/SQL access, services, network/provider operations, migrations, or subagents were used. C2 retains the sole source/SQL lease. Root retains release/path/migration assignment. Independent design review, machine results and joint acceptance remain separate.
