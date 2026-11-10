# Dependency journal contract preflight

Read-only preparation, 2026-11-10. This is neither an implementation plan nor acceptance/source release.
Repository: /Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution.
Only this report was written. No tests, SQL, services, Git/network mutations, or subagents were used.

## Evidence and preserved boundary

- Verified dependency design SHA-256: f8dfae74e41ca2ccd809171bd37ff1af132bf3ecac24048cb6d7e103a45c11eb.
- Verified admission/deadline clarification SHA-256: fcdbcb8146a1bcbfeff99826775c7a38af3cc2cd0eff30fc62e60d4a985b4a3e.
- Read both dependency design reviews, the closure interface clarification, and admission/deadline fix2 review.
- Tasks 1–4 acceptance and Tasks 5–8 pending status are coordinator-supplied. Actual source currently contains selection.ts, not selection-read.ts.
- First increment remains unmounted, caller-driven heads/examinations, held-only immutable recovery, and uncommitted eligible/no-work/deferred/refused/incomplete results.
- No selected writer, acknowledgment bridge, scheduler, source fence, HTTP, provider/model, or generated-account permission is needed.
- db/runtime/007_sync_selection_source_index.sql exists. No migration number is reserved here; root assigns one only after the later catalog check.

## Findings: three narrow interface/operational gaps

### 1. Shared accounting needs a journal-specific extension, not a second budget

Accepted clarification §1 charges table/full-PK/column identities; identical content in different columns is charged twice.
The design §10 phrase “unique immutable objects once” must therefore mean physical identity reuse, not digest/content deduplication.
Its envelope exemption is compatible in principle, but cannot use the proposed ordinary admitValues unchanged: that API has a closed table/column allowlist and rejects every individual value above 1 MiB.
The selector's diagnostic units also consume the same 16 MiB (§3); its wrapper/witness is an uncharged alias, whereas a persisted journal canonical column is an actual additional value.
SelectionEvidence.bytes is provenance, not a substitute ledger. Do not sum references or re-encode returned DTOs to reconstruct physical admission.

Smallest clarification: identify journal heads/examinations, exact physical columns/count domains, and a narrowly exempt envelope class; retain 1 MiB for ordinary source values and declared diagnostic units.
Define one attempt's aggregate across admitted selector physical values, journal/history physical values, immutable referenced objects, diagnostic role units, and the prospective append envelope.
Deduplicate each physical value once across these reads; separately stored copies remain separate physical costs. Embedded bytes count inside their envelope; referenced blobs are charged when read, without recursively copying predecessor envelopes.
Freeze the cap and append admission rule within the remaining aggregate, including the 1,000-to-1,001 examination boundary; exhaustion returns an uncommitted limit and changes no head/key/activity.
A concrete cap amount and encoded fixture remain routine plan details once that charging model is agreed.

Ownership decision: Tasks 5–7 own physical ledger semantics; Task 8 owns diagnostic admission; Platform owns the journal-only extension.
The current proposed ready handoff carries physical cut.admission only, and complete SelectionInspectionV1 exposes no final diagnostic byte total.
Specify an internal cost handoff/reuse seam and ordering so journal append admission cannot accidentally reset, omit, or double-charge diagnostics. Preserve the one-argument pure inspector and public result shape.
Do not implicitly add journal families to the selector's closed EvidenceFamily/CutSummary or pass arbitrary tables through its allowlist; explicitly choose a journal-local summary/extension mapping.

### 2. A required caller context does not yet make all journal reads bounded

The accepted future signature is readSelectionCut(client, input, context), with one required SelectionReadContext containing the exact ledger and assertActive.
The journal must own a fresh context and one guarded client per whole transaction attempt; reacquire locks and rebuild the cut after each permitted retry.
Readers own neither checkout nor transaction. Do not invoke createSyncSelector(...).inspect inside the journal transaction.
Its pure inspector may run CPU-only inside the journal transaction, unlike the pool-owning selector's post-COMMIT classification; bracket that synchronous work with admission checks.

Actual stable lockCurrentAuthority calls lockParentKeys, then resolveSnapshot/readCommittedGrant/readStoredActivation, decoding imports and targets before the later selector adapter runs.
readAuthoritySnapshotInTransaction is an actual accepted export, but likewise delegates to resolveSnapshot and has no admission context.
Consequently, merely passing context to the later readSelectionCut does not satisfy preflight-before-blob/helper-read for the earlier authority/target/recovery path.
Likewise existing pool-owning readAuthoritySnapshot has no accepted deadline/ledger lifecycle and should not be mistaken for the new bounded adapter.

Smallest clarification: assign responsibility for scalar byte/count pre-admission and query observation around every helper reachable before the selector reader, including the locked grant path.
Choose the smallest authority-reader/lock seam or same-client pre-admission arrangement that preserves the existing lock token and strict validation; do not assume an unimplemented context overload.
Any earlier scalar SELECT becomes the actual repeatable-read snapshot boundary; explicitly retain that fact rather than renaming the later read a “locked cut.”
Exact historical recovery and early authority admission are separate operations: each needs its own bounded lifetime/context, and neither may require today's complete source catalog to recover an old held result.
This is a reader/authority ownership reconciliation, not permission to duplicate grant validation or financial interpretation.

### 3. Read-only late-COMMIT rejection cannot be copied into a durable journal

