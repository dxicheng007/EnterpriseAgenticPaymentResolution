# Task 4 independent review — initial candidate

Verdict: **changes requested**. Source-only review; independent validation was not started because the SQL/test lease remained with the implementer.

- Reviewer: fresh independent Astra agent `/root/demo_task4_review`, separate from builder and supervising lead `/root`.
- Exact candidate: `3951388245e78f9b38cf6574b4d072f3c048a68e`.
- Base: `ce67b657cebc1db1ebdc94da04e89f0609c35d46`.
- Checkout: `/Users/devincheng/.codex/worktrees/company-a-demo-review/EnterpriseAgenticPaymentResolution`, clean and detached at the exact candidate.
- Scope: the seven changed Task 4 owned paths. Context reads covered applicable repository/script/test guides, Task 4 plan and brief, gate design including final Release refinement, verification conventions, contract rules, and referenced parser/finance helpers.
- Contract freeze v1 SHA-256: `863cdbc91c527b5e6d1f08e0ee7dedfd4483a0548249954ea732e196394d077a`; demo contract SHA-256: `a88a99811d47320f9e9aa47d034823589f124635c23f3a57649cd7c0734ef035`.
- Joint acceptance: pending. Full V5/V6, live construction, browser workflow and all-egress containment are not established by this review.

## P1 — Compare the allocation funding reference with the source payment identity

`tests/integration/demo-company-a-transport.test.ts:479` asserts `allocation.fundingRecordId === payment.id`. The allocation reference stores the source record identity (`pay-a:demo-pay-a-cutover-300`), while `payment.id` is the derived target record ID (`tr:...`). The financial resolver confirms this distinction: `fundingIdFor` passes `fundingRecordId` to `referenceId`, which derives the target record ID from the referenced economic identity. Thus the new mandatory observation path fails even when real source capture/application and parent money are correct. Because observation emission follows this assertion, `npm run verify:slice -- demo-company-a-ai-off` cannot pass or emit its required mounted proof on this candidate.

Compare with `payment.identity.recordId` instead. Preserve the following receipt `targetRecordIds` assertions against `payment.id` and `allocation.id`, because that field does contain derived target IDs. This is an evidence-gate blocker, not a production financial-write defect.

The supervising lead relayed the implementer's failed clean gate and targeted reproduction of this assertion. I confirmed the defect independently from the exact candidate source and financial reference resolver; I did not execute that failing test myself.

## Other source assessment

The diff preserves full V5/V6 selectors and predicates. It registers exactly six transport cases, twelve CLI cases, three app unit cases and typecheck. Observation collection is gated by private runner path/token, rejects unknown keys and stale tokens, and uses bounded regular-file reads. The observation is written after nested process shutdown and fixture cleanup. The new financial projection otherwise binds the actual approval, stored sync receipt, original receipt replay, source event pair, current/cutover values and immutable snapshot. Runtime isolation is accurately bounded to the inspected mounted global-fetch path. Raw reports are private and removed before packet emission; the public packet omits the run token. No additional blocking source finding was established.

## Commands and evidence

All commands below ran in the independent review checkout; source inspection only:

- `git status --short && git rev-parse HEAD`: initially clean at `158ce0695a3ecd498cfac64fcf745ec3d261b2f4`.
- `git switch --detach 3951388245e78f9b38cf6574b4d072f3c048a68e`: exit 0, exact candidate selected; no reset.
- `git diff --stat ce67b657cebc1db1ebdc94da04e89f0609c35d46..HEAD` and `git diff --name-only ...`: seven owned files, 516 additions and 10 deletions.
- `git diff ce67b657cebc1db1ebdc94da04e89f0609c35d46..HEAD -- scripts/verify-slice.ts tests/integration/demo-company-a-transport.test.ts`: inspected selector-only dispatch and observation producer changes.
- `git diff --check ce67b657cebc1db1ebdc94da04e89f0609c35d46..HEAD`: exit 0.
- `nl -ba tests/integration/demo-company-a-transport.test.ts | sed -n '470,482p'`: confirmed faulty comparison at line 479 and valid target-ID binding at lines 480–481.
- `cat packages/finance/src/allocations.ts`, `sed -n '1,38p' packages/finance/src/validate.ts`: confirmed source-reference-to-target-ID resolution.
- Final `git status --short && git rev-parse HEAD`: clean, exact candidate unchanged.

No parser tests, typecheck, bounded gate, PostgreSQL startup/shutdown, service launches, or database reads/writes were executed by this reviewer. The SQL/test lease was never acquired; there is no active reviewer cluster to stop. The original checkout and shared port 55441 were untouched. The designated reviewer cluster 55442 remained stopped.

A repaired commit requires a fresh exact-candidate independent review plus the still-pending focused parser validation and actual bounded gate. This source-only verdict does not supply machine acceptance.
