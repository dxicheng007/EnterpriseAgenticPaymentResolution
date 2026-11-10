# D4 Discovery unblock handoff

**Date:** 2026-11-09  
**Discovery tip context:** D4a sandbox replay/compare merged; D4d offline live ModelClient stub lands on `team-discovery-d4b`.  
**Status:** Discovery-owned offline provider boundary is implementable without Platform. **D4b verification tools and D4c repair/finish are blocked on external engineering** listed below. This document is the unblock checklist — not authorization to invent those policies or DDL in Discovery.

Authority: team-expansion §D4; `v4-orchestration-contract-proposal.md` §4 tools + §7 V4d + §8.1 capability gap; `b-discovery-construction-handoff.md` gaps #4–#6.

---

## What Discovery already shipped (do not redo)

| Slice | Outcome |
| --- | --- |
| D2 association producer + consumers | Agreement→account association under grant; sticky blockers preserved |
| D3 / C3 `compileConnector` | Reserve → external compile/register → settle; orphans ≠ current compiled |
| D4a `runSandboxReplay` / `compareArtifacts` | Empty-sandbox `parentWrites:0`; same-run deterministic diffs; no parent capability grants |
| D4d offline live stub | `packages/discovery/src/live-model-stub.ts`: `mode:'live'`, constructor options only (no product env secrets), budget preflight, hang-for-timeout proofs; default composition stays unconfigured → `MODEL_UNAVAILABLE` |

Still **recognized / unavailable** (do not advertise until unblock items land): `requestVerification`, `readVerification`, `beginRepair`, `finishRun`, `requestInvestigation`.

---

## Platform producer checkpoint — 2026-11-09

