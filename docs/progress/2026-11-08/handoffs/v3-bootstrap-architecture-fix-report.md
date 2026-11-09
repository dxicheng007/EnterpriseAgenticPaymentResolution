# Bootstrap architecture fix report — round 1 of 5

Architecture-only response to `v3-bootstrap-architecture-independent-review.md`. Edited only the current proposal and handoff drafts; created this report. Root retained r0 snapshots. No source, tracked specification, migration, implementation, commit or test execution changes by this agent. Fresh scoped independent review is required.

## R1 — private completion envelope

Proposal §4 now defines strict `BootstrapEvaluatorCompletionV1` and exact `BootstrapLauncher.launch` success return. The envelope carries protocol/job/request hash, the public result, the nullable actual captured-baseline subject plan, and its nullable canonical byte hash. It preserves the observed subject plan captured before independent comparison; no oracle substitution, probe output or second planner invocation. Both launcher and registry check the exact reserved input/pin/binding, ID, schema, nullability, result hash, hashPlan, and observed canonical byte hash. Transport/preflight failures yield no successful completion. Structurally valid negative verification may retain an observed valid plan without becoming passed.

Proposal §6 and handoffs S3a/S3b now require that envelope as the completion input, immutable canonical plan/result/envelope storage, atomic completion, conflict rejection, and restart revalidation. The S3b transport-to-registry vector requires canonical observed bytes to survive real evaluator/launcher transport, commit and service/pool restart; mismatch and conflicting second completion preserve the stored original. Scripted transport coverage is explicitly paired with real A/B verification and cannot itself prove eligibility.

## R2 — source snapshot hash

Proposal §§3–4 explicitly define both sidecar and binding `snapshotHash` as `snapshot.contentHash`, using the existing protected v2 preimage. `hashCanonical(snapshot)` remains a separate whole-object registry check, with exact immutable capture association validation. Proposal §5 and handoffs S0/S2/S3a require rejection when a whole-object hash is substituted for the content hash even after enclosing hashes are recomputed.

## Root reservation and deferred S5

Recorded root's reservation of `db/control/005_bootstrap_verification.sql`. S3b depends on the reviewed, merged control 004 discovery-lifecycle catalog and planner/oracle/runner prerequisites. No SQL was written or allocated by this agent; applying 005 before 004 is explicitly excluded.

S5 remains non-dispatchable. Proposal and handoff explicitly acknowledge that current financial reports lack the complete v2 bundle/capture attestation, current jobs resolve the pin in memory, and a separately frozen trusted reader/fixture association and worker issuer/build/fixture policy are still required. No readiness or activation authorization was added.

## Checks and exact candidate hashes

- Read the independent review and compared proposal against root's r0 snapshot; checked that changes are confined to R1, R2, root's migration reservation and explicit deferred S5 dependency.
- Text checks found the strict envelope and launcher return, content-hash distinction, rejection/restart vectors, and reserved migration dependency in both drafts. No residual proposed `004_bootstrap_verification.sql` or NNN placeholder remains.
- `git diff --stat` was empty at inspection. Other concurrently created untracked handoff/review files were visible; this agent did not edit them. HEAD observed at final read: `a356b11c23af2afaa6e23447b2d78a75237b00bb`.
- No code tests were run because this is a document-only architecture revision; all listed implementation checks remain future acceptance obligations.

SHA-256 of the exact revision for independent re-review:

- `v3-bootstrap-verification-proposal.md`: `dbd085abf914a0433e0f15423895a5082988acc4a05a7ce064fb825a319f1fa7`
- `v3-bootstrap-handoffs.md`: `ffb0508ce928274beeb04e5dd04e385da2a0635f0dcf2b3a2eb88f4aea88ab44`
