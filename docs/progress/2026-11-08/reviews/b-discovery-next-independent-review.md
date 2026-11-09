# Independent review: next discovery handoffs

Reviewed 2026-11-08. Architecture review only; no code, tests, migrations, commits, provider calls or subagents. Repository HEAD observed: `ec88d8efff721f14a1482d3e0fbe436de4192c54`; briefs name accepted implementation baseline `d867b434039cdc38aba340e6b7729e010b8db07b`. Findings below concern the exact documents, checked against current concrete APIs, not an implementation acceptance claim.

Exact reviewed SHA-256:

- `b-discovery-evidence-tools.md`: `0f995ef088883d224a5c12e5910efc88843cba855376a21ce0838b31f793f580`.
- `b-discovery-monitor-handoff.md`: `e8778d0b6655a82fded2d060b7a852d1db8f30c026782e948b5b6523b9f9d633`.

Read accompanying next-handoff report; accepted orchestration §§4–6; discovery-shapes freeze and executable schemas; L2 brief; concrete source capture/evidence/search, supervisor/service/repository, activity reader, lifecycle route, and browser HTTP/session APIs.

## Separate verdicts

**Evidence readers: not yet dispatchable as a complete implementation brief.** Two concrete issues below need root/B adoption and brief clarification. The overall scope and proposed ports are sound; these are bounded representation/recovery decisions, not user permission or new financial-authority requirements.

**Monitor: dispatchable independently**, with the transport choices below made explicit at M1/M2 interface agreement. Existing service.readState and control activity reader provide the required seams. No dependency on evidence readers, new migration, worker bridge, or provider implementation was found.

## Evidence findings

### E1 — Complete EvidenceRef duplicates unbounded citation text outside the bounded range

The proposed read success includes complete existing EvidenceRef plus bounded `text.value`. `packages/contracts/src/evidence.ts` defines `EvidenceRef.excerpt` as an unbounded string. `packages/evidence/src/locate.ts` returns full page/body in `value` with citation start/end; `readEvidence` preserves the entire original excerpt. Therefore a citation of 10,000 ASCII units plus a requested 100-unit range can fit the 64 KiB envelope while still returning the entire 10,000-unit excerpt in `evidence.excerpt`, defeating the advertised 8,192-unit bounded excerpt/range behavior. Merely bounding `text.value` is insufficient.

Root must choose an exact representation: either retain complete EvidenceRef and explicitly reject citations whose original excerpt exceeds the bound even for narrow ranges, or publish a strict immutable citation-identity projection omitting excerpt while retaining ID/snapshot/source/locator/hash and returning only the bounded selected text. Do not truncate or mutate the original persisted citation. The latter preserves useful range access but is a schema choice for B/root. Also explicitly derive selected text from `response.text.value.slice(response.text.startInclusive + start, response.text.startInclusive + end)`, with omitted range referring to the cited span, not the whole page/body. The proposed absolute output coordinates plus returned-text hash are otherwise viable with a new dedicated schema; existing EvidenceResponseSchema cannot validate this excerpt-only representation.

### E2 — “Blocked until resume” is not an available recovery transition

The brief explicitly leaves interrupted-read/sticky-blocker recovery unresolved and suggests default blocking until resume. Current `repository.ts` action accepts resume only from paused and chooses blocked whenever run diagnostics remain. `markBlocker` persists diagnostics; service tick selects only queued/running runs. Thus pause→resume cannot recover an authority-loss read once DISCOVERY_FORBIDDEN is a sticky diagnostic. Updating the interrupted step to pending alone does not restore scheduling. Current reconcile handles only reserved model dispatches, and pending-only step selection/revision arithmetic also require the already identified changes.

Before dispatch, adopt a transition table separating (a) owner loss during an otherwise authorized immutable read, which may refence/retry under current authority and generation without inventing a sticky semantic blocker; (b) pause, which preserves pending/in-flight work and resumes under existing semantics; and (c) authority/capture/oversize blockers, which remain sticky and are not cleared by resume in this increment. If root instead requires recovery from (c), the precise authorized clearing transition and repository ownership must be explicitly assigned; it is not present in existing APIs. Do not silently broaden resume or let replacement ownership clear known diagnostics. For a sticky interrupted read, state must accurately distinguish an unresolved interrupted step from genuinely executing in-flight work.

