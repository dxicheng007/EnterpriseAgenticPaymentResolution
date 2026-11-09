# S3a runner handoff elaboration report

Architecture/docs only. Initial inspected HEAD: `2a2f292fb58f12a3192ca8a0f2ce892631d0a93b`. During this task root advanced the shared checkout with documentation commit `f027faefcd97301561188f9aaf4b8218184157a3`; no source behavior changed in this task. I changed only `b-bootstrap-runner.md` and this report in the ignored briefs directory. No code, migrations, dependencies, subagents, commits, provider calls, or database operations.

## Exact review inputs and output

| Item | Identity |
| --- | --- |
| Accepted proposal, scratch and tracked copies (identical SHA-256) | `dbd085abf914a0433e0f15423895a5082988acc4a05a7ce064fb825a319f1fa7` |
| Accepted S1 original candidate | `c4f862ae86805d081d4c8ec78a31e750c5fff177` |
| Accepted S2 original candidate | `e212cbd1e2a3b32bef65e3c44e3aa626272ab04c` |
| S2 report SHA-256 | `ea126956c8a0aa4ee49d5585c20160a625bd457dacae56012caf2ebafca1d7f5` |
| S2 independent review SHA-256 | `9dd6f7c9a425985270c1f166dce518dbd7f1e495c586065e786763f5a8c76239` |
| Revised `b-bootstrap-runner.md` SHA-256 | `eb6b4775e60e044a41aaae9f35c7791ab20ce9edde335d457e74ced34755c2fd` |

Read accepted proposal §§4–6 (also §3 for provenance), S3a/S3b handoffs, accepted S2 API/report/review, bootstrap freeze and applicable repository/area instructions. Inspected actual registry read and operator preparation, S2 reader/cases/reference, current runner/launcher, runtime import edges, Vitest project separation, and S2 real captured setup.

## Resolved interface and provenance

The frozen evaluator stdin has no registration field. S2 `readBootstrapExpectation` requires `BootstrapCapture.registration = {artifactHash, manifestHash, snapshotId, snapshotObjectHash}`. Existing `getCandidate` verifies the immutable artifact/capture association and exact object bytes/identity/hash. S2's operator already derives `snapshotObjectHash` from that verified return, not arbitrary request bytes. No missing registry API needs to be invented.

The revised brief defines a private launcher factory accepting a narrow verified `getCandidate` port, fixed operator `BootstrapPinV1`, and fixed `{sidecarRoot,evidencePinRoot,servedRoots}`. It preserves `BootstrapLauncher.launch(input): Promise<BootstrapEvaluatorCompletionV1>`. The launcher resolves and compares the exact registered artifact, profiles, manifest and snapshot before launch; the separate `snapshot.contentHash` remains the public binding/descriptor digest. Exact request hash remains the hash of strictly parsed frozen input only.

The proposed implementation detail requiring independent handoff review is a fixed inherited evaluator-only fd 3 pipe carrying strict `BootstrapLaunchContextV1 = {protocolVersion:'bootstrap-launch-context-1',requestHash,registration,roots}`. It carries no expected facts or credentials. Subject stdin, evaluator stdin, public schemas and successful completion shape remain unchanged. A missing/replayed/malformed context fails closed; it cannot fall back to a request-recomputed registration digest. The context never reaches the subject. This is trusted composition configuration, not an independently authenticated registration certificate.

## Test and build closure decisions

Root explicitly permitted new `tests/integration/bootstrap-runner.test.ts`. It now owns the real fresh-root, actual registry-backed A/B capture → operator pin → evaluator process → subject process proof before S3b. Existing native setup and capture helpers can be called locally from that test; no production helper or root config changes are assigned. Unit files remain database-free. Per-test timeouts can accommodate the production evaluator cap without changing it.

The brief enumerates the current subject/compiler/parent/finance closure and protected S2/evidence/source/transport closure, with contracts barrel and resolution manifests/lockfile. It calls out `company-b -> records -> @eapr/evidence` and `runner -> protocol` edges and requires final explicit sorted file lists with missing/duplicate rejection, pre/post source checks, and mutation tests on temporary copies. Existing financial launcher hash is not sufficient and remains unchanged.

Transport reuse is limited to the existing private bounded exchange internals and optional fixed extra configuration pipe. Existing old-schema `runSubject`/`runEvaluator` cannot be reused by input casts. No generic caller-selected schema/entrypoint package API is permitted. Import tests must preserve independent oracle calculations and prevent protected modules/config leaking to product/browser or subject roots.

## Actionable review points and deferred gates

1. Independently accept or reject the fd 3 private configuration adapter and precise new integration-file assignment before dispatch. This is the concrete implementation seam absent from the original handoff. If rejected, freeze an alternative trusted configuration channel; do not silently add fields to the accepted stdin or turn a self-hash into registration evidence.
2. Verify final implementation calls the actual immutable registry read, checks complete returned inputs against sent request bytes, and derives the whole-object hash only from that verified return. Structural mock callbacks alone cannot prove production trust. The integration test must exercise real PostgreSQL association failures and changed exact snapshot bytes.
3. Audit final runtime import graph against both source manifests and the pre/post checks. Inspection provides minimum current paths; added helper imports must be included. The lockfile assumes a trusted installed dependency tree, as the accepted proposal does; it is not a hostile-local-host attestation.
4. S3b still owns server job allocation, durable exact canonical request reservation, atomic result/actual-plan completion, duplicate/restart validation and the later registry-backed authority reader. S3a's trusted invocation and real captured construction do not implement these.
5. S5 financial capture/evidence-pin attestation, permitted issuer/build/fixture policy, parent target authority and activation transport remain separately deferred. No materially unspecified financial/product behavior was selected here.

No tests were run: no executable behavior was changed. Validation was source/API inspection, comparison of proposal copies, SHA-256 calculation, and review of the two assigned documents. Independent handoff review and later exact-candidate machine/independent/joint acceptance are separate.
