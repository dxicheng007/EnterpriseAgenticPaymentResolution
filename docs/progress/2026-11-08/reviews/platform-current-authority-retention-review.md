# Scoped C1 retention correction review

Verdict: **C1 ADDRESSED**. No new breakage found in the correction.

Reviewed `/private/tmp/eapr-current-authority-design.md` at verified SHA-256 `4077a1c0148b2d32a3de15b5b0e426bc29565cab5952db640cd542f0b4cc987e`, against `/private/tmp/eapr-current-authority-design-before-c1.md`, finding C1 in `/private/tmp/eapr-current-authority-design-review.md`, and the author's `/private/tmp/eapr-current-authority-design-c1-report.md`. Scope is the correction only, not a fresh approval of the entire design or an implementation.

The diff contains only the requested retention clarification and its required scenarios:

- Line 138 expressly prohibits materialized-head deletion or reset and limits runtime privileges to SELECT/INSERT and UPDATE of status, epoch and changedAt, excluding DELETE/TRUNCATE and immutable pins.
- Line 140 requires enforced noncascading command-to-head, command-to-grant and head-to-grant references; referenced deletion fails rather than removing history.
- Line 40 requires head absence and prior command-history detection in the same read snapshot. Missing head with history returns AUTHORITY_STORAGE_INVALID; original-state projection requires no prior command history for that committed identity.
- Line 145 performs the corresponding absence/history check under the existing parent-scope lock before materialization. History without a head fails closed; epoch1 initialization is limited to first use. The existing head lock and transaction sequence remain intact.
- Line 172 explicitly requires role/FK assertions and a missing-head-with-history corruption fixture for both consistent reads and scope-locked mutations, including when ordinary application SQL cannot produce that corruption.

These changes close the disposable-cache interpretation without adding reconstruction, reenrollment, new authority or financial behavior. They preserve the existing historical-result recovery contract, which does not project current authority or create new state. No correction introduces an additional lock order or source dependency.

This is document review evidence only. No implementation, database operation, test execution, commit, subagent, path reservation or migration reservation was performed or authorized. The stated targeted tests remain requirements for a later implementation; machine verification and user acceptance are not established by this verdict.
