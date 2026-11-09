# Independent L2 handoff review

Verdict: **changes required before implementation dispatch**.

Reviewed candidate: `b-discovery-l2.md`, SHA-256 `0382ffb140d4bea839987b771c8ba794923095f73451340cafb455951266d44a` (verified from bytes). Companion report: `b-discovery-l2-handoff-report.md`. Review is architecture/implementation-handoff only; no product edits or tests ran. Main observed during review: `58387c4eb55ec5cd1c185b9c190b372b7141b054`. Root reports L1 `e754790` and source `413d6e9` accepted and integrated through `1dae289`, with no API delta affecting this handoff. Candidate metadata still describes earlier bases and pending source acceptance; update that metadata when issuing the replacement.

## Findings

### P2 — Preserve the accepted source-specific error adapter (candidate line 47)

The candidate explicitly changes source422 pinned-content failures to409 and describes source failures through discovery-level mapping. The accepted source prerequisite `b-discovery-capture-read.md`, “Error boundary,” explicitly preserves `SourceError(status,code,message,diagnostics)` and supplies the L2 adapter `Object.assign(error, { statusCode: error.status })`. It specifically allows existing422 `SOURCE_CONTENT_INVALID` / `CITATION_INVALID`, and preserves distinct404/409/503 source codes. Existing control preview composition uses that adapter too.

The accepted orchestration §3 generic discovery-error summary describes capture mismatch409, but does not explicitly revoke the subsequently specified source adapter or turn every source validation failure into a discovery mismatch. The source-specific dispatch contract is the concrete authority for this boundary; the new L2 brief cannot silently supersede it. This is a handoff contradiction, not a source implementation defect.

Required correction: separate lifecycle/request errors from `SourceError` passthrough; retain the accepted source status, code, safe message and safe diagnostics while adding route correlationId/no-store. Remove the422→409 instruction and any generic rewrite of source codes. Add adapter proof covering at least422,404,409,503 with original safe source fields retained. If root deliberately chooses different public semantics, record an explicit superseding contract decision first rather than leaving contradictory instructions for the implementer. Do not invent new error codes.

### P2 — Make whole-batch dependency and membership preflight explicit (candidate lines 119–123,134)

Line119 promises whole-batch preparation but ties its no-partial-effects statement to “structurally invalid” output/arguments. Lines121–123 then describe membership and existing same-run dependencies in per-step processing. The concrete `insertSpecialist` seam queries same-run predecessor existence only when creating each individual child. Consequently an implementer can validate all schemas first, commit valid delegation A, and then discover delegation B names a nonexistent/cross-run predecessor or uncaptured tuple. That interpretation conflicts with the accepted L2 requirement to validate the entire batch before any tool application and with line134’s no-partial-child-effects proof.

Required clarification: before the first delegation effect, preflight all delegate arguments in that accepted batch, including exact pinned tuple membership and existence/same-run validity of every dependency ID, in addition to strict schemas/duplicates/roles. Perform database checks through the owned guarded transaction; external capture validation remains outside it. Retain claim-time current authority, capture recheck, capacity and ordering checks for each effect. Unknown/forbidden tool names still receive explicit failed results as specified. This does not require one transaction for every effect or reserve capacity for the whole batch: later capacity exhaustion or policy changes remain the stated exception.

Add a precise two-call proof: first delegate valid, second delegate uses a schema-valid cross-run or nonexistent predecessor; zero children/count increments/tool effects. Add the corresponding later uncaptured-tuple case. Existing single-invalid-call checks or later malformed-schema checks cannot prove this boundary. The narrow supervisor dispatcher allowance can implement preflight; no generic callback registry or public transaction port is needed.

## Reviewed boundaries without additional blockers

- The root-approved closed supervisor extension is sufficient in principle: fixed role schemas and a named pending-step dispatcher remain inside the private serialized owner transaction. Delegation child/count/result/revisions/activity are one atomic effect. Existing `insertSpecialist` can supply child/investigation IDs; querying the persisted child revision is a routine implementation detail.
- Source facts remain membership evidence, never authorization. Mounted service requires a SQL-only recheck, closes over each start’s own facts, rechecks exact immutable binding/membership, and locks the mutable dossier through insertion/effect. Blob reads remain outside transactions. Root’s composition-owned recheck needs no new source API.
- Saved run/task ceilings and fresh resolver policy are required on claims/replay, including stored tool-result replay. Source policy comes from trusted catalog/reviewer configuration; no model grants, session persistence or invented session expiry appear.
- Pause, ordered pending steps, dispatch identity, attempt/generation fencing, crash replay and no ordinary-pool fallback preserve accepted L1 semantics. Whole-batch preflight must retain these same fences.
- Default composition injects no provider/client and acquires no supervisor. Exact authorized start replay bypasses capture/model requirements and scheduling; new no-client start fails without writes.
- The service contract explicitly schedules eligible durable tasks and pending steps at startup/resume, and closes its pump and owner with Fastify. A task may succeed but run completion remains unreachable; `CONSTRUCTION_UNAVAILABLE` and sticky blockers are retained. These are adequate architecture requirements, not verified runtime behavior. Implementation review should require evidence that completion wakes subsequent work, restart resumes committed pending output without a new model call, and close cancels poll/wake callbacks with no post-close dispatch. Existing L1 owner invalidation continues to fence late model settlement; no scheduler-owned callback may recreate the owner after close.

## Scope and evidence

Read the accepted lifecycle L2 handoff/crash protocol, orchestration §§2–5, executable discovery-shapes freeze/types, source prerequisite/error contract, candidate/report, and concrete supervisor/repository/source-reader/control-composition seams. No code changes, database probes, test runs, subagents, live-provider calls, or financial/sync acceptance. Candidate was not modified. Author should issue a replacement exact hash after the two findings are resolved; this verdict does not accept an unreviewed replacement.
