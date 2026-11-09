# A1 financial attestation handoff — independent review

Reviewer: `/root/astra_financial_attestation_handoff_verify`. Scope: architecture and execution handoff only; no implementation, SQL, tests, commits or subagents. Inspected main checkout HEAD `5dedb4972a0c7bf44f85d5730409922b389a576e` (A0 integration `6336517` plus documentation); upstream acceptance is supplied by root, not independently re-established here.

Exact reviewed handoff: `b-financial-attestation-handoffs.md`, SHA-256 `4363879226cc6994dcfec28966029b9e2a7d36cdc2bd3667ec97761f23885be5`.

Authoritative proposal SHA-256 `23e7117c3b1ac8cb5c4c44b044ed2efd53530f55e38294f0165ec9ba9db1f737`; accepted parent handoffs SHA-256 `063bab1a66159f118f269c97c84a537c1529a64a0c8a7d743039f6b4096be45a`. All three hashes were independently recomputed and match the dispatch.

## Verdicts

- **Specification compatibility: PASS.** This elaborates accepted A1 without adding financial policy or activation authority.
- **Handoff quality: PASS for staged dispatch, subject to the prerequisite gates below.** No blocking specification or port incompatibility found. A1a is the next independently assignable implementation; this review does not authorize A1b/A1c concurrently or certify their future implementations.
- **Verification: static review only.** No tests executed; no machine, live, financial correctness, activation or joint acceptance claim.

## Binding and implementation compatibility

The critical fixture rule is sound: execute decodes one bounded evidence-v2 buffer, checks its reserved bundle digest, and supplies that same decoded object to the extracted financial calculation. Before/after reads supplement this rule; they do not substitute for it. This closes the mutable-path second-read/ABA gap in a wrapper that merely surrounds the legacy entrypoint. `decodeProtectedEvidenceBundle` currently returns truth/snapshot/events/evidence, not bundleHash. The handoff correctly permits obtaining bundleHash from the same raw envelope whose preimage the decoder validated, with no decoder export or fixture-format change. That digest is distinct from truth.hash and a raw-file digest.

Probe, reservation and execute are separately discriminated and bound by complete normalized request hashes, job ID, capture, build and evidence pin. Probe cannot issue a report. Actual checks follow durable budget/job/reservation insertion. Production launcher registry re-resolution and fixed child/build readers prevent a caller-supplied subject, executable or proof from becoming issuance authority. Protected roots travel only through fd3; truth readers/core remain out of safe launcher/control imports and worker stays untouched.

Extraction fits the actual small `evaluator-runner.ts`: retain `buildCasePlan`/`runCasePlan`, captured-run evidence support, existing coverage/eligibility calculation and separate subject subprocesses. Legacy numeric protocol 1 and `validateReport` remain unchanged. All thirteen checks are still mandatory. New report hashing must happen after existing diagnostic sanitation; A0 `hashFinancialReport` preserves report array order. The handoff explicitly preserves those exact sanitized completion/report bytes for duplicate completion and restart validation.

A0 schema names, literal versions, report/job relationship and hash helpers match the integrated contracts. `matchesActivationTrustPolicyEntry` compares a complete tuple, including bootstrap pin; it is not a financial-only predicate. A1b's specified per-entry financial matching is therefore appropriately narrower, with selected profile/scope checks and no invented bootstrap assertion. A2 and A4 still must establish and check the same complete policy entry. Returning an eligible financial proof never establishes readiness.

The current candidate registry has no event bytes. The new capture port and durable complete request bytes resolve that gap. `readDiscoveryCapture({db,store},catalog,{companyId,manifestId})`, `getSnapshot` and `getSnapshotRecords` exist with the stated shapes; the first validates source evidence and returns a binding, not raw events. A1c correctly performs the additional exact snapshot/event reads and full capture derivation. It must keep the specified full registered snapshot equality and event hash/membership checks rather than substitute the source coverage summary.

A1b's reserve/start/complete boundaries, exact duplicate semantics, completion/failure row locking, atomic report+attestation+job commit, absent legacy backfill and unavailable-on-noneligible reader are consistent with the accepted authority design. Canonical BYTEA alongside hashes supplies the persistence proof JSONB alone cannot provide. B remains the SQL author; control006 follows integrated005, while root owns catalog wiring. Control007/runtime002 remain excluded.

The closure requirements cover actual subject compiler/finance dependencies, A0 contracts, safe validation, protected evaluation and dependency/configuration inputs, with deterministic named-file and recursive coverage tests. The current bootstrap closure also hashes evaluator package.json, so additive package exports change bootstrap build pins even if no bootstrap source edit is needed. The handoff correctly requires final fresh reports/pins and defers policy installation until builds stabilize. Any newly required bootstrap manifest edit remains a separate root assignment.

## Explicit dispatch gates and minor clarifications

Before **A1a** dispatch, root must record acceptance/integration of A0 `6336517` and the accepted upstream financial/bootstrap prerequisites, assign the listed evaluator/test paths and serialize evaluator package.json/legacy launcher edits. This review verified the interfaces against the integrated A0 state; the handoff's statement that candidate `437739c` is still under review is stale status text, not an interface defect. Refresh it in the dispatch record. No installed policy or control006 execution is prerequisite to A1a transport/core work.

Before **A1b**, require accepted exact A1a safe ports, integrated005, B's explicit006 ownership, and root coordination for catalog updates. Before **A1c**, require accepted A1b/006 and actual migration catalog readiness, explicit app ownership, and real source/capture/launcher composition. Preserve separate transport, registry and composed provenance evidence. A2/A4 remain blocked on their own prerequisites.

Clarify A1a's phrase “evaluation failure produces no successful transport completion” as **execution/decoding/binding failure**. A valid completed evaluation can have failed/unavailable checks and produce a sanitized ineligible report for audit, as the A1b section already permits; it must never become an eligible trusted-reader result. This is a wording clarification, not a requested semantic change.

No additional user financial-policy decision is needed for this bounded handoff. Fresh exact-candidate implementation review and the listed adversarial/real-process/PostgreSQL checks remain required after each assigned stage.

## Inspection record

Read repository/package/evaluator instructions, F6, accepted proposal/handoffs and new A1 brief; inspected integrated A0 schemas/hash helpers, evaluator core/decoder/fixture store, report validator, legacy launcher/transport/jobs/registry, bootstrap launcher/build closure, source discovery/snapshot readers and control verification route/composition. Used read-only `cat`, `sed`, `rg`, `git log`/`git rev-parse` and `shasum`; the sole written artifact is this review. Unchanged prior slices were inspected only at these dependency seams, not broadly re-reviewed.
