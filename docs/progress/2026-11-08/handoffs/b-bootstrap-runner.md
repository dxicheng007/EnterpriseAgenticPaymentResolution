# S3a — dedicated bootstrap transport and checker (evaluator owner)

Depends S1+S2. Allowed: new evaluator files `bootstrap-protocol.ts`, `bootstrap-runner.ts`, `bootstrap-subject-runner.ts`, `bootstrap-evaluator-runner.ts`, `bootstrap-comparison.ts`, `bootstrap-launcher.ts`, `bootstrap-verify.ts`; new corresponding test files and `test/children/bootstrap-*.mjs`; new `tests/integration/bootstrap-runner.test.ts` (explicit root assignment); `packages/evaluator/src/runner.ts` only a minimal internal transport extraction/export for fixed bootstrap wrappers if necessary; `packages/evaluator/package.json` safe launch/validation entry exports only. Keep protocol.ts and current report/v2 evidence wire untouched. No registry or UI.

Implement proposal §4–5 fixed private types, strict BootstrapEvaluatorCompletionV1 and BootstrapLauncher return, and safe result, full exact coverage table and actual positive/negative cases. Pin full evaluator/subject source closures; hash before/after run. Comparison builds expectations without subject planners/projectors. Primary result binding uses exact request capture/target; synthetic probe variants never replace it. Retain the actual schema/hash-valid captured_baseline subject plan before comparison and carry it in the completion envelope; no oracle reconstruction or second planner invocation. Match protocol/job/requestHash, exact reserved binding and pins, result/plan nullability, hashPlan and observed canonical plan bytes hash. Failure produces no successful launcher completion. All nine assertions and ten cases mandatory; negative probes do not substitute for captured baseline/exact reuse.

Acceptance: separate child really invokes planBootstrap; actual exact fixture passes, mutant outcome pointer omission/addition, shifted indices/order/hash fails; rebuilt wrong-name/term candidate fails support; unexpected child request ID/protocol, forged result, stale build/fixture/profile/manifest/events/snapshot/target/asOf or plan hash rejected. Timeouts/oversize/stderr/extra report lines and process cleanup match existing caps. Source closures catch compiler/finance/oracle/contracts/lock changes. A result-only response, wrong completion protocol/job/requestHash, nullability disagreement, changed plan bytes/byte hash or result/plan hash disagreement must fail. A source whole-object hash substituted for snapshot.contentHash must fail even after recomputing surrounding result hashes. No protected path/expected facts in child input or public diagnostic.

Commands: `npm run typecheck`; `npm run test:unit -- packages/evaluator/test`; `npm run test:integration -- tests/integration/bootstrap-runner.test.ts tests/integration/bootstrap-fixture-setup.test.ts tests/integration/v2-verification.test.ts`. S3b later owns `tests/integration/bootstrap-verification.test.ts`. S3a proves registered-capture construction and real subprocess comparison only; it does not prove persisted bootstrap completion, readiness, or activation.


Accepted S1 c4f862a and S2 e212cbd are integrated. Read accepted proposal v3-bootstrap-verification-proposal.md §4–5 for exact private completion/launcher protocol, build closures, binding preimages, and coverage. S2 readBootstrapExpectation requires trusted registry association and exact snapshot object hash, separate from snapshot.contentHash. The evaluator receives fixed trusted protected configuration from its launcher, never browser-selected paths or self-certified expected facts. Preserve this trust boundary when adapting S2. Do not mutate existing private v2 wire or launcher financial report semantics.

No S3b registry/table/HTTP implementation in this task. Prove real A/B protected evaluator→subject subprocess flow with operator-prepared fresh construction roots and actual reviewed captures through focused tests within assigned new test files; test harness setup can reuse existing setup helpers without widening their production APIs. Public-only unit vectors are not substitute for real pipeline. Keep all protected output/paths/private records out of public diagnostics; report counts and safe digests only. If exact trusted fixture configuration or internal metadata ports are absent, raise the concrete gap before inventing one.

