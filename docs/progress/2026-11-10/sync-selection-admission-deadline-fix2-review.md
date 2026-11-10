# Scoped admission/deadline clarification re-review — fix round 2

## Verdict

**N1 ADDRESSED. Approve this scoped document correction.** No new Critical, Important or Minor breakage was identified in the round-2 diff. The candidate now specifies a compatible trusted call-through arrangement at the existing `{db: Pool}` service boundary, with exact enforced identities, unchanged effective-driver checks, and concrete future service-level positive and negative controls.

This verdict covers N1 and new breakage introduced by the round-2 diff only. It is not a broad re-review, source release, executed implementation verification, or final user acceptance. I1/I2/M1 remain the previously addressed findings; this review does not reopen them. The potentially indefinite joined graceful-end limitation remains explicitly recorded and is not treated as a new defect or as a bounded-response guarantee.

## Exact artifacts and integrity

Independently computed SHA-256 values:

- Candidate `/private/tmp/eapr-sync-selection-admission-deadline-clarification.md`: `fcdbcb8146a1bcbfeff99826775c7a38af3cc2cd0eff30fc62e60d4a985b4a3e`.
- Preserved v2 `/private/tmp/eapr-sync-selection-admission-deadline-clarification-v2.md`: `0eb7234cb852fb1c0efe43c1d746cea95aecd525fbfba76cd209d8e10f6d6b4d`.
- Scoped diff `/private/tmp/eapr-sync-selection-admission-deadline-fix2.diff`: `8999b2bb138914682d3ec19a3a47e66d0f75b666730d29f0588916d9bd154cba`.
- Fix report `/private/tmp/eapr-sync-selection-admission-deadline-fix2-report.md`: `f651a62f8ee0b38dd294828f40dae01cb10ae919fd1801ce0b28139f8a8d07a2`.
- Previous review `/private/tmp/eapr-sync-selection-admission-deadline-fix1-review.md`: `aee067c19072f98fab61dc3d59c3b7986bf72756715ecedffac64afb868b2448`.

The supplied diff was compared with the actual preserved-v2-to-candidate unified diff and matched exactly after excluding the two path/timestamp headers. Candidate and preserved-v2 hashes match the assigned review targets. All line anchors below refer to this exact candidate.

## N1 — ADDRESSED

### Enforced identities now admit the specified wrapper

Candidate line 171 replaces the ambiguous standard-public-query requirement with exact rules. Pool and Client direct prototype equality is required. Client end and transaction-status functions must equal the imported standard prototype methods. Connect and query must be callable, but their function identity is explicitly not compared. A transparent proxy that intercepts only connect/query therefore does not collide with the stated runtime checks.

Lines 173 and 177 make the supported arrangement concrete: the supplied pool proxy performs one real checkout and returns a per-checkout proxy over that same genuine client. The client proxy intercepts only query; ordinary property forwarding preserves the effective configuration and original end/status/release functions. End/status cannot be rebound, reusable client methods and global prototypes cannot be patched, and no extra checkout or setup query is introduced. The fixture separately verifies the original underlying query/end/status methods before wrapping. This separates a runtime-enforced identity from the trusted instrumentation assertion without skipping a service check.

The trust boundary is explicit at line 177: prototype and effective-field checks cannot establish the transparency of an arbitrary closure. The permitted closure is reviewed fixture instrumentation with call-through assertions. The document does not claim to validate hostile arbitrary Pool implementations and does not add a production test option or public caller field.

### Actual driver and timer ownership are preserved

Lines 157 and 175 prohibit changes to timeout, pipeline, actual arguments, results/errors and driver end/status behavior. The closure immediately invokes the genuine client's original query once, with that genuine client as receiver and the unchanged argument list. It joins the real promise and forwards the identical result or error object. It may observe a normalized SQL copy without changing the sent statement or parameters.

The selector observer remains outside the closure (line 177), and the closure permits no pre-dispatch delay. Thus an observer check is followed by immediate actual dispatch on the same real lease; the gate is placed only after actual settlement. The original effective-field rules still apply before BEGIN and at every dispatch, including cleanup (lines 171 and 177). No new query-timeout override, transport owner, cancellation mechanism, synthetic result, background promise, or second query is introduced.

Cleanup ROLLBACK and end/status/release remain undelayed (line 175). The unchanged lifecycle at lines 148–153 still joins reader and cleanup ownership and releases/discards once. Lines 181–185 retain the distinction between finite local query rejection and potentially indefinite graceful end. The wrapper correction does not strengthen those guarantees.

### Required service evidence remains feasible at `{db}`

Line 173 explicitly places the arrangement at `createSyncSelector({db: observedPool})`. The barrier at line 175 operates after a real reader query has settled but before the selector receives that settlement. With no next reader query dispatched, it can hold an inspection whose repeatable-read snapshot is already established while another connection commits accepted writes; resuming subsequent reads can verify the same old snapshot. SQL observation passes through the same closure and the same real lease.

A separate post-settlement gate can delay a successful real reader result past five seconds, exercising the existing post-await admission cutoff while retaining joined ownership. The explicit late-COMMIT allowance delays only forwarding of a real successful COMMIT result, preserving the existing late-success rejection control. Cleanup is excluded from those delays, and test cleanup must release gates and join the inspection.

Line 245 requires a positive control through this exact service arrangement: validation succeeds, actual BEGIN and real reader SELECT execute on one lease, the snapshot gate holds/resumes around external accepted writes, and the separate deadline gate exercises joined timeout/cleanup. It also requires argument/result/error identity, effective timer, end/status and release/discard assertions. The same wrapper must exercise the negative effective-timer configurations and reject before BEGIN. Direct-reader substitution and disabled checks are expressly excluded. Line 246 preserves no-next-query, no-classification, zero-proposal, retained-progress, late-COMMIT and no-orphan-checkout obligations.

These additions satisfy the concrete compatibility route and future positive-control requirements in N1. They specify required evidence; they do not report that this evidence has run or passed.

## New diff breakage

None identified within the assigned scope. The changed text is limited to the supported instrumentation arrangement, its exact method/prototype enforcement, and corresponding future verification controls. The new arrangement resolves the previously conflicting query identity requirement without changing actual driver timing, teardown ownership, the service boundary, or the admitted production query configuration.

## Out-of-scope observations

No additional out-of-scope finding is raised. Unchanged physical admission, monetary/product behavior, count domains, witness/incident/diagnostic design and other prior findings were not broadly re-reviewed. The accepted indefinite graceful-end limitation remains an operational limitation, not an independently executed safety result.

## Review method and limits

Read the previous N1 finding, round-2 fix report, exact diff, and candidate context; verified artifact hashes and actual diff correspondence. An initial comparison with Python difflib failed because its generated diff differed; the subsequent comparison against the system diff output confirmed exact correspondence after excluding path/timestamp headers. Prior review source findings were used as supplied context, not represented as newly inspected source evidence. No repository source reads or mutations, Git commands, tests, SQL/database operations, services, dependencies, or subagents were used. Only this review report was written. The skill entry point was read and its dispatched-subagent exemption applied.

Round verdict: **N1 ADDRESSED; no new scoped diff finding; approve the document correction at candidate SHA-256 `fcdbcb8146a1bcbfeff99826775c7a38af3cc2cd0eff30fc62e60d4a985b4a3e`.**
