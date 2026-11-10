# Scoped review: persisted coverage clarification

**Specification: approved. Engineering quality: approved for the scoped clarification, including the explicit compact-page representation supplied by root during review. No residual actionable finding.** No financial-policy, authority, or whole-plan question is reopened.

## Exact subject

- `/private/tmp/eapr-sync-apply-coverage-clarification.diff`.
- Plan SHA-256 `25b734d5df00f486e1a3090c779d497f86bf17115f7b0f8b49a556e1ae1429e0` (verified).
- Root's supplemental representation and validation direction: persisted pages contain `{sourceRef,manifestHash,streamId,afterCursor,nextCursor,eventCount,digest,capturedAt}`; deliveries contain `{event,digest}`. Task 2 reads and strictly decodes the actual raw canonical page, digest, and indexes before projection and accepts only complete pages. Historical audit reads reconstruct the exact canonical `ChangePage` from its ordered delivery/inbox members and validate the saved page digest.

This report supersedes its initial wording concern about “event bytes occur once.” That concern was an ambiguity between full raw page storage and compact page binding; the explicit representation above resolves it. The report and supplemental direction should accompany the plan: “full page rows” means complete reconstructable page bindings after validation, not permission to omit checking the raw captured page.

## Assessment

1. **The compact page representation preserves the accepted evidence.** The page's complete canonical content is deterministically reconstructable from source/stream, after/next cursors, `complete:true`, and its exact ordered events. Its saved digest binds that reconstruction. Existing full position/inbox membership, delivery bytes/digests, count/range checks, and page indexes retain the relationships needed to establish the whole bounded chain. The manifest and captured timestamp remain explicit audit bindings. No second persisted event array is necessary.

2. **Raw corruption must still fail before normalization.** Task 2's single SQL cut must return the actual bounded raw canonical page/digest/index facts. Strict parsing, canonical equality, digest validation, and exact membership/index checks occur before projecting compact page bindings into W or W′. A malformed stored page cannot become acceptable merely because rebuilding a different page from deliveries would look valid. Root's supplemental rule explicitly preserves this requirement. The single-statement observation boundary and full canonical W/W′ equality remain unchanged.

3. **Saved recovery remains independent of current capture.** Historical readers reconstruct each saved page using saved coverage's ordered delivery/inbox members and verify its digest, cut hash, unit hash, suffix/member/origin agreement, and immutable plan/receipt references. They do not rebuild the old cut from today's mutable capture cursors or invoke the source. Exact immutable-key validation remains permitted. This preserves recovery after capture/target advancement, pause/revoke, or source outage.

4. **Task ownership is coherent.** Task 1's parent `sync-types.ts` owns the persisted compact coverage/audit schemas and reconstruction refinements. Task 2 owns authoritative SQL acquisition, validation of actual capture rows, projection into that shared representation, and worker prepared-schema composition. No parent-to-worker import or duplicate shared schema definition is needed. The original assigned paths remain sufficient.

5. **Other accepted boundaries remain intact.** The full bounded cut and unit-hash preimage are persisted; prior audits are referenced without recursive expansion. Prepared `events` are derived from the exact suffix and not separately persisted. Nonempty plan/lineage remains in runtime005 under its existing receipt/hash reference. Original receipt semantics, active authority for new bookkeeping, history bounds, source guards, and transaction/progress rules are unchanged.

## Limits

This is a scoped plan/representation assessment, not acceptance of the in-progress Task 1 source. Its later exact-candidate review must verify both strict stored-audit reconstruction and Task 2's raw-page validation before projection. No Git command, source edit, database, tests, browser, provider, or subagent was used. Only this temporary report was written. Implementation verification remains pending.

## Coordinator consolidation record

Root recorded the supplemental compact-page shape and validation rule explicitly in the plan and Task1 brief after this scoped approval. Consolidated plan SHA-256 is `a45221d9567e1e8d0a5c617eb0ec82f280dd61fe378009837a4c13288ea3adfc`; this identifies the reviewed clarification plus the supplemental representation above. The original full-plan review remains pinned to its own earlier hash. No financial authority or coverage boundary changed.
