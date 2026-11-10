# Scoped admission/deadline clarification re-review — fix round 1

## Verdict

**Request changes for one Important new contract collision introduced by the fix.** I1 and I2's original defects are addressed in the revised document; M1 is addressed as the carried minor clarification. The new standard-method requirement does not specify a compatible route for the explicitly required real-service query wrappers. Resolve N1 before releasing this candidate as the implementation contract. No Critical finding and no other new diff breakage identified within this scope.

This is document/source analysis, not executed implementation verification or final acceptance. The root's willingness to accept potentially indefinite joined graceful teardown is taken as an explicit operational limitation, not as evidence that the remaining contract is sound.

## Exact artifacts

- Revised candidate: `/private/tmp/eapr-sync-selection-admission-deadline-clarification.md`, SHA-256 `0eb7234cb852fb1c0efe43c1d746cea95aecd525fbfba76cd209d8e10f6d6b4d`.
- Preserved reviewed original: `/private/tmp/eapr-sync-selection-admission-deadline-clarification-v1.md`, SHA-256 `51f66b4acda64253b72ec1ca39c2455ab9aae92c1246d868985a0410e030d285`.
- Scoped diff: `/private/tmp/eapr-sync-selection-admission-deadline-fix1.diff`, SHA-256 `3986307bf2c31253148e0433bb108da68153b72255f9856fdc9d40edaf19f106`.
- Fix report: `/private/tmp/eapr-sync-selection-admission-deadline-fix1-report.md`, SHA-256 `cb01aca3d6fa22b1f07680c875196d73a4b511a93ec27a6fb680f8b2d5428605`.
- Original findings: `/private/tmp/eapr-sync-selection-admission-deadline-review.md`, SHA-256 `dcc0bd9e665471538f5b77815c15eed28f3eecd42c21a573741af4fa7eab84a6`.

