# Sync writer Task 3 fixture clarification

Read-only review of `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`. No implementation, repository/Git changes, database operations, or tests were performed. This is a fixture/spec ruling, not evidence that the candidate passes.

## Verdict

The proposed replacement preserves the normative financial and receipt semantics and is an appropriate plan clarification. The literal 10,000-cent initial invoice and unallocated 4,000-cent initial payment cannot be obtained through the existing `issueActivationProofs` interface: it generates a fixed `activation-policy` seed, protected construction evidence and truth; `verifyOriginals` independently reconstructs those same originals. The selected A customer's initial payment and credit funds are fully allocated. Adding another allocation against those funds must fail and is not a valid way to reproduce the illustration.

Do not change that helper, canonical sources, protected fixtures, approved records, or production behavior to reproduce illustrative amounts. Task 3's phrase “reuse issueActivationProofs with isolated development input” assumes a hook that does not exist. Correct that fixture instruction explicitly; do not silently claim the literal illustration was executed.

The root proposal proves mixed initial-origin/new economics through the invoice, mixed ongoing-origin/new economics through the later payment, and multiple typed original receipts in all replay. One small strengthening is recommended: include a new-delivery replay of the original initial payment in the first mixed unit. This retains explicit initial-payment-in-mixed-unit coverage called out by the design, rather than relying only on a separate initial-payment replay test. It adds no financial operation and requires no production change.

## Exact recommended topology

Use genuine existing A5 activation and its immutable receipt R0. Let S be the selected source account ID and use the initial September records:

- I0: `inv-a:` + S + `-2026-09-01`, amount 300,000 cents.
- P0: `pay-a:` + S + `-2026-09-01`, amount 200,000 cents.
- Existing payment allocation: `alloc-payment-a:` + S + `-2026-09-01`, 200,000 cents from P0 to I0.
- Existing credit and its allocation: 20,000 cents, both unchanged.

The earlier selected-account invoices are fully allocated. Therefore the full selected-account balance is 80,000 cents. Assert the concrete initial target contents and this balance before the new units; do not replace the original target with a synthetic subset. Derive target IDs from the full fixed economic identity using `targetRecordId`, and compare exact ordered receipt IDs against the expected new operation IDs.

Choose these new economic record IDs:

- P1: `pay-a:sync-apply-partial`, payment 4,000 cents, effective 2026-10-02.
- A1: `alloc-a:sync-apply-partial-1`, allocation 2,000 cents, P1 → I0, effective 2026-10-02.
- A2: `alloc-a:sync-apply-partial-2`, allocation 1,000 cents, P1 → I0, effective 2026-10-03.

Use the fixture's explicit `syncApplyInstant` as planning asOf. Preserve the original effective date, amount, currency, account, relationship fields, and due date for every replay. New financial-replay deliveries have fresh event IDs and source positions, with their correctly recomputed event hashes. Exact retransmissions reuse the entire original canonical delivery, including observedAt and position.

| Unit | Complete captured suffix | Required financial result | Required receipt association |
| --- | --- | --- | --- |
| U1 | Fresh delivery E-I0 of I0, fresh delivery E-P0 of P0, new delivery E-P1 of P1, new delivery E-A1 of A1 | Exactly P1 and A1 inserted; version V0→V0+1; balance 80,000→78,000; P1 retains 2,000 unallocated | Nonempty R1 acknowledges all four distinct IDs in canonical plan order; targetRecordIds contain only P1/A1 in operation order; E-I0 and E-P0 resolve to initial R0; E-P1/E-A1 resolve to ongoing R1 |
| U2 | Fresh delivery E-P1b replaying P1, new delivery E-A2 of A2 | Exactly A2 inserted; version V0+1→V0+2; balance 78,000→77,000; P1 retains 1,000 unallocated | Nonempty R2 acknowledges both IDs; targetRecordIds contains only A2; E-P1b remains associated with R1, E-A2 with R2 |
| U3 | Fresh deliveries replaying I0, P1 and A2 | No financial rows, target version, snapshot, monetary receipt or new operation lineage; balance remains 77,000 | Separate replay unit returns exactly original R0, R1 and R2, deduplicated by typed origin and sorted as specified; three new outcomes and progress commit together under active authority |