Assigned worktree lease PG55434/control3201/worker3202/web5175, EAPR_TEST_PREFIX and EAPR_TEST_NAMESPACE_PREFIX=eapr_test_review_t1. Use Node24/PG18. No subagents. Meaningful behavioral red→green, then focused checks and listed evaluator regression suite. No additional dependencies/root config edits. Commit coherent label<20words, no merge/push. Report exact base/head/checks/limitations to b-bootstrap-runner-report.md in this briefs directory for fresh Astra review.

## Elaborated handoff — trusted launch configuration (independent review required)

Inspected main `2a2f292fb58f12a3192ca8a0f2ce892631d0a93b`. Accepted proposal SHA-256 `dbd085abf914a0433e0f15423895a5082988acc4a05a7ce064fb825a319f1fa7`. This section elaborates private implementation plumbing, not new public contracts or permission to implement registry/authority behavior. Root must obtain independent handoff review before Sol implementation.

### Existing seam and exact authority precondition

`readBootstrapExpectation(pin, capture, roots?)` requires `BootstrapCapture.registration = {artifactHash, manifestHash, snapshotId, snapshotObjectHash}`. This is not supplied by frozen `BootstrapEvaluatorInputV1`. Neither the descriptor nor `snapshot.contentHash` attests candidate registration. S2's operator already establishes the intended provenance: `prepareBootstrapVerification` calls `registry.getCandidate(artifactHash, manifestId)` before constructing registration metadata. The registry checks `artifact_captures` and immutable object bytes/identity/hash, then returns the verified exact snapshot. Recomputing `hashCanonical` **of that returned snapshot** is valid; recomputing it from launch request bytes without the registry read is not.

Use a trusted launcher factory with a narrow injected registry read and fixed operator configuration. The following is a private structural interface, implementable in the assigned `bootstrap-launcher.ts`; keep the frozen `BootstrapLauncher.launch(input)` interface unchanged:

```ts
type RegisteredCandidate = Pick<BootstrapEvaluatorInputV1,
  'artifact' | 'profiles' | 'manifest' | 'snapshot'>;
type TrustedBootstrapLauncherOptions = {
  registry: {
    getCandidate(artifactHash: string, manifestId: string): Promise<RegisteredCandidate>;
  };
  pin: BootstrapPinV1;
  roots: {
    sidecarRoot: string;
    evidencePinRoot: string;
    servedRoots: string[];
  };
};
// createProtectedBootstrapLauncher(options): BootstrapLauncher
```

`registry` must be the existing `createCandidateRegistry(...).getCandidate` implementation or a trusted composition adapter retaining its verification semantics. Structural TypeScript compatibility is not an attestation; a fake that merely echoes the request is permissible only in explicitly labeled unit tests. Do not expose registry/config injection to HTTP, product tools, subject code, or caller-selected executable paths. No new registry implementation or registry source edit is needed. Capture events remain request inputs and are checked against the exact decoded v2 capture by S2; a source-service credential need not cross the child boundary.

Factory construction copies fixed operator roots and pin; each launch strictly parses and snapshots input, checks exact configured pin equality, then calls `getCandidate(input.artifact.hash, input.manifest.id)`. Require canonical equality of returned artifact, complete profiles, manifest, and snapshot with the parsed request (full profile membership and hashes must also validate). Derive registration only from the returned objects. Reject absent registration, foreign association, changed snapshot bytes, stale pins or build mismatch with a safe category before subject execution. Job IDs are trusted caller IDs in S3a; only S3b allocates/reserves them durably. S3a must not claim an in-memory request was reserved in PostgreSQL.

### Fixed private configuration channel

Keep evaluator stdin exactly `BootstrapEvaluatorInputV1` and subject stdin exactly `BootstrapSubjectInputV1`. The minimal adapter proposed for this handoff is a separate one-way inherited pipe at evaluator fd 3. It carries one bounded, strict private configuration object, created by the launcher after the registry read:

```ts
type BootstrapLaunchContextV1 = {
  protocolVersion: 'bootstrap-launch-context-1';
  requestHash: Hash; // hashCanonical(strictly parsed complete evaluator request)
  registration: BootstrapCapture['registration'];
  roots: TrustedBootstrapLauncherOptions['roots'];
};
```

