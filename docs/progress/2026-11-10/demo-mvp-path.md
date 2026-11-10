# Demo MVP path — fixture connector + AI-off sync

Date: November 10, 2026  
Audience: Integrator, Platform, Experience, cold-start agents  
Status: Coordination path for a **runnable on-stage demo** against live local APIs. Not joint acceptance. Not live construction.

## Staged UI vs live APIs

| Mode | What it is | When to use |
| --- | --- | --- |
| **Staged demo responses** | Opt-in frontend theater (`?stub=1` / banner / `VITE_EAPR_DEMO_STUB=1`) with hardcoded Company A cents and fake loading | Incomplete deploy, timing walkthroughs, no worker |
| **Live local APIs** | Real control + worker + Postgres against `local-demo-v1` | Rehearsals, e2e, joint acceptance, anything that claims receipts |

Staged mode must match [demo-contract](../../demo/demo-contract.md) identities and integer cents, but it does **not** replace worker receipts. Joint acceptance requires live APIs only.

### Staged frontend when services are down

1. Click **Enable staged demo responses** in the banner, or open with `#health?stub=1`, or set `VITE_EAPR_DEMO_STUB=1`.
2. Buttons show a short loading theater, then hardcoded Company A fixture outcomes that match a real local-demo-v1 run: Preview/cutover **80000**, Parent pre-inject current still **80000**, post-inject current **50000**, activation receipt `0 → 80000`, sync receipt `80000 → 50000`, replay same receipt id. Inject is labeled as a CLI stand-in for `npm run demo:inject -- freshPaymentA`.
3. Copy always labels the mode as staged/development-fixture — not live receipts and not live construction. Registration-specific hashes are omitted (fill from a live listing).
4. Click **Use live local APIs** to return to real control/worker calls (required for e2e and joint acceptance).

This is presentation scaffolding only. Core activation/sync work continues on the live path in Steps 1–4 below.

## Locked product shape

The demo MVP is the frozen [demo contract](../../demo/demo-contract.md) track:

1. **Hardcoded / pregenerated** Company A connector labeled `fixture` / catalog `development-fixture`. Do not imply live model construction.
2. Reviewer **approves one customer only**.
3. Operator injects a **simulated** post-cutover source event with the existing private CLI (`npm run demo:inject -- freshPaymentA`) — a fixed $300 allocated payment, not UI-invented money.
4. Runtime worker syncs with **AI off** (no model SDK/key): current balance **80000 → 50000**, cutover asOf still **80000**.
5. Replay the same inject: original receipt, `replayed: true`, **one economic effect**.

