# Independent C3 pin-isolation fix review

Verdict: **ADDRESSED**. No new actionable defect found in the scoped fix.

Reviewed exact base `5d890c3cabc38c77131a4d21032b891f59410dd0` to candidate `40d426915671624ae43acdcc14873a5817ac6cc1`, in `/Users/devincheng/.codex/worktrees/acquisition-review-ui/EnterpriseAgenticPaymentResolution`. HEAD matched the candidate before verification; working tree was clean before and after. Read repository and tests/scripts AGENTS, exact fix brief, diff, and appended implementation report. No product edits, commits, or subagents.

## Finding disposition and code evidence

- Original fixed-key collision: ADDRESSED at `tests/e2e/support/verification-fixtures.ts:30` and `:43`. Each helper receives a fresh UUID and allocates distinct company IDs. Only fixtureSetId and the recomputed canonical hash change. All remaining decoded facts are compared exactly at `:49`, including generator build and financial/source facts. Existing immutable fixture validation is unchanged.
- Current v1 boundary: `verification-fixtures.ts:45` explicitly requires version 1. The new directory receives only two expected JSON files at `:55`; original truth and evidence companions remain together and untouched. This does not claim composite v2 preparation.
- Collision refusal: `verification-fixtures.ts:14` uses lstat and accepts only ENOENT; both target paths are checked before invoking registration at `:64`.
- Ownership and failure preservation: `verification-fixtures.ts:65` validates complete returned capture/snapshot/fixture bindings. Fingerprints are collected for both files before either is added to ownership at `:69`. A failed or mismatched preparation therefore cannot authorize deletion.
- Exact cleanup: `verification-fixtures.ts:24` fingerprints device, inode, mode, and bytes; `:77` removes only a tracked matching file. `tests/e2e/support/local-review.ts:30` waits for system shutdown before cleanup. Existing `apps/control/src/routes/verification.ts:63` drains evaluator jobs on close. Shutdown failure conservatively skips pin removal.
- Actual capture validation remains through existing prepareVerificationPins at `local-review.ts:55`. Fixed demo loading is unchanged at `:45`; nonverification composition remains at `:47`.

## Independently executed evidence

Environment: Node 24 / PostgreSQL 18 PATH; exclusive UI lease PG 55437, control 3501, worker 3502, web 5178, test prefix eapr_test_review_t2. Main PG55432/web5173 were not used.

1. `npm run test:integration -- tests/integration/c3-pin-isolation.test.ts`: 3/3 passed. Successful owned cleanup, refusal of preexisting collision, and retention after partial failure all preserve original truth and existing inventory.
2. Twice sequentially in the same checkout/store: `npm run test:e2e -- --trace off tests/e2e/v2-verification.spec.ts`: 1/1 passed each run. A private inventory wrapper checked filenames, SHA-256 byte hashes, and modes without printing the inventory. An exclusively created read-only sentinel was present for both runs. Each run observed exactly two new keys; the key sets were disjoint; each post-run inventory exactly matched its pre-run inventory. Every historical pin and sentinel remained byte/mode identical. After fingerprint-checked removal of only the owned sentinel, historical inventory was exactly unchanged.
3. Disposable independent helper probes: five passed, covering changed bytes, changed mode, replacement inode with identical bytes/mode, mismatched returned snapshot binding, and rejection of non-v1 truth. Changed pins were retained; unchanged owned sibling pins were removed; binding mismatch retained both unconfirmed pins. The probe independently compared every copied non-ID/hash canonical field and verified only expected-a/b.json were copied. Initial probe attempts hit the tsx IPC sandbox restriction and then a read-only-file write error in the probe; rerun used authorized escalation and temporarily changed only that disposable probe file's mode before mutation. Final five scenarios passed.
4. Exact candidate diff whitespace check passed; working tree remained clean.

Both browser runs completed real A/B jobs with 12 passed, 0 failed, 1 unavailable check per company. Evidence support remained unavailable, mandatory coverage incomplete, eligibility false. Browser assertions confirmed zero parent writes, unchanged runtime, bound summaries, and matching rendered rows. Artifact/profile/manifest hashes were identical across runs.

Browser-safe results and generated screenshots are under `/private/tmp/eapr-c3-independent-1/v2-verification-verifies-b-3a0bc-and-renders-bound-summaries/` and the corresponding `eapr-c3-independent-2` directory. Results JSON was inspected; screenshots were not independently visually reviewed in this isolation review. Trace was off. The inventory wrapper is `work/browser-pin-review.py`; disposable probe is `work/browser-pin-probe.mts` in the review chat workspace. No private pin inventory or fixture IDs were written into this report.

## Limits and handoff

Focused independent verification only: did not rerun all four browser tests, typecheck, or unrelated suites. The implementation report separately records those checks; they are not claimed as independently executed here. This review establishes the original isolation correction, not V2/F6 completion, full evaluator coverage, live/model behavior, or joint acceptance. Fingerprint checks are conservative ownership guards for the exclusive test lease, not an atomic defense against a hostile concurrent filesystem mutator.

After all browser checks, `EAPR_PG_PORT=55437 EAPR_DEMO_NAMESPACE=eapr_review_t2 EAPR_TEST_PREFIX=eapr_test_review_t2 npm run db:down` passed and stopped only the assigned UI cluster, retaining its data and historical pins. Candidate is clean and idle for root handoff.
