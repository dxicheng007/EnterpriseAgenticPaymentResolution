# D4 Discovery unblock handoff

**Date:** 2026-11-09  
**Discovery tip context:** D4a sandbox replay/compare merged; D4d offline live ModelClient stub lands on `team-discovery-d4b`; Gate J verification consumers merged via [PR15](https://github.com/dxicheng007/EnterpriseAgenticPaymentResolution/pull/15).  
**Status:** Discovery-owned offline provider boundary and Gate J `requestVerification` / `readVerification` consumers are on main against the Platform producer. **D4c repair/finish remain blocked on Platform Blocker C.** Live holdouts remain blocked on Blocker D. This document is the unblock checklist — not authorization to invent repair/finish policies or DDL in Discovery, and **not** a claim of joint V4 acceptance.

Authority: team-expansion §D4; `v4-orchestration-contract-proposal.md` §4 tools + §7 V4d + §8.1 capability gap; `b-discovery-construction-handoff.md` gaps #4–#6.

---

## What Discovery already shipped (do not redo)

| Slice | Outcome |
| --- | --- |
| D2 association producer + consumers | Agreement→account association under grant; sticky blockers preserved |
| D3 / C3 `compileConnector` | Reserve → external compile/register → settle; orphans ≠ current compiled |
| D4a `runSandboxReplay` / `compareArtifacts` | Empty-sandbox `parentWrites:0`; same-run deterministic diffs; no parent capability grants |
| D4d offline live stub | `packages/discovery/src/live-model-stub.ts`: `mode:'live'`, constructor options only (no product env secrets), budget preflight, hang-for-timeout proofs; default composition stays unconfigured → `MODEL_UNAVAILABLE` |
| D4b Gate J verification consumers | `requestVerification` / `readVerification` mounted on the real supervisor against the Platform producer ([PR15](https://github.com/dxicheng007/EnterpriseAgenticPaymentResolution/pull/15)); interim trusted-scope freeze only — not full Blocker B, not V4 acceptance |

Still **recognized / unavailable** (do not advertise until unblock items land): `beginRepair`, `finishRun`, `requestInvestigation`.  
`requestInvestigation` has contracts Zod I/O on main; it stays `TOOL_UNAVAILABLE` / unadvertised until storage and semantics land after Blocker C — Discovery must not invent those semantics.

Live transport (`packages/discovery/src/live-model-transport.ts`) exists as an injected OpenAI-compatible client (`baseUrl` / `apiKey` / `modelId` only) and stays **unmounted** in default composition; no product env names inside `packages/discovery` (Blocker D).

---

## Platform producer checkpoint — 2026-11-09

The original blocker inventory below is retained as history. Blocker A now has an implemented, independently accepted **Gate P** producer at `4af12bd79e315a0701d896666cb119095dcfec9c`, published in [PR12](https://github.com/dxicheng007/EnterpriseAgenticPaymentResolution/pull/12). See the [actual export/SQL/evidence handoff](platform-discovery-verification-producer-report.md), [independent review](../reviews/platform-discovery-verification-producer-review.md) and [current integration status](platform-continuation-dispatch.md). Control009 is assigned to the immutable verification-request mapping; do not reuse or edit it. Reviewer verification uses the current attested producer, not the legacy jobs.ts API described below.

Gate J consumer mounting against the actual supervisor is **merged** ([PR15](https://github.com/dxicheng007/EnterpriseAgenticPaymentResolution/pull/15)). Trusted-scope verify follows the [interim discovery verification capability freeze](../../../superpowers/plans/2026-11-09-contract-freeze-discovery-verification-capability-interim.md); do not broaden activation. No repair/finish grant or live-provider product configuration was added. Full generated-account Blocker B, Blocker C, Blocker D, live holdouts, and joint V4 acceptance remain separate.

## Original blocker inventory — superseded for Blocker A producer status and Gate J consumer mount

### Blocker A — Retry-safe discovery verification adapter (blocks D4b tools)

| Field | Value |
| --- | --- |
| **Owner** | Platform / evaluator (orchestration “C” / V4d) |
| **Why Discovery stops** | Construction handoff forbids calling existing `jobs.enqueue` from discovery tools. That API allocates a new job UUID every call and has no durable request-key recovery. Blind retry after crash can double-enqueue and burn attempt budget. |
| **Required deliverable** | Publish `enqueueDiscoveryVerification({ requestKey, candidate, task })` where `requestKey` is exactly the server `toolStepId`. Same key + same subject → return existing job. Same key + changed subject → conflict (409). Reserve attempt budget once; launch outside the Discovery owner txn. Preserve reviewer HTTP `jobs.enqueue` wire unchanged. |
| **Required tests** | `tests/integration/v4-verification-idempotency.test.ts` (crash after reservation, same-step replay, conflict subject, concurrent repair at attempt 3, wrong task/account) per V4d red list. |
| **Required DDL** | New **Platform-reserved** control migration (after applied catalog; **do not** steal A4’s reserved `008` for review/activation intents). Add durable unique request-key ↔ subject/job binding. Do **not** edit applied `003`/`007`. |
| **Acceptance for Discovery** | Documented export/signature + migration applied in accepted environment + green idempotency suite. Then Discovery may implement `requestVerification` / `readVerification` consumers only. |

**Current status:** Gate P producer accepted (PR12). Gate J consumers mounted (PR15). Historical “code reality” rows below describe the pre-producer inventory and are retained for audit only.

**Historical code reality (pre-Gate P):** `packages/evaluator/src/jobs.ts` exposed only `enqueue` / `get` / `drain`. `verification_jobs` had no `request_key` column. Control catalog ended at `007_discovery_construction.sql`.

### Blocker B — Generated-account verification capability policy (blocks genuine multi-account D4b)

| Field | Value |
| --- | --- |
| **Owner** | Platform + Discovery jointly; **escalate to user** if material rule remains absent |
| **Why Discovery stops** | Proposals invent parent customer/account IDs. Preview/verification require explicit session capability (`allowedAccountIds` / grants). Naming an ID in a proposal must **not** self-grant verify rights or identity approval / activation. |
| **Required deliverable** | Accepted written policy covering: (1) which proposed scopes may receive **read/verify-only** capability; (2) who/what grants it and under what audit trail; (3) explicit separation from customer approval and activation authority; (4) failure code for untrusted scopes (spec draft: `VERIFICATION_SCOPE_REQUIRED`). |
| **Interim T4.1 rule (normative freeze, not a full solution)** | [Interim trusted-scope freeze](../../../superpowers/plans/2026-11-09-contract-freeze-discovery-verification-capability-interim.md): verify only already-trusted allowed candidate scopes; other proposals remain inspectable/blocked. Do not broaden activation authority. |
| **Acceptance for Discovery** | Tracked freeze accepted by Platform (+ user if needed) with exact grant/deny tables Discovery can implement without inventing IDs. Full generated-account Blocker B remains open. |

### Blocker C — Repair / finish DDL grants (blocks D4c)

| Field | Value |
| --- | --- |
| **Owner** | Platform (control DDL / grants) |
| **Why Discovery stops** | App role cannot `UPDATE` `discovery_investigations.repair_count` or `discovery_tasks.repair_round` (004 grants omit them). Run status CHECK has no `completed`; construction handoff forbade opportunistic completion DDL. |
| **Required deliverable** | Additive grants (and any completion status change) reserved and applied; publish exact semantics for `beginRepair` / `finishRun` vs sticky blockers and verification eligibility. |
| **Acceptance for Discovery** | Migration applied + grant proof in findings-style DDL tests; then Discovery implements tools against accepted Zod I/O. Discovery must **not** invent `completed` status or repair column grants. |

### Blocker D — Product live provider env / model catalog (blocks D4e live holdouts)

| Field | Value |
| --- | --- |
| **Owner** | User configures access; Platform/root freeze product env names and model IDs |
| **Why Discovery stops** | Live transport exists but stays injected/unmounted. Discovery deliberately does **not** bind `OPENAI_*` or invent `EAPR_MODEL_*` inside `packages/discovery`. Harness mentions of `OPENAI_API_KEY` are not product config. |
| **Required deliverable** | Accepted product env/model identity freeze; root-released composition wiring; real runner for `tests/live/v4-build-connectors.test.ts`. Missing config must fail/unavailable — never skip/pass. |
| **Acceptance for Discovery** | Root mounts configured live client; Discovery may implement live holdouts against frozen AbortSignal/tokenizer policy without embedding secrets in the package. |

---

## What Discovery can do after each unblock (ordered)

1. **After A only (trusted scopes):** ~~implement `requestVerification` / `readVerification`~~ **done (Gate J / PR15)** under interim trusted-scope freeze; keep `verificationJobs` honest; do not broaden activation.
2. **After A + B:** genuine multi-account verify for source-bound proposed IDs under the accepted full capability rule (interim freeze ≠ full Blocker B).
3. **After C:** `beginRepair` / `finishRun` (+ `requestInvestigation` storage/semantics; contracts Zod may already exist — stay unadvertised until then).
4. **After D:** composition mounts live transport; live holdouts; then `verify:slice -- V4` with deterministic + live evidence.

Do **not** start speculative repair schemas, call `jobs.enqueue`, edit applied migrations, or grant capability by proposal naming.

---

## Escalate to user (material product decisions)

1. How proposed parent/account IDs receive verify/read-only capability without identity approval (full Blocker B beyond the interim freeze).
2. Which live provider/model IDs and env vars are accepted product config (Blocker D).
3. Whether `ModelClient.run` should gain an `AbortSignal` parameter for adapters, or remain supervisor-timeout-only until T4.2 (optional; D4d proves interrupt via hang + existing timeout).

---

## Discovery stop line (post–Gate J)

Gate J consumers are merged. Do not invent Blocker C repair/finish DDL or semantics in Discovery. Do not mount live product env or claim live holdouts. Record machine results as **partial** — **not** V4 acceptance.
