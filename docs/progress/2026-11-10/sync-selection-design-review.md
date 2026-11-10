# Independent review: P2 Phase A selection design

Reviewed candidate: `docs/progress/2026-11-10/sync-selection-design.md`.

Exact SHA-256 verified with `shasum -a 256`: `5782e22374db9cef23d8529a8d1785f21fec08046e1a712f62b7344fc74bac5c`.

Repository root: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

Spec verdict: **changes requested** — one mapping-drift containment gap below.

Quality verdict: **changes requested** — freeze the missing guard and its concrete proof before implementation planning. The overall decomposition, limits and witness approach are suitable for this deliberately small read-only phase.

Verification verdict: **design/source inspection only**. No Git operation, database connection, test execution, provider/model call, subagent, or repository edit. Only this temporary review was written. Task 3's moving writer was not reviewed. Task 1 `7af5d8a` and Task 2 `7161d6e` acceptance are dispatch facts; final P1 interface/type reconciliation remains required. The candidate's statement that Task 2 is still under review is stale documentation, not a new interface grant.

## Actionable finding

### [P1] Payload schema drift is not covered by the specified mapping-wide guard

Location: candidate lines 86–88, with missing proof at lines 140–142.

The design explicitly broadens an envelope resource/stream/schema-declaration mismatch to every subject using the affected feed/resource, but compares only the envelope declaration and leaves an ordinary scoped malformed financial record local unless the accepted compiler identifies a broader failure. The accepted classifier provides no broader schema-failure classification: its `sourceBlockers` cover only identity and governing semantics. In `packages/compiler/src/plan-batch.ts:424–432`, foreign/unknown account checks precede `materialize`; therefore unknown-account input never reaches payload validation. For known input, `materialize` invokes `validateSourcePayload` (`:84–90`), whose undeclared/missing/changed-type fields produce ordinary `SOURCE_SCHEMA` holds (`packages/compiler/src/operations.ts:29–51`). Those are not mapping-wide `sourceBlockers` either.

Concrete counterexample: two genuinely committed customers A and B use the same approved invoice resource and schema. A captured invoice for known-seller raw account `raw-new` keeps the approved envelope `schemaVersion`, but replaces required payload field `amount` with `gross_amount`; its envelope/hash/page/capture remain valid. The full-corpus classifier returns `UNKNOWN_ACCOUNT` for that row before checking the payload. The envelope-only guard sees no declaration mismatch, so B's otherwise valid 300-cent invoice can still be proposed. The same payload change on A can remain only A's local hold while B is proposed. This misses the already specified renamed-field/schema failure containment for the affected mapping. It is not the legitimate case of an otherwise schema-valid unknown account coexisting with an independent proposal.

Authority: PRD §11 says a source schema failure stops interpretation of that feed (`prdv2.md:331`); §13 requires renamed/removed fields, changed units/types and material enums to pause the affected mapping before writes (`:359–365`). Frozen F8 explicitly supplies a renamed-field fixture without changing the approved contract (`2026-11-08-contract-freeze.md:314`). The accepted classification design explicitly limits `sourceBlockers` to its existing identity/semantic guard and says runtime owns mapping-level containment. Read-only proposals must honestly pass those selection checks even though they authorize no write.

Required correction: specify a deterministic, compiler-owned source-contract validation boundary that covers every relevant captured payload before account filtering, or explicitly fail coverage closed where that validation cannot be established within Phase A. Reuse the existing structural validator or obtain a narrowly reviewed compiler seam; do not duplicate monetary mapping/equality or promote ordinary unknown-account holds wholesale. Define which existing schema diagnostics propagate to which approved feed/resource mappings and how they appear in the witness. Do not infer that the current `sourceBlockers` supplies this information.

Required proof: add genuine captured rows with unchanged declared schema but a renamed/missing field for (a) a known subject and (b) a known-seller unknown account. Assert no proposal for another subject using that affected mapping, with the causing event/contract/diagnostic retained. Also retain a positive schema-valid unknown-account case where independent mapped work is proposed, and a genuinely separate unaffected mapping case. This closes the gap without introducing skip, resolve, enrollment or financial authority.

## Nonblocking contract clarification

Candidate line 31 promises `no_committed_subjects`, but lines 34–54 do not place that value in a result discriminator, the closed `IncompleteReason` union, or a fixed blocker vocabulary. Give empty enrollment an explicit representable result with zero proposals and no global-completeness claim before producing implementation types. This is an owner-level DTO decision, not a product-policy question.

## Other assessed boundaries

- **Bounded completeness:** The complete small corpus, cap-plus-one evidence scans, prefetch byte accounting, snapshot-wide catalog/target/history reads, inverse-membership checks, and zero proposals on structural incompleteness avoid prefix-as-completeness claims. Source lane/subject/target limits and the compiler invocation limit are correctly distinct. SQL predicates/index feasibility and cancellation still need actual implementation proof; this review does not certify them.
- **Routing:** Exact committed selected profiles, all subjects including paused/revoked ones, raw tuple preservation, explicit ambiguity, and rejection of unrecognized source binding correctly avoid inventing enrollment. Known-seller unknown work can remain unresolved while independent mapped work has a proposal. Source identity/semantic uncertainty is kept distinct. Subject-specific baselines and cross-lane uncovered-history rejection are conservative and coherent.
- **Closure and ordering:** Full-corpus classification preserves capacity and existing-allocation/reversal coupling. Typed exact keys and all provider representatives, accepted whole-group metadata, selected-closure reclassification and no plan slicing keep financial interpretation in the accepted compiler. Earliest unfinished work prevents unrelated same-customer overtaking; later exact prerequisite membership can join the held group. One proposal per subject avoids speculative target-version chains.
- **Origins and history:** Global claim checks and original initial/ongoing receipts remain required for replay and target prerequisites. New/coalesced work does not acquire invented receipt origins. No outcomes, heads, examinations or frontiers are written. Immutable P1 audits/decoders and runtime001–006 are preserved; generalized cross-stream application is expressly deferred.
- **Witnesses and tests:** The concrete 700/500/900-cent dependency example and expected 400-cent balance, immutable page/member/vector references, full and selected classifier bindings, and zero-write/concurrency obligations are useful. Bounds, held providers, ambiguity, semantics, originals, restart and cross-stream fixture feasibility are covered at design level. The schema-drift matrix above is the material missing case. No listed test is treated as executed evidence.

Read sources: root and applicable app/package/compiler/parent/test/database AGENTS; the scope audit; PRD §§10–13 and relevant acceptance rules; frozen F1/F2/F3/F5 and foundation sequencing; shared ownership and verification conventions; accepted classification design/plan and stable compiler implementation; accepted capture plan; P1 repair representation/interface contract. No new financial policy or generic skip/resolve permission is requested by this review.