This context is internal deployment configuration, not a new request/result wire field or registration API. It contains no expected facts, credentials, or producer records. Only the fixed bootstrap evaluator entrypoint receives fd 3; subject spawn uses only stdin/stdout/stderr and an empty environment, never forwards the context/descriptor, and never chooses roots. No argv/env path selectors, shell, temporary generated entrypoint, network registry access in the child, or process-global cwd mutation. The evaluator must reject missing/malformed/oversize context, trailing data, context/requestHash mismatch, and registration/request mismatch. It calls `readBootstrapExpectation({fixtureSetId, fixtureSetVersion, hash: fixtureHash}, {...visibleCapture, registration}, roots)` and checks the operator pin before constructing cases. S2 root disjointness/permissions checks remain mandatory. No default fallback that reconstructs registration from stdin is permitted.

The pipe is a trusted-launcher precondition, not cryptographic authentication against a hostile same-user process. This matches the existing trusted local composition/filesystem model. A manually invoked child with fabricated fd 3 data does not yield registry-issued authority. Persisted acceptance must still be through S3b's trusted launcher path. If root does not accept this specific fd 3 adapter, pause the configuration seam for review; do not silently replace it with self-certified metadata or extend frozen stdin.

Bound configuration input to 10 MiB and the same evaluator lifetime; close/destroy the extra stream on all outcomes, drain/read both input channels without write deadlock, and never echo parsing errors or config values. Fixed safe failure categories may reuse existing transport categories. Keep the evaluator process-group teardown and subject timeout cleanup behavior. Test missing context, reordered/changed snapshot against genuine registration, context replay to a different request, hostile root selection in request fields, and absence of fd 3/config/env in the subject. Expected comparison values and protected paths must not appear in stdout/stderr/public diagnostics.

### Transport reuse and import boundaries

Current `runner.ts` has private `runNode` and `exchange`; `runEvaluator` hardcodes the old schemas and `runSubject` hardcodes the old subject schema. Those exports cannot carry bootstrap by casting inputs. Reuse the bounded implementation via the allowed minimal internal extraction/export; keep old signatures, schemas, limits, framing, and financial semantics unchanged. The optional fd 3 support must be private and used only by fixed bootstrap evaluator wrappers. Do not add a package export for a generic schema/entrypoint/config transport. New fixed bootstrap wrappers own the new strict schemas, protocol/request matching, and canonical completion validation. Unit-only scripted children may use internal test seams; production entrypoints remain fixed URLs.

`bootstrap-subject-runner.ts` imports the planner and visible contracts only. Evaluator expectation/comparison paths import S2 oracle/cases and safe schemas/canonical helpers, never compiler/parent/finance, the candidate builder, or subject output as an expectation. `bootstrap-launcher.ts` must not runtime-import protected oracle modules merely to obtain `BootstrapCapture` types. Use type-only imports. Its injected registry port needs no runtime registry import. Protected modules and the fd 3 decoder stay out of product/browser exports. Safe launch/validation exports may be added as assigned; no private oracle/config transport export.

### Build manifests and validation

Define deterministic repository-relative source manifests in assigned bootstrap files. Hash canonical lexically sorted `{name, hash: hashBytes(actualFileBytes)}` entries; reject duplicate/missing paths. Include the manifest-defining implementation itself. No absolute checkout path, HEAD-only digest, mtime, or caller-provided build label. Check both digests before spawn and after evaluator exit, before accepting completion; the evaluator also checks pins before running subjects and before emitting completion. Request pin is fixed operator policy, not a newly inferred success pin.

Minimum executing local closure identified at this base:

- Shared: every `packages/contracts/src/*.ts` file (the contracts barrel reexports all of them), root `package-lock.json`, root/package manifests and `tsconfig.json` governing Node/tsx resolution. Include relevant package manifests for evaluator/contracts/compiler/finance/parent/evidence/sources; include any additional manifest traversed by final runtime imports.
- Subject: `bootstrap-subject-runner.ts`, `bootstrap-protocol.ts`; compiler `canonicalize.ts`, `compile.ts`, `operations.ts`, `plan-batch.ts`, `plan-bootstrap.ts`; parent `bootstrap.ts`, `state.ts`; finance `allocations.ts`, `balance.ts`, `reversals.ts`, `validate.ts`; any shared bootstrap transport/validation module actually imported there. Subject hashing does not authorize imports of the evaluator oracle.
- Evaluator/launcher: all seven new S3a files plus S2 `bootstrap-fixtures.ts`, `bootstrap-reference.ts`, `bootstrap-cases.ts`; existing `runner.ts`, `protocol.ts`, `fixture-store.ts`, `evidence-fixtures.ts`, `fixtures.ts`, `reference-model.ts`; evidence `extract.ts`, `index.ts`, `locate.ts`, `search.ts`, `store.ts`; sources `company-a.ts`, `company-b.ts`, `records.ts`, `errors.ts`. If comparison reuses another existing helper, add its entire transitive closure. Hashing subject code in the evaluator closure is permitted; importing subject code into the oracle is not.

