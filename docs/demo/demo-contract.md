# Demo contract — pregenerated connector + AI-off sync

**Status:** Frozen T0 demo contract. Implementation status below tracks the local fixture path. V3, V5, V6 and joint acceptance remain separate.

**Track:** Review a labeled fixture connector, explicitly approve one Company A customer, inject one conforming post-cutover payment, and show deterministic worker sync with AI off. Live on-stage construction is [T9](../superpowers/plans/2026-11-10-demo-remaining-work.md#t9--later-track-explicitly-deferred-genuine-live-construction), not this script.

**Branch that froze this page:** `docs/t0-demo-contract`.

## Construction modes

| Mode | Catalog / packet label | Allowed claim |
| --- | --- | --- |
| `fixture` | Catalog `mode` is `development-fixture`. Preview eyebrow **Development fixtures**. | Hand-authored / operator-pinned development candidate. Current local demo. |
| `captured-run` | Must say captured-run (or equivalent) in UI and evidence. | Previously recorded construction replayed later. T7 packaging only; Discovery may show it **only if labeled**. |
| `live` | Genuine provider-built artifact for this run. | On-stage model construction. T9 later track. Forbidden until real. |

Do not call fixture or captured-run “live,” “agent-built just now,” or “model construction.” The default composition has no model client. The runtime worker has no model SDK or key.

**Current demo:** `fixture` / `development-fixture`. After [parent-read setup](parent-read-setup.md), Preview `targetMode` is `persisted-parent`. This is the T7 labeling decision: package and present the existing operator-pinned fixture; do not relabel it as captured-run or live.

## Company A identities (`local-demo-v1`)

Seed `local-demo-v1`, as-of / cutover `2026-10-01T00:00:00.000Z`. `d22feb38e846` is `hashCanonical('local-demo-v1')` truncated to 12; `d4e83b7db551` is the same of the as-of instant. The loader rejects a visible manifest that does not match this pin.

| Field | Value |
| --- | --- |
| companyId | `company-a` |
| sourceRef | `legacy-a` |
| seller | `seller-a` |
| manifestId | `manifest-a-d22feb38e846-d4e83b7db551` |
| epoch | `1` |
| asOf / cutover | `2026-10-01T00:00:00.000Z` |
| source account | `cust-a-d22feb38e846-1` |
| parent scope / accountId | `company-a.seller-a.cust-a-d22feb38e846-1` |
| parent customer | `buyer-shared-d22feb38e846` |
| candidate | `demo-candidate-a` |
| profile | `demo-profile-a` version **2** |
| connector spec | `demo-connector-a` version **1** |

Runtime hashes change per registration. Fill them from the [parent-read setup](parent-read-setup.md) listing (same database namespace and checkout as `npm run dev`). Copy only the three selection fields into the mode-`0600` publication file.

| Listing field | Frozen identity or blank |
| --- | --- |
| `manifestId` | `manifest-a-d22feb38e846-d4e83b7db551` (listing must match) |
| `scope.accountId` | `company-a.seller-a.cust-a-d22feb38e846-1` (listing `scope` is an object; match this accountId) |
| `artifactHash` | `_fill from listing_` |
| `selectedProfileHash` | `_fill from listing_` |

F8 public-fixture literals (`cust-a-1`, `buyer-shared-1`, `manifest-a-1`, `profile-a`, `inv-a-1`, `pay-a-2`, …) are **test-only**. They are not the local demo.

## Money (integer cents)

Company A first-account baseline nets to an $800 opening receivable (September invoice `300000` less allocated `200000` payment and `20000` credit). Unallocated cash does not reduce the invoice.

| Observation | `asOf` | Cents | UI |
| --- | --- | --- | --- |
| Cutover open receivable | `2026-10-01T00:00:00.000Z` | **80000** | Preview **Amount still owed after proposed import**; Parent **Stored balance** with that `asOf` |
| After the injected $300 payment (below) | current / `2026-10-03T00:00:00.000Z` | **50000** | Parent **Stored balance**; Operations receipt **Balance after** |
| Cutover after that payment | still `2026-10-01T00:00:00.000Z` | **80000** | Parent explicit `asOf` at cutover |
| Sync receipt | — | before **80000**, after **50000** | Operations sync receipt **Balance before** / **Balance after** (not the initial activation receipt) |
| Replay of the same source identity | current | **50000**, one economic effect | Same receipt `replayed`; no second payment/allocation row |

Preview **Parent writes:** `0`. Approval is the only path that may write parent money.

Injected payment (fully allocated; `freshPaymentA` always emits payment + allocation together):

| Param | Value |
| --- | --- |
| amount | `300.00` ($300 → 30000 cents) |
| effectiveDate | `2026-10-03` |
| observedAt | `2026-10-03T00:00:00.000Z` |
| accountId | `cust-a-d22feb38e846-1` |
| invoiceId | `inv-a:cust-a-d22feb38e846-1-2026-09-01` |

A payment without the allocation must leave **80000**. That is not this beat.

## Company B

Excluded from the primary script. The selected B preview is open **0**; CSV lanes are rejected for the whole capture cut. Optional stretch only after T0/T8 reopen it and CSV/file capture apply actually exists. Do not enroll B, inject `batchB`, or treat B’s unidentified remittance as demo money.

## Staged walkthrough

Preconditions: Node 24 and PostgreSQL 18; `npm ci`; `npm run dev`; [verification setup](verification-setup.md), [parent-read setup](parent-read-setup.md), [activation policy](activation-policy-setup.md), [activation review](activation-review-setup.md), [worker activation](worker-activation-setup.md). Open http://127.0.0.1:5173. Nav: **Health**, **Sources**, **Preview**, **Review**, **Parent**, **Operations**, **Discovery**.

`FEATURE_NOT_IMPLEMENTED` (or the same code on a harness/CLI stub) is **fail**, never progress.

| # | Surface | Action | Pass | Fail | Product-ready? |
| --- | --- | --- | --- | --- | --- |
| 1 | **Health** | Load the app. | **System ready**; Control database and Runtime database visible. | Unready health; credentials in the browser. | Machine gate passing (V0); not joint acceptance. |
| 2 | **Sources** · **Sources and evidence** | Open the Company A dossier and a citation. | Original evidence distinct from interpretation; `legacy-a` / `company-a`. | Invented amounts; missing originals. | Machine gate passing (V1); not joint acceptance. |
| 3 | **Discovery** | Open **Discovery**. | **Discovery model is unavailable.** / starting a run unavailable. State the worker has no model client. | UI implying live construction or a configured model. | Ready as AI-off posture; live construction is T9. |
| 4 | **Preview** · **Development fixtures** | Select `demo-candidate-a`. **Refresh candidates** after scope publication. **Run preview**. | Catalog `development-fixture`, `persisted-parent`; **Parent writes:** `0`; **Amount still owed after proposed import** **$800.00** (80000 cents) at cutover; scope `company-a.seller-a.cust-a-d22feb38e846-1`. | Live/agent-built wording; parent writes ≠ 0; F8 IDs; B’s 0 treated as A. | Machine gate passing (V2) after operator setup; not joint acceptance. |
| 5 | **Preview** / **Review** | Independent verification and package details. Every amount has evidence or a derivation. | Eligible attested report for the listed hashes; details load. | Ineligible coverage treated as approval; protected proof in the browser. | Setup-dependent; not V3 acceptance. |
| 6 | **Review** · **Customer review** | Registered account `company-a.seller-a.cust-a-d22feb38e846-1`. **Prepare review package**. Inspect evidence. **Approve this customer only**. | One-customer copy; receipt with id, activation id, epoch `1`; initial activation receipt after-balance **80000**; Parent **Stored parent state** imported; cutover **Stored balance** **$800.00**. Retry same key returns `replayed`, one import. | Other-customer approval; invented authority; second economic effect. | **Blocked on T3** (browser workflow / V3 not accepted). Backend intents exist; do not claim V3. |
| 7 | Inject | Operator runs `npm run demo:inject -- freshPaymentA` (next section). Model remains off. | Source contains the new payment and allocation; not in the discovery snapshot. | `FEATURE_NOT_IMPLEMENTED`; UI injection; treating the stub as the event. | Mounted with explicit [operator setup](company-a-sync-setup.md). |
| 8 | Apply | Worker captures/classifies/applies the pinned artifact. No second approval. | Current **50000**; cutover asOf still **80000**; receipt before **80000** after **50000**; `runtimeModelCalls` forbidden / zero. | Balance invented in the UI; cutover rewritten; model call. | Mounted for the fixed Company A fixture. Full V5 pending. |
| 9 | **Operations** · **Connection operations** | Select the same account. **Refresh connection state**. | Worker-authored **active** (or truthful inactive); epoch; streams; receipt history with those cents. Pending / quarantine / lag **Not measured** until persisted. **Runtime model calls** forbidden. | UI-computed balances; inferred authorization; pause/resume/revoke as if mounted. | **Blocked on T4**. The Operations presentation remains pending. |
| 10 | Replay | Same source identity / delivery again. | Current still **50000**; one economic effect; receipt `replayed` or equivalent. | Second payment/allocation; doubled money. | Fixed command replays the committed receipt. Full V6 pending. |

Timed rehearsal log and reset (`npm run db:down`, then `npm run dev`) stay in [walkthrough and rehearsals](walkthrough-and-rehearsals.md). That checklist does not override this contract.

## Injection

**Fixed source scenario** used by the private control command:

```ts
createScenarioAdmin(dependencies, {
  DEMO_OPERATOR_ENABLED: 'true',
  DEMO_OPERATOR_TOKEN: operatorToken, // required when enabled; separate from reviewer session
}).freshPaymentA(operatorToken, {
  id: 'demo-pay-a-cutover-300',
  accountId: 'cust-a-d22feb38e846-1',
  invoiceId: 'inv-a:cust-a-d22feb38e846-1-2026-09-01',
  amount: '300.00',
  effectiveDate: '2026-10-03',
  observedAt: '2026-10-03T00:00:00.000Z',
});
```

Derived source records: payment `pay-a:demo-pay-a-cutover-300`, allocation `alloc-a:demo-pay-a-cutover-300` (`funding_kind` payment, `funding_id` that payment, `invoice_id` the September invoice). Optional `semanticVersion` defaults to `sem-a-1`, which is account 1's captured revision.

Enable the private commands using the [Company A sync setup](company-a-sync-setup.md), then run `npm run demo:inject -- freshPaymentA`. The CLI calls control for source injection and the worker for one synchronization. Retry the same command after an uncertain result. The legacy `tests/fixtures/harness.ts` `sourceAdmin.inject` stub still reports `FEATURE_NOT_IMPLEMENTED`.

## Open decisions

Recorded, not frozen as product behavior:

| Topic | Default in this contract | Reopen when |
| --- | --- | --- |
| Extra source-issued invoice beat (PRD §17) | Out. Primary money beat is the $300 allocated payment. | Integrator adds it to the script after T1/T2 can import a new invoice. |
| Company B | Out of the primary script. | CSV/file capture apply is actually available; T8 stretch. |
| Injection transport mounting | Authenticated operator-only loopback HTTP through the fixed CLI. | A future operator workflow changes the transport. |

## Related

- [PRD v2 §17 Synthetic data and demo](../../prdv2.md#17-synthetic-data-and-demo)
- [Demo remaining work](../superpowers/plans/2026-11-10-demo-remaining-work.md)
- [Walkthrough and rehearsals](walkthrough-and-rehearsals.md)
- [Verification setup](verification-setup.md) · [Parent-read setup](parent-read-setup.md) · [Activation policy](activation-policy-setup.md) · [Activation review](activation-review-setup.md) · [Worker activation](worker-activation-setup.md)