The original blocker inventory below is retained as history. Blocker A now has an implemented, independently accepted **Gate P** producer at `4af12bd79e315a0701d896666cb119095dcfec9c`, published in [PR12](https://github.com/dxicheng007/EnterpriseAgenticPaymentResolution/pull/12). See the [actual export/SQL/evidence handoff](platform-discovery-verification-producer-report.md), [independent review](../reviews/platform-discovery-verification-producer-review.md) and [current integration status](platform-continuation-dispatch.md). Control009 is assigned to the immutable verification-request mapping; do not reuse or edit it. Reviewer verification uses the current attested producer, not the legacy jobs.ts API described below.

This releases the producer for separately assigned Discovery consumer implementation. It does **not** enable requestVerification/readVerification. The [accepted adapter design](platform-discovery-verification-adapter-design.md) requires **Gate J** against the actual supervisor owner connection, current authorization and historical recovery before tool mounting. No generated-account capability, repair/finish grant or live-provider configuration was added.

## Original blocker inventory — superseded for Blocker A producer status

### Blocker A — Retry-safe discovery verification adapter (blocks D4b tools)

| Field | Value |
| --- | --- |
| **Owner** | Platform / evaluator (orchestration “C” / V4d) |
| **Why Discovery stops** | Construction handoff forbids calling existing `jobs.enqueue` from discovery tools. That API allocates a new job UUID every call and has no durable request-key recovery. Blind retry after crash can double-enqueue and burn attempt budget. |
| **Required deliverable** | Publish `enqueueDiscoveryVerification({ requestKey, candidate, task })` where `requestKey` is exactly the server `toolStepId`. Same key + same subject → return existing job. Same key + changed subject → conflict (409). Reserve attempt budget once; launch outside the Discovery owner txn. Preserve reviewer HTTP `jobs.enqueue` wire unchanged. |
| **Required tests** | `tests/integration/v4-verification-idempotency.test.ts` (crash after reservation, same-step replay, conflict subject, concurrent repair at attempt 3, wrong task/account) per V4d red list. |
| **Required DDL** | New **Platform-reserved** control migration (after applied catalog; **do not** steal A4’s reserved `008` for review/activation intents). Add durable unique request-key ↔ subject/job binding. Do **not** edit applied `003`/`007`. |
| **Acceptance for Discovery** | Documented export/signature + migration applied in accepted environment + green idempotency suite. Then Discovery may implement `requestVerification` / `readVerification` consumers only. |

**Current code reality:** `packages/evaluator/src/jobs.ts` exposes only `enqueue` / `get` / `drain`. `verification_jobs` has no `request_key` column. Control catalog ends at `007_discovery_construction.sql`.

### Blocker B — Generated-account verification capability policy (blocks genuine multi-account D4b)

| Field | Value |
| --- | --- |
| **Owner** | Platform + Discovery jointly; **escalate to user** if material rule remains absent |
| **Why Discovery stops** | Proposals invent parent customer/account IDs. Preview/verification require explicit session capability (`allowedAccountIds` / grants). Naming an ID in a proposal must **not** self-grant verify rights or identity approval / activation. |
| **Required deliverable** | Accepted written policy covering: (1) which proposed scopes may receive **read/verify-only** capability; (2) who/what grants it and under what audit trail; (3) explicit separation from customer approval and activation authority; (4) failure code for untrusted scopes (spec draft: `VERIFICATION_SCOPE_REQUIRED`). |
| **Interim T4.1 rule (already specified, not a full solution)** | Verify only already-trusted allowed candidate scopes; other proposals remain inspectable/blocked. Do not broaden activation authority. |
| **Acceptance for Discovery** | Tracked freeze accepted by Platform (+ user if needed) with exact grant/deny tables Discovery can implement without inventing IDs. |

### Blocker C — Repair / finish DDL grants (blocks D4c)

| Field | Value |
| --- | --- |
| **Owner** | Platform (control DDL / grants) |
| **Why Discovery stops** | App role cannot `UPDATE` `discovery_investigations.repair_count` or `discovery_tasks.repair_round` (004 grants omit them). Run status CHECK has no `completed`; construction handoff forbade opportunistic completion DDL. |
| **Required deliverable** | Additive grants (and any completion status change) reserved and applied; publish exact semantics for `beginRepair` / `finishRun` vs sticky blockers and verification eligibility. |
| **Acceptance for Discovery** | Migration applied + grant proof in findings-style DDL tests; then Discovery implements tools against accepted Zod I/O. |

### Blocker D — Product live provider env / model catalog (blocks D4e live holdouts)

| Field | Value |
| --- | --- |
| **Owner** | User configures access; Platform/root freeze product env names and model IDs |
| **Why Discovery stops** | D4d deliberately does **not** bind `OPENAI_*` or invent `EAPR_MODEL_*` inside `packages/discovery`. Harness mentions of `OPENAI_API_KEY` are not product config. |
| **Required deliverable** | Accepted product env/model identity freeze; root-released composition wiring; real runner for `tests/live/v4-build-connectors.test.ts`. Missing config must fail/unavailable — never skip/pass. |
| **Acceptance for Discovery** | Root mounts configured live client; Discovery may implement live transport against frozen AbortSignal/tokenizer policy without embedding secrets in the package. |

---

## What Discovery can do after each unblock (ordered)

1. **After A only (trusted scopes):** implement `requestVerification` / `readVerification` schemas + supervisor fences against adapter; advertise only when adapter + registry injected; enforce interim trusted-scope rule from Blocker B interim text; keep `verificationJobs` honest.
2. **After A + B:** genuine multi-account verify for source-bound proposed IDs under the accepted capability rule.
3. **After C:** `beginRepair` / `finishRun` (+ optional `requestInvestigation` freeze).
4. **After D:** offline→online provider; live holdouts; then `verify:slice -- V4` with deterministic + live evidence.

Do **not** start speculative verification schemas that burn attempt budget, call `jobs.enqueue`, edit applied migrations, or grant capability by proposal naming.

---

## Escalate to user (material product decisions)

1. How proposed parent/account IDs receive verify/read-only capability without identity approval (Blocker B).
2. Which live provider/model IDs and env vars are accepted product config (Blocker D).
3. Whether `ModelClient.run` should gain an `AbortSignal` parameter for adapters, or remain supervisor-timeout-only until T4.2 (optional; D4d proves interrupt via hang + existing timeout).

---

## Discovery stop line (this candidate)

Stop after D4d offline stub + boundary tests + this handoff. Do not implement D4b/D4c/live holdouts in the same candidate. Record machine results as **partial** offline-provider evidence only — not V4 acceptance.