## Evidence decisions suitable for owner adoption

- Strict new schemas in the narrowly owned discovery-tools contract module; describe uses only binding plus existing SourceContract/CaptureStream arrays, not SourceDefinition metadata. Publish deterministic ordering/uniqueness for these arrays alongside query citation IDs.
- Current-query cursor membership semantics are a defensible clarification of the accepted afterEventId input. An ID can belong to multiple filtered sets; historical filter identity cannot be authenticated with that input. Root should adopt the stated position semantics explicitly; no extra cursor state/token is implied.
- Citation-relative half-open UTF-16 range, safe endpoints without surrogate splitting, document/page/body coordinate output and returned UTF-8 hash are consistent once E1 is resolved. Define whether empty ranges reject; existing evidence spans require start < end.
- Safe error codes and whole-batch semantic rejection are bounded owner decisions. Typed ordinary failures and sticky oversized-record blockers must remain distinct. No broad rewrite of existing HTTP SourceError behavior is authorized.
- The proposed closed prepare dependency is new work, not an existing API. Use it outside owner transactions; guarded capture/database membership recheck belongs on the exclusive owner client. Batch validation must cover both readers and delegation before any success/child, including recovered batches. Terminal accounting, running/interrupted selection, refencing and transcript closure must be implemented together.

The brief correctly preserves task/current grant intersection, exact seller/account identity, zero-parent source-wide exploration, unknown document account coverage denial, sellerless source-only access, fixed snapshot/citation membership and byte-aware query continuation. It forbids truth/coverage-oracle access, source writes, new publishers and worker/provider authority. Search correctly reuses citation excerpt matching and lexical pinned order rather than claiming full-document indexing.

## Monitor transport decisions and checks

The initial cursor→state→connect ordering is correct: mutations after cursor acquisition are replayed, including those already reflected in state; authoritative revision-aware refetch avoids additive double counting. Existing activity page SQL obtains a coherent counter/lookahead snapshot. Last delivered event ID, internal nextAfter, and standalone high-water are correctly distinguished; floor handling and the control-only scope match the frozen contract.

M1/M2 must explicitly choose bounded fetch-stream transport or managed EventSource reconnection. A native EventSource created with `?after=initialCursor` will retain that URL on automatic reconnect; because explicit query wins over Last-Event-ID, it will replay from the original cursor. Close/recreate with the last delivered cursor (or use fetch-stream) to meet the handoff's reconnect requirement. Native EventSource also does not expose HTTP 401/403 status directly; choose fetch-stream or a safe authenticated state probe on error, rather than inventing status from an error event. For post-header generic resync_required, cursor/state reacquisition can discover actual 401/403 and apply the specified session policy.

Use existing HTTP session invalidation when a fetch stream sees 401: direct getLocalSession alone can return its cached promise. `clearCsrfToken` triggers the existing expiration listener and invalidates that cache. This needs no new session expiry contract or endpoint.

Reauthorize every page/poll through both reviewer authorizer and readState; backpressure drain must not permit a stale buffered page to bypass the next authorization boundary. Keep output bounded and stop/cancel on close. Activity failures after headers stay redacted; actual 403 stops rather than looping. The required revocation/barrier tests, run-switch cancellation, ordered revision refetch, 60-second retirement and isolated real session tests cover the principal named risks. No need to modify the coherent storage reader or introduce a composite runtime cursor.

## Limits

No implementation or tests changed or ran. This is dispatch-readiness review of the exact document hashes, not proof of implementation correctness, V4 completion, live model competence, financial safety of later slices, or joint user acceptance. Re-review revised evidence wording/decisions before its implementation dispatch; monitor may proceed independently with the explicit transport agreement above.
