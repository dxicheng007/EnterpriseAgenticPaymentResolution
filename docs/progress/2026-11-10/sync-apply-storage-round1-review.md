# Task 1 scoped re-review, round 1

Exact candidate: `7af5d8ace77a087529c05bada4c8da48f7b4a0d2` (`fix: verify saved synchronization prefix references`). Prior reviewed candidate: `f861fc5843961d4573e585a46399e8da903260dd`. Subject: `/private/tmp/eapr-sync-apply-task1-round1.diff`, limited to `packages/parent/src/sync-store.ts` and `tests/integration/sync-apply-storage.test.ts`, plus the updated task report's fix section.

**Prior P1: ADDRESSED. Specification verdict: approved for this scoped fix. Code-quality verdict: approved for this scoped fix. No new actionable finding.** This closes the sole finding from the original Task 1 review; it does not accept the separately assigned Task 2 coverage reader, Task 3 writer, Task 4 concurrency work, or any mounted/full-slice behavior.

## Basis

- `sync-store.ts:343–380` now loads the complete bounded prior-unit list by exact immutable hashes in batches of 16. Each stored audit is canonically decoded and checked against its saved digest, committed identity/grant, lane, indexed endpoints, snapshot bindings and receipt reference. Prior audits' own history references must agree with the same flat prefix. It does not recursively expand predecessor histories.
- `sync-store.ts:406–475` validates prior and current units together: each unit's historical snapshot/receipt bindings and member records are checked, original financial receipts are resolved through the common origin index and underlying economic domains, and every saved prefix origin reference is compared with the resolved typed receipt ID and digest. The complete bounded position range is joined to actual immutable deliveries, inbox positions and outcomes. Canonical outcomes, their digests/scalar indexes, member ownership, captured delivery digest and saved prefix outcome references must agree.
- The shared per-read receipt and snapshot caches avoid repeated validation of the same receipt/version while remaining scoped to the committed activation. Historical reads still use immutable versions/keys and do not consult the current parent pointer, capture checkpoint, authority status, or source availability. First-unit and legacy receipt paths retain their previous checks.
- `sync-apply-storage.test.ts:450–563` extends the genuine A5/capture fixture to two applied units with both initial and ongoing original receipts in the prefix. It verifies both exact recovery entry points after target/application and capture advancement inside a read-only transaction. Five independently rehashed successor audits alter the prior-unit digest, prior-outcome digest, prior-origin receipt ID, prior-origin receipt digest, or the actual referenced audit with a matching updated stored digest. Both entry points must reject every variant. Savepoints restore each corruption before the next case.

## Verification and limits

The reported red run produced all ten intended rejection failures before the reader change; the other ten storage cases passed. The final recorded typecheck and PostgreSQL storage suite passed (11/11, zero skips), and the staged diff check passed. These are focused checks, not a full regression or financial execution claim.

I read the supplied scoped diff, updated report, and relevant complete source/test sections. I did not rerun tests, access PostgreSQL, run Git commands, modify repository files, or spawn agents. Only this temporary review report was written.
