# Independent review: V3 activation authority

Reviewed 2026-11-08. Architecture/source inspection only; no implementation, SQL, tests, subagents or commits.

Exact candidates verified with SHA-256:

- `v3-activation-authority-proposal.md`: `5db6e910f7e1f359462dce82c8ae1e8879c97a8ef3983fc8c15b2c15f3f46363`.
- `v3-activation-authority-handoffs.md`: `501a2acae8abde46a00a7cfec887951c8c2d952ef0ef4f9f063aeb3242fcb95f`.

## Verdict

The proposed authority architecture closes the previously deferred financial capture/evidencePin and worker trust-policy gaps at the specification level. No financial-policy contradiction found against PRD v2, F1/F3/F5/F6, activation-shapes, bootstrap-verification freeze, accepted bootstrap proposal §6/S5, or historical V3 contract §§3–5. Accept the architectural direction; revise the two handoff/dependency issues below before treating the complete handoff set as dispatchable. This is not approval of actual trust tuples, implementation, activation availability or V3 acceptance.

## Findings

### R1 — source-authoritative semantic producer is missing from the dispatch closure

Proposal §7 correctly requires independent control/worker observations of latest published manifest semantics, including incomplete captures, followed by subsequent semantic-stream events. A5 lists runtime `source-semantics.ts` and a narrow source service adapter, but does not explicitly assign implementation of the authoritative source reader, private authenticated producer route, or producer composition. No `readCurrentSemantics`, `SemanticReader`, or `/semantics` implementation was found under current `apps`/`packages`. Existing `packages/sources/src/manifest.ts`, `dossier.ts`, and `scenario-admin.ts` expose publication/capture and mutation mechanisms, not this read port.

Historical V3 contract §6 already specifies the missing obligation: source owner implements the observation under the existing source publication lock and serves an authenticated allowlisted private source route; worker cannot query control DB or use a browser URL. This is specified work, not a new product decision. Explicitly assign that producer and service composition (or name a separate accepted prerequisite), with tests for latest incomplete manifest, subsequent numeric semantic events, selected/unrelated keys, governing `*`, and unavailable/malformed response. Make A4 and A5 depend on it. A consumer adapter alone cannot supply authoritative semantics.

Impact: A4/A5 cannot be dispatched as independently complete consumers until this dependency has an owner and concrete handoff. A0/A1 and independent storage work are unaffected.

### R2 — distinguish early A3 storage work from A3's composed reads

A3 says it depends on A2's read-only scope registry, while the final dispatch graph says `A0 → A3`. A2 itself waits for stable A1/S3a/S3b. This can incorrectly dispatch inactive-scope read completion before its authoritative registry exists.

State explicitly that schema/repository work can begin after A0/root assignments, but composition and acceptance of registered-inactive scope reads depend on A2 publication/loader. Alternatively make the graph `A0 + A2 → A3`. There is no need to delay unrelated storage design or invent scope from URL.

## Confirmed architectural protections

- Financial provenance is tied to a server reservation before running, actual protected invocation with matching before/after pins, immutable full captured events and snapshot-object digest, and atomic report/attestation/job completion. Current `jobs.ts` resolves pins only in memory after transition to running; current candidate registration has no event bytes. The proposal explicitly replaces these deficiencies rather than treating existing reports as attested.
- The installed policy is an indivisible issuer/build/fixture/capture/artifact/profile/scope tuple. Operator validation connects the bootstrap descriptor's evidencePin to the actual financial evidence-v2 digest; the worker neither reads protected truth nor trusts hashes as authentication. Actual final digests remain a deployment prerequisite. A1 must cover its full runtime validation/build closure as promised, rather than retaining the old launcher file list unchanged.
- Additive v2 retains strict v1 compatibility and binds both proofs and installed policy. Current `canonical.ts:hashBundle` normalizes report sets while preserving full plan order; the separate financial report hash intentionally preserves persisted report array order. Validators must check that exact report hash as specified, not compare only the normalized bundle preimage. Content snapshot hash and complete snapshot-object hash remain distinct.
- Readiness requires all thirteen financial checks and every frozen bootstrap assertion/case, exact capture/target/cutover/full observed plan, nonempty valid selected baseline, and no selected/unresolved blocker. Full metadata/lineage ordering survives hashing and locked recomputation.
- Null-aware preparation CAS and grant persistence under the same head lock preserve freshness and the reviewer grant linearization point. Explicit per-customer standing authority remains visible; first import does not claim an implemented sync loop.
- Exact successful key recovery precedes current freshness/policy checks; a new key on an active scope returns ALREADY_ACTIVE. Runtime import, economic/delivery uniqueness, original receipt, approved snapshot and activity commit atomically; control observations never replace worker authority.
- Historical parent records retain recorded time/hash; envelope evaluation time is independent. GET/preview write nothing, inactive scope comes from a trusted registry, and no URL invents scope. No invoice issuance, money movement or model dependency enters runtime.

## Dispatch and evidence limits

A0 is suitable for root-authorized contract work after the architecture decision and concrete one-writer paths. A1 requires A0 and a root-reserved migration after existing004/reserved005. Early A3 work is limited as R2 describes. A2 needs stable actual builds and validated fixtures; A4 needs A1/A2/A3, completed independently reviewed S3b, real exact-subject results and R1; A5 needs those composed dependencies; A6 needs independently reviewed A4/A5.

S3a `ada5b2ac` remains under code review and S3b/control005 remains unimplemented per dispatch context; neither is accepted here. Existing control004 discovery is not reassigned. Future migration numbers remain root decisions. Current workspace HEAD during final source inspection was `ec88d8efff721f14a1482d3e0fbe436de4192c54`, later than the proposals' stated inspected baseline; this review is of the exact document hashes above and the narrowly inspected ports, not a review of intervening changes. No tests ran and no actual installed policy or end-to-end proof was inspected.