Live OpenAI construction is [T9](../../superpowers/plans/2026-11-10-demo-remaining-work.md#t9--later-track-explicitly-deferred-genuine-live-construction) and is **not** on the critical path. Extra invoice beats and Company B stay optional stretch per the contract.

## Where the code is now

| Surface | Exact tip / note |
| --- | --- |
| Integrated Company A mount + Experience T3/T4/T8 | `codex/platform-company-a-demo-mount` @ `a945586` (PR57 Platform + [PR64](https://github.com/dxicheng007/EnterpriseAgenticPaymentResolution/pull/64) Experience); later tips add staged UI / docs |
| `main` | `12f6595` — has PR57/59/61 mount and ops corrections (`runtimeModelCalls: null`); **does not yet include** PR64 authority-consumption fixes or the three rehearsal records |
| Experience completion | [experience-mvp-completion.md](experience-mvp-completion.md) — focused e2e + independent PASS + three timed rehearsals on candidate `bac37fa` |
| Platform drafts still open | [PR62](https://github.com/dxicheng007/EnterpriseAgenticPaymentResolution/pull/62) V5 evidence allowlist; [PR63](https://github.com/dxicheng007/EnterpriseAgenticPaymentResolution/pull/63) Connections boundary tests (stacked) |

Three rehearsals already proved the money beat on an isolated lease. That is **not** the same as main being demo-ready or joint user acceptance.

## Critical path to a demo that actually runs

Same Steps 1–4 as the prior MVP path. Experience’s immediate actionable slice inside Step 1 is the post-PR61 Connections null consumer (so the platform tip matches `main` before Integrator lands it).

### Step 1 — Land the runnable tip on `main` (Integrator / Developer 0)

1. Merge or rebase [PR62](https://github.com/dxicheng007/EnterpriseAgenticPaymentResolution/pull/62) / [PR63](https://github.com/dxicheng007/EnterpriseAgenticPaymentResolution/pull/63) as Platform intends.
2. Integrate `codex/platform-company-a-demo-mount` @ `a945586` (or successor) into `main` so Experience authority recovery and rehearsal docs ship with the mount.
3. After PR61’s Connections `runtimeModelCalls: null` is on the integration base, land the **Experience follow-up**: render `null` as **Not measured** under an explicit AI-off / forbidden worker posture — never as a measured zero. Port the tip’s remaining `literal(0)` producer/contract onto the same null shape so the merge does not regress. Do not invent progress counts.

**Exit:** `main` HEAD can boot the Company A fixture path that PR64 already rehearsed, with honest unmeasured model-call semantics.

**Experience now:** doing item 3 on the Experience tip (contract + worker producer + Operations UI + e2e). Integrator still owns items 1–2.

### Step 2 — Disposable staging that does not touch the preserved demo (Platform + Experience)

Today’s operator chain works but is multi-step (fixtures → verification → scopes → bootstrap → policy → restart with `EAPR_REVIEW_SELECTION_FILE` → approve → inject). Demo day needs:

1. A **dedicated checkout + leased ports/namespace** (never the preserved original demo PGDATA).
2. Explicit **fresh first-apply reset** (drop/recreate the leased demo DBs). `npm run db:down` only stops Postgres and **does not** clear approvals/imports — see [walkthrough reset note](../../demo/walkthrough-and-rehearsals.md).
3. A single operator checklist that ends in: Health ready, verification available, Company A scope published, policy installed, browser can **Prepare** / **Approve this customer only**.

Published checklist: [disposable staging](../../demo/disposable-staging.md) (points at the existing verification / parent-read / activation / company-a-sync guides; does not replace them).

**Exit:** A cold operator can reach approve-ready Company A on a disposable lease in one sitting without touching the original demo.

### Step 3 — On-stage script (already contracted)

Use only [demo-contract](../../demo/demo-contract.md) steps 1–10 on **live APIs** (staged UI off):

| Beat | Surface | Expected |
| --- | --- | --- |
| Inspect | Sources / Discovery / Preview | Fixture label; Discovery model unavailable; parent writes 0; owed **80000** |
| Approve | Review | One account `company-a.seller-a.cust-a-d22feb38e846-1`; receipt after **80000** |
| Simulate new money | Operator shell | `DEMO_OPERATOR_TOKEN` private; `npm run demo:inject -- freshPaymentA` |
| Observe | Parent / Operations | Current **50000**; cutover asOf **80000**; worker receipt before/after; connector plan `runtimeModelCalls: forbidden`; Connections overview `null` / **Not measured** (AI-off posture, PR61) |
| Replay | Same inject | Same receipt id, `replayed: true`, no second payment/allocation |

Sanitized evidence pattern already exercised under ignored `.evidence/experience-mvp-rehearsals/run-{1,2,3}/`.

**Exit:** One clean timed run on the integrated `main` tip with retained sanitized screenshots/CLI receipts.

### Step 4 — Joint demo acceptance (user)

Machine gates and agent rehearsals do not replace the user’s walkthrough. Record pass/fail in the [rehearsal log](../../demo/walkthrough-and-rehearsals.md). Only the user can waive remaining rehearsals or accept the demo.

## Parallel work that must not block the demo

| Work | Why deferred for MVP demo |
| --- | --- |
| T9 live model construction / Gate J acceptance | Explicit later track; fixture path is the demo |
| Full V5/V6 slice green | Bounded Company A gate + rehearsals cover the money beat; full matrices stay fail-closed until separately proven |
| Company B / CSV apply | Contract primary script excludes B |
| Extra invoice inject beat | Contract default is payment-only; reopen only after T1/T2 can import a new invoice |
| Cosmetic redesign, general scheduler, production auth | Out of demo MVP |

## Owner split for the remaining path

| Owner | Next concrete work |
| --- | --- |
| **Developer 0 / Integrator** | Main integration of platform tip + PR62/63; update shared board; keep original demo preserved |
| **Experience** | Step 1 item 3 (`runtimeModelCalls: null` consumer + tip producer align); Step 2 disposable staging checklist; help Step 3 after main land; do not claim joint acceptance |
| **Platform** | Keep Connections/shared-lane backend truthful; no UI edits in Experience paths during that follow-up |
| **Discovery** | No demo-blocking task; optional T7 packaging only if labels need clearer captured-run packaging |

## Discoverability

- Shared board: [demo remaining work](../../superpowers/plans/2026-11-10-demo-remaining-work.md)
- Disposable staging: [disposable staging](../../demo/disposable-staging.md)
- Experience delivery record: [experience-mvp-completion.md](experience-mvp-completion.md)
- Prior exclusive Experience reservation (historical): [experience-mvp-handoff.md](experience-mvp-handoff.md)
- Setup: [company-a-sync-setup](../../demo/company-a-sync-setup.md) and linked verification/parent/activation guides
