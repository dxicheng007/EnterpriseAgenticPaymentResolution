# S3b independent exact-candidate review

- Candidate: `dbf2f09451e6094a0f801867751cac2ff3db16ea` (`codex/bootstrap-registry`).
- Base: `735e680088f3fb4ad43ed1a72439a1f293351879`.
- Spec compliance: **PASS** for assigned S3b scope.
- Task quality: **PASS**. No actionable findings.

Reviewed the complete six-file diff (695 insertions), assignment/report, repository and evaluator/database/test guidance, and the accepted proposal's completion and registry requirements. Confirmed the candidate worktree HEAD and clean status. Dependency inspection was limited to the candidate reader, S3a launcher/protocol/completion validation, bootstrap result coverage schema, prior candidate migration, and transaction helper.

The reservation allocates its own UUID, resolves the genuine immutable candidate association, derives the complete binding, and stores canonical request and target bytes with exact pins before execution. The jobs service supplies a configured pin and reloads the reserved input for launch. Control migration 005 is additive after 004; it grants no proof update/delete privilege, and neither new service uses a runtime pool or writes runtime records.

Completion consumes the full strict S3a envelope and revalidates job/request/pin/binding/result/plan identities, hashes, coverage and nullability against the reservation. It persists the returned observed plan rather than reconstructing it. A job row lock serializes completion; insertion and completed transition share one transaction. Exact canonical replay is idempotent; conflicting completions cannot overwrite proof. Restart reads validate canonical stored request, envelope, result and plan bytes, expected current pin/binding/plan hash, passing coverage, and the immutable candidate before returning proof. Missing, negative, pending, failed, mismatched or unavailable proof does not become successful readiness.

The integration covers real A/B launcher execution, restart reads, stale/foreign expected bindings, malformed completion rejection, replay/conflict, injected transaction rollback and competing completions. The scripted subject changes the observed financial balance by 17 cents and rehashes its plan; the real evaluator retains that distinctive plan while failing comparison. The persisted canonical envelope/result/plan and both plan hashes are checked after pool restart, and the successful-proof reader rejects the negative result. This transport vector is separate from the passing real A/B executions.

No tests were rerun: no concrete concern justified duplicating the reported successful typecheck, 73 evaluator unit tests, and four PostgreSQL integration tests. Those results remain builder-reported focused machine evidence; this document records independent static exact-candidate review, not a new machine run or joint user acceptance. Financial attestation, combined readiness, authenticated route composition, activation and worker authority remain outside S3b.
