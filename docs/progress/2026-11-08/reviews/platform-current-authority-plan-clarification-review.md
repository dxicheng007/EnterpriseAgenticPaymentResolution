# Current authority plan C1–C3 clarification review

Reviewed corrected plan: `docs/superpowers/plans/2026-11-09-current-authority.md`.

Verified SHA-256: `2095e964456c87c9b9e7c768ee080b4e49dfe1cd6a50e7596ba05d771096bad1`.

Observed HEAD: `c1f36052ac6a180b794be1e89140007a367aa9f2`. The change from the original review's source baseline `b6c662a0417128ef4ad4bb94a7bbc85944790fa7` is solely the unrelated Gate J integration-test file. No current-authority production dependency changed in that interval.

Scope: compared the corrected plan with `/private/tmp/eapr-current-authority-plan-before-clarifications.md`, the three original findings in `/private/tmp/eapr-current-authority-plan-review.md`, and the author's report. Checked relevant accepted-design requirements and current transaction/activation-storage APIs. This is a correction-only review, not a repeat or expansion of the original plan review.

## Verdict

**C1 PASS. C2 PASS. C3 PASS. No new defect introduced by the correction diff was found.** These corrections close the three original clarifications. No further correction or product decision is required for this scoped review.

### C1 — Transaction-token lifetime and fresh retry evidence: PASS

Plan lines 147, 181 and 190 explicitly require a fresh locked token within every `withTransaction` callback attempt and prohibit reuse after commit/rollback, SQL retries or pool reuse. They correctly distinguish a same-client WeakMap identity check from proof of a live PostgreSQL transaction/lock. The synchronous fence remains subject to its documented live-transaction/head-lock precondition; the plan does not claim intrinsic stale-token rejection.

The added test requirement at line 208 demands one supported `40001` or `40P01` abort, fresh scope/head acquisition and current-state reread on the next callback, with transaction outcome/epoch evidence. This matches `packages/storage/src/transaction.ts:11`, which begins a transaction and reinvokes the callback on each bounded supported retry. A test-local one-shot trigger/barrier is implementable without changing the transaction helper or production APIs. The plan now requires meaningful retry evidence; no such test has been executed by this review.

### C2 — Strict parsing and authorization order: PASS

Plan line 111 now gives an implementable sequence: required authorizer, strict detached grants, strict detached input, parsed account grant check, private committed-subject lookup, actual source grant check. It no longer requires account authorization from an unparsed mutable nested property. Malformed admitted input is 400, malformed grants are forbidden, and a valid forbidden account is 403. Lines 117 and 187 preserve detachment before later awaits and distinguish mutation before parsing from mutation of the admitted request. Existing final authorization checks remain outside SQL locks.

### C3 — Occupied-key precedence and repository ports: PASS

Both snapshot and lock ports now accept the optional command key (lines 129–132), and status calls must pass it to both. Line 145 resolves an occupied `(accountId,key)` through the persisted association's scope and genuine original import, validates canonical bindings/head retention, then permits authorized canonical comparison. Changed activation ID, bundle hash or same-account company/seller scope therefore produces 409 after actual stored-subject authorization; unused-key and narrow-read identity mismatches remain 404. Corruption stays 503 before replay/conflict, and denied actual-source grants cannot disclose either result.

This is implementable with the current `readStoredActivation(client, scope)` at `packages/parent/src/activation-store.ts:193`: it accepts the persisted scope and performs its nested approved-snapshot read on the passed client. The snapshot can return its verified stored command for private service comparison after authorization; the mutation path can compare using its locked-token lookup port. Neither needs a public key lookup or parent API change. REPEATABLE READ covers the entire snapshot resolution. The account scope lock covers mutation-time association resolution even when the incoming company/seller scope is different. `db/runtime/002_parent_activation.sql:148` enforces one immutable original import per account, supporting the stated unchanged-subject assumption. The explicit under-lock actual-subject check avoids carrying preflight authority onto a different subject without performing network authorization under locks.

Line 206 separately requires occupied-key versus unused-key/narrow-read cases for each changed identity component and denial of the actual stored source. These cases directly cover the original ambiguity.

## Limits

Only this temporary report was written. No source code, SQL, database state, tests, commits or subagents were changed/run/created. No external messages were sent. This review establishes plan clarity and technical implementability for C1–C3, not completed implementation, passing machine checks, financial-writer integration, production ingress authentication or joint acceptance. Root retains dispatch and migration/shared-path ownership.