All five hashes were independently read and verified. Repository-relative evidence below is in `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

## Original finding dispositions

### I1 — ADDRESSED

Candidate lines 153, 175–179 and 238 explicitly retain ownership through `discard_wait`, allow indefinite pending graceful end, forbid response/release while it remains pending, and require joined settlement followed by exactly one discard. They distinguish a finite query-rejection timer from unbounded graceful teardown and distinguish local closure from remote termination. This is the first remedy offered in the original finding.

The installed source supports that account: `node_modules/pg/lib/client.js:425` clears the active query on ErrorResponse before readiness; `:702` installs the query timeout and removes queued queries without closing an ordinary connection; `:799` chooses graceful end when neither an active query nor an unqueryable connection forces destruction. `node_modules/pg/lib/connection.js:217` writes Terminate and ends the stream without a teardown timer. `node_modules/pg-pool/index.js:172,368` confirms that release/discard alone is not an awaited removal proof.

The new required ErrorResponse/no-ReadyForQuery test distinguishes this state from an active blocked SELECT. It explicitly requires controlled closure and joining during test cleanup. The document no longer promises a bounded failed-inspection response. This acceptance is limited to the clarified contract; the fault injection has not run.

### I2 — ADDRESSED, with new instrumentation regression N1 below

Candidate lines 157–175 define an explicit supported standard JavaScript driver boundary, numeric finite positive Node-range timer expectation, effective leased `connectionParameters.query_timeout` equality, and `pipeline === false` before BEGIN and at actual dispatch, including cleanup. Missing/invalid/overridden fields fail closed. The narrow two-field read-only dependency is disclosed as private and version-pinned, not misrepresented as public API.

Installed pg 8.23.1 matches the proposed effective-field observation: `node_modules/pg/lib/connection-parameters.js:54–61,124` merges URL fields over configuration and resolves the effective timeout; `node_modules/pg-connection-string/index.js:40–42` supplies URL parameters as strings; `node_modules/pg/lib/client.js:101,702` reads the actual pipeline mode and timer. Strict numeric equality rejects equal-string, conflicting and empty/default URL cases. `packages/storage/src/runtime-db.ts:5–6` supplies numeric 1,500 ms, compatible with an ordinary queryless URL. A separate numeric longer-timer fixture can exercise actual 57014. The new finite timer claim remains subject to JavaScript scheduling and does not imply bounded end.

Thus the original pool-options-only defect is corrected. The added method/prototype restriction creates a separate verification-seam gap, not a reason to deny that the effective-field check fixes the original URL precedence defect.

### M1 — ADDRESSED (carried Minor)

Candidate lines 82–94 and 126 specify scalar embedded-target admission by physical table/full key/column, checked eight-array combined cardinality, exact 10,000 acceptance and 10,001 rejection, no added bytes or fabricated physical rows, and independent relational scope counting. This matches the eight-array structural admission described in Task 5 preflight and `packages/contracts/src/runtime.ts:46`.

Candidate line 122 gives ongoing positions and deliveries one exact source/event key set, bounded unseen-key cap+1 scans, independent one-to-one position validation, and bounded baseline/original references outside the ongoing count domain. `db/runtime/003_sync_capture.sql:34–43` supplies the corresponding unique source/event and primary position keys. Line 237 carries both future test obligations. No new larger corpus allowance or schema change was introduced by this clarification.

## New diff finding

### N1 — Important: standard query-method enforcement conflicts with the required call-through wrapper seam

**Anchors:** candidate line 171 requires the standard imported Client prototype/public `query`/`end`/status methods **before** the selector installs its own observer. Candidate line 157 nevertheless permits a test-only joined delay around a real query, and lines 239–240 require instrumentation not to bypass checks while delaying a real query result. The accepted plan at `docs/superpowers/plans/2026-11-10-sync-selection.md:290,300–301` requires actual-service timeout delay, snapshot barriers through supplied pool/client wrappers, and SQL observation. The public service boundary remains only `{db: Pool}` at plan line 287.

The existing real-service call-through pattern is concrete: `tests/integration/sync-apply-races.test.ts:105–135` returns a proxy pool whose checkout returns a proxy client; the proxy's `query` property is a closure that invokes the actual underlying query. It retains the normal client prototype and driver fields, but its public query function is not `Client.prototype.query`. An own-property query spy has the same identity difference. Consequently, enforcing the newly stated standard public-method requirement rejects this wrapper before BEGIN, so the required delay/barrier cannot reach the real selector read. A prototype check alone can admit a transparent proxy; a strict standard-method check cannot admit its query interception. The selector's later private observer does not supply an external test barrier by itself.

The text's general permission for test delays does not resolve which exact validation is relaxed, where the wrapper sits, or how it is admitted without bypassing the effective-driver checks. Replacing the imported prototype method globally so a comparison happens to pass would change the supposed reference method and would not demonstrate the intended supported-boundary check. Direct reader tests cannot replace the required service-lifetime proof. Skipping checks in tests, introducing an unreviewed production failpoint, or dropping the real snapshot/deadline tests would also fail the stated contract.

**Minimum clarification:** define one explicit compatible call-through wrapper arrangement at the existing service boundary and state precisely which identities/prototypes are enforced versus which query observation/delay is trusted test instrumentation. For example, the contract can retain standard underlying construction, public end/status behavior and the same effective-field checks while explicitly permitting a transparent per-checkout query wrapper that forwards unchanged arguments/results/errors to the same real lease and only joins observation/delay. If strict public query identity is retained instead, specify another concrete authorized placement that allows the required service-level wrappers to execute while that check still runs. No new public caller option or test bypass should be inferred.

Add an explicit future positive control showing that this exact arrangement passes supported-pool/lease validation, reaches actual BEGIN and a real reader query, holds/resumes the real inspection, preserves the effective timer and end/discard behavior, and still fails the negative effective-configuration cases. Preserve both the five-second delayed-result control and coherent-snapshot barrier obligations. This is a contract-level correction; no source/test implementation is requested by this review.

## Scope limits and out-of-scope observations

No additional out-of-scope findings are raised. Unchanged physical-byte semantics, other count domains, diagnostics, witness equations, incident coverage and legacy-history policy were not broadly re-reviewed; prior review obligations and root publication remain in force. A possible indefinite failed-inspection response is the explicitly accepted limitation of the selected public-end approach, not a new finding.

Performed read-only document/diff inspection, focused installed-driver and test-wrapper source reads, and SHA-256 checks. No source or Git mutations, tests, SQL/database operations, services, dependency changes or subagents ran. Only this review report was written. Initial searches for two guessed filenames returned missing-file errors; subsequent reads used the actual runtime schema/contracts paths. No machine pass, backend observation or released implementation is claimed.
