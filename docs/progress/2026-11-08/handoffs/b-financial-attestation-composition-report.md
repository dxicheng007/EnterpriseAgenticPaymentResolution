# A1c financial attestation composition implementation

- Worktree `/Users/devincheng/.codex/worktrees/acquisition-evaluator/EnterpriseAgenticPaymentResolution`.
- Branch `codex/financial-attestation-composition`.
- Base `cde1958c76abb40a3e6f34007e3edb46e42e1cb1`.
- Candidate `ce63cfc942065d9625191881ffa7cba56df739b3`.

## Composition

The existing local reviewer session and preview register the immutable subject in one candidate registry. The capture reader reuses the source-owned discovery validation over the exact registered manifest, including visible originals, evidence and membership. It compares canonical full manifest and snapshot objects, verifies every returned discovery binding field, reads every event for the pinned snapshot and runs the fixed capture derivation. It never selects another epoch or restricts the event list to the candidate account.

Default local verification uses the fixed financial launcher and attestation jobs through the existing route plugin. It checks the complete expected migration ledger at control006 or later, existing registry directory checks, exact operator version-2 construction pins and disjoint physical storage roots. The supervisor supplies its fixed `.local/protected-evaluator` location and actual evidence, visible source, artifact and web roots. Control checks root metadata. The protected probe checks the fixture bytes, obtains the evidence bundle hash and precedes durable reservation. The fixed run commits report and attestation through the accepted registry. Setup conflicts suppress attested availability while a missing or conflicting fixture discovered during a request fails the protected probe. The existing route source was structurally compatible and required no edit.

Historical v1 pins and stored reports are preserved. The attested job reader can return an actual legacy completion, and the trusted attestation reader rejects it for missing provenance. The exact gate-required legacy integration name and real legacy launcher assertions remain. Both browser verification specs now exercise the genuine version-2 default composition. The explicitly named evidence-v2 mode retains its additional private pin and file probes. A1c adds no policy installation or approval authority.

## Changed paths

- `apps/control/src/financial-capture.ts`
- `apps/control/src/financial-verification-composition.ts`
- `apps/control/src/verification-composition.ts`
- `apps/control/src/composition.ts`
- `scripts/dev.ts` only the local verification options
- `tests/integration/financial-attestation-composition.test.ts`
- `tests/integration/local-verification-startup.test.ts`
- `tests/e2e/support/local-review.ts` the separately authorized fixture mode and root options
- `docs/demo/verification-setup.md`

## Partial machine evidence

Node 24.22.2 and PostgreSQL 18.6 from Homebrew. Leased values were `EAPR_PG_PORT=55435`, `EAPR_CONTROL_PORT=3301`, `EAPR_WORKER_PORT=3302`, `EAPR_WEB_PORT=5176`, `EAPR_TEST_PREFIX=eapr_test_review_t2` and `EAPR_TEST_NAMESPACE_PREFIX=eapr_test_review_t2`. The development supervisor used `EAPR_DEMO_NAMESPACE=eapr_review_t2`.

- `npm run test:integration -- tests/integration/financial-attestation-composition.test.ts` first reproduced the missing composition. The real route queued a job and the legacy launcher failed with the isolated pin root. It passed after wiring the attested service.
- `npm run typecheck` passed on final files.
- `npm run test:unit` passed 334 tests in 52 files.
- `npm run test:integration -- tests/integration/financial-attestation-composition.test.ts tests/integration/local-verification-startup.test.ts tests/integration/v2-verification.test.ts tests/integration/bootstrap-financial-verification.test.ts` passed 9 tests in 4 files.
- `npm run test:integration -- tests/integration/financial-attestation-composition.test.ts tests/integration/local-verification-startup.test.ts tests/integration/discovery-capture-read.test.ts` passed 17 tests in 3 files on the final test revision.
- `npm run test:e2e -- tests/e2e/v2-evidence-verification.spec.ts tests/e2e/v2-verification.spec.ts --workers=1` passed 2 tests.
- `npm run dev` started the default supervisor on the leased ports. A `node --import tsx --input-type=module` smoke request used the Vite-origin reviewer session, cookie and CSRF, the existing preview and verify POSTs, authorized polling, and control SQL `SELECT 1 FROM financial_verification_attestations WHERE job_id = $1`. Both companies completed 13 checks with full coverage, eligible summaries, zero preview parent writes and one durable attestation each. Stopped the supervisor after the smoke. The test and demo data remained local.
- `git diff --cached --check` passed.

The composed test compares stored safe report and attestation bytes with the trusted reader after recreating control. The test-only policy binds the actual immutable capture, evidence bundle hash and fixed evaluator build. The test covers strict request fields, missing cookie and CSRF, foreign source/account/task, incorrect manifest/profile, task denial before capture/probe, the durable attempt cap, absence of visible originals and protected pins, substitution of the other company's pin, full snapshot mutation with unchanged content hash, event omission and substitution, exact control005 rejection, invalid expected ledger and conflicting roots. The upstream discovery read regression independently covers damaged or missing database citation evidence. Exact runtime table contents were stable during the composed proof.

Machine verification here is partial. The full V2 gate, combined-main verification, exact-candidate independent review and joint acceptance remain separate. No activation or live-model claim follows from these checks.