The selector clarification permits late successful read-only COMMIT => incomplete timeout, with zero proposals, and potentially indefinite joined end/discard cleanup.
Journal design §8 instead has durable writes and the broad statements “every error consumes no key” and “deadlines cancel ... never race-return while a query can still commit.”
A COMMIT dispatched before cutoff can durably succeed despite late delivery/local query timeout. Subsequent ROLLBACK cannot undo it.
This is a real operational wording gap, not a financial-policy gap. “Cancellation before COMMIT leaves nothing” requires established rollback, not merely a locally rejected query promise.

Smallest clarification: five seconds is admission to further work/COMMIT, not a guaranteed response or remote abort bound.
Before COMMIT dispatch, a cutoff stops further work and returns an uncommitted outcome only after established rollback/cleanup.
After COMMIT dispatch, known successful COMMIT plus idle status is a committed held result even if its acknowledgment is late; an uncertain outcome must remain a fixed safe failure with same-key recovery semantics, never a manufactured committed:false result or fresh hold.
Qualify the universal “errors consume no key” promise for commit uncertainty. A concrete safe error code/message is a plan detail.
Retain strict recovery-first behavior and exact request binding; do not mask uncertain COMMIT with a fresh synthesized result or arbitrary timeout retry.
Retain three whole-attempt retries only for 40001/40P01, with no reused cut/token; specify deadline reset per attempt and ownership of cleanup before retry.

Actual withTransaction commits normal callback returns, does not check COMMIT command/idle status, and only release(true)s after failed rollback; it does not await public client.end().
It is therefore not already the selector's accepted lifecycle. The journal needs a scoped transaction owner/extension decision preserving those retry rules and a private rollback-result signal for every uncommitted branch.
Do not silently change all storage callers or treat release(true) as joined teardown. Carry forward the accepted possibility of indefinitely pending graceful end; no new forced-close/cancel mechanism is authorized.

## Historical witness and DTO mapping: required plan work, not new semantics

- Freeze StoredSelectionWitnessV1 as the accepted witness plus the necessary exact immutable references, and freeze an explicit versioned examination hash preimage; exclude self-hash/transport recovered flag rather than recursively stripping fields.
- Freeze whether capturedCutHash denotes the accepted witness hash or a separately versioned stored-envelope hash. The design names both but does not give that mapping.
- Reconstruct historical catalog membership, observed authority epoch/status, target snapshot/version, checkpoints, classifications and routes from the stored observation and immutable references. Mutable current heads cannot replace old observed facts.
- Keep full-key/digest reference resolvers strict and bounded. Current-source growth, pause/revoke or a different current head must not invalidate exact historical recovery.
- Preserve all incident references, including closed gaps, using the accepted full key and digest over summary/sourceIdsDigest; incidentHash alone omits observedAt and is insufficient.
- Preserve classifications entries {identity, full, selected, dependencies} on held cuts, including complete-index missing proofs; sourceGuards is separate. A null proposal does not mean empty dependency evidence.
- Preserve both accepted hash equations: hashCanonical(witness.preimage), then hashCanonical({cutWitnessHash: witness.hash, group}) for the hashless proposal.
- Map eligible_observation.selectionWitnessHash explicitly to the appropriate accepted cut/proposal hash; map planHash from the actual nullable plan and members/seed from the actual proposal, with no invented financial result.
- Journal's sketch SelectionIncompleteReason must map to actual IncompleteReason. SubjectHoldV1 compilerHolds/causes/missing and blocker projections must retain the accepted exact metadata; no new grouping or balance evaluator.
- Complete bounded journal restoration, ordinal/subject/episode predecessors, fingerprint membership, immutable privileges and guarded head updates remain the six-obligation review's ordinary schema/state-machine work. Recovery graph exhaustion must fail safely, never masquerade as a missing request or restart an episode.

## Exact deferred interfaces and later ownership

Actual stable sources: current-authority-store.ts exports readAuthoritySnapshotInTransaction, readAuthoritySnapshot, lockCurrentAuthority, assertActiveAuthority and LockedCurrentAuthority.
Actual selection.ts exports checkSourceContracts, routeSelectionCut, selectSubjectGroup, DependencyWitness, ProposedGroup, SelectionCut, SelectionEvidence, IncompleteReason and related routing types.
Stable P1 seams include createSyncApplier, private prepareAttempt recovery pattern, readSyncUnit/readSyncCommit/readSyncTargetOrigins, lockParentKeys, withTransaction and sqlState; none is an already bounded journal service.

Defer exact source reconciliation until reader acceptance: selection-read.ts readSelectionCatalog, readSelectionCapture, readSelectionCut, createSelectionReadAdmission, SelectionReadAdmission, SelectionReadContext, SelectionReadResult, SelectionCatalogResult, SelectionCaptureResult, and createSyncSelector.
Also deferred: selection.ts SelectionReadSummary, SelectionCut.admission, inspectSelectionCut, SelectionInspectionV1, SelectionWitnessPreimage, SelectionWitness and CutSummary final composition.
The planned private assertSupportedSelectionPool/assertSupportedSelectionLease and Pg8231LeaseConfiguration checks are not reusable implemented exports; any journal reuse/extraction requires explicit ownership.
Their absence today is expected, not a blocker requiring source release now.

Recommend one short scoped journal integration clarification covering findings 1–3, owned jointly at the Platform/selector/authority seams, before later journal planning.
The other exact schema/hash/projection/proof choices belong in that later plan under all six existing obligations; do not reopen settled episodes, financial semantics or full-B fixture gates.
Root retains source/path release decisions. C1 remains the sole source writer and exclusive SQL-lease owner. This report authorizes neither.
