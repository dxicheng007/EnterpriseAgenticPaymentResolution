### Spec Compliance

- ✅ Spec compliant for S4a, base `2a2f292fb58f12a3192ca8a0f2ce892631d0a93b`, exact candidate `7308e6cac9d0ae76e965e84edd558b901c3e1eee`.
- `apps/control/src/demo-candidates.ts:112` retains the existing scope and parent/customer/account identities, introduces profile version 2, copies parsed legal-name bytes directly into the customer metadata, cites the designated captured agreement, and derives a stable configuration ID from the existing term ID. Spec version 1 and financial mappings/terms remain unchanged.
- `tests/integration/bootstrap-financial-verification.test.ts:56` now tests the actual generated profile and reconstructs the historical version 1 financial-only profile; subsequent registration, compilation, report binding, thirteen-check eligibility, case-count and negative-control assertions remain in place. Financial eligibility does not assert bootstrap readiness.
- The controller-authorized adaptations at `tests/integration/evidence-v2-store.test.ts:229` maintain internally consistent bootstrap identity/configuration references while mutating financial inputs. The independent amendment/same-name fixture at `:332` explicitly remains financial-only. No validator or expected failure assertion was relaxed.
- ⚠️ Full corrected-head integration rerun was still pending in the implementer report read for this review. Browser/full-slice gates and joint user acceptance are not established by this task review.

### Strengths

- `apps/control/src/demo-candidates.ts:23` retains the supported designated-agreement parser unchanged apart from naming its captured field `legalName`; the displayed candidate label is composed from that field and is never the metadata source. No protected imports, new extractor, approval, parent write or financial policy change appears in the diff.
- `tests/integration/bootstrap-demo-candidates.test.ts:23` removes generated protected fixtures before candidate construction, checks both captures against their visible names/citations, verifies profile hashing and spec version, and rejects a different actual captured agreement at `:51`.
- `tests/integration/bootstrap-financial-verification.test.ts:79` verifies old and new immutable registrations, fresh exact-subject reports, rejection of old-report reuse, and unchanged monetary/citation/finding/mapping negative controls; pin bytes remain checked after execution.
- `tests/integration/evidence-v2-store.test.ts:247` still demands `failed` with three cases for each financial support mutation. Its monetary/finding/lineage/configuration-operation controls remain intact. `:346` retains the two-term and incorrect-end-date assertions; the distinct-buyer same-name case still requires failed evidence support with three cases.

### Issues

- Critical: none found.
- Important: none found.
- Minor: none found in the implementation diff.
- Verification limitation: the report retains two unexplained timing failures from the superseded full run (`v2-verification.test.ts`, 20-second route/scope/budget timeout and 24-second F8 polling deadline). The corrected focused run passed nine tests across five files with unchanged limits. This supports the focused candidate but does not convert the earlier full run into a pass; the controller must retain the corrected full-suite outcome separately.

### Evidence and review limits

- Read the task brief, implementer report, proposal §§2–3/6 and complete supplied diff once. Reviewed only this task's four changed files; no broader code crawl, git mutation or candidate checkout edits.
- Because diff hunks ended inside test functions, read their omitted continuations in `evidence-v2-store.test.ts` and `bootstrap-financial-verification.test.ts` to evaluate the concrete risk that fixture adaptation bypassed financial support, amendment or same-name identity assertions. Those checks preserve the original assertions and exact-subject coverage; no outside-diff production code inspection was needed.
- No tests rerun and no PG lease used. Machine evidence is the implementer's reported behavioral red, corrected typecheck, 260 passing unit tests, initial five-test focused pass and corrected nine-test focused pass. The reported initial 113/116 full integration result is not a passing broad gate. Full rerun remained pending when this report was written.

### Assessment

**Task quality:** Approved.

**Reasoning:** The implementation adds only evidence-backed metadata and a new immutable profile version, while exercising the actual generated subject through the existing financial verifier. Authorized test fixture adaptations preserve the original financial and evidence assertions; broad machine verification and acceptance remain separate gates.
