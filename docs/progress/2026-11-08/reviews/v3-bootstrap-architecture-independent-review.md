# Independent architecture review — bootstrap verification prerequisites

Reviewed source HEAD `3efc1e1cf50a0e21554614812d98ffffef699eb0` and the supplied architecture inputs:

- `v3-bootstrap-verification-proposal.md`, SHA-256 `401f5d6abe61242cfd3169f6eddb51d0fa05bc31352642c140dea0bb5cc1c21a`.
- `v3-bootstrap-handoffs.md`, SHA-256 `a7524949ac814432fd88d2e46758b60efa650fe91f9f3c3e8b0769546f7991f8`.

Authority: accepted activation-shapes freeze, original F3/F5/F6, existing protected evidence v2 and actual planner/evaluator/registry seams. This is architecture review only; no implementation, tests, commits, HEAD changes, or activation acceptance.

## Verdict

The architecture is sound in its principal safety and independence decisions. Request a narrow contract clarification before treating the complete proposal as an exact implementation freeze. The missing evaluator completion envelope below affects S3a/S3b interoperability. The snapshot-hash definition should also be explicit in S0/S2 before those independently owned implementations start. Neither finding requires a new financial or product choice, a provider, or weakening evidence coverage.

## Required contract clarifications

### 1. Define the evaluator output/completion envelope carrying the observed baseline plan

Proposal lines 118–137 specify evaluator input and subject input/output, but no evaluator output wire. The public result at lines 103–111 contains only `planHash`, while lines 175–186 require registry persistence, completion validation and return of the exact observed baseline plan bytes. Handoffs lines 35–51 dispatch transport and completion to separate slices against these purportedly exact contracts.

Freeze the private evaluator output and launcher return type, including the result and nullable observed captured-baseline plan, with request/job/protocol binding. Specify that this is the actual subject-produced baseline plan retained by the evaluator after independent comparison, never a reconstructed oracle plan or a second unbound planner invocation. Completion must reject result/plan presence disagreement, bad plan hash, and any differing binding or canonical bytes; transport/preflight failures produce no successful completion. Keep expected records, probe plans and protected literals out of the envelope. Add a transport-to-registry integration vector that proves the exact validated baseline bytes survive completion and restart.

The current omission invites S3a to emit a valid result-only line that S3b cannot persist without inventing an unreviewed second source of plan bytes. A small strict private envelope resolves it without modifying the public result or existing protocol.

### 2. Define the source snapshot hash preimage explicitly

Proposal lines 55–56 and 88–90 use `snapshotHash`, and line 114 defines eventsHash and targetSnapshotHash precisely but not this field. Existing source snapshot code uses two different hashes legitimately: `evidence-fixtures.ts:318` binds protected evidence to `snapshot.contentHash`; `registry.ts` stores the source snapshot object using `hashCanonical(snapshot)`. These are not interchangeable.

State explicitly that the sidecar and bootstrap binding snapshotHash use the existing protected evidence convention (`snapshot.contentHash`), or name and specify a different hash consistently if intended. Require the exact snapshot object to be validated against its immutable registered association and manifest as already described. Add a vector rejecting substitution of the whole-object registry hash for the content hash. This is a technical contract definition, not a new product policy.

## Approved architectural decisions

- Proposal lines 27–39 preserve a pure, four-argument planner, exact canonical metadata reuse/conflict, explicit ensures, independent financial suffix ordering, shifted lineage indices, and a full plan hash. No-plan/replay-only results cannot become an ensures-only grant. Zero balance with a real nonempty financial baseline remains permitted.
- Hold classification at line 35 correctly distinguishes demonstrated unrelated routing exclusions from unresolved/missing/ambiguous identity and source-wide blockers. It does not equate absent scope with unrelated scope. The mandatory positive baseline and unrelated-hold case prevent a reject-everything checker from passing.
- Lines 45–74 preserve immutable v2 evidence pins and distinguish observed legal names/term values from reviewed IDs and derived terminal intervals. Oracle imports and expected financial lineage/order are independent of the subject; rebuilt wrong-name/wrong-term candidates must fail support rather than merely stale hashes.
- Lines 139–169 require real positive execution plus complete assertion/case coverage, full metadata/financial lineage and canonical plan comparison. Count-only coverage and negative probes alone cannot pass.
- The same-subject financial bridge at lines 188–190 is necessary: current `evidence-support.ts:217` unconditionally returns unavailable for any bootstrap-bearing profile. Narrowly lifting that exclusion while reissuing all thirteen checks under the changed evaluator build is coherent. Stripping metadata or relabeling an old report is correctly forbidden.
- Result hashes are not treated as authorship. Reserved trusted pins, immutable completion, registry-owned publication, the review companion association, and authenticated worker access preserve the F5/F6 trust boundary. Bundle v2 is additive; existing v1 schema/hashes and private v2 bytes remain intact.
- Full preview remains zero-write and non-authorizing. Later worker recomputation uses the locked target and compares full canonical bytes/hash. Explicit per-customer approval, original receipt on exact-key retry, new-key ALREADY_ACTIVE rejection, historical snapshots, and no invoice issuance or money movement remain unchanged.

## Bounded handoff assessment and deferred proof association

After the two small clarifications and root's explicit freeze/ownership assignment, S0, S1, S2, S4a and S4b are suitably bounded. S1/S2/S4 can proceed independently with serialized shared export/helper changes. S3a must implement the clarified completion wire; S3b must consume it and use a reserved migration number. Do not treat these architectural approvals as machine proof or dispatch authorization.

S5 correctly remains non-dispatchable. Its financial report reader must expose or internally resolve a trusted attested capture/fixture association, not just return the report type shown at proposal line 183. Current `jobs.ts:32–35` resolves/checks the pin in memory; lines 37–41 persist the report and summary, while lines 66–69 persist artifact/manifest association. A later reader can resolve immutable candidate capture from that association and immutable fixture identity/version from trusted fixture policy, but must specify how it obtains and validates the exact v2 bundle hash and capture membership used to match the sidecar evidencePin. Do not claim those fields already exist in the report or infer common provenance from manifest alone. This is already a deferred reader/trusted-pin-policy dependency in handoffs lines 77–79, so it does not block the bounded prerequisite slices.

Similarly, S5 still needs its separately reviewed companion storage/fingerprint and worker permitted issuer/build/fixture policy. The proposed v2 transport direction is acceptable; this review does not authorize readiness or worker consumption before those ports are frozen and demonstrated. No materially unresolved first-slice financial/product behavior was found.
