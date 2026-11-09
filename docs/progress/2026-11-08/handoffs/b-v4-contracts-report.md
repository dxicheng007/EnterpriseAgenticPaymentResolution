# B report · V4a discovery contracts

## Candidate

- Branch `codex/discovery-contracts` in `/Users/devincheng/.codex/worktrees/acquisition-evaluator/EnterpriseAgenticPaymentResolution`.
- Base `fbd6f0fe3ce6bf3fda9a128c7d6aebf4d1549970`.
- Head `40c8c6dc398ff08e3781bd11ded2abc2ad5b0235` (`feat: freeze bounded discovery contracts`). Worktree clean. No merge or push.
- Sole architecture authority `v4-orchestration-contract-proposal.md`, SHA-256 `b1837d309cf42af960838b61fc7a4c9aee64cb3a74150ca0f0c8b81cc715f3cf`, with the completed independent fix review. Candidate implementation review remains pending.
- Diff is confined to `packages/contracts/src/{discovery,discovery-helpers,index}.ts`, `packages/contracts/test/{discovery,discovery-helpers}.test.ts` and `docs/superpowers/plans/2026-11-08-contract-freeze-v3-discovery-shapes.md`. Existing schemas and canonical helpers were consumed as-is.

## Export inventory

`packages/contracts/src/discovery.ts` is the direct browser-safe entry. Each named schema has the inferred type without the `Schema` suffix.

- `DiscoveryBindingSchema`, `DiscoverySubjectSchema`, `SourceReadGrantSchema`, `DiscoveryTaskContextV2Schema` and `toVerificationTaskContext(context: DiscoveryTaskContextV2): TaskContext`.
- `ModelMessageV2Schema`, `ModelTurnV2Schema` and `ModelResultV2Schema`.
- `DiscoveryFindingV2Schema`, `CustomerProfileDraftSchema`, `DiscoveryProposalV2Schema` and `ProposalResultSchema`.
- `DiscoveryStateV2Schema`.
- `DiscoveryCapabilitiesResponseV2Schema`, `StartDiscoveryRequestV2Schema`, `StartDiscoveryResponseV2Schema` and `DiscoveryActionRequestV2Schema`.
- `DiscoveryCursorV1Schema`, `ControlActivityWindowSchema` and `ControlActivityPageSchema`.

`packages/contracts/src/discovery-helpers.ts` is server-only.

- `createToolStepId(input: {dispatchId:Id;providerToolCallId:Id}): Id`.
- `encodeDiscoveryCursor(input: DiscoveryCursorV1): string`.
- `decodeDiscoveryCursor(wire: string, expected: {runId:Id;highWater:number;retainedAfter:number}): DiscoveryCursorV1`.
- `DiscoveryResyncRequiredError` with code `RESYNC_REQUIRED`. Invalid cursor claims use the existing `InvalidCursorError` and `CURSOR_INVALID`. Invalid expected server bounds are ordinary schema validation errors.

The server package barrel exports both modules. The tracked freeze contains all three exact tool-step vectors, both canonical cursor wires, source-wide projection, pending finding, bootstrap and blocker assessment examples, and the continuation example.

## Representation decisions

- Owner ruling applies F1 canonical numbers to new model/finding free-form JSON through local wrappers around existing safe JSON parsers. Fractions, unsafe integers and negative zero fail, while decimal source amounts remain strings. The wrapper checks the owner-approved ceiling of 128 nested containers from each free-form field root before invoking the recursive parser. A 4,000-level wire-shaped array now produces a schema failure. An explicit undefined optional model result message is emitted as absent for canonical serialization. V1 and the existing full profile parser retain their existing JSON semantics.
- New declared sets sort lexically by the exact identity key or JSON-encoded tuple after duplicate rejection. Model transcript/call order, questions, alternatives and diagnostics retain their order. Nested existing profile, spec and activity parsers keep their own representation rules.
- A compiled result requires both artifact and exact single profile hashes and empty assessment blocker references and diagnostic codes. Historical draft/blocked results can retain hashes. General diagnostics stay separate. Shape checks cannot detect an omitted or stale blocker.
- A continuing page requires a nonempty page whose final sequence equals `nextAfter` and lies below high-water, since a lookahead row would have to lie above it within the window.
- The draft adapter rejects an own `hash` including undefined and validates with the complete current profile parser using a temporary hash. It drops that value before returning the draft. Both draft and full discovery proposals reject nonpending or non-agent profile findings. The tests exercise reattachment through the current hash helper for both absent and present bootstrap. No synthetic hash is returned or persisted.

## Partial V4a verification

Node v24.22.2 via `export PATH=/opt/homebrew/opt/node@24/bin:$PATH`.

| Command | Result |
| --- | --- |
| `npm run test:unit -- packages/contracts/test/discovery.test.ts packages/contracts/test/discovery-helpers.test.ts` against minimal importable declarations | Red, 16 failed and 2 passed. Actual assertions included step/cursor vector mismatches, wrong v1 projection, accepted invalid transcripts, state and page and unsafe JSON. |
| `npm run test:unit -- packages/contracts/test/discovery.test.ts -t 'nesting limit\|undefined optional response'` before those two fixes | Red, both selected tests failed on their target assertions. |
| `npm run test:unit -- packages/contracts/test/discovery.test.ts packages/contracts/test/discovery-helpers.test.ts packages/contracts/test/fixtures.test.ts packages/contracts/test/v3-contracts.test.ts packages/contracts/test/v3-hash-compatibility.test.ts` | Green, 42 passed across five files. |
| `npm run test:unit` | Green, 186 passed across 26 files. |
| `npm run typecheck` | Exit 0. |
| `git diff --cached --check` and `git diff HEAD^ HEAD --check` | Both exit 0. |

The first sandboxed Vitest start hit EPERM when writing its worktree cache. The authorized worktree-scoped escalation ran the test commands above. The red evidence comes from assertion failures after imports loaded. PostgreSQL, browser, model/provider and evaluator execution are outside this contract-only verification.

## Deferred consumer obligations

- Dispatch verifies persisted authority, current run/capture bindings, exact source membership, delegation narrowing, reviewer scope and the dispatch fence. The v1 context projection authenticates nothing and source grants carry no parent identity approval.
- The model adapter and dispatcher enforce actual per-request policy, usage, dispatch/result equality and tool allowlist. Durable step rows own replay conflicts, cross-run isolation, request keys and actual execution. Unknown tool names stay representable at the schema boundary.
- The proposal/finding service owns evidence existence and applicability, current head, derivation DAG, scope and profile/spec hash computation. The durable assessment derives stable run/capture/account investigations and retains sticky blocker provenance despite omitted citations or revised proposals. Atomic invalidation and finish guards are later A obligations. Serialized assessment shape cannot authenticate origin, discover omitted blockers or grant approval or eligibility.
- The separately assigned reader owns a coherent database statement/MVCC snapshot, bounded run-filtered lookahead, requested run/after/limit validation, and proof of exhaustion. SSE replay, per-page session authorization, activity allowlist changes and the composite runtime/control stream are consumer work.
- Present-bootstrap `evidence_support` remains unavailable. The thirteen financial checks do not establish bootstrap or readiness. Full T4.1, V4, T4.2, live generation, activation and deterministic runtime proofs remain separate. Exact-candidate independent review and joint acceptance are separate gates.