These are connected groups under the accepted classifier: existing allocation edges connect P0 and I0; new A1 connects P1 to I0; existing A1/A2 connect later replay candidates. This is established by the actual code, not inferred from prerequisite metadata: `packages/compiler/src/plan-batch.ts:206` calls `link(record)` for every existing target record before line 207 links candidates; lines 161–165 supply both allocation-funding and allocation-invoice edges; lines 198–202 union those edges; lines 210–214 group candidate inputs by their resulting root. Therefore the original allocation need not itself appear as an input to connect P0 with I0. Assert exactly one accepted group, no holds/blockers and complete suffix membership; do not cut a multi-group combined plan to force acceptance.

U1 proves unallocated funds do not reduce balance: a 4,000-cent payment with a 2,000-cent allocation reduces balance by exactly 2,000, not 4,000 or 6,000. U2 then proves an existing funding record is replayed while only its new allocation is inserted. It is valid that U2's funding origin is ongoing: U1 separately exercises initial origins in a mixed receipt. Never allocate additional money from fully allocated P0 merely to match the original example.

## Required companion coverage

1. In a separate genuine-activation fixture variant, include a second fresh delivery of A1's exact economics in U1. Assert `financial_coalesced`, both event IDs acknowledged, one A1 row/operation, identical 78,000 ending balance, and both allocation deliveries associated with R1. An original record delivered later is replay, not coalesced.
2. Preserve the initial payment/initial allocation replay case. Capture fresh deliveries for P0 and its existing 200,000-cent allocation as a connected all-replay suffix; both resolve to R0 without a financial change. Distinguish this new acknowledgment from exact retry of an already committed unit.
3. Repeat an identical captured page and assert unchanged inbox/position cardinality. Exercise `delivery_repeat` in the unit/classifier test with identical input occurrences; do not invent a second source position for the same global delivery. A page retry alone does not prove that classifier branch.
4. Assert byte-identical R0, approved snapshot, all original records and initial origin associations after U1/U2/U3; byte-identical R1 and P1 after later replays; exact event outcome origins and unit membership, full IDs, snapshots, version changes, frontier and activity counts. U3 must not add a runtime005 receipt or increment the receipt-derived applied-batch count.
5. Retain the entire Task 3 negative matrix, active-epoch bookkeeping checks and exact lost-response recovery. This topology does not replace Task 4's standalone unallocated-funding, reversal, backdated snapshot, rollback or race obligations.

Use test-only development event construction/source append support within the assigned fixture/test paths and the existing accepted runtime capture service. Persist canonical complete captured pages and provenance before preparing/applying; never inject runtime financial rows/origins or feed caller-only events directly to the writer. The existing scenario-admin `freshPaymentA` always creates a fully allocated payment, so it cannot be reused unchanged to create P1/A1's partial allocation. A narrow test-only helper is appropriate; a broader product source-provider API is unnecessary.

## Specification basis

- Task 3, plan line 151: fixture illustration, initial/ongoing originals, coalescence, exact capture repeat, multi-origin all replay and prohibition on protected fixture changes.
- Atomic-apply design §4 and §9: separate economic origin, delivery effect association and mixed-unit acknowledgment; operation-derived new target IDs; initial and ongoing original receipt coverage; no zero-effect monetary receipt.
- Contract freeze F3/F5: unallocated funds do not reduce balance; replay preserves original records/receipts; mixed receipts acknowledge duplicates while inserting only new economics.
- `packages/compiler/src/plan-batch.ts` `dependencyGroups`: both existing and proposed allocation edges determine connectivity.

This is a test-fixture correction implementing already specified behavior, not a new monetary policy or authority extension. The strengthened topology is recommended; any claim of passing remains contingent on actual isolated integration checks and fresh exact-candidate review.
