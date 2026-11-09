# Bootstrap architecture fix review — round 1

Scope: fresh independent review of R1/R2 from `v3-bootstrap-architecture-independent-review.md` and breakage introduced by `v3-bootstrap-fix-r1.diff` only. Read the original architecture task, fix report, diff and revised proposal/handoffs. Untouched architecture is not reopened.

Verified exact candidate SHA-256 values from the files:

- `v3-bootstrap-verification-proposal.md`: `dbd085abf914a0433e0f15423895a5082988acc4a05a7ce064fb825a319f1fa7`
- `v3-bootstrap-handoffs.md`: `ffb0508ce928274beeb04e5dd04e385da2a0635f0dcf2b3a2eb88f4aea88ab44`

## R1 — ADDRESSED

Proposal §4 now specifies the strict private `BootstrapEvaluatorCompletionV1` and exact successful launcher return. It binds protocol, job, complete request hash, public result, nullable actual observed baseline plan and canonical observed-plan byte hash. The plan is retained from the captured-baseline subject invocation before independent comparison; oracle replacement, probe substitution and a second planner invocation are explicitly excluded.

Launcher and registry enforce reserved input/pin/binding equality, result identity and hash, plan metadata, nullability agreement, `hashPlan`, and the full canonical observed-byte hash. Invalid transport/preflight/child execution yields no successful launcher return. Valid negative verification may retain a valid observed plan without granting eligibility. Proposal §6 disallows a result-only completion path and requires atomic immutable storage, conflicting-completion rejection and restart revalidation.

S3a carries the transport rejection obligations; S3b adds the requested real evaluator-to-launcher-to-registry transport vector with pool/service restart and byte-identical recovery. The distinctive scripted subject is explicitly transport evidence, paired with real A/B execution rather than substituted for eligibility proof. This closes the original interoperability gap while retaining the public result shape and protected-output boundary.

## R2 — ADDRESSED

Proposal §§3–4 explicitly define sidecar and result-binding `snapshotHash` as `snapshot.contentHash`, separately preserving the immutable registry whole-object `hashCanonical(snapshot)` check and capture association. Proposal §5 and S2/S3a require rejection of whole-object-hash substitution even after enclosing hashes are recomputed. S0 also carries the content-hash definition into the contract freeze. Both hash roles are now explicit and neither validation replaces the other.

## New breakage introduced by the fix

None found in this scoped review. The root-assigned control 004 discovery / 005 bootstrap sequencing is explicit and conditional on reviewed, merged prerequisites; it does not authorize SQL implementation here. The separate reissued exact-subject financial report and immutable existing v2 evidence pins remain required. S5's trusted financial capture/evidence-pin attestation, companion persistence and worker trust policy remain deferred and non-dispatchable.

The two requested architecture clarifications are accepted for these exact document hashes. This is not implementation verification, dispatch authorization, activation readiness or joint user acceptance. No source edits, SQL, commits, subagents or tests of nonexistent code were performed; only this scoped review document was written.