Materialize the file lists explicitly from the final import graph (the groups above are the inspection checklist, not permission to leave unresolved glob strings as manifest entries). The `company-b -> records -> @eapr/evidence` barrel edge means the extraction/search/store closure must not be omitted. `runner.ts -> protocol.ts` must remain pinned even though bootstrap uses a separate schema. Existing `launcher.ts`'s financial manifest alone is insufficient: it omits this new bootstrap closure and is not the subject digest. Preserve S4b's financial manifest/semantics unchanged.

Tests must change temporary copies of each family (bootstrap checker/oracle, compiler, parent, finance, contracts/canonical, evidence/source decoding, transport, package-lock/config) and observe a changed corresponding digest; test source changes between preflight and acceptance reject completion. Do not edit actual working source as a test side effect. Verify final recursive runtime imports against the manifests and report any uncovered dependency. Installed third-party code uses the existing lockfile-based trusted-install assumption; this task does not add a package integrity verifier or hostile-local-host isolation.

### Real registered A/B pipeline before S3b

Add only `tests/integration/bootstrap-runner.test.ts` for database-backed runner proof. `vitest.config.ts` already puts `packages/**/test` in the DB-free unit project and `tests/integration` in the real-PG project. Do not call native DB setup from evaluator unit files or change root configuration. Use per-test/hook explicit timeout sufficient for the 120-second evaluator cap and setup, without weakening production caps or editing global Vitest defaults.

Reuse the preparation sequence from `tests/integration/bootstrap-fixture-setup.test.ts` and existing exported helpers: fresh realpath temp directory; isolated native database pair/migrations; `generateFixtures` seed `bootstrap-v1`, asOf `2026-10-01T00:00:00.000Z`; visible uploads/API originals; manifest publication/capture; evidence assembly and immutable v2 pin; evidence-backed metadata profile/new spec version; compile/register candidate; `prepareBootstrapVerification` via genuine registry/source service. A local helper in the new test file may repeat the setup sequence; do not widen existing production helpers or import a test file that registers its own tests.

For each company configure the launcher with the actual registry, operator-prepared sidecar pin/roots and freshly computed trusted build pins; create an explicit empty version-0 target at manifest.asOf; invoke the real fixed evaluator process which invokes the real fixed subject process once per required case. Assert all nine assertions, ten actual cases, exact request/pin/binding and retained baseline plan hashes. B must retain a nonempty financial plan with zero balance. Verify original v2 bytes unchanged and only allowlisted digest/count diagnostics. Do not compute the actual baseline by a second direct planner call in the harness and substitute it for the completion.

Also prove registry-bound failure with actual missing/foreign association and a snapshot object changed without changing the accepted capture-content preimage (for example a schema-valid eventIds order change). A request-local recomputation must not make that candidate launchable. Positive rehashed wrong-name/term subjects used for support mutation tests must first be genuinely registered under new identities, then remain unable to pass old protected expectations; distinguish preflight rejection from executed-case failure. Scripted completion/subject mutations remain unit transport/comparator evidence, never A/B construction pass evidence.

No S3b table/reservation/completion/reader, HTTP mounting, provider, UI, parent write or authority claim is included. Existing registry reads are allowed; creating a second registry is not. Persisted exact-request reservation, restart/duplicate completion checks and financial capture attestation remain later assigned work. The root-approved integration path and private adapter require handoff review, not a product-policy decision. If final implementation needs paths/APIs beyond this assignment, report the exact gap before editing them.
